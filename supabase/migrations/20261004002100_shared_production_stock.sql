-- Multiple display rows share one product identity; shared cooler stock is counted once.
alter table public.production_items drop constraint production_items_store_id_product_id_key;
alter table public.production_items add unique(store_id,product_id,section);
alter table public.production_counts add column shared_size integer not null default 1 check(shared_size between 1 and 4),
 add column backup_required boolean not null default false,
 add column backup integer check(backup between 0 and 9999),
 add check(backup_required or backup is null);
create or replace function private.guard_production_count() returns trigger language plpgsql set search_path='' as $$
declare c public.production_checks; i public.production_items;
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE'; end if;
 select * into c from public.production_checks where id=new.check_id for update;
 select * into i from public.production_items where id=new.item_id;
 if c.status<>'draft' then raise exception 'IMMUTABLE'; end if;
 if i.store_id<>c.store_id or i.product_id<>new.product_id then raise exception 'VALIDATION_FAILED'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'have'-'make'-'backup') is distinct from (to_jsonb(old)-'have'-'make'-'backup') then raise exception 'IMMUTABLE'; end if;
 return new;
end; $$;
create or replace function private.guard_production_check() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status='finished' then raise exception 'IMMUTABLE'; end if;
 if (to_jsonb(new)-'revision'-'updated_at'-'finished_at'-'status') is distinct from (to_jsonb(old)-'revision'-'updated_at'-'finished_at'-'status') then raise exception 'IMMUTABLE'; end if;
 if new.status='finished' and (not exists(select 1 from public.production_counts where check_id=new.id) or exists(select 1 from public.production_counts where check_id=new.id and (have is null or (backup_required and backup is null)))) then raise exception 'VALIDATION_FAILED'; end if;
 return new;
end; $$;

create or replace function private.production_check_payload(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'store_id',c.store_id,'section',c.section,'business_date',c.business_date,
 'revision',c.revision,'status',c.status,'updated_at',c.updated_at,'finished_at',c.finished_at,'created_by',c.created_by,
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'product_id',n.product_id,'product_name',n.product_name,
 'category',n.category,'product_type',n.product_type,'sort_order',n.sort_order,'have',n.have,'backup',n.backup,'backup_required',n.backup_required,'shared_size',n.shared_size,'make',case when n.shared_size>1 then null else n.make end) order by n.sort_order,n.id)
 from public.production_counts n where n.check_id=c.id),'[]'::jsonb),
 'total_make',(select case when bool_or(n.have is null or n.shared_size>1) then null else sum(n.make) end from public.production_counts n where n.check_id=c.id))
 from public.production_checks c where c.id=p_id;
$$;
create or replace function public.production_mutate(p_actor uuid,p_store uuid,p_body jsonb,p_key text,p_request_id uuid default null)
 returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; c public.production_checks; old_i public.production_items; n public.production_counts;
 p public.products; r public.idempotency_records; action text; v_section text; v_scope text; v_hash text;
 v_manager boolean; v_payload jsonb; v_resource uuid; v_item uuid; v_change jsonb; v_before jsonb; v_after jsonb;
 v_backup integer; v_count integer; v_revision integer; v_day date;
