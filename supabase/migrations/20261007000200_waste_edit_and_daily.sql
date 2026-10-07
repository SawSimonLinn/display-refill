-- Waste Log: per-day and per-reason totals in the operations payload, and an
-- atomic "edit" action. Editing never rewrites history: it voids the original
-- entry and records the corrected one in the same transaction.

create or replace function private.production_operations_payload(p_actor uuid,p_store uuid,p_day date,p_period text)
returns jsonb language plpgsql stable set search_path='' as $$
declare st public.stores; first_day date; last_day date; today date; result jsonb;
begin
 select * into st from public.stores where id=p_store;
 today:=(now() at time zone st.timezone)::date;
 p_day:=coalesce(p_day,today);
 if p_day>today or p_period not in ('day','week','month') or p_period is null then raise exception 'VALIDATION_FAILED'; end if;
 first_day:=case p_period when 'week' then p_day-extract(dow from p_day)::int when 'month' then date_trunc('month',p_day)::date else p_day end;
 last_day:=case p_period when 'week' then first_day+6 when 'month' then (first_day+interval '1 month'-interval '1 day')::date else first_day end;
 with catalog as (
  select i.product_id,min(p.name) product_name,min(i.category) category,min(i.product_type) product_type,
   case when bool_or(i.section in ('fruit_mobile','fruit_case')) then 'Fruit' when bool_or(i.section='veggie_case') then 'Vegetables' else 'Salads' end family
  from public.production_items i join public.products p on p.id=i.product_id where i.store_id=p_store and i.active and p.active group by i.product_id
 ), prep as (
  select e.product_id,(e.created_at at time zone st.timezone)::date on_day,e.quantity from public.production_prep_events e
  where e.store_id=p_store and e.created_at >= (first_day::timestamp at time zone st.timezone)
  and e.created_at < ((last_day+1)::timestamp at time zone st.timezone)
 ), ledger as (
  select e.product_id,e.business_date on_day,e.reason,case e.kind when 'waste' then e.quantity else -e.quantity end quantity
  from public.production_waste_events e where e.store_id=p_store and e.business_date between first_day and last_day
 ), made as (
  select product_id,sum(quantity)::bigint quantity from prep group by product_id
 ), waste as (
  select product_id,sum(quantity)::bigint quantity from ledger group by product_id
 ), ids as (select product_id from catalog union select product_id from made union select product_id from waste), totals as (
  select x.product_id,p.name product_name,coalesce(c.category,p.category,'') category,
  coalesce(c.product_type,p.container_type,'') product_type,coalesce(c.family,'Other') family,
  coalesce(m.quantity,0) made,coalesce(w.quantity,0) wasted
  from ids x join public.products p on p.id=x.product_id left join catalog c on c.product_id=x.product_id
  left join made m on m.product_id=x.product_id left join waste w on w.product_id=x.product_id
 ), days as (
  select d::date on_day,
   coalesce((select sum(quantity) from prep where prep.on_day=d::date),0)::bigint made,
   coalesce((select sum(quantity) from ledger where ledger.on_day=d::date),0)::bigint wasted
  from generate_series(first_day,last_day,interval '1 day') d
 ), reasons as (
  select reason,sum(quantity)::bigint wasted from ledger group by reason having sum(quantity)<>0
 ) select jsonb_build_object('business_date',p_day,'period',p_period,'start_date',first_day,'end_date',last_day,'timezone',st.timezone,
 'made',coalesce((select sum(made) from totals),0),'wasted',coalesce((select sum(wasted) from totals),0),
 'days',(select jsonb_agg(jsonb_build_object('date',on_day,'made',made,'wasted',wasted) order by on_day) from days),
 'reasons',coalesce((select jsonb_agg(jsonb_build_object('reason',reason,'wasted',wasted) order by wasted desc,reason) from reasons),'[]'::jsonb),
 'products',coalesce((select jsonb_agg(to_jsonb(t) order by array_position(array['Fruit','Vegetables','Salads','Other'],family),case when product_name like '$5%' or category='$5 bowls' then 0 else 1 end,product_name,product_id) from totals t),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(to_jsonb(c) order by array_position(array['Fruit','Vegetables','Salads'],family),case when product_name like '$5%' or category='$5 bowls' then 0 else 1 end,product_name,product_id) from catalog c),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(e.payload order by e.created_at desc,e.id desc) from (
  select w.id,w.created_at,jsonb_build_object('id',w.id,'product_id',w.product_id,'product_name',w.product_name,'quantity',w.quantity,'reason',w.reason,'note',w.note,'business_date',w.business_date,'created_at',w.created_at,
  'actor_name',coalesce(nullif(pr.display_name,''),'Team member'),'voided',v.id is not null,'edited',coalesce(v.note='Edited',false),
  'can_void',v.id is null and (w.actor_id=p_actor or private.is_store_manager(p_actor,p_store))) payload
  from public.production_waste_events w left join public.profiles pr on pr.user_id=w.actor_id
  left join public.production_waste_events v on v.void_of=w.id
  where w.store_id=p_store and w.kind='waste' and w.business_date between first_day and last_day order by w.created_at desc,w.id desc limit 200
 ) e),'[]'::jsonb)) into result;
 return result;
