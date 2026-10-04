-- Feature 09: durable analysis queue, leases, fenced result writes, explicit
-- retry and manual takeover (context/scan-lifecycle.md, vision-contract.md).
-- Every function is service-role only. Worker writes are conditional on the
-- current lease token AND the scan's job generation; locks are always taken
-- scan row first, then job row, so claim/finish/takeover cannot deadlock.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.scans
  add column failure_code text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  -- Scan-level AI evidence (alignment, image flags, provider/model/prompt/policy
  -- versions). Written once when validated detections are committed.
  add column ai_summary jsonb check (ai_summary is null or jsonb_typeof(ai_summary) = 'object'),
  add column manual_takeover_at timestamptz,
  add column manual_takeover_by uuid references auth.users (id) on delete restrict,
  add constraint scans_failure_code_state check ((status = 'failed') = (failure_code is not null)),
  add constraint scans_takeover_pair check ((manual_takeover_at is null) = (manual_takeover_by is null));

-- A photo taken over manually keeps its image for audit while source becomes manual.
alter table public.scans drop constraint scans_check1;
alter table public.scans add constraint scans_image_source_check
  check (source = 'photo' or image_path is null or manual_takeover_at is not null);

alter table public.scan_attempts
  add column job_id uuid references public.scan_jobs (id) on delete restrict,
  add column lease_token uuid,
  add column error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  add column policy_version text check (policy_version is null or length(policy_version) between 1 and 64),
  add column confidence_threshold numeric check (confidence_threshold is null or confidence_threshold between 0 and 1);
alter table public.scan_attempts drop constraint scan_attempts_outcome_check;
alter table public.scan_attempts add constraint scan_attempts_outcome_check check (outcome in (
  'in_progress', 'succeeded', 'invalid_output', 'provider_error', 'input_error', 'timeout', 'cancelled', 'superseded'));
create unique index scan_attempts_lease_idx on public.scan_attempts (job_id, lease_token);

-- AI summary, like slot AI observations, never changes once recorded.
create function private.guard_scan_ai_summary() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ai_summary is not null and new.ai_summary is distinct from old.ai_summary then
    raise exception 'IMMUTABLE' using errcode = 'P0001', detail = 'AI summary cannot change';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_scan_ai_summary() from public, anon, authenticated;
create trigger scans_ai_summary_immutable before update on public.scans
  for each row execute function private.guard_scan_ai_summary();

-- Terminal worker transition shared by claim (lease expiry/unusable input) and finish.
create function private.fail_scan_job(p_scan uuid, p_job uuid, p_code text) returns void
language plpgsql set search_path = '' as $$
declare s public.scans;
begin
  update public.scan_jobs set state = 'failed', lease_token = null, lease_until = null, last_error_code = p_code where id = p_job;
  update public.scans set status = 'failed', failure_code = p_code, revision = revision + 1 where id = p_scan returning * into s;
  insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, metadata)
  values (s.organization_id, s.store_id, null, 'scan.analysis_failed', s.id,
          jsonb_build_object('failure_code', p_code, 'generation', s.job_generation));
