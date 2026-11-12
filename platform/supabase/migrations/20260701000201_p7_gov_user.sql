-- Phase 7 user side: business assistance profile, saved opportunities with user-reported tracking,
-- notification preferences, persistent outbox, and the versioned event feed Phase 8 will consume.
-- Privacy: everything here is private to the organisation's authorised members (RLS select-only, writes via RPCs).
-- Nothing here is shown in the public directory. Sensitive declarations (community, citizenship, age) are optional,
-- purpose-limited to programme matching, and removed with the organisation (ON DELETE CASCADE).

insert into public.role_permissions (role, permission) values
  ('owner', 'assist:manage'), ('manager', 'assist:manage'), ('staff', 'assist:manage')
on conflict do nothing;

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------
create table public.gov_assistance_profiles (
  org_id uuid primary key references public.organisations (id) on delete cascade,
  needs text[] not null default '{}' check (needs <@ array['financing', 'grant', 'training', 'growth']::text[]),
  business_size text check (business_size in ('micro', 'small', 'medium')),
  employees integer check (employees between 0 and 100000),
  years_operating integer check (years_operating between 0 and 200),
  registration text check (registration in ('registered', 'licensed', 'none')),
  sector text check (char_length(sector) <= 80),
  state text check (char_length(state) <= 60),
  -- Voluntary, purpose-limited declarations. Only used when a programme publishes a matching condition.
  community text check (community in ('indian', 'other', 'prefer_not')),
  citizenship text check (citizenship in ('malaysian', 'other', 'prefer_not')),
  owner_age integer check (owner_age between 16 and 100),
  version integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.gov_saved (
  org_id uuid not null references public.organisations (id) on delete cascade,
  programme_id uuid not null references public.gov_programmes (id) on delete cascade,
  tracking_status text not null default 'interested'
    check (tracking_status in ('interested', 'preparing', 'applied_externally', 'awaiting_decision', 'outcome_recorded', 'not_interested')),
  note text check (char_length(note) <= 500),
  applied_on date,
  outcome text check (outcome in ('approved', 'declined', 'withdrawn', 'other')),
  reminder_on date,
  seen_version_no integer not null default 0,
  version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, programme_id),
  check (outcome is null or tracking_status = 'outcome_recorded')
);
create index gov_saved_programme on public.gov_saved (programme_id);