end; $$;

create or replace function public.production_waste_record(p_actor uuid,p_store uuid,p_body jsonb,p_key text)
returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; original public.production_waste_events; product public.products;
 day date; today date; amount integer; category text; product_type text; result jsonb;
 prior public.idempotency_records; scope text; hash text; event_id uuid;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 if not st.active or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' or p_body is null or jsonb_typeof(p_body)<>'object' then raise exception 'VALIDATION_FAILED'; end if;
 scope:='POST /waste/'||p_store; hash:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
 select * into prior from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at>now();
 if found then if prior.request_hash<>hash then raise exception 'CONFLICT'; end if; return prior.response_body; end if;
 today:=(now() at time zone st.timezone)::date;
 if p_body->>'action'='record' then
  if (p_body-array['action','product_id','quantity','reason','note','business_date'])<>'{}'::jsonb or jsonb_typeof(p_body->'quantity')<>'number' or (p_body->>'quantity')!~'^[0-9]+$' then raise exception 'VALIDATION_FAILED'; end if;
  amount:=(p_body->>'quantity')::int; day:=coalesce((p_body->>'business_date')::date,today);
  if amount is null or amount not between 1 and 9999 or day>today or p_body->>'reason' is null or p_body->>'reason' not in ('expired','quality','damaged','other') or length(coalesce(p_body->>'note',''))>300 then raise exception 'VALIDATION_FAILED'; end if;
  select * into product from public.products where id=(p_body->>'product_id')::uuid and organization_id=st.organization_id and active;
  if not found then raise exception 'NOT_FOUND'; end if;
  select min(i.category),min(i.product_type) into category,product_type from public.production_items i where i.store_id=p_store and i.product_id=product.id and i.active;
  if category is null then raise exception 'NOT_FOUND'; end if;
  insert into public.production_waste_events(organization_id,store_id,product_id,product_name,category,product_type,business_date,kind,quantity,reason,note,actor_id)
  values(st.organization_id,p_store,product.id,product.name,category,product_type,day,'waste',amount,p_body->>'reason',coalesce(p_body->>'note',''),p_actor) returning id into event_id;
 elsif p_body->>'action' in ('void','edit') then
  if p_body->>'action'='void' and (p_body-array['action','entry_id'])<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  if p_body->>'action'='edit' then
   if (p_body-array['action','entry_id','quantity','reason','note'])<>'{}'::jsonb or jsonb_typeof(p_body->'quantity')<>'number' or (p_body->>'quantity')!~'^[0-9]+$' then raise exception 'VALIDATION_FAILED'; end if;
   amount:=(p_body->>'quantity')::int;
   if amount is null or amount not between 1 and 9999 or p_body->>'reason' is null or p_body->>'reason' not in ('expired','quality','damaged','other') or length(coalesce(p_body->>'note',''))>300 then raise exception 'VALIDATION_FAILED'; end if;
  end if;
  select * into original from public.production_waste_events where id=(p_body->>'entry_id')::uuid and store_id=p_store and kind='waste';
  if not found then raise exception 'NOT_FOUND'; end if;
  if original.actor_id<>p_actor and not private.is_store_manager(p_actor,p_store) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.production_waste_events where void_of=original.id) then raise exception 'CONFLICT'; end if;
  day:=original.business_date; event_id:=original.id;
  if p_body->>'action'='void' or (amount,p_body->>'reason',coalesce(p_body->>'note','')) is distinct from (original.quantity,original.reason,original.note) then
   insert into public.production_waste_events(organization_id,store_id,product_id,product_name,category,product_type,business_date,kind,void_of,quantity,reason,note,actor_id)
   values(st.organization_id,p_store,original.product_id,original.product_name,original.category,original.product_type,day,'void',original.id,original.quantity,original.reason,
    case p_body->>'action' when 'edit' then 'Edited' else 'Undo waste entry' end,p_actor) returning id into event_id;
   if p_body->>'action'='edit' then
    insert into public.production_waste_events(organization_id,store_id,product_id,product_name,category,product_type,business_date,kind,quantity,reason,note,actor_id)
    values(st.organization_id,p_store,original.product_id,original.product_name,original.category,original.product_type,day,'waste',amount,p_body->>'reason',coalesce(p_body->>'note',''),p_actor) returning id into event_id;
   end if;
  end if;
 else raise exception 'VALIDATION_FAILED'; end if;
 result:=private.production_operations_payload(p_actor,p_store,day,'day');
 delete from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at<=now();
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body) values(p_actor,scope,p_key,hash,event_id,200,result);
 return result;
end; $$;
revoke all on function private.production_operations_payload(uuid,uuid,date,text),public.production_waste_record(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.production_operations_payload(uuid,uuid,date,text),public.production_waste_record(uuid,uuid,jsonb,text) to service_role;
