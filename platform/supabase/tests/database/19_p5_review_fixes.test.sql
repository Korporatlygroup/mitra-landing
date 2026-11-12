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

-- 000115 review fixes: H1, M1, M2, M4, M5, M7, L2, L3, L5, L8.
select plan(62);
select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_rev2','tt_p1_owner','tt_p1_staff','tt_p1_view','tt_p3_owner','tt_p4_owner','tt_buyer']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_rev2', 'admin_review');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P3', 'tt_p3_owner', 'suspended');
select tt.mk_partner('P4', 'tt_p4_owner', 'pending');
select tt.reg('B', tt.mkorg('buyer', 'Buyer P5', 'tt_buyer'));
-- tt_adm_rev2 was once a member of P1 (removed): permanent conflict of interest
insert into public.memberships (org_id, user_id, role, status, removed_at) values (tt.oid('P1'), tt.uid('tt_adm_rev2'), 'staff', 'removed', now());
select tt.mk_supplier('SA', tt.oid('P1'), 'Fixture supplier A');

-- ===================== setup: a real supplier through the RPCs, approved once, resubmitted, then suspended =====================
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('S1', public.save_supplier_draft(tt.oid('P1'), null, jsonb_build_object('name', 'Surat Textiles Exports', 'country', 'India',
  'state_city', 'Surat, Gujarat', 'main_category', 'textiles-apparel', 'description', 'Synthetic exporter of cotton garments for tests.',
  'contact_name', 'Ravi Kumar', 'contact_email', 'ravi@example.test', 'contact_phone', '+91 98765 43210', 'registration_id', 'GST-SYN-001'), 0));
select tt.svc();
select tt.ids_set('D1', jsonb_build_object('id', public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'business_registration', 'GST certificate',
  'application/pdf', 1000::bigint, repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'pending', 'unit')));
select public.service_set_supplier_document_scan(tt.jid('D1'), 'clean', 'test-engine');
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1);
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 1);
select tt.pg();
select tt.mk_published('PH', tt.jid('S1'), tt.good_data('H1-PROD'));
select is(private.product_visible(tt.id('PH')), true, 'H1.0 setup: the approved supplier product is visible');
select tt.act('tt_p1_owner', 'aal2');
select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"Surat, Gujarat, India"}'::jsonb, 1);
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 2);
select tt.act('tt_adm_rev', 'aal2');
select public.suspend_supplier(tt.jid('S1'), 'Suspended while the revision is pending.');
select tt.pg();
select is((select status::text || '/' || coalesce(draft_submitted_version::text, 'none') from public.suppliers where id = tt.jid('S1')), 'suspended/none', 'H1.1 suspending clears the pending submission');

-- ===================== H1: review cannot lift a suspension =====================
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 2) $$, 'PT409', 'supplier_suspended', 'H1.2 approve on a suspended supplier is refused');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'reject', 'Not acceptable for now.', null, 2) $$, 'PT409', 'supplier_suspended', 'H1.3 reject is refused');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'request_info', 'Please send more detail.', null, 2) $$, 'PT409', 'supplier_suspended', 'H1.4 request_info is refused');
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'suspended', 'H1.5 the supplier is still suspended');
select is(private.product_visible(tt.id('PH')), false, 'H1.6 its products stay hidden');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 2) $$, 'PT409', 'supplier_suspended', 'H1.7 the partner cannot resubmit a suspended supplier');
select throws_ok($$ select public.withdraw_supplier_submission(tt.oid('P1'), tt.jid('S1')) $$, 'PT409', 'supplier_not_pending', 'H1.8 nothing is pending to withdraw');
select tt.pg();
update public.suppliers set draft_submitted_version = 2 where id = tt.jid('S1');
select tt.act('tt_p1_owner', 'aal2');
select public.withdraw_supplier_submission(tt.oid('P1'), tt.jid('S1'));
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'suspended', 'H1.9 withdrawing keeps the supplier suspended');

