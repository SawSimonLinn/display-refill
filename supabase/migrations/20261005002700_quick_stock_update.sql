-- Atomic per-product recounts publish every location and backup together.
alter table public.production_checks add column kind text not null default 'section' check(kind in ('section','product'));
drop index public.production_checks_draft;
create unique index production_checks_draft on public.production_checks(store_id,section,business_date,created_by) where status='draft' and kind='section';
create or replace function private.production_base_read(p_actor uuid,p_store uuid,p_view text default 'day',p_check uuid default null)
 returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; c public.production_checks; v_manager boolean; v_day date; v_section text; v_sections jsonb:='[]'; v_payload jsonb; v_total bigint:=0; v_complete boolean:=true;
begin
 select * into st from public.stores where id=p_store;
 if not found or not private.has_store_access(p_actor,st.id) then raise exception 'NOT_FOUND'; end if;
 v_manager:=private.is_store_manager(p_actor,st.id);
 if p_view='config' then return private.production_config_payload(st.id,v_manager); end if;
 if p_view='check' then
  select * into c from public.production_checks where id=p_check and store_id=st.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return private.production_check_payload(c.id);
 end if;
 if p_view='events' then
  if not v_manager then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('events',coalesce((select jsonb_agg(e.payload order by e.created_at desc,e.id desc) from (
   select ev.id,ev.created_at,jsonb_build_object('id',ev.id,'kind',ev.kind,'actor_id',ev.actor_id,
    'actor_name',coalesce(nullif(pr.display_name,''),'Team member'),'created_at',ev.created_at,
    'check_id',ev.check_id,'item_id',ev.item_id,'before',ev.before_value,'after',ev.after_value) payload
   from public.production_events ev left join public.profiles pr on pr.user_id=ev.actor_id
   where ev.store_id=st.id order by ev.created_at desc,ev.id desc limit 100) e),'[]'::jsonb));
 end if;
 if p_view<>'day' or p_view is null then raise exception 'VALIDATION_FAILED'; end if;
 v_day:=(now() at time zone st.timezone)::date;
 foreach v_section in array array['fruit_mobile','salad_mobile','fruit_case','veggie_case'] loop
  select * into c from public.production_checks where store_id=st.id and section=v_section and business_date=v_day and status='finished' and kind='section' order by finished_at desc,id desc limit 1;
  if found then
   v_payload:=private.production_check_payload(c.id);
   v_total:=v_total+(v_payload->>'total_make')::bigint;
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'check_id',c.id,'finished_at',c.finished_at,'items',v_payload->'items','total_make',v_payload->'total_make','in_progress',exists(select 1 from public.production_checks d where d.store_id=st.id and d.section=v_section and d.business_date=v_day and d.status='draft')));
  else
   v_complete:=false;
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'check_id',null,'finished_at',null,'items','[]'::jsonb,'total_make',null,'in_progress',exists(select 1 from public.production_checks d where d.store_id=st.id and d.section=v_section and d.business_date=v_day and d.status='draft')));
  end if;
 end loop;
 return jsonb_build_object('date',v_day,'sections',v_sections,'total_make',v_total,'complete',v_complete);
end; $$;


create or replace function private.production_allocations(p_store uuid,p_day date)
returns table(count_id uuid,adjusted_make bigint) language sql stable set search_path='' as $$
 with latest as (
 select distinct on(section) id,section from public.production_checks where store_id=p_store and business_date=p_day and status='finished' and kind='section' order by section,finished_at desc,id desc
 ), rows as (
 select pc.*,l.section,array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],l.section) ordering from public.production_counts pc join latest l on l.id=pc.check_id
 ), groups as (
 select product_id, count(*)=max(shared_size) and bool_and(have is not null) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
 sum(greatest(0,have-par_snapshot))+coalesce(sum(backup),0) credit from rows group by product_id
 ), ranked as (
 select r.*,g.ready,g.credit,coalesce(sum(greatest(0,par_snapshot-have)) over(partition by r.product_id order by ordering rows between unbounded preceding and 1 preceding),0) previous_need from rows r join groups g on g.product_id=r.product_id
 ) select id,case when not ready then null else greatest(0,greatest(0,par_snapshot-have)-greatest(0,credit-previous_need))::bigint end from ranked;
