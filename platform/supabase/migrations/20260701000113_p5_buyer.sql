-- Phase 5 (4/5): public search and detail, comparison, saved products, sourcing requests, product reports.
-- A product is visible to buyers and the public only while: products.status = 'published' AND the supplier is
-- 'approved' AND the partner profile is 'approved' AND the partner organisation is active (private.visible_product_ids).
-- Hidden or unpublished resources are 404. Nothing here converts currencies.

create table public.saved_products (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name_snapshot text not null,
  supplier_name_snapshot text,
  saved_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table public.sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^SR-[A-Z0-9]{8}$'),
  buyer_org_id uuid not null references public.organisations (id) on delete cascade,
  partner_org_id uuid references public.organisations (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  supplier_name text not null,
  status text not null default 'submitted' check (status in ('submitted', 'acknowledged', 'clarification_requested', 'closed', 'withdrawn')),
  destination_state text not null,
  destination_city text check (char_length(destination_city) <= 80),
  needed_by date,
  notes text check (char_length(notes) <= 2000),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  payload_hash text not null,
  created_by uuid references auth.users (id) on delete set null,
  first_response_at timestamptz,
  closed_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_org_id, idempotency_key)
);
create index sourcing_requests_buyer on public.sourcing_requests (buyer_org_id, created_at desc);
create index sourcing_requests_partner on public.sourcing_requests (partner_org_id, status, created_at desc);

create table public.sourcing_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests (id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.catalogue_variants (id) on delete set null,
  snapshot jsonb not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null,
  unique (request_id, line_no)
);

-- Append-only. Rows are deleted only together with their request (organisation erasure cascade).
create table public.sourcing_request_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  request_id uuid not null references public.sourcing_requests (id) on delete cascade,
  actor_user_id uuid,
  kind text not null check (kind in ('submitted', 'acknowledged', 'clarification_requested', 'buyer_replied', 'closed', 'withdrawn')),
  note text check (char_length(note) <= 2000)
);
create index sourcing_request_events_request on public.sourcing_request_events (request_id, id);

create function private.sourcing_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.sourcing_requests r where r.id = old.request_id) then
    return old;
  end if;
  raise exception 'sourcing_request_events is append-only' using errcode = '42501';
end;
$$;
create trigger sourcing_events_no_update_delete before update or delete on public.sourcing_request_events
  for each row execute function private.sourcing_events_immutable();
create trigger sourcing_events_no_truncate before truncate on public.sourcing_request_events
  for each statement execute function private.sourcing_events_immutable();