-- ===================== L3: no media for a product of a suspended supplier =====================
select tt.svc();
select throws_ok($$ select public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.id('PH'), 'image/png', 1000::bigint, repeat('a', 64),
  'products/' || tt.oid('P1') || '/' || tt.id('PH') || '/imgfile0001.png', 'pending', 'u', null) $$, 'PT409', 'supplier_suspended', 'L3.1 media upload for a suspended supplier is refused');

-- ===================== M4: private contact data =====================
select tt.act('tt_p1_owner', 'aal1');
select is((select count(*)::int from public.supplier_private where supplier_id = tt.jid('S1')), 0, 'M4.1 an owner without MFA cannot read the private row');
select is(public.get_supplier(tt.jid('S1')) -> 'private', 'null'::jsonb, 'M4.2 nor through get_supplier');
select tt.act('tt_p1_owner', 'aal2');
select is((select count(*)::int from public.supplier_private where supplier_id = tt.jid('S1')), 1, 'M4.3 the owner with MFA can');
select is(public.get_supplier(tt.jid('S1')) -> 'private' ->> 'contact_name', 'Ravi Kumar', 'M4.4 get_supplier returns it');
select tt.act('tt_p1_staff');
select is(public.get_supplier(tt.jid('S1')) -> 'private' ->> 'registration_id', 'GST-SYN-001', 'M4.5 staff (supplier:manage) can');
select tt.act('tt_p1_view');
select is(public.get_supplier(tt.jid('S1')) -> 'private', 'null'::jsonb, 'M4.6 a viewer gets the supplier without private fields');
select is((select count(*)::int from public.suppliers where id = tt.jid('S1')), 1, 'M4.7 but still sees the supplier row');
select tt.act('tt_adm_rev', 'aal2');
select is(public.get_supplier(tt.jid('S1')) -> 'private' ->> 'contact_email', 'ravi@example.test', 'M4.8 an uninvolved reviewer can read it');

-- ===================== M5: conflicted reviewer reads =====================
select tt.act('tt_adm_rev', 'aal2');
select is((select count(*)::int from public.suppliers where id = tt.jid('S1')), 1, 'M5.1 control: an uninvolved reviewer sees the supplier');
select is((select count(*)::int from public.supplier_documents where supplier_id = tt.jid('S1')), 1, 'M5.2 and its locked document');
select is((select count(*)::int from public.products where id = tt.id('PH')), 1, 'M5.3 and its product');
select is((select count(*)::int from public.product_revisions where product_id = tt.id('PH')), 1, 'M5.4 and its revision');
select tt.act('tt_adm_rev2', 'aal2');
select is((select count(*)::int from public.suppliers where id = tt.jid('S1')), 0, 'M5.5 a conflicted reviewer sees no supplier row');
select is((select count(*)::int from public.supplier_private where supplier_id = tt.jid('S1')), 0, 'M5.6 no private row');
select is((select count(*)::int from public.supplier_documents where supplier_id = tt.jid('S1')), 0, 'M5.7 no documents');
select is((select count(*)::int from public.products where id = tt.id('PH')), 0, 'M5.8 no product');
select is((select count(*)::int from public.product_revisions where product_id = tt.id('PH')), 0, 'M5.9 no revision');
select is((select count(*)::int from public.catalogue_items where product_id = tt.id('PH')), 0, 'M5.10 no live item through the products policy');

-- ===================== M7: reinstating a suspended partner needs a reason =====================
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.approve_partner(tt.oid('P3'), null) $$, 'PT422', 'reason_required', 'M7.1 approving a suspended partner without a reason is refused');
select throws_ok($$ select public.approve_partner(tt.oid('P3'), 'ok') $$, 'PT422', 'reason_required', 'M7.2 a reason shorter than 5 characters is refused');
select public.approve_partner(tt.oid('P3'), 'Reinstated after the review.');
select is((select status::text || '/' || decision_reason from public.partner_profiles where org_id = tt.oid('P3')), 'approved/Reinstated after the review.', 'M7.3 with a reason it works');
select public.approve_partner(tt.oid('P4'), null);
select is((select status::text from public.partner_profiles where org_id = tt.oid('P4')), 'approved', 'M7.4 approving a pending partner still needs no reason');

