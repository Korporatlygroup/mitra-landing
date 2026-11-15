-- Phase 7 completion: manual programme entry with a two-person rule, catalogue fields, page monitoring with conditional
-- requests, 14/3-day deadline reminders and recheck notices, the "ready to apply" tracking stage.
-- Replaces functions from 000200/000201 with create or replace (same signatures) or drop + create (changed return type).
-- Nothing here publishes anything; no data is invented.

------------------------------------------------------------------------------------------------
-- 1. Tracking stage and notification preferences
------------------------------------------------------------------------------------------------
alter table public.gov_saved drop constraint gov_saved_tracking_status_check;
alter table public.gov_saved add constraint gov_saved_tracking_status_check
  check (tracking_status in ('interested', 'preparing', 'ready_to_apply', 'applied_externally', 'awaiting_decision', 'outcome_recorded', 'not_interested'));

create function private.gov_valid_days(p integer[]) returns boolean
language sql immutable set search_path = '' as
$$ select p is not null and cardinality(p) between 1 and 4
   and not exists (select 1 from unnest(p) d where d is null or d not between 1 and 60) $$;

alter table public.gov_notification_prefs
  add column reminder_days integer[] not null default '{14,3}' check (private.gov_valid_days(reminder_days));

alter table public.gov_outbox drop constraint gov_outbox_category_check;
alter table public.gov_outbox add constraint gov_outbox_category_check
  check (category in ('new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder', 'recheck'));

create or replace function public.gov_get_prefs() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r public.gov_notification_prefs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.gov_notification_prefs where user_id = auth.uid();
  if r.user_id is null then
    return jsonb_build_object('new_match', true, 'opens', true, 'deadline', true, 'rule_change', true, 'unavailable', true, 'reminder', true,
      'channel_in_app', true, 'channel_email', false, 'paused_until', null, 'frequency', 'immediate', 'reminder_days', jsonb_build_array(14, 3));
  end if;
  return to_jsonb(r) - 'user_id' - 'updated_at';
end;
$$;

