-- Redesign: the three additions the new workspace needs.
--   1. Products and services for regular businesses (draft -> in review -> live), reviewed by MITRA before they show on the profile.
--   2. News and bulletins: editorial posts, per-user topic preferences, saved posts, and a weekly digest claim table.
--   3. Owner dashboard: recommended cards a member dismissed for seven days.
-- Same rules as before: default-deny RLS, writes only through SECURITY DEFINER RPCs with search_path = '',
-- worker RPCs granted to service_role only, no new permission names (business:edit, listing:review, programme:publish).

------------------------------------------------------------------------------------------------
-- 1. Business products and services
------------------------------------------------------------------------------------------------
create table public.biz_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  kind text not null default 'product' check (kind in ('product', 'service')),
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 1000),
  price_cents integer check (price_cents between 0 and 100000000),
  unit text check (unit in ('piece', 'set', 'kg', 'hour', 'day', 'job')),
  min_order integer check (min_order between 1 and 1000000),
  ask_for_quote boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'live', 'changes_requested', 'rejected', 'archived')),
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index biz_products_org on public.biz_products (org_id, status);
create index biz_products_review on public.biz_products (submitted_at) where status = 'in_review';

alter table public.biz_products enable row level security;
create policy biz_products_select on public.biz_products for select to authenticated
  using (private.has_permission(org_id, 'business:edit') or private.has_platform_permission('listing:review'));
grant select on public.biz_products to authenticated;

