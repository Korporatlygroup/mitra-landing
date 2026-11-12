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

select plan(135);
select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array['tt_adm_super','tt_adm_rev','tt_adm_rev2','tt_adm_sup','tt_adm_ops','tt_p1_owner','tt_p1_mgr',
  'tt_p1_staff','tt_p1_view','tt_p2_owner','tt_buyer','tt_self_owner','tt_inv_user','tt_inv_other','tt_plain']) n;
select tt.reg('M', tt.mkorg('mitra', 'P5 MITRA', 'tt_adm_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_adm_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_rev2', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_adm_sup', 'admin_support');
select tt.addm(tt.oid('M'), 'tt_adm_ops', 'admin_ops');
select tt.mk_partner('P1', 'tt_p1_owner');
select tt.addm(tt.oid('P1'), 'tt_p1_mgr', 'manager');
select tt.addm(tt.oid('P1'), 'tt_p1_staff', 'staff');
select tt.addm(tt.oid('P1'), 'tt_p1_view', 'viewer');
select tt.mk_partner('P2', 'tt_p2_owner');
select tt.reg('B', tt.mkorg('buyer', 'Buyer P5', 'tt_buyer'));
-- tt_adm_rev2 was once a member of P1 (removed): permanent conflict of interest
insert into public.memberships (org_id, user_id, role, status, removed_at) values (tt.oid('P1'), tt.uid('tt_adm_rev2'), 'staff', 'removed', now());
-- SELF is a self-created partner organisation created through the real RPC
select tt.act('tt_self_owner', 'aal2');
select tt.reg('SELF', public.create_org('partner', 'Self Made Partner'));

-- ===================== T1: permission truth table (role_permissions mirrors the contract) =====================
select tt.pg();
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'owner'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:manage','sourcing:respond','supplier:manage'], 'T1.1 owner holds exactly the three partner permissions');
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'manager'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:manage','sourcing:respond','supplier:manage'], 'T1.2 manager holds exactly the three partner permissions');
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'staff'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:manage','sourcing:respond','supplier:manage'], 'T1.3 staff holds exactly the three partner permissions');
select is((select count(*)::int from public.role_permissions where role = 'viewer'), 0, 'T1.4 viewer holds no permission at all (read-only)');
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'admin_review'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:review','partner:manage','supplier:review'], 'T1.5 admin_review: supplier:review, catalogue:review, partner:manage');
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'admin_support'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:moderate'], 'T1.6 admin_support: catalogue:moderate only');
select is((select array_agg(permission order by permission) from public.role_permissions where role = 'admin_super'
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  array['catalogue:moderate','catalogue:review','partner:manage','supplier:review'], 'T1.7 admin_super holds the four admin permissions and no partner permission');
select is((select count(*)::int from public.role_permissions where role in ('admin_ops','admin_content')
           and permission in ('supplier:manage','catalogue:manage','sourcing:respond','supplier:review','catalogue:review','partner:manage','catalogue:moderate')),
  0, 'T1.8 admin_ops and admin_content hold none of the Phase 5 permissions');

-- ===================== T2: a self-created partner organisation is inert until approved =====================
select tt.act('tt_self_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('SELF'), null, '{"name":"Inert Supplier"}'::jsonb, 0) $$, 'PT409', 'partner_not_approved',
  'T2.1 a partner without a profile cannot create suppliers');
select is((public.save_partner_profile(tt.oid('SELF'), 'Self Made Partner', 'self@example.test')) ->> 'status', 'pending', 'T2.2 requesting approval creates a pending profile');
select throws_ok($$ select public.save_supplier_draft(tt.oid('SELF'), null, '{"name":"Inert Supplier"}'::jsonb, 0) $$, 'PT409', 'partner_not_approved',
  'T2.3 a pending partner is still inert');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'partner.submitted' and user_id in (tt.uid('tt_adm_rev'), tt.uid('tt_adm_super'), tt.uid('tt_adm_sup'), tt.uid('tt_adm_ops'))
  and entity_id = tt.oid('SELF')::text), 2, 'T2.4 partner:manage admins (review, super) are notified, support and ops are not');
select tt.act('tt_p1_view');
select throws_ok($$ select public.approve_partner(tt.oid('SELF'), null) $$, 'PT403', 'forbidden', 'T2.5 a partner viewer cannot approve a partner');
select tt.act('tt_buyer');
select throws_ok($$ select public.approve_partner(tt.oid('SELF'), null) $$, 'PT403', 'forbidden', 'T2.6 a buyer cannot approve a partner');
select throws_ok($$ select public.provision_partner('Nope Ltd', 'nope@example.test', null) $$, 'PT403', 'forbidden', 'T2.7 a buyer cannot provision a partner');
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.approve_partner(tt.oid('SELF'), null) $$, 'PT403', 'forbidden', 'T2.8 admin_support has no partner:manage');
select tt.act('tt_adm_rev', 'aal1');
select throws_ok($$ select public.approve_partner(tt.oid('SELF'), null) $$, 'PT403', 'forbidden', 'T2.9 an admin without MFA (aal1) is refused');
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.approve_partner(tt.oid('P1'), null) $$, 'PT403', 'conflict_of_interest', 'T2.10 a reviewer who was ever a member cannot decide on the partner');
select tt.act('tt_adm_rev', 'aal2');
select public.approve_partner(tt.oid('SELF'), 'checked the business details');
select public.approve_partner(tt.oid('SELF'), 'checked the business details');
select tt.pg();
select is((select status::text from public.partner_profiles where org_id = tt.oid('SELF')), 'approved', 'T2.11 admin_review approves the partner (second call is a harmless retry)');
select is((select count(*)::int from public.audit_log where action = 'partner.approved' and entity_id = tt.oid('SELF')::text
  and details ->> 'reason' = 'checked the business details'), 1, 'T2.12 one audit row with the reason');