create or replace function public.gov_set_prefs(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as
$$
declare k text; v_days integer[];
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  for k in select jsonb_object_keys(p_data) loop
    if k not in ('new_match', 'opens', 'deadline', 'rule_change', 'unavailable', 'reminder', 'channel_in_app', 'channel_email', 'paused_until', 'frequency', 'reminder_days') then
      perform private.raise_error('invalid', 'field');
    end if;
  end loop;
  if p_data ? 'reminder_days' then
    begin
      if jsonb_typeof(p_data -> 'reminder_days') <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
      select coalesce(array_agg(x::int order by x::int desc), '{}') into v_days from jsonb_array_elements_text(p_data -> 'reminder_days') x;
    exception when invalid_text_representation or numeric_value_out_of_range then
      perform private.raise_error('invalid', 'invalid_data');
    end;
    if not private.gov_valid_days(v_days) then perform private.raise_error('invalid', 'invalid_data'); end if;
  end if;
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
      reminder_days = coalesce(v_days, reminder_days),
      email_unsubscribed_at = case when (p_data ->> 'channel_email') = 'false' then now() when (p_data ->> 'channel_email') = 'true' then null else email_unsubscribed_at end,
      updated_at = now()
    where user_id = auth.uid();
  exception when check_violation or invalid_text_representation or datetime_field_overflow then
    perform private.raise_error('invalid', 'invalid_data');
  end;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Reminders: 14 and 3 days (per person, changeable) before a CONFIRMED deadline; recheck notices for stale saved programmes.
--    Unknown dates never produce a deadline notice. One notice per deadline and offset (the event key makes repeats impossible).
------------------------------------------------------------------------------------------------
create or replace function public.gov_enqueue_reminders() returns integer
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
  -- Deadline notices: the smallest chosen offset that is still >= days left (so someone who saves a programme 2 days before the
  -- deadline gets one notice, not two). Needs a verified programme, an open status and a recent check.
  insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
  select 'deadline:' || p.id || ':' || p.closes_on || ':' || pick.d || ':' || m.user_id, m.user_id, s.org_id, 'deadline', p.id, null
  from public.gov_programmes p
  join public.gov_sources so on so.id = p.source_id
  join public.gov_saved s on s.programme_id = p.id and s.tracking_status not in ('not_interested', 'applied_externally', 'awaiting_decision', 'outcome_recorded')
  join public.memberships m on m.org_id = s.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
  left join public.gov_notification_prefs pr on pr.user_id = m.user_id
  cross join lateral (select min(x) as d from unnest(coalesce(pr.reminder_days, array[14, 3])) x where x >= (p.closes_on - current_date)) pick
  where p.publication_state = 'published' and p.verification_status = 'verified' and p.application_status = 'open'
    and p.closes_on is not null and p.closes_on >= current_date and pick.d is not null
    and p.last_checked_at >= now() - make_interval(hours => least(24, so.freshness_hours))
  on conflict (event_key) do nothing;
  get diagnostics r = row_count; n := n + r;
  -- A saved programme whose source has not been confirmed inside its freshness window needs rechecking (at most weekly per person).
  insert into public.gov_outbox (event_key, user_id, org_id, category, programme_id, version_no)
  select 'recheck:' || p.id || ':' || to_char(now(), 'IYYY-IW') || ':' || m.user_id, m.user_id, s.org_id, 'recheck', p.id, null
  from public.gov_programmes p
  join public.gov_sources so on so.id = p.source_id
  join public.gov_saved s on s.programme_id = p.id and s.tracking_status not in ('not_interested', 'outcome_recorded')
  join public.memberships m on m.org_id = s.org_id and m.status = 'active' and m.role in ('owner', 'manager', 'staff')
  where p.publication_state = 'published' and (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours))
  on conflict (event_key) do nothing;
  get diagnostics r = row_count; n := n + r;
  return n;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Catalogue fields: category, who it is for (entrepreneur / organisation / both), sectors, states.
--    They live in the immutable version data; category and beneficiary are also promoted for listing and filtering.
------------------------------------------------------------------------------------------------
alter table public.gov_programmes
  add column category text check (category in ('grants_funding', 'business_financing', 'training', 'advisory', 'entrepreneurship', 'digital', 'other')),
  add column beneficiary_type text check (beneficiary_type in ('entrepreneur', 'organisation', 'both'));

update public.gov_programmes set category = case funding_type
  when 'grant' then 'grants_funding' when 'subsidy' then 'grants_funding' when 'financing' then 'business_financing'
  when 'training' then 'training' else 'other' end
where category is null and funding_type is not null;

create or replace function private.gov_canonical(p_c jsonb) returns jsonb
language sql immutable set search_path = '' as
$$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select k, case when k = 'rules'
        then (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from jsonb_array_elements(p_c -> 'rules') x)
        else p_c -> k end as v
    from unnest(array['name', 'description', 'funding_type', 'amount_min', 'amount_max', 'currency', 'application_channel',
      'application_url', 'info_url', 'opens_on', 'closes_on', 'application_status', 'documents', 'terms', 'rules', 'review_notes', 'extraction_status',
      'category', 'beneficiary_type', 'sectors', 'states']) k
    where p_c ? k and jsonb_typeof(p_c -> k) <> 'null'
  ) t
$$;