create function private.assert_biz_org(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not exists (select 1 from public.organisations o where o.id = p_org and o.type = 'business' and o.status = 'active') then
    perform private.raise_error('not_found');
  end if;
  if not private.has_permission(p_org, 'business:edit') then perform private.raise_error('not_found'); end if;
end;
$$;

create function public.biz_product_save(p_org uuid, p_id uuid, p_data jsonb, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  r public.biz_products;
  v_kind text; v_name text; v_desc text; v_price integer; v_unit text; v_min integer; v_ask boolean;
begin
  perform private.assert_biz_org(p_org);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_kind := coalesce(nullif(p_data ->> 'kind', ''), 'product');
  v_name := btrim(coalesce(p_data ->> 'name', ''));
  v_desc := nullif(btrim(coalesce(p_data ->> 'description', '')), '');
  v_ask := coalesce((p_data ->> 'ask_for_quote') = 'true', false);
  begin
    v_price := nullif(btrim(coalesce(p_data ->> 'price_cents', '')), '')::integer;
    v_min := nullif(btrim(coalesce(p_data ->> 'min_order', '')), '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  v_unit := nullif(btrim(coalesce(p_data ->> 'unit', '')), '');
  if v_kind not in ('product', 'service') or char_length(v_name) < 2 or char_length(v_name) > 120
     or char_length(coalesce(v_desc, '')) > 1000 or v_price < 0 or v_price > 100000000 or v_min < 1 or v_min > 1000000
     or (v_unit is not null and v_unit not in ('piece', 'set', 'kg', 'hour', 'day', 'job')) then
    perform private.raise_error('invalid', 'invalid_data');
  end if;
  if v_ask then v_price := null; end if;

  if p_id is null then
    if (select count(*) from public.biz_products where org_id = p_org and status <> 'archived') >= 200 then
      perform private.raise_error('conflict', 'limit_reached');
    end if;
    insert into public.biz_products (org_id, kind, name, description, price_cents, unit, min_order, ask_for_quote, created_by)
    values (p_org, v_kind, v_name, v_desc, v_price, v_unit, v_min, v_ask, auth.uid()) returning * into r;
    perform private.write_audit('biz.product.created', p_org, 'biz_product', r.id::text, jsonb_build_object('kind', v_kind));
  else
    select * into r from public.biz_products where id = p_id and org_id = p_org for update;
    if r.id is null or r.status = 'archived' then perform private.raise_error('not_found'); end if;
    if r.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
    -- A change always goes back to draft: what the public sees is only ever what MITRA reviewed.
    update public.biz_products set kind = v_kind, name = v_name, description = v_desc, price_cents = v_price, unit = v_unit,
      min_order = v_min, ask_for_quote = v_ask, status = 'draft', review_note = null, version = version + 1, updated_at = now()
    where id = p_id returning * into r;
    perform private.write_audit('biz.product.updated', p_org, 'biz_product', r.id::text, jsonb_build_object('kind', v_kind));
  end if;
  return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status);
end;
$$;

create function public.biz_product_submit(p_org uuid, p_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare r public.biz_products;
begin
  perform private.assert_biz_org(p_org);
  select * into r from public.biz_products where id = p_id and org_id = p_org for update;
  if r.id is null or r.status = 'archived' then perform private.raise_error('not_found'); end if;
  if r.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
  if r.status not in ('draft', 'changes_requested') then perform private.raise_error('conflict', 'state'); end if;
  if not r.ask_for_quote and r.price_cents is null then perform private.raise_error('invalid', 'price_required'); end if;
  update public.biz_products set status = 'in_review', submitted_at = now(), review_note = null, version = version + 1, updated_at = now()
    where id = p_id returning * into r;
  perform private.write_audit('biz.product.submitted', p_org, 'biz_product', r.id::text, '{}'::jsonb);
  return jsonb_build_object('id', r.id, 'version', r.version, 'status', r.status);
end;
$$;

create function public.biz_product_archive(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  perform private.assert_biz_org(p_org);
  update public.biz_products set status = 'archived', version = version + 1, updated_at = now()
    where id = p_id and org_id = p_org and status <> 'archived';
  if not found then perform private.raise_error('not_found'); end if;
  perform private.write_audit('biz.product.archived', p_org, 'biz_product', p_id::text, '{}'::jsonb);
end;
$$;

create function public.admin_biz_products(p_status text) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('listing:review') then perform private.raise_error('not_found'); end if;
  if p_status is not null and p_status not in ('draft', 'in_review', 'live', 'changes_requested', 'rejected', 'archived') then
    perform private.raise_error('invalid', 'state');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'org_id', x.org_id, 'org_name', x.org_name, 'kind', x.kind, 'name', x.name,
      'description', x.description, 'price_cents', x.price_cents, 'unit', x.unit, 'min_order', x.min_order, 'ask_for_quote', x.ask_for_quote,
      'status', x.status, 'review_note', x.review_note, 'submitted_at', x.submitted_at, 'version', x.version) order by x.submitted_at nulls last, x.created_at)
    from (select p.*, o.name org_name from public.biz_products p join public.organisations o on o.id = p.org_id
          where (p_status is null and p.status <> 'archived' and p.status <> 'draft' or p.status = p_status) order by p.submitted_at nulls last, p.created_at limit 200) x
  ), '[]'::jsonb);
end;
$$;

create function public.admin_biz_product_decide(p_id uuid, p_decision text, p_note text, p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as
$$
declare r public.biz_products; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_status text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('listing:review') then perform private.raise_error('not_found'); end if;
  if p_decision not in ('approve', 'request_changes', 'reject') then perform private.raise_error('invalid', 'decision'); end if;
  if char_length(coalesce(v_note, '')) > 500 or (p_decision <> 'approve' and char_length(coalesce(v_note, '')) < 5) then
    perform private.raise_error('invalid', 'reason');
  end if;
  select * into r from public.biz_products where id = p_id for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if r.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
  if r.status <> 'in_review' then perform private.raise_error('conflict', 'already_decided'); end if;
  v_status := case p_decision when 'approve' then 'live' when 'request_changes' then 'changes_requested' else 'rejected' end;
  update public.biz_products set status = v_status, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now(),
    version = version + 1, updated_at = now() where id = p_id;
  perform private.write_audit('biz.product.' || p_decision, r.org_id, 'biz_product', p_id::text, jsonb_build_object('status', v_status));
end;
$$;

create function public.public_biz_products(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_org uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,80}$' then return '[]'::jsonb; end if;
  select l.org_id into v_org from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
    where l.slug = p_slug and l.live_status = 'published';
  if v_org is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'name', p.name, 'description', p.description,
      'price_cents', p.price_cents, 'unit', p.unit, 'min_order', p.min_order, 'ask_for_quote', p.ask_for_quote) order by p.created_at)
    from public.biz_products p where p.org_id = v_org and p.status = 'live'), '[]'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. News and bulletins