select is((select count(*)::int from public.notifications where kind = 'partner.decided' and user_id = tt.uid('tt_self_owner')), 1, 'T2.13 the partner owner is notified');
select tt.act('tt_self_owner', 'aal2');
select is((public.save_supplier_draft(tt.oid('SELF'), null, '{"name":"Self Supplier","code":"SELF-1"}'::jsonb, 0)) ->> 'code', 'SELF-1', 'T2.14 after approval the partner can create suppliers');
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.suspend_partner(tt.oid('SELF'), 'x') $$, 'PT422', 'reason_required', 'T2.15 suspending needs a real reason');
select public.suspend_partner(tt.oid('SELF'), 'complaints under investigation');
select tt.act('tt_self_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('SELF'), null, '{"name":"Another"}'::jsonb, 0) $$, 'PT409', 'partner_not_approved', 'T2.16 a suspended partner is inert');
select is((select count(*)::int from public.suppliers where partner_org_id = tt.oid('SELF')), 1, 'T2.17 the partner can still read its own supplier while suspended');
select tt.act('tt_adm_rev', 'aal2');
select public.approve_partner(tt.oid('SELF'), 'reinstated after review');
select is((select status::text from public.partner_profiles where org_id = tt.oid('SELF')), 'approved', 'T2.18 approve_partner also reinstates');

-- ===================== T3: admin provisioning of a partner owner =====================
select tt.act('tt_adm_rev', 'aal2');
select tt.ids_set('PROV', public.provision_partner('Provisioned Partner Sdn Bhd', 'tt_inv_user@example.test', 'Provisioned Partner'));
select tt.pg();
select is((select pp.status::text || '/' || (pp.provisioned_by = tt.uid('tt_adm_rev'))::text from public.partner_profiles pp where pp.org_id = (tt.idj('PROV') ->> 'org_id')::uuid),
  'approved/true', 'T3.1 provisioning creates an approved partner profile recording the admin');
select is((select count(*)::int from public.memberships where org_id = (tt.idj('PROV') ->> 'org_id')::uuid), 0, 'T3.2 the admin does not become a member of the partner');
select is((select role::text || '/' || (invited_by = tt.uid('tt_adm_rev'))::text from public.invitations where id = (tt.idj('PROV') ->> 'invitation_id')::uuid), 'owner/true',
  'T3.3 an owner invitation exists, invited by the admin');
select tt.act('tt_inv_user');
select is((public.accept_invitation(tt.idj('PROV') ->> 'token')) ->> 'code', 'PT404', 'T3.4 the generic accept_invitation refuses an admin-provisioned invitation');
select tt.act('tt_inv_other');
select is((public.accept_partner_invitation(tt.idj('PROV') ->> 'token')) ->> 'code', 'PT404', 'T3.5 a different user cannot accept the invitation');
select tt.act('tt_inv_user');
select is((public.accept_partner_invitation(repeat('0', 64))) ->> 'code', 'PT404', 'T3.6 a wrong token is refused with the same generic answer');
select is((public.accept_partner_invitation(tt.idj('PROV') ->> 'token')) ->> 'role', 'owner', 'T3.7 the invited user becomes the owner');
select is((public.accept_partner_invitation(tt.idj('PROV') ->> 'token')) ->> 'code', 'PT404', 'T3.8 the token cannot be used twice');
select tt.act('tt_inv_user', 'aal1');
select throws_ok($$ select public.save_supplier_draft((tt.idj('PROV') ->> 'org_id')::uuid, null, '{"name":"Needs MFA"}'::jsonb, 0) $$, 'PT403', 'forbidden',
  'T3.9 the provisioned owner still needs MFA (aal2) like every partner owner');
select tt.act('tt_inv_user', 'aal2');
select is((public.save_supplier_draft((tt.idj('PROV') ->> 'org_id')::uuid, null, '{"name":"Provisioned Supplier"}'::jsonb, 0)) ->> 'version', '1', 'T3.10 with MFA the owner works');
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.resend_partner_invitation((tt.idj('PROV') ->> 'org_id')::uuid, 'tt_inv_user@example.test') $$, 'PT409', 'already_member',
  'T3.11 an invitation cannot be re-sent once an owner exists');