create or replace function private.gov_candidate_problem(p_c jsonb) returns text
language plpgsql immutable set search_path = '' as
$$
declare r jsonb; k text;
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
  if (p_c ->> 'opens_on') is not null and not private.gov_is_date(p_c ->> 'opens_on') then return 'opens_on'; end if;
  if (p_c ->> 'closes_on') is not null and not private.gov_is_date(p_c ->> 'closes_on') then return 'closes_on'; end if;
  if (p_c ->> 'opens_on') is not null and (p_c ->> 'closes_on') is not null
     and (p_c ->> 'opens_on')::date > (p_c ->> 'closes_on')::date then return 'dates_contradict'; end if;
  if jsonb_typeof(coalesce(p_c -> 'rules', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'rules', '[]'::jsonb)) > 40 then return 'rules'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_c -> 'rules', '[]'::jsonb)) loop
    if not private.gov_valid_rule(r) then return 'rule'; end if;
  end loop;
  if char_length(coalesce(p_c ->> 'description', '')) > 4000 then return 'description'; end if;
  if jsonb_typeof(coalesce(p_c -> 'terms', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'terms', '[]'::jsonb)) > 15 then return 'terms'; end if;
  if jsonb_typeof(coalesce(p_c -> 'review_notes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_c -> 'review_notes', '[]'::jsonb)) > 5 then return 'review_notes'; end if;
  if (p_c ->> 'category') is not null and (p_c ->> 'category') not in ('grants_funding', 'business_financing', 'training', 'advisory', 'entrepreneurship', 'digital', 'other') then return 'category'; end if;
  if (p_c ->> 'beneficiary_type') is not null and (p_c ->> 'beneficiary_type') not in ('entrepreneur', 'organisation', 'both') then return 'beneficiary_type'; end if;
  foreach k in array array['sectors', 'states', 'documents'] loop
    if p_c ? k and jsonb_typeof(p_c -> k) <> 'null' then
      if jsonb_typeof(p_c -> k) <> 'array' or jsonb_array_length(p_c -> k) > 40
         or exists (select 1 from jsonb_array_elements(p_c -> k) e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 200) then
        return k;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

-- Editorial fields (category, who it is for, sectors, states) are not on the source pages. A monitored re-extraction keeps what an
-- editor approved earlier instead of proposing to delete it.
create or replace function public.gov_submit_candidate(p_source uuid, p_result uuid, p_external_key text, p_candidate jsonb)
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
  select * into prog from public.gov_programmes where source_id = p_source and external_key = p_external_key for update;
  if prog.id is not null and prog.current_version_id is not null then
    select * into base from public.gov_programme_versions where id = prog.current_version_id;
  end if;
  v_canon := private.gov_canonical(p_candidate);
  if base.id is not null then
    foreach k in array array['category', 'beneficiary_type', 'sectors', 'states'] loop
      if not (v_canon ? k) and base.data ? k then v_canon := v_canon || jsonb_build_object(k, base.data -> k); end if;
    end loop;
  end if;
  v_sha := encode(extensions.digest(convert_to(v_canon::text, 'utf8'), 'sha256'), 'hex');
  if base.id is not null then
    if base.data_sha256 = v_sha then
      update public.gov_programmes set last_checked_at = now(), missing_count = 0,
        verification_status = case when verification_status = 'unconfirmed' and publication_state in ('published', 'paused') then 'verified' else verification_status end
      where id = prog.id;
      update public.gov_change_proposals set status = 'superseded' where source_id = p_source and external_key = p_external_key and status = 'pending' and proposed_by is null;
      return 'unchanged';
    end if;
    foreach k in array array['name', 'description', 'funding_type', 'amount_min', 'amount_max', 'currency', 'application_channel',
      'application_url', 'info_url', 'opens_on', 'closes_on', 'application_status', 'documents', 'terms', 'rules',
      'category', 'beneficiary_type', 'sectors', 'states'] loop
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
    v_host := private.gov_url_host(v_canon ->> 'application_url');
    if v_host is null or not (v_host = any (s.allowed_hosts)) then v_flags := v_flags || 'url_host_not_allowed'::text; end if;
    if base.id is null or base.data ->> 'application_url' is distinct from v_canon ->> 'application_url' then v_flags := v_flags || 'new_application_url'::text; end if;
  end if;
  v_host := private.gov_url_host(v_canon ->> 'info_url');
  if v_host is null or not (v_host = any (s.allowed_hosts)) then v_flags := v_flags || 'url_host_not_allowed'::text; end if;
  if (v_canon ->> 'extraction_status') is distinct from 'complete' then v_flags := v_flags || 'incomplete_extraction'::text; end if;
  if v_diff ? 'rules' then v_flags := v_flags || 'eligibility_changed'::text; end if;
  if v_diff ?| array['amount_min', 'amount_max'] then v_flags := v_flags || 'amount_changed'::text; end if;
  if v_diff ?| array['opens_on', 'closes_on'] then v_flags := v_flags || 'dates_changed'::text; end if;
  if v_diff ? 'documents' then v_flags := v_flags || 'documents_changed'::text; end if;
  update public.gov_change_proposals set status = 'superseded'
   where source_id = p_source and external_key = p_external_key and status = 'pending' and candidate_sha256 <> v_sha and proposed_by is null;
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

------------------------------------------------------------------------------------------------
-- 4. Manual (administrator-maintained) programme entry and changes. One editor proposes, a different publisher approves.
------------------------------------------------------------------------------------------------
alter table public.gov_change_proposals add column proposed_by uuid;

create function public.gov_propose_manual(p_source uuid, p_programme uuid, p_candidate jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare
  v_user uuid := auth.uid(); s public.gov_sources; prog public.gov_programmes; base public.gov_programme_versions;
  v_canon jsonb; v_sha text; v_problem text; v_diff jsonb := '{}'::jsonb; k text; v_flags text[] := array['manual']; v_host text;
  v_key text; v_kind text; v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:review') then perform private.raise_error('forbidden'); end if;
  if char_length(v_reason) not between 5 and 1000 then perform private.raise_error('invalid', 'reason'); end if;
  select * into s from public.gov_sources where id = p_source;
  if s.id is null then perform private.raise_error('not_found'); end if;
  v_problem := private.gov_candidate_problem(p_candidate);
  if v_problem is not null then perform private.raise_error('invalid', v_problem); end if;
  v_canon := private.gov_canonical(p_candidate);
  v_sha := encode(extensions.digest(convert_to(v_canon::text, 'utf8'), 'sha256'), 'hex');
  if p_programme is not null then
    select * into prog from public.gov_programmes where id = p_programme and source_id = p_source for update;
    if prog.id is null then perform private.raise_error('not_found'); end if;
    if prog.publication_state = 'archived' then perform private.raise_error('conflict', 'archived'); end if;
    if prog.current_version_id is not null then select * into base from public.gov_programme_versions where id = prog.current_version_id; end if;
    v_key := prog.external_key;
  else
    v_key := 'manual-' || left(regexp_replace(lower(v_canon ->> 'name'), '[^a-z0-9]+', '-', 'g'), 80) || '-' || substr(md5(p_source::text || (v_canon ->> 'name')), 1, 6);
    select * into prog from public.gov_programmes where source_id = p_source and external_key = v_key;
    if prog.id is not null then perform private.raise_error('conflict', 'programme_exists'); end if;
  end if;
  if base.id is not null then
    if base.data_sha256 = v_sha then perform private.raise_error('conflict', 'no_change'); end if;
    foreach k in array array['name', 'description', 'funding_type', 'amount_min', 'amount_max', 'currency', 'application_channel',
      'application_url', 'info_url', 'opens_on', 'closes_on', 'application_status', 'documents', 'terms', 'rules',
      'category', 'beneficiary_type', 'sectors', 'states'] loop
      if base.data -> k is distinct from v_canon -> k then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', base.data -> k, 'new', v_canon -> k));
      end if;
    end loop;
    v_kind := 'change';
  else
    v_kind := 'new';
  end if;
  if (v_canon ->> 'application_url') is not null then
    v_host := private.gov_url_host(v_canon ->> 'application_url');
    if v_host is null or not (v_host = any (s.allowed_hosts)) then v_flags := v_flags || 'url_host_not_allowed'::text; end if;
    if base.id is null or base.data ->> 'application_url' is distinct from v_canon ->> 'application_url' then v_flags := v_flags || 'new_application_url'::text; end if;
  end if;
  v_host := private.gov_url_host(v_canon ->> 'info_url');
  if v_host is null or not (v_host = any (s.allowed_hosts)) then v_flags := v_flags || 'url_host_not_allowed'::text; end if;
  if v_diff ? 'rules' then v_flags := v_flags || 'eligibility_changed'::text; end if;
  if v_diff ?| array['amount_min', 'amount_max'] then v_flags := v_flags || 'amount_changed'::text; end if;
  if v_diff ?| array['opens_on', 'closes_on'] then v_flags := v_flags || 'dates_changed'::text; end if;
  if v_diff ? 'documents' then v_flags := v_flags || 'documents_changed'::text; end if;
  begin
    insert into public.gov_change_proposals (source_id, programme_id, base_version_id, external_key, kind, candidate, candidate_sha256, diff, flags, proposed_by)
    values (p_source, prog.id, base.id, v_key, v_kind, v_canon, v_sha, v_diff, v_flags, v_user) returning id into v_id;
  exception when unique_violation then
    perform private.raise_error('conflict', 'duplicate');
  end;
  perform private.gov_event('proposal.manual_proposed', p_source, prog.id, v_id, jsonb_build_object('kind', v_kind, 'reason', left(v_reason, 500)));
  perform private.write_audit('gov.programme.proposed', null, 'gov_change_proposal', v_id::text, jsonb_build_object('kind', v_kind));
  return v_id;
end;
$$;

-- Replaces the 000200 version: adds the two-person rule for manual proposals, the manual detection method and the new fields.
create or replace function public.gov_decide_proposal(p_proposal uuid, p_decision text, p_reason text, p_expected_status text default 'pending')
returns uuid
language plpgsql security definer set search_path = '' as
$$
declare
  v_user uuid := auth.uid(); p public.gov_change_proposals; prog public.gov_programmes; s public.gov_sources;
  v_reason text := btrim(coalesce(p_reason, '')); v_ver integer; v_vid uuid; c jsonb;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_decision not in ('approve', 'reject', 'needs_info') then perform private.raise_error('invalid', 'decision'); end if;
  if p_expected_status not in ('pending', 'needs_info') then perform private.raise_error('invalid', 'decision'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 then perform private.raise_error('invalid', 'reason'); end if;
  if p_decision = 'approve' then
    if not private.has_platform_permission('gov:publish') then perform private.raise_error('forbidden'); end if;
    if not private.gov_setting('publishing_enabled') then perform private.raise_error('conflict', 'publishing_disabled'); end if;
  elsif not private.has_platform_permission('gov:review') then
    perform private.raise_error('forbidden');
  end if;
  select * into p from public.gov_change_proposals where id = p_proposal for update;
  if p.id is null then perform private.raise_error('not_found'); end if;
  if p.status <> p_expected_status then perform private.raise_error('conflict', 'already_decided'); end if;
  -- Second-editor rule: whoever proposed a manual change cannot approve it.
  if p_decision = 'approve' and p.proposed_by is not null and p.proposed_by = v_user then perform private.raise_error('forbidden', 'second_person_required'); end if;
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
    if prog.current_version_id is distinct from p.base_version_id then perform private.raise_error('conflict', 'stale_proposal'); end if;
  end if;
  v_ver := coalesce((select max(version_no) from public.gov_programme_versions where programme_id = prog.id), 0) + 1;
  insert into public.gov_programme_versions (programme_id, version_no, data, data_sha256, result_id, proposal_id, approved_by,
    approval_reason, detection_method)
  values (prog.id, v_ver, c, p.candidate_sha256, p.result_id, p.id, v_user, v_reason, case when p.proposed_by is not null then 'manual' else 'monitor' end)
  returning id into v_vid;
  update public.gov_programmes set current_version_id = v_vid, publication_state = case when publication_state = 'paused' then 'paused' else 'published' end,
    verification_status = 'verified', name = c ->> 'name', funding_type = c ->> 'funding_type',
    amount_min = (c ->> 'amount_min')::numeric, amount_max = (c ->> 'amount_max')::numeric, currency = c ->> 'currency',
    opens_on = (c ->> 'opens_on')::date, closes_on = (c ->> 'closes_on')::date,
    application_status = coalesce(c ->> 'application_status', 'unknown'),
    category = coalesce(c ->> 'category', case c ->> 'funding_type' when 'grant' then 'grants_funding' when 'subsidy' then 'grants_funding'
      when 'financing' then 'business_financing' when 'training' then 'training' when 'other' then 'other' end),
    beneficiary_type = c ->> 'beneficiary_type',
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

------------------------------------------------------------------------------------------------
-- 5. Public read model with the new fields (return type changes, so drop and recreate)
------------------------------------------------------------------------------------------------
drop function public.gov_list_programmes(text, text, integer, integer);
create function public.gov_list_programmes(p_funding_type text default null, p_query text default null, p_limit integer default 30,
  p_offset integer default 0, p_category text default null)
returns table (
  id uuid, slug text, name text, agency_name text, funding_type text, amount_min numeric, amount_max numeric, currency text,
  application_status text, opens_on date, closes_on date, last_checked_at timestamptz, last_verified_at timestamptz,
  info_url text, application_url text, application_channel text, summary text, is_stale boolean,
  rules jsonb, verification_status text, category text, beneficiary_type text, sectors jsonb, states jsonb
)
language sql stable security definer set search_path = '' as
$$
  select p.id, p.slug, p.name, a.name, p.funding_type, p.amount_min, p.amount_max, p.currency,
    case when p.application_status in ('open', 'upcoming') and (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => s.freshness_hours))
         then 'unknown' else p.application_status end,
    p.opens_on, p.closes_on, p.last_checked_at, p.last_verified_at,
    v.data ->> 'info_url', v.data ->> 'application_url', v.data ->> 'application_channel', left(v.data ->> 'description', 600),
    (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => s.freshness_hours)),
    coalesce(v.data -> 'rules', '[]'::jsonb), p.verification_status, p.category, p.beneficiary_type,
    coalesce(v.data -> 'sectors', '[]'::jsonb), coalesce(v.data -> 'states', '[]'::jsonb)
  from public.gov_programmes p
  join public.gov_programme_versions v on v.id = p.current_version_id
  join public.gov_sources s on s.id = p.source_id
  join public.gov_agencies a on a.id = p.agency_id
  where p.publication_state = 'published'
    and (p_funding_type is null or p.funding_type = p_funding_type)
    and (p_category is null or p.category = p_category)
    and (p_query is null or p.name ilike '%' || replace(replace(left(p_query, 80), '%', ''), '_', '') || '%')
  order by p.name
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)
$$;

------------------------------------------------------------------------------------------------
-- 5b. Saved list also reports the verification status (so a saved card never assumes 'verified')
------------------------------------------------------------------------------------------------
drop function public.gov_list_saved(uuid);
create function public.gov_list_saved(p_org uuid)
returns table (programme_id uuid, slug text, name text, agency_name text, funding_type text, application_status text, closes_on date,
  last_checked_at timestamptz, last_verified_at timestamptz, publication_state text, tracking_status text, note text, applied_on date,
  outcome text, reminder_on date, version integer, rules_changed boolean, is_stale boolean, verification_status text)
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
    (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours)), p.verification_status
  from public.gov_saved s
  join public.gov_programmes p on p.id = s.programme_id
  join public.gov_agencies a on a.id = p.agency_id
  join public.gov_sources so on so.id = p.source_id
  left join public.gov_programme_versions v on v.id = p.current_version_id
  where s.org_id = p_org
  order by s.created_at desc;
