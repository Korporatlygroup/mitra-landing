-- Privacy controls the application did not have: (1) an optional, withdrawable marketing consent recorded separately from the
-- required terms and privacy consents; (2) a data-request workflow (access, correction, deletion, portability, consent withdrawal,
-- complaint) so a person can ask and staff can answer within a tracked time limit.
-- No data is moved or deleted by this migration. Deletion requests are only RECORDED here; the erasure itself stays a reviewed,
-- manual staff action (see docs/privacy-requests-procedure.md) because records that law or a pending dispute requires must be kept.

-- 1. Marketing consent at sign-up: the trigger records it only when the form sent it (never pre-ticked, never required).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose text;
begin
  insert into public.profiles (id, display_name, language)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
    case when new.raw_user_meta_data ->> 'language' in ('ta', 'ms') then new.raw_user_meta_data ->> 'language' else 'en' end
  )
  on conflict (id) do nothing;

  foreach v_purpose in array array['terms', 'privacy', 'marketing'] loop
    if new.raw_user_meta_data -> 'consents' ->> v_purpose = private.current_consent_version() then
      insert into public.consents (user_id, purpose, version) values (new.id, v_purpose, private.current_consent_version());
    end if;
  end loop;

  perform private.write_audit_as(new.id, 'auth.signup', null, 'user', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

-- Turn the optional marketing consent on or off after sign-up. Off withdraws every active marketing consent (the audit trigger
-- on public.consents records the withdrawal). Required consents are untouched: refusing marketing never blocks any feature.
create function public.set_marketing_consent(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_on is null then perform private.raise_error('invalid', 'invalid_consent'); end if;
  perform private.check_rate_limit('marketing:' || v_user, 20, interval '1 hour');
  if p_on then
    if not exists (select 1 from public.consents c where c.user_id = v_user and c.purpose = 'marketing' and c.withdrawn_at is null) then
      insert into public.consents (user_id, purpose, version) values (v_user, 'marketing', private.current_consent_version());
    end if;
  else
    update public.consents set withdrawn_at = now() where user_id = v_user and purpose = 'marketing' and withdrawn_at is null;
  end if;
  return p_on;
end;
$$;

-- 2. Data requests.
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  request_type text not null check (request_type in ('access', 'correction', 'deletion', 'portability', 'consent_withdrawal', 'complaint', 'other')),
  details text not null check (char_length(details) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'rejected')),
  due_at timestamptz not null default (now() + interval '21 days'),
  handled_by uuid references auth.users (id) on delete set null,
  response_note text check (response_note is null or char_length(response_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index privacy_requests_user on public.privacy_requests (user_id);
create index privacy_requests_open on public.privacy_requests (status, due_at) where status in ('open', 'in_progress');
alter table public.privacy_requests enable row level security;
create policy privacy_requests_select_own on public.privacy_requests for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.privacy_requests to authenticated;

insert into public.role_permissions (role, permission) values ('admin_super', 'privacy:handle');

create function public.submit_privacy_request(p_type text, p_details text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_details text := private.clean_text(p_details, 1, 2000, 'invalid_details');
  v_id uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_type is null or p_type not in ('access', 'correction', 'deletion', 'portability', 'consent_withdrawal', 'complaint', 'other') then
    perform private.raise_error('invalid', 'invalid_request_type');
  end if;
  if v_details is null then perform private.raise_error('invalid', 'invalid_details'); end if;
  perform private.check_rate_limit('privacy_request:' || v_user, 5, interval '1 day');
  insert into public.privacy_requests (user_id, request_type, details) values (v_user, p_type, v_details) returning id into v_id;
  perform private.write_audit('privacy.request.submitted', null, 'privacy_request', v_id::text, jsonb_build_object('type', p_type));
  return v_id;
end;
$$;

create function public.list_my_privacy_requests()
returns table (id uuid, request_type text, status text, due_at timestamptz, response_note text, created_at timestamptz, updated_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select r.id, r.request_type, r.status, r.due_at, r.response_note, r.created_at, r.updated_at
  from public.privacy_requests r
  where r.user_id = auth.uid()
  order by r.created_at desc
  limit 50
$$;

create function public.admin_list_privacy_requests(p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('privacy:handle') then perform private.raise_error('forbidden'); end if;
  if p_status is not null and p_status not in ('open', 'in_progress', 'completed', 'rejected', 'all') then perform private.raise_error('invalid', 'invalid_status'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_type', r.request_type, 'status', r.status, 'details', r.details, 'due_at', r.due_at,
      'overdue', r.status in ('open', 'in_progress') and r.due_at < now(),
      'requester_email', u.email, 'response_note', r.response_note, 'created_at', r.created_at) order by r.due_at)
    from (select * from public.privacy_requests
          where p_status is null or p_status = 'all' or status = p_status
          order by due_at limit 200) r
    left join auth.users u on u.id = r.user_id), '[]'::jsonb);
end;
$$;

create function public.admin_update_privacy_request(p_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := private.clean_text(p_note, 0, 2000, 'invalid_note');
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('privacy:handle') then perform private.raise_error('forbidden'); end if;
  if p_status not in ('in_progress', 'completed', 'rejected') then perform private.raise_error('invalid', 'invalid_status'); end if;
  if p_status in ('completed', 'rejected') and coalesce(v_note, '') = '' then perform private.raise_error('invalid', 'note_required'); end if;
  update public.privacy_requests
     set status = p_status, response_note = coalesce(nullif(v_note, ''), response_note), handled_by = auth.uid(), updated_at = now()
   where id = p_id and status in ('open', 'in_progress');
  if not found then perform private.raise_error('not_found'); end if;
  perform private.write_audit('privacy.request.' || p_status, null, 'privacy_request', p_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.set_marketing_consent(boolean), public.submit_privacy_request(text, text), public.list_my_privacy_requests(),
  public.admin_list_privacy_requests(text), public.admin_update_privacy_request(uuid, text, text) from public, anon;
grant execute on function public.set_marketing_consent(boolean), public.submit_privacy_request(text, text), public.list_my_privacy_requests(),
  public.admin_list_privacy_requests(text), public.admin_update_privacy_request(uuid, text, text) to authenticated;
