-- Phase 5 (2/5): products, immutable revisions, live catalogue tables, product media, validation, publish.
-- Lifecycle: partner edits `products.draft`; submit_product freezes it into an immutable product_revisions row;
-- an admin approves it; the partner publishes it (copied into the live catalogue_* tables). Editing a published
-- product never touches the live copy: the live version stays until a newer revision is approved and published.
-- Lock order (all RPCs): supplier row first (FOR SHARE or UPDATE), then product row, then its revisions.

create type public.product_status as enum ('draft', 'submitted', 'changes_requested', 'approved', 'published', 'unpublished', 'rejected', 'suspended');

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  sku text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  status public.product_status not null default 'draft',
  draft jsonb not null default '{}'::jsonb,
  draft_version integer not null default 0,
  submitted_draft_version integer,
  live_revision_id uuid,
  pending_revision_id uuid,
  suspended_from public.product_status,
  suspended_reason text check (char_length(suspended_reason) <= 1000),
  suspended_at timestamptz,
  suspended_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, sku)
);
create unique index products_sku_ci on public.products (supplier_id, lower(sku));
create index products_partner on public.products (partner_org_id, status);
create index products_published on public.products (status, published_at desc) where status = 'published';

create table public.product_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  rev_no integer not null check (rev_no > 0),
  data jsonb not null,
  media_ids uuid[] not null default '{}',
  status text not null check (status in ('submitted', 'changes_requested', 'approved', 'rejected', 'published', 'superseded')),
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  reason text check (char_length(reason) <= 1000),
  published_at timestamptz,
  unique (product_id, rev_no)
);
create index product_revisions_review on public.product_revisions (submitted_at) where status = 'submitted';

alter table public.products
  add constraint products_live_revision_fk foreign key (live_revision_id) references public.product_revisions (id) on delete set null,
  add constraint products_pending_revision_fk foreign key (pending_revision_id) references public.product_revisions (id) on delete set null;

-- The submitted content of a revision never changes. Only the decision columns and its status may move.
create function private.product_revisions_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.product_id is distinct from old.product_id or new.partner_org_id is distinct from old.partner_org_id
     or new.rev_no is distinct from old.rev_no or new.data is distinct from old.data or new.media_ids is distinct from old.media_ids
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'revision_immutable' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
create trigger product_revisions_immutable before update on public.product_revisions
  for each row execute function private.product_revisions_immutable();

create function private.products_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.supplier_id is distinct from old.supplier_id
     or new.partner_org_id is distinct from old.partner_org_id or new.sku is distinct from old.sku then
    raise exception 'immutable_columns' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
create trigger products_immutable before update on public.products
  for each row execute function private.products_immutable_columns();

-- Live (public) copy: written only by publish_product from an approved revision.
create table public.catalogue_items (
  product_id uuid primary key references public.products (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  revision_id uuid,
  category_slug text not null references public.product_categories (slug) on delete restrict,
  sku text not null,
  name text not null check (char_length(name) between 2 and 160),
  description text check (char_length(description) <= 2000),
  unit text not null check (char_length(unit) between 1 and 30),
  moq numeric(14, 3) not null check (moq > 0),
  currency char(3) check (currency in ('INR', 'MYR', 'USD')),
  price_mode text not null check (price_mode in ('tiers', 'fixed', 'request')),
  fixed_unit_price numeric(14, 2) check (fixed_unit_price > 0),
  price_confirmed_on date,
  lead_time_min_days integer check (lead_time_min_days between 0 and 365),
  lead_time_max_days integer check (lead_time_max_days between 0 and 365),
  availability_status text not null check (availability_status in ('available', 'made_to_order', 'limited', 'unavailable')),
  availability_confirmed_on date not null,
  specs jsonb not null default '{}'::jsonb,
  packaging text check (char_length(packaging) <= 300),
  published_at timestamptz not null default now(),
  search tsvector not null,
  check (price_mode = 'request' or currency is not null),
  check ((price_mode = 'fixed') = (fixed_unit_price is not null))
);
create index catalogue_items_search on public.catalogue_items using gin (search);
create index catalogue_items_category on public.catalogue_items (category_slug, published_at desc);
create index catalogue_items_supplier on public.catalogue_items (supplier_id);

create table public.catalogue_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80),
  attributes jsonb not null default '{}'::jsonb,
  moq numeric(14, 3) check (moq > 0),
  sort integer not null default 0,
  unique (product_id, sku)
);

create table public.catalogue_price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.catalogue_variants (id) on delete cascade,
  min_qty numeric(14, 3) not null check (min_qty >= 1),
  max_qty numeric(14, 3),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  currency char(3) not null check (currency in ('INR', 'MYR', 'USD')),
  check (max_qty is null or max_qty >= min_qty)
);
create unique index catalogue_price_tiers_start on public.catalogue_price_tiers
  (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), min_qty);

-- Defence in depth: tiers of one (product, variant) may never overlap, whatever code path wrote them.
create function private.price_tiers_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.catalogue_price_tiers t
    where t.id <> new.id and t.product_id = new.product_id and t.variant_id is not distinct from new.variant_id
      and new.min_qty <= coalesce(t.max_qty, 'Infinity'::numeric) and t.min_qty <= coalesce(new.max_qty, 'Infinity'::numeric)
  ) then
    raise exception 'tier_overlap' using errcode = 'PT422';
  end if;
  return null;
end;
$$;
create trigger price_tiers_no_overlap after insert or update on public.catalogue_price_tiers
  for each row execute function private.price_tiers_no_overlap();

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{8,120}$'),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status public.scan_status not null default 'pending',
  scan_engine text check (char_length(scan_engine) <= 80),
  scanned_at timestamptz,
  alt text check (char_length(alt) <= 200),
  sort integer not null default 0,
  approved boolean not null default false,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index product_media_product on public.product_media (product_id) where removed_at is null;
create index product_media_scan on public.product_media (coalesce(scanned_at, created_at))
  where scan_status in ('pending', 'failed') and removed_at is null;

-- Private bucket for product images. No storage policy exists for any API role: only trusted server code (service
-- role) writes, and reads go through get_product_media_access() and an app route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogue-media', 'catalogue-media', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

