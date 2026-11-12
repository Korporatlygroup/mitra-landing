-- Phase 7 core: government assistance sources, monitoring jobs, programmes, versions, review.
-- Design rules: default-deny RLS (no table policy for anon/authenticated except the ones below), writes only
-- through SECURITY DEFINER RPCs with search_path = '', worker RPCs granted to service_role only,
-- verified versions are immutable, a failed or unreviewed fetch never touches published data.

------------------------------------------------------------------------------------------------
-- Permissions (existing admin roles; MFA is enforced for admin roles by private.has_permission)
------------------------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('admin_super', 'gov:source_admin'), ('admin_super', 'gov:review'), ('admin_super', 'gov:publish'), ('admin_super', 'gov:view'),
  ('admin_ops', 'gov:source_admin'), ('admin_ops', 'gov:view'),
  ('admin_review', 'gov:review'), ('admin_review', 'gov:view'),
  ('admin_content', 'gov:publish'), ('admin_content', 'gov:view')
on conflict do nothing;

------------------------------------------------------------------------------------------------
-- Switches (all off until the owner enables them; each can be turned off alone)
------------------------------------------------------------------------------------------------
create table public.gov_settings (
  key text primary key check (key in ('monitoring_enabled', 'publishing_enabled', 'notifications_enabled')),
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.gov_settings (key) values ('monitoring_enabled'), ('publishing_enabled'), ('notifications_enabled');

create function private.gov_setting(p_key text) returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select s.enabled from public.gov_settings s where s.key = p_key), false) $$;

------------------------------------------------------------------------------------------------
-- Agencies and the approved source registry
------------------------------------------------------------------------------------------------
create table public.gov_agencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 2 and 200),
  domain text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at timestamptz not null default now()
);

create function private.gov_all_https(p_urls text[]) returns boolean
language sql immutable set search_path = '' as
$$ select not exists (select 1 from unnest(p_urls) u where u !~ '^https://[a-z0-9.-]+(:443)?/[^[:space:]]*$') $$;

create table public.gov_sources (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.gov_agencies (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 160),
  source_type text not null check (source_type in ('api', 'feed', 'website', 'manual')),
  adapter text not null check (adapter ~ '^[a-z0-9_]{2,40}$'),
  allowed_hosts text[] not null check (cardinality(allowed_hosts) between 1 and 5),
  approved_urls text[] not null default '{}' check (cardinality(approved_urls) <= 200),
  allowed_method text not null default 'public_pages' check (allowed_method in ('public_pages', 'official_api', 'official_feed', 'manual_entry')),
  usage_restrictions text check (char_length(usage_restrictions) <= 2000),
  owner_contact text check (char_length(owner_contact) <= 300),
  refresh_interval_minutes integer not null default 1440 check (refresh_interval_minutes between 15 and 43200),
  rate_per_minute integer not null default 2 check (rate_per_minute between 1 and 60),
  freshness_hours integer not null default 72 check (freshness_hours between 1 and 8760),
  parser_version text not null default '1',
  enabled boolean not null default false,
  health text not null default 'unknown' check (health in ('unknown', 'healthy', 'degraded', 'failing')),
  consecutive_failures integer not null default 0,
  last_request_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  next_check_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  -- every approved URL is HTTPS and on an allowed host (checked again by the application before each fetch)
  check (private.gov_all_https(approved_urls))
);
create unique index gov_sources_name on public.gov_sources (agency_id, name);

-- Source changes need a second person (proposer cannot approve). Append-only history of every change.
create table public.gov_source_changes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.gov_sources (id) on delete cascade,
  change jsonb not null,
  reason text not null check (char_length(reason) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid,
  decided_by uuid,
  decision_reason text check (char_length(decision_reason) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (status = 'pending' or (decided_by is not null and decided_at is not null))
);

------------------------------------------------------------------------------------------------
-- Fetch jobs and results
------------------------------------------------------------------------------------------------
create table public.gov_fetch_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.gov_sources (id) on delete cascade,
  target_url text not null check (target_url ~ '^https://'),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  lease_until timestamptz,
  locked_by text,
  idempotency_key text not null unique check (char_length(idempotency_key) <= 200),
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index gov_fetch_jobs_due on public.gov_fetch_jobs (run_after) where status = 'queued';
create index gov_fetch_jobs_lease on public.gov_fetch_jobs (lease_until) where status = 'running';
create index gov_fetch_jobs_source on public.gov_fetch_jobs (source_id, created_at desc);

create table public.gov_fetch_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.gov_fetch_jobs (id) on delete set null,
  source_id uuid not null references public.gov_sources (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  http_status integer,
  content_type text check (char_length(content_type) <= 120),
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer,
  parser_version text,
  outcome text not null check (outcome in ('ok', 'unchanged', 'parse_failed', 'rejected_content', 'gone')),
  -- Bounded evidence: the text that the extraction read, kept for audit. Not the full raw page.
  evidence_excerpt text check (char_length(evidence_excerpt) <= 20000),
  fetched_at timestamptz not null default now()
);
create index gov_fetch_results_source on public.gov_fetch_results (source_id, fetched_at desc);

------------------------------------------------------------------------------------------------
-- Programmes, immutable versions, change proposals
------------------------------------------------------------------------------------------------
create table public.gov_programmes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.gov_sources (id) on delete restrict,
  agency_id uuid not null references public.gov_agencies (id) on delete restrict,
  external_key text not null check (char_length(external_key) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,120}$'),
  current_version_id uuid,
  publication_state text not null default 'hidden' check (publication_state in ('hidden', 'published', 'paused', 'archived')),
  verification_status text not null default 'discovered'
    check (verification_status in ('discovered', 'extracted', 'pending_review', 'verified', 'unconfirmed', 'archived')),
  application_status text not null default 'unknown' check (application_status in ('open', 'closed', 'upcoming', 'unknown')),
  -- Promoted from the current version for search and listing.
  name text,
  funding_type text check (funding_type in ('grant', 'financing', 'subsidy', 'training', 'other')),
  amount_min numeric(14, 2),
  amount_max numeric(14, 2),
  currency text check (currency in ('MYR')),
  opens_on date,
  closes_on date,
  last_checked_at timestamptz,
  last_verified_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (source_id, external_key)
);
create index gov_programmes_public on public.gov_programmes (funding_type, application_status) where publication_state = 'published';

