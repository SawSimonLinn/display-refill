-- Feature 02 / migration 1: organizations, profiles, memberships, stores and
-- authorization helpers. See context/data-model.md and
-- context/auth-and-permissions.md.
--
-- Conventions used by every migration:
--   * UUID primary keys, timestamptz in UTC, integer counts.
--   * Tenant consistency through composite foreign keys on
--     (organization_id, id) so a child cannot point outside its organization.
--   * RLS enabled on every table; only SELECT policies for `authenticated`.
--     Clients get no INSERT/UPDATE/DELETE grants: writes go through the API
--     (service role) and narrowly granted functions.
--   * Helpers live in schema `private`, which PostgREST does not expose.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Maintains updated_at and the optimistic-concurrency revision.
create function private.touch_row() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

-- Rejects UPDATE and DELETE on append-only tables (all roles, including service).
create function private.reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE' using
    errcode = 'P0001',
    detail = format('%s rows are append-only', tg_table_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations and profiles
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);

-- Application profile for an auth.users identity. Holds no role: authority
-- comes only from membership rows.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);

-- Creates the profile row when Supabase Auth creates a user. Display name is
-- taken from invite metadata if present; it is never used for authorization.
create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 200))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Memberships and stores
-- ---------------------------------------------------------------------------

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  role text not null check (role in ('member', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, user_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  store_number text not null check (length(btrim(store_number)) between 1 and 50),
  timezone text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, store_number),
  unique (organization_id, id)
);

-- IANA time zone names only (validated against the server's tz database).
create function private.validate_store_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'VALIDATION_FAILED' using errcode = '23514', detail = 'timezone must be an IANA time zone name';
  end if;
  return new;
end;
$$;

create trigger stores_validate_timezone
  before insert or update of timezone on public.stores
  for each row execute function private.validate_store_timezone();

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('employee', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (store_id, user_id),
  -- The store must belong to the same organization...
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete restrict,
  -- ...and the user must hold a membership in that organization.
  foreign key (organization_id, user_id)
    references public.organization_memberships (organization_id, user_id) on delete restrict
);

create index organization_memberships_user_idx on public.organization_memberships (user_id) where active;
create index store_memberships_user_idx on public.store_memberships (user_id) where active;
create index store_memberships_org_idx on public.store_memberships (organization_id);
create index stores_org_idx on public.stores (organization_id);

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_row();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_row();
create trigger organization_memberships_touch before update on public.organization_memberships
  for each row execute function private.touch_row();
create trigger stores_touch before update on public.stores
  for each row execute function private.touch_row();
create trigger store_memberships_touch before update on public.store_memberships
  for each row execute function private.touch_row();

-- Never leave an active organization without an active admin.
create function private.protect_last_admin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.organization_memberships m
       where m.organization_id = old.organization_id
         and m.id <> old.id and m.role = 'admin' and m.active
     ) then
    raise exception 'LAST_ADMIN' using
      errcode = 'P0001',
      detail = 'an organization must keep at least one active admin';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_memberships_last_admin
  before update or delete on public.organization_memberships
  for each row execute function private.protect_last_admin();

-- ---------------------------------------------------------------------------
-- Authorization helpers
--
-- SECURITY DEFINER so policies can consult membership tables without
-- recursive RLS. They take the user ID explicitly: RLS policies pass
-- (select auth.uid()); trusted functions pass the API-verified actor.
-- `private` is not exposed through the Data API, so clients cannot call them.
-- ---------------------------------------------------------------------------

-- Active admin of an active organization.
create function private.is_org_admin(p_user uuid, p_org uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = p_user and m.organization_id = p_org
      and m.role = 'admin' and m.active and o.active
  );
$$;

-- Active (any role) member of an active organization.
create function private.is_org_member(p_user uuid, p_org uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = p_user and m.organization_id = p_org and m.active and o.active
  );
$$;

-- Stores the user may access: every store of an organization they administer,
-- plus stores with an active store membership backed by an active
-- organization membership.
create function private.accessible_store_ids(p_user uuid) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select s.id
  from public.stores s
  where private.is_org_admin(p_user, s.organization_id)
  union
  select sm.store_id
  from public.store_memberships sm
  join public.organization_memberships om
    on om.organization_id = sm.organization_id and om.user_id = sm.user_id
  join public.organizations o on o.id = sm.organization_id
  where sm.user_id = p_user and sm.active and om.active and o.active;
$$;

create function private.has_store_access(p_user uuid, p_store uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_store in (select private.accessible_store_ids(p_user));
$$;

-- Org admin, or manager of this specific store.
create function private.is_store_manager(p_user uuid, p_store uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stores s
    where s.id = p_store and private.is_org_admin(p_user, s.organization_id)
  ) or exists (
    select 1
    from public.store_memberships sm
    join public.organization_memberships om
      on om.organization_id = sm.organization_id and om.user_id = sm.user_id
    join public.organizations o on o.id = sm.organization_id
    where sm.user_id = p_user and sm.store_id = p_store
      and sm.role = 'manager' and sm.active and om.active and o.active
  );
$$;

-- Org admin, or manager of at least one store in the organization. Such users
-- may read the organization catalog.
create function private.is_org_manager_or_admin(p_user uuid, p_org uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_org_admin(p_user, p_org) or exists (
    select 1
    from public.store_memberships sm
    join public.organization_memberships om
      on om.organization_id = sm.organization_id and om.user_id = sm.user_id
    join public.organizations o on o.id = sm.organization_id
    where sm.user_id = p_user and sm.organization_id = p_org
      and sm.role = 'manager' and sm.active and om.active and o.active
  );
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_org_admin(uuid, uuid),
  private.is_org_member(uuid, uuid),
  private.accessible_store_ids(uuid),
  private.has_store_access(uuid, uuid),
  private.is_store_manager(uuid, uuid),
  private.is_org_manager_or_admin(uuid, uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_org_member((select auth.uid()), id));

-- Own profile; org admins see profiles of their organization's members.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organization_memberships m
      where m.user_id = profiles.user_id
        and private.is_org_admin((select auth.uid()), m.organization_id)
    )
  );

create policy organization_memberships_select on public.organization_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_org_admin((select auth.uid()), organization_id));

create policy stores_select on public.stores
  for select to authenticated
  using (id in (select private.accessible_store_ids((select auth.uid()))));

create policy store_memberships_select on public.store_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_org_admin((select auth.uid()), organization_id));
