-- Everything below runs inside one transaction that is rolled back: no data survives the test file.
-- Synthetic users only (@example.test). Helper schema "tt" lives only for this transaction.
begin;
create extension if not exists pgtap with schema extensions;

create schema tt;
grant usage on schema tt to public;

create table tt.u (name text primary key, id uuid not null default gen_random_uuid(), email text not null);
grant select on tt.u to public;

create function tt.mkuser(p_name text, p_confirmed boolean default true, p_consent boolean default true) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := p_name || '@example.test';
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated', v_email, case when p_confirmed then now() end, '{}'::jsonb,
    case when p_consent then '{"consents":{"terms":"2026-07","privacy":"2026-07"}}'::jsonb else '{}'::jsonb end, now(), now());
  insert into tt.u (name, id, email) values (p_name, v_id, v_email);
  return v_id;
end $$;

create function tt.uid(p_name text) returns uuid language sql stable as $$ select id from tt.u where name = p_name $$;

-- Become an authenticated API user with a given aal (same GUCs PostgREST sets).
create function tt.act(p_name text, p_aal text default 'aal1') returns void
language plpgsql as $$
declare v tt.u;
begin
  reset role;
  select * into v from tt.u where name = p_name;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'role', 'authenticated', 'email', v.email, 'aal', p_aal)::text, true);
  set local role authenticated;
end $$;

create function tt.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $$;

create function tt.svc() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;

create function tt.pg() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Setup helpers (run as postgres).
create function tt.fresh_mitra() returns void language plpgsql as $$
begin
  perform tt.pg();
  delete from public.organisations where type = 'mitra';
  update private.bootstrap_state set completed_at = null, completed_user_id = null;
end $$;

create function tt.mkorg(p_type public.org_type, p_name text, p_owner text, p_role public.member_role default 'owner')
returns uuid language plpgsql as $$
declare v_org uuid;
begin
  perform tt.pg();
  insert into public.organisations (type, name, created_by) values (p_type, p_name, tt.uid(p_owner)) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, tt.uid(p_owner), p_role);
  return v_org;
end $$;

create function tt.addm(p_org uuid, p_user text, p_role public.member_role) returns void language plpgsql as $$
begin
  perform tt.pg();
  insert into public.memberships (org_id, user_id, role) values (p_org, tt.uid(p_user), p_role);
end $$;

-- Org ids by label, usable from any role inside SQL strings.
create table tt.o (label text primary key, id uuid not null);
grant select,insert on tt.o to public;
create function tt.oid(p_label text) returns uuid language sql stable as $$ select id from tt.o where label = p_label $$;
create function tt.reg(p_label text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.o (label, id) values (p_label, p_id);
  return p_id;
end $$;

-- ---------- Phase 2 helpers (setup runs as postgres; assertions run as the acting role) ----------
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label=p_label $$;

-- ---------- Phase 5 fixtures (setup runs as postgres) ----------
create table tt.j (label text primary key, j jsonb);
grant select, insert, update on tt.j to public;
create function tt.ids_set(p_label text, p_j jsonb) returns void language sql as $$
  insert into tt.j (label, j) values (p_label, p_j) on conflict (label) do update set j = excluded.j
$$;
create function tt.idj(p_label text) returns jsonb language sql stable as $$ select j from tt.j where label = p_label $$;
create function tt.jid(p_label text) returns uuid language sql stable as $$ select (j ->> 'id')::uuid from tt.j where label = p_label $$;

create function tt.mk_partner(p_label text, p_owner text, p_status public.partner_status default 'approved') returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := tt.mkorg('partner', p_label, p_owner);
  insert into public.partner_profiles (org_id, status, display_name, decided_at, decision_reason)
  values (v, p_status, p_label, now(), 'fixture');
  insert into tt.o (label, id) values (p_label, v);
  return v;
end $$;

create function tt.mk_supplier(p_label text, p_partner uuid, p_name text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tt.pg();
  insert into public.suppliers (partner_org_id, code, status, draft, live_name, live_country, live_state_city, live_main_category,
    live_description, review_checks, reviewed_at, draft_version, live_draft_version)
  values (p_partner, upper(left(p_label, 6)), 'approved', jsonb_build_object('name', p_name), p_name, 'India', 'Surat, Gujarat',
    'textiles-apparel', 'Synthetic supplier description for tests', array['contact_reachable'], now(), 1, 1)
  returning id into v;
  insert into tt.ids (label, id) values (p_label, v);
  return v;
end $$;

create function tt.good_data(p_sku text, p_name text default 'Cotton tee shirt') returns jsonb language sql stable as $$
  select jsonb_build_object('sku', p_sku, 'name', p_name, 'description', 'Synthetic product description for the database tests.',
    'category_slug', 'textiles-apparel', 'unit', 'pcs', 'moq', 100, 'currency', 'INR', 'price_mode', 'tiers',
    'tiers', jsonb_build_array(jsonb_build_object('min_qty', 1, 'max_qty', 499, 'unit_price', '10.50'),
                               jsonb_build_object('min_qty', 500, 'unit_price', '9.75')),
    'price_confirmed_on', to_char(current_date, 'YYYY-MM-DD'), 'availability_status', 'available',
    'availability_confirmed_on', to_char(current_date, 'YYYY-MM-DD'), 'lead_time_min_days', 7, 'lead_time_max_days', 14)
$$;

-- A published product without going through the RPCs (fast fixture for search/buyer tests).
create function tt.mk_published(p_label text, p_supplier uuid, p_data jsonb) returns uuid language plpgsql as $$
declare
  v_p uuid; v_r uuid; v_partner uuid;
begin
  perform tt.pg();
  select partner_org_id into v_partner from public.suppliers where id = p_supplier;
  insert into public.products (supplier_id, partner_org_id, sku, status, draft, draft_version, submitted_draft_version, version)
  values (p_supplier, v_partner, p_data ->> 'sku', 'published', p_data, 1, 1, 3) returning id into v_p;
  insert into public.product_revisions (product_id, partner_org_id, rev_no, data, status, published_at)
  values (v_p, v_partner, 1, p_data, 'published', now()) returning id into v_r;
  update public.products set live_revision_id = v_r, published_at = now() where id = v_p;
  perform private.materialise_product(v_p, (select r from public.product_revisions r where r.id = v_r));
  insert into tt.ids (label, id) values (p_label, v_p);
  return v_p;
end $$;

select plan(181);
create function tt.ve(d jsonb, p_strict boolean default false) returns text[] language sql as $$ select private.validate_product_data(d, p_strict) $$;
create function tt.pv(p_label text) returns integer language sql stable as $$ select version from public.products where id = tt.jid(p_label) $$;
create function tt.dv(p_label text) returns integer language sql stable as $$ select draft_version from public.products where id = tt.jid(p_label) $$;
create function tt.srch(p_q text) returns jsonb language sql stable as $$ select public.search_catalogue(p_q) $$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_rev2','tt_adm_sup','tt_p1_owner','tt_p1_mgr','tt_p1_staff','tt_p1_view',
  'tt_p2_owner','tt_buyer']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_rev2', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_sup', 'admin_support');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_mgr', 'manager');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P2', 'tt_p2_owner');