create table public.gov_programme_versions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.gov_programmes (id) on delete restrict,
  version_no integer not null,
  data jsonb not null,
  data_sha256 text not null check (data_sha256 ~ '^[0-9a-f]{64}$'),
  result_id uuid references public.gov_fetch_results (id) on delete set null,
  proposal_id uuid,
  approved_by uuid,
  approval_reason text check (char_length(approval_reason) <= 1000),
  detection_method text not null check (detection_method in ('monitor', 'manual', 'import')),
  published_at timestamptz not null default now(),
  unique (programme_id, version_no)
);

create function private.gov_versions_immutable() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin raise exception 'gov_programme_versions is append-only' using errcode = '42501'; end; $$;
create trigger gov_versions_no_change before update or delete on public.gov_programme_versions
  for each row execute function private.gov_versions_immutable();
create trigger gov_versions_no_truncate before truncate on public.gov_programme_versions
  for each statement execute function private.gov_versions_immutable();

alter table public.gov_programmes
  add constraint gov_programmes_current_version foreign key (current_version_id)
  references public.gov_programme_versions (id) on delete restrict;

create table public.gov_change_proposals (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.gov_sources (id) on delete cascade,
  programme_id uuid references public.gov_programmes (id) on delete restrict,
  base_version_id uuid references public.gov_programme_versions (id) on delete restrict,
  result_id uuid references public.gov_fetch_results (id) on delete set null,
  external_key text not null,
  kind text not null check (kind in ('new', 'change', 'closure')),
  candidate jsonb not null,
  candidate_sha256 text not null check (candidate_sha256 ~ '^[0-9a-f]{64}$'),
  diff jsonb not null default '{}'::jsonb,
  flags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'needs_info', 'superseded')),
  decided_by uuid,
  decision_reason text check (char_length(decision_reason) <= 1000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (status in ('pending', 'superseded') or (decided_by is not null and decided_at is not null and decision_reason is not null))
);
-- The same candidate content is never queued twice for one programme (duplicate discovery events).
create unique index gov_proposals_open_unique on public.gov_change_proposals (source_id, external_key, candidate_sha256)
  where status in ('pending', 'needs_info');
create index gov_proposals_status on public.gov_change_proposals (status, created_at);

-- Append-only decisions and operational events (no FK to users: history survives erasure).
create table public.gov_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_user_id uuid,
  event text not null check (char_length(event) <= 60),
  source_id uuid,
  programme_id uuid,
  proposal_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index gov_events_programme on public.gov_events (programme_id, at desc);
create function private.gov_events_immutable() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin raise exception 'gov_events is append-only' using errcode = '42501'; end; $$;
create trigger gov_events_no_change before update or delete on public.gov_events
  for each row execute function private.gov_events_immutable();
create trigger gov_events_no_truncate before truncate on public.gov_events
  for each statement execute function private.gov_events_immutable();

