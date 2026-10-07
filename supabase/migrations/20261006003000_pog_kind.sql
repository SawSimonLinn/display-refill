-- POG kind: which store section a reusable layout is for. Uses the same four
-- sections as production. Nullable so POGs created before this migration keep
-- working until an admin sets their kind; the API requires it for new POGs.

alter table public.pogs
  add column kind text check (kind is null or kind in ('fruit_mobile', 'salad_mobile', 'fruit_case', 'veggie_case'));

create index pogs_org_kind_idx on public.pogs (organization_id, kind);

create function private.clean_pog_kind(p_value text) returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value not in ('fruit_mobile', 'salad_mobile', 'fruit_case', 'veggie_case') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'kind must be one of fruit_mobile, salad_mobile, fruit_case, veggie_case', hint = 'kind';
  end if;
  return p_value;
end;
$$;

drop function public.create_pog(uuid, uuid, text, uuid);

create function public.create_pog(
  p_actor uuid,
  p_org uuid,
  p_name text,
  p_request_id uuid default null,
  p_kind text default null
) returns public.pogs
language plpgsql
set search_path = ''
as $$
declare
  g public.pogs;
  v_version uuid;
begin
  perform private.require_org_admin(p_actor, p_org, 'create POGs');
  insert into public.pogs (organization_id, name, kind)
  values (p_org, private.clean_text(p_name, 'name', 200), case when p_kind is null then null else private.clean_pog_kind(p_kind) end)
  returning * into g;

  insert into public.pog_versions (organization_id, pog_id, version_number, created_by)
  values (p_org, g.id, 1, p_actor)
  returning id into v_version;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (p_org, p_actor, 'pog.created', g.id, p_request_id,
          jsonb_build_object('name', g.name, 'kind', g.kind, 'draft_version_id', v_version));
  return g;
end;
$$;

-- p_changes: any of name, kind, archived.
create or replace function public.update_pog(
  p_actor uuid,
  p_pog_id uuid,
  p_expected_revision integer,
  p_changes jsonb,
  p_request_id uuid default null
) returns public.pogs
language plpgsql
set search_path = ''
as $$
declare
  g public.pogs;
  v public.pogs;
begin
  perform private.check_patch(p_changes, array['name', 'kind', 'archived']);
  select * into g from public.pogs where id = p_pog_id for update;
  if not found or not private.is_org_member(p_actor, g.organization_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'POG not found';
  end if;
  if not private.is_org_admin(p_actor, g.organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'only organization admins change POGs';
  end if;
  if g.revision <> p_expected_revision then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = format('expected revision %s, current %s', p_expected_revision, g.revision);
  end if;

  v := g;
  if p_changes ? 'name' then v.name := private.clean_text(p_changes ->> 'name', 'name', 200); end if;
  if p_changes ? 'kind' then v.kind := private.clean_pog_kind(p_changes ->> 'kind'); end if;
  if p_changes ? 'archived' then v.archived := private.clean_bool(p_changes -> 'archived', 'archived'); end if;
  if (v.name, v.kind, v.archived) is not distinct from (g.name, g.kind, g.archived) then
    return g;
  end if;

  update public.pogs set name = v.name, kind = v.kind, archived = v.archived where id = g.id returning * into v;

  insert into public.audit_events (organization_id, actor_id, event_type, resource_id, request_id, metadata)
  values (g.organization_id, p_actor,
          case when not g.archived and v.archived then 'pog.archived'
               when g.archived and not v.archived then 'pog.restored'
               else 'pog.updated' end,
          g.id, p_request_id,
          jsonb_build_object('before', jsonb_build_object('name', g.name, 'kind', g.kind, 'archived', g.archived),
                             'after', jsonb_build_object('name', v.name, 'kind', v.kind, 'archived', v.archived)));
  return v;
end;
$$;

revoke all on function
  private.clean_pog_kind(text),
  public.create_pog(uuid, uuid, text, uuid, text)
from public, anon, authenticated;

grant execute on function
  private.clean_pog_kind(text),
  public.create_pog(uuid, uuid, text, uuid, text)
to service_role;
