-- Feature 16 unit 1: organization display case types replace the four fixed sections.
-- Type codes are the existing section identifiers, so production rows, POG kinds,
-- clients and history keep their values. Admin type items hold default PAR; stores copy
-- them into production_items on selection and follow admin edits unless PAR is overridden.

create table public.display_types (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 code text not null check(code ~ '^[a-z][a-z0-9_]{1,39}$'),
 name text not null check(length(btrim(name)) between 1 and 80),
 family text not null default 'Other' check(family in ('Fruit','Vegetables','Salads','Other')),
 sort_order integer not null default 0 check(sort_order between 0 and 999),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 unique(organization_id,code), unique(organization_id,id)
);
create trigger display_types_touch before update on public.display_types for each row execute function private.touch_row();

-- The code is stored in production rows and POG kinds; it never changes.
create function private.guard_display_type() returns trigger language plpgsql set search_path='' as $$
begin
 if new.code<>old.code or new.organization_id<>old.organization_id then
  raise exception 'display type code and organization are immutable' using errcode='P0001';
 end if;
 return new;
end; $$;
create trigger display_types_guard before update on public.display_types for each row execute function private.guard_display_type();

create table public.display_type_items (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 display_type_id uuid not null,
 product_id uuid not null,
 par integer not null check(par between 0 and 9999),
 category text not null default '' check(length(category)<=100),
 product_type text not null default '' check(length(product_type)<=100),
 sort_order integer not null default 0 check(sort_order between 0 and 999),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 -- Null only for rows converted from existing store sections by this migration.
 updated_by uuid references auth.users(id),
 unique(display_type_id,product_id), unique(organization_id,id),
 foreign key(organization_id,display_type_id) references public.display_types(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
);
create index display_type_items_org on public.display_type_items(organization_id);
create trigger display_type_items_touch before update on public.display_type_items for each row execute function private.touch_row();

create table public.store_display_types (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 store_id uuid not null,
 display_type_id uuid not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 -- Null for selections made by the store-creation trigger or this migration.
 updated_by uuid references auth.users(id),
 unique(store_id,display_type_id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,display_type_id) references public.display_types(organization_id,id)
);
create index store_display_types_org on public.store_display_types(organization_id);
create index store_display_types_type on public.store_display_types(display_type_id);
create trigger store_display_types_touch before update on public.store_display_types for each row execute function private.touch_row();

alter table public.display_types enable row level security;
alter table public.display_type_items enable row level security;
alter table public.store_display_types enable row level security;
revoke all on public.display_types,public.display_type_items,public.store_display_types from public,anon,authenticated;
grant select,insert,update,delete on public.display_types,public.display_type_items,public.store_display_types to service_role;

-- Existing organizations get the four sections as their first types.
create function private.default_display_types(p_org uuid) returns void language sql set search_path='' as $$
 insert into public.display_types(organization_id,code,name,family,sort_order)
 select p_org,t.code,t.name,t.family,t.sort_order from (values
  ('fruit_mobile','M1 Bunker (Fruit)','Fruit',10),('salad_mobile','Salad Destination','Salads',20),
  ('fruit_case','6ft Fruit','Fruit',30),('veggie_case','Veggie Display Case','Vegetables',40)) t(code,name,family,sort_order)
 on conflict (organization_id,code) do nothing;
$$;
select private.default_display_types(id) from public.organizations;

-- Production rows and POG kinds now reference a type of their own organization.
alter table public.production_items drop constraint production_items_section_check;
alter table public.production_checks drop constraint production_checks_section_check;
alter table public.pogs drop constraint pogs_kind_check;
alter table public.production_items add constraint production_items_section_fkey foreign key(organization_id,section) references public.display_types(organization_id,code);
alter table public.production_checks add constraint production_checks_section_fkey foreign key(organization_id,section) references public.display_types(organization_id,code);
alter table public.pogs add constraint pogs_kind_fkey foreign key(organization_id,kind) references public.display_types(organization_id,code);

alter table public.production_items
 add column template_item_id uuid,
 add column par_overridden boolean not null default false,
 alter column updated_by drop not null,
 add constraint production_items_template_fkey foreign key(organization_id,template_item_id) references public.display_type_items(organization_id,id);
create index production_items_template on public.production_items(template_item_id);
comment on column public.production_items.updated_by is 'Null only for rows copied from a display type by the system (store creation).';

-- Convert: each (organization, section, product) becomes a type item. The default PAR comes
-- from the most recently edited active row; stores with a different PAR keep it as an override.
insert into public.display_type_items(organization_id,display_type_id,product_id,par,category,product_type,sort_order,active)
select distinct on (i.organization_id,i.section,i.product_id) i.organization_id,t.id,i.product_id,i.par,i.category,i.product_type,i.sort_order,i.active
from public.production_items i join public.display_types t on t.organization_id=i.organization_id and t.code=i.section
order by i.organization_id,i.section,i.product_id,i.active desc,i.updated_at desc,i.id;

update public.production_items i set template_item_id=d.id,par_overridden=(i.par<>d.par)
from public.display_type_items d join public.display_types t on t.id=d.display_type_id
where d.organization_id=i.organization_id and t.code=i.section and d.product_id=i.product_id;

-- Every existing store had all four sections; keep that.
insert into public.store_display_types(organization_id,store_id,display_type_id)
select s.organization_id,s.id,t.id from public.stores s join public.display_types t on t.organization_id=s.organization_id;

-- Section helpers. section_order ranks every type of the store's organization (history may
-- name a type the store no longer uses); store_section_codes lists the store's current types.
create function private.section_order(p_store uuid) returns text[] language sql stable set search_path='' as $$
 select coalesce(array_agg(t.code order by t.sort_order,t.code),'{}') from public.stores s
 join public.display_types t on t.organization_id=s.organization_id where s.id=p_store;
