-- Phase 3: customer requests, deterministic matching, invitations, seller responses, enquiries, reports, moderation.
-- No ranking scores and no AI: a candidate is a seller whose published services match category and area, with saved reason codes.

------------------------------------------------------------------------------------------------
-- Enquiry seam (the only code that creates enquiries)
------------------------------------------------------------------------------------------------
create function private.open_enquiry(p_buyer uuid, p_seller uuid, p_request uuid, p_origin public.enquiry_origin,
  p_topic text, p_note text, p_opened_by uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  select e.id into v from public.enquiries e
  where e.buyer_org_id = p_buyer and e.seller_org_id = p_seller
    and coalesce(e.buyer_request_id, v_nil) = coalesce(p_request, v_nil) and e.status <> 'closed';
  if v is not null then return jsonb_build_object('id', v, 'created', false); end if;
  insert into public.enquiries (buyer_org_id, seller_org_id, buyer_request_id, origin, topic, opening_note, opened_by_org_id, created_by)
  values (p_buyer, p_seller, p_request, p_origin, left(p_topic, 200), p_note, p_opened_by, p_user)
  on conflict do nothing
  returning id into v;
  if v is null then
    select e.id into v from public.enquiries e
    where e.buyer_org_id = p_buyer and e.seller_org_id = p_seller
      and coalesce(e.buyer_request_id, v_nil) = coalesce(p_request, v_nil) and e.status <> 'closed';
    return jsonb_build_object('id', v, 'created', false);
  end if;
  return jsonb_build_object('id', v, 'created', true);
end;
$$;

------------------------------------------------------------------------------------------------
-- Matching
------------------------------------------------------------------------------------------------
create function private.compute_candidates(p_request uuid, p_broaden boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.buyer_requests;
  v_n integer;
begin
  select * into r from public.buyer_requests where id = p_request;
  delete from public.request_seller_matches where request_id = p_request and status = 'candidate';

  with svc as (
    select s.org_id, s.nationwide, (r.target_state = any (s.areas)) as in_area, s.min_order_qty, s.min_order_unit,
           s.lead_time_days, l.published_at
    from public.business_services s
    join public.business_listings l on l.org_id = s.org_id and l.live_status = 'published' and l.accepting_requests
    join public.organisations o on o.id = s.org_id and o.status = 'active' and o.type = 'business'
    where s.category_id = r.category_id
      and s.org_id <> r.buyer_org_id
      and (s.nationwide or r.target_state = any (s.areas) or p_broaden)
      -- a stated minimum order in the same unit that the request is below is a known mismatch: do not invite
      and not (s.min_order_qty is not null and r.quantity is not null and r.unit is not null
               and lower(s.min_order_unit) = lower(r.unit) and r.quantity < s.min_order_qty)
  ), best as (
    select distinct on (org_id) * from svc order by org_id, (nationwide or in_area) desc, published_at
  )
  insert into public.request_seller_matches (request_id, seller_org_id, reason_codes, caution_codes)
  select p_request, b.org_id,
    array_remove(array[
      'category_match',
      case when b.nationwide then 'serves_nationwide' when b.in_area then 'serves_state' end,
      case when r.quantity is not null and b.min_order_qty is not null and lower(b.min_order_unit) = lower(coalesce(r.unit, '')) then 'min_order_ok' end,
      case when r.needed_by is not null and b.lead_time_days is not null and r.needed_by >= current_date + b.lead_time_days then 'lead_time_ok' end
    ], null),
    array_remove(array[
      case when not (b.nationwide or b.in_area) then 'outside_requested_area' end,
      case when r.needed_by is not null and b.lead_time_days is not null and r.needed_by < current_date + b.lead_time_days then 'lead_time_tight' end,
      case when r.quantity is not null and b.min_order_qty is not null and lower(b.min_order_unit) <> lower(coalesce(r.unit, '')) then 'min_order_unit_differs' end
    ], null)
  from best b
  order by (b.nationwide or b.in_area) desc, b.published_at
  limit 20
  on conflict (request_id, seller_org_id) do nothing;

  select count(*) into v_n from public.request_seller_matches where request_id = p_request and status = 'candidate';
  return v_n;
end;
$$;

------------------------------------------------------------------------------------------------
-- Buyer: draft, submit, find sellers, invite, end
------------------------------------------------------------------------------------------------
create function public.save_request_draft(p_org uuid, p_request uuid, p_key text, p_data jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  v_type public.org_type;
  v_cat uuid;
  v_title text;
  v_desc text;
  v_state text;
  v_district text;
  v_qty text;
  v_unit text;
  v_needed text;
  v_bmin text;
  v_bmax text;
  v_share boolean;
  v_phone text;
  v_email text;
  k text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'request:post') then perform private.raise_error('forbidden'); end if;
  select o.type into v_type from public.organisations o where o.id = p_org;
  if v_type not in ('business', 'buyer') then perform private.raise_error('invalid', 'invalid_org_type'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('reqdraft:' || v_user, 200, interval '1 hour');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  for k in select jsonb_object_keys(p_data) loop
    if k not in ('title', 'category_slug', 'description', 'target_state', 'target_district', 'quantity', 'unit', 'needed_by',
                 'budget_min', 'budget_max', 'share_contact', 'contact_phone', 'contact_email') then
      perform private.raise_error('invalid', 'invalid_data');
    end if;
  end loop;

  if p_request is null then
    if p_key is null or char_length(p_key) not between 8 and 80 then perform private.raise_error('invalid', 'invalid_data'); end if;
    select * into r from public.buyer_requests where buyer_org_id = p_org and idempotency_key = p_key for update;
    if r.id is null then
      if (select count(*) from public.buyer_requests x where x.buyer_org_id = p_org and x.status = 'draft') >= 10 then
        perform private.raise_error('conflict', 'draft_limit_reached');
      end if;
      insert into public.buyer_requests (buyer_org_id, created_by, idempotency_key) values (p_org, v_user, p_key) returning * into r;
    elsif r.status <> 'draft' then
      return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status);
    end if;
  else
    select * into r from public.buyer_requests where id = p_request and buyer_org_id = p_org for update;
    if r.id is null then perform private.raise_error('not_found'); end if;
    if r.status <> 'draft' then perform private.raise_error('conflict', 'request_not_editable'); end if;
    if p_expected_version is distinct from r.version then perform private.raise_error('conflict', 'stale_version'); end if;
  end if;

  v_cat := r.category_id;
  if p_data ? 'category_slug' then
    if nullif(p_data ->> 'category_slug', '') is null then v_cat := null;
    else
      select c.id into v_cat from public.business_categories c where c.slug = p_data ->> 'category_slug' and c.active;
      if v_cat is null then perform private.raise_error('invalid', 'invalid_category'); end if;
    end if;
  end if;
  v_title := case when p_data ? 'title' then private.clean_text(p_data ->> 'title', 5, 140, 'invalid_title') else r.title end;
  v_desc := case when p_data ? 'description' then private.clean_text(p_data ->> 'description', 1, 2000, 'invalid_description') else r.description end;
  v_state := case when p_data ? 'target_state' then nullif(btrim(p_data ->> 'target_state'), '') else r.target_state end;
  if v_state is not null and not private.valid_state(v_state) then perform private.raise_error('invalid', 'invalid_state'); end if;
  v_district := case when p_data ? 'target_district' then private.clean_text(p_data ->> 'target_district', 1, 80, 'invalid_district') else r.target_district end;
  v_qty := case when p_data ? 'quantity' then nullif(btrim(coalesce(p_data ->> 'quantity', '')), '') else r.quantity::text end;
  if v_qty is not null and (v_qty !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or v_qty::numeric <= 0) then perform private.raise_error('invalid', 'invalid_quantity'); end if;
  v_unit := case when p_data ? 'unit' then private.clean_text(p_data ->> 'unit', 1, 30, 'invalid_unit') else r.unit end;
  v_needed := case when p_data ? 'needed_by' then nullif(btrim(coalesce(p_data ->> 'needed_by', '')), '') else r.needed_by::text end;
  if v_needed is not null and (v_needed !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then perform private.raise_error('invalid', 'invalid_date'); end if;
  if v_needed is not null then
    begin
      perform v_needed::date;
    exception when others then perform private.raise_error('invalid', 'invalid_date');
    end;
  end if;
  v_bmin := case when p_data ? 'budget_min' then nullif(btrim(coalesce(p_data ->> 'budget_min', '')), '') else r.budget_min::text end;
  v_bmax := case when p_data ? 'budget_max' then nullif(btrim(coalesce(p_data ->> 'budget_max', '')), '') else r.budget_max::text end;
  if (v_bmin is not null and v_bmin !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') or (v_bmax is not null and v_bmax !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
     or (v_bmin is not null and v_bmax is not null and v_bmax::numeric < v_bmin::numeric) then
    perform private.raise_error('invalid', 'invalid_budget');
  end if;
  if p_data ? 'share_contact' then
    if jsonb_typeof(p_data -> 'share_contact') <> 'boolean' then perform private.raise_error('invalid', 'invalid_data'); end if;
    v_share := (p_data ->> 'share_contact')::boolean;
  else
    v_share := r.share_contact;
  end if;

  update public.buyer_requests set category_id = v_cat, title = v_title, description = v_desc, target_state = v_state,
    target_district = v_district, quantity = v_qty::numeric, unit = v_unit, needed_by = v_needed::date,
    budget_min = v_bmin::numeric, budget_max = v_bmax::numeric, share_contact = v_share, version = r.version + 1, updated_at = now()
  where id = r.id;

  if p_data ? 'contact_phone' or p_data ? 'contact_email' then
    select p.contact_phone, p.contact_email into v_phone, v_email from public.buyer_request_private p where p.request_id = r.id;
    if p_data ? 'contact_phone' then
      v_phone := private.clean_text(p_data ->> 'contact_phone', 1, 20, 'invalid_phone');
      if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_phone'); end if;
    end if;
    if p_data ? 'contact_email' then
      v_email := lower(private.clean_text(p_data ->> 'contact_email', 1, 254, 'invalid_email'));
      if not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;
    end if;
    insert into public.buyer_request_private (request_id, contact_phone, contact_email) values (r.id, v_phone, v_email)
    on conflict (request_id) do update set contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, updated_at = now();
  end if;
  return jsonb_build_object('id', r.id, 'version', r.version + 1, 'status', 'draft');
end;
$$;

create function public.submit_request(p_request uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  p public.buyer_request_private;
  v_n integer;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.sweep_requests();
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null or not private.has_permission(r.buyer_org_id, 'request:post') then perform private.raise_error('not_found'); end if;
  if r.status = 'open' then -- retry-safe
    return jsonb_build_object('id', r.id, 'status', 'open', 'candidates', (select count(*) from public.request_seller_matches m where m.request_id = r.id));
  end if;
  if r.status <> 'draft' then perform private.raise_error('conflict', 'request_not_editable'); end if;
  if p_expected_version is distinct from r.version then perform private.raise_error('conflict', 'stale_version'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('reqsubmit:' || v_user, 10, interval '1 day');

  if r.title is null or r.category_id is null or r.target_state is null or coalesce(char_length(r.description), 0) < 20 then
    perform private.raise_error('invalid', 'request_incomplete');
  end if;
  if r.quantity is not null and r.unit is null then perform private.raise_error('invalid', 'invalid_unit'); end if;
  if r.needed_by is not null and r.needed_by < current_date then perform private.raise_error('invalid', 'invalid_date'); end if;
  select * into p from public.buyer_request_private where request_id = p_request;
  if p.request_id is null or (p.contact_phone is null and p.contact_email is null) then perform private.raise_error('invalid', 'contact_required'); end if;
  if (select count(*) from public.buyer_requests x where x.buyer_org_id = r.buyer_org_id and x.status = 'open') >= 5 then
    perform private.raise_error('conflict', 'request_limit_reached');
  end if;
  if exists (select 1 from public.buyer_requests x
             where x.buyer_org_id = r.buyer_org_id and x.id <> r.id and x.status = 'open' and x.category_id = r.category_id
               and x.target_state = r.target_state and lower(x.title) = lower(r.title) and x.submitted_at > now() - interval '7 days') then
    perform private.raise_error('conflict', 'duplicate_request');
  end if;

  update public.buyer_requests set status = 'open', submitted_at = now(), expires_at = now() + interval '30 days',
    version = r.version + 1, updated_at = now() where id = p_request;
  v_n := private.compute_candidates(p_request, false);
  perform private.write_audit('request.submitted', r.buyer_org_id, 'buyer_request', p_request::text, '{}'::jsonb);
  return jsonb_build_object('id', p_request, 'status', 'open', 'candidates', v_n);
end;
$$;

-- Re-runs matching. p_broaden drops the area rule so the buyer can see sellers outside the requested state (flagged).
create function public.find_candidates(p_request uuid, p_broaden boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.sweep_requests();
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null or not private.has_permission(r.buyer_org_id, 'request:post') then perform private.raise_error('not_found'); end if;
  if r.status <> 'open' then perform private.raise_error('conflict', 'request_not_open'); end if;
  perform private.check_rate_limit('reqfind:' || v_user, 60, interval '1 hour');
  return private.compute_candidates(p_request, coalesce(p_broaden, false));
end;
$$;

create function public.invite_seller(p_request uuid, p_seller_org uuid)
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
  if (select count(*) from public.request_seller_matches x where x.request_id = p_request and x.status <> 'candidate') >= 10 then
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

create function public.end_request(p_request uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  v_reason text := private.clean_text(p_reason, 1, 500, 'invalid_note');
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_status not in ('closed', 'withdrawn') then perform private.raise_error('invalid', 'invalid_status'); end if;
  perform private.sweep_requests();
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null or not private.has_permission(r.buyer_org_id, 'request:post') then perform private.raise_error('not_found'); end if;
  if r.status::text = p_status then return; end if;
  if r.status not in ('draft', 'open') or (r.status = 'draft' and p_status = 'closed') then
    perform private.raise_error('conflict', 'request_not_open');
  end if;
  update public.buyer_requests set status = p_status::public.request_status, closed_at = now(), closed_reason = v_reason,
    version = version + 1, updated_at = now() where id = p_request;
  delete from public.request_seller_matches where request_id = p_request and status = 'candidate';
  update public.request_seller_matches set status = 'withdrawn', updated_at = now() where request_id = p_request and status = 'invited';
  perform private.write_audit('request.' || p_status, r.buyer_org_id, 'buyer_request', p_request::text, '{}'::jsonb);
end;
$$;

-- Buyer's own requests with response counts.
create function public.list_buyer_requests(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('not_found'); end if;
  perform private.sweep_requests();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'status', r.status, 'target_state', r.target_state,
      'category_slug', c.slug, 'created_at', r.created_at, 'expires_at', r.expires_at,
      'invited', (select count(*) from public.request_seller_matches m where m.request_id = r.id and m.status in ('invited', 'interested', 'question', 'declined', 'expired', 'withdrawn') and m.invited_at is not null),
      'interested', (select count(*) from public.request_seller_matches m where m.request_id = r.id and m.status in ('interested', 'question')),
      'declined', (select count(*) from public.request_seller_matches m where m.request_id = r.id and m.status = 'declined'))
      order by r.created_at desc)
    from public.buyer_requests r left join public.business_categories c on c.id = r.category_id
    where r.buyer_org_id = p_org), '[]'::jsonb);
end;
$$;

create function public.list_request_matches(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  perform private.sweep_requests();
  select r.buyer_org_id into v_org from public.buyer_requests r where r.id = p_request;
  if v_org is null or not private.is_member(v_org) then perform private.raise_error('not_found'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'seller_org_id', m.seller_org_id, 'status', m.status, 'reason_codes', m.reason_codes, 'caution_codes', m.caution_codes,
      'invited_at', m.invited_at, 'responded_at', m.responded_at, 'response_note', m.response_note, 'enquiry_id', m.enquiry_id,
      'available', (l.live_status = 'published' and o.status = 'active'),
      'listing', case when l.live_status = 'published' and o.status = 'active' then private.listing_json(m.seller_org_id, false)
                      else jsonb_build_object('name', l.live_name) end)
      order by (m.status = 'candidate'), m.invited_at nulls last, m.created_at)
    from public.request_seller_matches m
    join public.business_listings l on l.org_id = m.seller_org_id
    join public.organisations o on o.id = m.seller_org_id
    where m.request_id = p_request), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- Seller: inbox, view, respond
------------------------------------------------------------------------------------------------
create function public.list_seller_requests(p_seller_org uuid, p_filter text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org, 'request:respond') then perform private.raise_error('forbidden'); end if;
  if p_filter not in ('all', 'new', 'replied', 'closed') then perform private.raise_error('invalid', 'invalid_status'); end if;
  perform private.sweep_requests();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'request_id', r.id, 'title', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else r.title end,
      'category_slug', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else c.slug end,
      'target_state', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else r.target_state end,
      'quantity', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else r.quantity end,
      'unit', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else r.unit end,
      'needed_by', case when r.status in ('withdrawn', 'removed') or bo.status <> 'active' then null else r.needed_by end, 'match_status', m.status, 'request_status', r.status,
      'invited_at', m.invited_at, 'responded_at', m.responded_at, 'enquiry_id', m.enquiry_id, 'expires_at', r.expires_at)
      order by coalesce(m.responded_at, m.invited_at) desc)
    from public.request_seller_matches m
    join public.buyer_requests r on r.id = m.request_id
    left join public.business_categories c on c.id = r.category_id
    join public.organisations bo on bo.id = r.buyer_org_id
    where m.seller_org_id = p_seller_org and m.status <> 'candidate' and m.invited_at is not null and r.status <> 'draft'
      and (p_filter = 'all'
        or (p_filter = 'new' and m.status = 'invited' and r.status = 'open')
        or (p_filter = 'replied' and m.status in ('interested', 'question', 'declined'))
        or (p_filter = 'closed' and (r.status <> 'open' or m.status in ('expired', 'withdrawn')))
    )), '[]'::jsonb);
