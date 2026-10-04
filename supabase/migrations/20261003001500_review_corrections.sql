-- Feature 10: correction events record whether the person verified the count,
-- so accepting an unchanged estimate is distinguishable from an unverified
-- re-save of the same number. Rows written before this migration keep null
-- ("not recorded"); every new row states true or false.
alter table public.scan_corrections add column verified boolean;
comment on column public.scan_corrections.verified is
  'verified flag of the save that appended this event; null only for rows written before Feature 10';

-- Review routing is server evidence: once review starts, a writer may require
-- review (manual takeover does) but can never clear the requirement.

create or replace function private.guard_scan_slot() returns trigger
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
  if v_status = 'needs_review' and old.review_required and not new.review_required then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'required review cannot be cleared';
  end if;
  if v_status in ('confirmed', 'completed') then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'confirmed scan slots cannot change';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_scan_slot() from public, anon, authenticated;

-- Same contract as Feature 06; the only change is the recorded verified flag.
create or replace function public.mutate_scan_counts(
  p_actor uuid, p_scan_id uuid, p_expected_revision integer, p_action text,
  p_items jsonb, p_key text, p_request_id uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.scans; ss public.scan_slots; i jsonb; v_record public.idempotency_records;
  v_scope text; v_hash text; v_result jsonb; v_unknown text[]; v_total integer; v_score integer;
begin
  select * into s from public.scans where id = p_scan_id for update;
  if not found or not private.has_store_access(p_actor, s.store_id) then
    raise exception 'NOT_FOUND';
  end if;
  if not (s.created_by = p_actor or private.is_org_admin(p_actor, s.organization_id)
    or exists (select 1 from public.store_memberships m where m.user_id = p_actor and m.store_id = s.store_id and m.active and m.role = 'manager')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_action is null or p_action not in ('counts', 'confirm') or p_expected_revision is null or p_expected_revision < 1
    or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
  v_scope := case p_action when 'counts' then 'PATCH /scans/' else 'POST /scans/' end || p_scan_id::text || '/' || p_action;
  v_hash := encode(sha256(convert_to(jsonb_build_object('expected_revision', p_expected_revision, 'items', p_items)::text, 'UTF8')), 'hex');
  delete from public.idempotency_records where actor_id = p_actor and route_scope = v_scope and key = p_key and expires_at < now();
  select * into v_record from public.idempotency_records where actor_id = p_actor and route_scope = v_scope and key = p_key;
  if found then
    if v_record.request_hash <> v_hash then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('payload', v_record.response_body, 'replayed', true);
  end if;
  if s.status <> 'needs_review' or s.revision <> p_expected_revision then raise exception 'CONFLICT'; end if;
  -- Lock children too: a privileged writer must not change a count during confirmation.
  perform 1 from public.scan_slots where scan_id = s.id for update;
  if p_action = 'counts' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'VALIDATION_FAILED'; end if;
    if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
    if (select count(distinct value->>'slot_id') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'VALIDATION_FAILED'; end if;
    for i in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(i) <> 'object' or i - array['slot_id','quantity','verified','reason'] <> '{}'::jsonb
        or not (i ?& array['slot_id','quantity','verified'])
        or jsonb_typeof(i->'quantity') <> 'number' or (i->>'quantity') !~ '^[0-9]+$'
        or (i->>'quantity')::numeric not between 0 and 999
        or jsonb_typeof(i->'verified') <> 'boolean'
        or (i->>'reason' is not null and i->>'reason' not in ('count_corrected','visibility_check','wrong_product','manual_count')) then
        raise exception 'VALIDATION_FAILED';
      end if;
      select * into ss from public.scan_slots where scan_id = s.id and pog_slot_id::text = i->>'slot_id';
      if not found then raise exception 'VALIDATION_FAILED'; end if;
      insert into public.scan_corrections (organization_id, scan_id, scan_slot_id, actor_id, previous_quantity, corrected_quantity, original_ai_quantity, reason, scan_revision, verified)
      values (s.organization_id,s.id,ss.id,p_actor,ss.accepted_quantity,(i->>'quantity')::integer,ss.ai_quantity,i->>'reason',s.revision+1,(i->>'verified')::boolean);
      update public.scan_slots set accepted_quantity = (i->>'quantity')::integer,
        review_state = case when (i->>'verified')::boolean then 'verified' else 'pending' end where id = ss.id;
    end loop;
  else
    if p_items is not null then raise exception 'VALIDATION_FAILED'; end if;
    select array_agg(pog_slot_id::text) into v_unknown from public.scan_slots
      where scan_id = s.id and (accepted_quantity is null or (review_required and review_state <> 'verified'));
    if v_unknown is not null then raise exception 'UNRESOLVED_COUNTS' using detail = array_to_json(v_unknown)::text; end if;
    if not exists (select 1 from public.scan_slots where scan_id = s.id) then raise exception 'UNRESOLVED_COUNTS'; end if;
    -- Recompute from database snapshots inside the lock; no supplied arithmetic.
    update public.scan_slots set final_quantity = accepted_quantity,
      refill_quantity = case when threshold_snapshot is null or accepted_quantity <= threshold_snapshot
        then greatest(0, target_snapshot - accepted_quantity) else 0 end where scan_id = s.id;
    select sum(refill_quantity), round(100 * sum(least(final_quantity,target_snapshot))::numeric / sum(target_snapshot))
      into v_total, v_score from public.scan_slots where scan_id = s.id;
    insert into public.scan_confirmations (organization_id,scan_id,scan_revision,confirmed_by,total_refill,display_score)
      values (s.organization_id,s.id,s.revision+1,p_actor,v_total,v_score);
    insert into public.audit_events (organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
      values (s.organization_id,s.store_id,p_actor,'scan.confirmed',s.id,p_request_id,
        jsonb_build_object('scan_revision',s.revision+1,'total_refill',v_total,'display_score',v_score));
  end if;
  update public.scans set revision = revision+1, updated_at = now(),
    status = case p_action when 'confirm' then 'confirmed' else status end,
    confirmed_at = case p_action when 'confirm' then now() else confirmed_at end,
    total_refill = case p_action when 'confirm' then v_total else total_refill end,
    display_score = case p_action when 'confirm' then v_score else display_score end where id = s.id;
  v_result := private.scan_payload(s.id);
  insert into public.idempotency_records (actor_id,route_scope,key,request_hash,resource_id,response_status,response_body)
    values (p_actor,v_scope,p_key,v_hash,s.id,200,v_result);
  return jsonb_build_object('payload',v_result,'replayed',false);
end;
$$;
revoke all on function public.mutate_scan_counts(uuid,uuid,integer,text,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.mutate_scan_counts(uuid,uuid,integer,text,jsonb,text,uuid) to service_role;