select throws_ok($$ select public.provision_partner('Bad', 'not-an-email', null) $$, 'PT422', 'invalid_email', 'T3.12 the owner e-mail is validated');
select throws_ok($$ select public.resend_partner_invitation(tt.oid('P1'), 'tt_inv_user@example.test') $$, 'PT404', 'not_found',
  'T3.13 re-send only works for provisioned partners');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.provision_partner('Bad Co', 'bad@example.test', null) $$, 'PT403', 'forbidden', 'T3.14 a partner owner cannot provision partners');

-- ===================== T4: supplier drafts and isolation =====================
select tt.act('tt_p1_owner', 'aal2');
select tt.ids_set('S1', public.save_supplier_draft(tt.oid('P1'), null, jsonb_build_object('name', 'Surat Textiles Exports', 'country', 'India',
  'state_city', 'Surat, Gujarat', 'main_category', 'textiles-apparel', 'description', 'Synthetic exporter of cotton garments for tests.',
  'capabilities', jsonb_build_array('Cotton garments', 'Private label'), 'contact_name', 'Ravi Kumar', 'contact_email', 'ravi@example.test',
  'contact_phone', '+91 98765 43210', 'registration_id', 'GST-SYN-001', 'website', 'https://supplier.example.test'), 0));
select is(tt.idj('S1') ->> 'version', '1', 'T4.1 owner creates a supplier draft');
select tt.ids_set('S2', public.save_supplier_draft(tt.oid('P1'), null, '{"name":"Half Done Supplier"}'::jsonb, 0));
select tt.act('tt_p1_mgr');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"description":"Synthetic exporter of cotton garments and towels for tests."}'::jsonb, 1)) ->> 'version', '2',
  'T4.2 a manager (no MFA needed) edits the draft');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"description":"Stale write from an old screen."}'::jsonb, 1) $$, 'PT409', 'stale_version',
  'T4.3 a stale draft version is rejected');
