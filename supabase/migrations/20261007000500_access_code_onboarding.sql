-- Feature 16 unit 2: organization access code and self-service store onboarding (D105–D107).
-- A signed-up account has no membership until it redeems the access code. It then creates a
-- store (becoming its manager) or joins an existing store by number (as an employee).

create table public.organization_access_codes (
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 -- Normalized: uppercase letters and digits only. Shown to admins grouped as XXXX-XXXX.
 code text not null unique check(code ~ '^[A-Z0-9]{6,32}$'),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 updated_by uuid references auth.users(id)
);
create trigger organization_access_codes_touch before update on public.organization_access_codes for each row execute function private.touch_row();
alter table public.organization_access_codes enable row level security;
revoke all on public.organization_access_codes from public,anon,authenticated;
grant select,insert,update,delete on public.organization_access_codes to service_role;

create function private.normalize_access_code(p_value text) returns text language sql immutable set search_path='' as $$
 select upper(regexp_replace(coalesce(p_value,''),'[^A-Za-z0-9]','','g'));
$$;

-- Eight characters from 32 symbols without look-alikes (no 0/O, 1/I): 40 bits, unbiased.
create function private.new_access_code() returns text language plpgsql volatile set search_path='' as $$
declare alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; bytes bytea:=extensions.gen_random_bytes(8); result text:='';
begin
 for i in 0..7 loop result:=result || substr(alphabet,1+(get_byte(bytes,i)%length(alphabet)),1); end loop;
 return result;
end; $$;