-- ===================== L2: hidden characters =====================
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('S3', public.save_supplier_draft(tt.oid('P1'), null, '{"name":"Hidden Chars Ltd"}'::jsonb, 0));
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E' =SUM(1)'), 1) $$, 'PT422', 'formula_text', 'L2.1 a formula hidden behind a leading NBSP is refused');
select tt.pg();
select is(private.formula_text(E'\n=cmd|x'), false, 'L2.2 a leading newline is not skipped (000116 M3: behaves as before 000115)');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'﻿+1+1'), 1) $$, 'PT422', 'invalid_name', 'L2.3 a BOM is refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'​=cmd'), 1) $$, 'PT422', 'invalid_name', 'L2.4 a zero-width space is refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'Acme ‮td.exe'), 1) $$, 'PT422', 'invalid_name', 'L2.5 a bidi override is refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'Acme ⁦Ltd⁩'), 1) $$, 'PT422', 'invalid_name', 'L2.6 bidi isolates are refused');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'Tamil‌Text Ltd'), 1)) ->> 'version', '2', 'L2.7 ZWNJ (needed by Indic scripts) is still accepted');
select tt.pg();
select is(private.bad_text(E'a‮b', 50), 'invalid_text', 'L2.8 bad_text rejects bidi characters');
select is(private.bad_text(E' =1', 50), 'formula_text', 'L2.9 bad_text sees a formula behind NBSP');
select is(private.bad_text(E'​​@x', 50), 'invalid_text', 'L2.10 bad_text rejects zero-width characters');
select is(private.bad_text('Plain text', 50), null, 'L2.11 plain text is fine');
select is(private.bad_text('-5 pcs', 50), 'formula_text', 'L2.12 a leading minus is still refused (unchanged; accepted limit)');
select is(private.formula_text(E'⁠=1'), true, 'L2.13 formula_text sees through a word joiner');

-- ===================== L5: unchanged resubmission after a rejection =====================
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('S2', public.save_supplier_draft(tt.oid('P1'), null, jsonb_build_object('name', 'Second Supplier Co', 'country', 'India',
  'state_city', 'Tiruppur', 'main_category', 'textiles-apparel', 'description', 'Synthetic second supplier description for tests.',
  'contact_name', 'Asha Devi', 'contact_email', 'asha@example.test'), 0));
