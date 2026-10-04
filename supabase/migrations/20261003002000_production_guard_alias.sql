-- Correct ambiguous record/table alias in same-day section ownership guard.
create or replace function public.production_mutate(p_actor uuid,p_store uuid,p_body jsonb,p_key text,p_request_id uuid default null)
 returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; c public.production_checks; old_i public.production_items; n public.production_counts;
 p public.products; r public.idempotency_records; action text; v_section text; v_scope text; v_hash text;
 v_manager boolean; v_payload jsonb; v_resource uuid; v_item uuid; v_change jsonb; v_before jsonb; v_after jsonb;
 v_count integer; v_revision integer; v_day date;
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
   if old_i.section<>v_section and exists(select 1 from public.production_counts counted join public.production_checks ch on ch.id=counted.check_id where counted.item_id=old_i.id and ch.business_date=v_day) then
    raise exception 'VALIDATION_FAILED' using detail='This product was already counted or started today. Move it to a different section tomorrow to avoid double counting.';
   end if;
   v_before:=to_jsonb(old_i);
   update public.production_items set section=v_section,par=(p_body->>'par')::int,
    category=coalesce(p_body->>'category',''),product_type=coalesce(p_body->>'product_type',''),
    sort_order=coalesce((p_body->>'sort_order')::int,0),active=coalesce((p_body->>'active')::boolean,true),
    revision=revision+1,updated_at=clock_timestamp(),updated_by=p_actor where id=v_item returning to_jsonb(production_items.*) into v_after;
  else
   if exists(select 1 from public.production_items where store_id=st.id and product_id=p.id) then raise exception 'CONFLICT'; end if;
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
   insert into public.production_counts(organization_id,check_id,item_id,product_id,product_name,category,product_type,sort_order,par_snapshot)
   select st.organization_id,c.id,i.id,i.product_id,pr.name,i.category,i.product_type,i.sort_order,i.par
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
    if (v_change-'id'-'have')<>'{}'::jsonb or not(v_change ? 'have') or not(v_change ? 'id') then raise exception 'VALIDATION_FAILED'; end if;
    if v_change->'have'<>'null'::jsonb and ((v_change->>'have')!~ '^\d{1,4}$' or jsonb_typeof(v_change->'have')<>'number') then raise exception 'VALIDATION_FAILED'; end if;
    select * into n from public.production_counts where id=(v_change->>'id')::uuid and check_id=c.id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    v_count:=(v_change->>'have')::int;
    if n.have is distinct from v_count then
     update public.production_counts set have=v_count where id=n.id;
     insert into public.production_events(organization_id,store_id,check_id,item_id,actor_id,kind,before_value,after_value)
     values(st.organization_id,st.id,c.id,n.item_id,p_actor,'count.updated',jsonb_build_object('have',n.have),
      jsonb_build_object('have',v_count,'make',case when v_count is null then null else greatest(0,n.par_snapshot-v_count) end,'product_name',n.product_name,'revision',c.revision+1));
    end if;
   end loop;
   update public.production_checks set revision=revision+1,updated_at=clock_timestamp() where id=c.id;
  else
   if (p_body-'action'-'check_id'-'expected_revision')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
   if exists(select 1 from public.production_counts where check_id=c.id and have is null) then raise exception 'VALIDATION_FAILED' using detail='Count every item before finishing.'; end if;
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
