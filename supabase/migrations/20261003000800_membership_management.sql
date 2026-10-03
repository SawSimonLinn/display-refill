-- Feature 03 / migration 8: membership management, the admin roster
-- projection and the operator-only first-admin bootstrap.
--
-- Every function here is executable by service_role only (the API after it
-- has verified the caller's token, or the operator bootstrap script). Each
-- takes the verified actor as p_actor and re-checks organization admin
-- rights itself, because the service role bypasses RLS. Errors use the API
-- error code as the message (decision D26).

-- ---------------------------------------------------------------------------
-- Last-admin guard: serialize demotions per organization.
--
-- The feature 02 trigger checked "another active admin exists" without a
-- lock, so two admins demoting each other in concurrent transactions could
-- both pass (write skew under READ COMMITTED). Locking the organization row
-- makes the second demotion wait for the first; its check then runs with a
-- fresh snapshot and sees the committed demotion. FOR NO KEY UPDATE does not
-- block foreign-key checks (FOR KEY SHARE) from other tables.
-- ---------------------------------------------------------------------------

create or replace function private.protect_last_admin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform 1 from public.organizations where id = old.organization_id for no key update;
    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.id <> old.id and m.role = 'admin' and m.active
    ) then
      raise exception 'LAST_ADMIN' using
        errcode = 'P0001',
        detail = 'an organization must keep at least one active admin';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared validation for a requested set of store assignments:
-- [{"store_id": uuid, "role": "employee"|"manager"}, ...]
-- Returns the normalized rows. Every store must belong to p_org and be
-- active; duplicates and unknown roles are rejected.
-- ---------------------------------------------------------------------------

create function private.parse_store_assignments(p_org uuid, p_stores jsonb)
returns table (store_id uuid, role text)
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  v_store uuid;
  v_role text;
  seen uuid[] := '{}';
begin
  if p_stores is null then
    return;
  end if;
  if jsonb_typeof(p_stores) <> 'array' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'stores must be an array';
  end if;
  if jsonb_array_length(p_stores) > 200 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'at most 200 store assignments';
  end if;
  for item in select * from jsonb_array_elements(p_stores) loop
    begin
      v_store := (item ->> 'store_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'store_id must be a UUID';
    end;
    v_role := item ->> 'role';
    if v_store is null or v_role is null or v_role not in ('employee', 'manager') then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'each store needs store_id and role employee|manager';
    end if;
    if v_store = any (seen) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'duplicate store_id';
    end if;
    seen := seen || v_store;
    -- Cross-organization or unknown store: indistinguishable to the caller.
    if not exists (select 1 from public.stores s where s.id = v_store and s.organization_id = p_org and s.active) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'store not found or archived';
    end if;
    store_id := v_store;
    role := v_role;
    return next;
  end loop;
end;
$$;

-- Current assignment snapshot for audit metadata.
create function private.membership_snapshot(p_org uuid, p_user uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'org_role', om.role,
    'active', om.active,
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('store_id', sm.store_id, 'role', sm.role) order by sm.store_id)
      from public.store_memberships sm
      where sm.organization_id = p_org and sm.user_id = p_user and sm.active
    ), '[]'::jsonb)
  )
  from public.organization_memberships om
  where om.organization_id = p_org and om.user_id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- Admin roster. Joins auth.users for email and last sign-in, so it is
-- SECURITY DEFINER (owner postgres) with an explicit admin check; only
-- service_role may execute it. Non-admins and other organizations get
-- NOT_FOUND / FORBIDDEN, never rows.
-- ---------------------------------------------------------------------------

