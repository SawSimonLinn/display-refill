-- Service-only operational state; no client or tenant-facing administration surface.
create table public.operation_settings (
 singleton boolean primary key default true check(singleton),
 vision_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into public.operation_settings default values;
alter table public.operation_settings enable row level security;
revoke all on public.operation_settings from anon, authenticated;
grant all on public.operation_settings to service_role;

create table public.image_cleanup_jobs (
 id uuid primary key default gen_random_uuid(),
 bucket text not null check(bucket in ('display-scans','pog-images')),
 object_path text not null,
 scan_id uuid references public.scans(id) on delete restrict,
 reason text not null check(reason in ('retention','abandoned')),
 state text not null default 'pending' check(state in ('pending','running','succeeded')),
 attempts integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 available_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 last_error_code text,
 unique(bucket,object_path)
);
alter table public.image_cleanup_jobs enable row level security;
revoke all on public.image_cleanup_jobs from anon, authenticated;
grant all on public.image_cleanup_jobs to service_role;
create index image_cleanup_due on public.image_cleanup_jobs(available_at) where state <> 'succeeded';

-- The switch also guards claims from independent worker processes.
create function private.vision_claim_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='running' and (old.state <> 'running' or new.lease_token is distinct from old.lease_token)
 and not (select vision_enabled from public.operation_settings where singleton) then
 raise exception 'VISION_DISABLED';
 end if;
 return new;
end $$;
create trigger vision_claim_guard before update on public.scan_jobs for each row execute function private.vision_claim_guard();

create function public.prepare_image_cleanup(p_days integer default 90, p_batch integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare scan_record public.scans; n integer := 0;
begin
 if p_days is null or p_batch is null or p_days < 1 or p_days > 36500 or p_batch < 1 or p_batch > 1000 then raise exception 'INVALID_INPUT'; end if;
 -- Same scan-first lock ordering as finalize/takeover/claim. Pending upload age
 -- is measured from scan creation; intent renewal cannot extend the 24h policy.
 for scan_record in select * from public.scans where status='awaiting_upload' and created_at < now()-interval '24 hours'
 order by created_at limit p_batch for update skip locked loop
  update public.scans set status='failed', failure_code='UPLOAD_EXPIRED', revision=revision+1 where id=scan_record.id;
  update public.upload_intents set state='expired' where resource_id=scan_record.id and bucket='display-scans' and state='pending';
 end loop;
 update public.upload_intents set state='expired' where id in (
  select id from public.upload_intents where bucket='pog-images' and state='pending' and expires_at<now()-interval '24 hours'
  order by expires_at limit p_batch for update skip locked
 );
 for scan_record in select * from public.scans
 where image_path is not null and image_deleted_at is null and created_at < now()-make_interval(days=>p_days)
 and not exists(select 1 from public.image_cleanup_jobs j where j.bucket='display-scans' and j.object_path=scans.image_path)
 order by created_at limit p_batch for update skip locked loop
  -- Retention applies from creation even during a prolonged worker outage.
  -- Invalidate work under the same scan-first lock order before removing bytes.
  if scan_record.status in ('queued','processing') then
   update public.scan_jobs set state='cancelled',lease_token=null,lease_until=null where scan_id=scan_record.id and state in ('queued','running');
   update public.scan_attempts set outcome='cancelled',ended_at=now() where scan_id=scan_record.id and outcome='in_progress';
   update public.scans set status='failed',failure_code='IMAGE_UNAVAILABLE',job_generation=job_generation+1,revision=revision+1 where id=scan_record.id;
   insert into public.audit_events(organization_id,store_id,resource_id,event_type,metadata)
   values(scan_record.organization_id,scan_record.store_id,scan_record.id,'scan.retention_expired',jsonb_build_object('failure_code','IMAGE_UNAVAILABLE'));
  end if;
  insert into public.image_cleanup_jobs(bucket,object_path,scan_id,reason)
  values('display-scans',scan_record.image_path,scan_record.id,'retention') on conflict do nothing;
  n := n + 1;
 end loop;
 -- Only known upload namespaces. All version references (including clones and
 -- drafts) are protected. Age grace + expired intents fence future finalize.
 insert into public.image_cleanup_jobs(bucket,object_path,reason)
 select o.bucket_id,o.name,'abandoned' from storage.objects o
 where o.bucket_id in ('display-scans','pog-images') and o.created_at < now()-interval '24 hours'
 and not exists(select 1 from public.scans s where s.image_path=o.name and o.bucket_id='display-scans')
 and not exists(select 1 from public.pog_versions v where v.reference_path=o.name and o.bucket_id='pog-images')
 and not exists(select 1 from public.upload_intents live where live.bucket=o.bucket_id and live.state='pending' and split_part(live.object_path,'/',1)=split_part(o.name,'/',1) and split_part(live.object_path,'/',3)=split_part(o.name,'/',3))
 and exists(select 1 from public.upload_intents u where u.bucket=o.bucket_id
  and split_part(u.object_path,'/',1)=split_part(o.name,'/',1)
  and split_part(u.object_path,'/',3)=split_part(o.name,'/',3)
  and u.state <> 'pending' and u.expires_at < now()-interval '24 hours')
 and not exists(select 1 from public.image_cleanup_jobs j where j.bucket=o.bucket_id and j.object_path=o.name)
 and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/(capture|validated-[0-9a-f]{64}|upload-[0-9a-f-]{36}|reference-[0-9a-f-]{36}-[0-9a-f]{64})\.jpg$'
 order by o.created_at limit p_batch on conflict do nothing;
 return n;
end $$;

create function public.claim_image_cleanup(p_batch integer default 100) returns setof public.image_cleanup_jobs
language plpgsql security definer set search_path='' as $$
begin
 if p_batch is null or p_batch < 1 or p_batch > 1000 then raise exception 'INVALID_INPUT'; end if;
 return query with due as (
 select id from public.image_cleanup_jobs j where
 not exists(select 1 from public.pog_versions v where j.bucket='pog-images' and v.reference_path=j.object_path)
 and ((state='pending' and available_at<=now()) or (state='running' and lease_until<now()))
 order by available_at limit p_batch for update skip locked
 ) update public.image_cleanup_jobs j set state='running',attempts=attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
 from due where j.id=due.id returning j.*;
end $$;

create function public.finish_image_cleanup(p_id uuid,p_lease uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.image_cleanup_jobs;
begin
 select * into j from public.image_cleanup_jobs where id=p_id and state='running' and lease_token=p_lease for update;
 if not found then return false; end if;
 if p_success then
  update public.scans set image_deleted_at=coalesce(image_deleted_at,now()) where id=j.scan_id and image_path=j.object_path;
  update public.image_cleanup_jobs set state='succeeded',completed_at=now(),lease_token=null,lease_until=null where id=j.id;
 else
  update public.image_cleanup_jobs set state='pending',last_error_code='STORAGE_DELETE_FAILED',
   available_at=now()+make_interval(secs=>least(86400,60*power(2,least(attempts,10))::integer)),lease_token=null,lease_until=null where id=j.id;
 end if;
 return true;
end $$;

create function public.operations_metrics() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
 'vision_enabled',(select vision_enabled from public.operation_settings where singleton),
 'queued',(select count(*) from public.scan_jobs where state='queued'),
 'oldest_due_seconds',(select coalesce(max(extract(epoch from now()-available_at)),0) from public.scan_jobs where state='queued' and available_at<=now()),
 'expired_leases',(select count(*) from public.scan_jobs where state='running' and lease_until<now()),
 'lease_recoveries',(select count(*) from public.scan_attempts where error_code='LEASE_EXPIRED'),
 'retries',(select count(*) from public.scan_attempts where attempt_number>1),
 'provider_attempts_10m',(select count(*) from public.scan_attempts where started_at>now()-interval '10 minutes'),
 'provider_failures_10m',(select count(*) from public.scan_attempts where started_at>now()-interval '10 minutes' and outcome in ('provider_error','timeout')),
 'processing_p95_ms',(select percentile_cont(0.95) within group(order by latency_ms) from public.scan_attempts where ended_at>now()-interval '24 hours'),
 'cost_usd_micros_24h',(select coalesce(sum((usage_json->>'cost_usd_micros')::bigint),0) from public.scan_attempts where started_at>now()-interval '24 hours'),
 'unknown_ai_slots',(select count(*) from public.scan_slots s join public.scans c on c.id=s.scan_id where c.ai_summary is not null and s.ai_quantity is null),
 'observed_ai_slots',(select count(*) from public.scan_slots s join public.scans c on c.id=s.scan_id where c.ai_summary is not null),
 'corrections',(select count(*) from public.scan_corrections),
 'cleanup_backlog',(select count(*) from public.image_cleanup_jobs where state<>'succeeded'),
 'cleanup_oldest_seconds',(select coalesce(max(extract(epoch from now()-created_at)),0) from public.image_cleanup_jobs where state<>'succeeded'),
 'failed_scans',(select count(*) from public.scans where status='failed'),
 'retention_eligible',(select count(*) from public.scans where image_path is not null and image_deleted_at is null and created_at<now()-interval '90 days')
) $$;
revoke all on function public.prepare_image_cleanup(integer,integer), public.claim_image_cleanup(integer), public.finish_image_cleanup(uuid,uuid,boolean), public.operations_metrics() from public,anon,authenticated;
grant execute on function public.prepare_image_cleanup(integer,integer), public.claim_image_cleanup(integer), public.finish_image_cleanup(uuid,uuid,boolean), public.operations_metrics() to service_role;
create function private.vision_enqueue_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not (select vision_enabled from public.operation_settings where singleton) then raise exception 'VISION_DISABLED'; end if;
 if exists(select 1 from public.image_cleanup_jobs where scan_id=new.scan_id and reason='retention') then raise exception 'IMAGE_UNAVAILABLE'; end if;
 return new;
end $$;
create trigger vision_enqueue_guard before insert on public.scan_jobs for each row execute function private.vision_enqueue_guard();
create table public.operation_rate_windows (
 key_hash text primary key check(key_hash ~ '^[0-9a-f]{64}$'),
 started_at timestamptz not null, hits integer not null
);
alter table public.operation_rate_windows enable row level security;
revoke all on public.operation_rate_windows from anon,authenticated;
grant all on public.operation_rate_windows to service_role;
create function public.hit_operation_limit(p_hash text,p_limit integer,p_seconds integer) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.operation_rate_windows;
begin
 if p_limit<1 or p_seconds<1 or p_seconds>86400 then raise exception 'INVALID_INPUT'; end if;
 -- Bounded lifetime, with no email/IP plaintext retained.
 delete from public.operation_rate_windows where started_at<now()-interval '1 day';
 insert into public.operation_rate_windows values(p_hash,now(),1)
 on conflict(key_hash) do update set
 started_at=case when operation_rate_windows.started_at+make_interval(secs=>p_seconds)<=now() then now() else operation_rate_windows.started_at end,
 hits=case when operation_rate_windows.started_at+make_interval(secs=>p_seconds)<=now() then 1 else operation_rate_windows.hits+1 end
 returning * into r;
 return case when r.hits<=p_limit then 0 else greatest(1,ceil(extract(epoch from r.started_at+make_interval(secs=>p_seconds)-now()))::integer) end;
end $$;
revoke all on function public.hit_operation_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.hit_operation_limit(text,integer,integer) to service_role;

create function private.vision_create_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.source='photo' and not (select vision_enabled from public.operation_settings where singleton) then raise exception 'VISION_DISABLED'; end if;
 return new;
end $$;
create trigger vision_create_guard before insert on public.scans for each row execute function private.vision_create_guard();
revoke all on function private.vision_claim_guard(),private.vision_enqueue_guard(),private.vision_create_guard() from public,anon,authenticated;
grant execute on function private.vision_claim_guard(),private.vision_enqueue_guard(),private.vision_create_guard() to service_role;

create index image_cleanup_scan on public.image_cleanup_jobs(scan_id) where scan_id is not null;
create index operation_rate_expiry on public.operation_rate_windows(started_at);
create index pog_reference_cleanup on public.pog_versions(reference_path) where reference_path is not null;
create index scan_image_cleanup on public.scans(image_path) where image_path is not null;