end;
$$;
revoke all on function public.gov_list_saved(uuid) from public, anon, authenticated;
grant execute on function public.gov_list_saved(uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- 6. Conditional requests and page monitoring
------------------------------------------------------------------------------------------------
alter table public.gov_fetch_results add column etag text check (char_length(etag) <= 200), add column last_modified text check (char_length(last_modified) <= 100);

create or replace function public.gov_complete_job(p_job uuid, p_worker text, p_result jsonb) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare j public.gov_fetch_jobs; v_res uuid;
begin
  select * into j from public.gov_fetch_jobs where id = p_job for update;
  if j.id is null then perform private.raise_error('not_found'); end if;
  if j.status <> 'running' or j.locked_by is distinct from left(p_worker, 80) then perform private.raise_error('conflict', 'not_lease_holder'); end if;
  insert into public.gov_fetch_results (job_id, source_id, url, http_status, content_type, content_sha256, byte_length,
    parser_version, outcome, evidence_excerpt, etag, last_modified)
  values (j.id, j.source_id, j.target_url, (p_result ->> 'http_status')::int, left(p_result ->> 'content_type', 120),
    p_result ->> 'content_sha256', (p_result ->> 'byte_length')::int, left(p_result ->> 'parser_version', 20),
    p_result ->> 'outcome', left(p_result ->> 'evidence_excerpt', 20000), left(p_result ->> 'etag', 200), left(p_result ->> 'last_modified', 100))
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

-- The validators of the last good answer for one URL (used for If-None-Match / If-Modified-Since).
create function public.gov_last_validators(p_source uuid, p_url text) returns table (etag text, last_modified text)
language sql stable security definer set search_path = '' as
$$ select r.etag, r.last_modified from public.gov_fetch_results r
   where r.source_id = p_source and r.url = p_url and r.outcome in ('ok', 'unchanged') and (r.etag is not null or r.last_modified is not null)
   order by r.fetched_at desc limit 1 $$;

-- A page monitor sees changes on pages it cannot turn into a programme record. Each change waits here for a person; nothing is published.
create table public.gov_page_changes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.gov_sources (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  old_result_id uuid references public.gov_fetch_results (id) on delete set null,
  new_result_id uuid references public.gov_fetch_results (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null))
);
create unique index gov_page_changes_open on public.gov_page_changes (new_result_id) where new_result_id is not null;
create index gov_page_changes_status on public.gov_page_changes (status, created_at desc);
alter table public.gov_page_changes enable row level security;
create policy gov_staff_select on public.gov_page_changes for select to authenticated using (private.has_platform_permission('gov:view'));
grant select on public.gov_page_changes to authenticated;