create table public.gov_notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  new_match boolean not null default true,
  opens boolean not null default true,
  deadline boolean not null default true,
  rule_change boolean not null default true,
  unavailable boolean not null default true,
  reminder boolean not null default true,
  channel_in_app boolean not null default true,
  channel_email boolean not null default false,
  paused_until timestamptz,
  frequency text not null default 'immediate' check (frequency in ('immediate', 'daily', 'weekly')),
  email_unsubscribed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.gov_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) <= 300),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid references public.organisations (id) on delete cascade,
  category text not null check (category in ('new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder')),
  programme_id uuid not null references public.gov_programmes (id) on delete cascade,
  version_no integer,
  in_app_status text not null default 'pending' check (in_app_status in ('pending', 'sent', 'skipped')),
  email_status text not null default 'pending' check (email_status in ('pending', 'queued', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index gov_outbox_pending on public.gov_outbox (created_at) where in_app_status = 'pending' or email_status in ('pending', 'queued');

-- Phase 8 contract: append-only, versioned, free of any private business data.
create table public.gov_programme_events (
  id bigint generated always as identity primary key,
  contract text not null default 'gov-events/1.0',
  kind text not null check (kind in ('programme_discovered', 'programme_verified', 'programme_opened', 'programme_updated', 'deadline_changed', 'programme_closed')),
  programme_id uuid not null references public.gov_programmes (id) on delete restrict,
  version_no integer,
  at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index gov_programme_events_at on public.gov_programme_events (at);
create function private.gov_programme_events_immutable() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin raise exception 'gov_programme_events is append-only' using errcode = '42501'; end; $$;
create trigger gov_programme_events_no_change before update or delete on public.gov_programme_events
  for each row execute function private.gov_programme_events_immutable();
create trigger gov_programme_events_no_truncate before truncate on public.gov_programme_events
  for each statement execute function private.gov_programme_events_immutable();

------------------------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------------------------
alter table public.gov_assistance_profiles enable row level security;
alter table public.gov_saved enable row level security;
alter table public.gov_notification_prefs enable row level security;
alter table public.gov_outbox enable row level security;
alter table public.gov_programme_events enable row level security;

create policy gov_profile_select on public.gov_assistance_profiles for select to authenticated
  using (private.has_permission(org_id, 'assist:manage'));
create policy gov_saved_select on public.gov_saved for select to authenticated
  using (private.has_permission(org_id, 'assist:manage'));
create policy gov_prefs_select on public.gov_notification_prefs for select to authenticated using (user_id = auth.uid());
create policy gov_outbox_select on public.gov_outbox for select to authenticated using (user_id = auth.uid());
create policy gov_events_select on public.gov_programme_events for select to authenticated using (private.has_platform_permission('gov:view'));

grant select on public.gov_assistance_profiles, public.gov_saved, public.gov_notification_prefs, public.gov_outbox,
  public.gov_programme_events to authenticated;
grant select on public.gov_outbox, public.gov_notification_prefs, public.gov_programme_events to service_role;

------------------------------------------------------------------------------------------------
-- Guards
------------------------------------------------------------------------------------------------
create function private.assert_assist_org(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not exists (select 1 from public.organisations o where o.id = p_org and o.type in ('business', 'buyer')) then
    perform private.raise_error('not_found');
  end if;
  if not private.has_permission(p_org, 'assist:manage') then perform private.raise_error('not_found'); end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Profile
------------------------------------------------------------------------------------------------
create function public.gov_get_profile(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r public.gov_assistance_profiles;
begin
  perform private.assert_assist_org(p_org);
  select * into r from public.gov_assistance_profiles where org_id = p_org;
  if r.org_id is null then return jsonb_build_object('org_id', p_org, 'version', 0, 'needs', '[]'::jsonb); end if;
  return to_jsonb(r) - 'updated_by';
end;
$$;

create function public.gov_save_profile(p_org uuid, p_data jsonb, p_expected_version integer) returns integer
language plpgsql security definer set search_path = '' as
$$
declare cur public.gov_assistance_profiles; v_needs text[]; v_new integer;
begin
  perform private.assert_assist_org(p_org);
  if jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  if jsonb_typeof(coalesce(p_data -> 'needs', '[]'::jsonb)) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
  perform pg_advisory_xact_lock(hashtextextended('gov_profile:' || p_org::text, 0)); -- serialises the first save (no row to lock yet)
  select * into cur from public.gov_assistance_profiles where org_id = p_org for update;
  if coalesce(cur.version, 0) <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
  v_needs := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_data -> 'needs', '[]'::jsonb)) x), '{}');
  begin
    insert into public.gov_assistance_profiles as t (org_id, needs, business_size, employees, years_operating, registration, sector, state,
      community, citizenship, owner_age, updated_by)
    values (p_org, v_needs, nullif(p_data ->> 'business_size', ''), (nullif(p_data ->> 'employees', ''))::int,
      (nullif(p_data ->> 'years_operating', ''))::int, nullif(p_data ->> 'registration', ''), nullif(left(p_data ->> 'sector', 80), ''),
      nullif(left(p_data ->> 'state', 60), ''), nullif(p_data ->> 'community', ''), nullif(p_data ->> 'citizenship', ''),
      (nullif(p_data ->> 'owner_age', ''))::int, auth.uid())
    on conflict (org_id) do update set needs = excluded.needs, business_size = excluded.business_size, employees = excluded.employees,
      years_operating = excluded.years_operating, registration = excluded.registration, sector = excluded.sector, state = excluded.state,
      community = excluded.community, citizenship = excluded.citizenship, owner_age = excluded.owner_age,
      version = t.version + 1, updated_by = auth.uid(), updated_at = now()
    returning version into v_new;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  return v_new;
end;
$$;

------------------------------------------------------------------------------------------------
-- Saved opportunities and user-reported tracking
------------------------------------------------------------------------------------------------
create function public.gov_save_programme(p_org uuid, p_programme uuid) returns void
language plpgsql security definer set search_path = '' as
$$
declare v_no integer;
begin
  perform private.assert_assist_org(p_org);
  select v.version_no into v_no from public.gov_programmes p join public.gov_programme_versions v on v.id = p.current_version_id
    where p.id = p_programme and p.publication_state = 'published';
  if v_no is null then perform private.raise_error('not_found'); end if;
  insert into public.gov_saved (org_id, programme_id, seen_version_no, created_by) values (p_org, p_programme, v_no, auth.uid())
  on conflict do nothing;
end;
$$;

create function public.gov_unsave_programme(p_org uuid, p_programme uuid) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  perform private.assert_assist_org(p_org);
  delete from public.gov_saved where org_id = p_org and programme_id = p_programme;
end;
$$;

-- Statuses here are what the business owner reports. They are never agency decisions.
create function public.gov_update_tracking(p_org uuid, p_programme uuid, p_data jsonb, p_expected_version integer) returns integer
language plpgsql security definer set search_path = '' as
$$
declare s public.gov_saved; v_status text; v_new integer;
begin
  perform private.assert_assist_org(p_org);
  select * into s from public.gov_saved where org_id = p_org and programme_id = p_programme for update;
  if s.org_id is null then perform private.raise_error('not_found'); end if;
  if s.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
  v_status := coalesce(nullif(p_data ->> 'tracking_status', ''), s.tracking_status);
  begin
    update public.gov_saved set tracking_status = v_status,
      note = case when p_data ? 'note' then nullif(left(btrim(p_data ->> 'note'), 500), '') else note end,
      applied_on = case when p_data ? 'applied_on' then (nullif(p_data ->> 'applied_on', ''))::date else applied_on end,
      outcome = case when v_status = 'outcome_recorded' then coalesce(nullif(p_data ->> 'outcome', ''), outcome) else null end,
      reminder_on = case when p_data ? 'reminder_on' then (nullif(p_data ->> 'reminder_on', ''))::date else reminder_on end,
      seen_version_no = case when (p_data ->> 'mark_seen') = 'true'
        then coalesce((select v.version_no from public.gov_programmes p join public.gov_programme_versions v on v.id = p.current_version_id where p.id = p_programme), seen_version_no)
        else seen_version_no end,
      version = version + 1, updated_at = now()
    where org_id = p_org and programme_id = p_programme returning version into v_new;
  exception when check_violation or invalid_text_representation or datetime_field_overflow then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  return v_new;
end;
$$;

create function public.gov_list_saved(p_org uuid)
returns table (programme_id uuid, slug text, name text, agency_name text, funding_type text, application_status text, closes_on date,
  last_checked_at timestamptz, last_verified_at timestamptz, publication_state text, tracking_status text, note text, applied_on date,
  outcome text, reminder_on date, version integer, rules_changed boolean, is_stale boolean)
language plpgsql stable security definer set search_path = '' as
$$
begin
  perform private.assert_assist_org(p_org);
  return query
  select p.id, p.slug, p.name, a.name, p.funding_type,
    case when p.publication_state <> 'published' then 'unknown'
         when p.application_status in ('open', 'upcoming') and (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours)) then 'unknown'
         else p.application_status end,
    p.closes_on, p.last_checked_at, p.last_verified_at, p.publication_state, s.tracking_status, s.note, s.applied_on, s.outcome, s.reminder_on,
    s.version, coalesce(v.version_no, 0) > s.seen_version_no,
    (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours))
  from public.gov_saved s
  join public.gov_programmes p on p.id = s.programme_id
  join public.gov_agencies a on a.id = p.agency_id
  join public.gov_sources so on so.id = p.source_id
  left join public.gov_programme_versions v on v.id = p.current_version_id
  where s.org_id = p_org
  order by s.created_at desc;