create function private.gov_event(p_event text, p_source uuid, p_programme uuid, p_proposal uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as
$$ insert into public.gov_events (actor_user_id, event, source_id, programme_id, proposal_id, details)
   values (auth.uid(), p_event, p_source, p_programme, p_proposal, coalesce(p_details, '{}'::jsonb)) $$;

------------------------------------------------------------------------------------------------
-- RLS: deny by default. Staff read through the RPCs below; no table is readable by anon.
------------------------------------------------------------------------------------------------
alter table public.gov_settings enable row level security;
alter table public.gov_agencies enable row level security;
alter table public.gov_sources enable row level security;
alter table public.gov_source_changes enable row level security;
alter table public.gov_fetch_jobs enable row level security;
alter table public.gov_fetch_results enable row level security;
alter table public.gov_programmes enable row level security;
alter table public.gov_programme_versions enable row level security;
alter table public.gov_change_proposals enable row level security;
alter table public.gov_events enable row level security;

create policy gov_staff_select on public.gov_sources for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_agencies for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_fetch_jobs for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_fetch_results for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_change_proposals for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_programmes for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_programme_versions for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_events for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_settings for select to authenticated using (private.has_platform_permission('gov:view'));
create policy gov_staff_select on public.gov_source_changes for select to authenticated using (private.has_platform_permission('gov:view'));

grant select on public.gov_sources, public.gov_agencies, public.gov_fetch_jobs, public.gov_fetch_results,
  public.gov_change_proposals, public.gov_programmes, public.gov_programme_versions, public.gov_events,
  public.gov_settings, public.gov_source_changes to authenticated;
-- The worker (service role) reads and writes through RPCs only.
grant select on public.gov_sources to service_role;

------------------------------------------------------------------------------------------------
-- Validation of an extracted candidate (pure; used by the worker RPC)
------------------------------------------------------------------------------------------------
create function private.gov_valid_rule(p_rule jsonb) returns boolean
language sql immutable set search_path = '' as
$$ select jsonb_typeof(p_rule) = 'object'
   and (p_rule ->> 'field') in ('business_size', 'sector', 'state', 'registration', 'employees_min', 'employees_max',
        'years_operating_min', 'citizenship', 'community', 'age_min', 'age_max', 'note')
   and (p_rule ->> 'op') in ('eq', 'in', 'gte', 'lte', 'note')
   and char_length(coalesce(p_rule ->> 'quote', '')) between 1 and 600 $$;

-- Returns null when valid, otherwise a short reason. Unknown values stay null; nothing is invented.
create function private.gov_candidate_problem(p_c jsonb) returns text
language plpgsql immutable set search_path = '' as
$$
declare r jsonb;
begin
  if jsonb_typeof(p_c) is distinct from 'object' then return 'not_object'; end if;
  if char_length(coalesce(p_c ->> 'name', '')) not between 3 and 200 then return 'name'; end if;
  if char_length(coalesce(p_c ->> 'info_url', '')) = 0 or (p_c ->> 'info_url') !~ '^https://' then return 'info_url'; end if;
  if (p_c ->> 'funding_type') is not null and (p_c ->> 'funding_type') not in ('grant', 'financing', 'subsidy', 'training', 'other') then return 'funding_type'; end if;
  if (p_c ->> 'application_status') is not null and (p_c ->> 'application_status') not in ('open', 'closed', 'upcoming', 'unknown') then return 'application_status'; end if;
  if (p_c ->> 'application_channel') is not null and (p_c ->> 'application_channel') not in ('online', 'branch', 'form', 'enquiry', 'unknown') then return 'application_channel'; end if;
  if (p_c ->> 'application_url') is not null and (p_c ->> 'application_url') !~ '^https://' then return 'application_url'; end if;
  if (p_c ->> 'currency') is not null and (p_c ->> 'currency') <> 'MYR' then return 'currency'; end if;
  if (p_c ->> 'amount_min') is not null and (p_c ->> 'amount_min') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then return 'amount_min'; end if;
  if (p_c ->> 'amount_max') is not null and (p_c ->> 'amount_max') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then return 'amount_max'; end if;
  if (p_c ->> 'amount_min') is not null and (p_c ->> 'amount_max') is not null
     and (p_c ->> 'amount_min')::numeric > (p_c ->> 'amount_max')::numeric then return 'amount_range'; end if;
  if ((p_c ->> 'amount_min') is not null or (p_c ->> 'amount_max') is not null) and (p_c ->> 'currency') is null then return 'currency_missing'; end if;
  if (p_c ->> 'opens_on') is not null and (p_c ->> 'opens_on') !~ '^\d{4}-\d{2}-\d{2}$' then return 'opens_on'; end if;
  if (p_c ->> 'closes_on') is not null and (p_c ->> 'closes_on') !~ '^\d{4}-\d{2}-\d{2}$' then return 'closes_on'; end if;
  if (p_c ->> 'opens_on') is not null and (p_c ->> 'closes_on') is not null
     and (p_c ->> 'opens_on')::date > (p_c ->> 'closes_on')::date then return 'dates_contradict'; end if;
  if jsonb_typeof(coalesce(p_c -> 'rules', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'rules', '[]'::jsonb)) > 40 then return 'rules'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_c -> 'rules', '[]'::jsonb)) loop
    if not private.gov_valid_rule(r) then return 'rule'; end if;
  end loop;
  if char_length(coalesce(p_c ->> 'description', '')) > 4000 then return 'description'; end if;
  if jsonb_typeof(coalesce(p_c -> 'terms', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'terms', '[]'::jsonb)) > 15 then return 'terms'; end if;
  if jsonb_typeof(coalesce(p_c -> 'review_notes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'review_notes', '[]'::jsonb)) > 5 then return 'review_notes'; end if;
  return null;
end;
$$;

-- Canonical form used for hashing and diffing: only known keys, rules sorted.
create function private.gov_canonical(p_c jsonb) returns jsonb
language sql immutable set search_path = '' as
$$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select k, case when k = 'rules'
        then (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from jsonb_array_elements(p_c -> 'rules') x)
        else p_c -> k end as v
    from unnest(array['name', 'description', 'funding_type', 'amount_min', 'amount_max', 'currency', 'application_channel',
      'application_url', 'info_url', 'opens_on', 'closes_on', 'application_status', 'documents', 'terms', 'rules', 'review_notes', 'extraction_status']) k
    where p_c ? k and jsonb_typeof(p_c -> k) <> 'null'
  ) t
$$;

------------------------------------------------------------------------------------------------
-- Worker RPCs (service_role only)
------------------------------------------------------------------------------------------------
-- Queue a job for each enabled source that is due and has no live job. Idempotent per source and interval bucket.
create function public.gov_enqueue_due_jobs() returns integer
language plpgsql security definer set search_path = '' as
$$
declare s public.gov_sources; u text; n integer := 0; v_key text; v_rows integer;
begin
  if not private.gov_setting('monitoring_enabled') then return 0; end if;
  for s in select * from public.gov_sources
           where enabled and (next_check_at is null or next_check_at <= now())
           for update skip locked loop
    foreach u in array s.approved_urls loop
      v_key := s.id::text || ':' || md5(u) || ':' || floor(extract(epoch from now()) / (s.refresh_interval_minutes * 60))::bigint;
      insert into public.gov_fetch_jobs (source_id, target_url, idempotency_key)
      values (s.id, u, v_key) on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      n := n + v_rows;
    end loop;
    update public.gov_sources set next_check_at = now() + make_interval(mins => refresh_interval_minutes) where id = s.id;
  end loop;
  return n;
end;
$$;

-- Claim jobs with a lease. Recovers expired leases first. One request per source per 60/rate seconds.
create function public.gov_claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof public.gov_fetch_jobs
language plpgsql security definer set search_path = '' as
$$
declare j public.gov_fetch_jobs; s public.gov_sources;
begin
  if not private.gov_setting('monitoring_enabled') then return; end if;
  update public.gov_fetch_jobs set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
    lease_until = null, locked_by = null, last_error = 'lease_expired',
    finished_at = case when attempts >= max_attempts then now() end
  where status = 'running' and lease_until < now();
  for j in select * from public.gov_fetch_jobs where status = 'queued' and run_after <= now()
           order by run_after for update skip locked limit greatest(1, least(p_limit, 20)) loop
    select * into s from public.gov_sources where id = j.source_id for update;
    if not s.enabled then continue; end if;
    if s.last_request_at is not null and s.last_request_at + make_interval(secs => 60.0 / s.rate_per_minute) > now() then continue; end if;
    update public.gov_sources set last_request_at = now() where id = s.id;
    update public.gov_fetch_jobs set status = 'running', attempts = attempts + 1, locked_by = left(p_worker, 80),
      lease_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600)))
    where id = j.id returning * into j;
    return next j;
  end loop;