$$;
create function private.store_section_codes(p_store uuid) returns text[] language sql stable set search_path='' as $$
 select coalesce(array_agg(t.code order by t.sort_order,t.code),'{}') from public.store_display_types s
 join public.display_types t on t.id=s.display_type_id where s.store_id=p_store and s.active and t.active;
$$;
create function private.section_name(p_org uuid,p_code text) returns text language sql stable set search_path='' as $$
 select name from public.display_types where organization_id=p_org and code=p_code;
$$;

-- Bring one store's row for one type item in line with the item, the type and the store's
-- selection. Adopting an existing manual row keeps its PAR (as an override when it differs).
-- PAR changes are logged like manager edits; started checks keep their snapshots. A null actor
-- (copies made when a store is created) is not a person's edit and writes no PAR event.
create function private.sync_store_item(p_store uuid,p_item uuid,p_actor uuid) returns void language plpgsql set search_path='' as $$
declare t public.display_type_items; dt public.display_types; old_i public.production_items; v_active boolean;
 v_par integer; v_overridden boolean; v_after jsonb; v_id uuid; v_name text;
begin
 select * into t from public.display_type_items where id=p_item;
 select * into dt from public.display_types where id=t.display_type_id;
 select name into v_name from public.products where id=t.product_id;
 v_active:=t.active and dt.active and exists(select 1 from public.store_display_types s where s.store_id=p_store and s.display_type_id=dt.id and s.active);
 select * into old_i from public.production_items where store_id=p_store and product_id=t.product_id and section=dt.code for update;
 if not found then
  if not v_active then return; end if;
  insert into public.production_items(organization_id,store_id,product_id,section,par,category,product_type,sort_order,active,updated_by,template_item_id)
  values(t.organization_id,p_store,t.product_id,dt.code,t.par,t.category,t.product_type,t.sort_order,true,p_actor,t.id)
  returning id,to_jsonb(production_items.*) into v_id,v_after;
  if p_actor is not null then
   insert into public.production_events(organization_id,store_id,item_id,actor_id,kind,before_value,after_value)
   values(t.organization_id,p_store,v_id,p_actor,'par.updated',null,v_after || jsonb_build_object('product_name',v_name,'source','display_type'));
  end if;
  return;
 end if;
 if old_i.template_item_id is distinct from t.id then
  v_par:=old_i.par; v_overridden:=old_i.par<>t.par;
 elsif old_i.par_overridden then
  v_par:=old_i.par; v_overridden:=true;
 else
  v_par:=t.par; v_overridden:=false;
 end if;
 if (old_i.template_item_id,old_i.par,old_i.par_overridden,old_i.category,old_i.product_type,old_i.sort_order,old_i.active)
  is not distinct from (t.id,v_par,v_overridden,t.category,t.product_type,t.sort_order,v_active) then return; end if;
 update public.production_items set template_item_id=t.id,par=v_par,par_overridden=v_overridden,category=t.category,
  product_type=t.product_type,sort_order=t.sort_order,active=v_active,revision=revision+1,updated_at=clock_timestamp(),
  updated_by=coalesce(p_actor,updated_by)
 where id=old_i.id returning to_jsonb(production_items.*) into v_after;
 if p_actor is not null then
  insert into public.production_events(organization_id,store_id,item_id,actor_id,kind,before_value,after_value)
  values(t.organization_id,p_store,old_i.id,p_actor,'par.updated',to_jsonb(old_i),v_after || jsonb_build_object('product_name',v_name,'source','display_type'));
 end if;
