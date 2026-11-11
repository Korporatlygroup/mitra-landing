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

select plan(328);
create function tt.code(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_sup','tt_adm_ops','tt_p1_owner','tt_p1_mgr','tt_p1_staff','tt_p1_view','tt_p2_owner',
  'tt_bu_owner','tt_bu2_owner','tt_pd_owner','tt_pd_staff','tt_bd_owner','tt_du','tt_du_admin']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_sup', 'admin_support');
select tt.addm(tt.oid('M'), 'tt_adm_ops', 'admin_ops');
select tt.addm(tt.oid('M'), 'tt_du_admin', 'admin_review');

-- baseline for the statistics (counts are compared as deltas so the test stays valid when other data exists)
select tt.act('tt_adm_ops', 'aal2');
select tt.ids_set('ST0', public.catalogue_stats());
select is(public.catalogue_stats() -> 'partner_response' -> 'response_rate' = 'null'::jsonb or (public.catalogue_stats() -> 'partner_response' ->> 'requests')::int > 0, true,
  'ST0 the response rate is null (not a made-up number) when there is no data');

select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_mgr', 'manager');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P2', 'tt_p2_owner');
select tt.mk_partner('P3', 'tt_pd_owner', 'suspended');
select tt.reg('BU', tt.mkorg('buyer', 'Buyer One Zq8', 'tt_bu_owner'));
select tt.reg('BU2', tt.mkorg('buyer', 'Buyer Two Zq8', 'tt_bu2_owner'));
select tt.mk_supplier('SA', tt.oid('P1'), 'Stats Supplier A Zq8');
select tt.mk_supplier('SB', tt.oid('P2'), 'Stats Supplier B Zq8');
select tt.mk_supplier('SC', tt.oid('P3'), 'Suspended Partner Supplier Zq8');
select tt.mk_published('V1', tt.id('SA'), tt.good_data('ST-1', 'Stats product one'));
select tt.mk_published('V2', tt.id('SB'), tt.good_data('ST-2', 'Stats product two'));
select tt.mk_published('V3', tt.id('SA'), tt.good_data('ST-3', 'Stats stale product') || jsonb_build_object('availability_confirmed_on', to_char(current_date - 120, 'YYYY-MM-DD')));
select tt.mk_published('V4', tt.id('SC'), tt.good_data('ST-4', 'Hidden by partner suspension'));
select tt.pg();
select tt.mk_published('V5', tt.id('SA'), tt.good_data('ST-5', 'Unpublished product'));
update public.products set status = 'unpublished' where id = tt.id('V5');
-- a pending supplier submission and a pending product revision
insert into public.suppliers (partner_org_id, code, status, draft, draft_version, draft_submitted_version) values (tt.oid('P1'), 'PEND1', 'awaiting_review', '{"name":"Pending Zq8"}', 1, 1);
insert into public.products (supplier_id, partner_org_id, sku, status, draft, draft_version, submitted_draft_version) values (tt.id('SA'), tt.oid('P1'), 'PENDING-1', 'submitted', tt.good_data('PENDING-1'), 1, 1);
insert into public.product_revisions (product_id, partner_org_id, rev_no, data, status) select id, partner_org_id, 1, draft, 'submitted' from public.products where sku = 'PENDING-1';
update public.products set pending_revision_id = (select id from public.product_revisions where product_id = products.id) where sku = 'PENDING-1';
insert into public.product_reports (product_id, reporter, reason) values (tt.id('V1'), tt.uid('tt_bu_owner'), 'spam');
-- four sourcing requests: two answered after 60 s and 120 s, one unanswered, one withdrawn
insert into public.sourcing_requests (reference, buyer_org_id, partner_org_id, supplier_id, supplier_name, status, destination_state, idempotency_key, payload_hash, created_at, first_response_at) values
  ('SR-AAAAAAA2', tt.oid('BU'), tt.oid('P1'), tt.id('SA'), 'Stats Supplier A Zq8', 'acknowledged', 'Selangor', 'stats-key-0001', 'h', now() - interval '1 hour', now() - interval '1 hour' + interval '60 seconds'),
  ('SR-AAAAAAA3', tt.oid('BU'), tt.oid('P1'), tt.id('SA'), 'Stats Supplier A Zq8', 'acknowledged', 'Selangor', 'stats-key-0002', 'h', now() - interval '1 hour', now() - interval '1 hour' + interval '120 seconds'),
  ('SR-AAAAAAA4', tt.oid('BU'), tt.oid('P1'), tt.id('SA'), 'Stats Supplier A Zq8', 'submitted', 'Selangor', 'stats-key-0003', 'h', now() - interval '1 hour', null),
  ('SR-AAAAAAA5', tt.oid('BU'), tt.oid('P1'), tt.id('SA'), 'Stats Supplier A Zq8', 'withdrawn', 'Selangor', 'stats-key-0004', 'h', now() - interval '1 hour', null);