select tt.reg('B', tt.mkorg('buyer', 'Buyer P5', 'tt_buyer'));
insert into public.memberships (org_id, user_id, role, status, removed_at) values (tt.oid('P1'), tt.uid('tt_adm_rev2'), 'staff', 'removed', now());
select tt.mk_supplier('SA', tt.oid('P1'), 'Alpha Weavers Zq5');
select tt.mk_supplier('SB', tt.oid('P2'), 'Beta Mills Zq5');
select tt.pg();
insert into public.suppliers (partner_org_id, code, status, draft) values (tt.oid('P1'), 'DRAFT1', 'draft', '{"name":"Unapproved Zq5"}');
insert into tt.ids (label, id) select 'SD', id from public.suppliers where code = 'DRAFT1';

-- ===================== V: validator (private.validate_product_data) =====================
select is(tt.ve(tt.good_data('V-1'), true), array[]::text[], 'V1 a complete product is valid in strict mode');
select is(tt.ve('{}'::jsonb, false), array[]::text[], 'V2 an empty draft is valid in lenient mode');
select ok(tt.ve('{}'::jsonb, true) @> array['name_required','unit_required','moq_required','category_required','price_mode_required','availability_required'], 'V3 strict mode lists every missing required field');
select ok(tt.ve(tt.good_data('V-1') || '{"moq":0}', false) @> array['invalid_moq'], 'V4 MOQ zero is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"moq":-5}', false) @> array['invalid_moq'], 'V5 negative MOQ is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"moq":"abc"}', false) @> array['invalid_moq'], 'V6 non-numeric MOQ is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"moq":"12.5"}', false) = array[]::text[], 'V7 a decimal MOQ (kg) is allowed');
select ok(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","tiers":null,"unit_price":"10.505"}', false) @> array['invalid_price'], 'V8 more than two decimals is refused (exact money)');
select ok(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","tiers":null,"unit_price":"0"}', false) @> array['invalid_price'], 'V9 a zero price is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","tiers":null,"unit_price":"-3.00"}', false) @> array['invalid_price'], 'V10 a negative price is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","tiers":null,"unit_price":"12,50"}', false) @> array['invalid_price'], 'V11 a comma decimal is refused');
select is(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","tiers":null,"unit_price":12.5}', true), array[]::text[], 'V12 a JSON number price is accepted exactly');
select ok(tt.ve(tt.good_data('V-1') || '{"currency":"EUR"}', false) @> array['invalid_currency'], 'V13 only INR, MYR and USD are accepted');
select is(tt.ve(tt.good_data('V-1') || '{"currency":"USD"}', true), array[]::text[], 'V14 USD is accepted');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":1,"max_qty":10,"unit_price":"5"},{"min_qty":10,"max_qty":20,"unit_price":"4"},{"min_qty":21,"unit_price":"3"}]}', false) @> array['tier_overlap'], 'V15 overlapping tiers are refused');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":1,"max_qty":10,"unit_price":"5"},{"min_qty":12,"unit_price":"3"}]}', false) @> array['tier_gap'], 'V16 gaps between tiers are refused (every quantity must be priced)');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":1,"max_qty":10,"unit_price":"5"},{"min_qty":11,"max_qty":20,"unit_price":"4"}]}', false) @> array['tier_last_not_open'], 'V17 the last tier must be open-ended');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":11,"unit_price":"4"},{"min_qty":1,"max_qty":10,"unit_price":"5"}]}', false) @> array['tier_not_ascending'], 'V18 tiers must be listed in ascending order');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":1,"unit_price":"5"},{"min_qty":5,"max_qty":10,"unit_price":"4"}]}', false) @> array['tier_overlap'], 'V19 an open-ended tier in the middle is an overlap');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":0,"unit_price":"5"}]}', false) @> array['invalid_tier_qty:1'], 'V20 a tier minimum below 1 is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":-4,"unit_price":"5"}]}', false) @> array['invalid_tier_qty:1'], 'V21 a negative tier minimum is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":10,"max_qty":5,"unit_price":"5"}]}', false) @> array['invalid_tier_qty:1'], 'V22 max below min is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":1,"unit_price":"0"}]}', false) @> array['invalid_price:tiers[1]'], 'V23 a zero tier price is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"tiers":[{"min_qty":200,"unit_price":"5"}]}', true) @> array['tier_does_not_cover_moq'], 'V24 the first tier must start at or below the MOQ (strict)');
select ok(tt.ve(tt.good_data('V-1') || '{"price_mode":"fixed","unit_price":"4"}', true) @> array['tiers_not_allowed'], 'V25 fixed price with tiers is refused (strict)');
select ok(tt.ve(tt.good_data('V-1') || '{"unit_price":"4"}', true) @> array['unit_price_not_allowed'], 'V26 tier mode with a fixed price is refused (strict)');
select ok(tt.ve((tt.good_data('V-1') - 'tiers') || '{"price_mode":"request","unit_price":"4"}', true) @> array['price_not_allowed'], 'V27 price on request must not carry a price (strict)');
select is(tt.ve((tt.good_data('V-1') - 'tiers' - 'currency' - 'price_confirmed_on') || '{"price_mode":"request"}', true), array[]::text[], 'V28 price on request needs no currency or price date');
select ok(tt.ve((tt.good_data('V-1') - 'tiers') || '{"price_mode":"fixed"}', true) @> array['price_required'], 'V29 a fixed price is required in fixed mode');
select ok(tt.ve(tt.good_data('V-1') - 'currency', true) @> array['currency_required'], 'V30 a currency is required when there is a price');
select ok(tt.ve(tt.good_data('V-1') - 'price_confirmed_on', true) @> array['price_date_required'], 'V31 a price confirmation date is required');
select is(tt.ve(tt.good_data('V-1') || '{"variants":[{"sku":"V-1-RED","label":"Red"},{"sku":"V-1-BLUE","label":"Blue","moq":50}],"tiers":[{"min_qty":1,"max_qty":499,"unit_price":"10.50"},{"min_qty":500,"unit_price":"9.75"},{"variant_sku":"V-1-RED","min_qty":1,"unit_price":"11.00"}]}', true),
  array[]::text[], 'V32 variants and variant-specific tiers are valid');
