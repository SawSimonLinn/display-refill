-- Feature 05 / migration 10: POG builder and publication.
--
-- Adds draft versioning (blank or cloned from a published version), full
-- slot-set replacement with revision checks, validated reference images and
-- stricter publication rules. Every function is executable by service_role
-- only, takes the API-verified actor, resolves the organization from the
-- stored row and re-checks the actor (organization admin) itself, as in
-- migration 9 (decision D39). Errors use the API error code as the message
-- and put the offending request field in HINT.
--
-- Reference images (decision D46):
--   * The browser/app uploads to a server-issued, authenticated API staging path
--     {org}/{pog}/{version}/upload-{upload_id}.jpg (upload_intents row,
--     10-minute expiry, no overwrite; POG bytes pass through the API).
--   * The API downloads it, checks the decoded format, size and dimensions,
--     applies EXIF orientation plus the chosen quarter turn and crop,
--     re-encodes without metadata, writes
--     {org}/{pog}/{version}/reference-{upload_id}-{sha256}.jpg, deletes the staging
--     object and calls finalize_pog_reference().
--   * Each validated object is written once and never overwritten. A draft
--     cloned from a published version shares the source's validated object,
--     so reference paths are constrained to the POG's prefix rather than the
--     version's.
--   * Publication requires reference_validated_at, which only
--     finalize_pog_reference() (or a clone of a validated version) sets.
--   * Replacing the reference of a draft that has slots sets
--     slots_need_review; publication is refused until a slot save confirms
--     the coordinates against the new image.

-- ---------------------------------------------------------------------------
-- Schema changes
-- ---------------------------------------------------------------------------

alter table public.pog_versions
  add column reference_upload_id uuid references public.upload_intents (id) on delete restrict,
  add column reference_validated_at timestamptz,
  add column slots_need_review boolean not null default false,
  add column source_version_id uuid,
  add constraint pog_versions_source_fkey foreign key (organization_id, source_version_id)
    references public.pog_versions (organization_id, id) on delete restrict,
  add constraint pog_versions_validated_reference_check
    check (reference_validated_at is null or (reference_path is not null and reference_width is not null and reference_height is not null));

-- Clones share the source's immutable reference object (same POG prefix).
alter table public.pog_versions drop constraint pog_versions_check;
alter table public.pog_versions add constraint pog_versions_reference_path_check
  check (reference_path is null or reference_path like organization_id::text || '/' || pog_id::text || '/%');

-- "One open draft per POG" is enforced by create_pog_version() under the POG
-- row lock, not by a unique index: seed and earlier fixtures build versions
-- as drafts before publishing them.
create index pog_versions_pog_state_idx on public.pog_versions (pog_id, state);

-- POG reference uploads go to a per-upload staging object.
alter table public.upload_intents drop constraint upload_intents_check1;
alter table public.upload_intents add constraint upload_intents_object_path_check check (
  (bucket = 'display-scans' and store_id is not null
    and object_path = organization_id::text || '/' || store_id::text || '/' || resource_id::text || '/capture.jpg')
  or
  (bucket = 'pog-images'
    and object_path ~ ('^' || organization_id::text || '/[0-9a-f-]{36}/' || resource_id::text || '/upload-' || id::text || '\.jpg$'))
);
create index upload_intents_resource_idx on public.upload_intents (resource_id);

-- ---------------------------------------------------------------------------
-- Publication rules (all roles, via the pog_versions_guard trigger)
-- ---------------------------------------------------------------------------