end;
$$;

create function public.get_request_for_seller(p_request uuid, p_seller_org uuid)
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
  v jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org, 'request:respond') then perform private.raise_error('forbidden'); end if;
  perform private.sweep_requests();
  select * into m from public.request_seller_matches where request_id = p_request and seller_org_id = p_seller_org;
  if m.id is null or m.status = 'candidate' or m.invited_at is null then perform private.raise_error('not_found'); end if; -- never confirms the request exists
  select * into r from public.buyer_requests where id = p_request;
  v := jsonb_build_object('request_id', r.id, 'request_status', r.status, 'match_status', m.status, 'invited_at', m.invited_at,
    'responded_at', m.responded_at, 'response_note', m.response_note, 'enquiry_id', m.enquiry_id, 'expires_at', r.expires_at);
  if r.status in ('withdrawn', 'removed') or (select o.status from public.organisations o where o.id = r.buyer_org_id) <> 'active' then return v; end if;
  if m.status = 'invited' and m.viewed_at is null then
    update public.request_seller_matches set viewed_at = now(), updated_at = now() where id = m.id;
  end if;
  v_responded := m.status in ('interested', 'question');
  v := v || jsonb_build_object('title', r.title, 'description', r.description, 'category_slug',
      (select c.slug from public.business_categories c where c.id = r.category_id),
      'target_state', r.target_state, 'target_district', r.target_district, 'quantity', r.quantity, 'unit', r.unit,
      'needed_by', r.needed_by, 'budget_min', r.budget_min, 'budget_max', r.budget_max, 'currency', r.currency,
      'caution_codes', m.caution_codes, 'reason_codes', m.reason_codes);
  if v_responded then
    -- Name and contact are both covered by the buyer's one consent choice.
    if r.share_contact and r.status = 'open' then
      select * into p from public.buyer_request_private where request_id = p_request;
      v := v || jsonb_build_object('buyer_name', (select o.name from public.organisations o where o.id = r.buyer_org_id),
        'contact_phone', p.contact_phone, 'contact_email', p.contact_email);
    end if;
  end if;
  return v;
