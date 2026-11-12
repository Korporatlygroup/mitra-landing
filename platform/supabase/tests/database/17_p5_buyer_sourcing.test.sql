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

select plan(124);
create function tt.items(p_a uuid, p_qa numeric, p_b uuid default null, p_qb numeric default null) returns jsonb language sql stable as $$
  select jsonb_agg(x) from (select jsonb_build_object('product_id', p_a, 'quantity', p_qa) x
    union all select jsonb_build_object('product_id', p_b, 'quantity', p_qb) where p_b is not null) q
$$;
create function tt.sub(p_org text, p_key text, p_items jsonb) returns jsonb language sql as $$
  select public.submit_sourcing_request(tt.oid(p_org), p_key, p_items, 'Selangor', 'Shah Alam', current_date + 30, 'Synthetic notes for sourcing')
$$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_sup','tt_adm_sup2','tt_p1_owner','tt_p1_mgr','tt_p1_staff','tt_p1_view','tt_p2_owner',
  'tt_bu_owner','tt_bu_staff','tt_bu_view','tt_bu2_owner','tt_biz_owner','tt_plain']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_sup', 'admin_support');
select tt.addm(tt.oid('M'), 'tt_adm_sup2', 'admin_support');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_mgr', 'manager');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P2', 'tt_p2_owner');
select tt.reg('BU', tt.mkorg('buyer', 'Buyer One Zq7', 'tt_bu_owner'));
select tt.addm(tt.oid('BU'), 'tt_bu_staff', 'staff');
select tt.addm(tt.oid('BU'), 'tt_bu_view', 'viewer');
select tt.reg('BU2', tt.mkorg('buyer', 'Buyer Two Zq7', 'tt_bu2_owner'));
select tt.reg('BZ', tt.mkorg('business', 'Biz Buyer Zq7', 'tt_biz_owner'));
insert into public.memberships (org_id, user_id, role, status, removed_at) values (tt.oid('P1'), tt.uid('tt_adm_sup2'), 'staff', 'removed', now());
select tt.mk_supplier('SA', tt.oid('P1'), 'Sourcing Supplier A Zq7');
select tt.mk_supplier('SB', tt.oid('P2'), 'Sourcing Supplier B Zq7');
select tt.mk_published('PA1', tt.id('SA'), tt.good_data('A1', 'Qy7 shirt with variants') || '{"variants":[{"sku":"A1-RED","label":"Red","moq":200},{"sku":"A1-BLUE","label":"Blue"}],"tiers":[{"min_qty":1,"max_qty":499,"unit_price":"10.50"},{"min_qty":500,"unit_price":"9.75"},{"variant_sku":"A1-RED","min_qty":1,"unit_price":"11.00"}]}');
select tt.mk_published('PA2', tt.id('SA'), (tt.good_data('A2', 'Qy7 fixed towel') - 'tiers') || '{"price_mode":"fixed","unit_price":"3.20","moq":10}');
select tt.mk_published('PA3', tt.id('SA'), tt.good_data('A3', 'Qy7 third product'));
select tt.mk_published('PB1', tt.id('SB'), tt.good_data('B1', 'Qy7 other supplier product'));
select tt.pg();
insert into public.products (supplier_id, partner_org_id, sku, status, draft) values (tt.id('SA'), tt.oid('P1'), 'HIDDEN-1', 'draft', '{"sku":"HIDDEN-1"}');
insert into tt.ids (label, id) select 'PH', id from public.products where sku = 'HIDDEN-1';

-- ===================== V: saved products =====================
select tt.act('tt_bu_staff');
select is((public.save_product(tt.id('PA1'))) ->> 'created', 'true', 'V1 a buyer saves a published product');
select is((public.save_product(tt.id('PA1'))) ->> 'created', 'false', 'V2 saving twice is idempotent');
select throws_ok($$ select public.save_product(tt.id('PH')) $$, 'PT404', 'not_found', 'V3 an unpublished product cannot be saved (404)');
select throws_ok($$ select public.save_product(gen_random_uuid()) $$, 'PT404', 'not_found', 'V4 neither can an unknown id');
select public.save_product(tt.id('PA2'));
select is((public.list_saved_products() ->> 'total')::int, 2, 'V5 the saved list has two entries');
select is(public.list_saved_products() -> 'items' -> 0 ->> 'available', 'true', 'V6 available entries carry the live item');
select tt.pg();
update public.products set status = 'unpublished' where id = tt.id('PA1');
select tt.act('tt_bu_staff');
select is((public.list_saved_products() ->> 'total')::int, 2, 'V7 an unpublished product is not silently removed from the saved list');
select is((select x ->> 'available' || '/' || (x ->> 'name') from jsonb_array_elements(public.list_saved_products() -> 'items') x where x ->> 'product_id' = tt.id('PA1')::text),
  'false/Qy7 shirt with variants', 'V8 it is shown as unavailable with the name saved at the time');
