-- Do not offer archived products for prep; changed section membership requires new counts.
create or replace function private.production_prep_payload(p_store uuid) returns jsonb language sql stable set search_path='' as $$
 with latest as (
 select distinct on(section) id,section,finished_at from public.production_checks where store_id=p_store and status='finished' order by section,finished_at desc,id desc
 ), counted as (
 select n.*,l.section,l.finished_at from public.production_counts n join latest l on l.id=n.check_id join public.production_items i on i.id=n.item_id and i.active join public.products pr on pr.id=n.product_id and pr.active
 ), grouped as (
 select product_id,min(product_name) product_name,min(category) category,min(product_type) product_type,
 count(*)=(select count(*) from public.production_items active_item where active_item.store_id=p_store and active_item.product_id=counted.product_id and active_item.active)
 and count(*)=max(shared_size) and min(prep_revision)=max(prep_revision) and (max(shared_size)=1 or count(*) filter(where backup_required and backup is not null)=1) ready,
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
create or replace function private.guard_production_check() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'draft' then raise exception 'IMMUTABLE'; end if;
 if (to_jsonb(new)-'revision'-'updated_at'-'finished_at'-'status') is distinct from (to_jsonb(old)-'revision'-'updated_at'-'finished_at'-'status') then raise exception 'IMMUTABLE'; end if;
 if new.status='finished' and (not exists(select 1 from public.production_counts where check_id=new.id) or exists(select 1 from public.production_counts where check_id=new.id and (have is null or (backup_required and backup is null)))) then raise exception 'VALIDATION_FAILED'; end if;
 return new;
end; $$;

revoke all on function private.production_count_prep_revision(),private.production_finish_prep_guard() from public,anon,authenticated;
grant execute on function private.production_count_prep_revision(),private.production_finish_prep_guard() to service_role;
