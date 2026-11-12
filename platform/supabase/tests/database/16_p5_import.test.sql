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

select plan(85);
create function tt.row(n integer, p_sku text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('_row', n, 'sku', p_sku, 'name', 'Import item ' || p_sku, 'category_slug', 'textiles-apparel', 'unit', 'pcs',
    'moq', '50', 'currency', 'INR', 'unit_price', '12.50') || p_extra
$$;
create function tt.stage(p_org text, p_sup text, p_mode text, p_hash text, p_rows jsonb) returns jsonb language sql as $$
  select public.stage_import(tt.oid(p_org), tt.id(p_sup), p_mode, 'products.csv', repeat(p_hash, 64 / length(p_hash)), p_rows)
$$;
create function tt.rownos(p_j jsonb) returns integer[] language sql stable as $$
  select coalesce(array_agg((x ->> 'row_no')::int order by (x ->> 'row_no')::int), array[]::int[]) from jsonb_array_elements(p_j -> 'rows') x
$$;

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_p1_owner','tt_p1_staff','tt_p1_view','tt_p2_owner','tt_buyer']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P2', 'tt_p2_owner');
select tt.mk_supplier('SA', tt.oid('P1'), 'Import Supplier A Zq6');
select tt.mk_supplier('SA2', tt.oid('P1'), 'Import Supplier A2 Zq6');
select tt.mk_supplier('SB', tt.oid('P2'), 'Import Supplier B Zq6');
select tt.pg();
select tt.mk_supplier('SS', tt.oid('P1'), 'Suspended Supplier Zq6');
update public.suppliers set status = 'suspended', suspended_reason = 'fixture' where id = tt.id('SS');
-- existing products: a draft one, a published one, a submitted one and a suspended one under SA
select tt.act('tt_p1_staff');
select tt.ids_set('E1', public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('EXIST-1', 'Old name Zq6') || '{"description":"Original description kept by the merge."}', 0));
select tt.pg();
select tt.mk_published('EP', tt.id('SA'), tt.good_data('EXIST-PUB', 'Live name Zq6'));
insert into public.products (supplier_id, partner_org_id, sku, status, draft) values (tt.id('SA'), tt.oid('P1'), 'EXIST-SUSP', 'suspended', '{"sku":"EXIST-SUSP"}');
insert into public.products (supplier_id, partner_org_id, sku, status, draft) values (tt.id('SB'), tt.oid('P2'), 'EXIST-1', 'draft', '{"sku":"EXIST-1","name":"Other partner same SKU"}');

-- ===================== A: the acceptance scenario: 10 rows, 7 valid, 3 invalid =====================
select tt.act('tt_p1_staff');
select tt.ids_set('J1', tt.stage('P1', 'SA', 'create_only', '1', jsonb_build_array(
  tt.row(2, 'IMP-01'),
  tt.row(3, 'IMP-02', '{"unit_price":null,"tiers":[{"min_qty":1,"max_qty":99,"unit_price":"10"},{"min_qty":100,"unit_price":"9"}],"moq":"50"}'),
  tt.row(4, 'IMP-03', '{"price_mode":"request","unit_price":null,"currency":null}'),
  tt.row(5, 'IMP-04', '{"moq":"0"}'),
  tt.row(6, 'IMP-05'),
  tt.row(7, 'IMP-06', '{"currency":"EUR"}'),
  tt.row(8, 'IMP-07', '{"description":"With a description"}'),
  tt.row(9, 'IMP-08', '{"category_slug":"no-such-category"}'),
  tt.row(10, 'IMP-09'),
  tt.row(11, 'IMP-10', '{"price_confirmed_on":"2026-01-15"}'))));