-- Called by the worker after a page-monitor result is stored. Compares with the previous good result for the same URL.
-- Returns 'baseline' (first look), 'unchanged', or 'changed' (a pending review item was created).
create function public.gov_record_page(p_result uuid) returns text
language plpgsql security definer set search_path = '' as
$$
declare r public.gov_fetch_results; prev public.gov_fetch_results; v_id uuid;
begin
  select * into r from public.gov_fetch_results where id = p_result;
  if r.id is null or r.outcome <> 'ok' or r.content_sha256 is null then perform private.raise_error('invalid', 'result'); end if;
  select * into prev from public.gov_fetch_results where source_id = r.source_id and url = r.url and outcome = 'ok'
    and content_sha256 is not null and id <> r.id and fetched_at < r.fetched_at order by fetched_at desc limit 1;
  if prev.id is null then return 'baseline'; end if;
  if prev.content_sha256 = r.content_sha256 then return 'unchanged'; end if;
  insert into public.gov_page_changes (source_id, url, old_result_id, new_result_id) values (r.source_id, r.url, prev.id, r.id)
  on conflict do nothing returning id into v_id;
  if v_id is not null then perform private.gov_event('source.page_changed', r.source_id, null, null, jsonb_build_object('change', v_id, 'url', r.url)); end if;
  return 'changed';
