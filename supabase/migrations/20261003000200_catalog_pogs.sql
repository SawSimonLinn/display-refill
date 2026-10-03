-- Feature 02 / migration 2: product catalog, POG templates, immutable
-- published versions, slots and displays.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  short_name text not null check (length(btrim(short_name)) between 1 and 60),
  category text not null check (length(btrim(category)) between 1 and 100),
  container_type text not null check (length(btrim(container_type)) between 1 and 100),
  sku text check (sku is null or length(btrim(sku)) between 1 and 64),
  plu text check (plu is null or length(btrim(plu)) between 1 and 64),
  upc text check (upc is null or upc ~ '^[0-9]{6,14}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, id)
);

create table public.pogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, id)
);

create table public.pog_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pog_id uuid not null,
  version_number integer not null check (version_number > 0),
  state text not null default 'draft' check (state in ('draft', 'published')),
  -- Object path in the private pog-images bucket; required to publish.
  reference_path text,
  -- Dimensions of the canonical saved crop, not the original upload.
  reference_width integer check (reference_width between 1 and 4096),
  reference_height integer check (reference_height between 1 and 4096),
  published_at timestamptz,
  -- Null only for synthetic seed rows created without an identity.
  published_by uuid references auth.users (id) on delete restrict,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (pog_id, version_number),
  unique (organization_id, id),
  foreign key (organization_id, pog_id) references public.pogs (organization_id, id) on delete restrict,
  check (reference_path is null or reference_path like organization_id::text || '/' || pog_id::text || '/' || id::text || '/%'),
  check ((state = 'published') = (published_at is not null)),
  check (state = 'draft' or (reference_path is not null and reference_width is not null and reference_height is not null))
);

create table public.pog_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pog_version_id uuid not null,
  label text not null check (length(btrim(label)) between 1 and 40),
  product_id uuid not null,
  -- Normalized to the upright canonical crop; top-left origin.
  x numeric not null check (x >= 0 and x < 1),
  y numeric not null check (y >= 0 and y < 1),
  width numeric not null check (width > 0 and width <= 1),
  height numeric not null check (height > 0 and height <= 1),
  target_quantity integer not null check (target_quantity between 1 and 999),
  -- Inclusive trigger; null means always top up.
  refill_threshold integer check (refill_threshold is null or refill_threshold between 0 and target_quantity),
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  check (x + width <= 1),
  check (y + height <= 1),
  unique (pog_version_id, label),
  -- Lets scan_slots pin a slot to its version.
  unique (pog_version_id, id),
  foreign key (organization_id, pog_version_id) references public.pog_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict
);

create table public.displays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  active_pog_version_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (organization_id, store_id, id),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete restrict,
  -- Assigned version must belong to the same organization.
  foreign key (organization_id, active_pog_version_id)
    references public.pog_versions (organization_id, id) on delete restrict
);

create index products_org_idx on public.products (organization_id);
create index pogs_org_idx on public.pogs (organization_id);
create index pog_versions_org_idx on public.pog_versions (organization_id);
create index pog_slots_version_idx on public.pog_slots (pog_version_id);
create index pog_slots_product_idx on public.pog_slots (product_id);
create index displays_store_idx on public.displays (store_id);
create index displays_org_idx on public.displays (organization_id);
create index displays_pog_version_idx on public.displays (active_pog_version_id);

create trigger products_touch before update on public.products
  for each row execute function private.touch_row();
create trigger pogs_touch before update on public.pogs
  for each row execute function private.touch_row();
create trigger pog_versions_touch before update on public.pog_versions
  for each row execute function private.touch_row();
create trigger pog_slots_touch before update on public.pog_slots
  for each row execute function private.touch_row();
create trigger displays_touch before update on public.displays
  for each row execute function private.touch_row();

-- ---------------------------------------------------------------------------
-- Publication rules and immutability
-- ---------------------------------------------------------------------------

-- Every rule a version must satisfy to become published. Runs inside the
-- draft → published UPDATE, so no write path can skip it.
create function private.assert_publishable(p_version uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.pog_slots where pog_version_id = p_version;
  if v_count not between 1 and 100 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'a published version needs 1 to 100 slots';
  end if;

  if exists (
    select 1 from public.pog_slots s
    join public.products p on p.id = s.product_id
    where s.pog_version_id = p_version and not p.active
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'every slot product must be active';
  end if;

  -- Rectangles may touch but not overlap with positive area.
  if exists (
    select 1
    from public.pog_slots a
    join public.pog_slots b on b.pog_version_id = a.pog_version_id and a.id < b.id
    where a.pog_version_id = p_version
      and a.x < b.x + b.width and b.x < a.x + a.width
      and a.y < b.y + b.height and b.y < a.y + a.height
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'slot rectangles overlap';
  end if;
end;
$$;

create function private.guard_pog_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'versions are created as drafts';
    end if;
    return new;
  end if;

  if old.state = 'published' then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'published POG versions cannot change; create a new draft';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.state = 'published' then
    perform private.assert_publishable(new.id);
  end if;
  return new;
end;
$$;

create trigger pog_versions_guard
  before insert or update or delete on public.pog_versions
  for each row execute function private.guard_pog_version();

create function private.guard_pog_slot() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version uuid := coalesce(new.pog_version_id, old.pog_version_id);
begin
  if exists (select 1 from public.pog_versions where id = v_version and state = 'published')
     or (tg_op = 'UPDATE' and exists (select 1 from public.pog_versions where id = old.pog_version_id and state = 'published')) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'slots of a published POG version cannot change';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger pog_slots_guard
  before insert or update or delete on public.pog_slots
  for each row execute function private.guard_pog_slot();

-- A display may only point at a published version (same organization is
-- enforced by the composite foreign key).
create function private.guard_display_assignment() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_pog_version_id is not null
     and (tg_op = 'INSERT' or new.active_pog_version_id is distinct from old.active_pog_version_id)
     and not exists (
       select 1 from public.pog_versions
       where id = new.active_pog_version_id and state = 'published'
     ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'only published POG versions can be assigned';
  end if;
  return new;
end;
$$;

create trigger displays_guard_assignment
  before insert or update of active_pog_version_id on public.displays
  for each row execute function private.guard_display_assignment();

revoke all on function
  private.assert_publishable(uuid),
  private.guard_pog_version(),
  private.guard_pog_slot(),
  private.guard_display_assignment()
from public, anon, authenticated;
-- Called (not just fired) by the publication trigger, so the writing role needs it.
grant execute on function private.assert_publishable(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS (layout-data policies that depend on scans are in migration 3)
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.pogs enable row level security;
alter table public.pog_versions enable row level security;
alter table public.pog_slots enable row level security;
alter table public.displays enable row level security;

create policy displays_select on public.displays
  for select to authenticated
  using (store_id in (select private.accessible_store_ids((select auth.uid()))));