end;
$$;

-- What the worker needs to know about a claimed job's source (adapter, exact hosts, rate). No secrets live here.
create function public.gov_job_source(p_job uuid)
returns table (source_id uuid, adapter text, allowed_hosts text[], rate_per_minute integer, parser_version text)
language sql stable security definer set search_path = '' as
$$ select s.id, s.adapter, s.allowed_hosts, s.rate_per_minute, s.parser_version
   from public.gov_fetch_jobs j join public.gov_sources s on s.id = j.source_id where j.id = p_job $$;

-- Mark a job finished and store the result. Source becomes healthy. Published data is not touched here.
create function public.gov_complete_job(p_job uuid, p_worker text, p_result jsonb) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare j public.gov_fetch_jobs; v_res uuid;
begin
  select * into j from public.gov_fetch_jobs where id = p_job for update;
  if j.id is null then perform private.raise_error('not_found'); end if;
  if j.status <> 'running' or j.locked_by is distinct from left(p_worker, 80) then perform private.raise_error('conflict', 'not_lease_holder'); end if;
  insert into public.gov_fetch_results (job_id, source_id, url, http_status, content_type, content_sha256, byte_length,
    parser_version, outcome, evidence_excerpt)
  values (j.id, j.source_id, j.target_url, (p_result ->> 'http_status')::int, left(p_result ->> 'content_type', 120),
    p_result ->> 'content_sha256', (p_result ->> 'byte_length')::int, left(p_result ->> 'parser_version', 20),
    p_result ->> 'outcome', left(p_result ->> 'evidence_excerpt', 20000))
  returning id into v_res;
  update public.gov_fetch_jobs set status = 'succeeded', lease_until = null, finished_at = now(), last_error = null where id = j.id;
  if p_result ->> 'outcome' in ('ok', 'unchanged') then
    update public.gov_sources set health = 'healthy', consecutive_failures = 0, last_checked_at = now(),
      last_success_at = now(), last_error = null where id = j.source_id;
  else
    update public.gov_sources set last_checked_at = now(), last_failure_at = now(), last_error = left(p_result ->> 'outcome', 100),
      consecutive_failures = consecutive_failures + 1,
      health = case when consecutive_failures + 1 >= 6 then 'failing' when consecutive_failures + 1 >= 3 then 'degraded' else health end
    where id = j.source_id;
  end if;
  return v_res;
end;
$$;