select ok(tt.ve(tt.good_data('V-1') || '{"variants":[{"sku":"A","label":"Red"}],"tiers":[{"min_qty":1,"unit_price":"10"},{"variant_sku":"ZZ","min_qty":1,"unit_price":"11"}]}', false) @> array['tier_unknown_variant:2'], 'V33 a tier for an unknown variant is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"variants":[{"sku":"A","label":"Red"},{"sku":"a","label":"Blue"}]}', false) @> array['duplicate_variant_sku:2'], 'V34 variant SKUs are unique (case-insensitive)');
select ok(tt.ve(tt.good_data('V-1') || '{"name":"=1+1"}', false) @> array['formula_text:name'], 'V35 a name starting with = is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"description":"@SUM(A1)"}', false) @> array['formula_text:description'], 'V36 a description starting with @ is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"packaging":"+cmd|calc"}', false) @> array['formula_text:packaging'], 'V37 text starting with + is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"specs":{"colour":"-2+3"}}', false) @> array['invalid_spec'], 'V38 formula-looking spec values are refused');
select ok(tt.ve(tt.good_data('V-1') || '{"foo":"bar"}', false) @> array['unknown_field:foo'], 'V39 unknown fields are named');
select ok(tt.ve(tt.good_data('V-1') || '{"supplier_id":"00000000-0000-0000-0000-000000000000"}', false) @> array['unknown_field:supplier_id'], 'V40 a supplier id cannot be smuggled into product data');
select ok(tt.ve(tt.good_data('V-1') || jsonb_build_object('price_confirmed_on', to_char(current_date + 3, 'YYYY-MM-DD')), false) @> array['future_date:price_confirmed_on'], 'V41 a future price date is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"availability_confirmed_on":"2026-02-30"}', false) @> array['invalid_date:availability_confirmed_on'], 'V42 an impossible date is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"category_slug":"weapons"}', false) @> array['invalid_category'], 'V43 an unknown category is refused');
select ok(tt.ve(tt.good_data('V-1') || jsonb_build_object('name', repeat('x', 161)), false) @> array['too_long:name'], 'V44 over-long text is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"lead_time_min_days":20,"lead_time_max_days":10}', false) @> array['invalid_lead_time'], 'V45 lead time min above max is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"availability_status":"plenty"}', false) @> array['invalid_availability'], 'V46 availability is a fixed vocabulary');
select ok(tt.ve(tt.good_data('V-1') || '{"name":["a"]}', false) @> array['invalid_name'], 'V47 a non-scalar name is refused');
select ok(tt.ve(tt.good_data('V-1') || '{"sku":"bad sku!"}', false) @> array['invalid_sku'], 'V48 SKU format is enforced');
select ok(tt.ve(tt.good_data('V-1') || '{"name":"Robert\"); DROP TABLE products;--"}', true) = array[]::text[], 'V49 SQL metacharacters inside text are inert data');