select is((select (x -> 'item') is null from jsonb_array_elements(public.list_saved_products() -> 'items') x where x ->> 'product_id' = tt.id('PA1')::text), true, 'V9 and no live data is leaked for it');
select tt.pg();
update public.products set status = 'published' where id = tt.id('PA1');
select tt.act('tt_bu_staff');
select is((select x ->> 'available' from jsonb_array_elements(public.list_saved_products() -> 'items') x where x ->> 'product_id' = tt.id('PA1')::text), 'true', 'V10 republishing makes it available again');
select tt.act('tt_bu2_owner');
select is((public.list_saved_products() ->> 'total')::int, 0, 'V11 saved lists are per user');
select is((select count(*)::int from public.saved_products), 0, 'V12 and saved rows are invisible to other users (RLS)');
select public.unsave_product(tt.id('PA1'));
select tt.act('tt_bu_staff');
select is((public.list_saved_products() ->> 'total')::int, 2, 'V13 another user cannot remove my saved product');
select public.unsave_product(tt.id('PA2'));
select is((public.list_saved_products() ->> 'total')::int, 1, 'V14 unsave removes it');
select tt.anon();
select throws_ok($$ select public.save_product(tt.id('PA1')) $$, '42501', null, 'V15 anonymous cannot save');
select throws_ok($$ select public.list_saved_products() $$, '42501', null, 'V16 or list saved products');

-- ===================== W: compare =====================
select tt.anon();
select is(jsonb_array_length(public.compare_items(array[tt.id('PA1'), tt.id('PA2'), tt.id('PA3'), tt.id('PB1')]) -> 'items'), 4, 'W1 four published products compare, even anonymously');
select throws_ok($$ select public.compare_items(array[tt.id('PA1'), tt.id('PA2'), tt.id('PA3'), tt.id('PB1'), tt.id('PH')]) $$, 'PT422', 'too_many_items', 'W2 at most four products');
select is(public.compare_items(array[tt.id('PA1'), tt.id('PH')]) -> 'unavailable', jsonb_build_array(tt.id('PH')), 'W3 an unpublished product is reported unavailable, with no detail');
select is(jsonb_array_length(public.compare_items(array[tt.id('PA1'), tt.id('PH')]) -> 'items'), 1, 'W4 and absent from the items');
select is(public.compare_items(array[tt.id('PA1')]) -> 'items' -> 0 -> 'variants' -> 0 ->> 'sku', 'A1-RED', 'W5 the comparison carries variants');