-- Failed fetch: exponential backoff with jitter, honours Retry-After, dead-letter after max attempts.
create function public.gov_fail_job(p_job uuid, p_worker text, p_error text, p_retry_after_seconds integer default null)
returns text
language plpgsql security definer set search_path = '' as
$$
declare j public.gov_fetch_jobs; v_delay numeric; v_status text;
begin
  select * into j from public.gov_fetch_jobs where id = p_job for update;
  if j.id is null then perform private.raise_error('not_found'); end if;
  if j.status <> 'running' or j.locked_by is distinct from left(p_worker, 80) then perform private.raise_error('conflict', 'not_lease_holder'); end if;
  v_delay := least(3600, 60 * power(2, least(j.attempts, 6))) * (0.75 + random() * 0.5);
  if p_retry_after_seconds is not null then v_delay := greatest(v_delay, least(p_retry_after_seconds, 86400)); end if;
  v_status := case when j.attempts >= j.max_attempts then 'dead' else 'queued' end;
  update public.gov_fetch_jobs set status = v_status, lease_until = null, locked_by = null,
    last_error = left(coalesce(p_error, 'error'), 500),
    run_after = now() + make_interval(secs => v_delay), finished_at = case when v_status = 'dead' then now() end
  where id = j.id;
  update public.gov_sources set last_checked_at = now(), last_failure_at = now(), last_error = left(coalesce(p_error, 'error'), 500),
    consecutive_failures = consecutive_failures + 1,
    health = case when consecutive_failures + 1 >= 6 then 'failing' when consecutive_failures + 1 >= 3 then 'degraded' else health end
  where id = j.source_id;
  return v_status;
end;
$$;

-- Submit an extracted candidate. Never publishes. Unchanged content only refreshes last_checked_at.
-- Returns 'unchanged' | 'queued' | 'duplicate' | 'invalid'.
create function public.gov_submit_candidate(p_source uuid, p_result uuid, p_external_key text, p_candidate jsonb)
returns text
language plpgsql security definer set search_path = '' as
$$
declare
  s public.gov_sources; prog public.gov_programmes; base public.gov_programme_versions;
  v_canon jsonb; v_sha text; v_problem text; v_diff jsonb := '{}'::jsonb; k text; v_flags text[] := '{}'; v_host text; v_kind text;
begin
  select * into s from public.gov_sources where id = p_source;
  if s.id is null then perform private.raise_error('not_found'); end if;
  v_problem := private.gov_candidate_problem(p_candidate);
  if v_problem is not null then
    perform private.gov_event('candidate.invalid', p_source, null, null, jsonb_build_object('key', left(p_external_key, 200), 'problem', v_problem));
    return 'invalid';
  end if;
  v_canon := private.gov_canonical(p_candidate);
  v_sha := encode(extensions.digest(convert_to(v_canon::text, 'utf8'), 'sha256'), 'hex');
  select * into prog from public.gov_programmes where source_id = p_source and external_key = p_external_key for update;
  if prog.id is not null and prog.current_version_id is not null then
    select * into base from public.gov_programme_versions where id = prog.current_version_id;
    if base.data_sha256 = v_sha then
      -- Unchanged. Records that the source was checked; does NOT advance last_verified_at.
      update public.gov_programmes set last_checked_at = now() where id = prog.id;
      return 'unchanged';
    end if;
    foreach k in array array['name', 'description', 'funding_type', 'amount_min', 'amount_max', 'currency', 'application_channel',
      'application_url', 'info_url', 'opens_on', 'closes_on', 'application_status', 'documents', 'terms', 'rules'] loop
      if base.data -> k is distinct from v_canon -> k then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', base.data -> k, 'new', v_canon -> k));
      end if;
    end loop;
    v_kind := case when v_canon ->> 'application_status' = 'closed' and base.data ->> 'application_status' is distinct from 'closed'
                   and (select count(*) from jsonb_object_keys(v_diff)) = 1 then 'closure' else 'change' end;
  else
    v_kind := 'new';
  end if;
  if (v_canon ->> 'application_url') is not null then
    v_host := substring(v_canon ->> 'application_url' from '^https://([^/:]+)');
    if not (lower(v_host) = any (s.allowed_hosts)) then
      v_flags := v_flags || 'url_host_not_allowed'::text;
    end if;
    if base.id is null or base.data ->> 'application_url' is distinct from v_canon ->> 'application_url' then
      v_flags := v_flags || 'new_application_url'::text;
    end if;
  end if;
  if (v_canon ->> 'extraction_status') is distinct from 'complete' then v_flags := v_flags || 'incomplete_extraction'::text; end if;
  if v_diff ? 'rules' then v_flags := v_flags || 'eligibility_changed'::text; end if;
  if v_diff ?| array['amount_min', 'amount_max'] then v_flags := v_flags || 'amount_changed'::text; end if;
  if v_diff ?| array['opens_on', 'closes_on'] then v_flags := v_flags || 'dates_changed'::text; end if;
  -- A newer candidate for the same programme supersedes older pending ones.
  update public.gov_change_proposals set status = 'superseded'
   where source_id = p_source and external_key = p_external_key and status = 'pending' and candidate_sha256 <> v_sha;
  begin
    insert into public.gov_change_proposals (source_id, programme_id, base_version_id, result_id, external_key, kind, candidate,
      candidate_sha256, diff, flags)
    values (p_source, prog.id, base.id, p_result, p_external_key, v_kind, v_canon, v_sha, v_diff, v_flags);
  exception when unique_violation then
    return 'duplicate';
  end;
  if prog.id is not null then
    update public.gov_programmes set last_checked_at = now(),
      verification_status = case when verification_status = 'verified' then 'verified' else 'pending_review' end where id = prog.id;
  end if;
  perform private.gov_event('candidate.queued', p_source, prog.id, null, jsonb_build_object('kind', v_kind, 'flags', v_flags));
  return 'queued';
