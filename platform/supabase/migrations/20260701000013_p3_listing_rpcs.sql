-- Phase 3: listing RPCs (owner draft/submit, reviewer decisions, public search and profile).
-- Wording rule (same as Phase 2): a published listing is NOT an SSM check. Public output carries only
-- "documents reviewed by MITRA on <date> for <scope>" taken from approved verification claims.

------------------------------------------------------------------------------------------------
-- Draft validation
------------------------------------------------------------------------------------------------
create function private.clean_listing_draft(p_cur jsonb, p_new jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_cur, '{}'::jsonb) - 'profile';
  k text;
  item jsonb;
  out_arr jsonb;
  v_name text;
  v_slug text;
  v_nat boolean;
  v_areas jsonb;
  v_qty text;
  v_unit text;
  v_lead text;
  v_phone text;
  v_email text;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  for k in select jsonb_object_keys(p_new) loop
    if k not in ('headline', 'description', 'show_phone', 'show_email', 'public_phone', 'public_email', 'services', 'portfolio') then
      perform private.raise_error('invalid', 'invalid_data');
    end if;
  end loop;

  if p_new ? 'headline' then
    v := v || jsonb_build_object('headline', private.clean_text(p_new ->> 'headline', 10, 160, 'invalid_headline'));
  end if;
  if p_new ? 'description' then
    v := v || jsonb_build_object('description', private.clean_text(p_new ->> 'description', 1, 2000, 'invalid_description'));
  end if;
  foreach k in array array['show_phone', 'show_email'] loop
    if p_new ? k then
      if jsonb_typeof(p_new -> k) <> 'boolean' then perform private.raise_error('invalid', 'invalid_data'); end if;
      v := v || jsonb_build_object(k, p_new -> k);
    end if;
  end loop;
  if p_new ? 'public_phone' then
    v_phone := private.clean_text(p_new ->> 'public_phone', 1, 20, 'invalid_phone');
    if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_phone'); end if;
    v := v || jsonb_build_object('public_phone', v_phone);
  end if;
  if p_new ? 'public_email' then
    v_email := lower(private.clean_text(p_new ->> 'public_email', 1, 254, 'invalid_email'));
    if not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;
    v := v || jsonb_build_object('public_email', v_email);
  end if;

  if p_new ? 'services' then
    if jsonb_typeof(p_new -> 'services') <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
    if jsonb_array_length(p_new -> 'services') > 10 then perform private.raise_error('invalid', 'too_many_services'); end if;
    out_arr := '[]'::jsonb;
    for item in select * from jsonb_array_elements(p_new -> 'services') loop
      if jsonb_typeof(item) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
      v_name := private.clean_text(item ->> 'name', 2, 120, 'invalid_service_name');
      if v_name is null then perform private.raise_error('invalid', 'invalid_service_name'); end if;
      v_slug := item ->> 'category_slug';
      if v_slug is null or not exists (select 1 from public.business_categories c where c.slug = v_slug and c.active) then
        perform private.raise_error('invalid', 'invalid_category');
      end if;
      v_nat := coalesce(item ->> 'nationwide', 'false') = 'true';
      if jsonb_typeof(coalesce(item -> 'areas', '[]'::jsonb)) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
      select coalesce(jsonb_agg(a order by a), '[]'::jsonb) into v_areas
      from (select distinct x as a from jsonb_array_elements_text(coalesce(item -> 'areas', '[]'::jsonb)) x) s;
      if exists (select 1 from jsonb_array_elements_text(v_areas) a where not private.valid_state(a)) then
        perform private.raise_error('invalid', 'invalid_state');
      end if;
      if v_nat then v_areas := '[]'::jsonb; end if;
      if not v_nat and jsonb_array_length(v_areas) = 0 then perform private.raise_error('invalid', 'service_area_required'); end if;
      v_qty := nullif(btrim(coalesce(item ->> 'min_order_qty', '')), '');
      v_unit := private.clean_text(item ->> 'min_order_unit', 1, 30, 'invalid_min_order');
      if v_qty is not null and (v_qty !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or v_qty::numeric <= 0 or v_unit is null) then
        perform private.raise_error('invalid', 'invalid_min_order');
      end if;
      if v_qty is null then v_unit := null; end if;
      v_lead := nullif(btrim(coalesce(item ->> 'lead_time_days', '')), '');
      if v_lead is not null and (v_lead !~ '^[0-9]{1,3}$' or v_lead::integer > 365) then
        perform private.raise_error('invalid', 'invalid_lead_time');
      end if;
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'description', private.clean_text(item ->> 'description', 1, 600, 'invalid_description'),
        'category_slug', v_slug,
        'nationwide', v_nat,
        'areas', v_areas,
        'min_order_qty', v_qty::numeric,
        'min_order_unit', v_unit,
        'lead_time_days', v_lead::integer,
        'capacity_note', private.clean_text(item ->> 'capacity_note', 1, 300, 'invalid_note')));
    end loop;
    v := v || jsonb_build_object('services', out_arr);
  end if;

  if p_new ? 'portfolio' then
    if jsonb_typeof(p_new -> 'portfolio') <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
    if jsonb_array_length(p_new -> 'portfolio') > 8 then perform private.raise_error('invalid', 'too_many_portfolio'); end if;
    out_arr := '[]'::jsonb;
    for item in select * from jsonb_array_elements(p_new -> 'portfolio') loop
      if jsonb_typeof(item) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
      v_name := private.clean_text(item ->> 'title', 2, 120, 'invalid_portfolio');
      if v_name is null then perform private.raise_error('invalid', 'invalid_portfolio'); end if;
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'title', v_name, 'description', private.clean_text(item ->> 'description', 1, 600, 'invalid_description')));
    end loop;
    v := v || jsonb_build_object('portfolio', out_arr);
  end if;
  -- Contact details the owner did not choose to publish are not kept at all (reviewers can read drafts).
  if not coalesce((v ->> 'show_phone')::boolean, false) then v := v || jsonb_build_object('public_phone', null); end if;
  if not coalesce((v ->> 'show_email')::boolean, false) then v := v || jsonb_build_object('public_email', null); end if;
  return v;