-- ===================== P: partner lifecycle through the RPCs =====================
select tt.act('tt_p1_staff');
select tt.ids_set('PR1', public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('TEE-001', 'Zephyrtee organic cotton tee'), 0));
select is(tt.idj('PR1') ->> 'status', 'draft', 'P1 staff creates a draft product');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('TEE-001'), 0) $$, 'PT409', 'sku_exists', 'P2 a duplicate SKU for the supplier is refused');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('tee-001'), 0) $$, 'PT409', 'sku_exists', 'P3 SKUs are unique case-insensitively');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, '{"name":"No SKU"}'::jsonb, 0) $$, 'PT422', 'invalid_sku', 'P4 a SKU is required to create');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"unit_price":"1.999","price_mode":"fixed"}'::jsonb, 1) $$, 'PT422', 'invalid_price', 'P5 invalid data is rejected with its key');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"sku":"OTHER"}'::jsonb, 1) $$, 'PT422', 'immutable_columns', 'P6 the SKU cannot change');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"name":"Stale"}'::jsonb, 0) $$, 'PT409', 'stale_version', 'P7 a stale draft version is refused');
select tt.act('tt_p1_view');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('VIEW-1'), 0) $$, 'PT403', 'forbidden', 'P8 a viewer cannot create products');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('X-1'), 0) $$, 'PT403', 'forbidden', 'P9 partner B cannot write into partner A (naming A)');
select throws_ok($$ select public.save_product_draft(tt.oid('P2'), tt.id('SA'), null, tt.good_data('X-2'), 0) $$, 'PT404', 'not_found', 'P10 partner B cannot attach a product to A supplier');
select throws_ok($$ select public.save_product_draft(tt.oid('P2'), tt.id('SB'), tt.jid('PR1'), '{"name":"Hijack"}'::jsonb, 1) $$, 'PT404', 'not_found', 'P11 partner B cannot edit A product through its own supplier');
select throws_ok($$ select public.submit_product(tt.oid('P2'), tt.jid('PR1'), 1) $$, 'PT404', 'not_found', 'P12 partner B cannot submit A product');
select throws_ok($$ select public.publish_product(tt.oid('P2'), tt.jid('PR1'), 1) $$, 'PT404', 'not_found', 'P13 partner B cannot publish A product');
select is((select count(*)::int from public.products where id = tt.jid('PR1')), 0, 'P14 partner B cannot read A products (RLS)');
select throws_ok($$ select public.get_my_product(tt.oid('P1'), tt.jid('PR1')) $$, 'PT403', 'forbidden', 'P15 partner B cannot read A product via RPC');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.submit_product(tt.oid('P1'), tt.jid('PR1'), 99) $$, 'PT409', 'stale_version', 'P16 submit checks the draft version');
select ok((select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('INCOMPLETE-1') - 'moq' - 'unit', 0)) is not null, 'P17 an incomplete draft can be saved');
select throws_ok($$ select public.submit_product(tt.oid('P1'), (select id from public.products where sku = 'INCOMPLETE-1'), 1) $$, 'PT422', 'unit_required', 'P18 an incomplete product cannot be submitted');
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('PRD', public.save_product_draft(tt.oid('P1'), tt.id('SD'), null, tt.good_data('DRAFTSUP-1'), 0));
select throws_ok($$ select public.submit_product(tt.oid('P1'), tt.jid('PRD'), 1) $$, 'PT409', 'supplier_not_approved', 'P19 a product of an unapproved supplier cannot be submitted');
select tt.act('tt_p1_staff');
select tt.ids_set('SUB1', public.submit_product(tt.oid('P1'), tt.jid('PR1'), 1));
select is(tt.idj('SUB1') ->> 'created', 'true', 'P20 a complete product is submitted as revision 1');
select is((public.submit_product(tt.oid('P1'), tt.jid('PR1'), 1)) ->> 'created', 'false', 'P21 a repeated submit is a harmless retry');
select tt.pg();
select is((select status::text from public.products where id = tt.jid('PR1')), 'submitted', 'P22 the product is submitted');
select is((select count(*)::int from public.notifications where kind = 'product.submitted' and entity_id = tt.jid('PR1')::text
  and user_id in (tt.uid('tt_adm_rev'), tt.uid('tt_adm_super'), tt.uid('tt_adm_sup'))), 2, 'P23 catalogue:review admins are notified');
