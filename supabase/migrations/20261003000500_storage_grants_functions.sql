-- Feature 02 / migration 5: private storage buckets, client grant lockdown
-- and the trusted transactional functions for POG publication and scan
-- snapshot creation.

-- ---------------------------------------------------------------------------
-- Storage: two private buckets. No storage.objects policies are created for
-- them, so anon and authenticated can neither list, read, write nor delete.
-- Uploads use server-issued signed upload URLs bound to an upload_intents
-- path; downloads use short-lived signed URLs issued after an access check.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('display-scans', 'display-scans', false, 10485760, array['image/jpeg']),
  ('pog-images', 'pog-images', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants ALL on public objects to anon/authenticated by
-- default; replace that with explicit, minimal grants. RLS still applies on
-- top of SELECT. Future objects receive no client grants unless a migration
-- adds them deliberately.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

grant select on
  public.organizations,
  public.profiles,
  public.organization_memberships,
  public.stores,
  public.store_memberships,
  public.products,
  public.pogs,
  public.pog_versions,
  public.pog_slots,
  public.displays,
  public.scans,
  public.scan_slots,
  public.scan_corrections,
  public.scan_confirmations,
  public.audit_events
to authenticated;

-- ---------------------------------------------------------------------------
-- Trusted transactional functions.
--
-- Executable only by service_role (the API after it has verified the
-- caller's token). p_actor is that verified identity; each function still
-- re-checks membership and tenant relationships itself, because the service
-- role bypasses RLS. Errors use the API error code as the message:
-- NOT_FOUND, FORBIDDEN, CONFLICT, VALIDATION_FAILED, POG_NOT_ASSIGNED,
-- POG_CHANGED; details are safe to log.
-- ---------------------------------------------------------------------------

create function public.publish_pog_version(
  p_actor uuid,
  p_version_id uuid,
  p_expected_revision integer,
  p_request_id uuid default null
) returns public.pog_versions
language plpgsql
set search_path = ''
as $$
declare
  v public.pog_versions;
begin
  select * into v from public.pog_versions where id = p_version_id for update;
  if not found or not private.is_org_member(p_actor, v.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'POG version not found';
  end if;
  if not private.is_org_admin(p_actor, v.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins publish POG versions';
  end if;
  if v.state = 'published' then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = 'version is already published';
  end if;
  if v.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, v.revision);
  end if;
  if exists (select 1 from public.pogs where id = v.pog_id and archived) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'POG is archived';
  end if;

  -- The pog_versions_guard trigger validates slot count, products and overlap.
  update public.pog_versions
     set state = 'published', published_at = now(), published_by = p_actor
   where id = p_version_id
  returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (v.organization_id, p_actor, 'pog_version.published', v.id, p_request_id,
          jsonb_build_object('pog_id', v.pog_id, 'version_number', v.version_number));

  return v;
end;
$$;

create function public.create_scan(
  p_actor uuid,
  p_display_id uuid,
  p_source text,
  p_expected_pog_version_id uuid default null
) returns table (
  scan_id uuid,
  status text,
  revision integer,
  pog_version_id uuid,
  slot_count integer,
  upload_bucket text,
  upload_object_path text,
  upload_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_display public.displays;
  v_store public.stores;
  v_scan public.scans;
  v_slots integer;
  v_path text;
  v_expires timestamptz;
begin
  if p_source is null or p_source not in ('photo', 'manual') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'source must be photo or manual';
  end if;

  -- FOR SHARE holds the display's POG assignment stable until commit.
  select * into v_display from public.displays d where d.id = p_display_id for share;
  if not found or not private.has_store_access(p_actor, v_display.store_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'display not found';
  end if;

  select * into v_store from public.stores s where s.id = v_display.store_id for share;
  if not v_display.active or not v_store.active then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'display or store is archived';
  end if;
  if v_display.active_pog_version_id is null then
    raise exception 'POG_NOT_ASSIGNED' using errcode = 'P0001', detail = 'display has no published POG';
  end if;
  if p_expected_pog_version_id is not null and p_expected_pog_version_id <> v_display.active_pog_version_id then
    raise exception 'POG_CHANGED' using errcode = 'P0001', detail = 'display POG changed; refresh before scanning';
  end if;

  insert into public.scans (organization_id, store_id, display_id, pog_version_id, created_by, source, status)
  values (v_display.organization_id, v_display.store_id, v_display.id, v_display.active_pog_version_id, p_actor,
          p_source, case p_source when 'manual' then 'needs_review' else 'awaiting_upload' end)
  returning * into v_scan;

  -- One row per pinned slot. Every slot starts unknown and requires review;
  -- the worker may later record AI observations for photo scans.
  insert into public.scan_slots (
    organization_id, scan_id, pog_version_id, pog_slot_id, product_id,
    product_name_snapshot, slot_label_snapshot, target_snapshot, threshold_snapshot
  )
  select v_scan.organization_id, v_scan.id, ps.pog_version_id, ps.id, ps.product_id,
         p.name, ps.label, ps.target_quantity, ps.refill_threshold
  from public.pog_slots ps
  join public.products p on p.id = ps.product_id and p.organization_id = ps.organization_id
  where ps.pog_version_id = v_scan.pog_version_id
  order by ps.sort_order, ps.label;
  get diagnostics v_slots = row_count;

  if p_source = 'photo' then
    v_path := v_scan.organization_id::text || '/' || v_scan.store_id::text || '/' || v_scan.id::text || '/capture.jpg';
    v_expires := now() + interval '10 minutes';
    insert into public.upload_intents (
      organization_id, store_id, actor_id, resource_id, bucket, object_path, expires_at, expected_type, max_bytes
    ) values (
      v_scan.organization_id, v_scan.store_id, p_actor, v_scan.id, 'display-scans', v_path, v_expires, 'image/jpeg', 10485760
    );
  end if;

  return query select v_scan.id, v_scan.status, v_scan.revision, v_scan.pog_version_id, v_slots,
    case when p_source = 'photo' then 'display-scans' end, v_path, v_expires;
end;
$$;

revoke all on function public.publish_pog_version(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.create_scan(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_pog_version(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.create_scan(uuid, uuid, text, uuid) to service_role;