end;
$$;

create function public.gov_review_page_change(p_change uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as
$$
declare c public.gov_page_changes; v_note text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:review') then perform private.raise_error('forbidden'); end if;
  if p_status not in ('reviewed', 'dismissed') then perform private.raise_error('invalid', 'status'); end if;
  if char_length(v_note) not between 5 and 1000 then perform private.raise_error('invalid', 'reason'); end if;
  select * into c from public.gov_page_changes where id = p_change for update;
  if c.id is null then perform private.raise_error('not_found'); end if;
  if c.status <> 'pending' then perform private.raise_error('conflict', 'already_decided'); end if;
  update public.gov_page_changes set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), note = v_note where id = c.id;
  perform private.gov_event('source.page_change_' || p_status, c.source_id, null, null, jsonb_build_object('change', c.id));
end;
$$;

-- A page that returned 304 (not modified) is still a successful check: refresh the freshness of programmes whose information page it is.
create function public.gov_mark_unchanged(p_source uuid, p_url text) returns integer
language plpgsql security definer set search_path = '' as
$$
declare n integer;
begin
  update public.gov_programmes p set last_checked_at = now(), missing_count = 0,
    verification_status = case when p.verification_status = 'unconfirmed' and p.publication_state in ('published', 'paused') then 'verified' else p.verification_status end
  from public.gov_programme_versions v
  where v.id = p.current_version_id and p.source_id = p_source and v.data ->> 'info_url' = p_url;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Ask for a check now (source administrators). One request per source per 10 minutes; the worker still honours rate limits and robots.