select throws_ok($$ update public.product_revisions set data = '{}'::jsonb where product_id = tt.jid('PR1') $$, 'PT409', 'revision_immutable', 'P24 a submitted revision cannot be edited (data)');
select throws_ok($$ update public.product_revisions set media_ids = array[gen_random_uuid()] where product_id = tt.jid('PR1') $$, 'PT409', 'revision_immutable', 'P25 a submitted revision cannot be edited (media)');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"name":"Edit while reviewed"}'::jsonb, 1) $$, 'PT409', 'product_under_review', 'P26 no edits while a revision is under review');
select throws_ok($$ select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1')) $$, 'PT409', 'product_not_publishable', 'P27 an unreviewed product cannot be published');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1')) $$, 'PT403', 'forbidden', 'P28 the partner cannot approve its own product');
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1')) $$, 'PT403', 'forbidden', 'P29 admin_support cannot review products');
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1')) $$, 'PT403', 'conflict_of_interest', 'P30 a reviewer with history in the partner cannot decide');
select tt.act('tt_adm_rev', 'aal2');
select is((public.list_product_reviews(0) -> 'items') @> jsonb_build_array(jsonb_build_object('id', tt.jid('PR1'))), true, 'P31 the product is in the review queue');
select is(public.get_product_for_review(tt.jid('PR1')) -> 'revision' -> 'data' ->> 'name', 'Zephyrtee organic cotton tee', 'P32 the reviewer sees the submitted revision');
select throws_ok($$ select public.review_product(tt.jid('PR1'), 'request_changes', 'no', tt.pv('PR1')) $$, 'PT422', 'reason_required', 'P33 a reason is required for requested changes');
select throws_ok($$ select public.review_product(tt.jid('PR1'), 'approve', null, 999) $$, 'PT409', 'stale_version', 'P34 a stale product version is refused');
select public.review_product(tt.jid('PR1'), 'request_changes', 'Please add the fabric weight in the specifications.', tt.pv('PR1'));
select tt.pg();
select is((select status::text from public.products where id = tt.jid('PR1')), 'changes_requested', 'P35 request_changes sets the product status');
select is((select r.status || '/' || r.reason from public.product_revisions r where r.product_id = tt.jid('PR1') and r.rev_no = 1), 'changes_requested/Please add the fabric weight in the specifications.', 'P36 the revision keeps the decision and reason');
select is((select count(*)::int from public.audit_log where action = 'product.changes_requested' and entity_id = tt.jid('PR1')::text and details ->> 'reason' like 'Please add%'), 1, 'P37 audit row with the reason');
select is((select count(*)::int from public.notifications where kind = 'product.decided' and entity_id = tt.jid('PR1')::text and user_id in (tt.uid('tt_p1_owner'), tt.uid('tt_p1_mgr'), tt.uid('tt_p1_staff'), tt.uid('tt_p1_view'))), 3, 'P38 the partner team (not the viewer) is notified');
select tt.act('tt_p1_staff');
select is((public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"specs":{"fabric weight":"180 gsm"}}'::jsonb, 1)) ->> 'status', 'draft', 'P39 editing after requested changes reopens the draft');
select tt.ids_set('SUB2', public.submit_product(tt.oid('P1'), tt.jid('PR1'), 2));
select is((select status from public.product_revisions where product_id = tt.jid('PR1') and rev_no = 1), 'superseded', 'P40 the older revision is superseded by the resubmission');
select tt.act('tt_adm_rev', 'aal2');
select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1'));
select tt.pg();
select is((select status::text from public.products where id = tt.jid('PR1')), 'approved', 'P41 approval sets the product to approved (not yet public)');
select is(public.search_catalogue('Zephyrtee') ->> 'total', '0', 'P42 an approved but unpublished product is not in search');
select tt.anon();
select throws_ok($$ select public.get_catalogue_item(tt.jid('PR1')) $$, 'PT404', 'not_found', 'P43 an unpublished product is 404 to the public');
select tt.act('tt_buyer');
select is(public.compare_items(array[tt.jid('PR1')]) -> 'items', '[]'::jsonb, 'P44 an unpublished product is absent from comparison');
select tt.act('tt_p1_view');
select throws_ok($$ select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1')) $$, 'PT403', 'forbidden', 'P45 a viewer cannot publish');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.publish_product(tt.oid('P1'), tt.jid('PR1'), 1) $$, 'PT409', 'stale_version', 'P46 publish checks the product version');
select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1'));
select tt.pg();
select is((select status::text from public.products where id = tt.jid('PR1')), 'published', 'P47 the partner publishes the approved revision');
select is((select moq::text || '/' || currency || '/' || price_mode from public.catalogue_items where product_id = tt.jid('PR1')), '100.000/INR/tiers', 'P48 the live row carries MOQ, currency and price mode');
select is((select count(*)::int from public.catalogue_price_tiers where product_id = tt.jid('PR1')), 2, 'P49 two live price tiers');
select is((select string_agg(unit_price::text, ',' order by min_qty) from public.catalogue_price_tiers where product_id = tt.jid('PR1')), '10.50,9.75', 'P50 prices are exact numerics');
select is((select status from public.product_revisions where product_id = tt.jid('PR1') and rev_no = 2), 'published', 'P51 the revision is marked published');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '1', 'P52 a published product of an approved supplier is in public search');
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'name', 'Zephyrtee organic cotton tee', 'P53 and in the public detail');
select is((public.get_catalogue_item(tt.jid('PR1')) -> 'supplier' -> 'reviewed' ->> 'checks') is not null, true, 'P54 the public item carries the review checks and date');
select is(position('ravi' in lower(public.get_catalogue_item(tt.jid('PR1'))::text)) + position('@' in public.get_catalogue_item(tt.jid('PR1'))::text), 0, 'P55 no supplier contact or private data appears in the public item');
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'availability_outdated', 'false', 'P56 availability is flagged outdated only when older than 90 days');
select is(public.get_catalogue_item(tt.jid('PR1')) -> 'tiers' -> 1 ->> 'unit_price', '9.75', 'P57 tiers are in the public detail');

