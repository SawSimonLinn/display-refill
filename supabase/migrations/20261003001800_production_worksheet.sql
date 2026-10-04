-- Additive worksheet flow. No published POGs, scans or historical results are changed.
create table public.production_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 store_id uuid not null, product_id uuid not null,
 section text not null check(section in ('fruit_mobile','salad_mobile','fruit_case','veggie_case')),
 par integer not null check(par between 0 and 9999), category text not null default '' check(length(category)<=100),
 product_type text not null default '' check(length(product_type)<=100), sort_order integer not null default 0 check(sort_order between 0 and 999),
 active boolean not null default true, revision integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid not null references auth.users(id),
 unique(store_id,product_id), unique(organization_id,id), unique(store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
);
create index production_items_org on public.production_items(organization_id);
create table public.production_checks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 section text not null check(section in ('fruit_mobile','salad_mobile','fruit_case','veggie_case')),
 business_date date not null, status text not null default 'draft' check(status in ('draft','finished')),
 revision integer not null default 1, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
 unique(organization_id,id), unique(store_id,id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 check((status='draft' and finished_at is null) or (status='finished' and finished_at is not null))
);
create index production_checks_org on public.production_checks(organization_id);
create index production_checks_day on public.production_checks(store_id,business_date,section,finished_at desc,id desc);
create unique index production_checks_draft on public.production_checks(store_id,section,business_date,created_by) where status='draft';
create table public.production_counts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, check_id uuid not null,
 item_id uuid not null, product_id uuid not null, product_name text not null,
 category text not null, product_type text not null, sort_order integer not null,
 par_snapshot integer not null check(par_snapshot between 0 and 9999), have integer check(have between 0 and 9999),
 make integer generated always as (case when have is null then null else greatest(0,par_snapshot-have) end) stored,
 unique(check_id,item_id),
 foreign key(organization_id,check_id) references public.production_checks(organization_id,id),
 foreign key(organization_id,item_id) references public.production_items(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
);
create index production_counts_org on public.production_counts(organization_id);
create table public.production_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 check_id uuid, item_id uuid, actor_id uuid not null references auth.users(id),
 kind text not null check(kind in ('par.updated','count.updated','check.started','check.finished')),
 before_value jsonb, after_value jsonb, created_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(store_id,check_id) references public.production_checks(store_id,id),
 foreign key(store_id,item_id) references public.production_items(store_id,id)
);
create index production_events_org on public.production_events(organization_id);
create index production_events_store on public.production_events(store_id,created_at desc,id desc);
create trigger production_events_append_only before update or delete on public.production_events for each row execute function private.reject_mutation();
alter table public.production_items enable row level security;
alter table public.production_checks enable row level security;
alter table public.production_counts enable row level security;
alter table public.production_events enable row level security;
revoke all on public.production_items,public.production_checks,public.production_counts,public.production_events from public,anon,authenticated;
grant select,insert,update,delete on public.production_items,public.production_checks,public.production_counts,public.production_events to service_role;

create function private.guard_production_count() returns trigger language plpgsql set search_path='' as $$
declare c public.production_checks; i public.production_items;
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE'; end if;
 select * into c from public.production_checks where id=new.check_id for update;
 select * into i from public.production_items where id=new.item_id;
 if c.status<>'draft' then raise exception 'IMMUTABLE'; end if;
 if i.store_id<>c.store_id or i.product_id<>new.product_id then raise exception 'VALIDATION_FAILED'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'have'-'make') is distinct from (to_jsonb(old)-'have'-'make') then raise exception 'IMMUTABLE'; end if;
 return new;
end; $$;
create trigger production_count_guard before insert or update or delete on public.production_counts for each row execute function private.guard_production_count();
create function private.guard_production_check() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status='finished' then raise exception 'IMMUTABLE'; end if;
 if (to_jsonb(new)-'revision'-'updated_at'-'finished_at'-'status') is distinct from (to_jsonb(old)-'revision'-'updated_at'-'finished_at'-'status') then raise exception 'IMMUTABLE'; end if;
 if new.status='finished' and (not exists(select 1 from public.production_counts where check_id=new.id) or exists(select 1 from public.production_counts where check_id=new.id and have is null)) then raise exception 'VALIDATION_FAILED'; end if;
 return new;
end; $$;
create trigger production_check_guard before update or delete on public.production_checks for each row execute function private.guard_production_check();

create function private.production_check_payload(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'store_id',c.store_id,'section',c.section,'business_date',c.business_date,
 'revision',c.revision,'status',c.status,'updated_at',c.updated_at,'finished_at',c.finished_at,'created_by',c.created_by,
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'product_id',n.product_id,'product_name',n.product_name,
 'category',n.category,'product_type',n.product_type,'sort_order',n.sort_order,'have',n.have,'make',n.make) order by n.sort_order,n.id)
 from public.production_counts n where n.check_id=c.id),'[]'::jsonb),
 'total_make',(select case when bool_or(n.have is null) then null else sum(n.make) end from public.production_counts n where n.check_id=c.id))
 from public.production_checks c where c.id=p_id;
$$;
create function private.production_config_payload(p_store uuid,p_manager boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('can_manage',p_manager,'items',coalesce(jsonb_agg(
 (jsonb_build_object('id',i.id,'product_id',i.product_id,'product_name',p.name,'section',i.section,'category',i.category,
 'product_type',i.product_type,'sort_order',i.sort_order,'active',i.active,'revision',i.revision,
 'updated_at',i.updated_at,'updated_by',i.updated_by) || case when p_manager then jsonb_build_object('par',i.par) else '{}'::jsonb end)
 order by i.section,i.sort_order,i.id),'[]'::jsonb)) from public.production_items i join public.products p on p.id=i.product_id
 where i.store_id=p_store and (p_manager or i.active);
$$;

-- All read views share the same fresh stored-store authorization, including PAR/audit.
create function public.production_read(p_actor uuid,p_store uuid,p_view text default 'day',p_check uuid default null)
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
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'check_id',c.id,'finished_at',c.finished_at,'items',v_payload->'items','total_make',v_payload->'total_make'));
  else
   v_complete:=false;
   v_sections:=v_sections || jsonb_build_array(jsonb_build_object('section',v_section,'check_id',null,'finished_at',null,'items','[]'::jsonb,'total_make',null));
  end if;
 end loop;
 return jsonb_build_object('date',v_day,'sections',v_sections,'total_make',v_total,'complete',v_complete);
end; $$;

create function public.production_mutate(p_actor uuid,p_store uuid,p_body jsonb,p_key text,p_request_id uuid default null)
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
revoke all on function private.guard_production_count(),private.guard_production_check(),private.production_check_payload(uuid),private.production_config_payload(uuid,boolean) from public,anon,authenticated;
grant execute on function private.guard_production_count(),private.guard_production_check(),private.production_check_payload(uuid),private.production_config_payload(uuid,boolean) to service_role;
revoke all on function public.production_read(uuid,uuid,text,uuid),public.production_mutate(uuid,uuid,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.production_read(uuid,uuid,text,uuid),public.production_mutate(uuid,uuid,jsonb,text,uuid) to service_role;