-- ===================== X: submit a sourcing request =====================
select tt.act('tt_bu_staff');
select tt.ids_set('R1', tt.sub('BU', 'req-key-0001', tt.items(tt.id('PA1'), 150, tt.id('PA2'), 20)));
select is(tt.idj('R1') ->> 'created', 'true', 'X1 a buyer submits a request with two lines');
select is(tt.idj('R1') ->> 'reference' ~ '^SR-[2-9A-HJ-NP-Z]{8}$', true, 'X2 the reference is human friendly (SR- and 8 unambiguous characters)');
select is(tt.sub('BU', 'req-key-0001', tt.items(tt.id('PA1'), 150, tt.id('PA2'), 20)) ->> 'id', tt.jid('R1')::text, 'X3 the same key and payload returns the same request');
select is(tt.sub('BU', 'req-key-0001', tt.items(tt.id('PA1'), 150, tt.id('PA2'), 20)) ->> 'created', 'false', 'X4 and says it was not created again');
select is((select count(*)::int from public.sourcing_requests where buyer_org_id = tt.oid('BU')), 1, 'X5 only one request exists after the retry');
select throws_ok($$ select tt.sub('BU', 'req-key-0001', tt.items(tt.id('PA1'), 160)) $$, 'PT409', 'idempotency_key_reused', 'X6 the same key with a different payload is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0002', tt.items(tt.id('PA1'), 10)) $$, 'PT422', 'below_moq', 'X7 a quantity below the MOQ is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0003', jsonb_build_array(jsonb_build_object('product_id', tt.id('PA1'), 'variant_sku', 'A1-RED', 'quantity', 150))) $$, 'PT422', 'below_moq', 'X8 the variant MOQ applies');
select throws_ok($$ select tt.sub('BU', 'req-key-0004', jsonb_build_array(jsonb_build_object('product_id', tt.id('PA1'), 'variant_sku', 'NOPE', 'quantity', 150))) $$, 'PT422', 'invalid_variant', 'X9 an unknown variant is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0005', tt.items(tt.id('PA1'), 150, tt.id('PB1'), 150)) $$, 'PT422', 'mixed_suppliers', 'X10 one request goes to one supplier');
select throws_ok($$ select tt.sub('BU', 'req-key-0006', tt.items(tt.id('PH'), 150)) $$, 'PT404', 'not_found', 'X11 an unpublished product is 404');
select throws_ok($$ select tt.sub('BU', 'req-key-0007', tt.items(gen_random_uuid(), 150)) $$, 'PT404', 'not_found', 'X12 so is an unknown one');
select throws_ok($$ select tt.sub('BU', 'req-key-0008', tt.items(tt.id('PA1'), 0)) $$, 'PT422', 'invalid_quantity', 'X13 a zero quantity is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0009', tt.items(tt.id('PA1'), -5)) $$, 'PT422', 'invalid_quantity', 'X14 a negative quantity is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0010', '[]'::jsonb) $$, 'PT422', 'items_required', 'X15 at least one line is required');
select throws_ok($$ select tt.sub('BU', 'req-key-0011', (select jsonb_agg(jsonb_build_object('product_id', tt.id('PA1'), 'quantity', 150 + g)) from generate_series(1, 21) g)) $$, 'PT422', 'too_many_items', 'X16 at most 20 lines');
select throws_ok($$ select tt.sub('BU', 'req-key-0012', tt.items(tt.id('PA1'), 150, tt.id('PA1'), 150)) $$, 'PT422', 'duplicate_item', 'X17 the same line twice is refused');
select throws_ok($$ select tt.sub('BU', 'req-key-0013', jsonb_build_array(jsonb_build_object('product_id', tt.id('PA1'), 'quantity', 150, 'price', 1))) $$, 'PT422', 'invalid_data', 'X18 a buyer cannot supply a price');
select throws_ok($$ select public.submit_sourcing_request(tt.oid('BU'), 'req-key-0014', tt.items(tt.id('PA1'), 150), 'Atlantis', null, null, null) $$, 'PT422', 'invalid_state', 'X19 the destination state is validated');
select throws_ok($$ select public.submit_sourcing_request(tt.oid('BU'), 'req-key-0015', tt.items(tt.id('PA1'), 150), 'Selangor', null, current_date - 1, null) $$, 'PT422', 'invalid_date', 'X20 a date in the past is refused');
select throws_ok($$ select public.submit_sourcing_request(tt.oid('BU'), 'short', tt.items(tt.id('PA1'), 150), 'Selangor', null, null, null) $$, 'PT422', 'invalid_data', 'X21 the idempotency key is mandatory');
select tt.act('tt_bu_view');
select throws_ok($$ select tt.sub('BU', 'req-key-0016', tt.items(tt.id('PA1'), 150)) $$, 'PT403', 'forbidden', 'X22 a buyer viewer cannot submit');
select tt.act('tt_bu2_owner');
select throws_ok($$ select tt.sub('BU', 'req-key-0017', tt.items(tt.id('PA1'), 150)) $$, 'PT403', 'forbidden', 'X23 a user cannot submit for another organisation');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select tt.sub('P1', 'req-key-0018', tt.items(tt.id('PA1'), 150)) $$, 'PT422', 'invalid_org_type', 'X24 a partner organisation cannot place sourcing requests');
select tt.act('tt_biz_owner');
select is((tt.sub('BZ', 'req-key-0019', tt.items(tt.id('PA3'), 150))) ->> 'created', 'true', 'X25 a business organisation can place sourcing requests');
select tt.anon();
select throws_ok($$ select tt.sub('BU', 'req-key-0020', tt.items(tt.id('PA1'), 150)) $$, '42501', null, 'X26 anonymous cannot submit');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'sourcing.received' and entity_id = tt.jid('R1')::text
  and user_id in (tt.uid('tt_p1_owner'), tt.uid('tt_p1_mgr'), tt.uid('tt_p1_staff'), tt.uid('tt_p1_view'), tt.uid('tt_p2_owner'))), 3, 'X27 the partner team (owner, manager, staff) is notified, the viewer and the other partner are not');