create function public.list_organization_members(p_actor uuid, p_org uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  org_role text,
  active boolean,
  revision integer,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  stores jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_actor, p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'organization not found';
  end if;
  if not private.is_org_admin(p_actor, p_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins manage members';
  end if;
  return query
    select om.user_id,
           u.email::text,
           p.display_name,
           om.role,
           om.active,
           om.revision,
           om.created_at,
           u.last_sign_in_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'store_id', sm.store_id, 'role', sm.role, 'active', sm.active) order by s.name)
             from public.store_memberships sm
             join public.stores s on s.id = sm.store_id
             where sm.organization_id = om.organization_id and sm.user_id = om.user_id
           ), '[]'::jsonb)
    from public.organization_memberships om
    join public.profiles p on p.user_id = om.user_id
    join auth.users u on u.id = om.user_id
    where om.organization_id = p_org
    order by lower(u.email::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitation: called after the API has created the invited Auth identity.
-- Creates the organization membership and store memberships atomically and
-- audits the change. The Auth user must have no membership in p_org yet.
-- ---------------------------------------------------------------------------

create function public.apply_membership_invite(
  p_actor uuid,
  p_org uuid,
  p_user uuid,
  p_org_role text,
  p_stores jsonb,
  p_request_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_revision integer;
begin
  if not private.is_org_member(p_actor, p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'organization not found';
  end if;
  if not private.is_org_admin(p_actor, p_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins invite members';
  end if;
  if p_org_role is null or p_org_role not in ('member', 'admin') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'org_role must be member or admin';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'invited identity not found';
  end if;
  if exists (select 1 from public.organization_memberships where organization_id = p_org and user_id = p_user) then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = 'user already has a membership in this organization';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (p_org, p_user, p_org_role)
  returning revision into v_revision;

  insert into public.store_memberships (organization_id, store_id, user_id, role)
  select p_org, a.store_id, p_user, a.role
  from private.parse_store_assignments(p_org, coalesce(p_stores, '[]'::jsonb)) a;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, p_actor, 'membership.invited', p_user, p_request_id,
          jsonb_build_object('after', private.membership_snapshot(p_org, p_user)));

  return v_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- Change or revoke a membership. NULL arguments leave that part unchanged.
-- p_stores, when given, is the complete set of active store assignments:
-- listed stores are created/reactivated with the given role, all others are
-- deactivated. The organization membership row is always touched so its
-- revision covers the whole assignment (optimistic concurrency).
-- The last-admin trigger rejects removing the final active admin.
-- ---------------------------------------------------------------------------

create function public.update_membership(
  p_actor uuid,
  p_org uuid,
  p_user uuid,
  p_expected_revision integer,
  p_org_role text default null,
  p_active boolean default null,
  p_stores jsonb default null,
  p_request_id uuid default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  m public.organization_memberships;
  v_before jsonb;
  v_after jsonb;
  v_store_ids uuid[];
  v_store_roles text[];
begin
  if not private.is_org_member(p_actor, p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'organization not found';
  end if;
  if not private.is_org_admin(p_actor, p_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins change memberships';
  end if;
  if p_org_role is not null and p_org_role not in ('member', 'admin') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'org_role must be member or admin';
  end if;

  select * into m from public.organization_memberships
   where organization_id = p_org and user_id = p_user
   for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'member not found';
  end if;
  if m.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001',
      detail = format('expected revision %s, current %s', p_expected_revision, m.revision);
  end if;

  v_before := private.membership_snapshot(p_org, p_user);

  update public.organization_memberships
     set role = coalesce(p_org_role, role),
         active = coalesce(p_active, active)
   where id = m.id
  returning * into m;

  if p_stores is not null then
    -- Validate the whole set before changing any row.
    select coalesce(array_agg(a.store_id), '{}'), coalesce(array_agg(a.role), '{}')
      into v_store_ids, v_store_roles
      from private.parse_store_assignments(p_org, p_stores) a;

    update public.store_memberships sm
       set active = false
     where sm.organization_id = p_org and sm.user_id = p_user and sm.active
       and not (sm.store_id = any (v_store_ids));

    insert into public.store_memberships (organization_id, store_id, user_id, role)
    select p_org, r.store_id, p_user, r.role
    from unnest(v_store_ids, v_store_roles) as r (store_id, role)
    on conflict (store_id, user_id) do update
      set role = excluded.role, active = true
      where public.store_memberships.role is distinct from excluded.role
         or not public.store_memberships.active;
  end if;

  v_after := private.membership_snapshot(p_org, p_user);

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, p_actor,
          case when v_before ->> 'active' = 'true' and v_after ->> 'active' = 'false'
               then 'membership.revoked' else 'membership.updated' end,
          p_user, p_request_id,
          jsonb_build_object('before', v_before, 'after', v_after));

  return m.revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator-only first-admin bootstrap (scripts/bootstrap-admin.mjs; see
-- context/operations-runbook.md). Never "first signed-in user becomes
-- admin": it runs only with the service role, against an identity the
-- operator created, and refuses an organization that already has an active
-- admin. Creates the organization when p_org is null.
-- ---------------------------------------------------------------------------

create function public.bootstrap_first_admin(
  p_user uuid,
  p_org uuid default null,
  p_org_name text default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := p_org;
begin
  if not exists (select 1 from public.profiles where user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'identity not found';
  end if;

  if v_org is null then
    if p_org_name is null or length(btrim(p_org_name)) = 0 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'organization name is required';
    end if;
    insert into public.organizations (name) values (btrim(p_org_name)) returning id into v_org;
  else
    perform 1 from public.organizations where id = v_org and active for no key update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'organization not found or inactive';
    end if;
  end if;

  if exists (
    select 1 from public.organization_memberships
    where organization_id = v_org and role = 'admin' and active
  ) then
    raise exception 'CONFLICT' using errcode = 'P0001',
      detail = 'organization already has an active admin; use the members API instead';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, p_user, 'admin', true)
  on conflict (organization_id, user_id) do update set role = 'admin', active = true;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, metadata)
  values (v_org, null, 'membership.bootstrapped', p_user, jsonb_build_object('after', private.membership_snapshot(v_org, p_user)));

  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only. Default privileges already withhold EXECUTE
-- from public/anon/authenticated; state it explicitly as well.
-- ---------------------------------------------------------------------------

revoke all on function
  public.list_organization_members(uuid, uuid),
  public.apply_membership_invite(uuid, uuid, uuid, text, jsonb, uuid),
  public.update_membership(uuid, uuid, uuid, integer, text, boolean, jsonb, uuid),
  public.bootstrap_first_admin(uuid, uuid, text),
  private.parse_store_assignments(uuid, jsonb),
  private.membership_snapshot(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.list_organization_members(uuid, uuid),
  public.apply_membership_invite(uuid, uuid, uuid, text, jsonb, uuid),
  public.update_membership(uuid, uuid, uuid, integer, text, boolean, jsonb, uuid),
  public.bootstrap_first_admin(uuid, uuid, text),
  private.parse_store_assignments(uuid, jsonb),
  private.membership_snapshot(uuid, uuid)
to service_role;