select tt.act('tt_p1_staff');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"Surat, Gujarat, India"}'::jsonb, 2)) ->> 'version', '3', 'T4.4 staff can edit the draft');
select tt.act('tt_p1_view');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"x"}'::jsonb, 3) $$, 'PT403', 'forbidden', 'T4.5 a viewer cannot edit');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"Hacked"}'::jsonb, 3) $$, 'PT403', 'forbidden', 'T4.6 partner B cannot write into partner A (naming A)');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P2'), tt.jid('S1'), '{"state_city":"Hacked"}'::jsonb, 3) $$, 'PT404', 'not_found', 'T4.7 partner B cannot reach A supplier through its own org (404)');
select throws_ok($$ select public.submit_supplier(tt.oid('P2'), tt.jid('S1'), 3) $$, 'PT404', 'not_found', 'T4.8 partner B cannot submit A supplier');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"colour":"red"}'::jsonb, 3) $$, 'PT422', 'unknown_field', 'T4.9 unknown fields are refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"name":"=HYPERLINK(1)"}'::jsonb, 3) $$, 'PT422', 'formula_text', 'T4.10 formula-looking text is refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"main_category":"nope"}'::jsonb, 3) $$, 'PT422', 'invalid_category', 'T4.11 unknown category refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"contact_email":"not mail"}'::jsonb, 3) $$, 'PT422', 'invalid_email', 'T4.12 bad e-mail refused');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"website":"javascript:alert(1)"}'::jsonb, 3) $$, 'PT422', 'invalid_website', 'T4.13 only http(s) websites');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"code":"OTHER"}'::jsonb, 3) $$, 'PT422', 'immutable_columns', 'T4.14 the supplier code is immutable');
select tt.anon();
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), null, '{"name":"Anon"}'::jsonb, 0) $$, '42501', null, 'T4.15 anonymous cannot call supplier RPCs');
select throws_ok($$ select * from public.suppliers $$, '42501', null, 'T4.16 anonymous has no table access');

-- ===================== T5: evidence documents (service role) and submission =====================
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S2'), 1) $$, 'PT422', 'supplier_incomplete', 'T5.1 an incomplete supplier cannot be submitted');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 3) $$, 'PT409', 'documents_not_ready', 'T5.2 at least one clean evidence document is required');
select tt.svc();
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'business_registration', 'GST', 'application/pdf', 1000::bigint,
  repeat('a', 64), 'supplier/other/path.pdf', 'pending', 'unit') $$, 'PT422', 'invalid_path', 'T5.3 the storage path must be supplier/<org>/<supplier>/<file>');
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'business_registration', 'GST', 'application/pdf', 1000::bigint,
  repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0000.pdf', 'infected', 'unit') $$, 'PT422', 'infected_not_stored', 'T5.4 infected files are never registered');
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_view'), tt.jid('S1'), 'business_registration', 'GST', 'application/pdf', 1000::bigint,
  repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'pending', 'unit') $$, 'PT403', 'forbidden', 'T5.5 a viewer cannot upload evidence');
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p2_owner'), tt.jid('S1'), 'business_registration', 'GST', 'application/pdf', 1000::bigint,
  repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'pending', 'unit') $$, 'PT403', 'forbidden', 'T5.6 a member of another partner cannot upload evidence');
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'passport', 'GST', 'application/pdf', 1000::bigint,
  repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'pending', 'unit') $$, 'PT422', 'invalid_doc_type', 'T5.7 document type is a fixed list');
select tt.ids_set('D1', jsonb_build_object('id', public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'business_registration', 'GST certificate',
  'application/pdf', 1000::bigint, repeat('a', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'pending', 'unit')));
select tt.pg();
select is((select scan_status::text from public.supplier_documents where id = tt.jid('D1')), 'pending', 'T5.8 a new document starts as pending');
select is((select count(*)::int from public.service_list_unscanned_supplier_documents(100) where id = tt.jid('D1')), 1, 'T5.9 it appears in the scan queue');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 3) $$, 'PT409', 'documents_not_ready', 'T5.10 a pending (unscanned) document does not count');
select tt.svc();
select public.service_set_supplier_document_scan(tt.jid('D1'), 'clean', 'test-engine');
select throws_ok($$ select public.service_set_supplier_document_scan(tt.jid('D1'), 'clean', 'test-engine') $$, 'PT409', 'already_scanned', 'T5.11 a final scan result cannot be rewritten');
select tt.act('tt_p1_owner', 'aal2');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 3);
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 3);
select tt.pg();
select is((select status::text || '/' || draft_submitted_version from public.suppliers where id = tt.jid('S1')), 'awaiting_review/3', 'T5.12 submission moves it to awaiting_review (retry safe)');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1') and kind = 'submitted'), 1, 'T5.13 exactly one submitted event');
select is((select locked from public.supplier_documents where id = tt.jid('D1')), true, 'T5.14 evidence attached to a submission is locked');
select is((select count(*)::int from public.notifications where kind = 'supplier.submitted' and entity_id = tt.jid('S1')::text
  and user_id in (tt.uid('tt_adm_rev'), tt.uid('tt_adm_rev2'), tt.uid('tt_adm_super'), tt.uid('tt_adm_sup'), tt.uid('tt_adm_ops'))), 3, 'T5.15 supplier:review admins are notified');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"Surat"}'::jsonb, 3) $$, 'PT409', 'supplier_under_review', 'T5.16 no edits while under review');