end; $$;

-- Apply a store's current selection of one type: sync its items and, when the type is no
-- longer used, deactivate the store's other (manually added) rows in that section.
create function private.sync_store_type(p_store uuid,p_type uuid,p_actor uuid) returns void language plpgsql set search_path='' as $$
declare dt public.display_types; v_item uuid; old_i public.production_items; v_after jsonb;
begin
 select * into dt from public.display_types where id=p_type;
 for v_item in select id from public.display_type_items where display_type_id=p_type order by sort_order,id loop
  perform private.sync_store_item(p_store,v_item,p_actor);
 end loop;
 if not (dt.code = any(private.store_section_codes(p_store))) then
  for old_i in select * from public.production_items where store_id=p_store and section=dt.code and active and template_item_id is null for update loop
   update public.production_items set active=false,revision=revision+1,updated_at=clock_timestamp(),updated_by=coalesce(p_actor,updated_by)
   where id=old_i.id returning to_jsonb(production_items.*) into v_after;
   if p_actor is not null then
    insert into public.production_events(organization_id,store_id,item_id,actor_id,kind,before_value,after_value)
    values(old_i.organization_id,p_store,old_i.id,p_actor,'par.updated',to_jsonb(old_i),v_after || jsonb_build_object('source','display_type'));
   end if;
  end loop;
 end if;
end; $$;

-- New organizations start with the standard types; new stores use every active type.
create function private.organization_default_types() returns trigger language plpgsql set search_path='' as $$
begin perform private.default_display_types(new.id); return null; end; $$;
create trigger organizations_default_types after insert on public.organizations for each row execute function private.organization_default_types();

create function private.store_default_types() returns trigger language plpgsql set search_path='' as $$
declare v_type uuid;
begin
 for v_type in insert into public.store_display_types(organization_id,store_id,display_type_id)
  select new.organization_id,new.id,t.id from public.display_types t where t.organization_id=new.organization_id and t.active returning display_type_id
 loop perform private.sync_store_type(new.id,v_type,null); end loop;
 return null;
end; $$;
create trigger stores_default_types after insert on public.stores for each row execute function private.store_default_types();

create or replace function private.clean_pog_kind(p_value text) returns text language plpgsql stable set search_path='' as $$
begin
 if p_value is null or not exists(select 1 from public.display_types where code=p_value and active) then
  raise exception 'VALIDATION_FAILED' using errcode='P0001', detail='kind must be an active display case type', hint='kind';
 end if;
 return p_value;
end; $$;

-- Configuration now lists the organization's active types (with the store's selection) and,
-- for managers, each item's default PAR and whether the store overrides it.
create or replace function private.production_config_payload(p_store uuid,p_manager boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('can_manage',p_manager,
 'sections',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'family',t.family,
   'selected',coalesce(s.active,false)) order by t.sort_order,t.code)
  from public.stores st join public.display_types t on t.organization_id=st.organization_id and t.active
  left join public.store_display_types s on s.store_id=st.id and s.display_type_id=t.id where st.id=p_store),'[]'::jsonb),
 'items',coalesce(jsonb_agg(
 (jsonb_build_object('id',i.id,'product_id',i.product_id,'product_name',p.name,'section',i.section,'category',i.category,
 'product_type',i.product_type,'sort_order',i.sort_order,'active',i.active,'revision',i.revision,
 'updated_at',i.updated_at,'updated_by',i.updated_by) || case when p_manager then jsonb_build_object('par',i.par,
 'from_display_type',i.template_item_id is not null,'par_overridden',i.par_overridden,'default_par',d.par) else '{}'::jsonb end)
 order by i.section,i.sort_order,i.id),'[]'::jsonb))
 from public.production_items i join public.products p on p.id=i.product_id left join public.display_type_items d on d.id=i.template_item_id
 where i.store_id=p_store and (p_manager or i.active);