-- edit after publish: the live version stays until a new revision is approved AND published
select tt.act('tt_p1_staff');
select is((public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"name":"Zephyrtee organic cotton tee v2"}'::jsonb, 2)) ->> 'status', 'published', 'P58 editing a published product keeps it published');
select tt.anon();
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'name', 'Zephyrtee organic cotton tee', 'P59 the public still sees the live version');
select tt.act('tt_p1_staff');
select public.submit_product(tt.oid('P1'), tt.jid('PR1'), 3);
select tt.anon();
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'name', 'Zephyrtee organic cotton tee', 'P60 still the live version while the new revision is under review');
select tt.act('tt_adm_rev', 'aal2');
select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1'));
select tt.anon();
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'name', 'Zephyrtee organic cotton tee', 'P61 approval alone does not change what is live');
select tt.act('tt_p1_staff');
select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1'));
select tt.anon();
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'name', 'Zephyrtee organic cotton tee v2', 'P62 publishing swaps in the new revision');
select tt.pg();
select is((select string_agg(rev_no || ':' || status, ',' order by rev_no) from public.product_revisions where product_id = tt.jid('PR1')),
  '1:superseded,2:superseded,3:published', 'P63 revision history: older revisions are superseded, the newest is published');
select is((select count(*)::int from public.catalogue_price_tiers where product_id = tt.jid('PR1')), 2, 'P64 tiers were rewritten, not duplicated');

-- unpublish / republish keeps the approval
select tt.act('tt_p1_staff');
select public.unpublish_product(tt.oid('P1'), tt.jid('PR1'));
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '0', 'P65 an unpublished product leaves search');
select throws_ok($$ select public.get_catalogue_item(tt.jid('PR1')) $$, 'PT404', 'not_found', 'P66 and the detail is 404');
select tt.act('tt_p1_staff');
select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1'));
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '1', 'P67 republishing the approved revision needs no new review');

-- suspension by admin hides at once
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.suspend_product(tt.jid('PR1'), 'x') $$, 'PT422', 'reason_required', 'P68 a reason is required to suspend');
select public.suspend_product(tt.jid('PR1'), 'Misleading claims reported by a buyer.');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '0', 'P69 a suspended product is hidden immediately');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1')) $$, 'PT409', 'product_suspended', 'P70 the partner cannot republish a suspended product');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"name":"edit"}'::jsonb, 3) $$, 'PT409', 'product_suspended', 'P71 nor edit it');
select tt.act('tt_adm_sup', 'aal2');
select public.reinstate_product(tt.jid('PR1'), 'Claims corrected.');
select tt.pg();
select is((select status::text from public.products where id = tt.jid('PR1')), 'unpublished', 'P72 reinstating never puts a product back on sale by itself');
select tt.act('tt_p1_staff');
select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1'));

-- supplier and partner suspension remove products from public results
select tt.act('tt_adm_sup', 'aal2');
select public.suspend_supplier(tt.id('SA'), 'Supplier under investigation.');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '0', 'P73 suspending the supplier removes its products from search');
select throws_ok($$ select public.get_catalogue_item(tt.jid('PR1')) $$, 'PT404', 'not_found', 'P74 and from the detail');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1')) $$, 'PT409', 'supplier_not_available', 'P75 publishing under a suspended supplier is refused');
select tt.act('tt_adm_rev', 'aal2');
select public.reinstate_supplier(tt.id('SA'), 'Cleared after review.');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '1', 'P76 reinstating the supplier brings its published products back');
select tt.act('tt_adm_rev', 'aal2');
select public.suspend_partner(tt.oid('P1'), 'Partner agreement breach under review.');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '0', 'P77 suspending the partner removes every product from search');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.unpublish_product(tt.oid('P1'), tt.jid('PR1')) $$, 'PT409', 'partner_not_approved', 'P78 a suspended partner cannot change its catalogue');
select tt.act('tt_adm_rev', 'aal2');
select public.approve_partner(tt.oid('P1'), 'Reinstated.');
select tt.anon();
select is(public.search_catalogue('Zephyrtee') ->> 'total', '1', 'P79 reinstating the partner restores visibility');

-- ===================== T: price tier trigger (defence in depth) =====================
select tt.pg();
select throws_ok($$ insert into public.catalogue_price_tiers (product_id, min_qty, max_qty, unit_price, currency) values (tt.jid('PR1'), 100, 200, 5, 'INR') $$, 'PT422', 'tier_overlap', 'T1 a direct overlapping tier insert is rejected by the trigger');
select throws_ok($$ insert into public.catalogue_price_tiers (product_id, min_qty, max_qty, unit_price, currency) values (tt.jid('PR1'), 0.5, 2, 5, 'INR') $$, '23514', null, 'T2 a tier minimum below 1 is rejected by a check');
select throws_ok($$ insert into public.catalogue_price_tiers (product_id, min_qty, unit_price, currency) values (tt.jid('PR1'), 500, 5, 'INR') $$, '23505', null, 'T3 two tiers cannot start at the same quantity');
select throws_ok($$ insert into public.catalogue_price_tiers (product_id, min_qty, max_qty, unit_price, currency) values (tt.jid('PR1'), 2000, 3000, 5, 'EUR') $$, '23514', null, 'T4 a tier currency outside the list is rejected');