end;
$$;

-- A programme the source no longer lists is only flagged; one network failure never closes anything.
create function public.gov_mark_missing(p_source uuid, p_external_key text) returns void
language plpgsql security definer set search_path = '' as
$$
declare prog public.gov_programmes;
begin
  select * into prog from public.gov_programmes where source_id = p_source and external_key = p_external_key for update;
  if prog.id is null then return; end if;
  update public.gov_programmes set verification_status = case when verification_status = 'verified' then 'unconfirmed' else verification_status end,
    last_checked_at = now() where id = prog.id;
  perform private.gov_event('programme.missing_from_source', p_source, prog.id, null, '{}'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- Staff RPCs
------------------------------------------------------------------------------------------------
create function public.gov_decide_proposal(p_proposal uuid, p_decision text, p_reason text, p_expected_status text default 'pending')
returns uuid
language plpgsql security definer set search_path = '' as
$$
declare
  v_user uuid := auth.uid(); p public.gov_change_proposals; prog public.gov_programmes; s public.gov_sources;
  v_reason text := btrim(coalesce(p_reason, '')); v_ver integer; v_vid uuid; c jsonb;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_decision not in ('approve', 'reject', 'needs_info') then perform private.raise_error('invalid', 'decision'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 then perform private.raise_error('invalid', 'reason'); end if;
  if p_decision = 'approve' then
    if not private.has_platform_permission('gov:publish') then perform private.raise_error('forbidden'); end if;
    if not private.gov_setting('publishing_enabled') then perform private.raise_error('conflict', 'publishing_disabled'); end if;
  elsif not private.has_platform_permission('gov:review') then
    perform private.raise_error('forbidden');
  end if;
  select * into p from public.gov_change_proposals where id = p_proposal for update;
  if p.id is null then perform private.raise_error('not_found'); end if;
  -- Two administrators on one change: the second sees the decided state and is refused.
  if p.status <> p_expected_status then perform private.raise_error('conflict', 'already_decided'); end if;
  if p_decision = 'approve' and 'url_host_not_allowed' = any (p.flags) then perform private.raise_error('conflict', 'url_host_not_allowed'); end if;
  if p_decision <> 'approve' then
    update public.gov_change_proposals set status = case p_decision when 'reject' then 'rejected' else 'needs_info' end,
      decided_by = v_user, decision_reason = v_reason, decided_at = now() where id = p.id;
    perform private.gov_event('proposal.' || p_decision, p.source_id, p.programme_id, p.id, jsonb_build_object('reason', v_reason));
    return p.programme_id;
  end if;
  select * into s from public.gov_sources where id = p.source_id;
  c := p.candidate;
  if p.programme_id is null then
    insert into public.gov_programmes (source_id, agency_id, external_key, slug)
    values (p.source_id, s.agency_id, p.external_key,
      left(regexp_replace(lower(coalesce(c ->> 'name', 'programme')), '[^a-z0-9]+', '-', 'g'), 100) || '-' || substr(md5(p.source_id::text || p.external_key), 1, 6))
    returning * into prog;
  else
    select * into prog from public.gov_programmes where id = p.programme_id for update;
    -- The programme changed since the proposal was made (another decision published): refuse stale approval.
    if prog.current_version_id is distinct from p.base_version_id then perform private.raise_error('conflict', 'stale_proposal'); end if;
  end if;
  v_ver := coalesce((select max(version_no) from public.gov_programme_versions where programme_id = prog.id), 0) + 1;
  insert into public.gov_programme_versions (programme_id, version_no, data, data_sha256, result_id, proposal_id, approved_by,
    approval_reason, detection_method)
  values (prog.id, v_ver, c, p.candidate_sha256, p.result_id, p.id, v_user, v_reason, 'monitor') returning id into v_vid;
  update public.gov_programmes set current_version_id = v_vid, publication_state = case when publication_state = 'paused' then 'paused' else 'published' end,
    verification_status = 'verified', name = c ->> 'name', funding_type = c ->> 'funding_type',
    amount_min = (c ->> 'amount_min')::numeric, amount_max = (c ->> 'amount_max')::numeric, currency = c ->> 'currency',
    opens_on = (c ->> 'opens_on')::date, closes_on = (c ->> 'closes_on')::date,
    application_status = coalesce(c ->> 'application_status', 'unknown'),
    last_verified_at = now(), last_checked_at = now(), version = version + 1 where id = prog.id;
  update public.gov_change_proposals set status = 'approved', decided_by = v_user, decision_reason = v_reason, decided_at = now(),
    programme_id = prog.id where id = p.id;
  perform private.gov_event('proposal.approve', p.source_id, prog.id, p.id, jsonb_build_object('version', v_ver, 'reason', v_reason, 'kind', p.kind));
  perform private.write_audit('gov.programme.published', null, 'gov_programme', prog.id::text, jsonb_build_object('version', v_ver, 'proposal', p.id));
  perform private.gov_emit_events(prog.id, v_ver, case p.kind when 'new' then 'programme_verified' when 'closure' then 'programme_closed' else 'programme_updated' end, p.flags);
  if p.kind = 'change' and 'dates_changed' = any (p.flags) then perform private.gov_emit_events(prog.id, v_ver, 'deadline_changed', p.flags); end if;
  if p.kind <> 'new' and c ->> 'application_status' = 'open' and p.diff #>> '{application_status,old}' is distinct from 'open' and p.diff ? 'application_status' then
    perform private.gov_emit_events(prog.id, v_ver, 'programme_opened', p.flags);
  end if;
  return prog.id;
end;
$$;

-- Pause, resume or archive a programme (needs reason). Archived is final for the public.
create function public.gov_set_programme_state(p_programme uuid, p_state text, p_reason text) returns void
language plpgsql security definer set search_path = '' as
$$
declare prog public.gov_programmes; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:publish') then perform private.raise_error('forbidden'); end if;
  if p_state not in ('published', 'paused', 'archived') then perform private.raise_error('invalid', 'state'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 then perform private.raise_error('invalid', 'reason'); end if;
  select * into prog from public.gov_programmes where id = p_programme for update;
  if prog.id is null then perform private.raise_error('not_found'); end if;
  if prog.current_version_id is null then perform private.raise_error('conflict', 'never_published'); end if;
  if prog.publication_state = 'archived' then perform private.raise_error('conflict', 'archived'); end if;
  update public.gov_programmes set publication_state = p_state,
    verification_status = case when p_state = 'archived' then 'archived' else verification_status end, version = version + 1
  where id = prog.id;
  perform private.gov_event('programme.' || p_state, prog.source_id, prog.id, null, jsonb_build_object('reason', v_reason));
  if p_state = 'archived' then perform private.gov_emit_events(prog.id, null, 'programme_closed', '{}'::text[]); end if;
  perform private.write_audit('gov.programme.' || p_state, null, 'gov_programme', prog.id::text, jsonb_build_object('reason', v_reason));
end;
$$;

create function public.gov_set_setting(p_key text, p_enabled boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:source_admin') then perform private.raise_error('forbidden'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.raise_error('invalid', 'reason'); end if;
  update public.gov_settings set enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then perform private.raise_error('invalid', 'key'); end if;
  perform private.gov_event('setting.' || p_key, null, null, null, jsonb_build_object('enabled', p_enabled, 'reason', left(btrim(p_reason), 500)));
  perform private.write_audit('gov.setting', null, 'gov_setting', p_key, jsonb_build_object('enabled', p_enabled));
end;
$$;

-- Source changes: one person proposes, a different person approves. Covers URLs, hosts, enabling, schedule.
create function public.gov_propose_source_change(p_source uuid, p_change jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare v_id uuid; k text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:source_admin') then perform private.raise_error('forbidden'); end if;
  if not exists (select 1 from public.gov_sources where id = p_source) then perform private.raise_error('not_found'); end if;
  if jsonb_typeof(p_change) <> 'object' then perform private.raise_error('invalid', 'change'); end if;
  for k in select jsonb_object_keys(p_change) loop
    if k not in ('approved_urls', 'allowed_hosts', 'enabled', 'refresh_interval_minutes', 'rate_per_minute', 'freshness_hours', 'usage_restrictions') then
      perform private.raise_error('invalid', 'field');
    end if;
  end loop;
  insert into public.gov_source_changes (source_id, change, reason, proposed_by)
  values (p_source, p_change, btrim(p_reason), auth.uid()) returning id into v_id;
  perform private.gov_event('source.change_proposed', p_source, null, null, jsonb_build_object('change_id', v_id));
  return v_id;
end;
$$;

create function public.gov_decide_source_change(p_change uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as
$$
declare c public.gov_source_changes; v_user uuid := auth.uid();
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:source_admin') then perform private.raise_error('forbidden'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.raise_error('invalid', 'reason'); end if;
  select * into c from public.gov_source_changes where id = p_change for update;
  if c.id is null then perform private.raise_error('not_found'); end if;
  if c.status <> 'pending' then perform private.raise_error('conflict', 'already_decided'); end if;
  if c.proposed_by = v_user then perform private.raise_error('forbidden', 'second_person_required'); end if;
  update public.gov_source_changes set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_user, decided_at = now(), decision_reason = btrim(p_reason) where id = c.id;
  if p_approve then
    update public.gov_sources set
      approved_urls = coalesce((select array_agg(x) from jsonb_array_elements_text(c.change -> 'approved_urls') x), approved_urls),
      allowed_hosts = coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(c.change -> 'allowed_hosts') x), allowed_hosts),
      enabled = coalesce((c.change ->> 'enabled')::boolean, enabled),
      refresh_interval_minutes = coalesce((c.change ->> 'refresh_interval_minutes')::int, refresh_interval_minutes),
      rate_per_minute = coalesce((c.change ->> 'rate_per_minute')::int, rate_per_minute),
      freshness_hours = coalesce((c.change ->> 'freshness_hours')::int, freshness_hours),
      usage_restrictions = coalesce(c.change ->> 'usage_restrictions', usage_restrictions),
      verified_by = v_user, verified_at = now(), version = version + 1,
      next_check_at = case when coalesce((c.change ->> 'enabled')::boolean, enabled) then now() else next_check_at end
    where id = c.source_id;
  end if;
  perform private.gov_event('source.change_' || case when p_approve then 'approved' else 'rejected' end, c.source_id, null, null,
    jsonb_build_object('change_id', c.id));
  perform private.write_audit('gov.source.changed', null, 'gov_source', c.source_id::text, jsonb_build_object('approved', p_approve));
end;
$$;

-- Registering agencies and sources: source administrators only; a new source starts disabled.
create function public.gov_register_source(p_agency_code text, p_agency_name text, p_domain text, p_name text, p_type text,
  p_adapter text, p_hosts text[], p_urls text[], p_method text, p_restrictions text) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare v_agency uuid; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:source_admin') then perform private.raise_error('forbidden'); end if;
  insert into public.gov_agencies (code, name, domain) values (upper(p_agency_code), p_agency_name, lower(p_domain))
  on conflict (code) do update set name = excluded.name returning id into v_agency;
  insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, allowed_method, usage_restrictions,
    verified_by, verified_at)
  values (v_agency, p_name, p_type, p_adapter, (select array_agg(lower(h)) from unnest(p_hosts) h), p_urls, p_method, p_restrictions,
    auth.uid(), now()) returning id into v_id;
  perform private.gov_event('source.registered', v_id, null, null, jsonb_build_object('name', p_name));
  return v_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- Public read model: published, non-sensitive fields only. Application status is shown only with fresh evidence.
------------------------------------------------------------------------------------------------
create function public.gov_list_programmes(p_funding_type text default null, p_query text default null, p_limit integer default 30, p_offset integer default 0)
returns table (
  id uuid, slug text, name text, agency_name text, funding_type text, amount_min numeric, amount_max numeric, currency text,
  application_status text, opens_on date, closes_on date, last_checked_at timestamptz, last_verified_at timestamptz,
  info_url text, application_url text, application_channel text, summary text, is_stale boolean
)
language sql stable security definer set search_path = '' as
$$
  select p.id, p.slug, p.name, a.name, p.funding_type, p.amount_min, p.amount_max, p.currency,
    case when p.application_status in ('open', 'upcoming') and (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => s.freshness_hours))
         then 'unknown' else p.application_status end,
    p.opens_on, p.closes_on, p.last_checked_at, p.last_verified_at,
    v.data ->> 'info_url', v.data ->> 'application_url', v.data ->> 'application_channel', left(v.data ->> 'description', 600),
    (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => s.freshness_hours))
  from public.gov_programmes p
  join public.gov_programme_versions v on v.id = p.current_version_id
  join public.gov_sources s on s.id = p.source_id
  join public.gov_agencies a on a.id = p.agency_id
  where p.publication_state = 'published'
    and (p_funding_type is null or p.funding_type = p_funding_type)
    and (p_query is null or p.name ilike '%' || replace(replace(left(p_query, 80), '%', ''), '_', '') || '%')
  order by p.name
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)
$$;