end;
$$;

-- Public programme detail: the verified version (plain data) plus provenance. No private data.
create function public.gov_get_programme(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare p public.gov_programmes; v public.gov_programme_versions; a public.gov_agencies; so public.gov_sources; v_stale boolean;
begin
  select * into p from public.gov_programmes where slug = p_slug and publication_state = 'published';
  if p.id is null then perform private.raise_error('not_found'); end if;
  select * into v from public.gov_programme_versions where id = p.current_version_id;
  select * into a from public.gov_agencies where id = p.agency_id;
  select * into so from public.gov_sources where id = p.source_id;
  v_stale := p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours);
  return jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'agency', a.name, 'agency_domain', a.domain, 'version_no', v.version_no,
    'verification_status', p.verification_status,
    'application_status', case when p.application_status in ('open', 'upcoming') and v_stale then 'unknown' else p.application_status end,
    'is_stale', v_stale, 'last_checked_at', p.last_checked_at, 'last_verified_at', p.last_verified_at,
    'data', v.data - 'review_notes');
end;
$$;

------------------------------------------------------------------------------------------------
-- Preferences
------------------------------------------------------------------------------------------------
create function public.gov_get_prefs() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r public.gov_notification_prefs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.gov_notification_prefs where user_id = auth.uid();
  if r.user_id is null then
    return jsonb_build_object('new_match', true, 'opens', true, 'deadline', true, 'rule_change', true, 'unavailable', true, 'reminder', true,
      'channel_in_app', true, 'channel_email', false, 'paused_until', null, 'frequency', 'immediate');
  end if;
  return to_jsonb(r) - 'user_id' - 'updated_at';
