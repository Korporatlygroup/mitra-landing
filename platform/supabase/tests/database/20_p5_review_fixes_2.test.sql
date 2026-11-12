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

-- 000116 second review fixes: M1 supplier_events reads, M2 documents-only resubmission, M3 formula_text, M4 has_partner_involvement,
-- plus clean_text regression cases, product_media conflict-of-interest and re-upload of failed/cancelled imports.
select plan(57);
select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_rev2','tt_p1_owner','tt_p1_staff','tt_p1_view','tt_p3_owner']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_rev2', 'admin_review');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P3', 'tt_p3_owner');
-- tt_adm_rev2 was once a member of P1 (removed): permanent conflict of interest
insert into public.memberships (org_id, user_id, role, status, removed_at) values (tt.oid('P1'), tt.uid('tt_adm_rev2'), 'staff', 'removed', now());
select tt.mk_supplier('SA', tt.oid('P1'), 'Fixture supplier A');

-- Setup helper: a supplier created through the RPCs with one clean document, submitted by the partner owner.
create function tt.mk_submitted(p_label text, p_name text, p_hash char) returns void language plpgsql as $$
begin
  perform tt.act('tt_p1_owner', 'aal2');
  perform tt.ids_set(p_label, public.save_supplier_draft(tt.oid('P1'), null, jsonb_build_object('name', p_name, 'country', 'India',
    'state_city', 'Surat, Gujarat', 'main_category', 'textiles-apparel', 'description', 'Synthetic supplier description for tests.',
    'contact_name', 'Ravi Kumar', 'contact_email', 'ravi@example.test', 'registration_id', 'GST-SYN-001'), 0));
  perform tt.svc();
  perform tt.ids_set(p_label || 'd', jsonb_build_object('id', public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'),
    tt.jid(p_label), 'business_registration', 'GST certificate', 'application/pdf', 1000::bigint, repeat(p_hash::text, 64),
    'supplier/' || tt.oid('P1') || '/' || tt.jid(p_label) || '/abcdefgh' || p_hash || '001.pdf', 'pending', 'unit')));
  perform public.service_set_supplier_document_scan(tt.jid(p_label || 'd'), 'clean', 'test-engine');
  perform tt.act('tt_p1_owner', 'aal2');
  perform public.submit_supplier(tt.oid('P1'), tt.jid(p_label), 1);
end $$;
-- Register a further document for a supplier. pgTAP runs inside one transaction, so now() is frozen: p_later shifts the
-- document one second into the future to stand for "uploaded after the decision".
create function tt.add_doc(p_label text, p_n text, p_status public.scan_status, p_later boolean) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tt.svc();
  v := public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid(p_label), 'trade_reference', 'Reference ' || p_n,
    'application/pdf', 1000::bigint, repeat('c', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid(p_label) || '/extradoc' || p_n || '.pdf', 'pending', 'unit');
  if p_status <> 'pending' then perform public.service_set_supplier_document_scan(v, p_status, 'test-engine'); end if;
  perform tt.pg();
  if p_later then update public.supplier_documents set created_at = created_at + interval '1 second' where id = v; end if;
  return v;
end $$;

select tt.mk_submitted('S1', 'Surat Textiles Exports', '1');
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 1);
select tt.pg();
select tt.mk_published('PH', tt.jid('S1'), tt.good_data('M116-PROD'));
select tt.svc();
select public.service_register_product_media(tt.oid('P1'), tt.uid('tt_p1_staff'), tt.id('PH'), 'image/png', 1000::bigint, repeat('d', 64),
  'products/' || tt.oid('P1') || '/' || tt.id('PH') || '/imgfile0001.png', 'clean', 'unit', 'Synthetic photo');