select public.withdraw_supplier_submission(tt.oid('P1'), tt.jid('S1'));
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'draft', 'T5.17 withdrawing returns the supplier to draft');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 3);

-- ===================== T6: review (approve / reject / request info), conflict of interest =====================
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 3) $$, 'PT403', 'conflict_of_interest', 'T6.1 a reviewer with history in the partner cannot decide');
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 3) $$, 'PT403', 'forbidden', 'T6.2 admin_support cannot review suppliers');
select tt.act('tt_adm_ops', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 3) $$, 'PT403', 'forbidden', 'T6.3 admin_ops cannot review suppliers');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 3) $$, 'PT403', 'forbidden', 'T6.4 the partner cannot approve itself');
select tt.act('tt_adm_rev', 'aal2');
select is((public.list_supplier_reviews('pending', 0) -> 'items') @> jsonb_build_array(jsonb_build_object('id', tt.jid('S1'))), true, 'T6.5 the supplier is in the pending review queue');
select is(public.get_supplier(tt.jid('S1')) -> 'private' ->> 'contact_name', 'Ravi Kumar', 'T6.6 the reviewer sees contact details of a submitted supplier');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'request_info', 'no', null, 3) $$, 'PT422', 'reason_required', 'T6.7 a reason is required to ask for more information');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'reject', null, null, 3) $$, 'PT422', 'reason_required', 'T6.8 a reason is required to reject');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, null, 3) $$, 'PT422', 'invalid_checks', 'T6.9 approval needs at least one recorded check');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['trusted_forever'], 3) $$, 'PT422', 'invalid_checks', 'T6.10 checks come from a fixed list');
select throws_ok($$ select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable'], 2) $$, 'PT409', 'stale_version', 'T6.11 a stale reviewed version is refused');
select public.review_supplier(tt.jid('S1'), 'request_info', 'Please add a trade reference document.', null, 3);
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'more_info_needed', 'T6.12 request_info moves it to more_info_needed');
select is((select count(*)::int from public.notifications where kind = 'supplier.decided' and entity_id = tt.jid('S1')::text
  and user_id in (tt.uid('tt_p1_owner'), tt.uid('tt_p1_mgr'), tt.uid('tt_p1_staff'), tt.uid('tt_p1_view'))), 3, 'T6.13 owner, manager, staff are notified (viewer is not)');
select is((select reason from public.supplier_events where supplier_id = tt.jid('S1') and kind = 'more_info_requested'), 'Please add a trade reference document.', 'T6.14 the event keeps the reason');
select is((select count(*)::int from public.audit_log where action = 'supplier.more_info_requested' and entity_id = tt.jid('S1')::text
  and details ->> 'reason' = 'Please add a trade reference document.'), 1, 'T6.15 the audit row keeps the reason');
select tt.act('tt_p1_owner', 'aal2');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"capabilities":["Cotton garments","Private label","Export packing"]}'::jsonb, 3)) ->> 'status', 'draft', 'T6.16 editing reopens the draft');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 4);
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S1'), 'approve', null, array['contact_reachable', 'registration_document_seen'], 4);
select tt.pg();
select is((select status::text || '/' || live_name || '/' || cardinality(review_checks) || '/' || (reviewed_at is not null)::text from public.suppliers where id = tt.jid('S1')),
  'approved/Surat Textiles Exports/2/true', 'T6.17 approval publishes the live snapshot with the checks and review date');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1') and kind in ('submitted','more_info_requested','approved','withdrawn')), 6,
  'T6.18 history: 3 submissions, 1 withdrawal, 1 more-info request and 1 approval are all recorded');
select throws_ok($$ update public.supplier_events set reason = 'x' $$, '42501', null, 'T6.19 supplier_events is append-only (update)');
select throws_ok($$ delete from public.supplier_events $$, '42501', null, 'T6.20 supplier_events is append-only (delete)');