select is(tt.idj('J1') -> 'counts', '{"total":10,"valid":7,"invalid":3,"duplicate":0}'::jsonb, 'A1 staging reports 10 rows, 7 valid and 3 invalid');
select is(tt.rownos(tt.idj('J1')), array[5, 7, 9], 'A2 the invalid rows are exactly the spreadsheet rows 5, 7 and 9');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J1') -> 'rows') x where (x ->> 'row_no') = '5'), '["invalid_moq"]'::jsonb, 'A3 row 5 fails for its MOQ');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J1') -> 'rows') x where (x ->> 'row_no') = '7'), '["invalid_currency"]'::jsonb, 'A4 row 7 fails for its currency');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J1') -> 'rows') x where (x ->> 'row_no') = '9'), '["invalid_category"]'::jsonb, 'A5 row 9 fails for its category');
select is(tt.idj('J1') ->> 'status', 'previewed', 'A6 the job waits for confirmation');
select is((public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'renamed.csv', repeat('1', 64),
  jsonb_build_array(tt.row(2, 'DIFFERENT-ROWS-IGNORED')))) ->> 'job_id', tt.idj('J1') ->> 'job_id', 'A7 retrying the same file (hash) returns the same job and ignores new rows');
select is((public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'renamed.csv', repeat('1', 64), jsonb_build_array(tt.row(2, 'IGNORED-2')))) ->> 'created', 'false', 'A8 and says it was not created again');
select tt.pg();
select is((select count(*)::int from public.import_jobs where partner_org_id = tt.oid('P1') and file_sha256 = repeat('1', 64)), 1, 'A9 exactly one job exists for the file');
select is((select count(*)::int from public.import_rows where job_id = (tt.idj('J1') ->> 'job_id')::uuid), 10, 'A10 ten staged rows');
select is((select count(*)::int from public.products where supplier_id = tt.id('SA') and sku like 'IMP-%'), 0, 'A11 staging writes no product');
select tt.act('tt_p1_view');
select throws_ok($$ select public.commit_import((tt.idj('J1') ->> 'job_id')::uuid, false) $$, 'PT404', 'not_found', 'A12 a viewer cannot commit');
select throws_ok($$ select tt.stage('P1', 'SA', 'create_only', '9', '[{"sku":"X"}]'::jsonb) $$, 'PT403', 'forbidden', 'A13 a viewer cannot stage');
select is(public.get_import(tt.oid('P1'), (tt.idj('J1') ->> 'job_id')::uuid) ->> 'status', 'previewed', 'A14 but can read the job');
select tt.act('tt_p1_staff');
select tt.ids_set('C1', public.commit_import((tt.idj('J1') ->> 'job_id')::uuid, false));
select is(tt.idj('C1') -> 'created', '7'::jsonb, 'A15 committing creates the 7 valid products');
select is(tt.idj('C1') -> 'skipped', '0'::jsonb, 'A16 and skips none');
select is((public.commit_import((tt.idj('J1') ->> 'job_id')::uuid, false)) ->> 'repeat', 'true', 'A17 committing again is an idempotent no-op');
select tt.pg();
select is((select count(*)::int from public.products where supplier_id = tt.id('SA') and sku like 'IMP-%'), 7, 'A18 exactly 7 products exist (no duplicates from the retry)');
select is((select count(*)::int from public.products where supplier_id = tt.id('SA') and sku like 'IMP-%' and status = 'draft'), 7, 'A19 every imported product is a draft: import never publishes');
select is((select count(*)::int from public.catalogue_items ci join public.products p on p.id = ci.product_id where p.sku like 'IMP-%'), 0, 'A20 nothing reached the live catalogue');
select is((select draft ->> 'price_confirmed_on' from public.products where sku = 'IMP-01' and supplier_id = tt.id('SA')), to_char(current_date, 'YYYY-MM-DD'), 'A21 a missing price date defaults to the import date');
select is((select draft ->> 'price_confirmed_on' from public.products where sku = 'IMP-10' and supplier_id = tt.id('SA')), '2026-01-15', 'A22 a supplied price date is kept');
select is((select jsonb_array_length(draft -> 'tiers') from public.products where sku = 'IMP-02' and supplier_id = tt.id('SA')), 2, 'A23 tiers are imported');
select is((select count(*)::int from public.audit_log where action = 'catalogue.import_committed' and entity_id = (tt.idj('J1') ->> 'job_id')),  1, 'A24 one audit entry for the commit (the retry added none)');
select is((select details -> 'skus_created' @> '["IMP-01","IMP-10"]'::jsonb from public.audit_log where action = 'catalogue.import_committed' and entity_id = (tt.idj('J1') ->> 'job_id')), true, 'A25 the audit entry lists the SKUs created');
select is((select count(*)::int from public.audit_log where action = 'catalogue.import_staged' and entity_id = (tt.idj('J1') ->> 'job_id')), 1, 'A26 staging is audited once');

