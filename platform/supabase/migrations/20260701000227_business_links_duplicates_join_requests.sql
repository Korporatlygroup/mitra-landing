-- Business profile completion: public contact links, duplicate-business flags for review, and requests to join an existing business.
-- Additive only: two new defaulted columns, new tables and functions, and three existing functions re-declared (create or replace)
-- with the links/hours additions. No data is rewritten, dropped or merged. Images are still NOT part of this (a public image bucket needs
-- a working malware scanner first; see the phase 3 report).

-- 1. Public links and hours. The draft (jsonb) is what the owner edits; the live columns are the reviewed public snapshot.
alter table public.business_listings
  add column live_links jsonb not null default '{}'::jsonb check (jsonb_typeof(live_links) = 'object'),
  add column live_hours text check (char_length(live_hours) <= 300);

-- Allowed destinations per link kind. Anything else is refused.
create function private.link_host_ok(p_kind text, p_host text, p_rest text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'website' then p_host !~ '\.(local|internal|test|localhost|invalid|example)$' and p_host !~ '^(localhost|[0-9.]+)$'
    when 'facebook' then p_host ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$'
    when 'instagram' then p_host ~ '(^|\.)instagram\.com$'
    when 'tiktok' then p_host ~ '(^|\.)tiktok\.com$'
    when 'linkedin' then p_host ~ '(^|\.)linkedin\.com$'
    when 'youtube' then p_host ~ '(^|\.)(youtube\.com|youtu\.be)$'
    when 'google_maps' then p_host ~ '^(maps\.app\.goo\.gl|g\.page)$'
      or (p_host ~ '(^|\.)google\.com(\.my)?$' and (p_host ~ '^maps\.' or coalesce(p_rest, '') ~* '^/maps'))
      or (p_host = 'goo.gl' and coalesce(p_rest, '') ~* '^/maps')
    else false
  end
$$;

-- Validates and normalises the links object. https only, no credentials, no scripts, bounded length; unknown keys are refused.
create function private.clean_listing_links(p_links jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
  raw text;
  u text;
  m text[];
  v_host text;
  v_digits text;
begin
  if p_links is null or jsonb_typeof(p_links) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(p_links) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  for k in select jsonb_object_keys(p_links) loop
    if k not in ('whatsapp', 'website', 'facebook', 'instagram', 'tiktok', 'linkedin', 'youtube', 'google_maps') then
      perform private.raise_error('invalid', 'invalid_data');
    end if;
    if jsonb_typeof(p_links -> k) not in ('string', 'null') then perform private.raise_error('invalid', 'invalid_data'); end if;
    raw := nullif(btrim(coalesce(p_links ->> k, '')), '');
    continue when raw is null;
    if k = 'whatsapp' then
      if raw !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_whatsapp'); end if;
      v_digits := regexp_replace(raw, '[^0-9]', '', 'g');
      if left(raw, 1) <> '+' and left(v_digits, 1) = '0' then v_digits := '60' || substr(v_digits, 2); end if;
      if char_length(v_digits) < 8 or char_length(v_digits) > 15 then perform private.raise_error('invalid', 'invalid_whatsapp'); end if;
      v := v || jsonb_build_object(k, '+' || v_digits);
    else
      u := raw;
      if char_length(u) > 300 or u ~ '[\s<>"''`\\[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_url'); end if;
      if u ~* '^[a-z][a-z0-9+.-]*:' and u !~* '^https?://' then perform private.raise_error('invalid', 'invalid_url'); end if;
      if u !~* '^https?://' then u := 'https://' || u; end if;
      u := regexp_replace(u, '^http://', 'https://', 'i');
      m := regexp_match(u, '^https://([^/?#:@]+)(?::443)?([/?#].*)?$', 'i');
      if m is null then perform private.raise_error('invalid', 'invalid_url'); end if;
      v_host := lower(m[1]);
      if v_host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' or v_host !~ '\.[a-z]{2,}$' or char_length(v_host) > 120 then
        perform private.raise_error('invalid', 'invalid_url');
      end if;
      if not private.link_host_ok(k, v_host, m[2]) then perform private.raise_error('invalid', 'invalid_url_domain'); end if;
      v := v || jsonb_build_object(k, 'https://' || v_host || coalesce(m[2], ''));
    end if;
  end loop;
  return v;
end;
$$;

-- 2. Duplicate-business flags. Detection never blocks a registration and never merges anything: it records a pair for a reviewer.
create function private.norm_ssm(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g')), '') $$;

-- Lower-case, '&' as 'and', punctuation removed and the legal-form words (sdn bhd, enterprise, plt, llp ...) dropped.
-- Very short results are ignored so that names like "ABC" do not match everything.
create function private.norm_business_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(n) >= 4 then n end
  from (select btrim(regexp_replace(regexp_replace(regexp_replace(
    replace(lower(coalesce(p, '')), '&', ' and '), '[^a-z0-9 ]', ' ', 'g'),
    '\m(sdn|bhd|berhad|enterprise|enterprises|plt|llp|ltd)\M', ' ', 'g'), '\s+', ' ', 'g')) as n) s
$$;

create index business_profiles_norm_ssm on public.business_profiles (private.norm_ssm(ssm_number)) where ssm_number is not null;
create index business_profiles_norm_name on public.business_profiles (private.norm_business_name(business_name));

create table private.business_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  other_org_id uuid not null references public.organisations (id) on delete cascade,
  reason text not null check (reason in ('ssm', 'name')),
  status text not null default 'open' check (status in ('open', 'dismissed', 'confirmed')),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  check (org_id < other_org_id),
  unique (org_id, other_org_id, reason)
);
alter table private.business_duplicate_flags enable row level security;
create index business_duplicate_flags_open on private.business_duplicate_flags (created_at) where status = 'open';

create function private.flag_duplicate_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ssm text := private.norm_ssm(new.ssm_number);
  v_name text := private.norm_business_name(new.business_name);
  v_added integer := 0;
  v_n integer;
begin
  if v_ssm is not null then
    insert into private.business_duplicate_flags (org_id, other_org_id, reason)
    select least(new.org_id, o.org_id), greatest(new.org_id, o.org_id), 'ssm'
      from public.business_profiles o
     where o.org_id <> new.org_id and private.norm_ssm(o.ssm_number) = v_ssm
    on conflict (org_id, other_org_id, reason) do nothing;
    get diagnostics v_n = row_count; v_added := v_added + v_n;
  end if;
  if v_name is not null then
    insert into private.business_duplicate_flags (org_id, other_org_id, reason)
    select least(new.org_id, o.org_id), greatest(new.org_id, o.org_id), 'name'
      from public.business_profiles o
     where o.org_id <> new.org_id and private.norm_business_name(o.business_name) = v_name
    on conflict (org_id, other_org_id, reason) do nothing;
    get diagnostics v_n = row_count; v_added := v_added + v_n;
  end if;
  if v_added > 0 then
    perform private.notify_platform('verification:review', 'duplicate.flagged', 'organisation', new.org_id::text);
  end if;
  return new;
end;
$$;
create trigger business_profiles_flag_duplicates after insert or update of ssm_number, business_name on public.business_profiles
  for each row execute function private.flag_duplicate_business();
revoke all on function private.flag_duplicate_business(), private.norm_ssm(text), private.norm_business_name(text),
  private.link_host_ok(text, text, text), private.clean_listing_links(jsonb) from public, anon, authenticated;


-- 3. Draft validation, publication and public read: three existing functions, re-declared with the links/hours additions only.
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
    if k not in ('headline', 'description', 'show_phone', 'show_email', 'public_phone', 'public_email', 'services', 'portfolio', 'links', 'hours') then
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
  if p_new ? 'links' then v := v || jsonb_build_object('links', private.clean_listing_links(p_new -> 'links')); end if;
  if p_new ? 'hours' then v := v || jsonb_build_object('hours', private.clean_text(p_new ->> 'hours', 1, 300, 'invalid_hours')); end if;
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
    live_links = coalesce(l.draft -> 'links', '{}'::jsonb),
    live_hours = l.draft ->> 'hours',
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
    'links', l.live_links, 'hours', l.live_hours,
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


-- 4. Reviewer access to the flags (read, and record a decision; nothing is merged or deleted).
create function public.list_duplicate_flags(p_status text default 'open')
returns table (id uuid, status text, reason text, created_at timestamptz, org_id uuid, org_name text, other_org_id uuid, other_org_name text, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:review') then perform private.raise_error('forbidden'); end if;
  if p_status not in ('open', 'dismissed', 'confirmed') then perform private.raise_error('invalid', 'invalid_data'); end if;
  return query
    select f.id, f.status, f.reason, f.created_at, f.org_id, a.business_name, f.other_org_id, b.business_name, f.note
      from private.business_duplicate_flags f
      join public.business_profiles a on a.org_id = f.org_id
      join public.business_profiles b on b.org_id = f.other_org_id
     where f.status = p_status
     order by f.created_at desc
     limit 100;
end;
$$;

create function public.resolve_duplicate_flag(p_flag uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  f private.business_duplicate_flags;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:review') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('dismiss', 'confirm') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  if char_length(v_note) < 5 or char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  select * into f from private.business_duplicate_flags where id = p_flag for update;
  if f.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(f.org_id, v_user) or private.has_org_involvement(f.other_org_id, v_user) then
    perform private.raise_error('forbidden', 'conflict_of_interest');
  end if;
  if f.status <> 'open' then perform private.raise_error('conflict', 'already_decided'); end if;
  update private.business_duplicate_flags
     set status = case p_decision when 'dismiss' then 'dismissed' else 'confirmed' end, note = v_note, decided_by = v_user, decided_at = now()
   where id = p_flag;
  perform private.write_audit('duplicate.' || p_decision, f.org_id, 'duplicate_flag', p_flag::text, jsonb_build_object('other_org', f.other_org_id, 'reason', f.reason));
end;
$$;

-- What a registrant may be told: only businesses that are already PUBLISHED (public information) and match their SSM number or name.
create function public.find_published_duplicates(p_ssm text, p_name text)
returns table (slug text, name text, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ssm text := private.norm_ssm(p_ssm);
  v_name text := private.norm_business_name(p_name);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  return query
    select l.slug, l.live_name, case when v_ssm is not null and private.norm_ssm(bp.ssm_number) = v_ssm then 'ssm' else 'name' end
      from public.business_listings l
      join public.business_profiles bp on bp.org_id = l.org_id
      join public.organisations o on o.id = l.org_id and o.status = 'active'
     where l.live_status = 'published'
       and ((v_ssm is not null and private.norm_ssm(bp.ssm_number) = v_ssm)
         or (v_name is not null and private.norm_business_name(bp.business_name) = v_name))
       and not exists (select 1 from public.memberships m where m.org_id = l.org_id and m.user_id = auth.uid() and m.status = 'active')
     limit 5;
end;
$$;

-- 5. Request to join an existing business. The owner side decides and uses the existing invitation flow; no membership is created here.
create table public.org_join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  requester_email text not null check (char_length(requester_email) <= 254),
  message text check (char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'invited', 'declined')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
alter table public.org_join_requests enable row level security;
create unique index org_join_requests_one_pending on public.org_join_requests (org_id, user_id) where status = 'pending';
create index org_join_requests_org on public.org_join_requests (org_id, status);
-- Read-only for the person who asked and for those who may invite members; every write goes through the functions below.
create policy org_join_requests_select on public.org_join_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.has_permission(org_id, 'member:invite'));

create function public.request_org_membership(p_slug text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_email text;
  v_id uuid;
  v_msg text := private.clean_text(p_message, 1, 500, 'invalid_message');
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('joinreq:' || v_user, 5, interval '1 day');
  select l.org_id into v_org from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
   where l.slug = p_slug and l.live_status = 'published';
  if v_org is null then perform private.raise_error('not_found'); end if;
  if exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = v_user and m.status = 'active') then
    perform private.raise_error('conflict', 'already_member');
  end if;
  if exists (select 1 from public.org_join_requests r where r.org_id = v_org and r.user_id = v_user and r.status = 'pending') then
    perform private.raise_error('conflict', 'request_pending');
  end if;
  select u.email into v_email from auth.users u where u.id = v_user and u.email_confirmed_at is not null;
  if v_email is null then perform private.raise_error('forbidden', 'email_unverified'); end if;
  insert into public.org_join_requests (org_id, user_id, requester_email, message) values (v_org, v_user, v_email, v_msg) returning id into v_id;
  perform private.notify_org(v_org, 'member:invite', 'join.requested', 'org_join_request', v_id::text);
  perform private.write_audit('org.join_requested', v_org, 'org_join_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.list_join_requests(p_org uuid)
returns table (id uuid, requester_name text, requester_email text, message text, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'member:invite') then perform private.raise_error('forbidden'); end if;
  return query
    select r.id, coalesce(nullif(p.display_name, ''), '-'), r.requester_email, r.message, r.status, r.created_at
      from public.org_join_requests r left join public.profiles p on p.id = r.user_id
     where r.org_id = p_org
     order by (r.status = 'pending') desc, r.created_at desc
     limit 50;
end;
$$;

create function public.resolve_join_request(p_request uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.org_join_requests;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if p_decision not in ('invited', 'declined') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  select * into r from public.org_join_requests where id = p_request for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if not private.has_permission(r.org_id, 'member:invite') then perform private.raise_error('forbidden'); end if;
  if r.status <> 'pending' then perform private.raise_error('conflict', 'already_decided'); end if;
  update public.org_join_requests set status = p_decision, decided_by = auth.uid(), decided_at = now() where id = p_request;
  perform private.write_audit('org.join_' || p_decision, r.org_id, 'org_join_request', p_request::text, '{}'::jsonb);
end;
$$;

revoke all on function public.list_duplicate_flags(text), public.resolve_duplicate_flag(uuid, text, text), public.find_published_duplicates(text, text),
  public.request_org_membership(text, text), public.list_join_requests(uuid), public.resolve_join_request(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_duplicate_flags(text), public.resolve_duplicate_flag(uuid, text, text), public.find_published_duplicates(text, text),
  public.request_org_membership(text, text), public.list_join_requests(uuid), public.resolve_join_request(uuid, text) to authenticated;
revoke all on public.org_join_requests from public, anon, authenticated;
grant select on public.org_join_requests to authenticated;
