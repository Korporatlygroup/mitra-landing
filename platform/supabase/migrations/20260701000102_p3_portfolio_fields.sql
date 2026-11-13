-- Phase 3.1: richer portfolio entries (text only): optional category and optional project date.
-- Images are NOT part of this migration: a public image bucket needs a working malware scanner and content checks first (see phase3-report).
alter table public.business_portfolio
  add column category_id uuid references public.business_categories (id),
  add column project_date date;

create or replace function private.clean_listing_draft(p_cur jsonb, p_new jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pcat text;
  v_pdate text;
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
      v_pcat := nullif(btrim(coalesce(item ->> 'category_slug', '')), '');
      if v_pcat is not null and not exists (select 1 from public.business_categories bc where bc.slug = v_pcat and bc.active) then
        perform private.raise_error('invalid', 'invalid_category');
      end if;
      v_pdate := nullif(btrim(coalesce(item ->> 'project_date', '')), '');
      if v_pdate is not null then
        if v_pdate !~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$' then perform private.raise_error('invalid', 'invalid_date'); end if;
        if length(v_pdate) = 7 then v_pdate := v_pdate || '-01'; end if;
        begin
          if v_pdate::date > current_date then perform private.raise_error('invalid', 'invalid_date'); end if;
        exception when invalid_datetime_format or datetime_field_overflow then
          perform private.raise_error('invalid', 'invalid_date');
        end;
      end if;
      out_arr := out_arr || jsonb_build_array(jsonb_build_object(
        'title', v_name, 'description', private.clean_text(item ->> 'description', 1, 600, 'invalid_description'),
        'category_slug', v_pcat, 'project_date', v_pdate));
    end loop;
    v := v || jsonb_build_object('portfolio', out_arr);
  end if;
  -- Contact details the owner did not choose to publish are not kept at all (reviewers can read drafts).
  if not coalesce((v ->> 'show_phone')::boolean, false) then v := v || jsonb_build_object('public_phone', null); end if;
  if not coalesce((v ->> 'show_email')::boolean, false) then v := v || jsonb_build_object('public_email', null); end if;
  return v;
end;
$$;

create or replace function private.apply_draft(p_org uuid, p_actor uuid)
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
  insert into public.business_portfolio (org_id, title, description, category_id, project_date, sort)
  select p_org, s.value ->> 'title', s.value ->> 'description',
    (select bc.id from public.business_categories bc where bc.slug = s.value ->> 'category_slug'),
    (s.value ->> 'project_date')::date, (s.ordinality)::integer
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

create or replace function private.listing_json(p_org uuid, p_detail boolean)
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
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'description', p.description,
        'category_slug', pc.slug, 'project_date', p.project_date) order by p.sort)
      from public.business_portfolio p left join public.business_categories pc on pc.id = p.category_id
      where p.org_id = p_org), '[]'::jsonb));
end;
$$;
