-- Feature 07: creation/completion and response replay commit atomically.
create function public.manual_scan_workflow(p_actor uuid, p_action text, p_resource uuid,
 p_expected_revision integer default null, p_expected_pog uuid default null, p_key text default null, p_request_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare s public.scans; d public.displays; r public.idempotency_records; v_scope text;
 v_hash text; v_payload jsonb; v_id uuid;
begin
 if p_action not in ('create','complete') or p_action is null or p_key is null
 or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
 if p_action = 'create' then
   select * into d from public.displays where id=p_resource for share;
   if not found or not private.has_store_access(p_actor,d.store_id) then raise exception 'NOT_FOUND'; end if;
 else
   select * into s from public.scans where id=p_resource for update;
   if not found or not private.has_store_access(p_actor,s.store_id) then raise exception 'NOT_FOUND'; end if;
   if not (s.created_by=p_actor or private.is_org_admin(p_actor,s.organization_id)
     or exists(select 1 from public.store_memberships where user_id=p_actor and store_id=s.store_id and active and role='manager'))
   then raise exception 'FORBIDDEN'; end if;
 end if;
 v_scope := case p_action when 'create' then 'POST /scans' else 'POST /scans/' || p_resource::text || '/complete' end;
 -- Serialize same-key creation even before a scan exists.
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text || v_scope || p_key,0));
 v_hash := encode(sha256(convert_to(jsonb_build_object('resource',p_resource,'revision',p_expected_revision,'pog',p_expected_pog)::text,'UTF8')),'hex');
 delete from public.idempotency_records where actor_id=p_actor and route_scope=v_scope and key=p_key and expires_at<now();
 select * into r from public.idempotency_records where actor_id=p_actor and route_scope=v_scope and key=p_key;
 if found then
   if r.request_hash<>v_hash then raise exception 'CONFLICT'; end if;
   return jsonb_build_object('payload',r.response_body,'replayed',true);
 end if;
 if p_action='create' then
   select scan_id into v_id from public.create_scan(p_actor,p_resource,'manual',p_expected_pog);
 else
   if p_expected_revision is null or p_expected_revision<1 then raise exception 'VALIDATION_FAILED'; end if;
   if s.status<>'confirmed' or s.revision<>p_expected_revision then raise exception 'CONFLICT'; end if;
   update public.scans set status='completed',completed_at=now(),completed_by=p_actor,
     revision=revision+1,updated_at=now() where id=s.id;
   insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
   values(s.organization_id,s.store_id,p_actor,'scan.completed',s.id,p_request_id,jsonb_build_object('attestation',true,'scan_revision',s.revision+1));
   v_id:=s.id;
 end if;
 v_payload:=private.scan_payload(v_id);
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body)
 values(p_actor,v_scope,p_key,v_hash,v_id,case p_action when 'create' then 201 else 200 end,v_payload);
 return jsonb_build_object('payload',v_payload,'replayed',false);
end;
$$;
revoke all on function public.manual_scan_workflow(uuid,text,uuid,integer,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.manual_scan_workflow(uuid,text,uuid,integer,uuid,text,uuid) to service_role;
