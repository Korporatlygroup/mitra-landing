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
grant select on tt.o to public;
create function tt.oid(p_label text) returns uuid language sql stable as $$ select id from tt.o where label = p_label $$;
create function tt.reg(p_label text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.o (label, id) values (p_label, p_id);
  return p_id;
end $$;

-- ---------- Phase 2 helpers (setup runs as postgres; assertions run as the acting role) ----------
create table tt.ids (label text primary key, id uuid);
grant select, insert, update on tt.ids to public;
create function tt.id(p_label text) returns uuid language sql stable as $$ select id from tt.ids where label = p_label $$;

create function tt.mkdoc(p_label text, p_org uuid, p_user text, p_claim public.claim_type, p_doc public.doc_type,
                         p_status public.scan_status default 'clean') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tt.pg();
  v := public.service_register_document(p_org, tt.uid(p_user), p_claim, p_doc, 'file-' || p_label || '.pdf', 'application/pdf', 1234,
         encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 'tt/' || gen_random_uuid()::text, p_status, 'tt-engine');
  insert into tt.ids (label, id) values (p_label, v);
  return v;
end $$;

create function tt.setst(p_claim uuid, p_status public.claim_status, p_version integer default null) returns void language plpgsql as $$
begin
  perform tt.pg();
  update public.verification_claims set status = p_status, version = coalesce(p_version, version) where id = p_claim;
end $$;

create function tt.std(p_name text, p_ssm text) returns jsonb language sql immutable as $$
  select jsonb_build_object('business_name', p_name, 'category_slug', 'food-beverage', 'registration_status', 'registered',
    'ssm_number', p_ssm, 'business_type', 'sole_proprietorship', 'state', 'Selangor', 'district', 'Petaling',
    'address_line', '1 Jalan Satu', 'postcode', '47500', 'contact_phone', '+60 3 1234 5678',
    'contact_email', 'biz@example.test', 'description', 'Synthetic business')
$$;

create function tt.prof(p_org uuid, p_user text, p_data jsonb) returns void language plpgsql as $$
begin
  perform tt.act(p_user);
  perform public.save_business_profile(p_org, p_data);
  perform tt.pg();
end $$;

create function tt.rep(p_org uuid, p_user text) returns void language plpgsql as $$
begin
  perform tt.act(p_user);
  perform public.save_representative(p_org, 'Rep Person', 'owner', 'rep@example.test', '0123456789');
  perform tt.pg();
end $$;


-- ---------- Phase 3 helpers ----------
create function tt.std2(p_name text, p_ssm text, p_cat text, p_state text) returns jsonb language sql immutable as $$
  select tt.std(p_name, p_ssm) || jsonb_build_object('category_slug', p_cat, 'state', p_state)
$$;
create function tt.svc(p_cat text, p_name text, p_areas text[], p_nat boolean default false, p_minqty text default null,
  p_unit text default null, p_lead text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('name', p_name, 'category_slug', p_cat, 'nationwide', p_nat, 'areas', to_jsonb(p_areas),
    'min_order_qty', p_minqty, 'min_order_unit', p_unit, 'lead_time_days', p_lead)
$$;
create function tt.ddata(p_head text, p_services jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('headline', p_head, 'description', 'We make quality products for local customers across Malaysia.',
    'services', p_services, 'portfolio', '[{"title":"Wedding order","description":"200 pieces"}]'::jsonb,
    'show_phone', true, 'public_phone', '+60 3 9999 0000')
$$;
-- save the draft at its current version, then submit (as the given owner)
create function tt.draft_and_submit(p_org uuid, p_user text, p_data jsonb) returns void language plpgsql as $$
declare v int;
begin
  perform tt.pg();
  select coalesce((select draft_version from public.business_listings where org_id = p_org), 0) into v;
  perform tt.act(p_user);
  perform public.save_listing_draft(p_org, p_data, v);
  perform public.submit_listing(p_org, v + 1);
  perform tt.pg();
end $$;
create function tt.approve(p_org uuid, p_rev text) returns void language plpgsql as $$
declare v int;
begin
  perform tt.pg();
  select draft_version into v from public.business_listings where org_id = p_org;
  perform tt.act(p_rev, 'aal2');
  perform public.review_listing(p_org, 'approve', null, v);
  perform tt.pg();
end $$;
create function tt.mkreq(p_label text, p_org uuid, p_user text, p_key text, p_title text, p_cat text, p_state text,
  p_qty text, p_unit text, p_share boolean default false, p_needed text default null) returns jsonb language plpgsql as $$
declare d jsonb; r jsonb;
begin
  perform tt.act(p_user);
  d := public.save_request_draft(p_org, null, p_key, jsonb_build_object('title', p_title, 'category_slug', p_cat,
    'description', 'We need this made and delivered, please reply with what you can do.', 'target_state', p_state,
    'quantity', p_qty, 'unit', p_unit, 'needed_by', p_needed, 'share_contact', p_share,
    'contact_phone', '+60 12 345 6789', 'contact_email', 'buyer@example.test'), 0);
  r := public.submit_request((d ->> 'id')::uuid, (d ->> 'version')::int);
  perform tt.pg();
  insert into tt.ids (label, id) values (p_label, (d ->> 'id')::uuid);
  return r;
end $$;
create function tt.cands(p_req uuid) returns text language sql stable as $$
  select coalesce(string_agg(seller_org_id::text, ',' order by seller_org_id), '') from public.request_seller_matches
  where request_id = p_req and status = 'candidate' and seller_org_id in (tt.oid('A'), tt.oid('B'), tt.oid('C'))
$$;

select plan(228);

select tt.fresh_mitra();
select tt.mkuser(n) from unnest(array[
  'tt_a_owner','tt_a_staff','tt_a_viewer','tt_b_owner','tt_c_owner','tt_q_owner','tt_q_viewer','tt_r_owner','tt_x_user',
  'tt_rev','tt_rev_conf','tt_sup','tt_super','tt_ops','tt_d_owner']) n;
select tt.reg('D', tt.mkorg('business', 'Delta Draft Qx3', 'tt_d_owner'));
select tt.reg('A', tt.mkorg('business', 'Alpha Uniforms', 'tt_a_owner'));
select tt.addm(tt.oid('A'), 'tt_a_staff', 'staff');
select tt.addm(tt.oid('A'), 'tt_a_viewer', 'viewer');
select tt.addm(tt.oid('A'), 'tt_rev_conf', 'viewer');
select tt.reg('B', tt.mkorg('business', 'Bravo Tailors', 'tt_b_owner'));
select tt.reg('C', tt.mkorg('business', 'Charlie Catering', 'tt_c_owner'));
select tt.reg('Q', tt.mkorg('buyer', 'Quick Buyer', 'tt_q_owner'));
select tt.addm(tt.oid('Q'), 'tt_q_viewer', 'viewer');
select tt.reg('R', tt.mkorg('buyer', 'Rapid Buyer', 'tt_r_owner'));
select tt.reg('M', tt.mkorg('mitra', 'P3 MITRA', 'tt_super', 'admin_super'));
select tt.addm(tt.oid('M'), 'tt_rev', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_rev_conf', 'admin_review');
select tt.addm(tt.oid('M'), 'tt_sup', 'admin_support');
select tt.addm(tt.oid('M'), 'tt_ops', 'admin_ops');

select tt.prof(tt.oid('A'), 'tt_a_owner', tt.std2('Alpha Uniforms Qx3', '111111111111', 'tailoring-apparel', 'Selangor'));
select tt.prof(tt.oid('B'), 'tt_b_owner', tt.std2('Bravo Tailors Qx3', '222222222222', 'tailoring-apparel', 'Pulau Pinang'));
select tt.prof(tt.oid('C'), 'tt_c_owner', tt.std2('Charlie Catering Qx3', '333333333333', 'food-beverage', 'Selangor'));

-- ============================ LISTINGS: draft, submit, review ============================
select tt.act('tt_a_owner');
select is((public.save_listing_draft(tt.oid('A'), tt.ddata('Custom uniforms for restaurants and shops',
  jsonb_build_array(tt.svc('tailoring-apparel', 'Custom uniforms', array['Selangor','W.P. Kuala Lumpur'], false, '50', 'pcs', '14'))), 0)) ->> 'version',
  '1', 'L1 owner saves a listing draft (version 1)');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"headline":"Another headline here"}'::jsonb, 0) $$, 'PT409', 'stale_version',
  'L2 a stale draft version is rejected');
select tt.act('tt_a_viewer');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"headline":"Viewer headline here"}'::jsonb, 1) $$, 'PT403', 'forbidden',
  'L3 a viewer cannot edit the listing');
