-- Feature 02 / migration 4: durable jobs, provider attempts, upload intents,
-- idempotency records and audit events. All are trusted-service tables:
-- clients have no grants; only audit_events has a read policy (org admins).

create table public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  generation integer not null check (generation >= 0),
  state text not null default 'queued' check (state in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (scan_id, generation),
  foreign key (organization_id, scan_id) references public.scans (organization_id, id) on delete restrict,
  check ((state = 'running') = (lease_token is not null and lease_until is not null))
);

create table public.scan_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  generation integer not null check (generation >= 0),
  attempt_number integer not null check (attempt_number between 1 and 10),
  provider text not null check (length(provider) between 1 and 64),
  model text not null check (length(model) between 1 and 128),
  prompt_version text not null check (length(prompt_version) between 1 and 64),
  schema_version integer not null check (schema_version > 0),
  started_at timestamptz not null,
  ended_at timestamptz check (ended_at is null or ended_at >= started_at),
  outcome text not null check (outcome in ('in_progress', 'succeeded', 'invalid_output', 'provider_error', 'timeout', 'cancelled', 'superseded')),
  latency_ms integer check (latency_ms >= 0),
  usage_json jsonb check (usage_json is null or jsonb_typeof(usage_json) = 'object'),
  normalized_response jsonb check (normalized_response is null or jsonb_typeof(normalized_response) = 'object'),
  -- Canonical processing dimensions and input hash for reproducibility.
  input_width integer check (input_width between 1 and 4096),
  input_height integer check (input_height between 1 and 4096),
  input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (scan_id, generation, attempt_number),
  foreign key (organization_id, scan_id) references public.scans (organization_id, id) on delete restrict
);

create table public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid,
  actor_id uuid not null references auth.users (id) on delete restrict,
  -- The scan or POG version the object belongs to.
  resource_id uuid not null,
  bucket text not null check (bucket in ('display-scans', 'pog-images')),
  object_path text not null unique,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'validated', 'rejected', 'expired')),
  expected_type text not null check (expected_type = 'image/jpeg'),
  max_bytes integer not null check (max_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete restrict,
  check (expires_at > created_at),
  -- Server-generated paths only, always inside the owning organization.
  check (
    (bucket = 'display-scans' and store_id is not null
      and object_path = organization_id::text || '/' || store_id::text || '/' || resource_id::text || '/capture.jpg')
    or
    (bucket = 'pog-images'
      and object_path ~ ('^' || organization_id::text || '/[0-9a-f-]{36}/' || resource_id::text || '/reference\.jpg$'))
  )
);

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id) on delete restrict,
  route_scope text not null check (length(route_scope) between 1 and 200),
  key text not null check (length(key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  resource_id uuid,
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  unique (actor_id, route_scope, key)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid,
  actor_id uuid references auth.users (id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  resource_id uuid not null,
  request_id uuid,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, store_id) references public.stores (organization_id, id) on delete restrict
);

create index scan_jobs_queued_idx on public.scan_jobs (available_at) where state = 'queued';
create index scan_jobs_state_available_idx on public.scan_jobs (state, available_at);
create index scan_jobs_running_lease_idx on public.scan_jobs (lease_until) where state = 'running';
create index scan_jobs_org_idx on public.scan_jobs (organization_id);
create index scan_attempts_scan_idx on public.scan_attempts (scan_id);
create index scan_attempts_org_idx on public.scan_attempts (organization_id);
create index upload_intents_org_idx on public.upload_intents (organization_id);
create index upload_intents_pending_expiry_idx on public.upload_intents (expires_at) where state = 'pending';
create index idempotency_records_expiry_idx on public.idempotency_records (expires_at);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_resource_idx on public.audit_events (resource_id);

create trigger scan_jobs_touch before update on public.scan_jobs
  for each row execute function private.touch_row();
create trigger upload_intents_touch before update on public.upload_intents
  for each row execute function private.touch_row();

create trigger scan_attempts_no_delete before delete on public.scan_attempts
  for each row execute function private.reject_mutation();
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.reject_mutation();

alter table public.scan_jobs enable row level security;
alter table public.scan_attempts enable row level security;
alter table public.upload_intents enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.audit_events enable row level security;

-- No policies on scan_jobs, scan_attempts, upload_intents, idempotency_records:
-- RLS with no policy denies every client role.

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (private.is_org_admin((select auth.uid()), organization_id));