-- ===================== B: modes, duplicates, existing products =====================
select tt.act('tt_p1_staff');
select tt.ids_set('J2', tt.stage('P1', 'SA', 'create_only', '2', jsonb_build_array(
  tt.row(2, 'DUP-1'), tt.row(3, 'dup-1'), tt.row(4, 'EXIST-1'), tt.row(5, 'EXIST-PUB'), tt.row(6, 'NEW-OK'))));
select is(tt.idj('J2') -> 'counts', '{"total":5,"valid":2,"invalid":2,"duplicate":1}'::jsonb, 'B1 later copies of a SKU (case-insensitive) and existing SKUs are flagged, the first copy stays valid');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J2') -> 'rows') x where (x ->> 'row_no') = '3'), '["duplicate_sku_in_file"]'::jsonb, 'B2 only the later copy of a duplicated SKU is refused (same rule as the client import engine)');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J2') -> 'rows') x where (x ->> 'row_no') = '4'), '["sku_exists"]'::jsonb, 'B3 create_only refuses an existing SKU of the same supplier');
select tt.ids_set('J3', tt.stage('P1', 'SA', 'create_or_update', '2', jsonb_build_array(
  tt.row(2, 'EXIST-1', '{"name":"New name Zq6","unit_price":"99.00"}'), tt.row(3, 'EXIST-PUB', '{"name":"Changed draft name Zq6"}'),
  tt.row(4, 'EXIST-SUSP'), tt.row(5, 'FRESH-1'))));
select is(tt.idj('J3') ->> 'job_id' <> tt.idj('J2') ->> 'job_id', true, 'B4 the same file in another mode is a different job');
select is(tt.idj('J3') -> 'counts', '{"total":4,"valid":3,"invalid":1,"duplicate":0}'::jsonb, 'B5 create_or_update accepts existing SKUs but not suspended products');
select is((select x -> 'errors' from jsonb_array_elements(tt.idj('J3') -> 'rows') x where (x ->> 'row_no') = '4'), '["product_suspended"]'::jsonb, 'B6 a suspended product cannot be updated');
select throws_ok($$ select public.commit_import((tt.idj('J3') ->> 'job_id')::uuid, false) $$, 'PT422', 'overwrite_confirmation_required', 'B7 create_or_update needs the explicit overwrite confirmation');
select throws_ok($$ select public.commit_import((tt.idj('J3') ->> 'job_id')::uuid, null) $$, 'PT422', 'overwrite_confirmation_required', 'B8 a null confirmation is not a confirmation');
select tt.pg();
select is((select draft ->> 'name' from public.products where sku = 'EXIST-1' and supplier_id = tt.id('SA')), 'Old name Zq6', 'B9 nothing changed without the confirmation');
select tt.act('tt_p1_staff');
select tt.ids_set('C3', public.commit_import((tt.idj('J3') ->> 'job_id')::uuid, true));
select is(tt.idj('C3') -> 'created', '1'::jsonb, 'B10 one product created');
select is(tt.idj('C3') -> 'updated', '2'::jsonb, 'B11 two products updated');
select tt.pg();
select is((select draft ->> 'name' || '/' || (draft ->> 'unit_price') || '/' || (draft ->> 'description') || '/' || (draft ? 'tiers')::text from public.products where sku = 'EXIST-1' and supplier_id = tt.id('SA')),
  'New name Zq6/99.00/Original description kept by the merge./false', 'B12 an update merges (new values win, other fields kept) and a price-mode switch drops the old tiers');