select tt.act('tt_a_staff');
select is((public.save_listing_draft(tt.oid('A'), '{"headline":"Custom uniforms for restaurants and shops"}'::jsonb, 1)) ->> 'version', '2',
  'L4a staff (business:edit) can edit the draft');
select throws_ok($$ select public.submit_listing(tt.oid('A'), 2) $$, 'PT403', 'forbidden', 'L4b staff cannot submit for review (needs listing:publish)');
select tt.act('tt_a_owner');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"services":[{"name":"X service","category_slug":"tailoring-apparel","nationwide":false,"areas":[]}]}'::jsonb, 2) $$,
  'PT422', 'service_area_required', 'L5 a service with no area and not nationwide is rejected');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"bogus":1}'::jsonb, 2) $$, 'PT422', 'invalid_data', 'L6 unknown draft keys are rejected');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"public_phone":"abc"}'::jsonb, 2) $$, 'PT422', 'invalid_phone', 'L7 an invalid public phone is rejected');

select tt.pg();
select tt.act('tt_a_owner');
select lives_ok($$ select public.submit_listing(tt.oid('A'), 2) $$, 'L8 owner submits the listing for review');
select lives_ok($$ select public.submit_listing(tt.oid('A'), 2) $$, 'L9 submitting again is a harmless retry');
select throws_ok($$ select public.save_listing_draft(tt.oid('A'), '{"headline":"Edit while pending"}'::jsonb, 2) $$, 'PT409', 'listing_under_review',
  'L10 the draft cannot be edited while under review');
select tt.anon();
select is((public.search_listings('Qx3', null, null))->>'total', '0', 'L11 nothing is public before approval');
select throws_ok($$ select count(*) from public.business_listings $$, '42501', null, 'L12 anon has no direct table access');
select tt.act('tt_a_owner');
select throws_ok($$ select public.review_listing(tt.oid('A'), 'approve', null, 2) $$, 'PT403', 'forbidden', 'L13 the owner cannot approve their own listing');
select tt.act('tt_sup', 'aal2');
select throws_ok($$ select public.review_listing(tt.oid('A'), 'approve', null, 2) $$, 'PT403', 'forbidden', 'L14 admin_support lacks listing:review');
select tt.act('tt_rev_conf', 'aal2');
select throws_ok($$ select public.review_listing(tt.oid('A'), 'approve', null, 2) $$, 'PT403', 'conflict_of_interest',
  'L15 a reviewer who is a member of the organisation cannot decide on it');
select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.review_listing(tt.oid('A'), 'approve', null, 1) $$, 'PT409', 'stale_version', 'L16 review of an old draft version is rejected');
select throws_ok($$ select public.review_listing(tt.oid('A'), 'reject', 'no', 2) $$, 'PT422', 'reason_required', 'L17 a rejection needs a reason');
select lives_ok($$ select public.review_listing(tt.oid('A'), 'request_changes', 'Please add your opening hours.', 2) $$, 'L18 reviewer requests changes with a reason');
select tt.act('tt_a_owner');
select is((select review_status::text from public.business_listings where org_id = tt.oid('A')), 'changes_requested', 'L19 the owner sees changes_requested');
select is((select review_reason from public.business_listings where org_id = tt.oid('A')), 'Please add your opening hours.', 'L20 and the reviewer''s reason');
select tt.anon();
select is((public.search_listings('Qx3', null, null))->>'total', '0', 'L21 a listing with changes requested is still not public');

select tt.draft_and_submit(tt.oid('A'), 'tt_a_owner', '{"headline":"Custom uniforms for restaurants and shops (updated)"}'::jsonb);
select tt.approve(tt.oid('A'), 'tt_rev');
select tt.draft_and_submit(tt.oid('B'), 'tt_b_owner', tt.ddata('Tailoring in Penang for events',
  jsonb_build_array(tt.svc('tailoring-apparel', 'Event tailoring', array['Pulau Pinang']))));
select tt.approve(tt.oid('B'), 'tt_rev');
select tt.draft_and_submit(tt.oid('C'), 'tt_c_owner', tt.ddata('Catering for any size of event',
  jsonb_build_array(tt.svc('food-beverage', 'Event catering', array[]::text[], true))));
select tt.approve(tt.oid('C'), 'tt_rev');