-- ===================== M1: supplier_events follows the supplier reviewer predicate =====================
select tt.act('tt_adm_rev', 'aal2');
select ok((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1')) >= 2, 'M1.1 control: an uninvolved reviewer reads the events of a submitted supplier');
select tt.act('tt_adm_rev2', 'aal2');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1')), 0, 'M1.2 a conflicted reviewer reads no supplier_events of that partner');
select is((select count(*)::int from public.supplier_events where partner_org_id = tt.oid('P1')), 0, 'M1.3 not by partner either');
select tt.act('tt_p1_owner', 'aal2');
select ok((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1')) >= 2, 'M1.4 member access is unchanged (owner)');
select tt.act('tt_p1_view');
select ok((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1')) >= 2, 'M1.5 member access is unchanged (viewer)');
select tt.act('tt_p3_owner', 'aal2');
select is((select count(*)::int from public.supplier_events where partner_org_id = tt.oid('P1')), 0, 'M1.6 another partner reads nothing');
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('S3', public.save_supplier_draft(tt.oid('P1'), null, '{"name":"Draft Only Ltd"}'::jsonb, 0));
select tt.pg();
select private.add_supplier_event(tt.jid('S3'), tt.oid('P1'), tt.uid('tt_p1_owner'), 'document_uploaded', null, null, null, '{}'::jsonb);
select tt.act('tt_adm_rev', 'aal2');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S3')), 0, 'M1.7 an uninvolved reviewer does not read the events of a draft supplier');
select tt.act('tt_p1_owner', 'aal2');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S3')), 1, 'M1.8 the partner does');

-- ===================== M2: documents-only resubmission =====================
-- approved supplier S1, nothing changed
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.1 an unchanged approved supplier cannot be resubmitted');
select tt.add_doc('S1', 'p1', 'pending', true);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.2 a document that is not clean yet does not count');
select tt.add_doc('S1', 'p2', 'failed', true);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.3 nor one whose scan failed');
select tt.add_doc('S1', 'p3', 'clean', false);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.4 a clean document registered no later than the decision does not count');
select tt.add_doc('S1', 'p4', 'clean', true);
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 1);
select tt.pg();
select is((select status::text || '/' || draft_submitted_version::text from public.suppliers where id = tt.jid('S1')), 'approved/1', 'M2.5 a clean document added after approval allows a documents-only resubmission');
select is((select kind from public.supplier_events where supplier_id = tt.jid('S1') order by id desc limit 1), 'resubmitted', 'M2.6 recorded as a resubmission');

-- rejected supplier S2
select tt.mk_submitted('S2', 'Second Supplier Co', '2');
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S2'), 'reject', 'Please add a trade reference.', null, 1);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.7 rejected and unchanged: still refused');
select tt.add_doc('S2', 'r1', 'clean', true);
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 1);
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S2')), 'awaiting_review', 'M2.8 rejected: uploading the requested document is enough to resubmit');

-- more_info_needed supplier S4
select tt.mk_submitted('S4', 'Fourth Supplier Co', '4');
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S4'), 'request_info', 'Please add a trade reference.', null, 1);
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S4'), 1) $$, 'PT409', 'nothing_to_submit', 'M2.9 more_info_needed and unchanged: still refused');
select tt.add_doc('S4', 'm1', 'clean', true);
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S4'), 1);
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S4')), 'awaiting_review', 'M2.10 more_info_needed: uploading the requested document is enough to resubmit');

-- ===================== M3: formula_text =====================
select is(private.formula_text(E'\tabc'), true, 'M3.1 a leading tab is a formula risk again');
select is(private.formula_text(E'\rabc'), true, 'M3.2 a leading CR is a formula risk again');
select is(private.bad_text(E'\tabc', 50), 'formula_text', 'M3.3 bad_text agrees (tab)');
select is(private.bad_text(E'\rabc', 50), 'formula_text', 'M3.4 bad_text agrees (CR)');
select is(private.formula_text(E'\n- bullet'), false, 'M3.5 a blank first line before "- bullet" behaves as before 000115 (accepted)');
select is(private.formula_text(E'\n\n- one\n- two'), false, 'M3.6 also for a longer multi-line text');
select is(private.formula_text(E'a\tb'), false, 'M3.7 a tab inside the text is fine');
select is(private.formula_text(E'  =1'), true, 'M3.8 a formula behind a space and NBSP is still seen');
select is(private.formula_text(E'⁠﻿­@x'), true, 'M3.9 behind a word joiner, BOM and soft hyphen');
select is(private.formula_text(E'‍‌+1'), true, 'M3.10 behind ZWJ and ZWNJ');
select is(private.formula_text('Plain text'), false, 'M3.11 plain text is fine');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'\tabc'), 1) $$, 'PT422', 'formula_text', 'M3.12 a name starting with a tab is refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('name', E'\rabc'), 1) $$, 'PT422', 'formula_text', 'M3.13 a name starting with CR is refused');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S3'), jsonb_build_object('description', E'\n- first point\n- second point'), 1)) ->> 'version', '2',
  'M3.14 a multi-line description with a blank first line and "- bullet" is accepted');