begin
 action:=p_body->>'action';
 if action is null or action not in ('configure','start','counts','finish') or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
 -- Serialize per store: PAR snapshots, concurrent starts and latest completion are consistent.
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,st.id) then raise exception 'NOT_FOUND'; end if;
 if not st.active then raise exception 'VALIDATION_FAILED' using detail='This store is archived.'; end if;
 v_manager:=private.is_store_manager(p_actor,st.id);
 if action='configure' and not v_manager then raise exception 'FORBIDDEN'; end if;
 if action in ('counts','finish') then
  select * into c from public.production_checks where id=(p_body->>'check_id')::uuid and store_id=st.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.created_by<>p_actor and not v_manager then raise exception 'FORBIDDEN'; end if;
 end if;
 v_scope:='POST /production/' || st.id;
 v_hash:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
 delete from public.idempotency_records where actor_id=p_actor and route_scope=v_scope and key=p_key and expires_at<now();
 select * into r from public.idempotency_records where actor_id=p_actor and route_scope=v_scope and key=p_key;
 if found then
  if r.request_hash<>v_hash then raise exception 'CONFLICT'; end if;
  return r.response_body;
 end if;
 v_day:=(now() at time zone st.timezone)::date;
 if action='configure' then
  if (p_body-'action'-'item_id'-'product_id'-'section'-'par'-'category'-'product_type'-'sort_order'-'active'-'expected_revision')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  v_section:=p_body->>'section';
  if v_section is null or v_section not in ('fruit_mobile','salad_mobile','fruit_case','veggie_case') or
   (p_body->>'par') is null or (p_body->>'par')!~ '^\d{1,4}$' then raise exception 'VALIDATION_FAILED'; end if;
  select * into p from public.products where id=(p_body->>'product_id')::uuid and organization_id=st.organization_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not p.active then raise exception 'VALIDATION_FAILED' using detail='The product is archived.'; end if;
  v_item:=(p_body->>'item_id')::uuid;
  if v_item is not null then
   select * into old_i from public.production_items where id=v_item and store_id=st.id for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if old_i.revision is distinct from (p_body->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
   if old_i.product_id<>p.id then raise exception 'VALIDATION_FAILED'; end if;
   if (old_i.section<>v_section or old_i.active is distinct from coalesce((p_body->>'active')::boolean,true)) and exists(select 1 from public.production_counts counted join public.production_checks ch on ch.id=counted.check_id where counted.item_id=old_i.id and ch.business_date=v_day) then
    raise exception 'VALIDATION_FAILED' using detail='This product was already counted or started today. Move it to a different section tomorrow to avoid double counting.';
   end if;
   v_before:=to_jsonb(old_i);
   update public.production_items set section=v_section,par=(p_body->>'par')::int,
    category=coalesce(p_body->>'category',''),product_type=coalesce(p_body->>'product_type',''),
    sort_order=coalesce((p_body->>'sort_order')::int,0),active=coalesce((p_body->>'active')::boolean,true),
    revision=revision+1,updated_at=clock_timestamp(),updated_by=p_actor where id=v_item returning to_jsonb(production_items.*) into v_after;
  else
   if exists(select 1 from public.production_items where store_id=st.id and product_id=p.id and section=v_section) then raise exception 'CONFLICT'; end if;
   if exists(select 1 from public.production_counts pc join public.production_checks chk on chk.id=pc.check_id where chk.store_id=st.id and pc.product_id=p.id and chk.business_date=v_day) then raise exception 'CONFLICT' using detail='Configure additional sections before starting today’s checks.'; end if;
   insert into public.production_items(organization_id,store_id,product_id,section,par,category,product_type,sort_order,active,updated_by)
   values(st.organization_id,st.id,p.id,v_section,(p_body->>'par')::int,coalesce(p_body->>'category',''),coalesce(p_body->>'product_type',''),
    coalesce((p_body->>'sort_order')::int,0),coalesce((p_body->>'active')::boolean,true),p_actor)
   returning id,to_jsonb(production_items.*) into v_item,v_after;
  end if;
  insert into public.production_events(organization_id,store_id,item_id,actor_id,kind,before_value,after_value)
  values(st.organization_id,st.id,v_item,p_actor,'par.updated',v_before,v_after || jsonb_build_object('product_name',p.name));
  v_resource:=v_item;
  v_payload:=private.production_config_payload(st.id,true);
 elsif action='start' then
  if (p_body-'action'-'section')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  v_section:=p_body->>'section';
  if v_section is null or v_section not in ('fruit_mobile','salad_mobile','fruit_case','veggie_case') then raise exception 'VALIDATION_FAILED'; end if;
  select * into c from public.production_checks where store_id=st.id and section=v_section and business_date=v_day and created_by=p_actor and status='draft' for update;
  if not found then
   if not exists(select 1 from public.production_items i join public.products pr on pr.id=i.product_id where i.store_id=st.id and i.section=v_section and i.active and pr.active) then raise exception 'VALIDATION_FAILED' using detail='Ask your manager to set up products and PAR for this section.'; end if;
   insert into public.production_checks(organization_id,store_id,section,business_date,created_by)
   values(st.organization_id,st.id,v_section,v_day,p_actor) returning * into c;
   insert into public.production_counts(organization_id,check_id,item_id,product_id,product_name,category,product_type,sort_order,par_snapshot,shared_size,backup_required)
   select st.organization_id,c.id,i.id,i.product_id,pr.name,i.category,i.product_type,i.sort_order,i.par,
    (select count(*) from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active),
    ((select count(*) from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active)>1 and i.section=(select siblings.section from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active order by array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],siblings.section) limit 1))
    from public.production_items i join public.products pr on pr.id=i.product_id where i.store_id=st.id and i.section=v_section and i.active and pr.active;
   insert into public.production_events(organization_id,store_id,check_id,actor_id,kind,after_value)
    values(st.organization_id,st.id,c.id,p_actor,'check.started',jsonb_build_object('section',v_section,'scope','display_and_backup'));
  end if;
  v_resource:=c.id;v_payload:=private.production_check_payload(c.id);
 else
  if c.status<>'draft' or c.revision is distinct from (p_body->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  if c.business_date<>v_day then raise exception 'CONFLICT' using detail='This check belongs to an earlier day. Start a new check.'; end if;
  if action='counts' then
   if (p_body-'action'-'check_id'-'expected_revision'-'items')<>'{}'::jsonb or jsonb_typeof(p_body->'items') is distinct from 'array' then raise exception 'VALIDATION_FAILED'; end if;
   if jsonb_array_length(p_body->'items') not between 1 and 200 then raise exception 'VALIDATION_FAILED'; end if;
   if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_body->'items') x) then raise exception 'VALIDATION_FAILED'; end if;
   for v_change in select value from jsonb_array_elements(p_body->'items') loop
    if (v_change-'id'-'have'-'backup')<>'{}'::jsonb or not(v_change ? 'have') or not(v_change ? 'id') then raise exception 'VALIDATION_FAILED'; end if;
    if v_change->'have'<>'null'::jsonb and ((v_change->>'have')!~ '^\d{1,4}$' or jsonb_typeof(v_change->'have')<>'number') then raise exception 'VALIDATION_FAILED'; end if;
    select * into n from public.production_counts where id=(v_change->>'id')::uuid and check_id=c.id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_count:=(v_change->>'have')::int;
    if v_change ? 'backup' and not n.backup_required then raise exception 'VALIDATION_FAILED'; end if;
    if v_change ? 'backup' and v_change->'backup'<>'null'::jsonb and (jsonb_typeof(v_change->'backup')<>'number' or (v_change->>'backup')!~ '^\d{1,4}$') then raise exception 'VALIDATION_FAILED'; end if;
    v_backup:=case when v_change ? 'backup' then (v_change->>'backup')::int else n.backup end;
    if n.have is distinct from v_count or n.backup is distinct from v_backup then
     update public.production_counts set have=v_count,backup=v_backup where id=n.id;
     insert into public.production_events(organization_id,store_id,check_id,item_id,actor_id,kind,before_value,after_value)
     values(st.organization_id,st.id,c.id,n.item_id,p_actor,'count.updated',jsonb_build_object('have',n.have,'backup',n.backup),
      jsonb_build_object('have',v_count,'backup',v_backup,'make',case when v_count is null then null else greatest(0,n.par_snapshot-v_count) end,'product_name',n.product_name,'revision',c.revision+1));
    end if;
   end loop;
   update public.production_checks set revision=revision+1,updated_at=clock_timestamp() where id=c.id;
  else
   if (p_body-'action'-'check_id'-'expected_revision')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
   if exists(select 1 from public.production_counts where check_id=c.id and (have is null or (backup_required and backup is null))) then raise exception 'VALIDATION_FAILED' using detail='Count every item before finishing.'; end if;
   update public.production_checks set status='finished',finished_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=c.id;
   insert into public.production_events(organization_id,store_id,check_id,actor_id,kind,after_value)
   values(st.organization_id,st.id,c.id,p_actor,'check.finished',jsonb_build_object('section',c.section,'revision',c.revision+1));
  end if;
  v_resource:=c.id;v_payload:=private.production_check_payload(c.id);
 end if;
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body)
 values(p_actor,v_scope,p_key,v_hash,v_resource,200,v_payload);
 return v_payload;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'VALIDATION_FAILED';
