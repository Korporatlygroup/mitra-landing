-- Phase 3.1: public ("eligible sellers") request board, on top of the existing request, match and enquiry model.
-- Numbering: Phase 3 addenda use 20260701000100 and up. Phase 4 keeps 20260701000015 to 20260701000099 (see the contract, section 10).
-- Nothing here creates a second request or enquiry table: a board response creates the same request_seller_matches row and the same
-- enquiry as an invitation reply does.

alter table public.buyer_requests drop constraint buyer_requests_visibility_check;
alter table public.buyer_requests add constraint buyer_requests_visibility_check
  check (visibility in ('private_invite', 'eligible_sellers'));

------------------------------------------------------------------------------------------------
-- A request that is open to eligible sellers must not carry contact details in its public text.
------------------------------------------------------------------------------------------------
create function private.request_public_text_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.target_district, '');
begin
  if new.visibility = 'eligible_sellers' and new.status = 'open' and old.status = 'draft' then
    if v_txt ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' or v_txt ~ '(\d[ ().-]?){9,}' then
      perform private.raise_error('invalid', 'contact_in_public_text');
    end if;
  end if;
  return new;
end;
$$;
create trigger buyer_requests_public_text_guard before update on public.buyer_requests
  for each row execute function private.request_public_text_guard();

-- Once a request is open its visibility never changes (withdraw it and post a new one instead).
create function private.request_visibility_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' and new.visibility is distinct from old.visibility then
    raise exception 'immutable_columns' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
create trigger buyer_requests_visibility_frozen before update on public.buyer_requests
  for each row execute function private.request_visibility_frozen();

create function public.set_request_visibility(p_request uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.buyer_requests;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if p_visibility not in ('private_invite', 'eligible_sellers') then perform private.raise_error('invalid', 'invalid_data'); end if;
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null or not private.has_permission(r.buyer_org_id, 'request:post') then perform private.raise_error('not_found'); end if;
  if r.status <> 'draft' then perform private.raise_error('conflict', 'request_not_editable'); end if;
  update public.buyer_requests set visibility = p_visibility, updated_at = now() where id = p_request;
end;
$$;

------------------------------------------------------------------------------------------------
-- Server-side eligibility. The only place that decides whether a seller may see a board request.
------------------------------------------------------------------------------------------------
create function private.board_eligible(p_request uuid, p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.buyer_requests r
    join public.organisations bo on bo.id = r.buyer_org_id and bo.status = 'active'
    join public.organisations so on so.id = p_seller and so.status = 'active' and so.type = 'business'
    join public.business_listings l on l.org_id = p_seller and l.live_status = 'published' and l.accepting_requests
    join public.business_services s on s.org_id = p_seller and s.category_id = r.category_id
    where r.id = p_request and r.status = 'open' and r.visibility = 'eligible_sellers' and r.expires_at > now()
      and r.buyer_org_id <> p_seller
      and (s.nationwide or r.target_state = any (s.areas))
      and not (s.min_order_qty is not null and r.quantity is not null and r.unit is not null
               and lower(s.min_order_unit) = lower(r.unit) and r.quantity < s.min_order_qty)
  );
$$;

------------------------------------------------------------------------------------------------
-- Seller: the board list
------------------------------------------------------------------------------------------------
create function public.list_board_requests(p_seller_org uuid, p_category text default null, p_state text default null, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid;
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org, 'request:respond') then perform private.raise_error('forbidden'); end if;
  if nullif(p_category, '') is not null then
    select c.id into v_cat from public.business_categories c where c.slug = p_category and c.active;
    if v_cat is null then perform private.raise_error('invalid', 'invalid_category'); end if;
  end if;
  if nullif(p_state, '') is not null and not private.valid_state(p_state) then perform private.raise_error('invalid', 'invalid_state'); end if;
  perform private.sweep_requests();

  with elig as (
    select r.*, c.slug as cat_slug
    from public.buyer_requests r
    join public.business_categories c on c.id = r.category_id
    where r.status = 'open' and r.visibility = 'eligible_sellers'
      and (v_cat is null or r.category_id = v_cat)
      and (nullif(p_state, '') is null or r.target_state = p_state)
      and private.board_eligible(r.id, p_seller_org)
  )
  select (select count(*) from elig),
         coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc) from (
           select e.id as request_id, e.title, e.cat_slug as category_slug, e.target_state, e.target_district, e.quantity, e.unit,
                  e.needed_by, e.budget_min, e.budget_max, e.created_at, e.expires_at,
                  (select m.status from public.request_seller_matches m where m.request_id = e.id and m.seller_org_id = p_seller_org
                     and m.invited_at is not null) as my_status
           from elig e order by e.created_at desc limit 20 offset v_off) x), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