-- ===================== S: search, filters, pagination =====================
select tt.mk_published('F1', tt.id('SB'), tt.good_data('SRCH-1', 'Qzx fixed price shirt') || '{"price_mode":"fixed","unit_price":"25.00","currency":"USD","moq":10}'::jsonb - 'tiers');
select tt.mk_published('F2', tt.id('SB'), (tt.good_data('SRCH-2', 'Qzx request price shirt') - 'tiers' - 'currency' - 'price_confirmed_on') || '{"price_mode":"request","moq":500,"category_slug":"packaging"}'::jsonb);
select tt.mk_published('F3', tt.id('SB'), tt.good_data('SRCH-3', 'Qzx stale availability') || jsonb_build_object('availability_confirmed_on', to_char(current_date - 120, 'YYYY-MM-DD')));
select tt.anon();
select is(public.search_catalogue('Qzx') ->> 'total', '3', 'S1 text search on the product name finds all three');
select is(public.search_catalogue('SRCH-2') ->> 'total', '1', 'S2 search by SKU');
select is(public.search_catalogue('Beta Mills') ->> 'total', '3', 'S3 search by supplier name');
select is(public.search_catalogue('Qzx', 'packaging') ->> 'total', '1', 'S4 category filter');
select is(public.search_catalogue('Qzx', null, tt.id('SB'), 20) ->> 'total', '1', 'S5 MOQ ceiling filter (only the MOQ 10 item has MOQ <= 20)');
select is(public.search_catalogue('Qzx', null, null, null, 20, 30, 'USD') ->> 'total', '1', 'S6 price range filter within a currency');
select is(public.search_catalogue('Qzx', null, null, null, 20, 30, 'INR') ->> 'total', '0', 'S7 no currency conversion: a USD price is not matched by an INR filter');
select throws_ok($$ select public.search_catalogue('Qzx', null, null, null, 20, 30) $$, 'PT422', 'currency_required', 'S8 a price filter needs a currency');
select throws_ok($$ select public.search_catalogue('Qzx', null, null, null, null, null, 'EUR') $$, 'PT422', 'invalid_currency', 'S9 only INR/MYR/USD');
select is(public.search_catalogue('Qzx', null, tt.id('SA')) ->> 'total', '0', 'S10 supplier filter');
select is(jsonb_array_length(public.search_catalogue('Qzx', null, null, null, null, null, null, 0, 2) -> 'items'), 2, 'S11 page size');
select is(jsonb_array_length(public.search_catalogue('Qzx', null, null, null, null, null, null, 2, 2) -> 'items'), 1, 'S12 second page holds the remainder');
select is((public.search_catalogue('Qzx', null, null, null, null, null, null, 0, 2) -> 'items' -> 0 ->> 'id') <> (public.search_catalogue('Qzx', null, null, null, null, null, null, 2, 2) -> 'items' -> 0 ->> 'id'), true, 'S13 pages do not overlap');
select is(public.search_catalogue('Qzx', null, null, null, null, null, null, 0, 3) -> 'items' = (
  select jsonb_agg(x) from (select public.search_catalogue('Qzx', null, null, null, null, null, null, 0, 1) -> 'items' -> 0 as x
    union all select public.search_catalogue('Qzx', null, null, null, null, null, null, 1, 1) -> 'items' -> 0
    union all select public.search_catalogue('Qzx', null, null, null, null, null, null, 2, 1) -> 'items' -> 0) q), true, 'S14 pagination order is stable and deterministic');
select is(public.search_catalogue('%') ->> 'total', '0', 'S15 LIKE metacharacters are escaped');
select is((public.search_catalogue('Qzx', 'packaging') -> 'items' -> 0 ->> 'from_price'), null, 'S16 a price-on-request item has no price');
select is((public.search_catalogue('SRCH-1') -> 'items' -> 0 ->> 'from_price'), '25.00', 'S17 a fixed item shows its price');
select is((public.search_catalogue('SRCH-3') -> 'items' -> 0 ->> 'availability_outdated'), 'true', 'S18 availability older than 90 days is flagged');

-- ===================== M: product media =====================
select tt.svc();
select throws_ok($$ select public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.jid('PR1'), 'image/png', 1000::bigint, repeat('a', 64), 'bad/path.png', 'pending', 'u', null) $$, 'PT422', 'invalid_path', 'M1 the media path must be products/<org>/<product>/<file>');
select throws_ok($$ select public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.jid('PR1'), 'image/png', 1000::bigint, repeat('a', 64), 'products/' || tt.oid('P1') || '/' || tt.jid('PR1') || '/imgfile0001.png', 'infected', 'u', null) $$, 'PT422', 'infected_not_stored', 'M2 infected images are never stored');
select throws_ok($$ select public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p2_owner'), tt.jid('PR1'), 'image/png', 1000::bigint, repeat('a', 64), 'products/' || tt.oid('P1') || '/' || tt.jid('PR1') || '/imgfile0001.png', 'pending', 'u', null) $$, 'PT403', 'forbidden', 'M3 only a catalogue:manage member of the owning partner can upload');
select tt.ids_set('IMG1', jsonb_build_object('id', public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.jid('PR1'), 'image/png', 1000::bigint, repeat('a', 64),
  'products/' || tt.oid('P1') || '/' || tt.jid('PR1') || '/imgfile0001.png', 'pending', 'u', 'Front view')));