end; $$;

-- Preserve latest finished totals while showing draft work. Prevent same-day ownership moves.
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
  select * into c from public.production_checks where store_id=st.id and section=v_section and business_date=v_day and status='finished' order by finished_at desc,id desc limit 1;
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


create function private.production_allocations(p_store uuid,p_day date)
returns table(count_id uuid,adjusted_make bigint) language sql stable set search_path='' as $$
 with latest as (
 select distinct on(section) id,section from public.production_checks where store_id=p_store and business_date=p_day and status='finished' order by section,finished_at desc,id desc
 ), rows as (
 select pc.*,l.section,array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],l.section) ordering from public.production_counts pc join latest l on l.id=pc.check_id
 ), groups as (
 select product_id, count(*)=max(shared_size) and bool_and(have is not null) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
 sum(greatest(0,have-par_snapshot))+coalesce(sum(backup),0) credit from rows group by product_id
 ), ranked as (
 select r.*,g.ready,g.credit,coalesce(sum(greatest(0,par_snapshot-have)) over(partition by r.product_id order by ordering rows between unbounded preceding and 1 preceding),0) previous_need from rows r join groups g on g.product_id=r.product_id
 ) select id,case when not ready then null else greatest(0,greatest(0,par_snapshot-have)-greatest(0,credit-previous_need))::bigint end from ranked;