-- ============================ PUBLIC READ ============================
select tt.anon();
select is((public.search_listings('Qx3', null, null))->>'total', '3', 'P1 anon sees exactly the three approved listings');
select is((public.search_listings('Qx3 nothing', null, null))->>'total', '0', 'P2 a keyword that matches nothing returns no rows');
select is((public.search_listings('%', null, null))->>'total', '0', 'P3 LIKE wildcards in the query are escaped (a bare % matches nothing)');
select is((public.search_listings('Qx3', 'food-beverage', null))->>'total', '1', 'P4 category filter');
select is((public.search_listings('Qx3', null, 'Pulau Pinang'))->>'total', '2', 'P5 location filter finds businesses that serve the state (Bravo, and nationwide Charlie)');
select is((public.search_listings('Qx3', null, null, 2, 0))->'items'->0->>'slug' is not null and jsonb_array_length((public.search_listings('Qx3', null, null, 2, 0))->'items') = 2, true, 'P6 pagination limits items');
select throws_ok($$ select public.search_listings(null, 'Bad Cat!', null) $$, 'PT422', 'invalid_category', 'P7 malformed category filter is rejected');
select is((select public.get_listing((public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug')) ->> 'name', 'Alpha Uniforms Qx3', 'P8 get_listing returns the approved profile');
select ok(
  (select public.get_listing((public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug'))::text !~ '(1 Jalan Satu|47500|111111111111|biz@example.test|ssm|postcode|address)',
  'P9 the public profile contains no street address, postcode, SSM number or private contact');
select is((select public.get_listing((public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug')) ->> 'phone', '+60 3 9999 0000',
  'P10 the phone the owner chose to publish is shown');
select is((select public.get_listing((public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug')) -> 'reviewed', '[]'::jsonb,
  'P11 with no approved verification claim, no "reviewed by MITRA" statement is made');
select throws_ok($$ select public.get_listing('no-such-business-xx') $$, 'PT404', 'not_found', 'P12 an unknown slug is 404');

-- profile edits do not leak into the public listing
select tt.act('tt_a_owner');
select lives_ok($$ select public.save_business_profile(tt.oid('A'), '{"business_name":"Renamed Without Review"}'::jsonb) $$, 'P13a owner renames the profile');
select tt.anon();
select is((public.search_listings('Alpha Uniforms Qx3', null, null))->>'total', '1', 'P13 the public listing keeps the approved name');
select tt.act('tt_a_owner');
select is((public.save_listing_draft(tt.oid('A'), '{"headline":"A brand new headline, not reviewed yet"}'::jsonb, 3)) ->> 'version', '4', 'P14a owner edits the draft after publication');
select tt.anon();
select is((select public.get_listing((public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug')) ->> 'headline', 'Custom uniforms for restaurants and shops (updated)',
  'P14 unapproved draft edits are not public');

-- RLS on the listing tables
select tt.act('tt_b_owner');
select is((select count(*)::int from public.business_listings where org_id = tt.oid('A')), 0, 'R1 another business cannot read this listing row (draft)');
select tt.act('tt_x_user');
select is((select count(*)::int from public.business_listings), 0, 'R2 an unrelated user sees no listing rows');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_listings where org_id in (tt.oid('A'), tt.oid('B'), tt.oid('C'))), 3, 'R3 a listing reviewer can read listings');
select tt.act('tt_ops', 'aal2');
select is((select count(*)::int from public.business_listings where org_id in (tt.oid('A'), tt.oid('B'), tt.oid('C'))), 0, 'R4 admin_ops (no listing:review) cannot');
select tt.act('tt_a_owner');
select throws_ok($$ update public.business_listings set slug = 'hijack-slug' where org_id = tt.oid('A') $$, '42501', null, 'R5 no direct writes to listings');
select throws_ok($$ update public.listing_events set event = 'approved' $$, '42501', null, 'R6 listing_events cannot be updated by users');
select tt.pg();
select throws_ok($$ update public.listing_events set event = 'approved' $$, '42501', null, 'R7 listing_events is append-only even for the owner role');
select is((select count(*)::int from public.listing_events where org_id = tt.oid('A')), 4, 'R8 moderation history is preserved (submitted, changes_requested, submitted, approved)');

-- suspend / reinstate / unpublish / republish
select tt.act('tt_a_owner');
select throws_ok($$ select public.suspend_listing(tt.oid('A'), 'I am suspending myself') $$, 'PT403', 'forbidden', 'S1 an owner cannot suspend via the reviewer function');
select tt.act('tt_rev_conf', 'aal2');
select throws_ok($$ select public.suspend_listing(tt.oid('A'), 'Misleading claims about size') $$, 'PT403', 'conflict_of_interest', 'S2 conflicted reviewer cannot suspend');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.suspend_listing(tt.oid('A'), 'Misleading claims about size') $$, 'S3 a reviewer suspends a misleading listing');
select tt.anon();
select is((public.search_listings('Alpha Uniforms Qx3', null, null))->>'total', '0', 'S4 a suspended listing disappears from search');
select throws_ok($$ select public.get_listing('x') $$, 'PT404', null, 'S5 and its profile is 404');
select tt.act('tt_a_owner');
select throws_ok($$ select public.republish_listing(tt.oid('A')) $$, 'PT409', 'listing_not_live', 'S6 the owner cannot republish a suspended listing');
select throws_ok($$ select public.unpublish_listing(tt.oid('A')) $$, 'PT409', 'listing_not_live', 'S7 nor unpublish it');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.reinstate_listing(tt.oid('A'), 'Corrected after talking to the owner') $$, 'S8 reviewer reinstates it');
select tt.anon();
select is((public.search_listings('Alpha Uniforms Qx3', null, null))->>'total', '1', 'S9 it is public again');
select tt.act('tt_a_viewer');
select throws_ok($$ select public.unpublish_listing(tt.oid('A')) $$, 'PT403', 'forbidden', 'S10 a viewer cannot unpublish');

-- ============================ REQUESTS: draft, submit, matching ============================
select tt.act('tt_x_user');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-outsider-1', '{"title":"Hello there"}'::jsonb, 0) $$, 'PT403', 'forbidden',
  'Q1 a non-member cannot create a request for an organisation');
select tt.act('tt_q_viewer');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-viewer-12', '{"title":"Hello there"}'::jsonb, 0) $$, 'PT403', 'forbidden',
  'Q2 a viewer cannot post requests');
select tt.act('tt_q_owner');
select is((public.save_request_draft(tt.oid('Q'), null, 'key-idem-0001', '{"title":"100 custom uniforms"}'::jsonb, 0) ->> 'version'), '1', 'Q3a first save of the draft');
select ok((public.save_request_draft(tt.oid('Q'), null, 'key-idem-0001', '{"title":"100 custom uniforms"}'::jsonb, 0) ->> 'id') =
          (select id::text from public.buyer_requests where idempotency_key = 'key-idem-0001'),
  'Q3 saving again with the same idempotency key returns the same draft');
select tt.pg();
select is((select count(*)::int from public.buyer_requests where buyer_org_id = tt.oid('Q')), 1, 'Q3b and creates exactly one row');
select tt.act('tt_q_owner');
select throws_ok($$ select public.submit_request((select id from public.buyer_requests where idempotency_key = 'key-idem-0001'), 2) $$, 'PT422', 'request_incomplete',
  'Q4 an incomplete request cannot be submitted');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-badcat-01', '{"category_slug":"nope"}'::jsonb, 0) $$, 'PT422', 'invalid_category', 'Q5 unknown category');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-badbud-01', '{"budget_min":"500","budget_max":"100"}'::jsonb, 0) $$, 'PT422', 'invalid_budget', 'Q6 budget max below min');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-baddat-01', '{"needed_by":"2026-13-45"}'::jsonb, 0) $$, 'PT422', 'invalid_date', 'Q7 impossible date');
select throws_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-badqty-01', '{"quantity":"-5"}'::jsonb, 0) $$, 'PT422', 'invalid_quantity', 'Q8 negative quantity');

-- the main scenario: 100 uniforms in Selangor, three weeks
select tt.act('tt_q_owner');
select is((public.save_request_draft(tt.oid('Q'), (select id from public.buyer_requests where idempotency_key = 'key-idem-0001'), null,
  '{"category_slug":"tailoring-apparel","description":"Black polo uniforms with embroidered logo, mixed sizes, delivered to Subang Jaya.","target_state":"Selangor","quantity":"100","unit":"pcs","share_contact":false}'::jsonb, 2)) ->> 'version', '3',
  'Q9 the draft is completed over several saves');
select throws_ok($$ select public.submit_request((select id from public.buyer_requests where idempotency_key = 'key-idem-0001'), 3) $$, 'PT422', 'contact_required',
  'Q10 contact details are required before sending');
select is((public.save_request_draft(tt.oid('Q'), (select id from public.buyer_requests where idempotency_key = 'key-idem-0001'), null,
  jsonb_build_object('needed_by', (current_date + 21)::text, 'contact_email', 'Buyer@Example.test'), 3)) ->> 'version', '4', 'Q11 contact added');
select is((public.submit_request((select id from public.buyer_requests where idempotency_key = 'key-idem-0001'), 4)) ->> 'status', 'open',
  'Q12 the request is submitted and open');
select tt.pg();
insert into tt.ids (label, id) select 'R1', id from public.buyer_requests where idempotency_key = 'key-idem-0001';

-- ============================ MATCHING AND VISIBILITY BEFORE INVITATION ============================
select tt.pg();
select is(tt.cands(tt.id('R1')), tt.oid('A')::text, 'M1 the only candidate is Alpha (B serves Penang only, C is catering)');
select is((select reason_codes from public.request_seller_matches where request_id = tt.id('R1') and seller_org_id = tt.oid('A')),
  array['category_match', 'serves_state', 'min_order_ok', 'lead_time_ok'], 'M2 the saved reasons are real facts about the seller');
select is((select caution_codes from public.request_seller_matches where request_id = tt.id('R1') and seller_org_id = tt.oid('A')), '{}'::text[], 'M3 no cautions');

select tt.act('tt_a_owner');
select is((select count(*)::int from public.request_seller_matches), 0, 'N1 a candidate seller cannot see that it is a candidate');
select is((select count(*)::int from public.buyer_requests), 0, 'N2 nor read the request');
select throws_ok($$ select public.get_request_for_seller(tt.id('R1'), tt.oid('A')) $$, 'PT404', 'not_found', 'N3 reading an uninvited request is 404');
select is(jsonb_array_length(public.list_seller_requests(tt.oid('A'))), 0, 'N4 the inbox is empty before an invitation');
select tt.act('tt_b_owner');
select throws_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('B')) $$, 'PT404', 'not_found', 'N5 a seller cannot invite itself to someone else''s request');
select tt.act('tt_q_owner');
select throws_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('B')) $$, 'PT422', 'not_a_candidate', 'N6 the buyer cannot invite a seller that is not a candidate');
select throws_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('C')) $$, 'PT422', 'not_a_candidate', 'N7 nor one that does not offer this service');
select tt.act('tt_x_user');
select throws_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('A')) $$, 'PT404', 'not_found', 'N8 a stranger cannot invite sellers to a request');