$$;

-- Organization types with their items. Members see active types; admins see everything,
-- including archived types and item PAR.
create function public.display_types_read(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare v_admin boolean;
begin
 if not private.is_org_member(p_actor,p_org) then raise exception 'NOT_FOUND'; end if;
 v_admin:=private.is_org_admin(p_actor,p_org);
 return jsonb_build_object('can_manage',v_admin,'types',coalesce((select jsonb_agg(jsonb_build_object(
  'id',t.id,'code',t.code,'name',t.name,'family',t.family,'sort_order',t.sort_order,'active',t.active,'revision',t.revision,
  'store_count',(select count(*) from public.store_display_types s where s.display_type_id=t.id and s.active),
  'items',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'product_id',d.product_id,'product_name',p.name,
   'product_active',p.active,'par',d.par,'category',d.category,'product_type',d.product_type,'sort_order',d.sort_order,
   'active',d.active,'revision',d.revision,'updated_at',d.updated_at) order by d.sort_order,p.name,d.id)
   from public.display_type_items d join public.products p on p.id=d.product_id where d.display_type_id=t.id),'[]'::jsonb) else null end
  ) order by t.sort_order,t.code) from public.display_types t where t.organization_id=p_org and (v_admin or t.active)),'[]'::jsonb));
end; $$;

-- Admin writes: save_type {id?, code (create only), name, family, sort_order, active, expected_revision?}
-- and save_item {display_type_id, id?, product_id, par, category, product_type, sort_order, active,
-- expected_revision?}. Changes reach every store using the type in the same transaction.
create function public.display_type_mutate(p_actor uuid,p_org uuid,p_body jsonb,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare action text; dt public.display_types; old_dt public.display_types; d public.display_type_items; old_d public.display_type_items;
 p public.products; v_store uuid; v_item uuid;
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
 else
  raise exception 'VALIDATION_FAILED';
 end if;
 return public.display_types_read(p_actor,p_org);
exception
 when unique_violation then raise exception 'VALIDATION_FAILED' using errcode='P0001',detail='Another display case type already uses this code.',hint='code';
 when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'VALIDATION_FAILED';
end; $$;

-- Store manager (or org admin) picks the store's types: p_type_ids is a JSON array of type IDs.
-- Unselected types keep their history; their items are deactivated.
create function public.store_display_types_set(p_actor uuid,p_store uuid,p_type_ids jsonb,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; v_ids uuid[]; v_before uuid[]; v_type uuid;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,st.id) then raise exception 'NOT_FOUND'; end if;
 if not private.is_store_manager(p_actor,st.id) then raise exception 'FORBIDDEN'; end if;
 if not st.active then raise exception 'VALIDATION_FAILED' using detail='This store is archived.'; end if;
 if jsonb_typeof(p_type_ids) is distinct from 'array' or jsonb_array_length(p_type_ids) not between 1 and 50 then
  raise exception 'VALIDATION_FAILED' using detail='Choose at least one display case type.',hint='display_type_ids';
 end if;
 select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p_type_ids) x;
 if (select count(*) from public.display_types t where t.id=any(v_ids) and t.organization_id=st.organization_id and t.active)<>cardinality(v_ids) then
  raise exception 'NOT_FOUND';
 end if;
 select coalesce(array_agg(display_type_id order by display_type_id),'{}') into v_before from public.store_display_types where store_id=st.id and active;
 insert into public.store_display_types(organization_id,store_id,display_type_id,active,updated_by)
 select st.organization_id,st.id,t,true,p_actor from unnest(v_ids) t
 on conflict(store_id,display_type_id) do update set active=true,updated_by=p_actor where not store_display_types.active;
 update public.store_display_types set active=false,updated_by=p_actor where store_id=st.id and active and not (display_type_id=any(v_ids));
 for v_type in select display_type_id from public.store_display_types where store_id=st.id order by display_type_id loop
  perform private.sync_store_type(st.id,v_type,p_actor);
 end loop;
 if v_before is distinct from (select array_agg(x order by x) from unnest(v_ids) x) then
  insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
  values(st.organization_id,st.id,p_actor,'store.display_types_updated',st.id,p_request_id,jsonb_build_object('before',v_before,'after',v_ids));
 end if;
 return private.production_config_payload(st.id,true);