------------------------------------------------------------------------------------------------
-- Seller: open one request (invited, or from the board). Replaces the Phase 3 function; same output shape.
------------------------------------------------------------------------------------------------
create or replace function public.get_request_for_seller(p_request uuid, p_seller_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.buyer_requests;
  m public.request_seller_matches;
  p public.buyer_request_private;
  v_responded boolean;
  v_board boolean := false;
  v jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org, 'request:respond') then perform private.raise_error('forbidden'); end if;
  perform private.sweep_requests();
  select * into m from public.request_seller_matches where request_id = p_request and seller_org_id = p_seller_org;
  if m.id is null or m.status = 'candidate' or m.invited_at is null then
    -- Not invited: allowed only for an eligible seller looking at an open board request. Anything else is "not found".
    if not private.board_eligible(p_request, p_seller_org) then perform private.raise_error('not_found'); end if;
    v_board := true;
  end if;
  select * into r from public.buyer_requests where id = p_request;
  if v_board then
    v := jsonb_build_object('request_id', r.id, 'request_status', r.status, 'match_status', 'invited', 'invited_at', null,
      'responded_at', null, 'response_note', null, 'enquiry_id', null, 'expires_at', r.expires_at, 'from_board', true);
  else
    v := jsonb_build_object('request_id', r.id, 'request_status', r.status, 'match_status', m.status, 'invited_at', m.invited_at,
      'responded_at', m.responded_at, 'response_note', m.response_note, 'enquiry_id', m.enquiry_id, 'expires_at', r.expires_at,
      'from_board', r.visibility = 'eligible_sellers');
  end if;
  if r.status in ('withdrawn', 'removed') or (select o.status from public.organisations o where o.id = r.buyer_org_id) <> 'active' then return v; end if;
  if not v_board and m.status = 'invited' and m.viewed_at is null then
    update public.request_seller_matches set viewed_at = now(), updated_at = now() where id = m.id;
  end if;
  v_responded := not v_board and m.status in ('interested', 'question');
  v := v || jsonb_build_object('title', r.title, 'description', r.description, 'category_slug',
      (select c.slug from public.business_categories c where c.id = r.category_id),
      'target_state', r.target_state, 'target_district', r.target_district, 'quantity', r.quantity, 'unit', r.unit,
      'needed_by', r.needed_by, 'budget_min', r.budget_min, 'budget_max', r.budget_max, 'currency', r.currency,
      'caution_codes', case when v_board then '[]'::jsonb else to_jsonb(m.caution_codes) end,
      'reason_codes', case when v_board then '[]'::jsonb else to_jsonb(m.reason_codes) end);
  if v_responded and r.share_contact and r.status = 'open' then
    select * into p from public.buyer_request_private where request_id = p_request;
    v := v || jsonb_build_object('buyer_name', (select o.name from public.organisations o where o.id = r.buyer_org_id),
      'contact_phone', p.contact_phone, 'contact_email', p.contact_email);
  end if;
  return v;
end;
$$;