$$;
create or replace function private.production_prep_payload(p_store uuid) returns jsonb language sql stable set search_path='' as $$
 with latest as (
 select distinct on(n.product_id,c.section) n.id count_id,c.section,c.finished_at from public.production_counts n join public.production_checks c on c.id=n.check_id where c.store_id=p_store and c.status='finished' order by n.product_id,c.section,c.finished_at desc,c.id desc
 ), counted as (
 select n.*,l.section,l.finished_at from public.production_counts n join latest l on l.count_id=n.id join public.production_items i on i.id=n.item_id and i.active join public.products pr on pr.id=n.product_id and pr.active
 ), grouped as (
 select product_id,min(product_name) product_name,min(category) category,min(product_type) product_type,
 count(*)=(select count(*) from public.production_items active_item where active_item.store_id=p_store and active_item.product_id=counted.product_id and active_item.active)
 and count(*)=max(shared_size) and min(prep_revision)=max(prep_revision) and min(stock_round)=max(stock_round) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
 min(prep_revision) baseline, greatest(0,sum(par_snapshot)-sum(have)-coalesce(sum(backup),0)) needed,
 min(finished_at) oldest_count,
 jsonb_agg(jsonb_build_object('section',section,'have',have,'backup',backup,'backup_required',backup_required,'display_need',greatest(0,par_snapshot-have),'checked_at',finished_at) order by array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],section)) locations,
 string_agg(id::text,',' order by section) count_ids
 from counted group by product_id
 ), prep as (
 select g.*,coalesce((select sum(e.quantity) from public.production_prep_events e where e.store_id=p_store and e.product_id=g.product_id and e.sequence>g.baseline),0) made,
 (select coalesce(max(e.sequence),0) from public.production_prep_events e where e.store_id=p_store and e.product_id=g.product_id) latest_sequence
 from grouped g
 ) select jsonb_build_object('updated_at',now(),'items',coalesce((select jsonb_agg(jsonb_build_object(
 'product_id',p.product_id,'product_name',p.product_name,'category',p.category,'product_type',p.product_type,
 'ready',p.ready,'needed',case when p.ready then p.needed else null end,'made',p.made,
 'remaining',case when p.ready then greatest(0,p.needed-p.made) else null end,'locations',p.locations,'oldest_count',p.oldest_count,
 'revision',encode(sha256(convert_to(p.count_ids || ':' || p.latest_sequence::text,'UTF8')),'hex'),
 'activity',coalesce((select jsonb_agg(a.payload order by a.sequence desc) from (
 select e.sequence,jsonb_build_object('quantity',e.quantity,'name',coalesce(nullif(pr.display_name,''),'Team member'),'at',e.created_at) payload
 from public.production_prep_events e left join public.profiles pr on pr.user_id=e.actor_id where e.store_id=p_store and e.product_id=p.product_id order by e.sequence desc limit 5) a),'[]'::jsonb)
 ) order by greatest(0,p.needed-p.made) desc,p.product_name) from prep p),'[]'::jsonb),
 'missing_sections',coalesce((select jsonb_agg(s) from unnest(array['fruit_mobile','salad_mobile','fruit_case','veggie_case']) s where not exists(select 1 from latest l where l.section=s)),'[]'::jsonb));
$$;
create function public.production_stock_record(p_actor uuid,p_store uuid,p_product uuid,p_revision text,p_counts jsonb,p_key text) returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; row jsonb; prior public.idempotency_records; scope text; hash text; payload jsonb; i record; c public.production_checks; entry jsonb; size integer; first_section text;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND';end if;
 if not st.active or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED';end if;
 scope:='POST /stock/'||p_store;hash:=encode(sha256(convert_to(jsonb_build_array(p_product,p_revision,p_counts)::text,'UTF8')),'hex');
 select * into prior from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at>now();
 if found then if prior.request_hash<>hash then raise exception 'CONFLICT';end if;return prior.response_body;end if;
 select value into row from jsonb_array_elements(private.production_prep_payload(p_store)->'items') where value->>'product_id'=p_product::text;
 if not found then raise exception 'NOT_FOUND';end if;
 if row->>'revision' is distinct from p_revision then raise exception 'CONFLICT';end if;
 if jsonb_typeof(p_counts) is distinct from 'array' then raise exception 'VALIDATION_FAILED';end if;
 select count(*),(array_agg(section order by array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],section)))[1] into size,first_section from public.production_items where store_id=p_store and product_id=p_product and active;
 if size=0 or jsonb_array_length(p_counts)<>size or (select count(distinct value->>'section') from jsonb_array_elements(p_counts))<>size then raise exception 'VALIDATION_FAILED';end if;
 for i in select pi.*,pr.name from public.production_items pi join public.products pr on pr.id=pi.product_id and pr.active where pi.store_id=p_store and pi.product_id=p_product and pi.active order by array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],pi.section) loop
  select value into entry from jsonb_array_elements(p_counts) where value->>'section'=i.section;
  if not found or (entry-'section'-'have'-'backup')<>'{}'::jsonb or jsonb_typeof(entry->'have') is distinct from 'number' or (entry->>'have') !~ '^\d{1,4}$' then raise exception 'VALIDATION_FAILED';end if;
  if size>1 and i.section=first_section then
   if jsonb_typeof(entry->'backup') is distinct from 'number' or (entry->>'backup') !~ '^\d{1,4}$' then raise exception 'VALIDATION_FAILED';end if;
  elsif entry ? 'backup' then raise exception 'VALIDATION_FAILED';end if;
  insert into public.production_checks(organization_id,store_id,section,business_date,created_by,created_at,kind) values(st.organization_id,p_store,i.section,(now() at time zone st.timezone)::date,p_actor,clock_timestamp(),'product') returning * into c;
  insert into public.production_counts(organization_id,check_id,item_id,product_id,product_name,category,product_type,sort_order,par_snapshot,have,shared_size,backup_required,backup)
   values(st.organization_id,c.id,i.id,i.product_id,i.name,i.category,i.product_type,i.sort_order,i.par,(entry->>'have')::int,size,size>1 and i.section=first_section,(entry->>'backup')::int);
  update public.production_checks set status='finished',finished_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=c.id;
  insert into public.production_events(organization_id,store_id,check_id,item_id,actor_id,kind,after_value) values(st.organization_id,p_store,c.id,i.id,p_actor,'check.finished',entry||jsonb_build_object('product_name',i.name,'scope','product_recount'));
 end loop;
 payload:=private.production_prep_payload(p_store);
 delete from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at<=now();
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body) values(p_actor,scope,p_key,hash,p_product,200,payload);
 return payload;
end; $$;
revoke all on function public.production_stock_record(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.production_stock_record(uuid,uuid,uuid,text,jsonb,text) to service_role;
create or replace function public.production_restart(p_actor uuid,p_store uuid,p_check uuid,p_revision integer,p_key text) returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; c public.production_checks; prior public.idempotency_records; scope text; hash text; payload jsonb;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 if not st.active or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
 select * into c from public.production_checks where id=p_check and store_id=p_store for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if c.created_by<>p_actor then raise exception 'FORBIDDEN'; end if;
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