select is((select draft_version from public.products where sku = 'EXIST-1' and supplier_id = tt.id('SA')), 2, 'B13 the draft version increased');
select is((select name from public.catalogue_items where product_id = tt.id('EP')), 'Live name Zq6', 'B14 updating a published product changes only its draft, never the live copy');
select is((select status::text from public.products where sku = 'EXIST-PUB' and supplier_id = tt.id('SA')), 'published', 'B15 and does not unpublish it');
select is((select details -> 'skus_updated' @> '["EXIST-1","EXIST-PUB"]'::jsonb and (details ->> 'overwrite_confirmed')::boolean
  from public.audit_log where action = 'catalogue.import_committed' and entity_id = (tt.idj('J3') ->> 'job_id')), true, 'B16 the audit entry lists the SKUs changed and the confirmation');
select is((select draft ->> 'name' from public.products where sku = 'EXIST-1' and partner_org_id = tt.oid('P2')), 'Other partner same SKU', 'B17 another partner product with the same SKU is untouched');

-- a submitted product cannot be overwritten
select tt.act('tt_p1_staff');
select tt.ids_set('E2', public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('UNDER-REVIEW', 'Under review Zq6'), 0));
select public.submit_product(tt.oid('P1'), tt.jid('E2'), 1);
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_or_update', '3', jsonb_build_array(tt.row(2, 'UNDER-REVIEW')))) -> 'rows') x), '["product_under_review"]'::jsonb, 'B18 a product under review is protected from overwrite');

-- ===================== C: injection and isolation =====================
select tt.act('tt_p1_staff');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', '4', jsonb_build_array(
  tt.row(2, 'INJ-1', jsonb_build_object('supplier_id', tt.id('SB')))))) -> 'rows') x), '["unknown_field:supplier_id"]'::jsonb, 'C1 a supplier id inside a row is refused');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', '5', jsonb_build_array(
  tt.row(2, 'INJ-2', jsonb_build_object('partner_org_id', tt.oid('P2')))))) -> 'rows') x), '["unknown_field:partner_org_id"]'::jsonb, 'C2 a partner org id inside a row is refused');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', '6', jsonb_build_array(
  tt.row(2, 'INJ-3', '{"supplier":"Other"}')))) -> 'rows') x), '["unknown_field:supplier"]'::jsonb, 'C3 a supplier name inside a row is refused');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', '7', jsonb_build_array(
  tt.row(2, 'INJ-4', '{"name":"=cmd|calc!A1"}')))) -> 'rows') x), '["formula_text:name"]'::jsonb, 'C4 a formula in the name is refused');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', '8', jsonb_build_array(
  tt.row(2, '-1+1')))) -> 'rows') x), '["invalid_sku"]'::jsonb, 'C5 a SKU that looks like a formula is refused');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', 'a', jsonb_build_array(
  tt.row(2, 'INJ-6', '{"description":"@SUM(1,2)"}')))) -> 'rows') x), '["formula_text:description"]'::jsonb, 'C6 a formula in the description is refused');
select is(tt.stage('P1', 'SA', 'create_only', 'b', jsonb_build_array('just a string', tt.row(3, 'INJ-7'))) -> 'counts', '{"total":2,"valid":1,"invalid":1,"duplicate":0}'::jsonb, 'C7 a row that is not an object is invalid, the rest continues');
select is((select x -> 'errors' from jsonb_array_elements((tt.stage('P1', 'SA', 'create_only', 'b1', jsonb_build_array(
  tt.row(2, 'CLI-1', '{"_client_invalid":["moq:invalid_moq"]}')))) -> 'rows') x), '["client_validation_failed"]'::jsonb, 'C7b a row the client rejected is invalid in the database too (client_validation_failed, not unknown_field)');