create function private.access_code_payload(p_org uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('organization_id',p_org,
  'code',case when c.code is null then null else substr(c.code,1,4) || '-' || substr(c.code,5) end,
  'active',coalesce(c.active,false),'updated_at',c.updated_at)
 from (select 1) one left join public.organization_access_codes c on c.organization_id=p_org;
$$;

create function public.access_code_read(p_actor uuid,p_org uuid) returns jsonb language plpgsql stable set search_path='' as $$
begin
 perform private.require_org_admin(p_actor,p_org,'view the access code');
 return private.access_code_payload(p_org);
end; $$;

-- p_action: rotate (new code, active; the old code stops working), disable, enable.
-- Audit never contains the code itself.
create function public.access_code_mutate(p_actor uuid,p_org uuid,p_action text,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare c public.organization_access_codes; v_code text;
begin
 perform private.require_org_admin(p_actor,p_org,'change the access code');
 perform 1 from public.organizations where id=p_org for update;
 select * into c from public.organization_access_codes where organization_id=p_org for update;
 if p_action='rotate' then
  loop
   v_code:=private.new_access_code();
   exit when not exists(select 1 from public.organization_access_codes where code=v_code);
  end loop;
  insert into public.organization_access_codes(organization_id,code,active,updated_by) values(p_org,v_code,true,p_actor)
  on conflict(organization_id) do update set code=excluded.code,active=true,updated_by=p_actor;
 elsif p_action in ('disable','enable') then
  if not found then raise exception 'VALIDATION_FAILED' using detail='Create an access code first.',hint='action'; end if;
  update public.organization_access_codes set active=(p_action='enable'),updated_by=p_actor where organization_id=p_org and active<>(p_action='enable');
 else
  raise exception 'VALIDATION_FAILED' using hint='action';
 end if;
 insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
 values(p_org,p_actor,'organization.access_code_'||case p_action when 'rotate' then 'rotated' when 'disable' then 'disabled' else 'enabled' end,p_org,p_request_id,'{}'::jsonb);
 return private.access_code_payload(p_org);
end; $$;

-- Where a signed-in account is in onboarding:
--   access_code: no organization membership yet;  removed: only revoked organization memberships;
--   store: member without an active store (admins never need one);  complete.
create function public.onboarding_read(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 with org as (
  select m.organization_id,o.name,m.role from public.organization_memberships m join public.organizations o on o.id=m.organization_id
  where m.user_id=p_actor and m.active and o.active order by o.name,o.id limit 1
 ), stores as (
  select s.id store_id,s.name,s.store_number,s.timezone,sm.role from public.store_memberships sm join public.stores s on s.id=sm.store_id
  where sm.user_id=p_actor and sm.active and s.active and s.organization_id=(select organization_id from org)
 ) select jsonb_build_object(
  'state',case
   when not exists(select 1 from org) then
    case when exists(select 1 from public.organization_memberships m where m.user_id=p_actor) then 'removed' else 'access_code' end
   when (select role from org)='admin' or exists(select 1 from stores) then 'complete'
   else 'store' end,
  'organization',(select jsonb_build_object('organization_id',organization_id,'name',name,'role',role) from org),
  'stores',coalesce((select jsonb_agg(to_jsonb(s) order by s.name,s.store_number) from stores s),'[]'::jsonb));
$$;

-- Redeem an access code. Wrong, disabled and archived-organization codes fail the same way.
-- A revoked member cannot rejoin with the code; an account belongs to at most one organization.
create function public.redeem_access_code(p_actor uuid,p_code text,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare c public.organization_access_codes; m public.organization_memberships;
begin
 select ac.* into c from public.organization_access_codes ac join public.organizations o on o.id=ac.organization_id
 where ac.code=private.normalize_access_code(p_code) and ac.active and o.active;
 if not found then raise exception 'VALIDATION_FAILED' using detail='That access code is not valid.',hint='access_code'; end if;
 perform 1 from public.organizations where id=c.organization_id for update;
 select * into m from public.organization_memberships where user_id=p_actor and organization_id=c.organization_id for update;
 if found then
  if not m.active then raise exception 'FORBIDDEN' using detail='membership revoked'; end if;
  return public.onboarding_read(p_actor);
 end if;
 if exists(select 1 from public.organization_memberships where user_id=p_actor) then
  raise exception 'VALIDATION_FAILED' using detail='This account already belongs to an organization.',hint='access_code';
 end if;
 insert into public.organization_memberships(organization_id,user_id,role) values(c.organization_id,p_actor,'member');
 insert into public.audit_events(organization_id,actor_id,event_type,resource_id,request_id,metadata)
 values(c.organization_id,p_actor,'membership.joined',p_actor,p_request_id,jsonb_build_object('via','access_code','org_role','member'));
 return public.onboarding_read(p_actor);
end; $$;

-- Create-or-join a store by number in the caller's organization. A new store needs a name and
-- an IANA timezone; its creator becomes manager and it starts with every active display type.
-- An existing active store is joined as employee. Repeating the call returns the same result.
create function public.onboarding_store(p_actor uuid,p_store_number text,p_name text default null,p_timezone text default null,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare v_org uuid; v_number text; s public.stores; sm public.store_memberships; v_created boolean:=false; v_role text;
begin
 select m.organization_id into v_org from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.user_id=p_actor and m.active and o.active order by o.name,o.id limit 1;
 if not found then raise exception 'FORBIDDEN' using detail='no organization'; end if;
 -- Serializes concurrent creation of the same store number.
 perform 1 from public.organizations where id=v_org for update;
 v_number:=private.clean_text(p_store_number,'store_number',50);
 select * into s from public.stores where organization_id=v_org and lower(store_number)=lower(v_number);
 if found then
  if not s.active then raise exception 'VALIDATION_FAILED' using detail='This store is archived. Ask an administrator.',hint='store_number'; end if;
  select * into sm from public.store_memberships where store_id=s.id and user_id=p_actor for update;
  if found then
   if not sm.active then raise exception 'FORBIDDEN' using detail='membership revoked'; end if;
   v_role:=sm.role;
  else
   insert into public.store_memberships(organization_id,store_id,user_id,role) values(v_org,s.id,p_actor,'employee');
   v_role:='employee';
   insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
   values(v_org,s.id,p_actor,'membership.joined',p_actor,p_request_id,jsonb_build_object('via','store_number','store_role','employee'));
  end if;
 else
  s.name:=private.clean_text(p_name,'name',200);
  s.timezone:=private.clean_text(p_timezone,'timezone',64);
  perform private.check_timezone(s.timezone);
  insert into public.stores(organization_id,name,store_number,timezone) values(v_org,s.name,v_number,s.timezone) returning * into s;
  insert into public.store_memberships(organization_id,store_id,user_id,role) values(v_org,s.id,p_actor,'manager');
  v_created:=true; v_role:='manager';
  insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
  values(v_org,s.id,p_actor,'store.created',s.id,p_request_id,jsonb_build_object('after',private.store_json(s),'via','onboarding'));
 end if;
 return jsonb_build_object('created',v_created,'role',v_role,'store',jsonb_build_object('store_id',s.id,'organization_id',v_org,
  'name',s.name,'store_number',s.store_number,'timezone',s.timezone));
end; $$;

-- Store managers may rename their store and change its timezone (D107); number and archive
-- status stay admin-only (update_store).
create function public.store_settings_update(p_actor uuid,p_store uuid,p_expected_revision integer,p_name text,p_timezone text,p_request_id uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare old_s public.stores; s public.stores;
begin
 select * into old_s from public.stores where id=p_store for update;
 if not found or not private.has_store_access(p_actor,p_store) then raise exception 'NOT_FOUND'; end if;
 if not private.is_store_manager(p_actor,p_store) then raise exception 'FORBIDDEN'; end if;
 if old_s.revision is distinct from p_expected_revision then raise exception 'CONFLICT'; end if;
 s.name:=private.clean_text(p_name,'name',200);
 s.timezone:=private.clean_text(p_timezone,'timezone',64);
 perform private.check_timezone(s.timezone);
 if (s.name,s.timezone) is distinct from (old_s.name,old_s.timezone) then
  update public.stores set name=s.name,timezone=s.timezone where id=p_store returning * into s;
  insert into public.audit_events(organization_id,store_id,actor_id,event_type,resource_id,request_id,metadata)
  values(s.organization_id,s.id,p_actor,'store.updated',s.id,p_request_id,jsonb_build_object('before',private.store_json(old_s),'after',private.store_json(s)));
 else
  s:=old_s;
 end if;
 return private.store_json(s);
end; $$;

revoke all on function private.normalize_access_code(text),private.new_access_code(),private.access_code_payload(uuid) from public,anon,authenticated;
grant execute on function private.normalize_access_code(text),private.new_access_code(),private.access_code_payload(uuid) to service_role;
revoke all on function public.access_code_read(uuid,uuid),public.access_code_mutate(uuid,uuid,text,uuid),public.onboarding_read(uuid),
 public.redeem_access_code(uuid,text,uuid),public.onboarding_store(uuid,text,text,text,uuid),
 public.store_settings_update(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.access_code_read(uuid,uuid),public.access_code_mutate(uuid,uuid,text,uuid),public.onboarding_read(uuid),
 public.redeem_access_code(uuid,text,uuid),public.onboarding_store(uuid,text,text,text,uuid),
 public.store_settings_update(uuid,uuid,integer,text,text,uuid) to service_role;