------------------------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------------------------
revoke all on function
  public.gov_enqueue_due_jobs(), public.gov_claim_jobs(text, integer, integer), public.gov_complete_job(uuid, text, jsonb),
  public.gov_fail_job(uuid, text, text, integer), public.gov_submit_candidate(uuid, uuid, text, jsonb), public.gov_mark_missing(uuid, text),
  public.gov_job_source(uuid), public.gov_decide_proposal(uuid, text, text, text), public.gov_set_programme_state(uuid, text, text),
  public.gov_set_setting(text, boolean, text), public.gov_propose_source_change(uuid, jsonb, text),
  public.gov_decide_source_change(uuid, boolean, text),
  public.gov_register_source(text, text, text, text, text, text, text[], text[], text, text),
  public.gov_list_programmes(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function
  public.gov_enqueue_due_jobs(), public.gov_claim_jobs(text, integer, integer), public.gov_complete_job(uuid, text, jsonb),
  public.gov_fail_job(uuid, text, text, integer), public.gov_submit_candidate(uuid, uuid, text, jsonb), public.gov_mark_missing(uuid, text),
  public.gov_job_source(uuid)
to service_role;
grant execute on function
  public.gov_decide_proposal(uuid, text, text, text), public.gov_set_programme_state(uuid, text, text),
  public.gov_set_setting(text, boolean, text), public.gov_propose_source_change(uuid, jsonb, text),
  public.gov_decide_source_change(uuid, boolean, text),
  public.gov_register_source(text, text, text, text, text, text, text[], text[], text, text)
to authenticated;
grant execute on function public.gov_list_programmes(text, text, integer, integer) to anon, authenticated;

-- Private helpers are never callable from the API roles (security definer code and the table owner use them).
revoke all on function
  private.gov_setting(text), private.gov_versions_immutable(), private.gov_events_immutable(), private.gov_event(text, uuid, uuid, uuid, jsonb),
  private.gov_valid_rule(jsonb), private.gov_candidate_problem(jsonb), private.gov_canonical(jsonb), private.gov_all_https(text[])
  from public, anon, authenticated, service_role;