-- approved supplier: a revision keeps the live snapshot until a reviewer accepts it
select tt.act('tt_p1_owner', 'aal2');
select is((public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"name":"Surat Textiles Exports Pvt Ltd"}'::jsonb, 4)) ->> 'status', 'approved', 'T6.21 editing an approved supplier keeps it approved');
select is((select live_name from public.suppliers where id = tt.jid('S1')), 'Surat Textiles Exports', 'T6.22 the live name is unchanged by a draft edit');
select is((public.get_supplier(tt.jid('S1')) ->> 'has_unsubmitted_changes')::boolean, true, 'T6.23 the supplier reports unsubmitted changes');
select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 5);
select tt.act('tt_adm_rev', 'aal2');
select public.review_supplier(tt.jid('S1'), 'reject', 'The new legal name does not match the registration document.', null, 5);
select tt.pg();
select is((select status::text || '/' || live_name || '/' || (draft_submitted_version is null)::text from public.suppliers where id = tt.jid('S1')), 'approved/Surat Textiles Exports/true',
  'T6.24 rejecting a revision leaves the approved supplier live and unchanged');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.submit_supplier(tt.oid('P1'), tt.jid('S1'), 99) $$, 'PT409', 'stale_version', 'T6.25 submit checks the draft version');

-- ===================== T7: reads, isolation, RLS =====================
select tt.act('tt_p1_view');
select is((select count(*)::int from public.supplier_private where supplier_id = tt.jid('S1')), 0, 'T7.1 a partner viewer (no supplier:manage) cannot read the private contact row (000115, M4)');
select is(jsonb_array_length(public.list_my_suppliers(tt.oid('P1')) -> 'items'), 2, 'T7.2 list_my_suppliers returns both suppliers to a partner member');
select tt.act('tt_p2_owner', 'aal2');
select is((select count(*)::int from public.supplier_private where supplier_id = tt.jid('S1')), 0, 'T7.3 partner B sees no contact details of partner A');
select is((select count(*)::int from public.suppliers where id = tt.jid('S1')), 0, 'T7.4 partner B sees no supplier rows of partner A');
select is((select count(*)::int from public.supplier_documents where supplier_id = tt.jid('S1')), 0, 'T7.5 partner B sees no documents of partner A');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1')), 0, 'T7.6 partner B sees no events of partner A');
select throws_ok($$ select public.get_supplier(tt.jid('S1')) $$, 'PT404', 'not_found', 'T7.7 get_supplier on another partner supplier is 404');
select throws_ok($$ select public.list_my_suppliers(tt.oid('P1')) $$, 'PT403', 'forbidden', 'T7.8 listing another partner suppliers is 403');
select tt.act('tt_buyer');
select throws_ok($$ select public.get_supplier(tt.jid('S1')) $$, 'PT404', 'not_found', 'T7.9 a buyer cannot read a supplier record');
select is((select count(*)::int from public.supplier_private), 0, 'T7.10 a buyer sees no private supplier rows at all');
select is((select count(*)::int from public.suppliers), 0, 'T7.11 a buyer sees no supplier rows at all');
select tt.act('tt_plain');
select throws_ok($$ select public.get_supplier(tt.jid('S1')) $$, 'PT404', 'not_found', 'T7.12 an unrelated user gets 404');
select tt.act('tt_adm_rev', 'aal2');
select is((select count(*)::int from public.suppliers where id = tt.jid('S2')), 0, 'T7.13 a reviewer does not see a never-submitted draft supplier');
select throws_ok($$ select public.get_supplier(tt.jid('S2')) $$, 'PT404', 'not_found', 'T7.14 get_supplier hides never-submitted drafts from reviewers');
select is((select count(*)::int from public.suppliers where id = tt.jid('S1')), 1, 'T7.15 a reviewer sees the submitted supplier');
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.get_supplier(tt.jid('S1')) $$, 'PT404', 'not_found', 'T7.16 a conflicted reviewer cannot open the supplier through the RPC');