------------------------------------------------------------------------------------------------
create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  summary text not null check (char_length(summary) between 10 and 400),
  body text not null check (char_length(body) between 10 and 20000),
  category text not null check (category in ('grants', 'training', 'deadlines', 'community')),
  sectors text[] not null default '{}',
  states text[] not null default '{}',
  language text not null default 'en' check (language in ('en', 'ta', 'ms')),
  deadline_on date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  author_id uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(sectors) <= 20 and cardinality(states) <= 20)
);
create index news_posts_pub on public.news_posts (status, publish_at desc);

create table public.news_saved (
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.news_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.news_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  grants boolean not null default true,
  training boolean not null default true,
  deadlines boolean not null default true,
  community boolean not null default true,
  weekly_email boolean not null default false,
  language text not null default 'en' check (language in ('en', 'ta', 'ms')),
  updated_at timestamptz not null default now()
);

create table public.news_digests (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  claimed_at timestamptz not null default now(),
  primary key (user_id, week_key)
);

alter table public.news_posts enable row level security;
alter table public.news_saved enable row level security;
alter table public.news_prefs enable row level security;
alter table public.news_digests enable row level security;
create policy news_posts_staff on public.news_posts for select to authenticated using (private.has_platform_permission('programme:publish'));
create policy news_saved_own on public.news_saved for select to authenticated using (user_id = auth.uid());
create policy news_prefs_own on public.news_prefs for select to authenticated using (user_id = auth.uid());
create policy news_digests_own on public.news_digests for select to authenticated using (user_id = auth.uid());
grant select on public.news_posts, public.news_saved, public.news_prefs to authenticated;

create function private.news_visible(p public.news_posts) returns boolean
language sql stable set search_path = '' as
$$ select p.status = 'published' and coalesce(p.publish_at, p.created_at) <= now(); $$;

create function public.news_list(p_category text, p_language text, p_sector text, p_state text, p_saved_only boolean, p_limit integer, p_offset integer) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50); v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000); v_total integer; v_items jsonb;
begin
  if p_category is not null and p_category not in ('grants', 'training', 'deadlines', 'community') then perform private.raise_error('invalid', 'invalid_data'); end if;
  if p_language is not null and p_language not in ('en', 'ta', 'ms') then perform private.raise_error('invalid', 'invalid_data'); end if;
  if coalesce(p_saved_only, false) and auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  with base as (
    select n.* from public.news_posts n
    where private.news_visible(n)
      and (p_category is null or n.category = p_category)
      and (p_language is null or n.language = p_language)
      and (p_sector is null or cardinality(n.sectors) = 0 or p_sector = any (n.sectors))
      and (p_state is null or cardinality(n.states) = 0 or p_state = any (n.states))
      and (not coalesce(p_saved_only, false) or exists (select 1 from public.news_saved s where s.post_id = n.id and s.user_id = auth.uid()))
  )
  select (select count(*) from base),
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'summary', x.summary, 'category', x.category, 'sectors', x.sectors,
      'states', x.states, 'language', x.language, 'deadline_on', x.deadline_on, 'published_at', coalesce(x.publish_at, x.created_at),
      'saved', auth.uid() is not null and exists (select 1 from public.news_saved s where s.post_id = x.id and s.user_id = auth.uid())) order by coalesce(x.publish_at, x.created_at) desc, x.id)
      from (select * from base order by coalesce(publish_at, created_at) desc, id offset v_off limit v_limit) x), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create function public.news_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare n public.news_posts;
