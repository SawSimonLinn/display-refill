-- Show the server-calculated shortage for this section without waiting for another section.
-- Preserve historical counts/backup and grouped prep calculations.
create or replace function private.production_check_payload(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'store_id',c.store_id,'section',c.section,'business_date',c.business_date,
 'revision',c.revision,'status',c.status,'updated_at',c.updated_at,'finished_at',c.finished_at,'created_by',c.created_by,
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'product_id',n.product_id,'product_name',n.product_name,
 'category',n.category,'product_type',n.product_type,'sort_order',n.sort_order,'have',n.have,'backup',n.backup,'backup_required',n.backup_required,'shared_size',n.shared_size,'make',n.make) order by n.sort_order,n.id)
 from public.production_counts n where n.check_id=c.id),'[]'::jsonb),
 'total_make',(select case when bool_or(n.have is null) then null else sum(n.make) end from public.production_counts n where n.check_id=c.id))
 from public.production_checks c where c.id=p_id;
$$;