end;
$$;

-- What must exist before a listing can be sent for review.
create function private.assert_listing_complete(p_draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(char_length(p_draft ->> 'headline'), 0) < 10
     or coalesce(char_length(p_draft ->> 'description'), 0) < 30
     or jsonb_array_length(coalesce(p_draft -> 'services', '[]'::jsonb)) < 1 then
    perform private.raise_error('invalid', 'listing_incomplete');
  end if;
  if coalesce((p_draft ->> 'show_phone')::boolean, false) and (p_draft ->> 'public_phone') is null then
    perform private.raise_error('invalid', 'invalid_phone');
  end if;
  if coalesce((p_draft ->> 'show_email')::boolean, false) and (p_draft ->> 'public_email') is null then
    perform private.raise_error('invalid', 'invalid_email');
  end if;
end;
$$;

create function private.add_listing_event(p_org uuid, p_actor uuid, p_event text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.listing_events (org_id, actor_user_id, event, details)
  values (p_org, p_actor, p_event, coalesce(p_details, '{}'::jsonb));
end;
$$;

create function private.make_slug(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base text := trim(both '-' from left(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), 50));
  v_slug text;
begin
  if char_length(v_base) < 2 then v_base := 'business'; end if;
  loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    exit when not exists (select 1 from public.business_listings l where l.slug = v_slug);
  end loop;
  return v_slug;
end;
$$;

-- Copies the reviewed draft over the public snapshot. Called only from review_listing.
create function private.apply_draft(p_org uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.business_listings;
  v_prof jsonb;
  v_count integer;
begin
  select * into l from public.business_listings where org_id = p_org for update;
  v_prof := l.draft -> 'profile';
  if v_prof is null then perform private.raise_error('invalid', 'listing_incomplete'); end if;
  perform private.assert_listing_complete(l.draft);

  delete from public.business_services where org_id = p_org;
  insert into public.business_services (org_id, category_id, name, description, nationwide, areas, min_order_qty, min_order_unit,
    lead_time_days, capacity_note, sort)
  select p_org, c.id, s.value ->> 'name', s.value ->> 'description', (s.value ->> 'nationwide')::boolean,
    coalesce((select array_agg(a) from jsonb_array_elements_text(s.value -> 'areas') a), '{}'::text[]),
    (s.value ->> 'min_order_qty')::numeric, s.value ->> 'min_order_unit', (s.value ->> 'lead_time_days')::integer,
    s.value ->> 'capacity_note', (s.ordinality)::integer
  from jsonb_array_elements(l.draft -> 'services') with ordinality s
  join public.business_categories c on c.slug = s.value ->> 'category_slug' and c.active;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(l.draft -> 'services') then perform private.raise_error('invalid', 'listing_incomplete'); end if;

  delete from public.business_portfolio where org_id = p_org;
  insert into public.business_portfolio (org_id, title, description, sort)
  select p_org, s.value ->> 'title', s.value ->> 'description', (s.ordinality)::integer
  from jsonb_array_elements(coalesce(l.draft -> 'portfolio', '[]'::jsonb)) with ordinality s;

  update public.business_listings set
    slug = coalesce(slug, private.make_slug(v_prof ->> 'business_name')),
    live_name = v_prof ->> 'business_name',
    live_category_id = (v_prof ->> 'category_id')::uuid,
    live_state = v_prof ->> 'state',
    live_district = v_prof ->> 'district',
    live_headline = l.draft ->> 'headline',
    live_description = l.draft ->> 'description',
    live_show_phone = coalesce((l.draft ->> 'show_phone')::boolean, false),
    live_show_email = coalesce((l.draft ->> 'show_email')::boolean, false),
    live_phone = case when coalesce((l.draft ->> 'show_phone')::boolean, false) then l.draft ->> 'public_phone' end,
    live_email = case when coalesce((l.draft ->> 'show_email')::boolean, false) then l.draft ->> 'public_email' end,
    live_version = live_version + 1,
    live_status = case when live_status = 'suspended' then 'suspended'::public.listing_live_status else 'published'::public.listing_live_status end,
    published_at = coalesce(published_at, now()),
    updated_at = now()
  where org_id = p_org;
end;
$$;

------------------------------------------------------------------------------------------------
-- Owner actions
------------------------------------------------------------------------------------------------
create function public.save_listing_draft(p_org uuid, p_data jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'business:edit') then perform private.raise_error('forbidden'); end if;
  if (select o.type from public.organisations o where o.id = p_org) is distinct from 'business' then
    perform private.raise_error('invalid', 'org_not_business');
  end if;
  perform private.require_consent();
  perform private.check_rate_limit('listing:' || v_user, 120, interval '1 hour');
  if not exists (select 1 from public.business_profiles bp where bp.org_id = p_org) then
    perform private.raise_error('conflict', 'profile_required');
  end if;
  insert into public.business_listings (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.review_status = 'pending_review' then perform private.raise_error('conflict', 'listing_under_review'); end if;
  if p_expected_version is distinct from l.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;

  update public.business_listings
  set draft = private.clean_listing_draft(l.draft, p_data), draft_version = l.draft_version + 1,
      review_status = 'editing', updated_at = now()
  where org_id = p_org;
  perform private.write_audit('listing.draft_saved', p_org, 'business_listing', p_org::text, '{}'::jsonb);
  return jsonb_build_object('version', l.draft_version + 1);
end;
$$;

create function public.submit_listing(p_org uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
  bp public.business_profiles;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'listing:publish') then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('listing_submit:' || v_user, 20, interval '1 hour');
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if l.review_status = 'pending_review' then return; end if; -- retry-safe
  if l.review_status = 'approved' then perform private.raise_error('conflict', 'nothing_to_submit'); end if;
  if p_expected_version is distinct from l.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;
  perform private.assert_listing_complete(l.draft);
  select * into bp from public.business_profiles where org_id = p_org;
  if bp.org_id is null or bp.state is null then perform private.raise_error('invalid', 'listing_incomplete'); end if;

  update public.business_listings
  set draft = l.draft || jsonb_build_object('profile', jsonb_build_object('business_name', bp.business_name,
        'category_id', bp.category_id, 'state', bp.state, 'district', bp.district)),
      review_status = 'pending_review', submitted_at = now(), submitted_by = v_user, review_reason = null, updated_at = now()
  where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'submitted', jsonb_build_object('draft_version', l.draft_version));
  perform private.write_audit('listing.submitted', p_org, 'business_listing', p_org::text, jsonb_build_object('draft_version', l.draft_version));
end;
$$;

create function public.withdraw_listing_submission(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'listing:publish') then perform private.raise_error('forbidden'); end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if l.review_status <> 'pending_review' then perform private.raise_error('conflict', 'listing_not_pending'); end if;
  update public.business_listings set review_status = 'editing', updated_at = now() where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'withdrawn', '{}'::jsonb);
  perform private.write_audit('listing.withdrawn', p_org, 'business_listing', p_org::text, '{}'::jsonb);
end;
$$;

create function public.unpublish_listing(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'listing:publish') then perform private.raise_error('forbidden'); end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if l.live_status = 'unpublished' then return; end if;
  if l.live_status <> 'published' then perform private.raise_error('conflict', 'listing_not_live'); end if;
  update public.business_listings set live_status = 'unpublished', updated_at = now() where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'unpublished', '{}'::jsonb);
  perform private.write_audit('listing.unpublished', p_org, 'business_listing', p_org::text, '{}'::jsonb);
end;
$$;

create function public.republish_listing(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'listing:publish') then perform private.raise_error('forbidden'); end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if l.live_status = 'published' then return; end if;
  if l.live_status <> 'unpublished' or l.live_version = 0 then perform private.raise_error('conflict', 'listing_not_live'); end if;
  update public.business_listings set live_status = 'published', updated_at = now() where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'republished', '{}'::jsonb);
  perform private.write_audit('listing.republished', p_org, 'business_listing', p_org::text, '{}'::jsonb);