insert into public.import_jobs (partner_org_id, supplier_id, mode, status, file_name, file_sha256, counts) values
  (tt.oid('P1'), tt.id('SA'), 'create_only', 'failed', 'bad.csv', repeat('e', 64), '{"total":5,"valid":0,"invalid":4,"duplicate":1}');

-- ===================== ST: statistics are real counts =====================
select tt.act('tt_adm_ops', 'aal2');
select tt.ids_set('ST1', public.catalogue_stats());
select is((tt.idj('ST1') ->> 'approved_suppliers')::int - (tt.idj('ST0') ->> 'approved_suppliers')::int, 2, 'ST1 approved suppliers: two (the one under a suspended partner is not counted)');
select is((tt.idj('ST1') ->> 'published_products')::int - (tt.idj('ST0') ->> 'published_products')::int, 3, 'ST2 published products: three (unpublished and partner-suspended ones are not counted)');
select is((tt.idj('ST1') ->> 'suppliers_awaiting_review')::int - (tt.idj('ST0') ->> 'suppliers_awaiting_review')::int, 1, 'ST3 suppliers awaiting review: one');
select is((tt.idj('ST1') ->> 'products_awaiting_review')::int - (tt.idj('ST0') ->> 'products_awaiting_review')::int, 1, 'ST4 products awaiting review: one');
select is((tt.idj('ST1') ->> 'outdated_availability')::int - (tt.idj('ST0') ->> 'outdated_availability')::int, 1, 'ST5 outdated availability (older than 90 days): one');
select is((tt.idj('ST1') ->> 'open_product_reports')::int - (tt.idj('ST0') ->> 'open_product_reports')::int, 1, 'ST6 open product reports: one');
select is((tt.idj('ST1') ->> 'enquiries_received')::int - (tt.idj('ST0') ->> 'enquiries_received')::int, 4, 'ST7 enquiries received counts every request');
select is((tt.idj('ST1') ->> 'enquiries_received_30d')::int - (tt.idj('ST0') ->> 'enquiries_received_30d')::int, 4, 'ST8 and the last 30 days');
select is((tt.idj('ST1') -> 'imports' ->> 'jobs_failed')::int - (tt.idj('ST0') -> 'imports' ->> 'jobs_failed')::int, 1, 'ST9 import failures: one failed job');
select is((tt.idj('ST1') -> 'imports' ->> 'rows_invalid')::int - (tt.idj('ST0') -> 'imports' ->> 'rows_invalid')::int, 5, 'ST10 and the invalid and duplicate rows');
select tt.pg();
select is(tt.idj('ST1') -> 'partner_response' ->> 'requests', (select count(*)::text from public.sourcing_requests where status <> 'withdrawn' and partner_org_id is not null), 'ST11 response statistics are computed from the real requests (withdrawn ones excluded)');
select is(tt.idj('ST1') -> 'partner_response' ->> 'responded', (select count(*)::text from public.sourcing_requests where status <> 'withdrawn' and partner_org_id is not null and first_response_at is not null), 'ST12 responded count');
select is((tt.idj('ST1') -> 'partner_response' ->> 'median_response_seconds')::numeric,
  (select round(percentile_cont(0.5) within group (order by extract(epoch from (first_response_at - created_at))))::numeric from public.sourcing_requests where first_response_at is not null), 'ST13 the median response time is the real median');
select is((tt.idj('ST1') -> 'partner_response' ->> 'response_rate')::numeric,
  (select round(count(*) filter (where first_response_at is not null)::numeric / count(*), 4) from public.sourcing_requests where status <> 'withdrawn' and partner_org_id is not null), 'ST14 the response rate is responded / eligible');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.catalogue_stats() $$, 'PT403', 'forbidden', 'ST15 a partner cannot read platform statistics');
select tt.act('tt_bu_owner');
select throws_ok($$ select public.catalogue_stats() $$, 'PT403', 'forbidden', 'ST16 a buyer cannot');
select tt.anon();
select throws_ok($$ select public.catalogue_stats() $$, '42501', null, 'ST17 anonymous cannot');

