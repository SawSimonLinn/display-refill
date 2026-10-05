-- Shared prep ledger; quantities are finished sellable containers.
create table public.production_prep_events (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 organization_id uuid not null,store_id uuid not null,product_id uuid not null,
 quantity integer not null check(quantity between 1 and 9999),actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,product_id) references public.products(organization_id,id)
);
create index production_prep_events_org on public.production_prep_events(organization_id);
create index production_prep_events_product on public.production_prep_events(store_id,product_id,sequence);
alter table public.production_prep_events enable row level security;
revoke all on public.production_prep_events from public,anon,authenticated;
grant select,insert on public.production_prep_events to service_role;
grant usage,select on sequence public.production_prep_events_sequence_seq to service_role;
create trigger production_prep_append_only before update or delete on public.production_prep_events for each row execute function private.reject_mutation();
alter table public.production_counts add column prep_revision bigint not null default 0;
-- Capture which preparation events a new physical count must include.
create function private.production_count_prep_revision() returns trigger language plpgsql set search_path='' as $$
begin
 select coalesce(max(e.sequence),0) into new.prep_revision from public.production_prep_events e join public.production_checks c on c.store_id=e.store_id where c.id=new.check_id and e.product_id=new.product_id;
 return new;
end; $$;
create trigger production_count_prep_baseline before insert on public.production_counts for each row execute function private.production_count_prep_revision();
create function private.production_finish_prep_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='finished' and exists(select 1 from public.production_counts n where n.check_id=new.id and n.prep_revision<>(select coalesce(max(e.sequence),0) from public.production_prep_events e where e.store_id=new.store_id and e.product_id=n.product_id)) then
 raise exception 'CONFLICT' using detail='Someone recorded preparation during this count. Start a fresh count including all ready containers.';
 end if;
 return new;
end; $$;
create trigger production_finish_prep_guard before update on public.production_checks for each row execute function private.production_finish_prep_guard();

create function private.production_prep_payload(p_store uuid) returns jsonb language sql stable set search_path='' as $$
 with latest as (
 select distinct on(section) id,section,finished_at from public.production_checks where store_id=p_store and status='finished' order by section,finished_at desc,id desc
 ), counted as (
 select n.*,l.section,l.finished_at from public.production_counts n join latest l on l.id=n.check_id
 ), grouped as (
 select product_id,min(product_name) product_name,min(category) category,min(product_type) product_type,
 count(*)=max(shared_size) and min(prep_revision)=max(prep_revision) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
 min(prep_revision) baseline, greatest(0,sum(par_snapshot)-sum(have)-coalesce(sum(backup),0)) needed,
 min(finished_at) oldest_count,
 jsonb_agg(jsonb_build_object('section',section,'display_need',greatest(0,par_snapshot-have),'checked_at',finished_at) order by array_position(array['fruit_mobile','salad_mobile','fruit_case','veggie_case'],section)) locations,
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
create function public.production_prep_read(p_actor uuid,p_store uuid) returns jsonb language plpgsql set search_path='' as $$
begin
 if not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 return private.production_prep_payload(p_store);
end; $$;
create function public.production_prep_record(p_actor uuid,p_store uuid,p_product uuid,p_revision text,p_quantity integer,p_done boolean,p_key text)
returns jsonb language plpgsql set search_path='' as $$
declare st public.stores; row jsonb; payload jsonb; amount integer; prior public.idempotency_records; scope text; hash text;
begin
 select * into st from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 if not st.active then raise exception 'VALIDATION_FAILED'; end if;
 if p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,200}$' then raise exception 'VALIDATION_FAILED'; end if;
 scope:='POST /prep/'||p_store;hash:=encode(sha256(convert_to(jsonb_build_array(p_product,p_revision,p_quantity,p_done)::text,'UTF8')),'hex');
 select * into prior from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at>now();
 if found then if prior.request_hash<>hash then raise exception 'CONFLICT'; end if;return prior.response_body;end if;
 select value into row from jsonb_array_elements(private.production_prep_payload(p_store)->'items') where value->>'product_id'=p_product::text;
 if not found then raise exception 'NOT_FOUND'; end if;
 if row->>'revision' is distinct from p_revision or not(row->>'ready')::boolean then raise exception 'CONFLICT'; end if;
 amount:=case when p_done then (row->>'remaining')::int else p_quantity end;
 if amount is null or amount<1 or amount>9999 or amount>(row->>'remaining')::int then raise exception 'VALIDATION_FAILED'; end if;
 insert into public.production_prep_events(organization_id,store_id,product_id,quantity,actor_id) values(st.organization_id,p_store,p_product,amount,p_actor);
 payload:=private.production_prep_payload(p_store);
 delete from public.idempotency_records where actor_id=p_actor and route_scope=scope and key=p_key and expires_at<=now();
 insert into public.idempotency_records(actor_id,route_scope,key,request_hash,resource_id,response_status,response_body) values(p_actor,scope,p_key,hash,p_product,200,payload);
 return payload;
end; $$;
revoke all on function private.production_prep_payload(uuid),public.production_prep_read(uuid,uuid),public.production_prep_record(uuid,uuid,uuid,text,integer,boolean,text) from public,anon,authenticated;
grant execute on function private.production_prep_payload(uuid),public.production_prep_read(uuid,uuid),public.production_prep_record(uuid,uuid,uuid,text,integer,boolean,text) to service_role;