end;
$$;

create function public.gov_set_prefs(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as
$$
declare k text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  for k in select jsonb_object_keys(p_data) loop
    if k not in ('new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder', 'channel_in_app', 'channel_email', 'paused_until', 'frequency') then
      perform private.raise_error('invalid', 'field');
    end if;
  end loop;
  insert into public.gov_notification_prefs (user_id) values (auth.uid()) on conflict do nothing;
  begin
    update public.gov_notification_prefs set
      new_match = coalesce((p_data ->> 'new_match')::boolean, new_match), opens = coalesce((p_data ->> 'opens')::boolean, opens),
      deadline = coalesce((p_data ->> 'deadline')::boolean, deadline), rule_change = coalesce((p_data ->> 'rule_change')::boolean, rule_change),
      unavailable = coalesce((p_data ->> 'unavailable')::boolean, unavailable), reminder = coalesce((p_data ->> 'reminder')::boolean, reminder),
      channel_in_app = coalesce((p_data ->> 'channel_in_app')::boolean, channel_in_app),
      channel_email = coalesce((p_data ->> 'channel_email')::boolean, channel_email),
      paused_until = case when p_data ? 'paused_until' then (nullif(p_data ->> 'paused_until', ''))::timestamptz else paused_until end,
      frequency = coalesce(p_data ->> 'frequency', frequency),
      -- Turning email off is an unsubscribe: remembered so no later code path sends email again until the user opts back in.
      email_unsubscribed_at = case when (p_data ->> 'channel_email') = 'false' then now() when (p_data ->> 'channel_email') = 'true' then null else email_unsubscribed_at end,
      updated_at = now()
    where user_id = auth.uid();
  exception when check_violation or invalid_text_representation or datetime_field_overflow then
    perform private.raise_error('invalid', 'invalid_data');
  end;
end;
$$;

------------------------------------------------------------------------------------------------
-- Events and outbox (called from the review RPCs; idempotent by event_key)
------------------------------------------------------------------------------------------------
create function private.gov_emit_events(p_programme uuid, p_version integer, p_kind text, p_flags text[]) returns void
language plpgsql security definer set search_path = '' as
$$
declare prog public.gov_programmes; v_category text; v_cats text[] := '{}'; c text; v_need text; v_name text; v_agency text;
begin
  select * into prog from public.gov_programmes where id = p_programme;
  select a.name into v_agency from public.gov_agencies a where a.id = prog.agency_id;
  insert into public.gov_programme_events (kind, programme_id, version_no, payload)
  values (p_kind, p_programme, p_version, jsonb_build_object('name', prog.name, 'agency', v_agency, 'application_status', prog.application_status,
    'closes_on', prog.closes_on, 'flags', to_jsonb(coalesce(p_flags, '{}'::text[]))));
  if p_kind = 'programme_verified' then v_cats := array['new_match'];
  elsif p_kind = 'programme_opened' then v_cats := array['opens'];
  elsif p_kind = 'deadline_changed' then v_cats := array['deadline'];
  elsif p_kind = 'programme_closed' then v_cats := array['unavailable'];
  elsif p_kind = 'programme_updated' then v_cats := array['rule_change'];
  end if;
  foreach c in array v_cats loop
    if c = 'new_match' then
      v_need := case prog.funding_type when 'financing' then 'financing' when 'grant' then 'grant' when 'subsidy' then 'grant' when 'training' then 'training' else 'growth' end;
      insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
      select 'new_match:' || p_programme || ':' || coalesce(p_version, 0) || ':' || m.user_id, m.user_id, m.org_id, 'new_match', p_programme, p_version
      from public.gov_assistance_profiles ap
      join public.memberships m on m.org_id = ap.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
      where v_need = any (ap.needs)
      on conflict (event_key) do nothing;
    else
      insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
      select c || ':' || p_programme || ':' || coalesce(p_version, 0) || ':' || m.user_id, m.user_id, m.org_id, c, p_programme, p_version
      from public.gov_saved s
      join public.memberships m on m.org_id = s.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
      where s.programme_id = p_programme and s.tracking_status <> 'not_interested'
      on conflict (event_key) do nothing;
    end if;
  end loop;
end;
$$;

-- Deadline and personal reminders. Deadline notices need fresh evidence (checked within a day).
create function public.gov_enqueue_reminders() returns integer
language plpgsql security definer set search_path = '' as
$$
declare n integer := 0; r integer;
begin
  if not private.gov_setting('notifications_enabled') then return 0; end if;
  insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
  select 'reminder:' || s.programme_id || ':' || s.org_id || ':' || m.user_id || ':' || s.reminder_on, m.user_id, s.org_id, 'reminder', s.programme_id, null
  from public.gov_saved s join public.memberships m on m.org_id = s.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
  where s.reminder_on <= current_date and s.tracking_status not in ('not_interested', 'outcome_recorded')
  on conflict (event_key) do nothing;
  get diagnostics r = row_count; n := n + r;
  insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
  select 'deadline:' || p.id || ':' || p.closes_on || ':' || m.user_id, m.user_id, s.org_id, 'deadline', p.id, null
  from public.gov_programmes p
  join public.gov_sources so on so.id = p.source_id
  join public.gov_saved s on s.programme_id = p.id and s.tracking_status not in ('not_interested', 'applied_externally', 'awaiting_decision', 'outcome_recorded')
  join public.memberships m on m.org_id = s.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
  where p.publication_state = 'published' and p.application_status = 'open' and p.closes_on between current_date and current_date + 7
    and p.last_checked_at >= now() - make_interval(hours => least(24, so.freshness_hours))
  on conflict (event_key) do nothing;
  get diagnostics r = row_count; n := n + r;
  return n;
end;
$$;

-- Delivers in-app notifications and hands email jobs to the app. Honours switch, category, pause, frequency and unsubscribe.
-- Returns the email jobs (address read here only; the app sends and then reports through gov_mark_email).
create function public.gov_dispatch_outbox(p_limit integer)
returns table (outbox_id uuid, email text, category text, programme_name text, programme_slug text)
language plpgsql security definer set search_path = '' as
$$
declare o public.gov_outbox; pr public.gov_notification_prefs; prog public.gov_programmes; v_on boolean; v_cap interval; v_email text;
  v_defer boolean;
begin
  if not private.gov_setting('notifications_enabled') then return; end if;
  -- A crash between the provider accepting a message and our report leaves a row queued: after 15 minutes it is offered again (at most 5 attempts).
  update public.gov_outbox set email_status = case when attempts >= 5 then 'failed' else 'pending' end, last_error = 'queued_timeout'
   where email_status = 'queued' and processed_at < now() - interval '15 minutes';
  for o in select * from public.gov_outbox where (in_app_status = 'pending' or email_status = 'pending')
           order by created_at for update skip locked limit greatest(1, least(p_limit, 200)) loop
    select * into pr from public.gov_notification_prefs where user_id = o.user_id;
    select * into prog from public.gov_programmes where id = o.programme_id;
    v_on := case o.category when 'new_match' then coalesce(pr.new_match, true) when 'opens' then coalesce(pr.opens, true)
      when 'deadline' then coalesce(pr.deadline, true) when 'rule_change' then coalesce(pr.rule_change, true)
      when 'unavailable' then coalesce(pr.unavailable, true) else coalesce(pr.reminder, true) end;
    if prog.publication_state not in ('published', 'archived') or not v_on then
      update public.gov_outbox set in_app_status = case when in_app_status = 'pending' then 'skipped' else in_app_status end,
        email_status = case when email_status = 'pending' then 'skipped' else email_status end, processed_at = now() where id = o.id;
      continue;
    end if;
    if pr.paused_until is not null and pr.paused_until > now() then continue; end if; -- stays pending until the pause ends
    v_cap := case coalesce(pr.frequency, 'immediate') when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '0' end;
    v_defer := v_cap > interval '0' and exists (select 1 from public.gov_outbox x where x.user_id = o.user_id and x.id <> o.id
      and x.processed_at > now() - v_cap and (x.in_app_status = 'sent' or x.email_status in ('queued', 'sent')));
    if v_defer then continue; end if;
    if o.in_app_status = 'pending' then
      if coalesce(pr.channel_in_app, true) then
        insert into public.notifications (user_id, org_id, kind, entity_type, entity_id)
        values (o.user_id, o.org_id, 'gov.' || o.category, 'gov_programme', o.programme_id::text);
        update public.gov_outbox set in_app_status = 'sent', processed_at = now() where id = o.id;
      else
        update public.gov_outbox set in_app_status = 'skipped', processed_at = now() where id = o.id;
      end if;
    end if;
    if o.email_status = 'pending' then
      select u.email into v_email from auth.users u where u.id = o.user_id and u.email_confirmed_at is not null;
      if coalesce(pr.channel_email, false) and pr.email_unsubscribed_at is null and v_email is not null then
        update public.gov_outbox set email_status = 'queued', attempts = attempts + 1, processed_at = now() where id = o.id;
        outbox_id := o.id; email := v_email; category := o.category; programme_name := prog.name; programme_slug := prog.slug;
        return next;
      else
        update public.gov_outbox set email_status = 'skipped', processed_at = now() where id = o.id;
      end if;
    end if;
  end loop;
end;
$$;

-- The app reports the provider's answer. "sent" only when the provider accepted the message.
create function public.gov_mark_email(p_outbox uuid, p_accepted boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as
$$
declare o public.gov_outbox;
begin
  select * into o from public.gov_outbox where id = p_outbox for update;
  if o.id is null then perform private.raise_error('not_found'); end if;
  if o.email_status <> 'queued' then return; end if; -- idempotent
  if p_accepted then
    update public.gov_outbox set email_status = 'sent', last_error = null, processed_at = now() where id = o.id;
  elsif p_error = 'mailer_not_configured' then
    update public.gov_outbox set email_status = 'pending', attempts = greatest(attempts - 1, 0), last_error = 'mailer_not_configured', processed_at = now() where id = o.id;
  else
    update public.gov_outbox set email_status = case when attempts >= 5 then 'failed' else 'pending' end,
      last_error = left(coalesce(p_error, 'send_failed'), 300), processed_at = now() where id = o.id;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------------------------
revoke all on function
  private.assert_assist_org(uuid), private.gov_programme_events_immutable(), private.gov_emit_events(uuid, integer, text, text[]),
  public.gov_get_profile(uuid), public.gov_save_profile(uuid, jsonb, integer), public.gov_save_programme(uuid, uuid),
  public.gov_unsave_programme(uuid, uuid), public.gov_update_tracking(uuid, uuid, jsonb, integer), public.gov_list_saved(uuid),
  public.gov_get_programme(text), public.gov_get_prefs(), public.gov_set_prefs(jsonb), public.gov_enqueue_reminders(),
  public.gov_dispatch_outbox(integer), public.gov_mark_email(uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.gov_get_profile(uuid), public.gov_save_profile(uuid, jsonb, integer), public.gov_save_programme(uuid, uuid),
  public.gov_unsave_programme(uuid, uuid), public.gov_update_tracking(uuid, uuid, jsonb, integer), public.gov_list_saved(uuid),
  public.gov_get_prefs(), public.gov_set_prefs(jsonb)
  to authenticated;
grant execute on function public.gov_get_programme(text) to anon, authenticated;
grant execute on function public.gov_enqueue_reminders(), public.gov_dispatch_outbox(integer), public.gov_mark_email(uuid, boolean, text) to service_role;