-- ============================ INVITATION ============================
select tt.act('tt_q_owner');
select lives_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('A')) $$, 'I1 the buyer invites Alpha');
select lives_ok($$ select public.invite_seller(tt.id('R1'), tt.oid('A')) $$, 'I2 a duplicate invitation is a harmless no-op');
select tt.pg();
select is((select count(*)::int from public.notifications where kind = 'request.invited' and org_id = tt.oid('A')), 2,
  'I3 owner and staff of Alpha (not the viewer) are notified exactly once');
select tt.act('tt_a_owner');
select is(jsonb_array_length(public.list_seller_requests(tt.oid('A'), 'new')), 1, 'I4 the invitation appears in the seller''s New inbox');
select is((public.get_request_for_seller(tt.id('R1'), tt.oid('A'))) ->> 'title', '100 custom uniforms', 'I5 the invited seller reads the request');
select ok(not ((public.get_request_for_seller(tt.id('R1'), tt.oid('A'))) ? 'contact_email')
      and not ((public.get_request_for_seller(tt.id('R1'), tt.oid('A'))) ? 'buyer_name'), 'I6 no buyer contact or name before the seller responds');
select is((select count(*)::int from public.buyer_request_private), 0, 'I7 the private contact table is invisible to sellers');
select tt.act('tt_b_owner');
select is(jsonb_array_length(public.list_seller_requests(tt.oid('B'))), 0, 'I8 seller B has no inbox entries');
select throws_ok($$ select public.get_request_for_seller(tt.id('R1'), tt.oid('B')) $$, 'PT404', 'not_found', 'I9 seller B cannot read seller A''s invitation by guessing the id');
select throws_ok($$ select public.get_request_for_seller(tt.id('R1'), tt.oid('A')) $$, 'PT403', 'forbidden', 'I10 nor by naming seller A''s organisation');

-- ============================ RESPONSE ============================
select tt.act('tt_a_viewer');
select throws_ok($$ select public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'interested', null) $$, 'PT403', 'forbidden', 'S11 a viewer cannot respond');
select tt.act('tt_a_staff');
select throws_ok($$ select public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'maybe', null) $$, 'PT422', 'invalid_response', 'S12 only the three defined responses');
select throws_ok($$ select public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'question', null) $$, 'PT422', 'invalid_note', 'S13 a question needs text');
select is((public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'question', 'Can you send the logo as a vector file?')) ->> 'status', 'question',
  'S14 staff asks a question through the invitation');
select ok(((public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'question', 'Can you send the logo as a vector file?')) ->> 'enquiry_id') =
  (public.get_request_for_seller(tt.id('R1'), tt.oid('A'))) ->> 'enquiry_id',
  'S15 repeating the same response returns the same enquiry (retry-safe)');
select throws_ok($$ select public.respond_to_invitation(tt.id('R1'), tt.oid('A'), 'declined', null) $$, 'PT409', 'already_responded', 'S16 a response cannot be flipped afterwards');
select tt.pg();
select is((select count(*)::int from public.enquiries where buyer_request_id = tt.id('R1')), 1, 'S17 exactly one enquiry exists for the request');
select is((select opening_note from public.enquiries where buyer_request_id = tt.id('R1')), 'Can you send the logo as a vector file?', 'S18 the question is kept as the opening note');
select ok((select origin = 'request_invitation' and buyer_org_id = tt.oid('Q') and seller_org_id = tt.oid('A') and opened_by_org_id = tt.oid('A')
           from public.enquiries where buyer_request_id = tt.id('R1')), 'S19 participants and origin are recorded');
select throws_ok($$ update public.enquiries set buyer_org_id = tt.oid('B') $$, 'PT409', 'immutable_columns', 'S20 enquiry participants are immutable');
select is((select count(*)::int from public.notifications where kind = 'request.question' and org_id = tt.oid('Q')), 1, 'S21 the buyer organisation is notified');

-- enquiry parties (names are shown to participants only)
select tt.act('tt_q_owner');
select is((public.enquiry_parties((select id from public.enquiries where buyer_request_id = tt.id('R1')))) ->> 'you_are', 'buyer', 'E0a the buyer can read the party names');
select is((public.enquiry_parties((select id from public.enquiries where buyer_request_id = tt.id('R1')))) ->> 'seller_name', 'Alpha Uniforms Qx3', 'E0b with the seller''s public name');
select tt.act('tt_b_owner');
select throws_ok($$ select public.enquiry_parties((select id from public.enquiries where buyer_request_id = tt.id('R1'))) $$, 'PT404', 'not_found', 'E0c a non-participant gets 404');
-- enquiry visibility
select tt.act('tt_q_owner');
select is((select count(*)::int from public.enquiries), 1, 'E1 the buyer sees its enquiry');
select tt.act('tt_q_viewer');
select is((select count(*)::int from public.enquiries), 1, 'E2 including a viewer member');
select tt.act('tt_a_staff');
select is((select count(*)::int from public.enquiries), 1, 'E3 the seller sees it');
select tt.act('tt_b_owner');
select is((select count(*)::int from public.enquiries), 0, 'E4 another seller does not');
select tt.act('tt_r_owner');
select is((select count(*)::int from public.enquiries), 0, 'E5 another buyer does not');
select tt.anon();
select throws_ok($$ select count(*) from public.enquiries $$, '42501', null, 'E6 anon cannot read enquiries');
select tt.act('tt_q_owner');
select throws_ok($$ insert into public.enquiries (buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by)
  values (tt.oid('Q'), tt.oid('B'), 'listing', 'forged enquiry', tt.oid('Q'), tt.uid('tt_q_owner')) $$, '42501', null, 'E7 enquiries cannot be forged by direct insert');