select is((tt.stage('P1', 'SA', 'create_only', 'b2', jsonb_build_array(tt.row(2, 'CLI-2', '{"_client_invalid":[]}')))) -> 'counts' ->> 'valid', '1', 'C7c an empty _client_invalid list does not invalidate a row');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select tt.stage('P2', 'SA', 'create_only', 'c', jsonb_build_array(tt.row(2, 'STEAL-1'))) $$, 'PT404', 'not_found', 'C8 partner B cannot stage into partner A supplier (own org)');
select throws_ok($$ select tt.stage('P1', 'SA', 'create_only', 'c', jsonb_build_array(tt.row(2, 'STEAL-1'))) $$, 'PT403', 'forbidden', 'C9 nor naming partner A');
select throws_ok($$ select public.commit_import((tt.idj('J1') ->> 'job_id')::uuid, false) $$, 'PT404', 'not_found', 'C10 partner B cannot commit partner A job');
select throws_ok($$ select public.cancel_import((tt.idj('J3') ->> 'job_id')::uuid) $$, 'PT404', 'not_found', 'C11 nor cancel it');
select throws_ok($$ select public.get_import(tt.oid('P1'), (tt.idj('J1') ->> 'job_id')::uuid) $$, 'PT403', 'forbidden', 'C12 nor read it naming partner A');
select throws_ok($$ select public.get_import(tt.oid('P2'), (tt.idj('J1') ->> 'job_id')::uuid) $$, 'PT404', 'not_found', 'C13 nor through its own org');
select is((select count(*)::int from public.import_jobs where partner_org_id = tt.oid('P1')), 0, 'C14 partner B sees no import jobs of partner A (RLS)');
select is((select count(*)::int from public.import_rows), 0, 'C15 nor staged rows');
select is((tt.stage('P2', 'SB', 'create_only', 'd', jsonb_build_array(tt.row(2, 'EXIST-1')))) -> 'counts', '{"total":1,"valid":0,"invalid":1,"duplicate":0}'::jsonb, 'C16 partner B sees its own EXIST-1 as existing (not partner A)');
select is((tt.stage('P2', 'SB', 'create_only', 'e', jsonb_build_array(tt.row(2, 'IMP-01')))) -> 'counts' ->> 'valid', '1', 'C17 an SKU used by partner A suppliers is free for partner B');
select tt.anon();
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'x.csv', repeat('f', 64), '[]'::jsonb) $$, '42501', null, 'C18 anonymous cannot stage');
select throws_ok($$ select * from public.import_rows $$, '42501', null, 'C19 anonymous has no table access');

-- ===================== D: limits, bad input, states =====================
select tt.act('tt_p1_staff');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'x.csv', repeat('f', 64), '[]'::jsonb) $$, 'PT422', 'empty_file', 'D1 an empty file is refused');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'x.csv', repeat('f', 64), (select jsonb_agg(jsonb_build_object('sku', 'R' || g)) from generate_series(1, 2001) g)) $$, 'PT422', 'too_many_rows', 'D2 more than 2000 rows are refused');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'x.csv', 'XYZ', '[{}]'::jsonb) $$, 'PT422', 'invalid_file_hash', 'D3 the file hash must be a SHA-256 hex');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'overwrite_all', 'x.csv', repeat('f', 64), '[{}]'::jsonb) $$, 'PT422', 'invalid_mode', 'D4 only the two modes exist');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', 'x.csv', repeat('f', 64), '{"a":1}'::jsonb) $$, 'PT422', 'invalid_data', 'D5 rows must be an array');
select throws_ok($$ select public.stage_import(tt.oid('P1'), tt.id('SA'), 'create_only', E'bad\nname.csv', repeat('f', 64), '[{}]'::jsonb) $$, 'PT422', 'invalid_file_name', 'D6 control characters in the file name are refused');
select throws_ok($$ select tt.stage('P1', 'SA', 'create_only', 'f', jsonb_build_array(tt.row(1, 'ORD-1'), tt.row(1, 'ORD-2'))) $$, 'PT422', 'invalid_row_number', 'D7 duplicated explicit row numbers are refused (invalid_row_number)');
select is((tt.stage('P1', 'SA', 'create_only', '0', jsonb_build_array(tt.row(2, 'BAD-A', '{"moq":"-1"}'), tt.row(3, 'BAD-B', '{"currency":"JPY"}')))) ->> 'status', 'failed', 'D8 a file with no valid row is marked failed');
select throws_ok($$ select public.commit_import((select id from public.import_jobs where file_sha256 = repeat('0', 64)), false) $$, 'PT409', 'job_not_previewed', 'D9 a failed job cannot be committed');
select tt.ids_set('J9', tt.stage('P1', 'SA', 'create_only', 'a0', jsonb_build_array(tt.row(2, 'CAN-1'))));
select public.cancel_import((tt.idj('J9') ->> 'job_id')::uuid);
select throws_ok($$ select public.commit_import((tt.idj('J9') ->> 'job_id')::uuid, false) $$, 'PT409', 'job_not_previewed', 'D10 a cancelled job cannot be committed');
select is((tt.stage('P1', 'SA', 'create_only', 'a0', jsonb_build_array(tt.row(2, 'CAN-1')))) ->> 'status', 'previewed', 'D11 staging the same file again after a cancellation re-opens it');
select is((tt.stage('P1', 'SA2', 'create_only', 'a0', jsonb_build_array(tt.row(2, 'CAN-1')))) ->> 'created', 'true', 'D12 another supplier of the same partner is a separate job');
select throws_ok($$ select tt.stage('P1', 'SS', 'create_only', 'a1', jsonb_build_array(tt.row(2, 'SUSP-1'))) $$, 'PT409', 'supplier_suspended', 'D13 a suspended supplier cannot be imported into');
select is((select jsonb_array_length(public.list_imports(tt.oid('P1')) -> 'items') >= 5), true, 'D14 list_imports lists the partner jobs');

