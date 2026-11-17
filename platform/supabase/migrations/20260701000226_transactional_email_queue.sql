-- Transactional email for in-app notifications (enquiries, quotations, requests, sourcing, listing/verification/partner decisions).
-- Design: every in-app notification row is already created only for people who hold the right permission in the right organisation
-- (private.notify_org / private.notify_platform). This migration adds one queue row per notification (the primary key makes the
-- enqueue idempotent), a per-person opt-out, and service-role-only claim/mark functions for the delivery job.
-- No notification text is stored here and the email carries no business details: it says what kind of thing happened and links to the app,
-- where the usual sign-in and authorisation apply. Government-programme notifications (kind 'gov.*') keep their own outbox and preferences.
-- Authentication emails stay with Supabase Auth and are untouched.

-- 1. Preference (default on: these are service messages about things the person is party to; a person can switch them off).
create table public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  transactional boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.email_preferences enable row level security;
create policy email_preferences_select_own on public.email_preferences for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.email_preferences to authenticated;

create function public.set_email_notifications(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_on is null then perform private.raise_error('invalid', 'invalid_preference'); end if;
  perform private.check_rate_limit('emailpref:' || v_user, 30, interval '1 hour');
  insert into public.email_preferences (user_id, transactional) values (v_user, p_on)
  on conflict (user_id) do update set transactional = excluded.transactional, updated_at = now();
  return p_on;
end;
$$;
revoke all on function public.set_email_notifications(boolean) from public, anon;
grant execute on function public.set_email_notifications(boolean) to authenticated;

-- 2. Queue. One row per notification; nothing but state, attempt counters and a short error code.
create table private.notification_email_queue (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 300),
  provider_id text check (char_length(provider_id) <= 100),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table private.notification_email_queue enable row level security;
create index notification_email_queue_due on private.notification_email_queue (next_attempt_at) where status in ('pending', 'sending');

create function private.enqueue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind like 'gov.%' then return new; end if;
  insert into private.notification_email_queue (notification_id, status, last_error)
  select new.id,
         case when exists (select 1 from public.email_preferences p where p.user_id = new.user_id and not p.transactional) then 'skipped' else 'pending' end,
         case when exists (select 1 from public.email_preferences p where p.user_id = new.user_id and not p.transactional) then 'opted_out' end
  on conflict (notification_id) do nothing;
  return new;
end;
$$;
create trigger notifications_enqueue_email after insert on public.notifications
  for each row execute function private.enqueue_notification_email();

-- 3. Claim a bounded batch. Skips (never sends): opted out since queueing, no confirmed address, older than 2 days (after an outage
-- nobody gets a flood of stale mail), out of attempts. A person receives at most 10 of these per hour; the rest wait.
create function public.claim_notification_emails(p_limit integer default 25)
returns table (queue_id uuid, kind text, entity_type text, entity_id text, org_id uuid, email text, language text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.notification_email_queue q set status = 'skipped', last_error = 'opted_out'
   where q.status in ('pending', 'sending')
     and exists (select 1 from public.notifications n join public.email_preferences p on p.user_id = n.user_id
                  where n.id = q.notification_id and not p.transactional);
  update private.notification_email_queue q set status = 'skipped', last_error = 'no_confirmed_address'
   where q.status in ('pending', 'sending')
     and not exists (select 1 from public.notifications n join auth.users u on u.id = n.user_id
                      where n.id = q.notification_id and u.email is not null and u.email_confirmed_at is not null);
  -- Reserved and test domains (RFC 2606/6761) are never mailed: synthetic accounts must not cause bounces that hurt the sending reputation.
  update private.notification_email_queue q set status = 'skipped', last_error = 'reserved_domain'
   where q.status in ('pending', 'sending')
     and exists (select 1 from public.notifications n join auth.users u on u.id = n.user_id
                  where n.id = q.notification_id and u.email ~* '(\.(test|example|invalid|localhost)|@example\.(com|org|net))$');
  update private.notification_email_queue q set status = 'skipped', last_error = 'stale'
   where q.status in ('pending', 'sending') and q.created_at < now() - interval '2 days';
  update private.notification_email_queue q set status = 'failed', last_error = coalesce(q.last_error, 'timeout')
   where q.status = 'sending' and q.locked_until < now() and q.attempts >= 5;

  return query
  with due as (
    select q.notification_id
      from private.notification_email_queue q
      join public.notifications n on n.id = q.notification_id
     where ((q.status = 'pending' and q.next_attempt_at <= now()) or (q.status = 'sending' and q.locked_until < now()))
       and q.attempts < 5
       and (select count(*) from private.notification_email_queue q2 join public.notifications n2 on n2.id = q2.notification_id
             where n2.user_id = n.user_id and q2.status = 'sent' and q2.sent_at > now() - interval '1 hour') < 10
     order by q.created_at
     limit least(greatest(coalesce(p_limit, 25), 1), 50)
       for update of q skip locked
  ), upd as (
    update private.notification_email_queue q
       set status = 'sending', attempts = q.attempts + 1, locked_until = now() + interval '5 minutes'
      from due where q.notification_id = due.notification_id
    returning q.notification_id, q.attempts
  )
  select upd.notification_id, n.kind, n.entity_type, n.entity_id, n.org_id, u.email::text,
         coalesce(pr.language, 'en')::text, upd.attempts
    from upd
    join public.notifications n on n.id = upd.notification_id
    join auth.users u on u.id = n.user_id
    left join public.profiles pr on pr.id = n.user_id;
end;
$$;

create function public.mark_notification_email(p_queue uuid, p_ok boolean, p_error text, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update private.notification_email_queue
       set status = 'sent', sent_at = now(), locked_until = null, last_error = null, provider_id = left(p_provider, 100)
     where notification_id = p_queue and status = 'sending';
  else
    -- Retry with a growing delay (2, 8, 18, 32 minutes); after the fifth attempt the row stays 'failed' for an operator to see.
    update private.notification_email_queue
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           next_attempt_at = now() + (attempts * attempts * 2) * interval '1 minute',
           locked_until = null, last_error = left(coalesce(p_error, 'send_failed'), 300)
     where notification_id = p_queue and status = 'sending';
  end if;
end;
$$;

revoke all on function public.claim_notification_emails(integer), public.mark_notification_email(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer), public.mark_notification_email(uuid, boolean, text, text) to service_role;
revoke all on function private.enqueue_notification_email() from public, anon, authenticated;