-- ===================== MX: role truth table over the RPC surface =====================
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_supplier_draft as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_supplier_draft as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_supplier_draft as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_supplier_draft as admin_ops');
select tt.anon();
select is(tt.code($q$select public.save_supplier_draft(tt.oid('P1'), gen_random_uuid(), '{}'::jsonb, 0)$q$), '42501', 'MX save_supplier_draft as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_supplier as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_supplier as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_supplier as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_supplier as admin_ops');
select tt.anon();
select is(tt.code($q$select public.submit_supplier(tt.oid('P1'), gen_random_uuid(), 0)$q$), '42501', 'MX submit_supplier as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_product_draft as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_product_draft as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT404', 'MX save_product_draft as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), 'PT403', 'MX save_product_draft as admin_ops');
select tt.anon();
select is(tt.code($q$select public.save_product_draft(tt.oid('P1'), gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)$q$), '42501', 'MX save_product_draft as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX submit_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX submit_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.submit_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), '42501', 'MX submit_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX publish_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX publish_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT404', 'MX publish_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), 'PT403', 'MX publish_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.publish_product(tt.oid('P1'), gen_random_uuid(), 0)$q$), '42501', 'MX publish_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT404', 'MX unpublish_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT404', 'MX unpublish_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT404', 'MX unpublish_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), 'PT403', 'MX unpublish_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.unpublish_product(tt.oid('P1'), gen_random_uuid())$q$), '42501', 'MX unpublish_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT404', 'MX stage_import as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT404', 'MX stage_import as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT404', 'MX stage_import as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), 'PT403', 'MX stage_import as admin_ops');
select tt.anon();
select is(tt.code($q$select public.stage_import(tt.oid('P1'), gen_random_uuid(), 'create_only', 'f.csv', repeat('f', 64), '[{}]'::jsonb)$q$), '42501', 'MX stage_import as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'OK', 'MX list_my_suppliers as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'OK', 'MX list_my_suppliers as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'OK', 'MX list_my_suppliers as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'OK', 'MX list_my_suppliers as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), 'PT403', 'MX list_my_suppliers as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_my_suppliers(tt.oid('P1'))$q$), '42501', 'MX list_my_suppliers as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'OK', 'MX list_my_products as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'OK', 'MX list_my_products as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'OK', 'MX list_my_products as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'OK', 'MX list_my_products as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), 'PT403', 'MX list_my_products as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_my_products(tt.oid('P1'))$q$), '42501', 'MX list_my_products as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'OK', 'MX list_imports as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'OK', 'MX list_imports as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'OK', 'MX list_imports as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'OK', 'MX list_imports as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), 'PT403', 'MX list_imports as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_imports(tt.oid('P1'))$q$), '42501', 'MX list_imports as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'OK', 'MX list_partner_requests as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'OK', 'MX list_partner_requests as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'OK', 'MX list_partner_requests as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'OK', 'MX list_partner_requests as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), 'PT403', 'MX list_partner_requests as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_partner_requests(tt.oid('P1'))$q$), '42501', 'MX list_partner_requests as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT404', 'MX review_supplier as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT404', 'MX review_supplier as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), 'PT403', 'MX review_supplier as admin_ops');
select tt.anon();
select is(tt.code($q$select public.review_supplier(gen_random_uuid(), 'approve', null, array['contact_reachable'], 1)$q$), '42501', 'MX review_supplier as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT404', 'MX review_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT404', 'MX review_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), 'PT403', 'MX review_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.review_product(gen_random_uuid(), 'approve', null, 1)$q$), '42501', 'MX review_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_supplier as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_supplier as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_supplier as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_supplier as admin_ops');
select tt.anon();
select is(tt.code($q$select public.suspend_supplier(gen_random_uuid(), 'a long enough reason')$q$), '42501', 'MX suspend_supplier as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX reinstate_supplier as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX reinstate_supplier as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_supplier as admin_ops');
select tt.anon();
select is(tt.code($q$select public.reinstate_supplier(gen_random_uuid(), 'a long enough reason')$q$), '42501', 'MX reinstate_supplier as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.suspend_product(gen_random_uuid(), 'a long enough reason')$q$), '42501', 'MX suspend_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX reinstate_product as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX reinstate_product as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX reinstate_product as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX reinstate_product as admin_ops');
select tt.anon();
select is(tt.code($q$select public.reinstate_product(gen_random_uuid(), 'a long enough reason')$q$), '42501', 'MX reinstate_product as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT404', 'MX approve_partner as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT404', 'MX approve_partner as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), 'PT403', 'MX approve_partner as admin_ops');
select tt.anon();
select is(tt.code($q$select public.approve_partner(gen_random_uuid(), null)$q$), '42501', 'MX approve_partner as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_partner as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT404', 'MX suspend_partner as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), 'PT403', 'MX suspend_partner as admin_ops');
select tt.anon();
select is(tt.code($q$select public.suspend_partner(gen_random_uuid(), 'a long enough reason')$q$), '42501', 'MX suspend_partner as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'OK', 'MX list_partner_orgs as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'OK', 'MX list_partner_orgs as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), 'PT403', 'MX list_partner_orgs as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_partner_orgs(null, 0)$q$), '42501', 'MX list_partner_orgs as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'OK', 'MX list_supplier_reviews as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'OK', 'MX list_supplier_reviews as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), 'PT403', 'MX list_supplier_reviews as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_supplier_reviews('pending', 0)$q$), '42501', 'MX list_supplier_reviews as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'OK', 'MX list_product_reviews as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'OK', 'MX list_product_reviews as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_product_reviews(0)$q$), 'PT403', 'MX list_product_reviews as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_product_reviews(0)$q$), '42501', 'MX list_product_reviews as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT404', 'MX get_product_for_review as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT404', 'MX get_product_for_review as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), 'PT403', 'MX get_product_for_review as admin_ops');
select tt.anon();
select is(tt.code($q$select public.get_product_for_review(gen_random_uuid())$q$), '42501', 'MX get_product_for_review as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'OK', 'MX list_product_reports as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'OK', 'MX list_product_reports as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), 'PT403', 'MX list_product_reports as admin_ops');
select tt.anon();
select is(tt.code($q$select public.list_product_reports('open', 0)$q$), '42501', 'MX list_product_reports as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT404', 'MX handle_product_report as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT404', 'MX handle_product_report as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), 'PT403', 'MX handle_product_report as admin_ops');
select tt.anon();
select is(tt.code($q$select public.handle_product_report(gen_random_uuid(), 'dismiss', null)$q$), '42501', 'MX handle_product_report as anon');
select tt.act('tt_p1_owner', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as owner');
select tt.act('tt_p1_mgr', 'aal1');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as manager');
select tt.act('tt_p1_staff', 'aal1');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as staff');
select tt.act('tt_p1_view', 'aal1');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as viewer');
select tt.act('tt_p2_owner', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as other_partner_owner');
select tt.act('tt_bu_owner', 'aal1');
select is(tt.code($q$select public.catalogue_stats()$q$), 'PT403', 'MX catalogue_stats as buyer_owner');
select tt.act('tt_adm_rev', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'OK', 'MX catalogue_stats as admin_review');
select tt.act('tt_adm_sup', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'OK', 'MX catalogue_stats as admin_support');
select tt.act('tt_adm_super', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'OK', 'MX catalogue_stats as admin_super');
select tt.act('tt_adm_ops', 'aal2');
select is(tt.code($q$select public.catalogue_stats()$q$), 'OK', 'MX catalogue_stats as admin_ops');
select tt.anon();
select is(tt.code($q$select public.catalogue_stats()$q$), '42501', 'MX catalogue_stats as anon');
-- ===================== DB: privileges on the Phase 5 tables =====================
select tt.pg();
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('product_categories','partner_profiles','suppliers','supplier_private','supplier_documents','supplier_events',
     'products','product_revisions','catalogue_items','catalogue_variants','catalogue_price_tiers','product_media','import_jobs','import_rows','saved_products',
     'sourcing_requests','sourcing_request_items','sourcing_request_events','product_reports')
   and (has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate')
        or has_table_privilege('service_role', c.oid, 'select,insert,update,delete,truncate')) $$,
  'DB1 no API role can write a Phase 5 table directly, and anon and service_role cannot even read them');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('product_categories','partner_profiles','suppliers','supplier_private','supplier_documents','supplier_events',
     'products','product_revisions','catalogue_items','catalogue_variants','catalogue_price_tiers','product_media','import_jobs','import_rows','saved_products',
     'sourcing_requests','sourcing_request_items','sourcing_request_events','product_reports') and not c.relrowsecurity $$, 'DB2 row level security is on for every Phase 5 table');
select is_empty($$ select tablename from pg_policies where schemaname = 'public' and cmd <> 'SELECT' and tablename in ('product_categories','partner_profiles','suppliers','supplier_private',
     'supplier_documents','supplier_events','products','product_revisions','catalogue_items','catalogue_variants','catalogue_price_tiers','product_media','import_jobs','import_rows',
     'saved_products','sourcing_requests','sourcing_request_items','sourcing_request_events','product_reports') $$, 'DB3 Phase 5 tables have SELECT policies only');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname in ('search_catalogue','get_catalogue_item','compare_items','get_product_media_access')),
  array['compare_items','get_catalogue_item','get_product_media_access','search_catalogue'], 'DB4 anonymous visitors can run exactly the four public catalogue reads');
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'service\_%'
   and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.proname ~ '(supplier|product)' $$, 'DB5 Phase 5 service_* functions are not callable by browser sessions');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE') and (p.proname like '%supplier_document%' or p.proname like '%product_media%')),
  array['service_list_unscanned_product_media','service_list_unscanned_supplier_documents','service_register_product_media','service_register_supplier_document','service_set_product_media_scan','service_set_supplier_document_scan'],
  'DB6 the service role runs exactly the six upload/scan functions of Phase 5');

