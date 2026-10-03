-- Feature 04 / migration 9: store, product, POG identity and display
-- management.
--
-- Every function here is executable by service_role only (the API after it
-- has verified the caller's token). Each takes the verified actor as p_actor,
-- resolves the organization and store from the stored row (never from the
-- request), re-checks the actor's rights itself because the service role
-- bypasses RLS, enforces optimistic concurrency with expected revisions, and
-- writes an audit event in the same transaction. Errors use the API error
-- code as the message (decision D26); VALIDATION_FAILED carries the offending
-- request field name in HINT so the API can report it as a field error.
--
-- Nothing is deleted: stores, displays and products are archived
-- (active = false) and POG identities are archived (archived = true).
-- create_scan already refuses archived stores and displays.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Fails with VALIDATION_FAILED for anything but a non-empty object whose keys
-- are all in p_allowed.
create function private.check_patch(p_changes jsonb, p_allowed text[]) returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'change at least one field', hint = 'request';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any (p_allowed)) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'unknown field', hint = 'request';
    end if;
  end loop;
end;
$$;

-- Trimmed text; empty means missing. Required unless p_nullable.
create function private.clean_text(p_value text, p_field text, p_max integer, p_nullable boolean default false) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(p_value);
begin
  if v is null or v = '' then
    if p_nullable then
      return null;
    end if;
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is required', hint = p_field;
  end if;
  if length(v) > p_max then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('must be at most %s characters', p_max), hint = p_field;
  end if;
  return v;
end;
$$;

-- A JSON boolean from a patch.
create function private.clean_bool(p_value jsonb, p_field text) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be true or false', hint = p_field;
  end if;
  return p_value::text::boolean;
end;
$$;

