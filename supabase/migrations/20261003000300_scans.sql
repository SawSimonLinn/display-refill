-- Feature 02 / migration 3: scans, pinned slot snapshots, append-only
-- corrections and confirmations, plus layout-data read policies that depend
-- on scans. States: context/scan-lifecycle.md. Rules: context/refill-rules.md.

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  display_id uuid not null,
  pog_version_id uuid not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  source text not null check (source in ('photo', 'manual')),
  status text not null check (status in (
    'awaiting_upload', 'queued', 'processing', 'needs_review', 'failed', 'confirmed', 'completed'
  )),
  revision integer not null default 1 check (revision > 0),
  job_generation integer not null default 0 check (job_generation >= 0),
  retry_generation_count integer not null default 0 check (retry_generation_count between 0 and 2),
  crop_json jsonb check (crop_json is null or jsonb_typeof(crop_json) = 'object'),
  image_path text check (image_path is null or image_path = organization_id::text || '/' || store_id::text || '/' || id::text || '/capture.jpg'),
  image_deleted_at timestamptz,
  captured_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete restrict,
  total_refill integer check (total_refill >= 0),
  display_score integer check (display_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, id, pog_version_id),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete restrict,
  -- The display must belong to this store and organization.
  foreign key (organization_id, store_id, display_id)
    references public.displays (organization_id, store_id, id) on delete restrict,
  foreign key (organization_id, pog_version_id) references public.pog_versions (organization_id, id) on delete restrict,
  check (source = 'photo' or image_path is null),
  check ((status in ('confirmed', 'completed')) = (confirmed_at is not null)),
  check ((status = 'completed') = (completed_at is not null and completed_by is not null)),
  check (status in ('confirmed', 'completed') or (total_refill is null and display_score is null))
);

create table public.scan_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  pog_version_id uuid not null,
  pog_slot_id uuid not null,
  product_id uuid not null,
  -- Snapshots copied at scan creation so later renames do not rewrite history.
  product_name_snapshot text not null,
  slot_label_snapshot text not null,
  target_snapshot integer not null check (target_snapshot between 1 and 999),
  threshold_snapshot integer check (threshold_snapshot is null or threshold_snapshot between 0 and target_snapshot),
  -- Original AI observation; null quantity means unknown, never zero.
  ai_quantity integer check (ai_quantity between 0 and 999),
  ai_confidence numeric check (ai_confidence between 0 and 1),
  ai_flags text[] not null default '{}' check (ai_flags <@ array['occluded', 'wrong_product', 'out_of_frame', 'ambiguous', 'low_visibility']),
  accepted_quantity integer check (accepted_quantity between 0 and 999),
  review_required boolean not null default true,
  review_state text not null default 'pending' check (review_state in ('pending', 'verified')),
  final_quantity integer check (final_quantity between 0 and 999),
  refill_quantity integer check (refill_quantity between 0 and target_snapshot),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scan_id, pog_slot_id),
  unique (scan_id, id),
  -- Same organization and the scan's pinned version...
  foreign key (organization_id, scan_id, pog_version_id)
    references public.scans (organization_id, id, pog_version_id) on delete restrict,
  -- ...and a slot of exactly that version.
  foreign key (pog_version_id, pog_slot_id) references public.pog_slots (pog_version_id, id) on delete restrict,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict,
  check ((final_quantity is null) = (refill_quantity is null))
);

create table public.scan_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  scan_slot_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  previous_quantity integer check (previous_quantity between 0 and 999),
  corrected_quantity integer not null check (corrected_quantity between 0 and 999),
  original_ai_quantity integer check (original_ai_quantity between 0 and 999),
  reason text check (reason in ('count_corrected', 'visibility_check', 'wrong_product', 'manual_count')),
  scan_revision integer not null check (scan_revision > 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, scan_id) references public.scans (organization_id, id) on delete restrict,
  foreign key (scan_id, scan_slot_id) references public.scan_slots (scan_id, id) on delete restrict
);