$$;
create or replace function public.production_read(p_actor uuid,p_store uuid,p_view text default 'day',p_check uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; sec jsonb; item jsonb; items jsonb; sections jsonb:='[]'; amount bigint; subtotal bigint; total bigint:=0; ready boolean; section_ready boolean;
begin
 result:=private.production_base_read(p_actor,p_store,p_view,p_check);
 if p_view<>'day' then return result; end if;
 ready:=(result->>'complete')::boolean;
 for sec in select value from jsonb_array_elements(result->'sections') loop
  items:='[]';subtotal:=0;section_ready:=(sec->>'check_id') is not null;
  for item in select value from jsonb_array_elements(sec->'items') loop
   select adjusted_make into amount from private.production_allocations(p_store,(result->>'date')::date) where count_id=(item->>'id')::uuid;
   if amount is null then ready:=false;section_ready:=false; else subtotal:=subtotal+amount; end if;
   items:=items || jsonb_build_array(item || jsonb_build_object('make',amount));
  end loop;
  total:=total+subtotal;
  sections:=sections || jsonb_build_array(sec || jsonb_build_object('items',items,'total_make',case when section_ready then subtotal else null end));
 end loop;
 return result || jsonb_build_object('sections',sections,'total_make',total,'complete',ready,'shared_backup_once',true);
end; $$;
revoke all on function private.production_base_read(uuid,uuid,text,uuid),private.production_allocations(uuid,date) from public,anon,authenticated;
grant execute on function private.production_base_read(uuid,uuid,text,uuid),private.production_allocations(uuid,date) to service_role;