select is((select count(*)::int from public.audit_log where action = 'sourcing.submitted' and entity_id = tt.jid('R1')::text and org_id = tt.oid('BU')), 1, 'X28 an audit row on the buyer organisation');
select is((select count(*)::int from public.sourcing_request_events where request_id = tt.jid('R1') and kind = 'submitted'), 1, 'X29 a submitted event');
select is((select snapshot ->> 'name' || '/' || (snapshot ->> 'moq') || '/' || (snapshot ->> 'currency') || '/' || (snapshot ->> 'applicable_unit_price') || '/' || jsonb_array_length(snapshot -> 'tiers')
  from public.sourcing_request_items where request_id = tt.jid('R1') and line_no = 1), 'Qy7 shirt with variants/100.000/INR/10.50/2', 'X30 the line snapshot holds name, MOQ, currency, the price for the quantity and the tiers shown');
select is((select snapshot ->> 'applicable_unit_price' || '/' || (snapshot ->> 'price_mode') from public.sourcing_request_items where request_id = tt.jid('R1') and line_no = 2), '3.20/fixed', 'X31 a fixed-price line snapshots the fixed price');
select is((select snapshot ->> 'price_confirmed_on' is not null and snapshot ->> 'availability_confirmed_on' is not null from public.sourcing_request_items where request_id = tt.jid('R1') and line_no = 1), true, 'X32 the snapshot records the confirmation dates');

-- variant quantity and tier selection
select tt.act('tt_bu_staff');
select tt.ids_set('R2', public.submit_sourcing_request(tt.oid('BU'), 'req-key-0021', jsonb_build_array(
  jsonb_build_object('product_id', tt.id('PA1'), 'variant_sku', 'A1-RED', 'quantity', 250), jsonb_build_object('product_id', tt.id('PA1'), 'variant_sku', 'A1-BLUE', 'quantity', 600)),
  'Selangor', null, null, null));
select tt.pg();
select is((select string_agg(snapshot ->> 'applicable_unit_price', ',' order by line_no) from public.sourcing_request_items where request_id = tt.jid('R2')), '11.00,9.75',
  'X33 the variant tier and the product tier are picked by quantity');
select is((select count(distinct reference)::int from public.sourcing_requests where buyer_org_id in (tt.oid('BU'), tt.oid('BZ'))), 3, 'X34 every request has its own reference');

-- the snapshot never changes with later price edits
update public.catalogue_price_tiers set unit_price = 99.99 where product_id = tt.id('PA1') and variant_id is null;
update public.catalogue_items set name = 'Renamed after the request', moq = 5 where product_id = tt.id('PA1');
select is((select snapshot ->> 'applicable_unit_price' || '/' || (snapshot ->> 'name') || '/' || (snapshot ->> 'moq') from public.sourcing_request_items where request_id = tt.jid('R1') and line_no = 1),
  '10.50/Qy7 shirt with variants/100.000', 'X35 the request snapshot is unaffected by later price, name and MOQ edits');
update public.catalogue_price_tiers set unit_price = 10.50 where product_id = tt.id('PA1') and variant_id is null and min_qty = 1;
update public.catalogue_items set name = 'Qy7 shirt with variants', moq = 100 where product_id = tt.id('PA1');