begin
  select * into n from public.news_posts where id = p_id;
  if n.id is null or not private.news_visible(n) then perform private.raise_error('not_found'); end if;
  return jsonb_build_object('id', n.id, 'title', n.title, 'summary', n.summary, 'body', n.body, 'category', n.category, 'sectors', n.sectors,
    'states', n.states, 'language', n.language, 'deadline_on', n.deadline_on, 'published_at', coalesce(n.publish_at, n.created_at),
    'saved', auth.uid() is not null and exists (select 1 from public.news_saved s where s.post_id = n.id and s.user_id = auth.uid()));
end;
$$;

create function public.news_deadlines(p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'deadline_on', x.deadline_on) order by x.deadline_on, x.id), '[]'::jsonb)
  from (select n.id, n.title, n.deadline_on from public.news_posts n
        where private.news_visible(n) and n.deadline_on is not null and n.deadline_on >= current_date
        order by n.deadline_on, n.id limit least(greatest(coalesce(p_limit, 5), 1), 20)) x;
$$;

create function public.news_save(p_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$
declare n public.news_posts;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into n from public.news_posts where id = p_id;
  if n.id is null or not private.news_visible(n) then perform private.raise_error('not_found'); end if;
  insert into public.news_saved (user_id, post_id) values (auth.uid(), p_id) on conflict do nothing;
end;
$$;

create function public.news_unsave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  delete from public.news_saved where user_id = auth.uid() and post_id = p_id;
end;
$$;

create function public.news_get_prefs() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare p public.news_prefs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into p from public.news_prefs where user_id = auth.uid();
  if p.user_id is null then
    return jsonb_build_object('grants', true, 'training', true, 'deadlines', true, 'community', true, 'weekly_email', false, 'language', 'en');
  end if;
  return jsonb_build_object('grants', p.grants, 'training', p.training, 'deadlines', p.deadlines, 'community', p.community,
    'weekly_email', p.weekly_email, 'language', p.language);
end;
$$;

create function public.news_set_prefs(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as
$$
declare c public.news_prefs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  if p_data ? 'language' and (p_data ->> 'language') not in ('en', 'ta', 'ms') then perform private.raise_error('invalid', 'invalid_data'); end if;
  insert into public.news_prefs (user_id) values (auth.uid()) on conflict do nothing;
  select * into c from public.news_prefs where user_id = auth.uid() for update;
  update public.news_prefs set
    grants = coalesce((p_data ->> 'grants')::boolean, grants),
    training = coalesce((p_data ->> 'training')::boolean, training),
    deadlines = coalesce((p_data ->> 'deadlines')::boolean, deadlines),
    community = coalesce((p_data ->> 'community')::boolean, community),
    weekly_email = coalesce((p_data ->> 'weekly_email')::boolean, weekly_email),
    language = coalesce(p_data ->> 'language', language),
    updated_at = now()
  where user_id = auth.uid();
exception when invalid_text_representation then
  perform private.raise_error('invalid', 'invalid_data');
end;
$$;

-- Staff
create function private.assert_news_staff() returns void
language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('programme:publish') then perform private.raise_error('not_found'); end if;
end;
$$;

create function public.admin_news_list() returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
begin
  perform private.assert_news_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'summary', n.summary, 'category', n.category, 'language', n.language,
    'status', n.status, 'publish_at', n.publish_at, 'deadline_on', n.deadline_on, 'version', n.version, 'updated_at', n.updated_at,
    'sectors', n.sectors, 'states', n.states, 'live', private.news_visible(n)) order by n.updated_at desc)
    from (select * from public.news_posts order by updated_at desc limit 200) n), '[]'::jsonb);
end;
$$;

create function public.admin_news_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare n public.news_posts;
begin
  perform private.assert_news_staff();
  select * into n from public.news_posts where id = p_id;
  if n.id is null then perform private.raise_error('not_found'); end if;
  return to_jsonb(n) - 'author_id';
end;
$$;

