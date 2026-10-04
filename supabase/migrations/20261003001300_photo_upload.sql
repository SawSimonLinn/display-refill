-- Feature 08. Staging is never used by analysis; validated pixels are write-once.
alter table public.scans drop constraint scans_check;
alter table public.scans add constraint scans_image_path_check check (image_path is null or image_path ~ ('^' || organization_id::text || '/' || store_id::text || '/' || id::text || '/validated-[0-9a-f]{64}\.jpg$'));
create function private.guard_validated_scan_image() returns trigger language plpgsql set search_path = '' as $$
begin
 if old.image_path is not null and (new.image_path is distinct from old.image_path or new.crop_json is distinct from old.crop_json or new.captured_at is distinct from old.captured_at) then raise exception 'IMMUTABLE'; end if;
 return new;
end;
$$;
revoke all on function private.guard_validated_scan_image() from public,anon,authenticated;
create trigger scans_image_immutable before update on public.scans for each row execute function private.guard_validated_scan_image();
create function public.photo_scan_workflow(p_actor uuid, p_action text, p_resource uuid,
 p_input jsonb, p_key text default null, p_image jsonb default null, p_request_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare s public.scans; d public.displays; u public.upload_intents; r public.idempotency_records;
 scope text; hash text; payload jsonb; sid uuid; path text;
begin
 if p_action not in ('create','authorize','renew','finalize','reject') then raise exception 'VALIDATION_FAILED'; end if;
 if p_action='create' then
  select * into d from public.displays where id=p_resource for share;
  if not found or not private.has_store_access(p_actor,d.store_id) then raise exception 'NOT_FOUND'; end if;
 else
  select * into s from public.scans where id=p_resource for update;
  if not found or not private.has_store_access(p_actor,s.store_id) then raise exception 'NOT_FOUND'; end if;
  if s.created_by<>p_actor then raise exception 'FORBIDDEN'; end if;
  if s.source<>'photo' then raise exception 'CONFLICT'; end if;
 end if;
 scope:=case when p_action='create' then 'POST /scans' else 'POST /scans/'||p_resource::text||'/'||p_action end;
 hash:=encode(sha256(convert_to(jsonb_build_object('source','photo','resource',p_resource,'input',p_input)::text,'UTF8')),'hex');
 if p_action in ('create','finalize') then
  if p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||scope||p_key,0));
  delete from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at<now();
  select * into r from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key;
  if found then
   if r.request_hash<>hash then raise exception 'CONFLICT'; end if;
   return jsonb_build_object('payload',r.response_body,'replayed',true);
  end if;
 end if;
 if p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended('photo-rate:'||p_actor::text,0));
  if (select count(*) from public.scans where created_by=p_actor and source='photo' and created_at>now()-interval '1 minute')>=10 then raise exception 'RATE_LIMITED'; end if;
  select scan_id into sid from public.create_scan(p_actor,p_resource,'photo',(p_input->>'expected_pog_version_id')::uuid);
  select * into s from public.scans where id=sid;
 else sid:=s.id; end if;
 select * into u from public.upload_intents where resource_id=sid and bucket='display-scans' for update;
 if not found or u.actor_id<>p_actor then raise exception 'NOT_FOUND'; end if;
 if p_action='reject' then
  if u.state<>'pending' or s.status<>'awaiting_upload' then raise exception 'CONFLICT'; end if;
  update public.upload_intents set state='rejected' where id=u.id returning * into u;
 elsif p_action='renew' then
  if s.status<>'awaiting_upload' or u.state<>'pending' or s.created_at<now()-interval '24 hours' then raise exception 'CONFLICT'; end if;
  update public.upload_intents set expires_at=now()+interval '10 minutes' where id=u.id returning * into u;
 elsif p_action='finalize' then
  if s.status<>'awaiting_upload' or s.revision<>(p_input->>'expected_revision')::integer or u.state<>'pending' or u.expires_at<=now() then raise exception 'CONFLICT'; end if;
  if p_image->>'sha256' is null or p_image->>'sha256' !~ '^[0-9a-f]{64}$'
   or (p_image->>'width')::integer not between 64 and 2048 or (p_image->>'height')::integer not between 64 and 2048 then raise exception 'VALIDATION_FAILED'; end if;
  path:=s.organization_id::text||'/'||s.store_id::text||'/'||s.id::text||'/validated-'||(p_image->>'sha256')||'.jpg';
  update public.upload_intents set state='validated' where id=u.id returning * into u;
  update public.scans set image_path=path,crop_json=jsonb_build_object('crop',p_input->'crop','upright_source',p_image->'source','width',p_image->'width','height',p_image->'height'),captured_at=now(),status='queued',revision=revision+1 where id=sid;
  insert into public.scan_jobs(organization_id,scan_id,generation) values(s.organization_id,sid,s.job_generation);
  insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id)
   values(s.organization_id,s.store_id,p_actor,'scan.upload_finalized',sid,p_request_id);
 end if;
 payload:=jsonb_build_object('scan',private.scan_payload(sid),'upload',to_jsonb(u));
 if p_action in ('create','finalize') then
  insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body)
  values(p_actor,scope,p_key,hash,sid,case when p_action='create' then 201 else 200 end,payload);
 end if;
 return jsonb_build_object('payload',payload,'replayed',false);
end;
$$;
revoke all on function public.photo_scan_workflow(uuid,text,uuid,jsonb,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.photo_scan_workflow(uuid,text,uuid,jsonb,text,jsonb,uuid) to service_role;