exception when invalid_text_representation then raise exception 'NOT_FOUND';
end; $$;

revoke all on function private.default_display_types(uuid),private.section_order(uuid),private.store_section_codes(uuid),private.section_name(uuid,text),
 private.sync_store_item(uuid,uuid,uuid),private.sync_store_type(uuid,uuid,uuid),private.organization_default_types(),private.store_default_types(),
 private.guard_display_type() from public,anon,authenticated;
grant execute on function private.default_display_types(uuid),private.section_order(uuid),private.store_section_codes(uuid),private.section_name(uuid,text),
 private.sync_store_item(uuid,uuid,uuid),private.sync_store_type(uuid,uuid,uuid),private.organization_default_types(),private.store_default_types(),
 private.guard_display_type() to service_role;
revoke all on function public.display_types_read(uuid,uuid),public.display_type_mutate(uuid,uuid,jsonb,uuid),
 public.store_display_types_set(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.display_types_read(uuid,uuid),public.display_type_mutate(uuid,uuid,jsonb,uuid),
 public.store_display_types_set(uuid,uuid,jsonb,uuid) to service_role;

-- Production functions below: the fixed section list becomes the store's types.

CREATE OR REPLACE FUNCTION private.production_base_read(p_actor uuid, p_store uuid, p_view text DEFAULT 'day'::text, p_check uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 foreach v_section in array private.store_section_codes(st.id) loop
  select * into c from public.production_checks where store_id=st.id and section=v_section and business_date=v_day and status='finished' and kind='section' order by finished_at desc,id desc limit 1;
  if found then
   v_payload:=private.production_check_payload(c.id);
   v_total:=v_total+(v_payload->>'total_make')::bigint;
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'name',private.section_name(st.organization_id,v_section),'check_id',c.id,'finished_at',c.finished_at,'items',v_payload->'items','total_make',v_payload->'total_make','in_progress',exists(select 1 from public.production_checks d where d.store_id=st.id and d.section=v_section and d.business_date=v_day and d.status='draft')));
  else
   v_complete:=false;
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'name',private.section_name(st.organization_id,v_section),'check_id',null,'finished_at',null,'items','[]'::jsonb,'total_make',null,'in_progress',exists(select 1 from public.production_checks d where d.store_id=st.id and d.section=v_section and d.business_date=v_day and d.status='draft')));
  end if;
 end loop;
 return jsonb_build_object('date',v_day,'sections',v_sections,'total_make',v_total,'complete',v_complete);
end; $function$;