-- ===================== Y: visibility and isolation of requests =====================
select tt.act('tt_bu2_owner');
select throws_ok($$ select public.get_sourcing_request(tt.jid('R1')) $$, 'PT404', 'not_found', 'Y1 another buyer cannot read a request (404)');
select is((select count(*)::int from public.sourcing_requests), 0, 'Y2 nor see it in the table');
select is((select count(*)::int from public.sourcing_request_items), 0, 'Y3 nor its items');
select is((select count(*)::int from public.sourcing_request_events), 0, 'Y4 nor its events');
select throws_ok($$ select public.list_my_sourcing_requests(tt.oid('BU')) $$, 'PT403', 'forbidden', 'Y5 nor list another organisation requests');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.get_sourcing_request(tt.jid('R1')) $$, 'PT404', 'not_found', 'Y6 another partner cannot read it');
select is((select count(*)::int from public.sourcing_requests), 0, 'Y7 nor see it in the table');
select is(public.list_partner_requests(tt.oid('P2')) ->> 'total', '0', 'Y8 and its own list is empty');
select throws_ok($$ select public.list_partner_requests(tt.oid('P1')) $$, 'PT403', 'forbidden', 'Y9 nor list partner A requests');
select tt.act('tt_p1_view');
select is(public.get_sourcing_request(tt.jid('R1')) ->> 'buyer_name', 'Buyer One Zq7', 'Y10 a partner viewer can read the request, including the buyer organisation name');
select is(jsonb_array_length(public.get_sourcing_request(tt.jid('R1')) -> 'items'), 2, 'Y11 with its snapshot lines');
select is(public.list_partner_requests(tt.oid('P1')) ->> 'total', '3', 'Y12 the partner list holds all requests sent to it');
select tt.act('tt_bu_view');
select is(public.get_sourcing_request(tt.jid('R1')) ->> 'buyer_name', null, 'Y13 a buyer team member sees no buyer_name field value (their own side)');
select is(public.get_sourcing_request(tt.jid('R1')) ->> 'partner_org_id', null, 'Y14 and never the partner organisation id');
select is(public.get_sourcing_request(tt.jid('R1')) ->> 'your_side', 'buyer', 'Y15 the response says which side the caller is');
select is(position('contact' in lower(public.get_sourcing_request(tt.jid('R1'))::text)), 0, 'Y16 no supplier contact data appears in the buyer view');
select is((public.list_my_sourcing_requests(tt.oid('BU')) ->> 'total')::int, 2, 'Y17 the buyer lists its two requests');
select tt.act('tt_plain');
select throws_ok($$ select public.get_sourcing_request(tt.jid('R1')) $$, 'PT404', 'not_found', 'Y18 an unrelated user gets 404');

