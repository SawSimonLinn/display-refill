-- Re-apply the shared-stock production_read wrapper from 20261004002100; the remote copy was left on the 001900 version.
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