-- ===================== DEL: organisation and account erasure is never blocked =====================
select tt.pg();
select tt.mk_partner('PD', 'tt_pd_staff');
select tt.reg('BD', tt.mkorg('buyer', 'Doomed Buyer Zq8', 'tt_bd_owner'));
select tt.mk_supplier('SD', tt.oid('PD'), 'Doomed Supplier Zq8');
select tt.mk_published('PDP', tt.id('SD'), tt.good_data('DOOM-1', 'Doomed product Zq8'));
insert into public.product_media (product_id, partner_org_id, storage_path, mime_type, size_bytes, sha256, scan_status, approved)
values (tt.id('PDP'), tt.oid('PD'), 'products/' || tt.oid('PD') || '/' || tt.id('PDP') || '/doomed0001.png', 'image/png', 10, repeat('a', 64), 'clean', true);
insert into public.supplier_documents (supplier_id, partner_org_id, doc_type, display_name, mime_type, size_bytes, sha256, storage_path)
values (tt.id('SD'), tt.oid('PD'), 'other', 'doomed doc', 'application/pdf', 10, repeat('a', 64), 'supplier/' || tt.oid('PD') || '/' || tt.id('SD') || '/doomed0002.pdf');
insert into public.supplier_private (supplier_id, contact_name) values (tt.id('SD'), 'Doomed contact');
insert into public.import_jobs (partner_org_id, supplier_id, mode, status, file_name, file_sha256, counts, created_by)
values (tt.oid('PD'), tt.id('SD'), 'create_only', 'previewed', 'doomed.csv', repeat('d', 64), '{}', tt.uid('tt_du'));
insert into public.import_rows (job_id, row_no, sku, status, data) select id, 1, 'X', 'valid', '{}' from public.import_jobs where file_name = 'doomed.csv';
insert into public.saved_products (user_id, product_id, name_snapshot) values (tt.uid('tt_du'), tt.id('PDP'), 'Doomed product Zq8');
insert into public.supplier_events (supplier_id, partner_org_id, kind) values (tt.id('SD'), tt.oid('PD'), 'submitted');
insert into public.product_reports (product_id, reporter, reason, handled_by) values (tt.id('PDP'), tt.uid('tt_du'), 'spam', tt.uid('tt_du_admin'));
select tt.act('tt_bd_owner');
select tt.ids_set('RD', public.submit_sourcing_request(tt.oid('BD'), 'doomed-key-0001', jsonb_build_array(jsonb_build_object('product_id', tt.id('PDP'), 'quantity', 150)), 'Selangor', null, null, null));
select public.save_product(tt.id('V1'));
select tt.pg();
update public.suppliers set reviewed_by = tt.uid('tt_du_admin'), created_by = tt.uid('tt_du') where id = tt.id('SD');
update public.products set created_by = tt.uid('tt_du') where id = tt.id('PDP');
update public.partner_profiles set decided_by = tt.uid('tt_du_admin') where org_id = tt.oid('PD');
insert into public.saved_products (user_id, product_id, name_snapshot) values (tt.uid('tt_du'), tt.id('V1'), 'Stats product one');
insert into public.import_jobs (partner_org_id, supplier_id, mode, status, file_name, file_sha256, counts, created_by)
values (tt.oid('P1'), tt.id('SA'), 'create_only', 'previewed', 'du.csv', repeat('c', 64), '{}', tt.uid('tt_du'));
insert into public.product_reports (product_id, reporter, reason) values (tt.id('V2'), tt.uid('tt_du'), 'other');