-- ===================== Z: responses, clarification, withdrawal =====================
select tt.act('tt_p1_view');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', null, null) $$, 'PT403', 'forbidden', 'Z1 a partner viewer cannot respond');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', null, null) $$, 'PT404', 'not_found', 'Z2 another partner cannot respond (404)');
select tt.act('tt_bu_owner');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', null, null) $$, 'PT404', 'not_found', 'Z3 the buyer cannot respond for the partner (404)');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', null, 99) $$, 'PT409', 'stale_version', 'Z4 a stale version is refused');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'clarify', 'no', null) $$, 'PT422', 'invalid_note', 'Z5 a clarification needs a real question');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'ship', null, null) $$, 'PT422', 'invalid_action', 'Z6 only acknowledge or clarify');
select is((public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', 'We can supply this quantity.', null)) ->> 'status', 'acknowledged', 'Z7 the partner acknowledges');
select is((public.respond_sourcing_request(tt.jid('R1'), 'acknowledge', null, null)) ->> 'status', 'acknowledged', 'Z8 acknowledging again is a harmless retry');
select tt.pg();
select is((select first_response_at is not null from public.sourcing_requests where id = tt.jid('R1')), true, 'Z9 the first response time is recorded');
select is((select count(*)::int from public.sourcing_request_events where request_id = tt.jid('R1') and kind = 'acknowledged'), 1, 'Z10 one acknowledged event');
select is((select count(*)::int from public.notifications where kind = 'sourcing.acknowledged' and entity_id = tt.jid('R1')::text
  and user_id in (tt.uid('tt_bu_owner'), tt.uid('tt_bu_staff'), tt.uid('tt_bu_view'), tt.uid('tt_bu2_owner'))), 2, 'Z11 the buyer team (owner, staff) is notified, not the viewer or another buyer');
select tt.act('tt_p1_mgr');
select is((public.respond_sourcing_request(tt.jid('R2'), 'clarify', 'Which colour assortment do you need for the Red variant?', null)) ->> 'status', 'clarification_requested', 'Z12 the partner asks for clarification');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'sourcing.clarification' and entity_id = tt.jid('R2')::text), 2, 'Z13 the buyer team is notified of the question');
select tt.act('tt_p1_mgr');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R2'), 'acknowledge', null, null) $$, 'PT409', 'request_not_open', 'Z14 acknowledging a request that waits for the buyer is refused');
select tt.act('tt_bu_view');
select throws_ok($$ select public.reply_sourcing_request(tt.jid('R2'), 'Half red and half blue.') $$, 'PT403', 'forbidden', 'Z15 a buyer viewer cannot reply');
select tt.act('tt_bu_staff');
select throws_ok($$ select public.reply_sourcing_request(tt.jid('R1'), 'Reply to an acknowledged request') $$, 'PT409', 'request_not_open', 'Z16 replying is only possible after a clarification request');
select is((public.reply_sourcing_request(tt.jid('R2'), 'Half red and half blue.')) ->> 'status', 'submitted', 'Z17 the buyer reply reopens the request for the partner');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'sourcing.reply' and entity_id = tt.jid('R2')::text), 3, 'Z18 the partner team is notified of the reply');
select is((select string_agg(kind, ',' order by id) from public.sourcing_request_events where request_id = tt.jid('R2')), 'submitted,clarification_requested,buyer_replied', 'Z19 the history is kept in order');
select tt.act('tt_p1_staff');
select public.respond_sourcing_request(tt.jid('R2'), 'acknowledge', null, null);
select tt.act('tt_bu2_owner');
select throws_ok($$ select public.withdraw_sourcing_request(tt.jid('R2')) $$, 'PT404', 'not_found', 'Z20 another buyer cannot withdraw it');
select tt.act('tt_bu_staff');
select is((public.withdraw_sourcing_request(tt.jid('R2'))) ->> 'status', 'withdrawn', 'Z21 the buyer withdraws an acknowledged request');
select is((public.withdraw_sourcing_request(tt.jid('R2'))) ->> 'status', 'withdrawn', 'Z22 withdrawing twice is a harmless retry');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'sourcing.withdrawn' and entity_id = tt.jid('R2')::text), 3, 'Z23 the partner is notified');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R2'), 'acknowledge', null, null) $$, 'PT409', 'request_not_open', 'Z24 a withdrawn request cannot be answered');
select is((public.close_sourcing_request(tt.jid('R1'), 'Order placed outside the platform.')) ->> 'status', 'closed', 'Z25 the partner closes a request');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'sourcing.closed' and entity_id = tt.jid('R1')::text), 2, 'Z26 the buyer team is notified');
select tt.act('tt_bu_staff');
select throws_ok($$ select public.withdraw_sourcing_request(tt.jid('R1')) $$, 'PT409', 'request_not_open', 'Z27 a closed request cannot be withdrawn');
select tt.act('tt_p1_view');
select throws_ok($$ select public.close_sourcing_request(tt.jid('R1'), null) $$, 'PT403', 'forbidden', 'Z28 a viewer cannot close');