end;
$$;

create function public.respond_to_invitation(p_request uuid, p_seller_org uuid, p_response text, p_note text)
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
  if r.id is null or m.id is null or m.status = 'candidate' or m.invited_at is null then perform private.raise_error('not_found'); end if;
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
  perform private.write_audit('request.' || p_response, p_seller_org, 'buyer_request', p_request::text, '{}'::jsonb);
  perform private.notify_org(r.buyer_org_id, 'request:post', 'request.' || p_response, 'buyer_request', p_request::text);
  return jsonb_build_object('status', v_status, 'enquiry_id', v_enq);
end;
$$;

-- Buyer or seller opens an enquiry from a public listing (the in-app contact request).
create function public.open_listing_enquiry(p_buyer_org uuid, p_slug text, p_topic text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_seller uuid;
  v_topic text := private.clean_text(p_topic, 3, 200, 'invalid_title');
  v_note text := private.clean_text(p_note, 10, 1000, 'invalid_note');
  v_existing uuid;
  v_open jsonb;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_buyer_org, 'request:post') then perform private.raise_error('forbidden'); end if;
  if (select o.type from public.organisations o where o.id = p_buyer_org) not in ('business', 'buyer') then
    perform private.raise_error('invalid', 'invalid_org_type');
  end if;
  if v_topic is null or v_note is null then perform private.raise_error('invalid', 'invalid_note'); end if;
  perform private.require_consent();
  select l.org_id into v_seller from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
  where l.slug = p_slug and l.live_status = 'published';
  if v_seller is null then perform private.raise_error('not_found'); end if;
  if v_seller = p_buyer_org then perform private.raise_error('invalid', 'same_organisation'); end if;
  if not (select l.accepting_requests from public.business_listings l where l.org_id = v_seller) then
    perform private.raise_error('conflict', 'seller_not_accepting');
  end if;
  select e.id into v_existing from public.enquiries e
  where e.buyer_org_id = p_buyer_org and e.seller_org_id = v_seller and e.buyer_request_id is null and e.status <> 'closed';
  if v_existing is not null then return jsonb_build_object('id', v_existing, 'created', false); end if;
  perform private.check_rate_limit('enqopen:' || v_user, 20, interval '1 day');
  v_open := private.open_enquiry(p_buyer_org, v_seller, null, 'listing', v_topic, v_note, p_buyer_org, v_user);
  if (v_open ->> 'created')::boolean then
    perform private.write_audit('enquiry.opened', p_buyer_org, 'enquiry', v_open ->> 'id', jsonb_build_object('origin', 'listing'));
    perform private.notify_org(v_seller, 'request:respond', 'enquiry.opened', 'enquiry', v_open ->> 'id');
  end if;
  return v_open;