end;
$$;

-- "Busy" switch: takes effect immediately and only ever narrows who can contact the business.
create function public.set_accepting_requests(p_org uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'business:edit') then perform private.raise_error('forbidden'); end if;
  if p_value is null then perform private.raise_error('invalid', 'invalid_data'); end if;
  update public.business_listings set accepting_requests = p_value, updated_at = now() where org_id = p_org;
  if not found then perform private.raise_error('not_found'); end if;
  perform private.write_audit('listing.accepting_changed', p_org, 'business_listing', p_org::text, jsonb_build_object('value', p_value));
end;
$$;

------------------------------------------------------------------------------------------------
-- Reviewer actions
------------------------------------------------------------------------------------------------
create function public.review_listing(p_org uuid, p_decision text, p_reason text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('listing:review') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_changes') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  if v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' or char_length(v_reason) > 1000
     or (p_decision <> 'approve' and char_length(v_reason) < 5) then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if (select o.status from public.organisations o where o.id = p_org) is distinct from 'active' then
    perform private.raise_error('conflict', 'org_not_active');
  end if;
  if l.review_status <> 'pending_review' then perform private.raise_error('conflict', 'listing_not_pending'); end if;
  if l.draft_version is distinct from p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;

  if p_decision = 'approve' then
    perform private.apply_draft(p_org, v_user);
    update public.business_listings set review_status = 'approved', review_reason = nullif(v_reason, ''), decided_at = now(),
      decided_by = v_user, updated_at = now() where org_id = p_org;
    v_event := 'approved';
  else
    update public.business_listings set review_status = case p_decision when 'reject' then 'rejected' else 'changes_requested' end::public.listing_review_status,
      review_reason = v_reason, decided_at = now(), decided_by = v_user, updated_at = now() where org_id = p_org;
    v_event := case p_decision when 'reject' then 'rejected' else 'changes_requested' end;
  end if;
  perform private.add_listing_event(p_org, v_user, v_event, jsonb_build_object('draft_version', l.draft_version, 'reason', nullif(v_reason, '')));
  perform private.write_audit('listing.' || v_event, p_org, 'business_listing', p_org::text, jsonb_build_object('draft_version', l.draft_version));
  perform private.notify_org(p_org, 'listing:publish', 'listing.' || v_event, 'listing', p_org::text);
end;
$$;

create function public.suspend_listing(p_org uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('listing:review') then perform private.raise_error('forbidden'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if l.live_status = 'suspended' then return; end if;
  if l.live_status <> 'published' then perform private.raise_error('conflict', 'listing_not_live'); end if;
  update public.business_listings set live_status = 'suspended', suspended_reason = v_reason, suspended_at = now(),
    suspended_by = v_user, updated_at = now() where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'suspended', jsonb_build_object('reason', v_reason));
  perform private.write_audit('listing.suspended', p_org, 'business_listing', p_org::text, '{}'::jsonb);
  perform private.notify_org(p_org, 'listing:publish', 'listing.suspended', 'listing', p_org::text);
end;
$$;

create function public.reinstate_listing(p_org uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  l public.business_listings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('listing:review') then perform private.raise_error('forbidden'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into l from public.business_listings where org_id = p_org for update;
  if l.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if l.live_status <> 'suspended' then perform private.raise_error('conflict', 'listing_not_live'); end if;
  update public.business_listings set live_status = 'published', suspended_reason = null, updated_at = now() where org_id = p_org;
  perform private.add_listing_event(p_org, v_user, 'reinstated', jsonb_build_object('reason', v_reason));
  perform private.write_audit('listing.reinstated', p_org, 'business_listing', p_org::text, '{}'::jsonb);
  perform private.notify_org(p_org, 'listing:publish', 'listing.reinstated', 'listing', p_org::text);
end;
$$;

------------------------------------------------------------------------------------------------
-- Public reads (anonymous allowed). Only approved, published listings of active organisations.
------------------------------------------------------------------------------------------------
create function private.listing_json(p_org uuid, p_detail boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.business_listings;
  c public.business_categories;
  v jsonb;
begin
  select * into l from public.business_listings where org_id = p_org;
  select * into c from public.business_categories where id = l.live_category_id;
  v := jsonb_build_object(
    'slug', l.slug, 'name', l.live_name,
    'category', jsonb_build_object('slug', c.slug, 'name_en', c.name_en, 'name_ta', c.name_ta),
    'state', l.live_state, 'district', l.live_district, 'headline', l.live_headline,
    'accepting_requests', l.accepting_requests, 'published_at', l.published_at,
    'services', coalesce((select jsonb_agg(s.name order by s.sort) from public.business_services s where s.org_id = p_org), '[]'::jsonb),
    'serves_nationwide', exists (select 1 from public.business_services s where s.org_id = p_org and s.nationwide),
    'serves_states', coalesce((select jsonb_agg(distinct a order by a) from public.business_services s, unnest(s.areas) a where s.org_id = p_org), '[]'::jsonb),
    'reviewed', coalesce((select jsonb_agg(jsonb_build_object('claim_type', vc.claim_type, 'decided_at', vc.decided_at) order by vc.claim_type)
                          from public.verification_claims vc where vc.org_id = p_org and vc.status = 'approved'), '[]'::jsonb));
  if not p_detail then
    return v || jsonb_build_object('summary', left(l.live_description, 200));
  end if;
  return v || jsonb_build_object(
    'description', l.live_description,
    'phone', case when l.live_show_phone then l.live_phone end,
    'email', case when l.live_show_email then l.live_email end,
    'service_details', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'description', s.description,
        'category_slug', sc.slug, 'nationwide', s.nationwide, 'areas', s.areas, 'min_order_qty', s.min_order_qty,
        'min_order_unit', s.min_order_unit, 'lead_time_days', s.lead_time_days, 'capacity_note', s.capacity_note) order by s.sort)
      from public.business_services s join public.business_categories sc on sc.id = s.category_id where s.org_id = p_org), '[]'::jsonb),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'description', p.description) order by p.sort)
      from public.business_portfolio p where p.org_id = p_org), '[]'::jsonb));