create table public.scan_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null unique,
  scan_revision integer not null check (scan_revision > 0),
  confirmed_by uuid not null references auth.users (id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  total_refill integer not null check (total_refill >= 0),
  display_score integer check (display_score between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (organization_id, scan_id) references public.scans (organization_id, id) on delete restrict
);

create index scans_store_created_idx on public.scans (store_id, created_at desc, id desc);
create index scans_display_created_idx on public.scans (display_id, created_at desc);
create index scans_created_by_idx on public.scans (created_by, created_at desc);
create index scans_org_idx on public.scans (organization_id);
create index scans_pog_version_idx on public.scans (pog_version_id);
create index scan_slots_scan_idx on public.scan_slots (scan_id);
create index scan_slots_org_idx on public.scan_slots (organization_id);
create index scan_corrections_scan_idx on public.scan_corrections (scan_id);
create index scan_corrections_org_idx on public.scan_corrections (organization_id);
create index scan_confirmations_org_idx on public.scan_confirmations (organization_id);

-- Scans keep updated_at; revision changes are explicit in transition functions.
create function private.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger scans_touch before update on public.scans
  for each row execute function private.touch_updated_at();
create trigger scan_slots_touch before update on public.scan_slots
  for each row execute function private.touch_updated_at();

create trigger scan_corrections_append_only before update or delete on public.scan_corrections
  for each row execute function private.reject_mutation();
create trigger scan_confirmations_append_only before update or delete on public.scan_confirmations
  for each row execute function private.reject_mutation();

-- Scans are history: never deleted; identity, pinning and source never change;
-- confirmed counts are frozen.
create function private.guard_scan() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'scans are retained history and cannot be deleted';
  end if;
  if new.organization_id <> old.organization_id or new.store_id <> old.store_id
     or new.display_id <> old.display_id or new.pog_version_id <> old.pog_version_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'scan ownership and pinned layout cannot change';
  end if;
  if old.status = 'completed' and (new.status <> 'completed' or new.completed_at <> old.completed_at) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'completed scans cannot change';
  end if;
  if old.status in ('confirmed', 'completed')
     and (new.status not in ('confirmed', 'completed') or new.total_refill is distinct from old.total_refill
          or new.display_score is distinct from old.display_score or new.confirmed_at <> old.confirmed_at) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'confirmed results cannot change';
  end if;
  return new;
end;
$$;

create trigger scans_guard before update or delete on public.scans
  for each row execute function private.guard_scan();

-- Snapshots are fixed at creation; AI observations become immutable once
-- review starts; nothing changes after confirmation.
create function private.guard_scan_slot() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'scan slot rows cannot be deleted';
  end if;
  select status into v_status from public.scans where id = old.scan_id;
  if (new.scan_id, new.pog_version_id, new.pog_slot_id, new.product_id, new.product_name_snapshot,
      new.slot_label_snapshot, new.target_snapshot, new.threshold_snapshot, new.organization_id)
     is distinct from
     (old.scan_id, old.pog_version_id, old.pog_slot_id, old.product_id, old.product_name_snapshot,
      old.slot_label_snapshot, old.target_snapshot, old.threshold_snapshot, old.organization_id) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'scan slot snapshots cannot change';
  end if;
  if v_status in ('needs_review', 'confirmed', 'completed')
     and (new.ai_quantity, new.ai_confidence, new.ai_flags)
         is distinct from (old.ai_quantity, old.ai_confidence, old.ai_flags) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'AI observations cannot change after review starts';
  end if;
  if v_status in ('confirmed', 'completed') then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'confirmed scan slots cannot change';
  end if;
  return new;
end;
$$;

create trigger scan_slots_guard before update or delete on public.scan_slots
  for each row execute function private.guard_scan_slot();

revoke all on function private.guard_scan(), private.guard_scan_slot(), private.touch_updated_at()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.scans enable row level security;
alter table public.scan_slots enable row level security;
alter table public.scan_corrections enable row level security;
alter table public.scan_confirmations enable row level security;

create policy scans_select on public.scans
  for select to authenticated
  using (store_id in (select private.accessible_store_ids((select auth.uid()))));

create policy scan_slots_select on public.scan_slots
  for select to authenticated
  using (exists (
    select 1 from public.scans s
    where s.id = scan_slots.scan_id
      and s.store_id in (select private.accessible_store_ids((select auth.uid())))
  ));

create policy scan_corrections_select on public.scan_corrections
  for select to authenticated
  using (exists (
    select 1 from public.scans s
    where s.id = scan_corrections.scan_id
      and s.store_id in (select private.accessible_store_ids((select auth.uid())))
  ));

create policy scan_confirmations_select on public.scan_confirmations
  for select to authenticated
  using (exists (
    select 1 from public.scans s
    where s.id = scan_confirmations.scan_id
      and s.store_id in (select private.accessible_store_ids((select auth.uid())))
  ));

-- ---------------------------------------------------------------------------
-- Layout data visibility (catalog/POG). Admins and managers read the
-- organization catalog; managers see published versions only; employees see
-- only versions assigned to displays in their stores or pinned by their
-- stores' scans, and the products those versions use.
-- ---------------------------------------------------------------------------

create function private.visible_pog_version_ids(p_user uuid) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select v.id
  from public.pog_versions v
  where private.is_org_admin(p_user, v.organization_id)
     or (v.state = 'published' and private.is_org_manager_or_admin(p_user, v.organization_id))
  union
  select d.active_pog_version_id
  from public.displays d
  where d.active_pog_version_id is not null
    and d.store_id in (select private.accessible_store_ids(p_user))
  union
  select s.pog_version_id
  from public.scans s
  where s.store_id in (select private.accessible_store_ids(p_user));
$$;

revoke all on function private.visible_pog_version_ids(uuid) from public, anon, authenticated;
grant execute on function private.visible_pog_version_ids(uuid) to authenticated, service_role;

create policy pog_versions_select on public.pog_versions
  for select to authenticated
  using (id in (select private.visible_pog_version_ids((select auth.uid()))));

create policy pog_slots_select on public.pog_slots
  for select to authenticated
  using (pog_version_id in (select private.visible_pog_version_ids((select auth.uid()))));

create policy pogs_select on public.pogs
  for select to authenticated
  using (
    private.is_org_manager_or_admin((select auth.uid()), organization_id)
    or exists (
      select 1 from public.pog_versions v
      where v.pog_id = pogs.id
        and v.id in (select private.visible_pog_version_ids((select auth.uid())))
    )
  );

create policy products_select on public.products
  for select to authenticated
  using (
    private.is_org_manager_or_admin((select auth.uid()), organization_id)
    or exists (
      select 1 from public.pog_slots ps
      where ps.product_id = products.id
        and ps.pog_version_id in (select private.visible_pog_version_ids((select auth.uid())))
    )
  );
