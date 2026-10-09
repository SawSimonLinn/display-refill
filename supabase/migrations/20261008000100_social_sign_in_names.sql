-- Apple and Google sign-in (iOS). Accounts they create get a display name:
-- Google sends `full_name`/`name` in user metadata at creation; Apple shares
-- the name only with the app, which saves it as `display_name` metadata right
-- after the first sign-in. The name is never used for authorization.

create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''), 200))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Fills an empty profile name from later metadata (Apple's first sign-in).
-- A name already set (invite, sign-up, admin) is left alone.
create function private.fill_profile_name() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 200);
begin
  if v_name <> '' then
    update public.profiles
       set display_name = v_name
     where user_id = new.id and display_name = '';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_metadata_updated
  after update of raw_user_meta_data on auth.users
  for each row
  when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function private.fill_profile_name();