-- ===================== clean_text regression =====================
select tt.pg();
select is(private.clean_text(E'\U0001F468‍\U0001F469‍\U0001F467 family', 1, 40, 'x'), E'\U0001F468‍\U0001F469‍\U0001F467 family', 'C1 an emoji ZWJ sequence passes');
select is(private.clean_text(E'க்‌ஷ', 1, 40, 'x'), E'க்‌ஷ', 'C2 Tamil with ZWNJ passes');
select is(private.clean_text(E'தமிழ் நாடு கடை', 1, 40, 'x'), E'தமிழ் நாடு கடை', 'C3 Tamil text passes');
select is(private.clean_text('Kedai Runcit Pak Ali & Anak-anak, Sdn. Bhd.', 1, 60, 'x'), 'Kedai Runcit Pak Ali & Anak-anak, Sdn. Bhd.', 'C4 Malay text passes');
select is(private.clean_text(E'\U0001F6CD️ Kedai Ibu', 1, 40, 'x'), E'\U0001F6CD️ Kedai Ibu', 'C5 emoji passes');
select throws_ok($$ select private.clean_text(E'a​b', 1, 40, 'bad_x') $$, 'PT422', 'bad_x', 'C6 a zero-width space is still rejected');

-- ===================== product_media and conflict of interest =====================
select tt.act('tt_adm_rev', 'aal2');
select is((select count(*)::int from public.product_media where product_id = tt.id('PH')), 1, 'PM1 control: an uninvolved reviewer reads the product media');
select tt.act('tt_adm_rev2', 'aal2');
select is((select count(*)::int from public.product_media where product_id = tt.id('PH')), 0, 'PM2 a conflicted reviewer cannot read product_media');
select tt.act('tt_p1_staff');
select is((select count(*)::int from public.product_media where product_id = tt.id('PH')), 1, 'PM3 members still can');

-- ===================== M4: has_partner_involvement only answers about the caller =====================
select tt.act('tt_adm_rev', 'aal2');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_adm_rev2')), false, 'M4.1 asking about another (involved) user returns false');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_p1_owner')), false, 'M4.2 nor about a member');
select is(private.has_partner_involvement(tt.oid('P1'), null), false, 'M4.3 a null user is false');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_adm_rev')), false, 'M4.4 an uninvolved caller asking about itself is false');
select tt.act('tt_adm_rev2', 'aal2');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_adm_rev2')), true, 'M4.5 a conflicted caller asking about itself is true (RLS keeps working)');
select tt.act('tt_p1_owner', 'aal2');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_adm_rev2')), false, 'M4.6 a member cannot probe a reviewer');
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_p1_owner')), true, 'M4.7 a member asking about itself is true');
select tt.pg();
select is(private.has_partner_involvement(tt.oid('P1'), tt.uid('tt_adm_rev2')), false, 'M4.8 without a signed-in user the answer is false');
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S2'), 'approve', null, array['contact_reachable'], 1) $$, 'PT403', 'conflict_of_interest', 'M4.9 the conflicted reviewer is still refused by the RPC');

-- ===================== import: re-upload of a failed / cancelled job =====================
select tt.pg();
create function tt.row(n integer, p_sku text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('_row', n, 'sku', p_sku, 'name', 'Import item ' || p_sku, 'category_slug', 'textiles-apparel', 'unit', 'pcs',
    'moq', '50', 'currency', 'INR', 'unit_price', '12.50') || p_extra
$$;
create function tt.stage(p_hash text, p_rows jsonb) returns jsonb language sql as $$
  select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'products.csv', repeat(p_hash, 64 / length(p_hash)), p_rows)
$$;
select tt.act('tt_p1_staff');
select tt.ids_set('F1', tt.stage('5', jsonb_build_array(tt.row(2, 'F-01', '{"category_slug":"no-such-category"}'::jsonb))));
select is(tt.idj('F1') ->> 'status', 'failed', 'I1 a file with no valid row fails');
select tt.ids_set('F2', tt.stage('5', jsonb_build_array(tt.row(2, 'F-01', '{"category_slug":"no-such-category"}'::jsonb))));
select isnt(tt.idj('F2') ->> 'job_id', tt.idj('F1') ->> 'job_id', 'I2 re-uploading the failed file creates a new job');
select is(tt.idj('F2') ->> 'created', 'true', 'I3 flagged as created');
select tt.ids_set('F3', tt.stage('6', jsonb_build_array(tt.row(2, 'C-01'), tt.row(3, 'C-02'))));
select is(tt.idj('F3') ->> 'status', 'previewed', 'I4 a valid file is previewed');
select public.cancel_import((tt.idj('F3') ->> 'job_id')::uuid);
select tt.ids_set('F4', tt.stage('6', jsonb_build_array(tt.row(2, 'C-01'), tt.row(3, 'C-02'))));
select isnt(tt.idj('F4') ->> 'job_id', tt.idj('F3') ->> 'job_id', 'I5 re-uploading the cancelled file creates a new job');
select is(tt.idj('F4') ->> 'status', 'previewed', 'I6 and it is previewed');
select tt.pg();
select is((select status from public.import_jobs where id = (tt.idj('F3') ->> 'job_id')::uuid), 'cancelled', 'I7 the cancelled job is untouched');

select * from finish();
rollback;