-- suspension blocks new requests and responses (409 supplier_not_available)
select tt.pg();
update public.suppliers set status = 'suspended', suspended_reason = 'fixture' where id = tt.id('SA');
select tt.act('tt_bu_staff');
select throws_ok($$ select tt.sub('BU', 'req-key-0030', tt.items(tt.id('PA3'), 150)) $$, 'PT409', 'supplier_not_available', 'Z29 a suspended supplier blocks new requests (409 supplier_not_available)');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.respond_sourcing_request(tt.jid('R1'), 'clarify', 'A long enough clarification question', null) $$, 'PT409', 'supplier_not_available', 'Z30 and responses');
select tt.pg();
update public.suppliers set status = 'approved' where id = tt.id('SA');
update public.partner_profiles set status = 'suspended' where org_id = tt.oid('P1');
select tt.act('tt_bu_staff');
select throws_ok($$ select tt.sub('BU', 'req-key-0031', tt.items(tt.id('PA3'), 150)) $$, 'PT409', 'supplier_not_available', 'Z31 a suspended partner blocks new requests');
select tt.act('tt_p1_staff');
select throws_ok($$ select public.close_sourcing_request(tt.jid('R1'), null) $$, 'PT409', 'partner_not_approved', 'Z32 a suspended partner cannot close either');
select tt.pg();
update public.partner_profiles set status = 'approved' where org_id = tt.oid('P1');
update public.products set status = 'unpublished' where id = tt.id('PA3');
select tt.act('tt_bu_staff');
select throws_ok($$ select tt.sub('BU', 'req-key-0032', tt.items(tt.id('PA3'), 150)) $$, 'PT404', 'not_found', 'Z33 an unpublished product is 404, not a conflict');
select is((select count(*)::int from public.sourcing_requests where idempotency_key in ('req-key-0030', 'req-key-0031', 'req-key-0032')), 0, 'Z34 refused requests leave nothing behind');

-- ===================== P: product reports =====================
select tt.act('tt_bu_staff');
select is((public.report_product(tt.id('PA2'), 'misleading', 'The photo does not match the description.')) ->> 'id' is not null, true, 'P1 a signed-in user reports a published product');
select throws_ok($$ select public.report_product(tt.id('PA2'), 'misleading', 'again') $$, 'PT409', 'already_reported', 'P2 one open report per user and product');
select throws_ok($$ select public.report_product(tt.id('PA2'), 'bad-reason', null) $$, 'PT422', 'invalid_reason', 'P3 reasons are a fixed list');
select throws_ok($$ select public.report_product(tt.id('PH'), 'spam', null) $$, 'PT404', 'not_found', 'P4 an unpublished product cannot be reported (404)');
select tt.act('tt_bu2_owner');
select is((select count(*)::int from public.product_reports), 0, 'P5 other users cannot see someone else report');
select public.report_product(tt.id('PB1'), 'spam', null);
select tt.anon();
select throws_ok($$ select public.report_product(tt.id('PA2'), 'spam', null) $$, '42501', null, 'P6 anonymous cannot report');
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.list_product_reports('open', 0) $$, 'PT403', 'forbidden', 'P7 admin_review does not hold catalogue:moderate');
select tt.act('tt_adm_sup2', 'aal2');
select throws_ok($$ select public.handle_product_report((select id from public.product_reports where product_id = tt.id('PA2') limit 1), 'dismiss', null) $$, 'PT403', 'conflict_of_interest', 'P8 a moderator with history in the partner cannot handle its reports');
select tt.act('tt_adm_sup', 'aal2');
select is((public.list_product_reports('open', 0) ->> 'total')::int, 2, 'P9 the moderator sees the two open reports');
select throws_ok($$ select public.handle_product_report((select id from public.product_reports where product_id = tt.id('PA2') limit 1), 'suspend_product', 'x') $$, 'PT422', 'reason_required', 'P10 suspending needs a reason');
select public.handle_product_report((select id from public.product_reports where product_id = tt.id('PA2') limit 1), 'suspend_product', 'Description does not match the product.');
select public.handle_product_report((select id from public.product_reports where product_id = tt.id('PB1') limit 1), 'dismiss', null);
select tt.pg();
select is((select status::text from public.products where id = tt.id('PA2')), 'suspended', 'P11 handling the report suspended the product');
select is((select status from public.product_reports where product_id = tt.id('PA2')), 'actioned', 'P12 the report is actioned');
select is((select status from public.product_reports where product_id = tt.id('PB1')), 'dismissed', 'P13 and the other dismissed');
select is((select status::text from public.products where id = tt.id('PB1')), 'published', 'P14 dismissing leaves the product on sale');
select tt.act('tt_bu_staff');
select throws_ok($$ select public.handle_product_report((select id from public.product_reports limit 1), 'dismiss', null) $$, 'PT403', 'forbidden', 'P15 a buyer cannot handle reports');
select is((select count(*)::int from public.product_reports), 1, 'P16 the reporter still sees only their own report');
select * from finish();
rollback;