create table public.product_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  reason text not null check (reason in ('misleading', 'counterfeit', 'prohibited', 'wrong_price', 'offensive', 'spam', 'other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  handler_note text check (char_length(handler_note) <= 1000),
  created_at timestamptz not null default now()
);
create unique index product_reports_one_open on public.product_reports (reporter, product_id) where status = 'open' and reporter is not null;
create index product_reports_queue on public.product_reports (status, created_at);

------------------------------------------------------------------------------------------------
-- Visibility
------------------------------------------------------------------------------------------------
create function private.product_visible(p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    join public.suppliers s on s.id = p.supplier_id and s.status = 'approved'
    join public.partner_profiles pp on pp.org_id = p.partner_org_id and pp.status = 'approved'
    join public.organisations o on o.id = p.partner_org_id and o.status = 'active'
    join public.catalogue_items ci on ci.product_id = p.id
    where p.id = p_product and p.status = 'published'
  )
$$;

create function private.visible_product_ids()
returns table (product_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.products p
  join public.suppliers s on s.id = p.supplier_id and s.status = 'approved'
  join public.partner_profiles pp on pp.org_id = p.partner_org_id and pp.status = 'approved'
  join public.organisations o on o.id = p.partner_org_id and o.status = 'active'
  join public.catalogue_items ci on ci.product_id = p.id
  where p.status = 'published'
$$;

-- Public JSON for one live item. Never includes supplier contact details, evidence, the partner organisation or drafts.
create function private.catalogue_item_json(p_product uuid, p_detail boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ci public.catalogue_items;
  s public.suppliers;
  v jsonb;
begin
  select * into ci from public.catalogue_items x where x.product_id = p_product;
  select * into s from public.suppliers x where x.id = ci.supplier_id;
  v := jsonb_build_object(
    'id', ci.product_id, 'sku', ci.sku, 'name', ci.name, 'category_slug', ci.category_slug, 'unit', ci.unit, 'moq', ci.moq,
    'currency', ci.currency, 'price_mode', ci.price_mode,
    'from_price', case ci.price_mode when 'fixed' then ci.fixed_unit_price
                  when 'tiers' then (select min(t.unit_price) from public.catalogue_price_tiers t where t.product_id = ci.product_id) end,
    'price_confirmed_on', ci.price_confirmed_on, 'lead_time_min_days', ci.lead_time_min_days, 'lead_time_max_days', ci.lead_time_max_days,
    'availability_status', ci.availability_status, 'availability_confirmed_on', ci.availability_confirmed_on,
    'availability_outdated', ci.availability_confirmed_on < current_date - 90, 'published_at', ci.published_at,
    'summary', left(ci.description, 200),
    'image_id', (select m.id from public.product_media m where m.product_id = ci.product_id and m.approved and m.removed_at is null
                 and m.scan_status = 'clean' order by m.sort, m.created_at limit 1),
    'supplier', jsonb_build_object('id', s.id, 'name', s.live_name, 'country', s.live_country, 'state_city', s.live_state_city,
      'reviewed', jsonb_build_object('checks', s.review_checks, 'reviewed_at', s.reviewed_at)));
  if not p_detail then return v; end if;
  return v || jsonb_build_object(
    'description', ci.description, 'specs', ci.specs, 'packaging', ci.packaging,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'sku', x.sku, 'label', x.label, 'attributes', x.attributes,
        'moq', coalesce(x.moq, ci.moq)) order by x.sort) from public.catalogue_variants x where x.product_id = ci.product_id), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('variant_sku', cv.sku, 'min_qty', t.min_qty, 'max_qty', t.max_qty,
        'unit_price', t.unit_price, 'currency', t.currency) order by cv.sku nulls first, t.min_qty)
        from public.catalogue_price_tiers t left join public.catalogue_variants cv on cv.id = t.variant_id
        where t.product_id = ci.product_id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'alt', m.alt) order by m.sort, m.created_at)
        from public.product_media m where m.product_id = ci.product_id and m.approved and m.removed_at is null and m.scan_status = 'clean'), '[]'::jsonb),
    'supplier_detail', jsonb_build_object('description', s.live_description, 'capabilities', s.live_capabilities,
      'main_category', s.live_main_category));
end;
$$;

create function public.search_catalogue(p_q text default null, p_category text default null, p_supplier uuid default null,
  p_moq_max numeric default null, p_price_min numeric default null, p_price_max numeric default null, p_currency text default null,
  p_offset integer default 0, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := private.clean_text(p_q, 0, 80, 'invalid_query');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_pat text;
  v_tsq tsquery;
  v_total integer;
  v_items jsonb;
begin
  if p_category is not null and p_category !~ '^[a-z0-9-]{2,40}$' then perform private.raise_error('invalid', 'invalid_category'); end if;
  if p_currency is not null and p_currency not in ('INR', 'MYR', 'USD') then perform private.raise_error('invalid', 'invalid_currency'); end if;
  if (p_price_min is not null or p_price_max is not null) and p_currency is null then perform private.raise_error('invalid', 'currency_required'); end if;
  if p_moq_max is not null and p_moq_max <= 0 then perform private.raise_error('invalid', 'invalid_moq'); end if;
  if p_price_min is not null and p_price_min < 0 or p_price_max is not null and p_price_max < 0 then perform private.raise_error('invalid', 'invalid_price'); end if;
  if v_q is not null then
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_tsq := websearch_to_tsquery('simple', v_q);
  end if;

  with base as (
    select ci.product_id, ci.published_at,
           case when v_q is null then 3 when lower(ci.sku) = lower(v_q) then 0 when ci.name ilike v_pat then 1
                when s.live_name ilike v_pat then 2 else 3 end as rnk
    from private.visible_product_ids() vp
    join public.catalogue_items ci on ci.product_id = vp.product_id
    join public.suppliers s on s.id = ci.supplier_id
    left join lateral (
      select case ci.price_mode when 'fixed' then ci.fixed_unit_price
                  when 'tiers' then (select min(t.unit_price) from public.catalogue_price_tiers t where t.product_id = ci.product_id) end as from_price
    ) fp on true
    where (p_category is null or ci.category_slug = p_category)
      and (p_supplier is null or ci.supplier_id = p_supplier)
      and (p_moq_max is null or ci.moq <= p_moq_max)
      and (p_currency is null or ci.currency = p_currency)
      and (p_price_min is null or fp.from_price >= p_price_min)
      and (p_price_max is null or fp.from_price <= p_price_max)
      and (v_q is null or ci.name ilike v_pat or ci.sku ilike v_pat or ci.description ilike v_pat or s.live_name ilike v_pat
           or ci.search @@ v_tsq)
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(private.catalogue_item_json(x.product_id, false) order by x.rn)
                   from (select b.product_id, row_number() over (order by b.rnk, b.published_at desc, b.product_id) rn from base b) x
                   where x.rn > v_off and x.rn <= v_off + v_limit), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_off, 'items', v_items,
    'categories', (select coalesce(jsonb_agg(c.slug order by c.sort), '[]'::jsonb) from public.product_categories c where c.active));