------------------------------------------------------------------------------------------------
-- Seller: reply. For a board request with no invitation yet, the reply itself creates the match row.
------------------------------------------------------------------------------------------------
create or replace function public.respond_to_invitation(p_request uuid, p_seller_org uuid, p_response text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  m public.request_seller_matches;
  v_note text := private.clean_text(p_note, 1, 500, 'invalid_note');
  v_enq uuid;
  v_status public.match_status;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org, 'request:respond') then perform private.raise_error('forbidden'); end if;
  if p_response not in ('interested', 'question', 'declined') then perform private.raise_error('invalid', 'invalid_response'); end if;
  if p_response = 'question' and (v_note is null or char_length(v_note) < 5) then perform private.raise_error('invalid', 'invalid_note'); end if;
  perform private.sweep_requests();
  -- Lock order everywhere: request, then match (a reply cannot interleave with the buyer closing the request).
  select * into r from public.buyer_requests where id = p_request for update;
  select * into m from public.request_seller_matches where request_id = p_request and seller_org_id = p_seller_org for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if m.id is null or m.status = 'candidate' or m.invited_at is null then
    if not private.board_eligible(p_request, p_seller_org) then perform private.raise_error('not_found'); end if;
    perform private.check_rate_limit('boardresp:' || v_user, 40, interval '1 day');
    if p_response <> 'declined' and (select count(*) from public.request_seller_matches x
         where x.request_id = p_request and x.invited_by is null and x.invited_at is not null and x.status <> 'declined') >= 20 then
      perform private.raise_error('conflict', 'request_response_limit');
    end if;
    insert into public.request_seller_matches (request_id, seller_org_id, status, invited_by, invited_at)
    values (p_request, p_seller_org, 'invited', null, now())
    on conflict (request_id, seller_org_id) do update
      set status = 'invited', invited_by = null, invited_at = now(), updated_at = now()
      where public.request_seller_matches.status = 'candidate';
    select * into m from public.request_seller_matches where request_id = p_request and seller_org_id = p_seller_org for update;
  end if;
  v_status := p_response::public.match_status;
  if m.status = v_status then return jsonb_build_object('status', m.status, 'enquiry_id', m.enquiry_id); end if; -- retry-safe
  if m.status in ('interested', 'question', 'declined') then perform private.raise_error('conflict', 'already_responded'); end if;
  if m.status <> 'invited' then perform private.raise_error('conflict', 'request_not_open'); end if;
  if r.status <> 'open' or (select o.status from public.organisations o where o.id = r.buyer_org_id) <> 'active' then
    perform private.raise_error('conflict', 'request_not_open');
  end if;
  perform private.check_rate_limit('reqrespond:' || v_user, 60, interval '1 hour');
  if p_response <> 'declined' and not exists (select 1 from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
                                              where l.org_id = p_seller_org and l.live_status = 'published') then
    perform private.raise_error('conflict', 'seller_not_available');
  end if;

  if p_response <> 'declined' then
    v_enq := (private.open_enquiry(r.buyer_org_id, p_seller_org, p_request, 'request_invitation', r.title, v_note, p_seller_org, v_user) ->> 'id')::uuid;
  end if;
  update public.request_seller_matches set status = v_status, responded_at = now(), response_note = v_note,
    enquiry_id = v_enq, updated_at = now() where id = m.id;
  perform private.write_audit('request.' || p_response, p_seller_org, 'buyer_request', p_request::text,
    jsonb_build_object('via', case when r.visibility = 'eligible_sellers' and m.invited_by is null then 'board' else 'invitation' end));
  perform private.notify_org(r.buyer_org_id, 'request:post', 'request.' || p_response, 'buyer_request', p_request::text);
  return jsonb_build_object('status', v_status, 'enquiry_id', v_enq);
end;
$$;

-- The invitation cap (10) counts only invitations the buyer sent, not replies from the board.
create or replace function public.invite_seller(p_request uuid, p_seller_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  m public.request_seller_matches;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.sweep_requests();
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null or not private.has_permission(r.buyer_org_id, 'request:post') then perform private.raise_error('not_found'); end if;
  if r.status <> 'open' then perform private.raise_error('conflict', 'request_not_open'); end if;
  perform private.check_rate_limit('reqinvite:' || v_user, 60, interval '1 hour');
  select * into m from public.request_seller_matches where request_id = p_request and seller_org_id = p_seller_org for update;
  if m.id is null then perform private.raise_error('invalid', 'not_a_candidate'); end if;
  if m.status = 'invited' then return; end if; -- duplicate invitation is a no-op
  if m.status <> 'candidate' then perform private.raise_error('conflict', 'already_responded'); end if;
  if (select count(*) from public.request_seller_matches x where x.request_id = p_request and x.status <> 'candidate' and x.invited_by is not null) >= 10 then
    perform private.raise_error('conflict', 'invite_limit_reached');
  end if;
  if not exists (select 1 from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
                 where l.org_id = p_seller_org and l.live_status = 'published' and l.accepting_requests) then
    perform private.raise_error('conflict', 'seller_not_available');
  end if;
  update public.request_seller_matches set status = 'invited', invited_by = v_user, invited_at = now(), updated_at = now() where id = m.id;
  perform private.write_audit('request.invited', r.buyer_org_id, 'buyer_request', p_request::text, jsonb_build_object('seller_org_id', p_seller_org));
  perform private.notify_org(p_seller_org, 'request:respond', 'request.invited', 'buyer_request', p_request::text);
end;
$$;

revoke all on function
  private.request_public_text_guard(), private.request_visibility_frozen(), private.board_eligible(uuid, uuid),
  public.set_request_visibility(uuid, text), public.list_board_requests(uuid, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_request_visibility(uuid, text), public.list_board_requests(uuid, text, text, integer) to authenticated;