create function public.admin_news_save(p_id uuid, p_data jsonb, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  n public.news_posts;
  v_title text; v_summary text; v_body text; v_cat text; v_lang text; v_deadline date; v_publish timestamptz;
  v_sectors text[]; v_states text[];
begin
  perform private.assert_news_staff();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_title := btrim(coalesce(p_data ->> 'title', '')); v_summary := btrim(coalesce(p_data ->> 'summary', '')); v_body := btrim(coalesce(p_data ->> 'body', ''));
  v_cat := p_data ->> 'category'; v_lang := coalesce(nullif(p_data ->> 'language', ''), 'en');
  begin
    v_deadline := nullif(p_data ->> 'deadline_on', '')::date;
    v_publish := nullif(p_data ->> 'publish_at', '')::timestamptz;
    v_sectors := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_data -> 'sectors', '[]'::jsonb)) x where btrim(x) ~ '^[a-z0-9-]{2,40}$'), '{}');
    v_states := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_data -> 'states', '[]'::jsonb)) x where btrim(x) <> '' and char_length(btrim(x)) <= 40), '{}');
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  if char_length(v_title) not between 3 and 160 or char_length(v_summary) not between 10 and 400 or char_length(v_body) not between 10 and 20000
     or v_cat not in ('grants', 'training', 'deadlines', 'community') or v_lang not in ('en', 'ta', 'ms') then
    perform private.raise_error('invalid', 'invalid_data');
  end if;
  if p_id is null then
    insert into public.news_posts (title, summary, body, category, sectors, states, language, deadline_on, publish_at, author_id)
    values (v_title, v_summary, v_body, v_cat, v_sectors, v_states, v_lang, v_deadline, v_publish, auth.uid()) returning * into n;
    perform private.write_audit('news.created', null, 'news_post', n.id::text, jsonb_build_object('category', v_cat));
  else
    select * into n from public.news_posts where id = p_id for update;
    if n.id is null then perform private.raise_error('not_found'); end if;
    if n.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
    update public.news_posts set title = v_title, summary = v_summary, body = v_body, category = v_cat, sectors = v_sectors, states = v_states,
      language = v_lang, deadline_on = v_deadline, publish_at = v_publish, version = version + 1, updated_at = now()
    where id = p_id returning * into n;
    perform private.write_audit('news.updated', null, 'news_post', n.id::text, jsonb_build_object('category', v_cat));
  end if;
  return jsonb_build_object('id', n.id, 'version', n.version, 'status', n.status);
end;
$$;

create function public.admin_news_set_status(p_id uuid, p_status text, p_publish_at timestamptz, p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as
$$
declare n public.news_posts;
begin
  perform private.assert_news_staff();
  if p_status not in ('draft', 'published', 'archived') then perform private.raise_error('invalid', 'state'); end if;
  select * into n from public.news_posts where id = p_id for update;
  if n.id is null then perform private.raise_error('not_found'); end if;
  if n.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
  update public.news_posts set status = p_status,
    publish_at = case when p_status = 'published' then coalesce(p_publish_at, now()) else publish_at end,
    version = version + 1, updated_at = now() where id = p_id;
  perform private.write_audit('news.' || p_status, null, 'news_post', p_id::text, '{}'::jsonb);
end;
$$;

-- Weekly digest (service role only): who wants it, what to send, and an at-most-once claim per user and ISO week.
create function public.news_digest_candidates() returns jsonb
language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', u.email, 'language', p.language,
    'topics', array_remove(array[case when p.grants then 'grants' end, case when p.training then 'training' end,
      case when p.deadlines then 'deadlines' end, case when p.community then 'community' end], null))), '[]'::jsonb)
  from public.news_prefs p join auth.users u on u.id = p.user_id
  where p.weekly_email and u.email is not null and u.email_confirmed_at is not null;
$$;

create function public.news_digest_posts(p_since timestamptz, p_language text, p_topics text[]) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'summary', x.summary, 'category', x.category) order by x.at desc), '[]'::jsonb)
  from (select n.id, n.title, n.summary, n.category, coalesce(n.publish_at, n.created_at) at from public.news_posts n
        where private.news_visible(n) and coalesce(n.publish_at, n.created_at) >= p_since and n.language = p_language and n.category = any (p_topics)
        order by coalesce(n.publish_at, n.created_at) desc limit 8) x;
$$;