end;
$$;

create function public.search_listings(p_q text default null, p_category text default null, p_state text default null,
  p_limit integer default 12, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := private.clean_text(p_q, 0, 80, 'invalid_query');
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000);
  v_pat text;
  v_total integer;
  v_items jsonb;
begin
  if p_category is not null and p_category !~ '^[a-z0-9-]{2,40}$' then perform private.raise_error('invalid', 'invalid_category'); end if;
  if p_state is not null and not private.valid_state(p_state) then perform private.raise_error('invalid', 'invalid_state'); end if;
  v_pat := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with base as (
    select l.org_id, l.published_at, (v_q is not null and l.live_name ilike v_pat) as name_hit
    from public.business_listings l
    join public.organisations o on o.id = l.org_id and o.status = 'active'
    left join public.business_categories c on c.id = l.live_category_id
    where l.live_status = 'published'
      and (p_category is null or c.slug = p_category
           or exists (select 1 from public.business_services s join public.business_categories sc on sc.id = s.category_id
                      where s.org_id = l.org_id and sc.slug = p_category))
      and (p_state is null or l.live_state = p_state
           or exists (select 1 from public.business_services s where s.org_id = l.org_id and (s.nationwide or p_state = any (s.areas))))
      and (v_q is null or l.live_name ilike v_pat or l.live_headline ilike v_pat or l.live_description ilike v_pat
           or exists (select 1 from public.business_services s where s.org_id = l.org_id and (s.name ilike v_pat or s.description ilike v_pat)))
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(private.listing_json(x.org_id, false) order by x.rn)
                   from (select b.org_id, row_number() over (order by b.name_hit desc, b.published_at desc, b.org_id) rn from base b) x
                   where x.rn > v_off and x.rn <= v_off + v_limit), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_off, 'items', v_items,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name_en', c.name_en, 'name_ta', c.name_ta) order by c.sort), '[]'::jsonb)
                   from public.business_categories c where c.active));