------------------------------------------------------------------------------------------------
-- Validation. Returns error keys (empty array = valid). A key may carry a detail after ':' (field name or index).
-- p_strict = false: per-field format checks only (used for drafts and imports).
-- p_strict = true: the product must be complete enough to be reviewed and published (submit_product).
------------------------------------------------------------------------------------------------
create function private.bad_text(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null
              when char_length(p) > p_max then 'too_long'
              when p ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then 'invalid_text'
              when private.formula_text(p) then 'formula_text' end
$$;

create function private.parse_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end;
$$;

create function private.safe_numeric(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::numeric;
exception when others then
  return null;
end;
$$;

create function private.valid_money(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select case when p ~ '^[0-9]{1,11}(\.[0-9]{1,2})?$' then private.safe_numeric(p) > 0 else false end $$;

create function private.validate_product_data(p_data jsonb, p_strict boolean default true)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text[] := array[]::text[];
  k text;
  v text;
  t text;
  v_mode text;
  v_cur text;
  v_moq numeric;
  v_tiers jsonb := '[]'::jsonb;
  v_vars jsonb := '[]'::jsonb;
  v_specs jsonb := '{}'::jsonb;
  el jsonb;
  i integer;
  v_vskus text[] := array[]::text[];
  v_d date;
  v_lmin integer;
  v_lmax integer;
  f_asc boolean;
  f_over boolean;
  f_gap boolean;
  f_open boolean;
  f_cover boolean;
  v_has_default boolean;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return array['invalid_data']; end if;
  for k in select jsonb_object_keys(p_data) loop
    if k <> all (array['sku', 'name', 'description', 'category_slug', 'unit', 'moq', 'currency', 'price_mode', 'unit_price', 'tiers',
                       'variants', 'lead_time_min_days', 'lead_time_max_days', 'availability_status', 'availability_confirmed_on',
                       'price_confirmed_on', 'specs', 'packaging']) then
      e := e || ('unknown_field:' || left(k, 40));
    end if;
  end loop;
  foreach k in array array['sku', 'name', 'description', 'category_slug', 'unit', 'moq', 'currency', 'price_mode', 'unit_price',
      'lead_time_min_days', 'lead_time_max_days', 'availability_status', 'availability_confirmed_on', 'price_confirmed_on', 'packaging'] loop
    if jsonb_typeof(p_data -> k) in ('array', 'object', 'boolean') then e := e || ('invalid_' || k); end if;
  end loop;
  if jsonb_typeof(p_data -> 'tiers') in ('string', 'number', 'object', 'boolean') then e := array_append(e, 'invalid_tiers'::text); end if;
  if jsonb_typeof(p_data -> 'variants') in ('string', 'number', 'object', 'boolean') then e := array_append(e, 'invalid_variants'::text); end if;
  if jsonb_typeof(p_data -> 'specs') in ('string', 'number', 'array', 'boolean') then e := array_append(e, 'invalid_specs'::text); end if;
  if cardinality(e) > 0 then return e; end if;

  -- name, description, packaging, unit, category
  v := nullif(btrim(coalesce(p_data ->> 'name', '')), '');
  if v is null then
    if p_strict then e := array_append(e, 'name_required'::text); end if;
  elsif private.bad_text(v, 160) is not null then e := e || (private.bad_text(v, 160) || ':name');
  elsif char_length(v) < 2 then e := array_append(e, 'invalid_name'::text);
  end if;
  v := nullif(btrim(coalesce(p_data ->> 'description', '')), '');
  if v is not null and private.bad_text(v, 2000) is not null then e := e || (private.bad_text(v, 2000) || ':description'); end if;
  v := nullif(btrim(coalesce(p_data ->> 'packaging', '')), '');
  if v is not null and private.bad_text(v, 300) is not null then e := e || (private.bad_text(v, 300) || ':packaging'); end if;
  v := nullif(btrim(coalesce(p_data ->> 'sku', '')), '');
  if v is not null and v !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then e := array_append(e, 'invalid_sku'::text); end if;
  v := nullif(btrim(coalesce(p_data ->> 'unit', '')), '');
  if v is null then
    if p_strict then e := array_append(e, 'unit_required'::text); end if;
  elsif private.bad_text(v, 30) is not null then e := e || (private.bad_text(v, 30) || ':unit');
  end if;
  v := nullif(btrim(coalesce(p_data ->> 'category_slug', '')), '');
  if v is null then
    if p_strict then e := array_append(e, 'category_required'::text); end if;
  elsif not exists (select 1 from public.product_categories c where c.slug = v and c.active) then e := array_append(e, 'invalid_category'::text);
  end if;

  -- MOQ
  v := nullif(btrim(coalesce(p_data ->> 'moq', '')), '');
  if v is null then
    if p_strict then e := array_append(e, 'moq_required'::text); end if;
  elsif v !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or private.safe_numeric(v) <= 0 then e := array_append(e, 'invalid_moq'::text);
  else v_moq := private.safe_numeric(v);
  end if;

  -- currency and price mode
  v_cur := nullif(btrim(coalesce(p_data ->> 'currency', '')), '');
  if v_cur is not null and v_cur not in ('INR', 'MYR', 'USD') then e := array_append(e, 'invalid_currency'::text); end if;
  v_mode := nullif(btrim(coalesce(p_data ->> 'price_mode', '')), '');
  if v_mode is not null and v_mode not in ('tiers', 'fixed', 'request') then e := array_append(e, 'invalid_price_mode'::text); v_mode := null; end if;
  if v_mode is null and p_strict and not 'invalid_price_mode' = any (e) then e := array_append(e, 'price_mode_required'::text); end if;

  v := nullif(btrim(coalesce(p_data ->> 'unit_price', '')), '');
  if v is not null and not private.valid_money(v) then e := array_append(e, 'invalid_price'::text); end if;

  -- dates and availability
  foreach k in array array['price_confirmed_on', 'availability_confirmed_on'] loop
    v := nullif(btrim(coalesce(p_data ->> k, '')), '');
    if v is not null then
      v_d := private.parse_date(v);
      if v_d is null then e := e || ('invalid_date:' || k);
      elsif v_d > current_date then e := e || ('future_date:' || k);
      end if;
    end if;
  end loop;
  v := nullif(btrim(coalesce(p_data ->> 'availability_status', '')), '');
  if v is not null and v not in ('available', 'made_to_order', 'limited', 'unavailable') then e := array_append(e, 'invalid_availability'::text);
  end if;
  foreach k in array array['lead_time_min_days', 'lead_time_max_days'] loop
    v := nullif(btrim(coalesce(p_data ->> k, '')), '');
    if v is not null and (v !~ '^[0-9]{1,3}$' or private.safe_numeric(v) > 365) then e := e || ('invalid_lead_time:' || k); end if;
  end loop;
  if cardinality(e) = 0 or not exists (select 1 from unnest(e) x where x like 'invalid_lead_time%') then
    v_lmin := private.safe_numeric(nullif(btrim(coalesce(p_data ->> 'lead_time_min_days', '')), ''))::integer;
    v_lmax := private.safe_numeric(nullif(btrim(coalesce(p_data ->> 'lead_time_max_days', '')), ''))::integer;
    if v_lmin is not null and v_lmax is not null and v_lmin > v_lmax then e := array_append(e, 'invalid_lead_time'::text); end if;
  end if;

  -- specs
  if p_data ? 'specs' and jsonb_typeof(p_data -> 'specs') = 'object' then
    v_specs := p_data -> 'specs';
    if (select count(*) from jsonb_object_keys(v_specs)) > 20 then e := array_append(e, 'too_many_specs'::text); end if;
    for k in select jsonb_object_keys(v_specs) loop
      if char_length(k) < 1 or private.bad_text(k, 40) is not null then e := array_append(e, 'invalid_spec'::text); exit; end if;
      if jsonb_typeof(v_specs -> k) not in ('string', 'number') or private.bad_text(v_specs ->> k, 200) is not null then
        e := array_append(e, 'invalid_spec'::text); exit;
      end if;
    end loop;
  end if;

  -- variants
  if p_data ? 'variants' and jsonb_typeof(p_data -> 'variants') = 'array' then
    v_vars := p_data -> 'variants';
    if jsonb_array_length(v_vars) > 50 then e := array_append(e, 'too_many_variants'::text); v_vars := '[]'::jsonb; end if;
    i := 0;
    for el in select jsonb_array_elements(v_vars) loop
      i := i + 1;
      if jsonb_typeof(el) <> 'object' or exists (select 1 from jsonb_object_keys(el) kk where kk not in ('sku', 'label', 'attributes', 'moq')) then
        e := e || ('invalid_variant:' || i); continue;
      end if;
      v := nullif(btrim(coalesce(el ->> 'sku', '')), '');
      if v is null or v !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then e := e || ('invalid_variant_sku:' || i);
      elsif lower(v) = any (v_vskus) then e := e || ('duplicate_variant_sku:' || i);
      else v_vskus := v_vskus || lower(v);
      end if;
      v := nullif(btrim(coalesce(el ->> 'label', '')), '');
      if v is null or private.bad_text(v, 80) is not null then e := e || ('invalid_variant:' || i); end if;
      if jsonb_typeof(el -> 'moq') in ('array', 'object', 'boolean') then e := e || ('invalid_variant:' || i);
      else
        v := nullif(btrim(coalesce(el ->> 'moq', '')), '');
        if v is not null and (v !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or private.safe_numeric(v) <= 0) then e := e || ('invalid_variant_moq:' || i); end if;
      end if;
      if el ? 'attributes' and el -> 'attributes' is not null and jsonb_typeof(el -> 'attributes') <> 'null' then
        if jsonb_typeof(el -> 'attributes') <> 'object' or (select count(*) from jsonb_object_keys(el -> 'attributes')) > 10 then
          e := e || ('invalid_variant:' || i);
        else
          for k in select jsonb_object_keys(el -> 'attributes') loop
            if char_length(k) < 1 or private.bad_text(k, 40) is not null
               or jsonb_typeof(el -> 'attributes' -> k) not in ('string', 'number')
               or private.bad_text(el -> 'attributes' ->> k, 100) is not null then
              e := e || ('invalid_variant:' || i); exit;
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  -- tiers
  if p_data ? 'tiers' and jsonb_typeof(p_data -> 'tiers') = 'array' then
    v_tiers := p_data -> 'tiers';
    if jsonb_array_length(v_tiers) > 60 then e := array_append(e, 'too_many_tiers'::text); v_tiers := '[]'::jsonb; end if;
    i := 0;
    for el in select jsonb_array_elements(v_tiers) loop
      i := i + 1;
      if jsonb_typeof(el) <> 'object' or exists (select 1 from jsonb_object_keys(el) kk where kk not in ('min_qty', 'max_qty', 'unit_price', 'variant_sku'))
         or coalesce(jsonb_typeof(el -> 'min_qty'), 'null') not in ('string', 'number')
         or coalesce(jsonb_typeof(el -> 'unit_price'), 'null') not in ('string', 'number')
         or coalesce(jsonb_typeof(el -> 'max_qty'), 'null') not in ('string', 'number', 'null')
         or coalesce(jsonb_typeof(el -> 'variant_sku'), 'null') not in ('string', 'null') then
        e := e || ('invalid_tier:' || i); v_tiers := '[]'::jsonb; exit;
      end if;
      t := el ->> 'min_qty';
      if t !~ '^[0-9]{1,9}(\.0+)?$' or private.safe_numeric(t) < 1 then e := e || ('invalid_tier_qty:' || i); end if;
      t := nullif(btrim(coalesce(el ->> 'max_qty', '')), '');
      if t is not null and (t !~ '^[0-9]{1,9}(\.0+)?$' or private.safe_numeric(t) < 1 or private.safe_numeric(t) < coalesce(private.safe_numeric(el ->> 'min_qty'), 0)) then
        e := e || ('invalid_tier_qty:' || i);
      end if;
      if not private.valid_money(el ->> 'unit_price') then e := e || ('invalid_price:tiers[' || i || ']'); end if;
      t := nullif(btrim(coalesce(el ->> 'variant_sku', '')), '');
      if t is not null and not lower(t) = any (v_vskus) then e := e || ('tier_unknown_variant:' || i); end if;
    end loop;
    if cardinality(e) = 0 or not exists (select 1 from unnest(e) x where x like 'invalid_tier%' or x like 'invalid_price:tiers%' or x like 'tier_unknown_variant%') then
      if jsonb_array_length(v_tiers) > 0 then
        with t as (
          select a.ord, lower(nullif(btrim(coalesce(a.x ->> 'variant_sku', '')), '')) vs, (a.x ->> 'min_qty')::numeric mn,
                 nullif(btrim(coalesce(a.x ->> 'max_qty', '')), '')::numeric mx
          from jsonb_array_elements(v_tiers) with ordinality a (x, ord)
        ), o as (
          select t.ord, t.mn, lag(t.mn) over (partition by coalesce(t.vs, '') order by t.ord) pm_ord from t
        ), s as (
          select t.ord, t.mn, t.mx, t.vs,
                 row_number() over (partition by coalesce(t.vs, '') order by t.mn) rn_asc,
                 row_number() over (partition by coalesce(t.vs, '') order by t.mn desc) rn_desc,
                 lag(t.mx) over (partition by coalesce(t.vs, '') order by t.mn) prev_mx
          from t
        )
        select coalesce(bool_or(o.pm_ord is not null and o.mn <= o.pm_ord), false),
               coalesce(bool_or(s.rn_asc > 1 and (s.prev_mx is null or s.mn <= s.prev_mx)), false),
               coalesce(bool_or(s.rn_asc > 1 and s.prev_mx is not null and s.mn > s.prev_mx + 1), false),
               coalesce(bool_or(s.rn_desc = 1 and s.mx is not null), false),
               coalesce(bool_or(s.rn_asc = 1 and v_moq is not null and s.mn > greatest(1, floor(coalesce(
                 (select nullif(vx ->> 'moq', '')::numeric from jsonb_array_elements(v_vars) vx where lower(vx ->> 'sku') = s.vs limit 1), v_moq)))), false)
          into f_asc, f_over, f_gap, f_open, f_cover
        from o join s using (ord);
        if f_asc and not f_over then e := array_append(e, 'tier_not_ascending'::text); end if;
        if f_over then e := array_append(e, 'tier_overlap'::text); end if;
        if f_gap then e := array_append(e, 'tier_gap'::text); end if;
        if f_open then e := array_append(e, 'tier_last_not_open'::text); end if;
        if p_strict and f_cover then e := array_append(e, 'tier_does_not_cover_moq'::text); end if;
      end if;
    end if;
  end if;

  if p_strict then
    if v_mode in ('fixed', 'tiers') then
      if v_cur is null then e := array_append(e, 'currency_required'::text); end if;
      if nullif(btrim(coalesce(p_data ->> 'price_confirmed_on', '')), '') is null then e := array_append(e, 'price_date_required'::text); end if;
    end if;
    if v_mode = 'fixed' then
      if nullif(btrim(coalesce(p_data ->> 'unit_price', '')), '') is null then e := array_append(e, 'price_required'::text); end if;
      if jsonb_array_length(v_tiers) > 0 then e := array_append(e, 'tiers_not_allowed'::text); end if;
    elsif v_mode = 'tiers' then
      if jsonb_array_length(v_tiers) = 0 then e := array_append(e, 'tiers_required'::text);
      else
        select exists (select 1 from jsonb_array_elements(v_tiers) x where nullif(btrim(coalesce(x ->> 'variant_sku', '')), '') is null) into v_has_default;
        if not v_has_default then e := array_append(e, 'tiers_required'::text); end if;
      end if;
      if nullif(btrim(coalesce(p_data ->> 'unit_price', '')), '') is not null then e := array_append(e, 'unit_price_not_allowed'::text); end if;
    elsif v_mode = 'request' then
      if nullif(btrim(coalesce(p_data ->> 'unit_price', '')), '') is not null or jsonb_array_length(v_tiers) > 0 then e := array_append(e, 'price_not_allowed'::text); end if;
    end if;
    if nullif(btrim(coalesce(p_data ->> 'availability_status', '')), '') is null then e := array_append(e, 'availability_required'::text); end if;
    if nullif(btrim(coalesce(p_data ->> 'availability_confirmed_on', '')), '') is null then e := array_append(e, 'availability_date_required'::text); end if;
  end if;
  return e;
end;
$$;

-- Merge of a draft with new values: null or empty string removes a key.
create function private.merge_product_draft(p_cur jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_cur, '{}'::jsonb);
  k text;
begin
  for k in select jsonb_object_keys(p_new) loop
    if jsonb_typeof(p_new -> k) = 'null' or (jsonb_typeof(p_new -> k) = 'string' and btrim(p_new ->> k) = '') then
      v := v - k;
    elsif jsonb_typeof(p_new -> k) = 'string' then
      v := v || jsonb_build_object(k, btrim(p_new ->> k));
    else
      v := v || jsonb_build_object(k, p_new -> k);
    end if;
  end loop;
  return v;
end;
$$;

-- The first error becomes the HTTP 422 message key.
create function private.raise_first_error(p_errors text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if cardinality(p_errors) > 0 then perform private.raise_error('invalid', p_errors[1]); end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Partner RPCs: draft, submit, publish, unpublish
------------------------------------------------------------------------------------------------
create function public.save_product_draft(p_org uuid, p_supplier uuid, p_product uuid, p_data jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  sp public.suppliers;
  v_sku text;
  v_draft jsonb;
  v_sup uuid := p_supplier;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  perform private.require_consent();
  perform private.check_rate_limit('product:' || v_user, 600, interval '1 hour');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;

  if p_product is not null then
    select x.supplier_id into v_sup from public.products x where x.id = p_product and x.partner_org_id = p_org;
    if v_sup is null then perform private.raise_error('not_found'); end if;
  end if;
  select * into sp from public.suppliers x where x.id = v_sup and x.partner_org_id = p_org for share;
  if sp.id is null then perform private.raise_error('not_found'); end if;
  if sp.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;

  if p_product is null then
    v_sku := nullif(btrim(coalesce(p_data ->> 'sku', '')), '');
    if v_sku is null or v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then perform private.raise_error('invalid', 'invalid_sku'); end if;
    if (select count(*) from public.products x where x.supplier_id = v_sup) >= 5000 then
      perform private.raise_error('conflict', 'product_limit_reached');
    end if;
    begin
      insert into public.products (supplier_id, partner_org_id, sku, draft, created_by)
      values (v_sup, p_org, v_sku, jsonb_build_object('sku', v_sku), v_user) returning * into pr;
    exception when unique_violation then
      perform private.raise_error('conflict', 'sku_exists');
    end;
  else
    select * into pr from public.products x where x.id = p_product and x.partner_org_id = p_org for update;
    if pr.id is null then perform private.raise_error('not_found'); end if;
    if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
    if exists (select 1 from public.product_revisions r where r.id = pr.pending_revision_id and r.status = 'submitted') then
      perform private.raise_error('conflict', 'product_under_review');
    end if;
    if p_expected_version is distinct from pr.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;
    if p_data ? 'sku' and (p_data ->> 'sku') is distinct from pr.sku then perform private.raise_error('invalid', 'immutable_columns'); end if;
  end if;

  v_draft := private.merge_product_draft(pr.draft, p_data - 'sku');
  perform private.raise_first_error(private.validate_product_data(v_draft, false));
  update public.products set draft = v_draft, draft_version = pr.draft_version + 1, version = pr.version + 1,
    status = case when pr.status in ('changes_requested', 'rejected') then 'draft'::public.product_status else pr.status end,
    updated_at = now()
  where id = pr.id;
  perform private.write_audit('product.draft_saved', p_org, 'product', pr.id::text, '{}'::jsonb);
  return jsonb_build_object('id', pr.id, 'sku', pr.sku, 'version', pr.version + 1, 'draft_version', pr.draft_version + 1,
    'status', case when pr.status in ('changes_requested', 'rejected') then 'draft' else pr.status::text end);
end;
$$;

create function public.submit_product(p_org uuid, p_product uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  sp public.suppliers;
  v_sup uuid;
  v_rev uuid;
  v_no integer;
  v_media uuid[];
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  perform private.require_consent();
  perform private.check_rate_limit('product_submit:' || v_user, 200, interval '1 hour');
  select x.supplier_id into v_sup from public.products x where x.id = p_product and x.partner_org_id = p_org;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  select * into sp from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
  if exists (select 1 from public.product_revisions r where r.id = pr.pending_revision_id and r.status = 'submitted') then
    return jsonb_build_object('id', pr.id, 'revision_id', pr.pending_revision_id, 'created', false);
  end if;
  if sp.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_approved'); end if;
  if p_expected_version is distinct from pr.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;
  if pr.submitted_draft_version is not distinct from pr.draft_version then perform private.raise_error('conflict', 'nothing_to_submit'); end if;
  perform private.raise_first_error(private.validate_product_data(pr.draft, true));

  select coalesce(max(r.rev_no), 0) + 1 into v_no from public.product_revisions r where r.product_id = pr.id;
  select coalesce(array_agg(m.id order by m.sort, m.created_at), array[]::uuid[]) into v_media
  from public.product_media m where m.product_id = pr.id and m.removed_at is null and m.scan_status = 'clean';
  update public.product_revisions set status = 'superseded'
  where product_id = pr.id and status in ('approved', 'changes_requested', 'rejected');
  insert into public.product_revisions (product_id, partner_org_id, rev_no, data, media_ids, status, submitted_by)
  values (pr.id, p_org, v_no, pr.draft, v_media, 'submitted', v_user) returning id into v_rev;
  update public.products set pending_revision_id = v_rev, submitted_draft_version = pr.draft_version, version = pr.version + 1,
    status = case when pr.status in ('draft', 'changes_requested', 'rejected', 'approved') then 'submitted'::public.product_status else pr.status end,
    updated_at = now()
  where id = pr.id;
  perform private.write_audit('product.submitted', p_org, 'product', pr.id::text, jsonb_build_object('revision', v_no));
  perform private.notify_platform('catalogue:review', 'product.submitted', 'product', pr.id::text);
  return jsonb_build_object('id', pr.id, 'revision_id', v_rev, 'rev_no', v_no, 'created', true);
end;
$$;

-- Copies an approved revision into the live tables. Called with the supplier and product rows locked.
create function private.materialise_product(p_product uuid, p_rev public.product_revisions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb := p_rev.data;
  v_sup uuid;
  v_supname text;
  v_vsku text;
  el jsonb;
  i integer := 0;
  v_var uuid;
  v_mode text := d ->> 'price_mode';
  v_cur text := nullif(d ->> 'currency', '');
begin
  select p.supplier_id, s.live_name into v_sup, v_supname
  from public.products p join public.suppliers s on s.id = p.supplier_id where p.id = p_product;
  insert into public.catalogue_items (product_id, supplier_id, revision_id, category_slug, sku, name, description, unit, moq, currency,
    price_mode, fixed_unit_price, price_confirmed_on, lead_time_min_days, lead_time_max_days, availability_status,
    availability_confirmed_on, specs, packaging, published_at, search)
  values (p_product, v_sup, p_rev.id, d ->> 'category_slug', d ->> 'sku', d ->> 'name', nullif(d ->> 'description', ''), d ->> 'unit',
    (d ->> 'moq')::numeric, case when v_mode = 'request' then null else v_cur end, v_mode,
    case when v_mode = 'fixed' then (d ->> 'unit_price')::numeric end, private.parse_date(d ->> 'price_confirmed_on'),
    nullif(d ->> 'lead_time_min_days', '')::integer, nullif(d ->> 'lead_time_max_days', '')::integer, d ->> 'availability_status',
    private.parse_date(d ->> 'availability_confirmed_on'), coalesce(d -> 'specs', '{}'::jsonb), nullif(d ->> 'packaging', ''), now(),
    setweight(to_tsvector('simple', coalesce(d ->> 'name', '')), 'A') || setweight(to_tsvector('simple', coalesce(d ->> 'sku', '')), 'A')
    || setweight(to_tsvector('simple', coalesce(v_supname, '')), 'B') || setweight(to_tsvector('simple', coalesce(d ->> 'description', '')), 'C'))
  on conflict (product_id) do update set revision_id = excluded.revision_id, category_slug = excluded.category_slug, sku = excluded.sku,
    name = excluded.name, description = excluded.description, unit = excluded.unit, moq = excluded.moq, currency = excluded.currency,
    price_mode = excluded.price_mode, fixed_unit_price = excluded.fixed_unit_price, price_confirmed_on = excluded.price_confirmed_on,
    lead_time_min_days = excluded.lead_time_min_days, lead_time_max_days = excluded.lead_time_max_days,
    availability_status = excluded.availability_status, availability_confirmed_on = excluded.availability_confirmed_on,
    specs = excluded.specs, packaging = excluded.packaging, published_at = excluded.published_at, search = excluded.search;

  -- Variants keep their id while their sku stays (saved requests reference them); tiers are rewritten.
  delete from public.catalogue_price_tiers where product_id = p_product;
  delete from public.catalogue_variants v where v.product_id = p_product
    and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'variants', '[]'::jsonb)) x where lower(x ->> 'sku') = lower(v.sku));
  for el in select jsonb_array_elements(coalesce(d -> 'variants', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.catalogue_variants (product_id, sku, label, attributes, moq, sort)
    values (p_product, el ->> 'sku', el ->> 'label', coalesce(nullif(el -> 'attributes', 'null'::jsonb), '{}'::jsonb), nullif(el ->> 'moq', '')::numeric, i)
    on conflict (product_id, sku) do update set label = excluded.label, attributes = excluded.attributes, moq = excluded.moq, sort = excluded.sort;
  end loop;
  if v_mode = 'tiers' then
    for el in select x from jsonb_array_elements(d -> 'tiers') x order by nullif(x ->> 'variant_sku', '') nulls first, (x ->> 'min_qty')::numeric loop
      v_vsku := nullif(btrim(coalesce(el ->> 'variant_sku', '')), '');
      v_var := null;
      if v_vsku is not null then
        select v.id into v_var from public.catalogue_variants v where v.product_id = p_product and lower(v.sku) = lower(v_vsku);
      end if;
      insert into public.catalogue_price_tiers (product_id, variant_id, min_qty, max_qty, unit_price, currency)
      values (p_product, v_var, (el ->> 'min_qty')::numeric, nullif(btrim(coalesce(el ->> 'max_qty', '')), '')::numeric,
              (el ->> 'unit_price')::numeric, v_cur);
    end loop;
  end if;
  -- What the public may see of the images is exactly what the reviewer approved (still clean and not removed).
  update public.product_media set approved = (id = any (p_rev.media_ids) and scan_status = 'clean' and removed_at is null)
  where product_id = p_product;
end;
$$;

create function public.publish_product(p_org uuid, p_product uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  sp public.suppliers;
  v_sup uuid;
  rev public.product_revisions;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  perform private.require_consent();
  perform private.check_rate_limit('product_publish:' || v_user, 200, interval '1 hour');
  select x.supplier_id into v_sup from public.products x where x.id = p_product and x.partner_org_id = p_org;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  select * into sp from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
  if sp.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_available'); end if;
  if p_expected_version is distinct from pr.version then
    if pr.status = 'published' and not exists (select 1 from public.product_revisions r where r.id = pr.pending_revision_id and r.status = 'approved') then
      return; -- a retry of a publish that already happened
    end if;
    perform private.raise_error('conflict', 'stale_version');
  end if;

  select * into rev from public.product_revisions r where r.id = pr.pending_revision_id and r.status = 'approved';
  if rev.id is null then
    if pr.status = 'published' then return; end if;
    if pr.status = 'unpublished' and pr.live_revision_id is not null then
      select * into rev from public.product_revisions r where r.id = pr.live_revision_id;
    end if;
  end if;
  if rev.id is null then perform private.raise_error('conflict', 'product_not_publishable'); end if;

  if pr.live_revision_id is distinct from rev.id or not exists (select 1 from public.catalogue_items ci where ci.product_id = pr.id) then
    perform private.materialise_product(pr.id, rev);
    update public.product_revisions set status = 'superseded' where id = pr.live_revision_id and id <> rev.id and status = 'published';
    update public.product_revisions set status = 'published', published_at = now() where id = rev.id;
  end if;
  update public.products set status = 'published', live_revision_id = rev.id,
    pending_revision_id = case when pending_revision_id = rev.id then null else pending_revision_id end,
    published_at = now(), unpublished_at = null, version = pr.version + 1, updated_at = now()
  where id = pr.id;
  perform private.write_audit('product.published', p_org, 'product', pr.id::text, jsonb_build_object('revision', rev.rev_no));
end;
$$;

create function public.unpublish_product(p_org uuid, p_product uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.products;
  v_sup uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  select x.supplier_id into v_sup from public.products x where x.id = p_product and x.partner_org_id = p_org;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  perform 1 from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if pr.status = 'unpublished' then return; end if;
  if pr.status <> 'published' then perform private.raise_error('conflict', 'product_not_published'); end if;
  update public.products set status = 'unpublished', unpublished_at = now(), version = pr.version + 1, updated_at = now() where id = pr.id;
  perform private.write_audit('product.unpublished', p_org, 'product', pr.id::text, '{}'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- Admin RPCs: review, suspend, reinstate
------------------------------------------------------------------------------------------------
create function public.review_product(p_product uuid, p_decision text, p_reason text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  sp public.suppliers;
  rev public.product_revisions;
  v_sup uuid;
  v_reason text;
  v_to text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('catalogue:review') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_changes') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  v_reason := private.clean_reason(p_reason, case when p_decision = 'approve' then 0 else 5 end);
  select x.supplier_id into v_sup from public.products x where x.id = p_product;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  select * into sp from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if private.has_partner_involvement(pr.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  select * into rev from public.product_revisions r where r.id = pr.pending_revision_id and r.status = 'submitted' for update;
  if rev.id is null then perform private.raise_error('conflict', 'product_not_pending'); end if;
  if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
  if p_expected_version is distinct from pr.version then perform private.raise_error('conflict', 'stale_version'); end if;
  if p_decision = 'approve' and sp.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_approved'); end if;

  v_to := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end;
  update public.product_revisions set status = v_to, decided_by = v_user, decided_at = now(), reason = v_reason where id = rev.id;
  update public.products set version = pr.version + 1, updated_at = now(),
    status = case when pr.status = 'submitted' then v_to::public.product_status else pr.status end
  where id = pr.id;
  perform private.write_audit('product.' || case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
    pr.partner_org_id, 'product', pr.id::text, jsonb_build_object('reason', v_reason, 'revision', rev.rev_no));
  perform private.notify_org(pr.partner_org_id, 'catalogue:manage', 'product.decided', 'product', pr.id::text);
end;
$$;

create function public.suspend_product(p_product uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  v_sup uuid;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not (private.has_platform_permission('catalogue:moderate') or private.has_platform_permission('catalogue:review')) then
    perform private.raise_error('forbidden');
  end if;
  select x.supplier_id into v_sup from public.products x where x.id = p_product;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  perform 1 from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if private.has_partner_involvement(pr.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if pr.status = 'suspended' then return; end if;
  if pr.status = 'draft' then perform private.raise_error('conflict', 'product_not_suspendable'); end if;
  update public.products set status = 'suspended', suspended_from = pr.status, suspended_reason = v_reason, suspended_at = now(),
    suspended_by = v_user, version = pr.version + 1, updated_at = now()
  where id = pr.id;
  perform private.write_audit('product.suspended', pr.partner_org_id, 'product', pr.id::text, jsonb_build_object('reason', v_reason, 'from', pr.status));
  perform private.notify_org(pr.partner_org_id, 'catalogue:manage', 'product.suspended', 'product', pr.id::text);
end;
$$;

-- Reinstating never puts a product back on sale by itself: a previously published product returns as `unpublished`.
create function public.reinstate_product(p_product uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pr public.products;
  v_sup uuid;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not (private.has_platform_permission('catalogue:moderate') or private.has_platform_permission('catalogue:review')) then
    perform private.raise_error('forbidden');
  end if;
  select x.supplier_id into v_sup from public.products x where x.id = p_product;
  if v_sup is null then perform private.raise_error('not_found'); end if;
  perform 1 from public.suppliers x where x.id = v_sup for share;
  select * into pr from public.products x where x.id = p_product for update;
  if private.has_partner_involvement(pr.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if pr.status <> 'suspended' then perform private.raise_error('conflict', 'product_not_suspended'); end if;
  update public.products set suspended_reason = null, version = pr.version + 1, updated_at = now(),
    status = case when pr.suspended_from = 'published' then 'unpublished'::public.product_status
                  else coalesce(pr.suspended_from, 'draft'::public.product_status) end
  where id = pr.id;
  perform private.write_audit('product.reinstated', pr.partner_org_id, 'product', pr.id::text, jsonb_build_object('reason', v_reason));
  perform private.notify_org(pr.partner_org_id, 'catalogue:manage', 'product.decided', 'product', pr.id::text);
end;
$$;

------------------------------------------------------------------------------------------------
-- Partner reads
------------------------------------------------------------------------------------------------
create function private.product_summary(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'supplier_id', p.supplier_id, 'sku', p.sku, 'status', p.status, 'name', p.draft ->> 'name',
    'version', p.version, 'draft_version', p.draft_version, 'live_revision_id', p.live_revision_id,
    'pending_revision', (select jsonb_build_object('id', r.id, 'rev_no', r.rev_no, 'status', r.status, 'reason', r.reason, 'decided_at', r.decided_at)
                         from public.product_revisions r where r.id = p.pending_revision_id),
    'has_unsubmitted_changes', p.submitted_draft_version is distinct from p.draft_version,
    'published_at', p.published_at, 'updated_at', p.updated_at)
  from public.products p where p.id = p_id
$$;

create function public.list_my_products(p_org uuid, p_supplier uuid default null, p_status text default null,
  p_offset integer default 0, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_total integer;
  v_items jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  if p_status is not null and p_status not in ('draft', 'submitted', 'changes_requested', 'approved', 'published', 'unpublished', 'rejected', 'suspended') then
    perform private.raise_error('invalid', 'invalid_status');
  end if;
  select count(*) into v_total from public.products p
  where p.partner_org_id = p_org and (p_supplier is null or p.supplier_id = p_supplier) and (p_status is null or p.status::text = p_status);
  select coalesce(jsonb_agg(private.product_summary(x.id) order by x.updated_at desc, x.id), '[]'::jsonb) into v_items
  from (select p.id, p.updated_at from public.products p
        where p.partner_org_id = p_org and (p_supplier is null or p.supplier_id = p_supplier) and (p_status is null or p.status::text = p_status)
        order by p.updated_at desc, p.id limit v_limit offset v_off) x;
  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_off, 'items', v_items);
end;
$$;

create function public.get_my_product(p_org uuid, p_product uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  select * into p from public.products x where x.id = p_product and x.partner_org_id = p_org;
  if p.id is null then perform private.raise_error('not_found'); end if;
  return private.product_summary(p.id) || jsonb_build_object(
    'draft', p.draft, 'suspended_reason', p.suspended_reason,
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'rev_no', r.rev_no, 'status', r.status, 'reason', r.reason,
        'submitted_at', r.submitted_at, 'decided_at', r.decided_at) order by r.rev_no desc)
        from public.product_revisions r where r.product_id = p.id), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'alt', m.alt, 'sort', m.sort, 'scan_status', m.scan_status,
        'approved', m.approved, 'mime_type', m.mime_type, 'size_bytes', m.size_bytes) order by m.sort, m.created_at)
        from public.product_media m where m.product_id = p.id and m.removed_at is null), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------------------------
-- Product media (service role uploads and scans; the browser never touches storage)
------------------------------------------------------------------------------------------------
create function public.service_register_product_media(
  p_org uuid, p_user uuid, p_product uuid, p_mime text, p_size bigint, p_sha256 text, p_storage_path text,
  p_scan_status public.scan_status, p_scan_engine text, p_alt text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.products;
  v_id uuid;
  v_alt text := nullif(btrim(coalesce(p_alt, '')), '');
begin
  if not exists (
    select 1 from public.memberships m
    join public.organisations o on o.id = m.org_id and o.status = 'active' and o.type = 'partner'
    join public.partner_profiles pp on pp.org_id = o.id and pp.status = 'approved'
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'catalogue:manage'
    where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
  ) then
    perform private.raise_error('forbidden');
  end if;
  select * into pr from public.products x where x.id = p_product and x.partner_org_id = p_org for update;
  if pr.id is null then perform private.raise_error('not_found'); end if;
  if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
  if p_storage_path is null or p_storage_path !~ ('^products/' || p_org::text || '/' || p_product::text || '/[A-Za-z0-9._-]{8,120}$') then
    perform private.raise_error('invalid', 'invalid_path');
  end if;
  if p_scan_status = 'infected' then perform private.raise_error('invalid', 'infected_not_stored'); end if;
  if (select count(*) from public.product_media m where m.product_id = p_product and m.removed_at is null) >= 8 then
    perform private.raise_error('conflict', 'media_limit_reached');
  end if;
  if v_alt is not null and (char_length(v_alt) > 200 or v_alt ~ '[[:cntrl:]]') then perform private.raise_error('invalid', 'invalid_alt'); end if;
  insert into public.product_media (product_id, partner_org_id, storage_path, mime_type, size_bytes, sha256, scan_status, scan_engine,
    scanned_at, alt, sort, uploaded_by)
  values (p_product, p_org, p_storage_path, p_mime, p_size, p_sha256, p_scan_status, left(p_scan_engine, 80),
    case when p_scan_status in ('clean', 'failed') then now() end, v_alt,
    (select coalesce(max(m.sort), 0) + 1 from public.product_media m where m.product_id = p_product), p_user)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.service_set_product_media_scan(p_media uuid, p_status public.scan_status, p_engine text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.product_media;
begin
  select * into m from public.product_media x where x.id = p_media for update;
  if m.id is null then perform private.raise_error('not_found'); end if;
  if p_status = 'pending' then perform private.raise_error('invalid', 'invalid_status'); end if;
  if not (m.scan_status in ('pending', 'failed') or (m.scan_status = 'clean' and p_status = 'infected')) then
    perform private.raise_error('conflict', 'already_scanned');
  end if;
  update public.product_media set scan_status = p_status, scan_engine = left(p_engine, 80), scanned_at = now(),
    approved = approved and p_status = 'clean' where id = p_media;
end;
$$;

create function public.service_list_unscanned_product_media(p_limit integer)
returns table (id uuid, storage_path text, mime_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.storage_path, m.mime_type from public.product_media m
  where m.scan_status in ('pending', 'failed') and m.removed_at is null
  order by coalesce(m.scanned_at, m.created_at), m.created_at
  limit least(greatest(p_limit, 1), 100)
$$;

create function public.update_product_media(p_media uuid, p_alt text, p_sort integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.product_media;
  v_alt text := nullif(btrim(coalesce(p_alt, '')), '');
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into m from public.product_media x where x.id = p_media for update;
  if m.id is null or m.removed_at is not null or not private.has_permission(m.partner_org_id, 'catalogue:manage') then
    perform private.raise_error('not_found');
  end if;
  perform private.assert_partner_active(m.partner_org_id);
  if v_alt is not null and (char_length(v_alt) > 200 or v_alt ~ '[[:cntrl:]]') then perform private.raise_error('invalid', 'invalid_alt'); end if;
  if p_sort is not null and p_sort not between 0 and 1000 then perform private.raise_error('invalid', 'invalid_sort'); end if;
  update public.product_media set alt = v_alt, sort = coalesce(p_sort, sort) where id = p_media;
end;
$$;

create function public.remove_product_media(p_media uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.product_media;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into m from public.product_media x where x.id = p_media for update;
  if m.id is null or m.removed_at is not null or not private.has_permission(m.partner_org_id, 'catalogue:manage') then
    perform private.raise_error('not_found');
  end if;
  perform private.assert_partner_active(m.partner_org_id);
  update public.product_media set removed_at = now(), approved = false where id = p_media;
  return m.storage_path;
end;
$$;

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.product_revisions enable row level security;
alter table public.catalogue_items enable row level security;
alter table public.catalogue_variants enable row level security;
alter table public.catalogue_price_tiers enable row level security;
alter table public.product_media enable row level security;

create policy products_select on public.products for select to authenticated
  using (private.is_member(partner_org_id) or (private.has_platform_permission('catalogue:review') and status <> 'draft'));
create policy product_revisions_select on public.product_revisions for select to authenticated
  using (private.is_member(partner_org_id) or private.has_platform_permission('catalogue:review'));
-- Live tables are readable exactly when the product row is (members of the owning partner, reviewers).
-- Buyers and the public read the catalogue only through the search/detail RPCs.
create policy catalogue_items_select on public.catalogue_items for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy catalogue_variants_select on public.catalogue_variants for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy catalogue_price_tiers_select on public.catalogue_price_tiers for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy product_media_select on public.product_media for select to authenticated
  using (private.is_member(partner_org_id) or (private.has_platform_permission('catalogue:review')
         and exists (select 1 from public.products p where p.id = product_id)));

grant select on public.products, public.product_revisions, public.catalogue_items, public.catalogue_variants,
  public.catalogue_price_tiers, public.product_media to authenticated;

revoke all on function
  private.product_revisions_immutable(), private.products_immutable_columns(), private.price_tiers_no_overlap(),
  private.bad_text(text, integer), private.parse_date(text), private.safe_numeric(text), private.valid_money(text),
  private.validate_product_data(jsonb, boolean), private.merge_product_draft(jsonb, jsonb), private.raise_first_error(text[]),
  private.materialise_product(uuid, public.product_revisions), private.product_summary(uuid),
  public.save_product_draft(uuid, uuid, uuid, jsonb, integer), public.submit_product(uuid, uuid, integer),
  public.publish_product(uuid, uuid, integer), public.unpublish_product(uuid, uuid),
  public.review_product(uuid, text, text, integer), public.suspend_product(uuid, text), public.reinstate_product(uuid, text),
  public.list_my_products(uuid, uuid, text, integer, integer), public.get_my_product(uuid, uuid),
  public.service_register_product_media(uuid, uuid, uuid, text, bigint, text, text, public.scan_status, text, text),
  public.service_set_product_media_scan(uuid, public.scan_status, text), public.service_list_unscanned_product_media(integer),
  public.update_product_media(uuid, text, integer), public.remove_product_media(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.save_product_draft(uuid, uuid, uuid, jsonb, integer), public.submit_product(uuid, uuid, integer),
  public.publish_product(uuid, uuid, integer), public.unpublish_product(uuid, uuid),
  public.review_product(uuid, text, text, integer), public.suspend_product(uuid, text), public.reinstate_product(uuid, text),
  public.list_my_products(uuid, uuid, text, integer, integer), public.get_my_product(uuid, uuid),
  public.update_product_media(uuid, text, integer), public.remove_product_media(uuid)
  to authenticated;

grant execute on function
  public.service_register_product_media(uuid, uuid, uuid, text, bigint, text, text, public.scan_status, text, text),
  public.service_set_product_media_scan(uuid, public.scan_status, text), public.service_list_unscanned_product_media(integer)
  to service_role;