-- NOT_FOUND for non-members (no disclosure across organizations), FORBIDDEN
-- for members who are not admins.
create function private.require_org_admin(p_actor uuid, p_org uuid, p_action text) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_org is null or not private.is_org_member(p_actor, p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'organization not found';
  end if;
  if not private.is_org_admin(p_actor, p_org) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = format('only organization admins %s', p_action);
  end if;
end;
$$;

create function private.check_timezone(p_timezone text) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be an IANA time zone such as America/Los_Angeles', hint = 'timezone';
  end if;
end;
$$;

-- Store numbers are unique per organization, compared case-insensitively so
-- "a-001" and "A-001" cannot both exist. The unique constraint backs this up
-- for exact duplicates under concurrency.
create function private.check_store_number_free(p_org uuid, p_number text, p_except uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.stores
    where organization_id = p_org and lower(store_number) = lower(p_number)
      and id is distinct from p_except
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is already used by another store in this organization', hint = 'store_number';
  end if;
end;
$$;

-- A display may be assigned only a published version of a non-archived POG
-- in the display's own organization. Unknown, other-organization, draft and
-- archived versions get the same answer, so nothing is disclosed. FOR SHARE
-- keeps the POG from being archived until this transaction commits.
create function private.check_assignable_version(p_org uuid, p_version uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
    from public.pog_versions v
    join public.pogs p on p.id = v.pog_id
   where v.id = p_version and v.organization_id = p_org and p.organization_id = p_org
     and v.state = 'published' and not p.archived
   for share of v, p;
  if not found then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001',
      detail = 'choose a published version of an active POG in this organization', hint = 'active_pog_version_id';
  end if;
end;
$$;

create function private.uuid_or_null(p_value jsonb, p_field text) returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be a UUID or null', hint = p_field;
  end if;
  return (p_value #>> '{}')::uuid;
exception when invalid_text_representation then
  raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be a UUID or null', hint = p_field;
end;
$$;

create function private.store_json(s public.stores) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('name', s.name, 'store_number', s.store_number, 'timezone', s.timezone, 'active', s.active);
$$;

create function private.product_json(p public.products) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name, 'short_name', p.short_name, 'category', p.category, 'container_type', p.container_type,
    'sku', p.sku, 'plu', p.plu, 'upc', p.upc, 'active', p.active);
$$;

create function private.upc_or_null(p_value text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.clean_text(p_value, 'upc', 14, true);
begin
  if v is not null and v !~ '^[0-9]{6,14}$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be 6 to 14 digits', hint = 'upc';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stores (organization admins)
-- ---------------------------------------------------------------------------

create function public.create_store(
  p_actor uuid,
  p_org uuid,
  p_name text,
  p_store_number text,
  p_timezone text,
  p_request_id uuid default null
) returns public.stores
language plpgsql
set search_path = ''
as $$
declare
  s public.stores;
begin
  perform private.require_org_admin(p_actor, p_org, 'create stores');
  s.name := private.clean_text(p_name, 'name', 200);
  s.store_number := private.clean_text(p_store_number, 'store_number', 50);
  s.timezone := private.clean_text(p_timezone, 'timezone', 64);
  perform private.check_timezone(s.timezone);
  perform private.check_store_number_free(p_org, s.store_number, null);

  insert into public.stores (organization_id, name, store_number, timezone)
  values (p_org, s.name, s.store_number, s.timezone)
  returning * into s;

  insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, s.id, p_actor, 'store.created', s.id, p_request_id, jsonb_build_object('after', private.store_json(s)));
  return s;
exception when unique_violation then
  raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is already used by another store in this organization', hint = 'store_number';
end;
$$;

-- p_changes: any of name, store_number, timezone, active. Archiving a store
-- (active = false) blocks new scans in it; history stays readable.
create function public.update_store(
  p_actor uuid,
  p_store_id uuid,
  p_expected_revision integer,
  p_changes jsonb,
  p_request_id uuid default null
) returns public.stores
language plpgsql
set search_path = ''
as $$
declare
  s public.stores;
  v public.stores;
begin
  perform private.check_patch(p_changes, array['name', 'store_number', 'timezone', 'active']);
  select * into s from public.stores where id = p_store_id for update;
  if not found or not private.has_store_access(p_actor, s.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'store not found';
  end if;
  if not private.is_org_admin(p_actor, s.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins change stores';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, s.revision);
  end if;

  v := s;
  if p_changes ? 'name' then v.name := private.clean_text(p_changes ->> 'name', 'name', 200); end if;
  if p_changes ? 'store_number' then
    v.store_number := private.clean_text(p_changes ->> 'store_number', 'store_number', 50);
    perform private.check_store_number_free(s.organization_id, v.store_number, s.id);
  end if;
  if p_changes ? 'timezone' then
    v.timezone := private.clean_text(p_changes ->> 'timezone', 'timezone', 64);
    perform private.check_timezone(v.timezone);
  end if;
  if p_changes ? 'active' then v.active := private.clean_bool(p_changes -> 'active', 'active'); end if;

  if private.store_json(v) = private.store_json(s) then
    return s; -- nothing to change; keep the revision
  end if;

  update public.stores
     set name = v.name, store_number = v.store_number, timezone = v.timezone, active = v.active
   where id = s.id
  returning * into v;

  insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
  values (s.organization_id, s.id, p_actor,
          case when s.active and not v.active then 'store.archived'
               when not s.active and v.active then 'store.restored'
               else 'store.updated' end,
          s.id, p_request_id,
          jsonb_build_object('before', private.store_json(s), 'after', private.store_json(v)));
  return v;
exception when unique_violation then
  raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is already used by another store in this organization', hint = 'store_number';
end;
$$;

-- ---------------------------------------------------------------------------
-- Products (organization admins). Renaming never touches scan_slots
-- snapshots; archiving keeps the product readable in history and makes
-- publication of versions that use it fail.
-- ---------------------------------------------------------------------------

create function public.create_product(
  p_actor uuid,
  p_org uuid,
  p_name text,
  p_short_name text,
  p_category text,
  p_container_type text,
  p_sku text default null,
  p_plu text default null,
  p_upc text default null,
  p_request_id uuid default null
) returns public.products
language plpgsql
set search_path = ''
as $$
declare
  p public.products;
begin
  perform private.require_org_admin(p_actor, p_org, 'create products');
  insert into public.products (organization_id, name, short_name, category, container_type, sku, plu, upc)
  values (
    p_org,
    private.clean_text(p_name, 'name', 200),
    private.clean_text(p_short_name, 'short_name', 60),
    private.clean_text(p_category, 'category', 100),
    private.clean_text(p_container_type, 'container_type', 100),
    private.clean_text(p_sku, 'sku', 64, true),
    private.clean_text(p_plu, 'plu', 64, true),
    private.upc_or_null(p_upc)
  )
  returning * into p;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, p_actor, 'product.created', p.id, p_request_id, jsonb_build_object('after', private.product_json(p)));
  return p;
end;
$$;

-- p_changes: any of name, short_name, category, container_type, sku, plu,
-- upc (null clears a code), active.
create function public.update_product(
  p_actor uuid,
  p_product_id uuid,
  p_expected_revision integer,
  p_changes jsonb,
  p_request_id uuid default null
) returns public.products
language plpgsql
set search_path = ''
as $$
declare
  p public.products;
  v public.products;
begin
  perform private.check_patch(p_changes, array['name', 'short_name', 'category', 'container_type', 'sku', 'plu', 'upc', 'active']);
  select * into p from public.products where id = p_product_id for update;
  if not found or not private.is_org_member(p_actor, p.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'product not found';
  end if;
  if not private.is_org_admin(p_actor, p.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins change products';
  end if;
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, p.revision);
  end if;

  v := p;
  if p_changes ? 'name' then v.name := private.clean_text(p_changes ->> 'name', 'name', 200); end if;
  if p_changes ? 'short_name' then v.short_name := private.clean_text(p_changes ->> 'short_name', 'short_name', 60); end if;
  if p_changes ? 'category' then v.category := private.clean_text(p_changes ->> 'category', 'category', 100); end if;
  if p_changes ? 'container_type' then v.container_type := private.clean_text(p_changes ->> 'container_type', 'container_type', 100); end if;
  if p_changes ? 'sku' then v.sku := private.clean_text(p_changes ->> 'sku', 'sku', 64, true); end if;
  if p_changes ? 'plu' then v.plu := private.clean_text(p_changes ->> 'plu', 'plu', 64, true); end if;
  if p_changes ? 'upc' then v.upc := private.upc_or_null(p_changes ->> 'upc'); end if;
  if p_changes ? 'active' then v.active := private.clean_bool(p_changes -> 'active', 'active'); end if;

  if private.product_json(v) = private.product_json(p) then
    return p;
  end if;

  update public.products
     set name = v.name, short_name = v.short_name, category = v.category, container_type = v.container_type,
         sku = v.sku, plu = v.plu, upc = v.upc, active = v.active
   where id = p.id
  returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p.organization_id, p_actor,
          case when p.active and not v.active then 'product.archived'
               when not p.active and v.active then 'product.restored'
               else 'product.updated' end,
          p.id, p_request_id,
          jsonb_build_object('before', private.product_json(p), 'after', private.product_json(v)));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- POG identities (organization admins). Creating a POG also creates its
-- empty draft version 1 (api-contracts.md). Drawing slots, reference images
-- and publication are feature 05.
-- ---------------------------------------------------------------------------

create function public.create_pog(
  p_actor uuid,
  p_org uuid,
  p_name text,
  p_request_id uuid default null
) returns public.pogs
language plpgsql
set search_path = ''
as $$
declare
  g public.pogs;
  v_version uuid;
begin
  perform private.require_org_admin(p_actor, p_org, 'create POGs');
  insert into public.pogs (organization_id, name)
  values (p_org, private.clean_text(p_name, 'name', 200))
  returning * into g;

  insert into public.pog_versions (organization_id, pog_id, version_number, created_by)
  values (p_org, g.id, 1, p_actor)
  returning id into v_version;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, p_actor, 'pog.created', g.id, p_request_id,
          jsonb_build_object('name', g.name, 'draft_version_id', v_version));
  return g;
end;
$$;

-- p_changes: any of name, archived. Archiving stops new assignments and
-- publication; displays keep the version they have until reassigned.
create function public.update_pog(
  p_actor uuid,
  p_pog_id uuid,
  p_expected_revision integer,
  p_changes jsonb,
  p_request_id uuid default null
) returns public.pogs
language plpgsql
set search_path = ''
as $$
declare
  g public.pogs;
  v public.pogs;
begin
  perform private.check_patch(p_changes, array['name', 'archived']);
  select * into g from public.pogs where id = p_pog_id for update;
  if not found or not private.is_org_member(p_actor, g.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'POG not found';
  end if;
  if not private.is_org_admin(p_actor, g.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins change POGs';
  end if;
  if g.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, g.revision);
  end if;

  v := g;
  if p_changes ? 'name' then v.name := private.clean_text(p_changes ->> 'name', 'name', 200); end if;
  if p_changes ? 'archived' then v.archived := private.clean_bool(p_changes -> 'archived', 'archived'); end if;
  if (v.name, v.archived) is not distinct from (g.name, g.archived) then
    return g;
  end if;

  update public.pogs set name = v.name, archived = v.archived where id = g.id returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (g.organization_id, p_actor,
          case when not g.archived and v.archived then 'pog.archived'
               when g.archived and not v.archived then 'pog.restored'
               else 'pog.updated' end,
          g.id, p_request_id,
          jsonb_build_object('before', jsonb_build_object('name', g.name, 'archived', g.archived),
                             'after', jsonb_build_object('name', v.name, 'archived', v.archived)));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Displays (managers of the display's store, organization admins)
-- ---------------------------------------------------------------------------

create function public.create_display(
  p_actor uuid,
  p_store_id uuid,
  p_name text,
  p_active_pog_version_id uuid default null,
  p_request_id uuid default null
) returns public.displays
language plpgsql
set search_path = ''
as $$
declare
  st public.stores;
  d public.displays;
begin
  -- FOR SHARE: the store cannot be archived until this display is committed.
  select * into st from public.stores where id = p_store_id for share;
  if not found or not private.has_store_access(p_actor, st.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'store not found';
  end if;
  if not private.is_store_manager(p_actor, st.id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only store managers and organization admins manage displays';
  end if;
  if not st.active then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'store is archived', hint = 'store_id';
  end if;
  if p_active_pog_version_id is not null then
    perform private.check_assignable_version(st.organization_id, p_active_pog_version_id);
  end if;

  insert into public.displays (organization_id, store_id, name, active_pog_version_id)
  values (st.organization_id, st.id, private.clean_text(p_name, 'name', 200), p_active_pog_version_id)
  returning * into d;

  insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
  values (d.organization_id, d.store_id, p_actor, 'display.created', d.id, p_request_id,
          jsonb_build_object('name', d.name, 'active_pog_version_id', d.active_pog_version_id));
  if d.active_pog_version_id is not null then
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
    values (d.organization_id, d.store_id, p_actor, 'display.assigned', d.id, p_request_id,
            jsonb_build_object('before', null, 'after', d.active_pog_version_id));
  end if;
  return d;
end;
$$;

-- p_changes: any of name, active, active_pog_version_id (null unassigns).
-- The display's store cannot change. FOR UPDATE on the display serializes
-- with create_scan (which holds FOR SHARE), so a scan either commits before
-- an archive/reassignment or sees its result.
create function public.update_display(
  p_actor uuid,
  p_display_id uuid,
  p_expected_revision integer,
  p_changes jsonb,
  p_request_id uuid default null
) returns public.displays
language plpgsql
set search_path = ''
as $$
declare
  d public.displays;
  v public.displays;
  st public.stores;
begin
  perform private.check_patch(p_changes, array['name', 'active', 'active_pog_version_id']);
  select * into d from public.displays where id = p_display_id for update;
  if not found or not private.has_store_access(p_actor, d.store_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'display not found';
  end if;
  if not private.is_store_manager(p_actor, d.store_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only store managers and organization admins manage displays';
  end if;
  if d.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, d.revision);
  end if;
  select * into st from public.stores where id = d.store_id for share;

  v := d;
  if p_changes ? 'name' then v.name := private.clean_text(p_changes ->> 'name', 'name', 200); end if;
  if p_changes ? 'active' then v.active := private.clean_bool(p_changes -> 'active', 'active'); end if;
  if p_changes ? 'active_pog_version_id' then
    v.active_pog_version_id := private.uuid_or_null(p_changes -> 'active_pog_version_id', 'active_pog_version_id');
  end if;

  if v.active and not d.active and not st.active then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'the store is archived; restore the store first', hint = 'active';
  end if;
  if v.active_pog_version_id is not null and v.active_pog_version_id is distinct from d.active_pog_version_id then
    perform private.check_assignable_version(d.organization_id, v.active_pog_version_id);
  end if;
  if (v.name, v.active, v.active_pog_version_id) is not distinct from (d.name, d.active, d.active_pog_version_id) then
    return d;
  end if;

  update public.displays
     set name = v.name, active = v.active, active_pog_version_id = v.active_pog_version_id
   where id = d.id
  returning * into v;

  if v.active_pog_version_id is distinct from d.active_pog_version_id then
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
    values (d.organization_id, d.store_id, p_actor, 'display.assigned', d.id, p_request_id,
            jsonb_build_object('before', d.active_pog_version_id, 'after', v.active_pog_version_id));
  end if;
  if (v.name, v.active) is distinct from (d.name, d.active) then
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
    values (d.organization_id, d.store_id, p_actor,
            case when d.active and not v.active then 'display.archived'
                 when not d.active and v.active then 'display.restored'
                 else 'display.updated' end,
            d.id, p_request_id,
            jsonb_build_object('before', jsonb_build_object('name', d.name, 'active', d.active),
                               'after', jsonb_build_object('name', v.name, 'active', v.active)));
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only. Functions in `private` created after migration 1
-- would otherwise keep the default PUBLIC execute privilege.
-- ---------------------------------------------------------------------------

revoke all on function
  private.check_patch(jsonb, text[]),
  private.clean_text(text, text, integer, boolean),
  private.clean_bool(jsonb, text),
  private.require_org_admin(uuid, uuid, text),
  private.check_timezone(text),
  private.check_store_number_free(uuid, text, uuid),
  private.check_assignable_version(uuid, uuid),
  private.uuid_or_null(jsonb, text),
  private.store_json(public.stores),
  private.product_json(public.products),
  private.upc_or_null(text),
  public.create_store(uuid, uuid, text, text, text, uuid),
  public.update_store(uuid, uuid, integer, jsonb, uuid),
  public.create_product(uuid, uuid, text, text, text, text, text, text, text, uuid),
  public.update_product(uuid, uuid, integer, jsonb, uuid),
  public.create_pog(uuid, uuid, text, uuid),
  public.update_pog(uuid, uuid, integer, jsonb, uuid),
  public.create_display(uuid, uuid, text, uuid, uuid),
  public.update_display(uuid, uuid, integer, jsonb, uuid)
from public, anon, authenticated;

grant execute on function
  private.check_patch(jsonb, text[]),
  private.clean_text(text, text, integer, boolean),
  private.clean_bool(jsonb, text),
  private.require_org_admin(uuid, uuid, text),
  private.check_timezone(text),
  private.check_store_number_free(uuid, text, uuid),
  private.check_assignable_version(uuid, uuid),
  private.uuid_or_null(jsonb, text),
  private.store_json(public.stores),
  private.product_json(public.products),
  private.upc_or_null(text),
  public.create_store(uuid, uuid, text, text, text, uuid),
  public.update_store(uuid, uuid, integer, jsonb, uuid),
  public.create_product(uuid, uuid, text, text, text, text, text, text, text, uuid),
  public.update_product(uuid, uuid, integer, jsonb, uuid),
  public.create_pog(uuid, uuid, text, uuid),
  public.update_pog(uuid, uuid, integer, jsonb, uuid),
  public.create_display(uuid, uuid, text, uuid, uuid),
  public.update_display(uuid, uuid, integer, jsonb, uuid)
to service_role;