end;
$$;

create function public.get_listing(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,80}$' then perform private.raise_error('not_found'); end if;
  select l.org_id into v_org
  from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
  where l.slug = p_slug and l.live_status = 'published';
  if v_org is null then perform private.raise_error('not_found'); end if;
  return private.listing_json(v_org, true);
end;
$$;

------------------------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------------------------
revoke all on function
  private.clean_listing_draft(jsonb, jsonb), private.assert_listing_complete(jsonb), private.add_listing_event(uuid, uuid, text, jsonb),
  private.make_slug(text), private.apply_draft(uuid, uuid), private.listing_json(uuid, boolean),
  public.save_listing_draft(uuid, jsonb, integer), public.submit_listing(uuid, integer), public.withdraw_listing_submission(uuid),
  public.unpublish_listing(uuid), public.republish_listing(uuid), public.set_accepting_requests(uuid, boolean),
  public.review_listing(uuid, text, text, integer), public.suspend_listing(uuid, text), public.reinstate_listing(uuid, text),
  public.search_listings(text, text, text, integer, integer), public.get_listing(text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.save_listing_draft(uuid, jsonb, integer), public.submit_listing(uuid, integer), public.withdraw_listing_submission(uuid),
  public.unpublish_listing(uuid), public.republish_listing(uuid), public.set_accepting_requests(uuid, boolean),
  public.review_listing(uuid, text, text, integer), public.suspend_listing(uuid, text), public.reinstate_listing(uuid, text)
  to authenticated;

grant execute on function public.search_listings(text, text, text, integer, integer), public.get_listing(text) to anon, authenticated;