-- re-validation on commit: staged rows are never trusted
select tt.ids_set('J10', tt.stage('P1', 'SA', 'create_only', 'a2', jsonb_build_array(tt.row(2, 'LATE-1'), tt.row(3, 'LATE-2'), tt.row(4, 'LATE-3'))));
select public.save_product_draft(tt.oid('P1'), tt.id('SA'), null, tt.good_data('LATE-1'), 0);
select tt.pg();
update public.import_rows set data = data || '{"moq":"-9"}' where job_id = (tt.idj('J10') ->> 'job_id')::uuid and sku = 'LATE-3';
select tt.act('tt_p1_staff');
select tt.ids_set('C10', public.commit_import((tt.idj('J10') ->> 'job_id')::uuid, false));
select is(tt.idj('C10') -> 'created', '1'::jsonb, 'D15 commit re-validates: only the still-valid row is created');
select is(tt.idj('C10') -> 'skipped', '2'::jsonb, 'D16 a SKU created meanwhile and a tampered staged row are both skipped');
select is((select status || ':' || (errors ->> 0) from public.import_rows where job_id = (tt.idj('J10') ->> 'job_id')::uuid and sku = 'LATE-1'), 'invalid:sku_exists', 'D17 the skipped row records why');
select is((select status || ':' || (errors ->> 0) from public.import_rows where job_id = (tt.idj('J10') ->> 'job_id')::uuid and sku = 'LATE-3'), 'invalid:invalid_moq', 'D18 including the tampered one');

-- partner suspension makes everything inert
select tt.act('tt_adm_rev', 'aal2');
select public.suspend_partner(tt.oid('P1'), 'Partner under review for tests.');
select tt.act('tt_p1_staff');
select throws_ok($$ select tt.stage('P1', 'SA', 'create_only', 'a3', jsonb_build_array(tt.row(2, 'SUSP-P-1'))) $$, 'PT409', 'partner_not_approved', 'D19 a suspended partner cannot stage');
select tt.ids_set('J11', (select jsonb_build_object('job_id', id) from public.import_jobs where file_sha256 = repeat('a0', 32) and supplier_id = tt.id('SA') order by created_at desc, id limit 1));
select throws_ok($$ select public.commit_import((tt.idj('J11') ->> 'job_id')::uuid, false) $$, 'PT409', 'partner_not_approved', 'D20 nor commit');
select * from finish();
rollback;