end;
$$;

create function public.get_catalogue_item(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null or not private.product_visible(p_id) then perform private.raise_error('not_found'); end if;
  return private.catalogue_item_json(p_id, true);
end;
$$;

create function public.compare_items(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_ids, array[]::uuid[]);
begin
  if cardinality(v_ids) > 4 then perform private.raise_error('invalid', 'too_many_items'); end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(private.catalogue_item_json(x.id, true) order by x.ord)
                       from unnest(v_ids) with ordinality x (id, ord) where private.product_visible(x.id)), '[]'::jsonb),
    'unavailable', coalesce((select jsonb_agg(x.id order by x.ord) from unnest(v_ids) with ordinality x (id, ord)
                             where not private.product_visible(x.id)), '[]'::jsonb));
end;
$$;

-- Where the server may read an image from. Public only for approved, clean images of a visible product.
-- Members of the owning partner and catalogue reviewers may also open clean images that are not yet public.
create function public.get_product_media_access(p_media uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.product_media;
  v_ok boolean := false;
begin
  select * into m from public.product_media x where x.id = p_media;
  if m.id is null or m.removed_at is not null or m.scan_status <> 'clean' then perform private.raise_error('not_found'); end if;
  if m.approved and private.product_visible(m.product_id) then
    v_ok := true;
  elsif auth.uid() is not null and private.is_member(m.partner_org_id) then
    v_ok := true;
  elsif auth.uid() is not null and private.has_platform_permission('catalogue:review')
        and exists (select 1 from public.products p where p.id = m.product_id and p.status <> 'draft') then
    v_ok := true;
  end if;
  if not v_ok then perform private.raise_error('not_found'); end if;
  return jsonb_build_object('storage_path', m.storage_path, 'mime_type', m.mime_type);
end;
$$;

------------------------------------------------------------------------------------------------
-- Saved products (a saved product that is no longer on sale stays in the list and says so)
------------------------------------------------------------------------------------------------
create function public.save_product(p_product uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  ci public.catalogue_items;
  v_n integer;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('saveprod:' || v_user, 200, interval '1 hour');
  if p_product is null or not private.product_visible(p_product) then perform private.raise_error('not_found'); end if;
  if (select count(*) from public.saved_products x where x.user_id = v_user) >= 200
     and not exists (select 1 from public.saved_products x where x.user_id = v_user and x.product_id = p_product) then
    perform private.raise_error('conflict', 'saved_limit_reached');
  end if;
  select * into ci from public.catalogue_items x where x.product_id = p_product;
  insert into public.saved_products (user_id, product_id, name_snapshot, supplier_name_snapshot)
  values (v_user, p_product, ci.name, (select s.live_name from public.suppliers s where s.id = ci.supplier_id))
  on conflict (user_id, product_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('product_id', p_product, 'saved', true, 'created', v_n = 1);
end;
$$;

create function public.unsave_product(p_product uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  delete from public.saved_products where user_id = auth.uid() and product_id = p_product;
end;
$$;

create function public.list_saved_products(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.saved_products x where x.user_id = auth.uid()),
    'items', coalesce((
      select jsonb_agg(case when private.product_visible(x.product_id)
                            then jsonb_build_object('product_id', x.product_id, 'saved_at', x.saved_at, 'available', true,
                                                    'item', private.catalogue_item_json(x.product_id, false))
                            else jsonb_build_object('product_id', x.product_id, 'saved_at', x.saved_at, 'available', false,
                                                    'name', x.name_snapshot, 'supplier_name', x.supplier_name_snapshot) end
                       order by x.saved_at desc, x.product_id)
      from (select s.product_id, s.saved_at, s.name_snapshot, s.supplier_name_snapshot from public.saved_products s
            where s.user_id = auth.uid() order by s.saved_at desc, s.product_id limit 24 offset v_off) x), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------------------------
-- Sourcing requests
------------------------------------------------------------------------------------------------
create function private.new_sourcing_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_out text := '';
  i integer;
begin
  for i in 0..7 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return 'SR-' || v_out;
end;
$$;

-- The terms exactly as the buyer saw them. Later edits to the product never change a stored snapshot.
create function private.sourcing_snapshot(p_product uuid, p_variant_sku text, p_qty numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ci public.catalogue_items;
  v public.catalogue_variants;
  s public.suppliers;
  v_tiers jsonb;
  v_price numeric;
  v_moq numeric;
  v_vid uuid;
begin
  select * into ci from public.catalogue_items x where x.product_id = p_product;
  select * into s from public.suppliers x where x.id = ci.supplier_id;
  if p_variant_sku is not null then
    select * into v from public.catalogue_variants x where x.product_id = p_product and lower(x.sku) = lower(p_variant_sku);
    if v.id is null then perform private.raise_error('invalid', 'invalid_variant'); end if;
  end if;
  v_moq := coalesce(v.moq, ci.moq);
  if p_qty < v_moq then perform private.raise_error('invalid', 'below_moq'); end if;
  if ci.price_mode = 'tiers' then
    v_vid := v.id;
    if v_vid is not null and not exists (select 1 from public.catalogue_price_tiers t where t.product_id = p_product and t.variant_id = v_vid) then
      v_vid := null;
    end if;
    select jsonb_agg(jsonb_build_object('min_qty', t.min_qty, 'max_qty', t.max_qty, 'unit_price', t.unit_price) order by t.min_qty),
           max(t.unit_price) filter (where t.min_qty <= p_qty and (t.max_qty is null or p_qty <= t.max_qty))
      into v_tiers, v_price
    from public.catalogue_price_tiers t where t.product_id = p_product and t.variant_id is not distinct from v_vid;
  elsif ci.price_mode = 'fixed' then
    v_price := ci.fixed_unit_price;
  end if;
  return jsonb_build_object('name', ci.name, 'sku', ci.sku, 'unit', ci.unit, 'moq', v_moq, 'currency', ci.currency,
    'price_mode', ci.price_mode, 'fixed_unit_price', ci.fixed_unit_price, 'tiers', coalesce(v_tiers, '[]'::jsonb),
    'applicable_unit_price', v_price, 'price_confirmed_on', ci.price_confirmed_on,
    'availability_status', ci.availability_status, 'availability_confirmed_on', ci.availability_confirmed_on,
    'lead_time_min_days', ci.lead_time_min_days, 'lead_time_max_days', ci.lead_time_max_days,
    'variant', case when v.id is not null then jsonb_build_object('sku', v.sku, 'label', v.label, 'attributes', v.attributes) end,
    'revision_id', ci.revision_id, 'supplier_name', s.live_name, 'captured_at', now());
end;
$$;

create function public.submit_sourcing_request(p_buyer_org uuid, p_key text, p_items jsonb, p_destination_state text,
  p_destination_city text, p_needed_by date, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_type public.org_type;
  v_city text := private.clean_text(p_destination_city, 1, 80, 'invalid_district');
  v_notes text := private.clean_text(p_notes, 1, 2000, 'invalid_notes');
  v_hash text;
  r public.sourcing_requests;
  el jsonb;
  v_n integer;
  v_pid uuid;
  v_first uuid;
  v_sup uuid;
  sp public.suppliers;
  v_qty text;
  v_lines jsonb := '[]'::jsonb;
  v_snap jsonb;
  v_ref text;
  v_try integer := 0;
  v_new boolean := false;
  v_id uuid;
  v_seen text[] := array[]::text[];
  v_key text;
  v_vsku text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_buyer_org, 'request:post') then perform private.raise_error('forbidden'); end if;
  select o.type into v_type from public.organisations o where o.id = p_buyer_org;
  if v_type not in ('buyer', 'business') then perform private.raise_error('invalid', 'invalid_org_type'); end if;
  perform private.require_consent();
  if p_key is null or char_length(p_key) not between 8 and 80 then perform private.raise_error('invalid', 'invalid_data'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 then perform private.raise_error('invalid', 'items_required'); end if;
  if v_n > 20 then perform private.raise_error('invalid', 'too_many_items'); end if;
  if p_destination_state is null or not private.valid_state(p_destination_state) then perform private.raise_error('invalid', 'invalid_state'); end if;
  if p_needed_by is not null and (p_needed_by < current_date or p_needed_by > current_date + 730) then perform private.raise_error('invalid', 'invalid_date'); end if;
  v_hash := encode(extensions.digest(jsonb_build_object('i', p_items, 's', p_destination_state, 'c', v_city, 'd', p_needed_by, 'n', v_notes)::text, 'sha256'), 'hex');

  select * into r from public.sourcing_requests x where x.buyer_org_id = p_buyer_org and x.idempotency_key = p_key;
  if r.id is not null then
    if r.payload_hash <> v_hash then perform private.raise_error('conflict', 'idempotency_key_reused'); end if;
    return jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'created', false);
  end if;
  perform private.check_rate_limit('srcreq:' || v_user, 40, interval '1 day');

  -- Resolve every line. The first product decides the supplier; all lines must share it (supplier row locked first).
  for el in select jsonb_array_elements(p_items) loop
    if jsonb_typeof(el) <> 'object' or exists (select 1 from jsonb_object_keys(el) kk where kk not in ('product_id', 'variant_sku', 'quantity')) then
      perform private.raise_error('invalid', 'invalid_data');
    end if;
    begin
      v_pid := (el ->> 'product_id')::uuid;
    exception when others then
      perform private.raise_error('invalid', 'invalid_data');
    end;
    v_qty := el ->> 'quantity';
    if v_qty is null or v_qty !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' or private.safe_numeric(v_qty) <= 0 then perform private.raise_error('invalid', 'invalid_quantity'); end if;
    v_vsku := nullif(btrim(coalesce(el ->> 'variant_sku', '')), '');
    v_key := v_pid::text || '|' || coalesce(lower(v_vsku), '');
    if v_key = any (v_seen) then perform private.raise_error('invalid', 'duplicate_item'); end if;
    v_seen := v_seen || v_key;
    if v_first is null then
      v_first := v_pid;
      select p.supplier_id into v_sup from public.products p where p.id = v_pid and p.status = 'published';
      if v_sup is null then perform private.raise_error('not_found'); end if;
      select * into sp from public.suppliers x where x.id = v_sup for share;
    end if;
    if not exists (select 1 from public.products p where p.id = v_pid and p.status = 'published' and p.supplier_id = v_sup) then
      if exists (select 1 from public.products p where p.id = v_pid and p.status = 'published') then
        perform private.raise_error('invalid', 'mixed_suppliers');
      end if;
      perform private.raise_error('not_found');
    end if;
    if not private.product_visible(v_pid) then perform private.raise_error('conflict', 'supplier_not_available'); end if;
    v_snap := private.sourcing_snapshot(v_pid, v_vsku, private.safe_numeric(v_qty));
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'variant_sku', v_vsku, 'quantity', private.safe_numeric(v_qty),
      'unit', v_snap ->> 'unit', 'snapshot', v_snap));
  end loop;

  loop
    v_try := v_try + 1;
    v_ref := private.new_sourcing_reference();
    insert into public.sourcing_requests (reference, buyer_org_id, partner_org_id, supplier_id, supplier_name, destination_state,
      destination_city, needed_by, notes, idempotency_key, payload_hash, created_by)
    values (v_ref, p_buyer_org, sp.partner_org_id, sp.id, sp.live_name, p_destination_state, v_city, p_needed_by, v_notes, p_key, v_hash, v_user)
    on conflict do nothing returning id into v_id;
    exit when v_id is not null or v_try >= 5;
    -- A conflict is either the idempotency key (a concurrent retry) or, very rarely, the reference.
    select * into r from public.sourcing_requests x where x.buyer_org_id = p_buyer_org and x.idempotency_key = p_key;
    if r.id is not null then
      if r.payload_hash <> v_hash then perform private.raise_error('conflict', 'idempotency_key_reused'); end if;
      return jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'created', false);
    end if;
  end loop;
  if v_id is null then perform private.raise_error('conflict', 'reference_unavailable'); end if;

  insert into public.sourcing_request_items (request_id, line_no, product_id, variant_id, snapshot, quantity, unit)
  select v_id, x.ord::integer, (x.l ->> 'product_id')::uuid,
         (select cv.id from public.catalogue_variants cv where cv.product_id = (x.l ->> 'product_id')::uuid and lower(cv.sku) = lower(x.l ->> 'variant_sku')),
         x.l -> 'snapshot', (x.l ->> 'quantity')::numeric, x.l ->> 'unit'
  from jsonb_array_elements(v_lines) with ordinality x (l, ord);
  insert into public.sourcing_request_events (request_id, actor_user_id, kind) values (v_id, v_user, 'submitted');
  perform private.write_audit('sourcing.submitted', p_buyer_org, 'sourcing_request', v_id::text,
    jsonb_build_object('reference', v_ref, 'partner_org_id', sp.partner_org_id, 'supplier_id', sp.id, 'lines', v_n));
  perform private.notify_org(sp.partner_org_id, 'sourcing:respond', 'sourcing.received', 'sourcing_request', v_id::text);
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'submitted', 'created', true);
end;
$$;

create function private.sourcing_summary(p_id uuid, p_for_partner boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'supplier_name', r.supplier_name,
    'destination_state', r.destination_state, 'needed_by', r.needed_by, 'version', r.version,
    'item_count', (select count(*) from public.sourcing_request_items i where i.request_id = r.id),
    'buyer_name', case when p_for_partner then (select o.name from public.organisations o where o.id = r.buyer_org_id) end,
    'created_at', r.created_at, 'updated_at', r.updated_at)
  from public.sourcing_requests r where r.id = p_id
$$;

create function public.list_my_sourcing_requests(p_buyer_org uuid, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_buyer_org) then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.sourcing_requests r where r.buyer_org_id = p_buyer_org),
    'items', coalesce((select jsonb_agg(private.sourcing_summary(x.id, false) order by x.created_at desc, x.id)
      from (select r.id, r.created_at from public.sourcing_requests r where r.buyer_org_id = p_buyer_org
            order by r.created_at desc, r.id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

create function public.list_partner_requests(p_org uuid, p_status text default null, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  if p_status is not null and p_status not in ('submitted', 'acknowledged', 'clarification_requested', 'closed', 'withdrawn') then
    perform private.raise_error('invalid', 'invalid_status');
  end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.sourcing_requests r where r.partner_org_id = p_org and (p_status is null or r.status = p_status)),
    'items', coalesce((select jsonb_agg(private.sourcing_summary(x.id, true) order by x.created_at desc, x.id)
      from (select r.id, r.created_at from public.sourcing_requests r where r.partner_org_id = p_org and (p_status is null or r.status = p_status)
            order by r.created_at desc, r.id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

create function public.get_sourcing_request(p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.sourcing_requests;
  v_buyer boolean;
  v_partner boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_requests x where x.id = p_request;
  if r.id is null then perform private.raise_error('not_found'); end if;
  v_buyer := private.is_member(r.buyer_org_id);
  v_partner := r.partner_org_id is not null and private.is_member(r.partner_org_id);
  if not v_buyer and not v_partner then perform private.raise_error('not_found'); end if;
  return private.sourcing_summary(r.id, v_partner) || jsonb_build_object(
    'your_side', case when v_buyer then 'buyer' else 'partner' end,
    'buyer_org_id', case when v_buyer then r.buyer_org_id end, 'partner_org_id', case when v_partner then r.partner_org_id end,
    'supplier_id', r.supplier_id, 'destination_city', r.destination_city, 'notes', r.notes, 'first_response_at', r.first_response_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('line_no', i.line_no, 'product_id', i.product_id, 'variant_id', i.variant_id,
        'quantity', i.quantity, 'unit', i.unit, 'snapshot', i.snapshot,
        'still_available', i.product_id is not null and private.product_visible(i.product_id)) order by i.line_no)
        from public.sourcing_request_items i where i.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note, 'at', e.at,
        'by', case when e.kind in ('submitted', 'buyer_replied', 'withdrawn') then 'buyer' else 'partner' end) order by e.id)
        from public.sourcing_request_events e where e.request_id = r.id), '[]'::jsonb));
end;
$$;

create function public.respond_sourcing_request(p_request uuid, p_action text, p_note text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.sourcing_requests;
  v_org uuid;
  v_sup uuid;
  sp public.suppliers;
  v_note text;
  v_status text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select x.partner_org_id, x.supplier_id into v_org, v_sup from public.sourcing_requests x where x.id = p_request;
  if v_org is null or not private.is_member(v_org) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(v_org, 'sourcing:respond') then perform private.raise_error('forbidden'); end if;
  if p_action not in ('acknowledge', 'clarify') then perform private.raise_error('invalid', 'invalid_action'); end if;
  perform private.require_consent();
  perform private.assert_partner_active(v_org);
  v_note := private.clean_text(p_note, case when p_action = 'clarify' then 5 else 1 end, 2000, 'invalid_note');
  if p_action = 'clarify' and v_note is null then perform private.raise_error('invalid', 'invalid_note'); end if;
  perform private.check_rate_limit('srcresp:' || v_user, 200, interval '1 hour');
  select * into sp from public.suppliers x where x.id = v_sup for share;
  if sp.id is null or sp.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_available'); end if;
  select * into r from public.sourcing_requests x where x.id = p_request for update;
  if p_expected_version is not null and p_expected_version is distinct from r.version then perform private.raise_error('conflict', 'stale_version'); end if;
  if p_action = 'acknowledge' then
    if r.status = 'acknowledged' then return jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version); end if;
    if r.status <> 'submitted' then perform private.raise_error('conflict', 'request_not_open'); end if;
    v_status := 'acknowledged';
  else
    if r.status <> 'submitted' then perform private.raise_error('conflict', 'request_not_open'); end if;
    v_status := 'clarification_requested';
  end if;
  update public.sourcing_requests set status = v_status, first_response_at = coalesce(first_response_at, now()), version = r.version + 1,
    updated_at = now() where id = r.id;
  insert into public.sourcing_request_events (request_id, actor_user_id, kind, note)
  values (r.id, v_user, case p_action when 'acknowledge' then 'acknowledged' else 'clarification_requested' end, v_note);
  perform private.write_audit('sourcing.' || v_status, v_org, 'sourcing_request', r.id::text, jsonb_build_object('reference', r.reference));
  perform private.notify_org(r.buyer_org_id, 'request:post', case p_action when 'acknowledge' then 'sourcing.acknowledged' else 'sourcing.clarification' end,
    'sourcing_request', r.id::text);
  return jsonb_build_object('id', r.id, 'status', v_status, 'version', r.version + 1);
end;
$$;

create function public.reply_sourcing_request(p_request uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.sourcing_requests;
  v_buyer uuid;
  v_note text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select x.buyer_org_id into v_buyer from public.sourcing_requests x where x.id = p_request;
  if v_buyer is null or not private.is_member(v_buyer) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(v_buyer, 'request:post') then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  v_note := private.clean_text(p_note, 1, 2000, 'invalid_note');
  if v_note is null then perform private.raise_error('invalid', 'invalid_note'); end if;
  perform private.check_rate_limit('srcreply:' || v_user, 100, interval '1 hour');
  select * into r from public.sourcing_requests x where x.id = p_request for update;
  if r.status <> 'clarification_requested' then perform private.raise_error('conflict', 'request_not_open'); end if;
  update public.sourcing_requests set status = 'submitted', version = r.version + 1, updated_at = now() where id = r.id;
  insert into public.sourcing_request_events (request_id, actor_user_id, kind, note) values (r.id, v_user, 'buyer_replied', v_note);
  perform private.write_audit('sourcing.buyer_replied', v_buyer, 'sourcing_request', r.id::text, jsonb_build_object('reference', r.reference));
  if r.partner_org_id is not null then
    perform private.notify_org(r.partner_org_id, 'sourcing:respond', 'sourcing.reply', 'sourcing_request', r.id::text);
  end if;
  return jsonb_build_object('id', r.id, 'status', 'submitted', 'version', r.version + 1);
end;
$$;

create function public.withdraw_sourcing_request(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.sourcing_requests;
  v_buyer uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select x.buyer_org_id into v_buyer from public.sourcing_requests x where x.id = p_request;
  if v_buyer is null or not private.is_member(v_buyer) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(v_buyer, 'request:post') then perform private.raise_error('forbidden'); end if;
  select * into r from public.sourcing_requests x where x.id = p_request for update;
  if r.status = 'withdrawn' then return jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version); end if;
  if r.status not in ('submitted', 'acknowledged', 'clarification_requested') then perform private.raise_error('conflict', 'request_not_open'); end if;
  update public.sourcing_requests set status = 'withdrawn', closed_at = now(), version = r.version + 1, updated_at = now() where id = r.id;
  insert into public.sourcing_request_events (request_id, actor_user_id, kind) values (r.id, v_user, 'withdrawn');
  perform private.write_audit('sourcing.withdrawn', v_buyer, 'sourcing_request', r.id::text, jsonb_build_object('reference', r.reference));
  if r.partner_org_id is not null then
    perform private.notify_org(r.partner_org_id, 'sourcing:respond', 'sourcing.withdrawn', 'sourcing_request', r.id::text);
  end if;
  return jsonb_build_object('id', r.id, 'status', 'withdrawn', 'version', r.version + 1);
end;
$$;

create function public.close_sourcing_request(p_request uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.sourcing_requests;
  v_org uuid;
  v_note text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select x.partner_org_id into v_org from public.sourcing_requests x where x.id = p_request;
  if v_org is null or not private.is_member(v_org) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(v_org, 'sourcing:respond') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(v_org);
  v_note := private.clean_text(p_note, 1, 2000, 'invalid_note');
  select * into r from public.sourcing_requests x where x.id = p_request for update;
  if r.status = 'closed' then return jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version); end if;
  if r.status not in ('submitted', 'acknowledged', 'clarification_requested') then perform private.raise_error('conflict', 'request_not_open'); end if;
  update public.sourcing_requests set status = 'closed', closed_at = now(), version = r.version + 1, updated_at = now() where id = r.id;
  insert into public.sourcing_request_events (request_id, actor_user_id, kind, note) values (r.id, v_user, 'closed', v_note);
  perform private.write_audit('sourcing.closed', v_org, 'sourcing_request', r.id::text, jsonb_build_object('reference', r.reference));
  perform private.notify_org(r.buyer_org_id, 'request:post', 'sourcing.closed', 'sourcing_request', r.id::text);
  return jsonb_build_object('id', r.id, 'status', 'closed', 'version', r.version + 1);
end;
$$;

------------------------------------------------------------------------------------------------
-- Product reports
------------------------------------------------------------------------------------------------
create function public.report_product(p_product uuid, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_note text := private.clean_text(p_note, 1, 500, 'invalid_note');
  v_id uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.require_consent();
  if p_reason is null or p_reason not in ('misleading', 'counterfeit', 'prohibited', 'wrong_price', 'offensive', 'spam', 'other') then
    perform private.raise_error('invalid', 'invalid_reason');
  end if;
  perform private.check_rate_limit('prodreport:' || v_user, 10, interval '1 day');
  if p_product is null or not private.product_visible(p_product) then perform private.raise_error('not_found'); end if;
  begin
    insert into public.product_reports (product_id, reporter, reason, note) values (p_product, v_user, p_reason, v_note) returning id into v_id;
  exception when unique_violation then
    perform private.raise_error('conflict', 'already_reported');
  end;
  perform private.write_audit('product.reported', null, 'product', p_product::text, jsonb_build_object('reason', p_reason, 'report_id', v_id));
  return jsonb_build_object('id', v_id);
end;
$$;

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------
alter table public.saved_products enable row level security;
alter table public.sourcing_requests enable row level security;
alter table public.sourcing_request_items enable row level security;
alter table public.sourcing_request_events enable row level security;
alter table public.product_reports enable row level security;

create policy saved_products_select on public.saved_products for select to authenticated using (user_id = (select auth.uid()));
create policy sourcing_requests_select on public.sourcing_requests for select to authenticated
  using (private.is_member(buyer_org_id) or (partner_org_id is not null and private.is_member(partner_org_id)));
create policy sourcing_request_items_select on public.sourcing_request_items for select to authenticated
  using (exists (select 1 from public.sourcing_requests r where r.id = request_id));
create policy sourcing_request_events_select on public.sourcing_request_events for select to authenticated
  using (exists (select 1 from public.sourcing_requests r where r.id = request_id));
create policy product_reports_select on public.product_reports for select to authenticated
  using (reporter = (select auth.uid()) or private.has_platform_permission('catalogue:moderate'));

grant select on public.saved_products, public.sourcing_requests, public.sourcing_request_items,
  public.sourcing_request_events, public.product_reports to authenticated;

revoke all on function
  private.sourcing_events_immutable(), private.product_visible(uuid), private.visible_product_ids(),
  private.catalogue_item_json(uuid, boolean), private.new_sourcing_reference(), private.sourcing_snapshot(uuid, text, numeric),
  private.sourcing_summary(uuid, boolean),
  public.search_catalogue(text, text, uuid, numeric, numeric, numeric, text, integer, integer), public.get_catalogue_item(uuid),
  public.compare_items(uuid[]), public.get_product_media_access(uuid), public.save_product(uuid), public.unsave_product(uuid),
  public.list_saved_products(integer),
  public.submit_sourcing_request(uuid, text, jsonb, text, text, date, text), public.list_my_sourcing_requests(uuid, integer),
  public.list_partner_requests(uuid, text, integer), public.get_sourcing_request(uuid),
  public.respond_sourcing_request(uuid, text, text, integer), public.reply_sourcing_request(uuid, text),
  public.withdraw_sourcing_request(uuid), public.close_sourcing_request(uuid, text), public.report_product(uuid, text, text)
  from public, anon, authenticated, service_role;

-- Public reads (anonymous visitors may browse the live catalogue).
grant execute on function
  public.search_catalogue(text, text, uuid, numeric, numeric, numeric, text, integer, integer), public.get_catalogue_item(uuid),
  public.compare_items(uuid[]), public.get_product_media_access(uuid)
  to anon, authenticated;

grant execute on function
  public.save_product(uuid), public.unsave_product(uuid), public.list_saved_products(integer),
  public.submit_sourcing_request(uuid, text, jsonb, text, text, date, text), public.list_my_sourcing_requests(uuid, integer),
  public.list_partner_requests(uuid, text, integer), public.get_sourcing_request(uuid),
  public.respond_sourcing_request(uuid, text, text, integer), public.reply_sourcing_request(uuid, text),
  public.withdraw_sourcing_request(uuid), public.close_sourcing_request(uuid, text), public.report_product(uuid, text, text)
  to authenticated;