end;
$$;

------------------------------------------------------------------------------------------------
-- Reports and moderation
------------------------------------------------------------------------------------------------
create function public.report_content(p_type text, p_target text, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_note text := private.clean_text(p_note, 1, 500, 'invalid_note');
  v_org uuid;
  v_req uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_reason not in ('misleading', 'offensive', 'spam', 'scam', 'other') then perform private.raise_error('invalid', 'invalid_reason'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('report:' || v_user, 20, interval '1 day');
  if p_type = 'listing' then
    select l.org_id into v_org from public.business_listings l where l.slug = p_target and l.live_status = 'published';
    if v_org is null then perform private.raise_error('not_found'); end if;
    if private.is_member(v_org) then perform private.raise_error('invalid', 'same_organisation'); end if;
    insert into public.content_reports (target_type, listing_org_id, reporter_user_id, reason, note)
    values ('listing', v_org, v_user, p_reason::public.report_reason, v_note);
  elsif p_type = 'request' then
    if p_target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then perform private.raise_error('not_found'); end if;
    v_req := p_target::uuid;
    -- only a seller that was actually shown the request may report it
    if not exists (select 1 from public.request_seller_matches m
                   where m.request_id = v_req and m.status in ('invited', 'interested', 'question', 'declined')
                     and private.has_permission(m.seller_org_id, 'request:respond')) then
      perform private.raise_error('not_found');
    end if;
    insert into public.content_reports (target_type, request_id, reporter_user_id, reason, note)
    values ('request', v_req, v_user, p_reason::public.report_reason, v_note);
  else
    perform private.raise_error('invalid', 'invalid_data');
  end if;
exception when unique_violation then
  perform private.raise_error('conflict', 'already_reported');
end;
$$;

create function public.remove_request(p_request uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.buyer_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('request:moderate') then perform private.raise_error('forbidden'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into r from public.buyer_requests where id = p_request for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(r.buyer_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if r.status = 'removed' then return; end if;
  if not private.request_has_open_report(p_request) then perform private.raise_error('conflict', 'report_not_open'); end if;
  update public.buyer_requests set status = 'removed', closed_at = now(), closed_reason = v_reason, removed_by = v_user,
    version = version + 1, updated_at = now() where id = p_request;
  delete from public.request_seller_matches where request_id = p_request and status = 'candidate';
  update public.request_seller_matches set status = 'withdrawn', updated_at = now() where request_id = p_request and status = 'invited';
  perform private.write_audit('request.removed', r.buyer_org_id, 'buyer_request', p_request::text, jsonb_build_object('reason', v_reason));
  perform private.notify_org(r.buyer_org_id, 'request:post', 'request.removed', 'buyer_request', p_request::text);
end;
$$;

create function public.handle_report(p_report uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  c public.content_reports;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if p_action not in ('dismiss', 'suspend', 'remove') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  if char_length(v_note) < 5 or char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into c from public.content_reports where id = p_report for update;
  if c.id is null then perform private.raise_error('not_found'); end if;
  if (c.target_type = 'listing' and not private.has_platform_permission('listing:review'))
     or (c.target_type = 'request' and not private.has_platform_permission('request:moderate')) then
    perform private.raise_error('forbidden');
  end if;
  if (p_action = 'suspend' and c.target_type <> 'listing') or (p_action = 'remove' and c.target_type <> 'request') then
    perform private.raise_error('invalid', 'invalid_decision');
  end if;
  if c.status <> 'open' then perform private.raise_error('conflict', 'report_not_open'); end if;
  if private.has_org_involvement(coalesce(c.listing_org_id, private.request_buyer_org(c.request_id)), v_user) then
    perform private.raise_error('forbidden', 'conflict_of_interest');
  end if;
  if p_action = 'suspend' then perform public.suspend_listing(c.listing_org_id, v_note);
  elsif p_action = 'remove' then perform public.remove_request(c.request_id, v_note);
  end if;
  update public.content_reports set status = case p_action when 'dismiss' then 'dismissed' else 'actioned' end,
    handled_by = v_user, handled_at = now(), handler_note = v_note where id = p_report;
  perform private.write_audit('report.' || p_action, null, 'content_report', p_report::text, '{}'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------------------------
revoke all on function
  private.open_enquiry(uuid, uuid, uuid, public.enquiry_origin, text, text, uuid, uuid), private.compute_candidates(uuid, boolean),
  public.save_request_draft(uuid, uuid, text, jsonb, integer), public.submit_request(uuid, integer),
  public.find_candidates(uuid, boolean), public.invite_seller(uuid, uuid), public.end_request(uuid, text, text),
  public.list_buyer_requests(uuid), public.list_request_matches(uuid), public.list_seller_requests(uuid, text),
  public.get_request_for_seller(uuid, uuid), public.respond_to_invitation(uuid, uuid, text, text),
  public.open_listing_enquiry(uuid, text, text, text), public.report_content(text, text, text, text),
  public.remove_request(uuid, text), public.handle_report(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.save_request_draft(uuid, uuid, text, jsonb, integer), public.submit_request(uuid, integer),
  public.find_candidates(uuid, boolean), public.invite_seller(uuid, uuid), public.end_request(uuid, text, text),
  public.list_buyer_requests(uuid), public.list_request_matches(uuid), public.list_seller_requests(uuid, text),
  public.get_request_for_seller(uuid, uuid), public.respond_to_invitation(uuid, uuid, text, text),
  public.open_listing_enquiry(uuid, text, text, text), public.report_content(text, text, text, text),
  public.remove_request(uuid, text), public.handle_report(uuid, text, text)
  to authenticated;

------------------------------------------------------------------------------------------------
-- Names of the two parties, readable by the participants only (organisation rows are otherwise private).
------------------------------------------------------------------------------------------------
create function public.enquiry_parties(p_enquiry uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries x where x.id = p_enquiry;
  if e.id is null or not (private.is_member(e.buyer_org_id) or private.is_member(e.seller_org_id)) then
    perform private.raise_error('not_found');
  end if;
  return jsonb_build_object(
    'buyer_name', case when private.is_member(e.buyer_org_id) or e.buyer_request_id is null
                       or (select r.share_contact from public.buyer_requests r where r.id = e.buyer_request_id)
                       then (select o.name from public.organisations o where o.id = e.buyer_org_id) end,
    'seller_name', (select coalesce(l.live_name, o.name) from public.organisations o
                    left join public.business_listings l on l.org_id = o.id where o.id = e.seller_org_id),
    'seller_slug', (select l.slug from public.business_listings l where l.org_id = e.seller_org_id and l.live_status = 'published'),
    'you_are', case when private.is_member(e.buyer_org_id) then 'buyer' else 'seller' end);
end;
$$;
revoke all on function public.enquiry_parties(uuid) from public, anon, authenticated, service_role;
grant execute on function public.enquiry_parties(uuid) to authenticated;