-- deleting a USER (reporter, importer, saver, reviewer) succeeds and keeps what others own
select lives_ok($$ delete from auth.users where id = tt.uid('tt_du') $$, 'DEL1 deleting a user who saved, reported and imported succeeds');
select lives_ok($$ delete from auth.users where id = tt.uid('tt_du_admin') $$, 'DEL2 deleting an admin who reviewed and handled reports succeeds');
select is((select count(*)::int from public.saved_products where user_id = tt.uid('tt_du')), 0, 'DEL3 the saved products of a deleted user are removed');
select is((select count(*)::int from public.product_reports where reporter is null and product_id = tt.id('V2')), 1, 'DEL4 their reports stay with the reporter anonymised (set null)');
select is((select count(*)::int from public.import_jobs where file_name = 'du.csv' and created_by is null), 1, 'DEL5 import jobs stay with the author nulled');
select is((select count(*)::int from public.suppliers where id = tt.id('SD') and reviewed_by is null and created_by is null), 1, 'DEL6 supplier authorship columns are set null');
select is((select count(*)::int from public.partner_profiles where org_id = tt.oid('PD') and decided_by is null), 1, 'DEL7 and the partner decision author');
-- deleting a PARTNER organisation cascades everything it owns; buyers keep their request history
select lives_ok($$ delete from public.organisations where id = tt.oid('PD') $$, 'DEL8 deleting a partner organisation with suppliers, products, media, imports and requests succeeds');
select is((select count(*)::int from public.suppliers where partner_org_id = tt.oid('PD')), 0, 'DEL9 its suppliers are gone');
select is((select count(*)::int from public.products where id = tt.id('PDP')) + (select count(*)::int from public.product_revisions where product_id = tt.id('PDP'))
  + (select count(*)::int from public.catalogue_items where product_id = tt.id('PDP')) + (select count(*)::int from public.catalogue_price_tiers where product_id = tt.id('PDP'))
  + (select count(*)::int from public.product_media where product_id = tt.id('PDP')) + (select count(*)::int from public.supplier_documents where supplier_id = tt.id('SD'))
  + (select count(*)::int from public.supplier_private where supplier_id = tt.id('SD')) + (select count(*)::int from public.import_rows r join public.import_jobs j on j.id = r.job_id where j.file_name = 'doomed.csv'), 0,
  'DEL10 products, revisions, live rows, tiers, media, documents, contacts and import rows are all gone');