CREATE OR REPLACE FUNCTION private.production_allocations(p_store uuid, p_day date)
 RETURNS TABLE(count_id uuid, adjusted_make bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with latest as (
 select distinct on(section) id,section from public.production_checks where store_id=p_store and business_date=p_day and status='finished' and kind='section' order by section,finished_at desc,id desc
 ), rows as (
 select pc.*,l.section,array_position(private.section_order(p_store),l.section) ordering from public.production_counts pc join latest l on l.id=pc.check_id
 ), groups as (
 select product_id, count(*)=max(shared_size) and bool_and(have is not null) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
 sum(greatest(0,have-par_snapshot))+coalesce(sum(backup),0) credit from rows group by product_id
 ), ranked as (
 select r.*,g.ready,g.credit,coalesce(sum(greatest(0,par_snapshot-have)) over(partition by r.product_id order by ordering rows between unbounded preceding and 1 preceding),0) previous_need from rows r join groups g on g.product_id=r.product_id
 ) select id,case when not ready then null else greatest(0,greatest(0,par_snapshot-have)-greatest(0,credit-previous_need))::bigint end from ranked;
$function$;

CREATE OR REPLACE FUNCTION private.production_prep_payload(p_store uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with latest as (
 select distinct on(n.product_id,c.section) n.id count_id,c.section,c.finished_at from public.production_counts n join public.production_checks c on c.id=n.check_id where c.store_id=p_store and c.status='finished' and n.have is not null order by n.product_id,c.section,c.finished_at desc,c.id desc
 ), counted as (
 select n.*,l.section,l.finished_at from public.production_counts n join latest l on l.count_id=n.id join public.production_items i on i.id=n.item_id and i.active join public.products pr on pr.id=n.product_id and pr.active
 ), grouped as (
 select product_id,min(product_name) product_name,min(category) category,min(product_type) product_type,
 count(*)=(select count(*) from public.production_items active_item where active_item.store_id=p_store and active_item.product_id=counted.product_id and active_item.active) ready,
 max(prep_revision) baseline, greatest(0,sum(par_snapshot)-sum(have)-coalesce(sum(backup),0)) needed,
 min(finished_at) oldest_count,
 jsonb_agg(jsonb_build_object('section',section,'have',have,'backup',backup,'backup_required',backup_required,'display_need',greatest(0,par_snapshot-have),'checked_at',finished_at) order by array_position(private.section_order(p_store),section)) locations,
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
 'missing_sections',coalesce((select jsonb_agg(s) from unnest(private.store_section_codes(p_store)) s where not exists(select 1 from latest l where l.section=s)),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.production_stock_record(p_actor uuid, p_store uuid, p_product uuid, p_revision text, p_counts jsonb, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 select count(*),(array_agg(section order by array_position(private.section_order(p_store),section)))[1] into size,first_section from public.production_items where store_id=p_store and product_id=p_product and active;
 if size=0 or jsonb_array_length(p_counts)<>size or (select count(distinct value->>'section') from jsonb_array_elements(p_counts))<>size then raise exception 'VALIDATION_FAILED';end if;
 for i in select pi.*,pr.name from public.production_items pi join public.products pr on pr.id=pi.product_id and pr.active where pi.store_id=p_store and pi.product_id=p_product and pi.active order by array_position(private.section_order(p_store),pi.section) loop
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
end; $function$;

CREATE OR REPLACE FUNCTION public.production_mutate(p_actor uuid, p_store uuid, p_body jsonb, p_key text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if v_section is null or not (v_section = any(private.store_section_codes(st.id))) or
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
   if old_i.template_item_id is not null and old_i.section<>v_section then raise exception 'VALIDATION_FAILED' using detail='This item comes from its display case type. Ask an admin to move it.'; end if;
   if (old_i.section<>v_section or old_i.active is distinct from coalesce((p_body->>'active')::boolean,true)) and exists(select 1 from public.production_counts counted join public.production_checks ch on ch.id=counted.check_id where counted.product_id=old_i.product_id and ch.store_id=st.id and ch.business_date=v_day) then
    raise exception 'VALIDATION_FAILED' using detail='This product was already counted or started today. Move it to a different section tomorrow to avoid double counting.';
   end if;
   v_before:=to_jsonb(old_i);
   update public.production_items set section=v_section,par=(p_body->>'par')::int,
    par_overridden=(template_item_id is not null and (p_body->>'par')::int is distinct from (select d.par from public.display_type_items d where d.id=template_item_id)),
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
  if v_section is null or not (v_section = any(private.store_section_codes(st.id))) then raise exception 'VALIDATION_FAILED'; end if;
  select * into c from public.production_checks where store_id=st.id and section=v_section and business_date=v_day and created_by=p_actor and status='draft' for update;
  if not found then
   if not exists(select 1 from public.production_items i join public.products pr on pr.id=i.product_id where i.store_id=st.id and i.section=v_section and i.active and pr.active) then raise exception 'VALIDATION_FAILED' using detail='Ask your manager to set up products and PAR for this section.'; end if;
   insert into public.production_checks(organization_id,store_id,section,business_date,created_by)
   values(st.organization_id,st.id,v_section,v_day,p_actor) returning * into c;
   insert into public.production_counts(organization_id,check_id,item_id,product_id,product_name,category,product_type,sort_order,par_snapshot,shared_size,backup_required)
   select st.organization_id,c.id,i.id,i.product_id,pr.name,i.category,i.product_type,i.sort_order,i.par,
    (select count(*) from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active),
    ((select count(*) from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active)>1 and i.section=(select siblings.section from public.production_items siblings where siblings.store_id=st.id and siblings.product_id=i.product_id and siblings.active order by array_position(private.section_order(st.id),siblings.section) limit 1))
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
end; $function$;

CREATE OR REPLACE FUNCTION private.production_operations_payload(p_actor uuid, p_store uuid, p_day date, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
   (array_agg(t.family order by array_position(array['Fruit','Vegetables','Salads','Other'],t.family)))[1] family
  from public.production_items i join public.products p on p.id=i.product_id join public.display_types t on t.organization_id=i.organization_id and t.code=i.section where i.store_id=p_store and i.active and p.active group by i.product_id
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
end; $function$;