select tt.svc();
select tt.ids_set('D2', jsonb_build_object('id', public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S2'), 'business_registration', 'GST certificate',
  'application/pdf', 1000::bigint, repeat('b', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S2') || '/abcdefgh0002.pdf', 'pending', 'unit')));
select public.service_set_supplier_document_scan(tt.jid('D2'), 'clean', 'test-engine');
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 1);
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S2'), 'reject', 'Documents are not sufficient.', null, 1);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 1) $$, 'PT409', 'nothing_to_submit', 'L5.1 an unchanged rejected supplier cannot be resubmitted');
select public.save_supplier_draft(tt.oid('P1'), tt.jid('S2'), '{"state_city":"Tiruppur, Tamil Nadu"}'::jsonb, 1);
select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 2);
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S2')), 'awaiting_review', 'L5.2 after an edit it can be submitted again');
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S2'), 'request_info', 'Please add a trade reference.', null, 2);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 2) $$, 'PT409', 'nothing_to_submit', 'L5.3 same for more_info_needed');

-- ===================== M2 and L8: import =====================
select tt.pg();
create function tt.row(n integer, p_sku text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('_row', n, 'sku', p_sku, 'name', 'Import item ' || p_sku, 'category_slug', 'textiles-apparel', 'unit', 'pcs',
    'moq', '50', 'currency', 'INR', 'unit_price', '12.50') || p_extra
$$;
create function tt.stage(p_hash text, p_rows jsonb) returns jsonb language sql as $$
  select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'products.csv', repeat(p_hash, 64 / length(p_hash)), p_rows)
$$;
select tt.act('tt_p1_staff');
select tt.ids_set('J1', tt.stage('1', jsonb_build_array(tt.row(2, 'M2-01'), tt.row(3, 'M2-02'))));
select is(tt.idj('J1') ->> 'created', 'true', 'M2.1 first upload creates a job');
select tt.ids_set('J1b', tt.stage('1', jsonb_build_array(tt.row(2, 'M2-01'), tt.row(3, 'M2-02'))));
select is(tt.idj('J1b') ->> 'job_id', tt.idj('J1') ->> 'job_id', 'M2.2 a retry while previewed returns the same job');
select is(tt.idj('J1b') ->> 'created', 'false', 'M2.3 and says it was not created');
select public.commit_import((tt.idj('J1') ->> 'job_id')::uuid, false);
select tt.ids_set('J1c', tt.stage('1', jsonb_build_array(tt.row(2, 'M2-03'), tt.row(3, 'M2-04'))));
select isnt(tt.idj('J1c') ->> 'job_id', tt.idj('J1') ->> 'job_id', 'M2.4 re-uploading the same file after the commit creates a new job');
select is(tt.idj('J1c') ->> 'created', 'true', 'M2.5 flagged as created');
select is(tt.idj('J1c') ->> 'status', 'previewed', 'M2.6 and previewed, ready to be checked');
select is((select status from public.import_jobs where id = (tt.idj('J1') ->> 'job_id')::uuid), 'committed', 'M2.7 the committed job is untouched');
select is((select count(*)::int from public.import_jobs where file_sha256 = repeat('1', 64) and supplier_id = tt.id('SA')), 2, 'M2.8 both jobs exist');
select throws_ok($$ select tt.stage('2', jsonb_build_array(tt.row(1, 'L8-1'), tt.row(1, 'L8-2'))) $$, 'PT422', 'invalid_row_number', 'L8.1 a repeated _row is refused with invalid_row_number');
select tt.pg();
select is((select count(*)::int from public.import_jobs where file_sha256 = repeat('2', 64)), 0, 'L8.2 no job is left behind');

-- ===================== M1: sourcing request snapshot locks the product row =====================
select tt.mk_published('PB', tt.id('SA'), tt.good_data('M1-PROD'));
select is((select prosrc like '%p.status = ''published'' for share%' from pg_proc where proname = 'submit_sourcing_request' and pronamespace = 'public'::regnamespace), true,
  'M1.1 submit_sourcing_request locks the published product row FOR SHARE');
select tt.act('tt_buyer');
select is((public.submit_sourcing_request(tt.oid('B'), 'req-key-m1-0001', jsonb_build_array(jsonb_build_object('product_id', tt.id('PB'), 'quantity', 150)),
  'Selangor', 'Shah Alam', current_date + 30, 'Synthetic notes for sourcing')) ->> 'created', 'true', 'M1.2 a request for a published product still works');
select tt.pg();
update public.products set status = 'unpublished' where id = tt.id('PB');
select tt.act('tt_buyer');
select throws_ok($$ select public.submit_sourcing_request(tt.oid('B'), 'req-key-m1-0002', jsonb_build_array(jsonb_build_object('product_id', tt.id('PB'), 'quantity', 150)),
  'Selangor', 'Shah Alam', current_date + 30, 'Synthetic notes for sourcing') $$, 'PT404', 'not_found', 'M1.3 an unpublished product is not found');

select * from finish();
rollback;