select tt.pg();
select is((select scan_status::text || '/' || approved::text from public.product_media where id = tt.jid('IMG1')), 'pending/false', 'M4 a new image is pending and not approved');
select tt.anon();
select throws_ok($$ select public.get_product_media_access(tt.jid('IMG1')) $$, 'PT404', 'not_found', 'M5 an unscanned image is not served to anyone');
select tt.svc();
select public.service_set_product_media_scan(tt.jid('IMG1'), 'clean', 'engine');
select tt.anon();
select throws_ok($$ select public.get_product_media_access(tt.jid('IMG1')) $$, 'PT404', 'not_found', 'M6 a clean but not yet reviewed image is not public');
select tt.act('tt_p1_view');
select is((public.get_product_media_access(tt.jid('IMG1'))) ->> 'mime_type', 'image/png', 'M7 members of the owning partner can open it');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.get_product_media_access(tt.jid('IMG1')) $$, 'PT404', 'not_found', 'M8 another partner cannot');
select tt.act('tt_p1_staff');
select public.save_product_draft(tt.oid('P1'), tt.id('SA'), tt.jid('PR1'), '{"packaging":"Polybag"}'::jsonb, tt.dv('PR1'));
select public.submit_product(tt.oid('P1'), tt.jid('PR1'), tt.dv('PR1'));
select tt.act('tt_adm_rev', 'aal2');
select is(public.get_product_for_review(tt.jid('PR1')) -> 'media' -> 0 ->> 'id', tt.jid('IMG1')::text, 'M9 the reviewer sees the image that is part of the revision');
select public.review_product(tt.jid('PR1'), 'approve', null, tt.pv('PR1'));
select tt.act('tt_p1_staff');
select public.publish_product(tt.oid('P1'), tt.jid('PR1'), tt.pv('PR1'));
select tt.anon();
select is((public.get_product_media_access(tt.jid('IMG1'))) ->> 'storage_path' like 'products/%', true, 'M10 after publish the approved clean image is public');
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'image_id', tt.jid('IMG1')::text, 'M11 and is the item image');
select tt.svc();
select tt.ids_set('IMG2', jsonb_build_object('id', public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.jid('PR1'), 'image/jpeg', 1000::bigint, repeat('b', 64),
  'products/' || tt.oid('P1') || '/' || tt.jid('PR1') || '/imgfile0002.jpg', 'clean', 'u', null)));
select tt.anon();
select throws_ok($$ select public.get_product_media_access(tt.jid('IMG2')) $$, 'PT404', 'not_found', 'M12 an image added after the approval is not public until reviewed');
select tt.svc();
select public.service_set_product_media_scan(tt.jid('IMG1'), 'infected', 'engine');
select tt.anon();
select throws_ok($$ select public.get_product_media_access(tt.jid('IMG1')) $$, 'PT404', 'not_found', 'M13 an image later found infected disappears');
select is(public.get_catalogue_item(tt.jid('PR1')) ->> 'image_id', null, 'M14 and is no longer the item image');
select tt.act('tt_p1_staff');
select is((select public.remove_product_media(tt.jid('IMG2'))) like 'products/%', true, 'M15 removing an image returns its storage path');
select tt.pg();
select is((select public from storage.buckets where id = 'catalogue-media'), false, 'M16 the catalogue-media bucket exists and is private');
select is((select file_size_limit from storage.buckets where id = 'catalogue-media'), 5242880::bigint, 'M17 bucket size limit is 5 MiB');
select is_empty($$ select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles && array['anon', 'authenticated', 'public']::name[]
   and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'catalogue-media' $$, 'M18 no storage policy for an API role references the bucket');

-- ===================== R: row level security =====================
select tt.act('tt_p2_owner', 'aal2');
select is((select count(*)::int from public.products where partner_org_id = tt.oid('P1')), 0, 'R1 partner B sees no products of partner A');
select is((select count(*)::int from public.product_revisions where partner_org_id = tt.oid('P1')), 0, 'R2 nor revisions');
select is((select count(*)::int from public.catalogue_items where product_id = tt.jid('PR1')), 0, 'R3 nor live rows');
select is((select count(*)::int from public.product_media where product_id = tt.jid('PR1')), 0, 'R4 nor media rows');
select tt.act('tt_buyer');
select is((select count(*)::int from public.products), 0, 'R5 a buyer reads no product table rows');
select is((select count(*)::int from public.catalogue_items), 0, 'R6 a buyer reads no live table rows (only through the RPCs)');
select is((select count(*)::int from public.catalogue_price_tiers), 0, 'R7 nor tiers');
select tt.anon();
select throws_ok($$ select * from public.catalogue_items $$, '42501', null, 'R8 anonymous has no table access');
select throws_ok($$ select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('ANON-1'), 0) $$, '42501', null, 'R9 anonymous cannot call partner RPCs');
select tt.act('tt_adm_rev', 'aal2');
select is((select count(*)::int from public.products where id = tt.jid('PRD')), 0, 'R10 a reviewer does not see draft products');
select tt.act('tt_p1_view');
select is(jsonb_array_length(public.list_my_products(tt.oid('P1')) -> 'items') >= 3, true, 'R11 a partner viewer can list its products');
select throws_ok($$ select public.list_my_products(tt.oid('P2')) $$, 'PT403', 'forbidden', 'R12 but not another partner products');
select is(public.get_my_product(tt.oid('P1'), tt.jid('PR1')) ->> 'status', 'published', 'R13 and read a product detail');
select * from finish();
rollback;