select is((public.list_request_matches(tt.id('R1')) -> 0 ->> 'status'), 'question', 'E8 the buyer sees the seller''s response state');
select ok((public.list_request_matches(tt.id('R1')) -> 0 ->> 'enquiry_id') is not null, 'E9 with the enquiry id Phase 4 will extend');

-- ============================ share_contact, matching variants ============================
select tt.mkreq('R2', tt.oid('Q'), 'tt_q_owner', 'key-req-0002', '200 chef aprons', 'tailoring-apparel', 'Selangor', '200', 'pcs', true);
select tt.act('tt_q_owner');
select lives_ok($$ select public.invite_seller(tt.id('R2'), tt.oid('A')) $$, 'C1 invite for the contact-sharing request');
select tt.act('tt_a_staff');
select is((public.respond_to_invitation(tt.id('R2'), tt.oid('A'), 'interested', null)) ->> 'status', 'interested', 'C2 the seller is interested');
select is((public.get_request_for_seller(tt.id('R2'), tt.oid('A'))) ->> 'contact_email', 'buyer@example.test',
  'C3 with consent, contact details appear only after the seller responded');
select is((public.get_request_for_seller(tt.id('R2'), tt.oid('A'))) ->> 'buyer_name', 'Quick Buyer', 'C4 and the buyer name');
select tt.pg();
select is((select count(*)::int from public.enquiries where buyer_org_id = tt.oid('Q') and seller_org_id = tt.oid('A')), 2, 'C5 a second request gets its own enquiry');

select tt.mkreq('R3', tt.oid('Q'), 'tt_q_owner', 'key-req-0003', '20 sample polos', 'tailoring-apparel', 'Selangor', '20', 'pcs');
select tt.pg();
select is(tt.cands(tt.id('R3')), '', 'M4 a request below the seller''s stated minimum order (same unit) is not matched');
select tt.act('tt_q_owner');
select ok(public.find_candidates(tt.id('R3'), true) >= 1, 'M5a widening the area finds sellers outside it');
select tt.pg();
select is(tt.cands(tt.id('R3')), tt.oid('B')::text, 'M5 among ours, Bravo (outside the requested state) is offered');
select tt.pg();
select is((select caution_codes from public.request_seller_matches where request_id = tt.id('R3') and seller_org_id = tt.oid('B')),
  array['outside_requested_area'], 'M6 and says so');
select tt.mkreq('R4', tt.oid('Q'), 'tt_q_owner', 'key-req-0004', '10 rush uniform sets', 'tailoring-apparel', 'Selangor', '10', 'sets', false, (current_date + 3)::text);
select tt.pg();
select is((select caution_codes from public.request_seller_matches where request_id = tt.id('R4') and seller_org_id = tt.oid('A')),
  array['lead_time_tight', 'min_order_unit_differs'], 'M7 a tight deadline and an unknown unit are flagged, not hidden');

-- duplicate and abuse bounds
select tt.act('tt_q_owner');
select is(((public.save_request_draft(tt.oid('Q'), null, 'key-dup-00001', '{"title":"100 custom uniforms","category_slug":"tailoring-apparel","description":"Same job again, please reply with options.","target_state":"Selangor","contact_phone":"0123456789"}'::jsonb, 0)) ->> 'version'), '1', 'A1 a second draft with the same title');
select throws_ok($$ select public.submit_request((select id from public.buyer_requests where idempotency_key = 'key-dup-00001'), 1) $$, 'PT409', 'duplicate_request',
  'A2 submitting a duplicate open request is refused');

