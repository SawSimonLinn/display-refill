-- Keep abandoned drafts as evidence; a fresh count captures the current prep baseline.
alter table public.production_checks drop constraint production_checks_status_check;
alter table public.production_checks add constraint production_checks_status_check check(status in ('draft','finished','abandoned'));
alter table public.production_checks drop constraint production_checks_check;
alter table public.production_checks add constraint production_checks_check check((status in ('draft','abandoned') and finished_at is null) or (status='finished' and finished_at is not null));
alter table public.production_events drop constraint production_events_kind_check;
alter table public.production_events add constraint production_events_kind_check check(kind in ('par.updated','count.updated','check.started','check.finished','check.abandoned'));
create function public.production_restart(p_actor uuid,p_store uuid,p_check uuid,p_revision integer,p_key text) returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; c public.production_checks; prior public.idempotency_records; scope text; hash text; payload jsonb;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 if not st.active or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
 select * into c from public.production_checks where id=p_check and store_id=p_store for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if c.created_by<>p_actor and not private.is_store_manager(p_actor,p_store) then raise exception 'FORBIDDEN'; end if;
 scope:='POST /production/restart/'||p_store;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_check,p_revision)::text,'UTF8')),'hex');
 select * into prior from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at>now();
 if found then if prior.request_hash<>hash then raise exception 'CONFLICT'; end if;return prior.response_body;end if;
 if c.status<>'draft' or c.revision is distinct from p_revision then raise exception 'CONFLICT'; end if;
 update public.production_checks set status='abandoned',revision=revision+1,updated_at=clock_timestamp() where id=c.id;
 insert into public.production_events(organization_id,store_id,check_id,actor_id,kind,after_value) values(st.organization_id,p_store,c.id,p_actor,'check.abandoned',jsonb_build_object('reason','fresh_recount'));
 payload:=public.production_mutate(p_actor,p_store,jsonb_build_object('action','start','section',c.section),gen_random_uuid()::text);
 delete from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at<=now();
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body) values(p_actor,scope,p_key,hash,(payload->>'id')::uuid,200,payload);
 return payload;
end; $$;
revoke all on function public.production_restart(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.production_restart(uuid,uuid,uuid,integer,text) to service_role;