-- ===================== T8: document access =====================
select tt.svc();
select tt.ids_set('D2', jsonb_build_object('id', public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'trade_reference', 'Reference letter',
  'application/pdf', 1000::bigint, repeat('b', 64), 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0002.pdf', 'pending', 'unit')));
select tt.act('tt_p1_owner', 'aal2');
select is((public.get_supplier_document_access(tt.jid('D1'))) ->> 'storage_path', 'supplier/' || tt.oid('P1') || '/' || tt.jid('S1') || '/abcdefgh0001.pdf', 'T8.1 the partner opens a clean document');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D2')) $$, 'PT403', 'document_not_available', 'T8.2 an unscanned document is never served');
select tt.act('tt_p2_owner', 'aal2');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D1')) $$, 'PT404', 'not_found', 'T8.3 another partner cannot open it');
select tt.act('tt_buyer');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D1')) $$, 'PT404', 'not_found', 'T8.4 a buyer cannot open it');
select tt.act('tt_adm_rev', 'aal2');
select is((public.get_supplier_document_access(tt.jid('D1'))) ->> 'mime_type', 'application/pdf', 'T8.5 a reviewer opens evidence that was submitted');
select tt.act('tt_adm_rev2', 'aal2');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D1')) $$, 'PT404', 'not_found', 'T8.6 a conflicted reviewer cannot');
select tt.pg();
select is((select count(*)::int from public.audit_log where action = 'supplier.document_viewed' and entity_id = tt.jid('D1')::text), 2, 'T8.7 every successful access is audited (partner and reviewer)');
select tt.svc();
select public.service_set_supplier_document_scan(tt.jid('D2'), 'clean', 'test-engine');
select tt.act('tt_adm_rev', 'aal2');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D2')) $$, 'PT404', 'not_found', 'T8.8 a reviewer cannot open a document that was not part of a submission');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.remove_supplier_document(tt.jid('D1')) $$, 'PT409', 'document_in_use', 'T8.9 submitted evidence cannot be removed');
select is((select public.remove_supplier_document(tt.jid('D2'))) like 'supplier/%', true, 'T8.10 unlocked evidence can be removed');
select throws_ok($$ select public.get_supplier_document_access(tt.jid('D2')) $$, 'PT403', 'document_not_available', 'T8.11 a removed document is not served');
select tt.act('tt_p1_view');
select throws_ok($$ select public.remove_supplier_document(tt.jid('D2')) $$, 'PT404', 'not_found', 'T8.12 a viewer cannot remove documents');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.service_register_supplier_document(tt.oid('P1'), tt.uid('tt_p1_owner'), tt.jid('S1'), 'other', 'x', 'application/pdf', 1::bigint, repeat('c', 64), 'x', 'pending', 'u') $$,
  '42501', null, 'T8.13 a partner session cannot call the service_* functions');

-- ===================== T9: suspension and reinstatement =====================
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.suspend_supplier(tt.jid('S1'), 'x') $$, 'PT422', 'reason_required', 'T9.1 a reason is required to suspend');
select throws_ok($$ select public.suspend_supplier(tt.jid('S2'), 'draft one cannot be suspended') $$, 'PT409', 'supplier_not_approved', 'T9.2 only approved suppliers can be suspended');
select public.suspend_supplier(tt.jid('S1'), 'Customer complaints are being investigated.');
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'suspended', 'T9.3 admin_support (catalogue:moderate) suspends the supplier');
select is((select count(*)::int from public.notifications where kind = 'supplier.suspended' and entity_id = tt.jid('S1')::text), 3, 'T9.4 the partner is notified');
select tt.act('tt_p1_owner', 'aal2');
select throws_ok($$ select public.save_supplier_draft(tt.oid('P1'), tt.jid('S1'), '{"state_city":"x"}'::jsonb, 6) $$, 'PT409', 'supplier_suspended', 'T9.5 a suspended supplier cannot be edited');
select tt.act('tt_adm_sup', 'aal2');
select throws_ok($$ select public.reinstate_supplier(tt.jid('S1'), 'Investigation closed.') $$, 'PT403', 'forbidden', 'T9.6 admin_support cannot reinstate');
select tt.act('tt_adm_rev', 'aal2');
select public.reinstate_supplier(tt.jid('S1'), 'Investigation closed.');
select tt.pg();
select is((select status::text from public.suppliers where id = tt.jid('S1')), 'approved', 'T9.7 admin_review reinstates');
select is((select count(*)::int from public.supplier_events where supplier_id = tt.jid('S1') and kind in ('suspended', 'reinstated') and reason is not null), 2, 'T9.8 suspension and reinstatement keep their reasons');
select * from finish();
rollback;