-- ============================ ENQUIRY FROM A LISTING ============================
select tt.act('tt_q_owner');
select is((public.open_listing_enquiry(tt.oid('Q'), (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug',
  'Question about uniforms', 'Do you do embroidery on caps as well as polos?')) ->> 'created', 'true', 'O1 the buyer opens an in-app enquiry from a listing');
select is((public.open_listing_enquiry(tt.oid('Q'), (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug',
  'Question about uniforms', 'Do you do embroidery on caps as well as polos?')) ->> 'created', 'false', 'O2 repeating it reuses the open enquiry');
select tt.act('tt_a_owner');
select throws_ok($$ select public.open_listing_enquiry(tt.oid('A'), (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug', 'Own listing', 'Trying to enquire on myself.') $$,
  'PT422', 'same_organisation', 'O3 an organisation cannot enquire on its own listing');
select tt.act('tt_q_viewer');
select throws_ok($$ select public.open_listing_enquiry(tt.oid('Q'), (public.search_listings('Bravo Tailors Qx3', null, null))->'items'->0->>'slug', 'Hello Bravo', 'I would like a price for an order.') $$,
  'PT403', 'forbidden', 'O4 a viewer cannot open enquiries');
select tt.act('tt_q_owner');
select throws_ok($$ select public.open_listing_enquiry(tt.oid('Q'), (public.search_listings('Bravo Tailors Qx3', null, null))->'items'->0->>'slug', 'Hello Bravo', 'short') $$,
  'PT422', 'invalid_note', 'O5 a one-word note is rejected');
select tt.act('tt_c_owner');
select lives_ok($$ select public.set_accepting_requests(tt.oid('C'), false) $$, 'O6 a busy seller switches off new requests');
select tt.act('tt_q_owner');
select throws_ok($$ select public.open_listing_enquiry(tt.oid('Q'), (public.search_listings('Charlie Catering Qx3', null, null))->'items'->0->>'slug', 'Catering', 'Can you cater for 80 people next month?') $$,
  'PT409', 'seller_not_accepting', 'O7 and cannot be enquired');
select tt.act('tt_c_owner');
select lives_ok($$ select public.set_accepting_requests(tt.oid('C'), true) $$, 'O8 switching back on');

-- ============================ END, EXPIRE ============================
select tt.act('tt_q_owner');
select lives_ok($$ select public.invite_seller(tt.id('R4'), tt.oid('A')) $$, 'X1 invite on the rush request');
select tt.act('tt_a_owner');
select throws_ok($$ select public.end_request(tt.id('R4'), 'withdrawn', 'seller trying to end') $$, 'PT404', 'not_found', 'X2 a seller cannot end the buyer''s request');
select tt.act('tt_q_owner');
select lives_ok($$ select public.end_request(tt.id('R4'), 'withdrawn', 'Found another way') $$, 'X3 the buyer withdraws it');
select lives_ok($$ select public.end_request(tt.id('R4'), 'withdrawn', 'Found another way') $$, 'X4 withdrawing twice is harmless');
select tt.act('tt_a_owner');
select throws_ok($$ select public.respond_to_invitation(tt.id('R4'), tt.oid('A'), 'interested', null) $$, 'PT409', 'request_not_open', 'X5 a withdrawn request cannot be answered');
select is(jsonb_array_length(public.list_seller_requests(tt.oid('A'), 'closed')), 1, 'X6 it shows under Closed for the seller');
select ok(not ((public.get_request_for_seller(tt.id('R4'), tt.oid('A'))) ? 'title'), 'X7 and its details are no longer shown');

select tt.mkreq('R5', tt.oid('Q'), 'tt_q_owner', 'key-req-0005', '30 school bags', 'tailoring-apparel', 'Selangor', '30', 'bags');
select tt.act('tt_q_owner');
select lives_ok($$ select public.invite_seller(tt.id('R5'), tt.oid('A')) $$, 'X8 invite on a request that will expire');
select tt.pg();
update public.buyer_requests set expires_at = now() - interval '1 day' where id = tt.id('R5');
select tt.act('tt_q_owner');
select is((select (e ->> 'status') from jsonb_array_elements(public.list_buyer_requests(tt.oid('Q'))) e where e ->> 'id' = tt.id('R5')::text), 'expired', 'X9 an old request becomes expired');
select tt.act('tt_a_owner');
select throws_ok($$ select public.respond_to_invitation(tt.id('R5'), tt.oid('A'), 'interested', null) $$, 'PT409', 'request_not_open', 'X10 an expired request cannot be answered');
select tt.pg();
select is((select status::text from public.request_seller_matches where request_id = tt.id('R5') and seller_org_id = tt.oid('A')), 'expired', 'X11 its invitation expired with it');

-- ============================ suspended seller, open-request bound ============================
select tt.mkreq('R6', tt.oid('Q'), 'tt_q_owner', 'key-req-0006', 'Catering for 80 guests', 'food-beverage', 'Selangor', '80', 'guests');
select tt.act('tt_q_owner');
select lives_ok($$ select public.invite_seller(tt.id('R6'), tt.oid('C')) $$, 'U1 invite the caterer');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.suspend_listing(tt.oid('C'), 'Under investigation for a complaint') $$, 'U2 the caterer is suspended meanwhile');
select tt.act('tt_c_owner');
select throws_ok($$ select public.respond_to_invitation(tt.id('R6'), tt.oid('C'), 'interested', null) $$, 'PT409', 'seller_not_available', 'U3 a suspended seller cannot express interest');
select is((public.respond_to_invitation(tt.id('R6'), tt.oid('C'), 'declined', 'We are not available.')) ->> 'status', 'declined', 'U4 but can decline');
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.reinstate_listing(tt.oid('C'), 'Complaint resolved with the owner') $$, 'U5 reinstated');

select tt.mkreq('R7', tt.oid('Q'), 'tt_q_owner', 'key-req-0007', 'More uniforms for a school', 'tailoring-apparel', 'Selangor', '60', 'pcs');
select tt.act('tt_q_owner');
select is((select count(*)::int from public.buyer_requests where buyer_org_id = tt.oid('Q') and status = 'open'), 5, 'B0 the organisation now has five open requests');
select public.save_request_draft(tt.oid('Q'), null, 'key-req-0008', '{"title":"One request too many","category_slug":"tailoring-apparel","description":"Another job that needs a tailor soon.","target_state":"Selangor","contact_phone":"0123456789"}'::jsonb, 0);
select throws_ok($$ select public.submit_request((select id from public.buyer_requests where idempotency_key = 'key-req-0008'), 1) $$, 'PT409', 'request_limit_reached',
  'B1 more than five open requests per organisation is refused');

-- ============================ REPORTS AND MODERATION ============================
select tt.act('tt_a_owner');
select lives_ok($$ select public.report_content('request', tt.id('R1')::text, 'scam', 'Asked me to pay a deposit first') $$, 'T1 an invited seller reports an abusive request');
select throws_ok($$ select public.report_content('request', tt.id('R1')::text, 'scam', 'again') $$, 'PT409', 'already_reported', 'T2 the same user cannot report twice');
select tt.act('tt_b_owner');
select throws_ok($$ select public.report_content('request', tt.id('R1')::text, 'scam', 'I was never invited') $$, 'PT404', 'not_found', 'T3 a seller never shown the request cannot report it');
select tt.act('tt_x_user');
select lives_ok($$ select public.report_content('listing', (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug', 'misleading', 'Photos are not theirs') $$, 'T4 anyone signed in can report a listing');
select tt.act('tt_a_owner');
select throws_ok($$ select public.report_content('listing', (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug', 'spam', null) $$, 'PT422', 'same_organisation', 'T5 not their own listing');
select tt.act('tt_q_owner');
select lives_ok($$ select public.report_content('listing', (public.search_listings('Charlie Catering Qx3', null, null))->'items'->0->>'slug', 'spam', null) $$, 'T6 a second report on another listing');

select tt.act('tt_sup', 'aal2');
select is((select count(*)::int from public.buyer_requests where buyer_org_id = tt.oid('Q')), 1, 'T7 a request moderator sees only the reported request, not the others');
select is((select count(*)::int from public.buyer_request_private), 0, 'T8 and never the buyer''s private contact details');
select is((select count(*)::int from public.content_reports where target_type = 'listing'), 0, 'T9 and no listing reports');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.content_reports where listing_org_id in (tt.oid('A'), tt.oid('C'))), 2, 'T10 the listing reviewer sees the two listing reports');
select tt.act('tt_x_user');
select is((select count(*)::int from public.content_reports), 1, 'T11 a reporter sees only their own report');

select tt.act('tt_rev', 'aal2');
select throws_ok($$ select public.handle_report((select id from public.content_reports where listing_org_id = tt.oid('C') and reason = 'spam'), 'remove', 'wrong action') $$, 'PT422', 'invalid_decision',
  'T13 a listing report cannot trigger a request removal');
select lives_ok($$ select public.handle_report((select id from public.content_reports where listing_org_id = tt.oid('C') and reason = 'spam'), 'dismiss', 'Nothing wrong found on review') $$,
  'T14 a reviewer dismisses a report with a note');
select throws_ok($$ select public.handle_report((select id from public.content_reports where listing_org_id = tt.oid('C') and reason = 'spam'), 'dismiss', 'Dismiss again') $$, 'PT409', 'report_not_open', 'T15 a handled report is closed');
select lives_ok($$ select public.handle_report((select id from public.content_reports where listing_org_id = tt.oid('A') and reason = 'misleading'), 'suspend', 'Photos taken from another site') $$,
  'T16 a reviewer suspends a listing from a report');
select tt.anon();
select is((public.search_listings('Alpha Uniforms Qx3', null, null))->>'total', '0', 'T17 the reported listing is no longer public');

select tt.act('tt_sup', 'aal2');
select throws_ok($$ select public.handle_report((select id from public.content_reports where request_id = tt.id('R1')), 'suspend', 'wrong action type') $$, 'PT422', 'invalid_decision', 'T18 a request report cannot suspend a listing');
select lives_ok($$ select public.handle_report((select id from public.content_reports where request_id = tt.id('R1')), 'remove', 'Asks sellers for deposits') $$, 'T19 a support moderator removes the request');
select tt.pg();
select is((select status::text from public.buyer_requests where id = tt.id('R1')), 'removed', 'T20 the request is removed');
select tt.act('tt_a_owner');
select ok(not ((public.get_request_for_seller(tt.id('R1'), tt.oid('A'))) ? 'title'), 'T21 sellers no longer see its content');
select tt.act('tt_q_owner');
select is((select status::text from public.buyer_requests where id = tt.id('R1')), 'removed', 'T22 the buyer sees why it ended');
select tt.pg();
select ok((select count(*) from public.audit_log where action in ('listing.suspended', 'request.removed', 'report.remove', 'report.dismiss')) >= 4, 'T23 moderation actions are audited');

-- ============================ REVIEW FIXES (independent review of Phase 3) ============================
-- V1/V2: a seller that was only a candidate never learns about the request, not even after it ends or expires
select tt.mkreq('R8', tt.oid('Q'), 'tt_q_owner', 'key-req-0009', 'Catering for a wedding', 'food-beverage', 'Selangor', '90', 'guests');
select tt.pg();
select ok(tt.cands(tt.id('R8')) like '%' || tt.oid('C')::text || '%', 'V0 the caterer is a candidate for the wedding request (not invited)');
select tt.act('tt_q_owner');
select lives_ok($$ select public.end_request(tt.id('R8'), 'closed', 'Found someone else') $$, 'V1a the buyer closes it');
select tt.act('tt_c_owner');
select throws_ok($$ select public.get_request_for_seller(tt.id('R8'), tt.oid('C')) $$, 'PT404', 'not_found', 'V1 a never-invited candidate gets 404 after the request is closed');
select is((select count(*)::int from jsonb_array_elements(public.list_seller_requests(tt.oid('C'))) e where e ->> 'request_id' = tt.id('R8')::text), 0,
  'V1b and it is not in the inbox');
select tt.mkreq('R9', tt.oid('Q'), 'tt_q_owner', 'key-req-0010', 'Catering for a school fair', 'food-beverage', 'Selangor', '60', 'guests');
select tt.pg();
update public.buyer_requests set expires_at = now() - interval '1 day' where id = tt.id('R9');
select tt.act('tt_q_owner');
select is(jsonb_array_length(public.list_buyer_requests(tt.oid('Q'))) > 0, true, 'V2a expiry runs when the buyer lists requests');
select tt.act('tt_c_owner');
select throws_ok($$ select public.get_request_for_seller(tt.id('R9'), tt.oid('C')) $$, 'PT404', 'not_found', 'V2 a never-invited candidate gets 404 after the request expires');
select tt.pg();
select is((select count(*)::int from public.request_seller_matches where request_id in (tt.id('R8'), tt.id('R9'))), 0, 'V2b candidate rows of ended requests are deleted');

-- V3: buyer name only with the buyer's consent
select tt.act('tt_a_owner');
select is((public.enquiry_parties((select id from public.enquiries where buyer_request_id = tt.id('R1')))) ->> 'buyer_name', null, 'V3a no buyer name for the seller without consent');
select is((public.enquiry_parties((select id from public.enquiries where buyer_request_id = tt.id('R2')))) ->> 'buyer_name', 'Quick Buyer', 'V3b the name is shared when the buyer allowed it');
-- V8: sellers have no direct access to match rows
select is((select count(*)::int from public.request_seller_matches), 0, 'V8 a seller cannot read match rows directly');
-- V9: a removed request shows no content in the inbox
select is((select count(*)::int from jsonb_array_elements(public.list_seller_requests(tt.oid('A'))) e where e ->> 'request_id' = tt.id('R1')::text and e -> 'title' = 'null'::jsonb), 1,
  'V9 a removed request stays in the inbox without its title');

-- V4: removal needs an open report
select tt.act('tt_sup', 'aal2');
select throws_ok($$ select public.remove_request(tt.id('R7'), 'No report exists for this one') $$, 'PT409', 'report_not_open', 'V4 a moderator cannot remove a request that has no open report');

-- V5: a conflicted reviewer cannot dismiss a report either
select tt.act('tt_rev', 'aal2');
select lives_ok($$ select public.reinstate_listing(tt.oid('A'), 'Photos replaced by the owner') $$, 'V5a A is reinstated');
select tt.act('tt_q_owner');
select lives_ok($$ select public.report_content('listing', (public.search_listings('Alpha Uniforms Qx3', null, null))->'items'->0->>'slug', 'spam', null) $$, 'V5b a new report on A');
select tt.act('tt_rev_conf', 'aal2');
select throws_ok($$ select public.handle_report((select id from public.content_reports where listing_org_id = tt.oid('A') and reason = 'spam'), 'dismiss', 'Looks fine to me') $$, 'PT403', 'conflict_of_interest',
  'V5 a reviewer involved with the organisation cannot dismiss its reports');

-- V6/V7: contact the owner did not choose to publish is not stored, and unsubmitted drafts are not reviewer-readable
select tt.act('tt_a_owner');
select lives_ok($$ select public.save_listing_draft(tt.oid('A'), '{"show_phone":false}'::jsonb, (select draft_version from public.business_listings where org_id = tt.oid('A'))) $$, 'V6a owner turns the public phone off');
select tt.pg();
select is((select draft ->> 'public_phone' from public.business_listings where org_id = tt.oid('A')), null, 'V6 the unpublished phone number is no longer kept in the draft');
select tt.prof(tt.oid('D'), 'tt_d_owner', tt.std2('Delta Draft Qx3', '444444444444', 'tailoring-apparel', 'Selangor'));
select tt.act('tt_d_owner');
select lives_ok($$ select public.save_listing_draft(tt.oid('D'), '{"headline":"A draft nobody has seen yet"}'::jsonb, 0) $$, 'V7a an owner saves a draft without submitting it');
select tt.act('tt_rev', 'aal2');
select is((select count(*)::int from public.business_listings where org_id = tt.oid('D')), 0, 'V7 a reviewer cannot read an unsubmitted draft');

-- ============================ PUBLIC REQUEST BOARD (migration 000100) ============================
select tt.pg();
create function tt.mkboard(p_label text, p_user text, p_key text, p_title text, p_cat text, p_state text, p_share boolean default false,
  p_desc text default 'We need this made and delivered, please reply with what you can do.') returns jsonb language plpgsql as $$
declare d jsonb; r jsonb;
begin
  perform tt.act(p_user);
  d := public.save_request_draft(tt.oid('Q'), null, p_key, jsonb_build_object('title', p_title, 'category_slug', p_cat,
    'description', p_desc, 'target_state', p_state, 'share_contact', p_share,
    'contact_phone', '+60 12 345 6789', 'contact_email', 'buyer@example.test'), 0);
  perform public.set_request_visibility((d ->> 'id')::uuid, 'eligible_sellers');
  r := public.submit_request((d ->> 'id')::uuid, (d ->> 'version')::int);
  perform tt.pg();
  insert into tt.ids (label, id) values (p_label, (d ->> 'id')::uuid);
  return r;
end $$;
create function tt.onboard(p_org uuid, p_req uuid) returns int language sql stable as $$
  select count(*)::int from jsonb_array_elements(public.list_board_requests(p_org, null, null, 0) -> 'items') e where e ->> 'request_id' = p_req::text
$$;

select tt.pg();
update public.buyer_requests set status = 'closed' where buyer_org_id = tt.oid('Q') and status = 'open';
delete from public.rate_limit_events where key like 'reqsubmit:%' or key like 'reqdraft:%';
select is((tt.mkboard('G1', 'tt_q_owner', 'key-brd-0001', 'Catering for a company dinner', 'food-beverage', 'Selangor')) ->> 'status', 'open', 'B1 a buyer publishes a request to eligible sellers');
select tt.act('tt_q_owner');
select lives_ok($$ select public.save_request_draft(tt.oid('Q'), null, 'key-brd-0002', jsonb_build_object('title', 'Catering with a phone number', 'category_slug', 'food-beverage',
  'description', 'Please call me on 0123456789 to discuss the menu.', 'target_state', 'Selangor', 'contact_phone', '+60 12 345 6789'), 0) $$, 'B2a draft saved');
select tt.pg();
delete from public.rate_limit_events where key like 'reqsubmit:%';
insert into tt.ids (label, id) select 'G2', id from public.buyer_requests where idempotency_key = 'key-brd-0002';
select tt.act('tt_q_owner');
select lives_ok($$ select public.set_request_visibility(tt.id('G2'), 'eligible_sellers') $$, 'B2b visibility can be set on a draft');
select throws_ok($$ select public.submit_request(tt.id('G2'), (select version from public.buyer_requests where id = tt.id('G2'))) $$, 'PT422', 'contact_in_public_text',
  'B2 a phone number in the public text is refused');

select tt.act('tt_c_owner');
select is(tt.onboard(tt.oid('C'), tt.id('G1')), 1, 'B3 an eligible seller (food, Selangor) sees the request on the board');
select tt.act('tt_a_owner');
select is(tt.onboard(tt.oid('A'), tt.id('G1')), 0, 'B4 a seller in another category does not see it');
select throws_ok($$ select public.get_request_for_seller(tt.id('G1'), tt.oid('A')) $$, 'PT404', 'not_found', 'B4b and cannot open it (404, no existence leak)');
select tt.act('tt_a_viewer');
select throws_ok($$ select public.list_board_requests(tt.oid('A'), null, null, 0) $$, 'PT403', 'forbidden', 'B5 a viewer cannot use the board');
select tt.act('tt_c_owner');
select is((public.get_request_for_seller(tt.id('G1'), tt.oid('C'))) ->> 'title', 'Catering for a company dinner', 'B6 an eligible seller can read the request');
select is((public.get_request_for_seller(tt.id('G1'), tt.oid('C'))) ->> 'contact_email', null, 'B6b with no buyer email');
select is((public.get_request_for_seller(tt.id('G1'), tt.oid('C'))) ->> 'buyer_name', null, 'B6c and no buyer name');

select tt.pg();
select tt.mkreq('G3', tt.oid('Q'), 'tt_q_owner', 'key-brd-0003', 'Private catering lunch', 'food-beverage', 'Selangor', null, null);
select tt.act('tt_c_owner');
select is(tt.onboard(tt.oid('C'), tt.id('G3')), 0, 'B7 an invitation-only request is not on the board');
select throws_ok($$ select public.get_request_for_seller(tt.id('G3'), tt.oid('C')) $$, 'PT404', 'not_found', 'B7b and is not readable by a seller that was not invited');
select tt.pg();
select tt.mkboard('G4', 'tt_q_owner', 'key-brd-0004', 'Uniforms for a Selangor cafe', 'tailoring-apparel', 'Selangor');
select tt.act('tt_b_owner');
select is(tt.onboard(tt.oid('B'), tt.id('G4')), 0, 'B8 a seller that does not serve the area (Penang only) does not see it');
select throws_ok($$ select public.get_request_for_seller(tt.id('G4'), tt.oid('B')) $$, 'PT404', 'not_found', 'B8b nor open it');
select tt.act('tt_a_owner');
select is(tt.onboard(tt.oid('A'), tt.id('G4')), 1, 'B8c while a seller that serves Selangor does');
select tt.act('tt_c_owner');

select is((public.respond_to_invitation(tt.id('G1'), tt.oid('C'), 'interested', 'We can cater for 80 guests.')) ->> 'status', 'interested', 'B9 an eligible seller answers Interested from the board');
select tt.pg();
select is((select count(*)::int from public.enquiries where buyer_request_id = tt.id('G1') and seller_org_id = tt.oid('C') and origin = 'request_invitation'), 1, 'B9b a valid enquiry was created');
select tt.act('tt_c_owner');
select is((public.respond_to_invitation(tt.id('G1'), tt.oid('C'), 'interested', 'We can cater for 80 guests.')) ->> 'enquiry_id',
  (select id::text from public.enquiries where buyer_request_id = tt.id('G1')), 'B10 repeating the same answer is a harmless retry (same enquiry)');
select throws_ok($$ select public.respond_to_invitation(tt.id('G1'), tt.oid('C'), 'declined', null) $$, 'PT409', 'already_responded', 'B11 a different second answer is refused');
select is((public.get_request_for_seller(tt.id('G1'), tt.oid('C'))) ->> 'buyer_name', null, 'B12 no buyer name without the buyer''s consent');
select tt.act('tt_a_owner');
select throws_ok($$ select public.respond_to_invitation(tt.id('G1'), tt.oid('A'), 'interested', null) $$, 'PT404', 'not_found', 'B13 an ineligible seller cannot reply');
select tt.act('tt_q_owner');
select is((select (e ->> 'interested')::int from jsonb_array_elements(public.list_buyer_requests(tt.oid('Q'))) e where e ->> 'id' = tt.id('G1')::text), 1, 'B14 the buyer sees the response');

select tt.pg();
select tt.mkboard('G5', 'tt_q_owner', 'key-brd-0005', 'Catering for an open day', 'food-beverage', 'Selangor', true);
select tt.act('tt_c_owner');
select is((public.respond_to_invitation(tt.id('G5'), tt.oid('C'), 'question', 'Is a halal certificate needed?')) ->> 'status', 'question', 'B15 Ask a question works from the board');
select is((public.get_request_for_seller(tt.id('G5'), tt.oid('C'))) ->> 'buyer_name', 'Quick Buyer', 'B15b the buyer name is shown after a reply when the buyer agreed');
select tt.pg();
select throws_ok($$ update public.buyer_requests set visibility = 'private_invite' where id = tt.id('G1') $$, 'PT409', 'immutable_columns', 'B16 visibility never changes once a request is open');
select tt.act('tt_q_owner');
select throws_ok($$ select public.set_request_visibility(tt.id('G1'), 'private_invite') $$, 'PT409', 'request_not_editable', 'B16b and cannot be set after posting');

select tt.pg();
select tt.mkboard('G6', 'tt_q_owner', 'key-brd-0006', 'Catering for a school sports day', 'food-beverage', 'Selangor');
select tt.act('tt_c_owner');
select is((public.respond_to_invitation(tt.id('G6'), tt.oid('C'), 'declined', 'Fully booked that week.')) ->> 'enquiry_id', null, 'B17 Cannot take it makes no enquiry');
select tt.anon();
select throws_ok($$ select public.list_board_requests(tt.oid('C'), null, null, 0) $$, '42501', null, 'B18 anon cannot call the board');

select tt.pg();
update public.buyer_requests set status = 'closed' where id in (tt.id('G3'), tt.id('G4'), tt.id('G6'));
select tt.mkboard('G7', 'tt_q_owner', 'key-brd-0007', 'Catering for a book launch', 'food-beverage', 'Selangor');
select tt.act('tt_c_owner');
select is(tt.onboard(tt.oid('C'), tt.id('G7')), 1, 'B19 an open board request is listed');
select tt.act('tt_q_owner');
select lives_ok($$ select public.end_request(tt.id('G7'), 'withdrawn', 'Changed my mind') $$, 'B19b the buyer withdraws it');
select tt.act('tt_c_owner');
select is(tt.onboard(tt.oid('C'), tt.id('G7')), 0, 'B20 a withdrawn request leaves the board at once');
select throws_ok($$ select public.get_request_for_seller(tt.id('G7'), tt.oid('C')) $$, 'PT404', 'not_found', 'B20b and a seller that never replied cannot open it');
select is((public.list_board_requests(tt.oid('C'), 'tailoring-apparel', null, 0)) ->> 'total', '0', 'B21 the category filter narrows the list');
select throws_ok($$ select public.list_board_requests(tt.oid('C'), 'no-such-category', null, 0) $$, 'PT422', 'invalid_category', 'B22 an unknown category is refused');

select * from finish();
rollback;
