-- Feature 02 / migration 6: close race windows found during verification.
--
-- 1. A slot written while publish_pog_version() held the version row could
--    commit into the published version: the slot guard read the version state
--    without a lock, saw 'draft', and the foreign-key check then merely waited
--    for the publisher. The guard now takes FOR SHARE on the version row(s),
--    which conflicts with the publisher's row lock, and checks state after it.
-- 2. Publication validation now locks the slot products FOR SHARE, so a
--    concurrent archive either commits first (and fails publication) or waits.
-- 3. A scan may only pin a published version, whatever role inserts it.

create or replace function private.guard_pog_slot() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Lock before reading state: blocks while a publication of this version is
  -- in flight, then sees its committed result.
  perform 1 from public.pog_versions
   where id in (new.pog_version_id, old.pog_version_id)
   order by id
   for share;
  if exists (
    select 1 from public.pog_versions
    where id in (new.pog_version_id, old.pog_version_id) and state = 'published'
  ) then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'slots of a published POG version cannot change';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function private.assert_publishable(p_version uuid) returns void
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

  -- Hold the products steady until publication commits.
  perform 1 from public.products p
   where p.id in (select s.product_id from public.pog_slots s where s.pog_version_id = p_version)
   order by p.id
   for share;

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

-- Published versions never revert to draft, so no lock is needed here.
create function private.guard_scan_pin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pog_versions where id = new.pog_version_id and state = 'published') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'scans must pin a published POG version';
  end if;
  return new;
end;
$$;

create trigger scans_guard_pin
  before insert on public.scans
  for each row execute function private.guard_scan_pin();

-- CREATE OR REPLACE keeps existing grants; restate them for the new function.
revoke all on function private.guard_scan_pin() from public, anon, authenticated;
