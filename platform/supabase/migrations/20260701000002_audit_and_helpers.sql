-- Audit log protection, error helpers, rate limiting.
-- Error convention: PostgREST maps SQLSTATE 'PTnnn' to HTTP status nnn.

create function private.raise_error(p_kind text, p_message text default null)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_kind
    when 'unauthenticated' then raise exception '%', coalesce(p_message, 'unauthenticated') using errcode = 'PT401';
    when 'forbidden' then raise exception '%', coalesce(p_message, 'forbidden') using errcode = 'PT403';
    when 'not_found' then raise exception '%', coalesce(p_message, 'not_found') using errcode = 'PT404';
    when 'conflict' then raise exception '%', coalesce(p_message, 'conflict') using errcode = 'PT409';
    when 'invalid' then raise exception '%', coalesce(p_message, 'invalid') using errcode = 'PT422';
    when 'rate_limited' then raise exception '%', coalesce(p_message, 'rate_limited') using errcode = 'PT429';
    else raise exception '%', coalesce(p_message, 'error') using errcode = 'PT500';
  end case;
end;
$$;

-- The only way to create audit rows. Callable by other SECURITY DEFINER code only.
-- The actor is always derived from the verified JWT (auth.uid()), never from a parameter.
create function private.write_audit(
  p_action text, p_org uuid, p_entity_type text, p_entity_id text, p_details jsonb, p_source text default 'db'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_org uuid;
begin
  if v_actor is not null and p_org is not null then
    select m.org_id into v_actor_org
    from public.memberships m
    where m.org_id = p_org and m.user_id = v_actor and m.status = 'active';
  end if;
  insert into public.audit_log (actor_user_id, actor_org_id, org_id, action, entity_type, entity_id, details, source)
  values (v_actor, v_actor_org, p_org, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb),
          case when v_actor is null and p_source = 'db' then 'system' else p_source end);
end;
$$;

-- Immutability: block UPDATE / DELETE / TRUNCATE for every role (including the table owner).
create function private.audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_immutable();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Rate limiting backed by a table; raises 'rate_limited' (HTTP 429) when exceeded.
create function private.check_rate_limit(p_key text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.rate_limit_events where at < now() - interval '1 day' and key = p_key;
  select count(*) into v_count from public.rate_limit_events where key = p_key and at > now() - p_window;
  if v_count >= p_max then
    perform private.raise_error('rate_limited');
  end if;
  insert into public.rate_limit_events (key) values (p_key);
end;
$$;