select is((select count(*)::int from public.product_reports where product_id = tt.id('PDP')), 0, 'DEL11 reports about its products are gone');
select is((select partner_org_id is null and supplier_id is null and supplier_name = 'Doomed Supplier Zq8' from public.sourcing_requests where id = tt.jid('RD')), true,
  'DEL12 the buyer keeps the request: partner and supplier links are nulled, the supplier name is kept');
select is((select count(*)::int from public.sourcing_request_items where request_id = tt.jid('RD') and product_id is null and snapshot ->> 'name' = 'Doomed product Zq8'), 1,
  'DEL13 and the line item keeps its snapshot with the product link nulled');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.id('SD')), 1, 'DEL14 append-only supplier history never blocks the deletion (it stays as history)');
-- deleting a BUYER organisation removes its requests, items and (append-only) events
select lives_ok($$ delete from public.organisations where id = tt.oid('BD') $$, 'DEL15 deleting a buyer organisation with sourcing requests succeeds');
select is((select count(*)::int from public.sourcing_requests where id = tt.jid('RD')) + (select count(*)::int from public.sourcing_request_items where request_id = tt.jid('RD'))
  + (select count(*)::int from public.sourcing_request_events where request_id = tt.jid('RD')), 0, 'DEL16 the request, its items and its events are erased together');
insert into public.sourcing_request_events (request_id, kind) select id, 'submitted' from public.sourcing_requests where reference = 'SR-AAAAAAA2';
select throws_ok($$ update public.sourcing_request_events set note = 'x' $$, '42501', null, 'DEL17 sourcing events stay append-only for updates');
select throws_ok($$ delete from public.sourcing_request_events where request_id = (select id from public.sourcing_requests where reference = 'SR-AAAAAAA2') $$, '42501', null, 'DEL18 and for direct deletes while the request exists');
select * from finish();
rollback;