create function public.news_digest_claim(p_user uuid, p_week text) returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_n integer;
begin
  insert into public.news_digests (user_id, week_key) values (p_user, p_week) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

create function public.news_digest_release(p_user uuid, p_week text) returns void
language sql security definer set search_path = '' as
$$ delete from public.news_digests where user_id = p_user and week_key = p_week; $$;

------------------------------------------------------------------------------------------------
-- 3. Dashboard: recommended cards dismissed for seven days
------------------------------------------------------------------------------------------------
create table public.dash_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organisations (id) on delete cascade,
  card_key text not null check (card_key ~ '^[a-z0-9:_-]{2,80}$'),
  dismissed_until timestamptz not null,
  primary key (user_id, org_id, card_key)
);
alter table public.dash_dismissals enable row level security;
create policy dash_dismissals_own on public.dash_dismissals for select to authenticated using (user_id = auth.uid());
grant select on public.dash_dismissals to authenticated;

create function public.dash_dismiss(p_org uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active') then
    perform private.raise_error('not_found');
  end if;
  if p_key is null or p_key !~ '^[a-z0-9:_-]{2,80}$' then perform private.raise_error('invalid', 'invalid_data'); end if;
  insert into public.dash_dismissals (user_id, org_id, card_key, dismissed_until) values (auth.uid(), p_org, p_key, now() + interval '7 days')
  on conflict (user_id, org_id, card_key) do update set dismissed_until = excluded.dismissed_until;
end;
$$;

create function public.dash_active_dismissals(p_org uuid) returns text[]
language sql stable security definer set search_path = '' as
$$
  select coalesce(array_agg(card_key), '{}') from public.dash_dismissals
  where user_id = auth.uid() and org_id = p_org and dismissed_until > now();
$$;

------------------------------------------------------------------------------------------------
-- Grants (default deny; everything is explicit)
------------------------------------------------------------------------------------------------
revoke all on function
  private.assert_biz_org(uuid), private.news_visible(public.news_posts), private.assert_news_staff(),
  public.biz_product_save(uuid, uuid, jsonb, integer), public.biz_product_submit(uuid, uuid, integer), public.biz_product_archive(uuid, uuid),
  public.admin_biz_products(text), public.admin_biz_product_decide(uuid, text, text, integer), public.public_biz_products(text),
  public.news_list(text, text, text, text, boolean, integer, integer), public.news_get(uuid), public.news_deadlines(integer),
  public.news_save(uuid), public.news_unsave(uuid), public.news_get_prefs(), public.news_set_prefs(jsonb),
  public.admin_news_list(), public.admin_news_get(uuid), public.admin_news_save(uuid, jsonb, integer), public.admin_news_set_status(uuid, text, timestamptz, integer),
  public.news_digest_candidates(), public.news_digest_posts(timestamptz, text, text[]), public.news_digest_claim(uuid, text), public.news_digest_release(uuid, text),
  public.dash_dismiss(uuid, text), public.dash_active_dismissals(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.biz_product_save(uuid, uuid, jsonb, integer), public.biz_product_submit(uuid, uuid, integer), public.biz_product_archive(uuid, uuid),
  public.admin_biz_products(text), public.admin_biz_product_decide(uuid, text, text, integer),
  public.news_save(uuid), public.news_unsave(uuid), public.news_get_prefs(), public.news_set_prefs(jsonb),
  public.admin_news_list(), public.admin_news_get(uuid), public.admin_news_save(uuid, jsonb, integer), public.admin_news_set_status(uuid, text, timestamptz, integer),
  public.dash_dismiss(uuid, text), public.dash_active_dismissals(uuid)
  to authenticated;
-- Public reading: the listing page and the news feed work for signed-out visitors too.
grant execute on function public.public_biz_products(text), public.news_list(text, text, text, text, boolean, integer, integer),
  public.news_get(uuid), public.news_deadlines(integer) to anon, authenticated;
grant execute on function public.news_digest_candidates(), public.news_digest_posts(timestamptz, text, text[]),
  public.news_digest_claim(uuid, text), public.news_digest_release(uuid, text) to service_role;