end;
$$;
revoke all on function private.fail_scan_job(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim: due queued jobs and expired leases. Per-store serialization enforces
-- at most two live leases per store across worker processes; a store at
-- capacity is skipped while other stores continue. Three provider attempts
-- per generation; a lease that expires on the last attempt fails the scan.
-- ---------------------------------------------------------------------------
create function public.claim_scan_job(
  p_provider text, p_model text, p_prompt_version text, p_schema_version integer,
  p_policy_version text, p_confidence_threshold numeric
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  c record; s public.scans; j public.scan_jobs; v public.pog_versions; v_token uuid; v_attempt uuid; v_live integer;
begin
  if p_provider is null or length(p_provider) not between 1 and 64 or p_model is null or length(p_model) not between 1 and 128
     or p_prompt_version is null or length(p_prompt_version) not between 1 and 64 or p_schema_version is distinct from 1
     or p_policy_version is null or length(p_policy_version) not between 1 and 64
     or p_confidence_threshold is null or p_confidence_threshold not between 0 and 1 then
    raise exception 'VALIDATION_FAILED';
  end if;
  for c in
    select j2.id, j2.scan_id, s2.store_id from public.scan_jobs j2 join public.scans s2 on s2.id = j2.scan_id
    where (j2.state = 'queued' and j2.available_at <= now()) or (j2.state = 'running' and j2.lease_until < now())
    order by j2.available_at, j2.id
    limit 50
  loop
    perform pg_advisory_xact_lock(hashtextextended('scan-store-claim:' || c.store_id::text, 0));
    select * into s from public.scans where id = c.scan_id for update skip locked;
    if not found then continue; end if;
    select * into j from public.scan_jobs where id = c.id
      and ((state = 'queued' and available_at <= now()) or (state = 'running' and lease_until < now()))
      for update skip locked;
    if not found then continue; end if;

    if j.generation <> s.job_generation or s.status not in ('queued', 'processing') then
      update public.scan_jobs set state = 'cancelled', lease_token = null, lease_until = null where id = j.id;
      continue;
    end if;
    select count(*) into v_live from public.scan_jobs j3 join public.scans s3 on s3.id = j3.scan_id
      where s3.store_id = c.store_id and j3.state = 'running' and j3.lease_until >= now() and j3.id <> j.id;
    if v_live >= 2 then continue; end if;

    if j.state = 'running' then
      -- The previous holder died or stalled: close its attempt; its token is now stale.
      update public.scan_attempts set outcome = 'timeout', error_code = 'LEASE_EXPIRED', ended_at = now()
        where job_id = j.id and lease_token = j.lease_token and outcome = 'in_progress';
      if j.attempt_count >= 3 then
        perform private.fail_scan_job(s.id, j.id, 'ANALYSIS_TIMEOUT');
        continue;
      end if;
    end if;
    if s.image_path is null or s.image_deleted_at is not null then
      perform private.fail_scan_job(s.id, j.id, 'IMAGE_UNAVAILABLE');
      continue;
    end if;

    v_token := gen_random_uuid();
    update public.scan_jobs set state = 'running', attempt_count = attempt_count + 1, lease_token = v_token,
      lease_until = now() + interval '90 seconds' where id = j.id returning * into j;
    if s.status = 'queued' then
      update public.scans set status = 'processing', revision = revision + 1 where id = s.id returning * into s;
    end if;
    insert into public.scan_attempts (organization_id, scan_id, generation, attempt_number, provider, model, prompt_version,
      schema_version, started_at, outcome, job_id, lease_token, policy_version, confidence_threshold)
    values (s.organization_id, s.id, j.generation, j.attempt_count, p_provider, p_model, p_prompt_version,
      p_schema_version, now(), 'in_progress', j.id, v_token, p_policy_version, p_confidence_threshold)
    returning id into v_attempt;
    select * into v from public.pog_versions where id = s.pog_version_id;
    -- Targets and thresholds are deliberately excluded from the provider input.
    return jsonb_build_object(
      'job_id', j.id, 'lease_token', v_token, 'generation', j.generation, 'attempt_number', j.attempt_count,
      'attempt_id', v_attempt, 'lease_until', j.lease_until,
      'scan_id', s.id, 'organization_id', s.organization_id, 'store_id', s.store_id,
      'image_path', s.image_path, 'image_width', (s.crop_json->>'width')::integer, 'image_height', (s.crop_json->>'height')::integer,
      'reference_path', v.reference_path, 'reference_width', v.reference_width, 'reference_height', v.reference_height,
      'slots', (select jsonb_agg(jsonb_build_object(
          'slot_id', ps.id, 'label', ss.slot_label_snapshot, 'x', ps.x, 'y', ps.y, 'width', ps.width, 'height', ps.height,
          'product_name', ss.product_name_snapshot, 'container_type', p.container_type, 'category', p.category)
          order by ps.sort_order, ps.id)
        from public.scan_slots ss
        join public.pog_slots ps on ps.id = ss.pog_slot_id and ps.pog_version_id = ss.pog_version_id
        join public.products p on p.id = ss.product_id
        where ss.scan_id = s.id));
  end loop;
  return null;
end;
$$;

-- Extends a live lease. False means the worker has been fenced and must stop.
create function public.heartbeat_scan_job(p_job uuid, p_lease uuid) returns boolean
language plpgsql set search_path = '' as $$
declare v_ok boolean;
begin
  update public.scan_jobs j set lease_until = now() + interval '90 seconds'
  from public.scans s
  where j.id = p_job and j.lease_token = p_lease and j.state = 'running'
    and s.id = j.scan_id and s.job_generation = j.generation and s.status = 'processing'
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish one attempt. Attempt evidence (latency/usage/input hash) is always
-- recorded. Job/scan changes require the current lease token and generation;
-- otherwise the result is 'fenced' and the attempt is marked superseded.
-- Success commits detections, scan state and job success in one transaction,
-- recomputing review routing from the normalized values (never trusting a
-- supplied review flag).
-- ---------------------------------------------------------------------------
create function public.finish_scan_attempt(
  p_job uuid, p_lease uuid, p_outcome text, p_error_code text default null, p_retryable boolean default false,
  p_retry_after_seconds integer default null, p_result jsonb default null, p_latency_ms integer default null,
  p_usage jsonb default null, p_input jsonb default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.scans; j public.scan_jobs; a public.scan_attempts; e jsonb; v_scan uuid; v_fenced boolean;
  v_pinned integer; v_alignment text; v_flags jsonb; v_delay numeric; v_prior_invalid boolean;
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'invalid_output', 'provider_error', 'input_error', 'timeout')
     or (p_outcome = 'succeeded') <> (p_result is not null)
     or (p_outcome <> 'succeeded' and (p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$'))
     or (p_usage is not null and jsonb_typeof(p_usage) <> 'object')
     or (p_latency_ms is not null and p_latency_ms < 0)
     or (p_retry_after_seconds is not null and p_retry_after_seconds < 0)
     or (p_input is not null and (jsonb_typeof(p_input) <> 'object' or p_input - array['width','height','sha256'] <> '{}'::jsonb)) then
    raise exception 'VALIDATION_FAILED';
  end if;
  select scan_id into v_scan from public.scan_jobs where id = p_job;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into s from public.scans where id = v_scan for update;
  select * into j from public.scan_jobs where id = p_job for update;
  select * into a from public.scan_attempts where job_id = p_job and lease_token = p_lease for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_fenced := j.state <> 'running' or j.lease_token is distinct from p_lease
    or j.generation <> s.job_generation or s.status <> 'processing';

  update public.scan_attempts set
    ended_at = coalesce(ended_at, now()),
    latency_ms = coalesce(latency_ms, p_latency_ms),
    usage_json = coalesce(usage_json, p_usage),
    input_width = coalesce(input_width, (p_input->>'width')::integer),
    input_height = coalesce(input_height, (p_input->>'height')::integer),
    input_sha256 = coalesce(input_sha256, p_input->>'sha256'),
    normalized_response = case when p_outcome = 'succeeded' then coalesce(normalized_response, p_result) else normalized_response end,
    error_code = case when outcome <> 'in_progress' then error_code when v_fenced then 'FENCED' else p_error_code end,
    outcome = case when outcome <> 'in_progress' then outcome when v_fenced then 'superseded' else p_outcome end
  where id = a.id;
  if v_fenced then
    return jsonb_build_object('status', 'fenced');
  end if;

  if p_outcome = 'succeeded' then
    v_alignment := p_result->>'alignment';
    v_flags := p_result->'image_flags';
    select count(*) into v_pinned from public.scan_slots where scan_id = s.id;
    if jsonb_typeof(p_result) <> 'object' or p_result - array['schema_version','alignment','image_flags','slots'] <> '{}'::jsonb
       or v_alignment is null or v_alignment not in ('good', 'uncertain', 'poor')
       or coalesce(jsonb_typeof(v_flags), 'missing') <> 'array'
       or exists (select 1 from jsonb_array_elements_text(v_flags) f where f not in ('blur','dark','glare','cropped','occluded'))
       or coalesce(jsonb_typeof(p_result->'slots'), 'missing') <> 'array' or jsonb_array_length(p_result->'slots') <> v_pinned
       or (select count(distinct x->>'slot_id') from jsonb_array_elements(p_result->'slots') x) <> v_pinned
       or exists (select 1 from jsonb_array_elements(p_result->'slots') x
                  where not exists (select 1 from public.scan_slots ss where ss.scan_id = s.id and ss.pog_slot_id::text = x->>'slot_id')) then
      raise exception 'VALIDATION_FAILED' using detail = 'normalized result must cover exactly the pinned slots';
    end if;
    for e in select value from jsonb_array_elements(p_result->'slots') loop
      if jsonb_typeof(e) <> 'object' or e - array['slot_id','quantity','confidence','flags','review_required'] <> '{}'::jsonb
         or coalesce(jsonb_typeof(e->'quantity'), 'missing') not in ('null', 'number')
         or coalesce(jsonb_typeof(e->'confidence'), 'missing') not in ('null', 'number')
         or coalesce(jsonb_typeof(e->'flags'), 'missing') <> 'array'
         or (jsonb_typeof(e->'quantity') = 'number' and ((e->>'quantity') !~ '^[0-9]+$' or (e->>'quantity')::numeric > 999))
         or (jsonb_typeof(e->'confidence') = 'number' and (e->>'confidence')::numeric not between 0 and 1)
         or exists (select 1 from jsonb_array_elements_text(e->'flags') f
                    where f not in ('occluded','wrong_product','out_of_frame','ambiguous','low_visibility'))
         -- Uncertain/poor alignment forces unknown; a known count would be blind coordinate multiplication.
         or (v_alignment <> 'good' and jsonb_typeof(e->'quantity') <> 'null') then
        raise exception 'VALIDATION_FAILED' using detail = 'invalid normalized slot';
      end if;
    end loop;
    perform 1 from public.scan_slots where scan_id = s.id for update;
    update public.scan_slots ss set
      ai_quantity = (x->>'quantity')::integer,
      ai_confidence = (x->>'confidence')::numeric,
      ai_flags = array(select jsonb_array_elements_text(x->'flags')),
      accepted_quantity = (x->>'quantity')::integer,
      review_required = jsonb_typeof(x->'quantity') = 'null' or jsonb_typeof(x->'confidence') = 'null'
        or (x->>'confidence')::numeric < a.confidence_threshold or jsonb_array_length(x->'flags') > 0
        or v_alignment <> 'good' or jsonb_array_length(v_flags) > 0,
      review_state = 'pending'
    from jsonb_array_elements(p_result->'slots') x
    where ss.scan_id = s.id and ss.pog_slot_id::text = x->>'slot_id';
    update public.scan_jobs set state = 'succeeded', lease_token = null, lease_until = null, last_error_code = null where id = j.id;
    update public.scans set status = 'needs_review', revision = revision + 1, failure_code = null,
      ai_summary = jsonb_build_object('alignment', v_alignment, 'image_flags', v_flags, 'provider', a.provider, 'model', a.model,
        'prompt_version', a.prompt_version, 'schema_version', a.schema_version, 'policy_version', a.policy_version,
        'confidence_threshold', a.confidence_threshold, 'generation', j.generation, 'attempt_number', a.attempt_number)
    where id = s.id;
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, metadata)
    values (s.organization_id, s.store_id, null, 'scan.analysis_completed', s.id,
            jsonb_build_object('generation', j.generation, 'attempt_number', a.attempt_number, 'alignment', v_alignment));
    return jsonb_build_object('status', 'committed');
  end if;

  -- Schema-invalid output gets one retry inside the same three-attempt budget.
  v_prior_invalid := exists (select 1 from public.scan_attempts where job_id = j.id and outcome = 'invalid_output' and id <> a.id);
  if coalesce(p_retryable, false) and j.attempt_count < 3 and not (p_outcome = 'invalid_output' and v_prior_invalid) then
    -- 5 s then 20 s, up to 25% jitter; honor a longer Retry-After up to 5 minutes.
    v_delay := (case when j.attempt_count <= 1 then 5 else 20 end) * (1 + random() * 0.25);
    v_delay := greatest(v_delay, least(coalesce(p_retry_after_seconds, 0), 300));
    update public.scan_jobs set state = 'queued', lease_token = null, lease_until = null,
      available_at = now() + make_interval(secs => v_delay), last_error_code = p_error_code where id = j.id;
    update public.scans set status = 'queued', revision = revision + 1 where id = s.id;
    return jsonb_build_object('status', 'requeued', 'retry_in_seconds', round(v_delay, 1));
  end if;
  perform private.fail_scan_job(s.id, j.id, p_error_code);
  return jsonb_build_object('status', 'failed', 'failure_code', p_error_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Human actions: explicit retry (failed photo scans, two extra generations)
-- and manual takeover (awaiting_upload/queued/processing/failed). Takeover
-- increments the generation before cancelling jobs so any in-flight worker is
-- fenced; AI evidence and the image stay for audit; counts start unknown.
-- ---------------------------------------------------------------------------
create function public.scan_analysis_action(
  p_actor uuid, p_action text, p_scan uuid, p_expected_revision integer, p_key text, p_request_id uuid default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.scans; r public.idempotency_records; v_scope text; v_hash text; v_payload jsonb;
begin
  if p_action is null or p_action not in ('retry', 'takeover') or p_expected_revision is null or p_expected_revision < 1
     or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then
    raise exception 'VALIDATION_FAILED';
  end if;
  select * into s from public.scans where id = p_scan for update;
  if not found or not private.has_store_access(p_actor, s.store_id) then raise exception 'NOT_FOUND'; end if;
  if not (s.created_by = p_actor or private.is_store_manager(p_actor, s.store_id)) then raise exception 'FORBIDDEN'; end if;
  v_scope := 'POST /scans/' || s.id::text || '/' || case p_action when 'retry' then 'retry' else 'manual-takeover' end;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || v_scope || p_key, 0));
  v_hash := encode(sha256(convert_to(jsonb_build_object('expected_revision', p_expected_revision)::text, 'UTF8')), 'hex');
  delete from public.idempotency_records where actor_id = p_actor and route_scope = v_scope and key = p_key and expires_at < now();
  select * into r from public.idempotency_records where actor_id = p_actor and route_scope = v_scope and key = p_key;
  if found then
    if r.request_hash <> v_hash then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('payload', r.response_body, 'replayed', true);
  end if;
  if s.revision <> p_expected_revision then raise exception 'CONFLICT' using detail = 'stale revision'; end if;

  if p_action = 'retry' then
    if s.status <> 'failed' or s.source <> 'photo' or s.image_path is null or s.image_deleted_at is not null then
      raise exception 'CONFLICT' using detail = 'only failed photo scans with a retained image can be retried';
    end if;
    if s.retry_generation_count >= 2 then raise exception 'CONFLICT' using detail = 'RETRY_LIMIT'; end if;
    update public.scans set job_generation = job_generation + 1, retry_generation_count = retry_generation_count + 1,
      status = 'queued', failure_code = null, revision = revision + 1 where id = s.id returning * into s;
    insert into public.scan_jobs (organization_id, scan_id, generation) values (s.organization_id, s.id, s.job_generation);
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
    values (s.organization_id, s.store_id, p_actor, 'scan.analysis_retried', s.id, p_request_id,
            jsonb_build_object('generation', s.job_generation, 'retry_generation_count', s.retry_generation_count));
  else
    if s.status not in ('awaiting_upload', 'queued', 'processing', 'failed') then
      raise exception 'CONFLICT' using detail = 'review has already started';
    end if;
    update public.scans set job_generation = job_generation + 1, status = 'needs_review', source = 'manual',
      failure_code = null, manual_takeover_at = now(), manual_takeover_by = p_actor, revision = revision + 1
    where id = s.id returning * into s;
    update public.scan_jobs set state = 'cancelled', lease_token = null, lease_until = null
      where scan_id = s.id and state in ('queued', 'running');
    update public.scan_attempts set outcome = 'cancelled', error_code = 'MANUAL_TAKEOVER', ended_at = now()
      where scan_id = s.id and outcome = 'in_progress';
    update public.scan_slots set accepted_quantity = null, review_required = true, review_state = 'pending' where scan_id = s.id;
    update public.upload_intents set state = 'expired' where resource_id = s.id and bucket = 'display-scans' and state = 'pending';
    insert into public.audit_events (organization_id, store_id, actor_id, event_type, resource_id, request_id, metadata)
    values (s.organization_id, s.store_id, p_actor, 'scan.manual_takeover', s.id, p_request_id,
            jsonb_build_object('generation', s.job_generation, 'scan_revision', s.revision));
  end if;
  v_payload := private.scan_payload(s.id);
  insert into public.idempotency_records (actor_id, route_scope, key, request_hash, resource_id, response_status, response_body)
  values (p_actor, v_scope, p_key, v_hash, s.id, 200, v_payload);
  return jsonb_build_object('payload', v_payload, 'replayed', false);
end;
$$;

revoke all on function private.fail_scan_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.fail_scan_job(uuid, uuid, text) to service_role;
revoke all on function public.claim_scan_job(text, text, text, integer, text, numeric) from public, anon, authenticated;
revoke all on function public.heartbeat_scan_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_scan_attempt(uuid, uuid, text, text, boolean, integer, jsonb, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.scan_analysis_action(uuid, text, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_scan_job(text, text, text, integer, text, numeric) to service_role;
grant execute on function public.heartbeat_scan_job(uuid, uuid) to service_role;
grant execute on function public.finish_scan_attempt(uuid, uuid, text, text, boolean, integer, jsonb, integer, jsonb, jsonb) to service_role;
grant execute on function public.scan_analysis_action(uuid, text, uuid, integer, text, uuid) to service_role;