create or replace function private.assert_publishable(p_version uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_count integer;
begin
  select organization_id into v_org from public.pog_versions where id = p_version;

  select count(*) into v_count from public.pog_slots where pog_version_id = p_version;
  if v_count = 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'add at least one slot before publishing', hint = 'slots';
  end if;
  if v_count > 100 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'a published version can have at most 100 slots', hint = 'slots';
  end if;

  -- Hold the products steady until publication commits (migration 6).
  perform 1 from public.products p
   where p.id in (select s.product_id from public.pog_slots s where s.pog_version_id = p_version)
   order by p.id
   for share;

  if exists (
    select 1 from public.pog_slots s
    join public.products p on p.id = s.product_id
    where s.pog_version_id = p_version and (not p.active or p.organization_id <> v_org)
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'every slot product must be an active product of this organization', hint = 'slots';
  end if;

  -- Column checks already enforce these; restated so publication never
  -- depends on a constraint someone later relaxes.
  if exists (
    select 1 from public.pog_slots s
    where s.pog_version_id = p_version
      and not (s.x >= 0 and s.y >= 0 and s.width > 0 and s.height > 0 and s.x + s.width <= 1 and s.y + s.height <= 1)
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'every slot must lie inside the reference crop', hint = 'slots';
  end if;
  if exists (
    select 1 from public.pog_slots s
    where s.pog_version_id = p_version
      and not (s.target_quantity between 1 and 999
               and (s.refill_threshold is null or s.refill_threshold between 0 and s.target_quantity))
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'targets must be 1 to 999 and refill triggers 0 to the target', hint = 'slots';
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
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'slot rectangles overlap', hint = 'slots';
  end if;
end;
$$;

-- Same as migration 2, plus the reference checks, which read NEW so a
-- single UPDATE cannot slip a reference change past them.
create or replace function private.guard_pog_version() returns trigger
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
    if new.reference_path is null or new.reference_validated_at is null then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'upload and validate a reference image before publishing', hint = 'reference_image';
    end if;
    if new.slots_need_review then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001',
        detail = 'the reference image was replaced; review every slot position and confirm it before publishing', hint = 'slots';
    end if;
    perform private.assert_publishable(new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Locks a version for a draft write and checks the actor and state.
-- NOT_FOUND hides other organizations; published versions are IMMUTABLE.
create function private.lock_draft_version(p_actor uuid, p_version_id uuid, p_expected_revision integer) returns public.pog_versions
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
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins edit POG drafts';
  end if;
  if v.state <> 'draft' then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'published POG versions cannot change; create a new draft';
  end if;
  if p_expected_revision is not null and v.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, v.revision);
  end if;
  return v;
end;
$$;

-- A JSON number from a slot, rejected (not rounded) when it has more than
-- six decimal places.
create function private.slot_number(p_slot jsonb, p_key text, p_position integer) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if jsonb_typeof(p_slot -> p_key) is distinct from 'number' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: %s must be a number', p_position, p_key), hint = 'slots';
  end if;
  v := (p_slot ->> p_key)::numeric;
  if v <> round(v, 6) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: %s has more than 6 decimal places', p_position, p_key), hint = 'slots';
  end if;
  return v;
end;
$$;

create function private.slot_integer(p_slot jsonb, p_key text, p_position integer, p_nullable boolean) returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_nullable and (not (p_slot ? p_key) or jsonb_typeof(p_slot -> p_key) = 'null') then
    return null;
  end if;
  if jsonb_typeof(p_slot -> p_key) is distinct from 'number' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: %s must be a whole number', p_position, p_key), hint = 'slots';
  end if;
  v := (p_slot ->> p_key)::numeric;
  if v <> trunc(v) or v < -1000000 or v > 1000000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: %s must be a whole number', p_position, p_key), hint = 'slots';
  end if;
  return v::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft versions
-- ---------------------------------------------------------------------------

-- Next draft of a POG: blank, or a copy of one of its published versions
-- (reference image, dimensions and slots). One draft per POG at a time; the
-- POG row lock serializes numbering, and unique (pog_id, version_number)
-- backs it up.
create function public.create_pog_version(
  p_actor uuid,
  p_pog_id uuid,
  p_source_version_id uuid default null,
  p_request_id uuid default null
) returns public.pog_versions
language plpgsql
set search_path = ''
as $$
declare
  g public.pogs;
  s public.pog_versions;
  v public.pog_versions;
  v_draft integer;
begin
  select * into g from public.pogs where id = p_pog_id for update;
  if not found or not private.is_org_member(p_actor, g.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'POG not found';
  end if;
  if not private.is_org_admin(p_actor, g.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins create POG drafts';
  end if;
  if g.archived then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'the POG is archived; restore it before creating a draft', hint = 'pog_id';
  end if;
  select version_number into v_draft from public.pog_versions where pog_id = g.id and state = 'draft';
  if found then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('version %s is already an open draft', v_draft);
  end if;

  if p_source_version_id is not null then
    -- Published versions never change, so no lock is needed to copy one.
    select * into s from public.pog_versions where id = p_source_version_id and pog_id = g.id and state = 'published';
    if not found then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'choose a published version of this POG', hint = 'source_version_id';
    end if;
  end if;

  insert into public.pog_versions (
    organization_id, pog_id, version_number, created_by, source_version_id,
    reference_path, reference_width, reference_height, reference_upload_id, reference_validated_at
  )
  values (
    g.organization_id, g.id,
    (select coalesce(max(version_number), 0) + 1 from public.pog_versions where pog_id = g.id),
    p_actor, s.id,
    s.reference_path, s.reference_width, s.reference_height, s.reference_upload_id, s.reference_validated_at
  )
  returning * into v;

  if s.id is not null then
    insert into public.pog_slots (
      organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order
    )
    select organization_id, v.id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order
    from public.pog_slots where pog_version_id = s.id;
  end if;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (g.organization_id, p_actor, 'pog_version.created', v.id, p_request_id,
          jsonb_build_object('pog_id', g.id, 'version_number', v.version_number, 'source_version_id', s.id));
  return v;
end;
$$;

-- Replaces a draft's whole slot set. p_slots is an array of
-- { slot_id?, label, product_id, x, y, width, height, target_quantity,
--   refill_threshold?, sort_order }. A slot_id is kept when it already
-- belongs to this draft; otherwise the slot gets a new ID. Drafts may hold
-- overlaps and archived products (publication refuses them); coordinates,
-- quantities, labels and products of other organizations are rejected here.
-- p_confirm_coordinates clears slots_need_review after a reference change.
create function public.replace_pog_slots(
  p_actor uuid,
  p_version_id uuid,
  p_expected_revision integer,
  p_slots jsonb,
  p_confirm_coordinates boolean default false,
  p_request_id uuid default null
) returns public.pog_versions
language plpgsql
set search_path = ''
as $$
declare
  v public.pog_versions;
  e jsonb;
  i integer;
  k text;
  v_label text;
  v_labels text[] := '{}';
  v_ids uuid[] := '{}';
  v_id uuid;
  v_product uuid;
  v_x numeric; v_y numeric; v_w numeric; v_h numeric;
  v_target integer; v_threshold integer; v_order integer;
  v_existing uuid[];
begin
  if p_expected_revision is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is required', hint = 'expected_revision';
  end if;
  v := private.lock_draft_version(p_actor, p_version_id, p_expected_revision);

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'must be a list of slots', hint = 'slots';
  end if;
  if jsonb_array_length(p_slots) > 100 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'a version can have at most 100 slots', hint = 'slots';
  end if;

  select coalesce(array_agg(id), '{}') into v_existing from public.pog_slots where pog_version_id = v.id;
  delete from public.pog_slots where pog_version_id = v.id;

  for e, i in select value, ordinality::integer from jsonb_array_elements(p_slots) with ordinality loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s must be an object', i), hint = 'slots';
    end if;
    for k in select jsonb_object_keys(e) loop
      if not (k = any (array['slot_id', 'label', 'product_id', 'x', 'y', 'width', 'height', 'target_quantity', 'refill_threshold', 'sort_order'])) then
        raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: unknown field %s', i, k), hint = 'slots';
      end if;
    end loop;

    v_label := private.clean_text(e ->> 'label', 'slots', 40);
    if lower(v_label) = any (v_labels) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: label %s is used twice', i, v_label), hint = 'slots';
    end if;
    v_labels := v_labels || lower(v_label);

    v_product := private.uuid_or_null(e -> 'product_id', 'slots');
    if v_product is null or not exists (select 1 from public.products where id = v_product and organization_id = v.organization_id) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: choose a product from this organization', i), hint = 'slots';
    end if;

    v_x := private.slot_number(e, 'x', i);
    v_y := private.slot_number(e, 'y', i);
    v_w := private.slot_number(e, 'width', i);
    v_h := private.slot_number(e, 'height', i);
    if not (v_x >= 0 and v_y >= 0 and v_w > 0 and v_h > 0 and v_x < 1 and v_y < 1 and v_x + v_w <= 1 and v_y + v_h <= 1) then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: the rectangle must lie inside the reference crop', i), hint = 'slots';
    end if;

    v_target := private.slot_integer(e, 'target_quantity', i, false);
    if v_target not between 1 and 999 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: target must be 1 to 999', i), hint = 'slots';
    end if;
    v_threshold := private.slot_integer(e, 'refill_threshold', i, true);
    if v_threshold is not null and v_threshold not between 0 and v_target then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: refill trigger must be 0 to the target', i), hint = 'slots';
    end if;
    v_order := private.slot_integer(e, 'sort_order', i, false);
    if v_order not between 0 and 999 then
      raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = format('slot %s: sort order must be 0 to 999', i), hint = 'slots';
    end if;

    v_id := private.uuid_or_null(e -> 'slot_id', 'slots');
    if v_id is null or not (v_id = any (v_existing)) or v_id = any (v_ids) then
      v_id := gen_random_uuid();
    end if;
    v_ids := v_ids || v_id;

    insert into public.pog_slots (
      id, organization_id, pog_version_id, label, product_id, x, y, width, height, target_quantity, refill_threshold, sort_order
    ) values (
      v_id, v.organization_id, v.id, v_label, v_product, v_x, v_y, v_w, v_h, v_target, v_threshold, v_order
    );
  end loop;

  -- Always touch the version: its revision is the draft's concurrency token.
  update public.pog_versions
     set slots_need_review = slots_need_review and not coalesce(p_confirm_coordinates, false)
   where id = v.id
  returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (v.organization_id, p_actor, 'pog_version.slots_saved', v.id, p_request_id,
          jsonb_build_object('slot_count', jsonb_array_length(p_slots), 'coordinates_confirmed', coalesce(p_confirm_coordinates, false),
                             'slots_need_review', v.slots_need_review));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference image upload
-- ---------------------------------------------------------------------------

-- Issues a write-once staging path for a draft's new reference image. The
-- API returns an authenticated byte-upload URL. At most five unexpired pending
-- uploads per version.
create function public.create_pog_upload_intent(
  p_actor uuid,
  p_version_id uuid,
  p_request_id uuid default null
) returns public.upload_intents
language plpgsql
set search_path = ''
as $$
declare
  v public.pog_versions;
  u public.upload_intents;
  v_id uuid := gen_random_uuid();
begin
  v := private.lock_draft_version(p_actor, p_version_id, null);

  update public.upload_intents
     set state = 'expired'
   where resource_id = v.id and bucket = 'pog-images' and state = 'pending' and expires_at <= now();
  if (select count(*) from public.upload_intents where resource_id = v.id and bucket = 'pog-images' and state = 'pending') >= 5 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'too many uploads in progress for this draft; finish one or wait 10 minutes', hint = 'file';
  end if;

  insert into public.upload_intents (id, organization_id, actor_id, resource_id, bucket, object_path, expires_at, expected_type, max_bytes)
  values (v_id, v.organization_id, p_actor, v.id, 'pog-images',
          v.organization_id::text || '/' || v.pog_id::text || '/' || v.id::text || '/upload-' || v_id::text || '.jpg',
          now() + interval '10 minutes', 'image/jpeg', 10485760)
  returning * into u;
  return u;
end;
$$;

-- Records a reference image the API has validated and written to the
-- validated path for this upload. The upload must be the actor's own,
-- pending and unexpired. Replacing the image of a draft that has slots
-- requires every slot to be reviewed again before publication.
create function public.finalize_pog_reference(
  p_actor uuid,
  p_version_id uuid,
  p_expected_revision integer,
  p_upload_id uuid,
  p_width integer,
  p_height integer,
  p_sha256 text,
  p_request_id uuid default null
) returns public.pog_versions
language plpgsql
set search_path = ''
as $$
declare
  v public.pog_versions;
  u public.upload_intents;
  v_path text;
  v_has_slots boolean;
  v_previous text;
begin
  if p_expected_revision is null then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'is required', hint = 'expected_revision';
  end if;
  v := private.lock_draft_version(p_actor, p_version_id, p_expected_revision);

  select * into u from public.upload_intents
   where id = p_upload_id and resource_id = v.id and bucket = 'pog-images' and organization_id = v.organization_id
   for update;
  if not found or u.actor_id <> p_actor then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'unknown upload for this draft', hint = 'upload_id';
  end if;
  if u.state <> 'pending' then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('upload is already %s', u.state);
  end if;
  if u.expires_at <= now() then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'the upload expired; upload the image again', hint = 'upload_id';
  end if;
  if p_width is null or p_height is null or p_width not between 1 and 4096 or p_height not between 1 and 4096 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'image dimensions must be 1 to 4096 pixels', hint = 'file';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'invalid validated image digest', hint = 'file';
  end if;
  v_path := regexp_replace(u.object_path, '/upload-([0-9a-f-]{36})\.jpg$', '/reference-\1-' || p_sha256 || '.jpg');
  select exists (select 1 from public.pog_slots where pog_version_id = v.id) into v_has_slots;
  v_previous := v.reference_path;

  update public.upload_intents set state = 'validated' where id = u.id;
  update public.pog_versions
     set reference_path = v_path, reference_width = p_width, reference_height = p_height,
         reference_upload_id = u.id, reference_validated_at = now(),
         slots_need_review = slots_need_review or v_has_slots
   where id = v.id
  returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (v.organization_id, p_actor,
          case when v_previous is null then 'pog_version.reference_set' else 'pog_version.reference_replaced' end,
          v.id, p_request_id,
          jsonb_build_object('upload_id', u.id, 'width', p_width, 'height', p_height, 'slots_need_review', v.slots_need_review));
  return v;
end;
$$;

-- Marks the actor's pending upload rejected (content failed validation) or
-- expired. The API deletes the staging object.
create function public.settle_pog_upload(
  p_actor uuid,
  p_upload_id uuid,
  p_state text
) returns public.upload_intents
language plpgsql
set search_path = ''
as $$
declare
  u public.upload_intents;
begin
  if p_state is null or p_state not in ('rejected', 'expired') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'state must be rejected or expired', hint = 'state';
  end if;
  select * into u from public.upload_intents where id = p_upload_id and bucket = 'pog-images' for update;
  if not found or u.actor_id <> p_actor or not private.is_org_admin(p_actor, u.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'upload not found';
  end if;
  if u.state <> 'pending' then
    return u;
  end if;
  update public.upload_intents set state = p_state where id = u.id returning * into u;
  return u;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (CREATE OR REPLACE keeps existing grants).
-- ---------------------------------------------------------------------------

revoke all on function
  private.lock_draft_version(uuid, uuid, integer),
  private.slot_number(jsonb, text, integer),
  private.slot_integer(jsonb, text, integer, boolean),
  public.create_pog_version(uuid, uuid, uuid, uuid),
  public.replace_pog_slots(uuid, uuid, integer, jsonb, boolean, uuid),
  public.create_pog_upload_intent(uuid, uuid, uuid),
  public.finalize_pog_reference(uuid, uuid, integer, uuid, integer, integer, text, uuid),
  public.settle_pog_upload(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  private.lock_draft_version(uuid, uuid, integer),
  private.slot_number(jsonb, text, integer),
  private.slot_integer(jsonb, text, integer, boolean),
  public.create_pog_version(uuid, uuid, uuid, uuid),
  public.replace_pog_slots(uuid, uuid, integer, jsonb, boolean, uuid),
  public.create_pog_upload_intent(uuid, uuid, uuid),
  public.finalize_pog_reference(uuid, uuid, integer, uuid, integer, integer, text, uuid),
  public.settle_pog_upload(uuid, uuid, text)
to service_role;
