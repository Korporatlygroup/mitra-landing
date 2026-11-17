-- Saving a programme is a bookmark: it must not need a business. Until now saves belonged to an organisation (gov_saved, with the owner's own
-- application tracking), so a person without a business profile was asked to create one just to bookmark a financing programme.
-- This adds an account-level list. Organisation tracking (gov_saved) is untouched; the application also keeps it in step for people who have one.
-- Only published programmes can be saved; a person sees and changes only their own list.

create table public.gov_saved_user (
  user_id uuid not null references auth.users (id) on delete cascade,
  programme_id uuid not null references public.gov_programmes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, programme_id)
);
alter table public.gov_saved_user enable row level security;
create policy gov_saved_user_select_own on public.gov_saved_user for select to authenticated using (user_id = (select auth.uid()));
grant select on public.gov_saved_user to authenticated;
-- No insert/update/delete policy or grant: every write goes through the functions below.

create function public.gov_save_programme_me(p_programme uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('govsave:' || v_user, 120, interval '1 hour');
  if not exists (select 1 from public.gov_programmes p where p.id = p_programme and p.publication_state = 'published') then
    perform private.raise_error('not_found');
  end if;
  if (select count(*) from public.gov_saved_user s where s.user_id = v_user) >= 200 then perform private.raise_error('invalid', 'invalid_data'); end if;
  insert into public.gov_saved_user (user_id, programme_id) values (v_user, p_programme) on conflict do nothing;
end;
$$;

create function public.gov_unsave_programme_me(p_programme uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  delete from public.gov_saved_user where user_id = auth.uid() and programme_id = p_programme;
end;
$$;

-- The same honest status rule as the public list: an open or upcoming status is shown only while it was recently checked.
create function public.gov_list_saved_me()
returns table (programme_id uuid, slug text, name text, agency_name text, funding_type text, application_status text, closes_on date,
  last_checked_at timestamptz, last_verified_at timestamptz, is_stale boolean, saved_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  return query
  select p.id, p.slug, p.name, a.name, p.funding_type,
    case when p.application_status in ('open', 'upcoming') and (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours)) then 'unknown'
         else p.application_status end,
    p.closes_on, p.last_checked_at, p.last_verified_at,
    (p.last_checked_at is null or p.last_checked_at < now() - make_interval(hours => so.freshness_hours)),
    s.created_at
  from public.gov_saved_user s
  join public.gov_programmes p on p.id = s.programme_id and p.publication_state = 'published'
  join public.gov_agencies a on a.id = p.agency_id
  join public.gov_sources so on so.id = p.source_id
  where s.user_id = auth.uid()
  order by s.created_at desc;
end;
$$;

revoke all on function public.gov_save_programme_me(uuid), public.gov_unsave_programme_me(uuid), public.gov_list_saved_me() from public, anon, service_role;
grant execute on function public.gov_save_programme_me(uuid), public.gov_unsave_programme_me(uuid), public.gov_list_saved_me() to authenticated;
revoke all on public.gov_saved_user from public, anon;
grant select on public.gov_saved_user to authenticated;
