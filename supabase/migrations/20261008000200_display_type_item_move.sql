-- Admins move a display case type's product up or down one place. The type's items are
-- renumbered 0..n-1 in their current order (sort_order, product name, id) with the two
-- neighbours swapped, so older equal or gapped orders straighten out; only changed rows are
-- written and synced to the stores using the type.

-- Admin writes: save_type {id?, code (create only), name, family, sort_order, active, expected_revision?}
-- and save_item {display_type_id, id?, product_id, par, category, product_type, sort_order, active,
-- expected_revision?} and move_item {display_type_id, id, direction up|down, expected_revision}.
-- Changes reach every store using the type in the same transaction.
create or replace function public.display_type_mutate(p_actor uuid,p_org uuid,p_body jsonb,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare action text; dt public.display_types; old_dt public.display_types; d public.display_type_items; old_d public.display_type_items;
 p public.products; v_store uuid; v_item uuid; v_ids uuid[]; v_before uuid[]; v_pos int; v_swap int;
begin
 perform private.require_org_admin(p_actor,p_org,'manage display case types');
 action:=p_body->>'action';
 if action='save_type' then
  if (p_body-'action'-'id'-'code'-'name'-'family'-'sort_order'-'active'-'expected_revision')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  if p_body ? 'id' then
   select * into old_dt from public.display_types where id=(p_body->>'id')::uuid and organization_id=p_org for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if old_dt.revision is distinct from (p_body->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
   if p_body ? 'code' and p_body->>'code'<>old_dt.code then raise exception 'VALIDATION_FAILED' using detail='The code of a display case type cannot change.',hint='code'; end if;
   update public.display_types set name=btrim(coalesce(p_body->>'name',name)),family=coalesce(p_body->>'family',family),
    sort_order=coalesce((p_body->>'sort_order')::int,sort_order),active=coalesce((p_body->>'active')::boolean,active)
   where id=old_dt.id returning * into dt;
   if dt.active is distinct from old_dt.active then
    for v_store in select store_id from public.store_display_types where display_type_id=dt.id order by store_id loop
     perform 1 from public.stores where id=v_store for update;
     perform private.sync_store_type(v_store,dt.id,p_actor);
    end loop;
   end if;
   insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
   values(p_org,p_actor,'display_type.updated',dt.id,p_request_id,jsonb_build_object('before',to_jsonb(old_dt),'after',to_jsonb(dt)));
  else
   if (p_body->>'code') is null or (p_body->>'code')!~'^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'VALIDATION_FAILED' using detail='Use 2-40 lowercase letters, numbers or underscores, starting with a letter.',hint='code';
   end if;
   insert into public.display_types(organization_id,code,name,family,sort_order,active)
   values(p_org,p_body->>'code',btrim(p_body->>'name'),coalesce(p_body->>'family','Other'),coalesce((p_body->>'sort_order')::int,0),coalesce((p_body->>'active')::boolean,true))
   returning * into dt;
   insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
   values(p_org,p_actor,'display_type.created',dt.id,p_request_id,jsonb_build_object('after',to_jsonb(dt)));
  end if;
 elsif action='save_item' then
  if (p_body-'action'-'id'-'display_type_id'-'product_id'-'par'-'category'-'product_type'-'sort_order'-'active'-'expected_revision')<>'{}'::jsonb then raise exception 'VALIDATION_FAILED'; end if;
  select * into dt from public.display_types where id=(p_body->>'display_type_id')::uuid and organization_id=p_org for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into p from public.products where id=(p_body->>'product_id')::uuid and organization_id=p_org;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (p_body->>'par') is null or (p_body->>'par')!~'^\d{1,4}$' then raise exception 'VALIDATION_FAILED' using hint='par'; end if;
  if p_body ? 'id' then
   select * into old_d from public.display_type_items where id=(p_body->>'id')::uuid and display_type_id=dt.id for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if old_d.revision is distinct from (p_body->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
   if old_d.product_id<>p.id then raise exception 'VALIDATION_FAILED' using hint='product_id'; end if;
   update public.display_type_items set par=(p_body->>'par')::int,category=coalesce(btrim(p_body->>'category'),''),
    product_type=coalesce(btrim(p_body->>'product_type'),''),sort_order=coalesce((p_body->>'sort_order')::int,0),
    active=coalesce((p_body->>'active')::boolean,true),updated_by=p_actor
   where id=old_d.id returning * into d;
  else
   if not p.active then raise exception 'VALIDATION_FAILED' using detail='The product is archived.',hint='product_id'; end if;
   if exists(select 1 from public.display_type_items where display_type_id=dt.id and product_id=p.id) then
    raise exception 'CONFLICT' using detail='This product is already in this display case type.';
   end if;
   insert into public.display_type_items(organization_id,display_type_id,product_id,par,category,product_type,sort_order,active,updated_by)
   values(p_org,dt.id,p.id,(p_body->>'par')::int,coalesce(btrim(p_body->>'category'),''),coalesce(btrim(p_body->>'product_type'),''),
    coalesce((p_body->>'sort_order')::int,0),coalesce((p_body->>'active')::boolean,true),p_actor)
   returning * into d;
  end if;
  for v_store in select store_id from public.store_display_types where display_type_id=dt.id order by store_id loop
   perform 1 from public.stores where id=v_store for update;
   perform private.sync_store_item(v_store,d.id,p_actor);
  end loop;
  insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
  values(p_org,p_actor,'display_type.item_saved',d.id,p_request_id,jsonb_build_object('display_type_id',dt.id,'product_name',p.name,
   'before',case when old_d.id is null then null else to_jsonb(old_d) end,'after',to_jsonb(d)));
 elsif action='move_item' then
  if (p_body-'action'-'display_type_id'-'id'-'direction'-'expected_revision')<>'{}'::jsonb or coalesce(p_body->>'direction','') not in ('up','down') then
   raise exception 'VALIDATION_FAILED';
  end if;
  select * into dt from public.display_types where id=(p_body->>'display_type_id')::uuid and organization_id=p_org for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into old_d from public.display_type_items where id=(p_body->>'id')::uuid and display_type_id=dt.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if old_d.revision is distinct from (p_body->>'expected_revision')::int then raise exception 'CONFLICT'; end if;
  select array_agg(d2.id order by d2.sort_order,p2.name,d2.id) into v_before
  from public.display_type_items d2 join public.products p2 on p2.id=d2.product_id where d2.display_type_id=dt.id;
  v_ids:=v_before;
  v_pos:=array_position(v_ids,old_d.id);
  v_swap:=v_pos+case when p_body->>'direction'='up' then -1 else 1 end;
  if v_swap>=1 and v_swap<=cardinality(v_ids) then
   v_ids[v_pos]:=v_ids[v_swap]; v_ids[v_swap]:=old_d.id;
  end if;
  for v_n in 1..cardinality(v_ids) loop
   update public.display_type_items set sort_order=v_n-1,updated_by=p_actor where id=v_ids[v_n] and sort_order<>v_n-1;
   if found then
    for v_store in select store_id from public.store_display_types where display_type_id=dt.id order by store_id loop
     perform 1 from public.stores where id=v_store for update;
     perform private.sync_store_item(v_store,v_ids[v_n],p_actor);
    end loop;
   end if;
  end loop;
  if v_ids is distinct from v_before then
   insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
   values(p_org,p_actor,'display_type.items_reordered',dt.id,p_request_id,jsonb_build_object('item_id',old_d.id,'direction',p_body->>'direction','before',v_before,'after',v_ids));
  end if;
 else
  raise exception 'VALIDATION_FAILED';
 end if;
 return public.display_types_read(p_actor,p_org);
exception
 when unique_violation then raise exception 'VALIDATION_FAILED' using errcode='P0001',detail='Another display case type already uses this code.',hint='code';
 when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'VALIDATION_FAILED';
end; $$;
