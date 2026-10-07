-- Most items last about a week, so a new check (including the next day's) starts from the
-- latest finished count for the same display row. Staff adjust the numbers instead of retyping them.
create function private.production_count_carry_forward() returns trigger language plpgsql set search_path='' as $$
declare prior public.production_counts;
begin
 if new.have is not null then return new; end if;
 select n.* into prior from public.production_counts n join public.production_checks c on c.id=n.check_id
  where n.item_id=new.item_id and c.status='finished' and n.have is not null
  order by c.finished_at desc,c.id desc limit 1;
 if found then
  new.have:=prior.have;
  if new.backup_required and new.backup is null then new.backup:=prior.backup; end if;
 end if;
 return new;
end; $$;
revoke all on function private.production_count_carry_forward() from public,anon,authenticated;
-- Named to fire before production_count_guard and production_count_prep_baseline (alphabetical order).
create trigger production_count_carry_forward before insert on public.production_counts for each row execute function private.production_count_carry_forward();