create function public.gov_request_recheck(p_source uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as
$$
declare s public.gov_sources; u text; n integer := 0; v_rows integer; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('gov:source_admin') then perform private.raise_error('forbidden'); end if;
  if char_length(v_reason) not between 5 and 1000 then perform private.raise_error('invalid', 'reason'); end if;
  select * into s from public.gov_sources where id = p_source for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if not s.enabled then perform private.raise_error('conflict', 'not_enabled'); end if;
  foreach u in array s.approved_urls loop
    insert into public.gov_fetch_jobs (source_id, target_url, idempotency_key)
    values (s.id, u, s.id::text || ':' || md5(u) || ':recheck:' || floor(extract(epoch from now()) / 600)::bigint) on conflict (idempotency_key) do nothing;
    get diagnostics v_rows = row_count;
    n := n + v_rows;
  end loop;
  perform private.gov_event('source.recheck_requested', s.id, null, null, jsonb_build_object('reason', left(v_reason, 500), 'queued', n));
  return n;
end;
$$;

------------------------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------------------------
revoke all on function
  private.gov_valid_days(integer[]),
  public.gov_propose_manual(uuid, uuid, jsonb, text), public.gov_list_programmes(text, text, integer, integer, text),
  public.gov_last_validators(uuid, text), public.gov_record_page(uuid), public.gov_review_page_change(uuid, text, text),
  public.gov_mark_unchanged(uuid, text), public.gov_request_recheck(uuid, text)
from public, anon, authenticated;
grant execute on function public.gov_propose_manual(uuid, uuid, jsonb, text), public.gov_review_page_change(uuid, text, text), public.gov_request_recheck(uuid, text) to authenticated;
grant execute on function public.gov_list_programmes(text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.gov_last_validators(uuid, text), public.gov_record_page(uuid), public.gov_mark_unchanged(uuid, text) to service_role;
-- Re-assert grants of the functions replaced above (create or replace keeps them, restated for clarity).
revoke all on function public.gov_submit_candidate(uuid, uuid, text, jsonb), public.gov_complete_job(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.gov_submit_candidate(uuid, uuid, text, jsonb), public.gov_complete_job(uuid, text, jsonb) to service_role;
