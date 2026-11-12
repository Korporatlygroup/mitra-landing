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
select plan(40);
select tt.mkuser(n) from unnest(array['tt_buyer','tt_ref','tt_rec','tt_rec_view','tt_rec_staff','tt_out','tt_rec2','tt_rec3','tt_rec4','tt_rec5']) n;
select tt.reg('B', tt.mkorg('buyer', 'Buyer Test', 'tt_buyer'));
select tt.reg('S', tt.mkorg('business', 'Referrer Test', 'tt_ref'));
select tt.reg('O', tt.mkorg('business', 'Recipient Test', 'tt_rec'));
select tt.reg('O2', tt.mkorg('business', 'Recipient Two', 'tt_rec2'));
select tt.reg('O3', tt.mkorg('business', 'Recipient Three', 'tt_rec3'));
select tt.reg('O4', tt.mkorg('business', 'Recipient Four', 'tt_rec4'));
select tt.reg('O5', tt.mkorg('business', 'Recipient Five', 'tt_rec5'));
select tt.addm(tt.oid('O'), 'tt_rec_view', 'viewer');
select tt.addm(tt.oid('O'), 'tt_rec_staff', 'staff');
insert into public.business_profiles(org_id, business_name, category_id)
select o.id, 'Rec', (select id from public.business_categories order by id limit 1) from public.organisations o where o.id in (tt.oid('O'), tt.oid('O2'), tt.oid('O3'), tt.oid('O4'), tt.oid('O5'));
insert into public.business_listings(org_id, slug, live_status) values
  (tt.oid('O'), 'rec-test', 'published'), (tt.oid('O2'), 'rec-two', 'published'), (tt.oid('O3'), 'rec-three', 'published'), (tt.oid('O4'), 'rec-four', 'published'), (tt.oid('O5'), 'rec-five', 'published');
-- an open request and two enquiries from the buyer to the referrer: one listing enquiry, one tied to the request
insert into public.buyer_requests (buyer_org_id, created_by, title, description, category_id, target_state, status, expires_at)
values (tt.oid('B'), tt.uid('tt_buyer'), 'Synthetic uniforms', 'Synthetic description for the referral test.',
        (select id from public.business_categories order by id limit 1), 'Selangor', 'open', now() + interval '10 days');
insert into tt.ids (label, id) select 'REQ', id from public.buyer_requests where title = 'Synthetic uniforms';
insert into public.enquiries (buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by)
values (tt.oid('B'), tt.oid('S'), 'listing', 'Synthetic cups', tt.oid('B'), tt.uid('tt_buyer'));
insert into public.enquiries (buyer_org_id, seller_org_id, buyer_request_id, origin, topic, opened_by_org_id, created_by)
values (tt.oid('B'), tt.oid('S'), tt.id('REQ'), 'request_invitation', 'Synthetic uniforms', tt.oid('S'), tt.uid('tt_ref'));
insert into tt.ids (label, id) select 'E1', id from public.enquiries where topic = 'Synthetic cups';
insert into tt.ids (label, id) select 'E2', id from public.enquiries where topic = 'Synthetic uniforms';

-- referrals: R1 from the listing enquiry to O, R2 from the request enquiry to O2, R3 (request) to O3
select tt.act('tt_ref');
select tt.reg('R1', public.propose_referral(tt.id('E1'), tt.oid('O')));
select tt.reg('R2', public.propose_referral(tt.id('E2'), tt.oid('O2')));
select tt.reg('R3', public.propose_referral(tt.id('E2'), tt.oid('O3')));

-- before consent or acceptance
select tt.act('tt_rec');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT404', null, 'H1 before the customer agrees the recipient gets 404, as if it did not exist');
select tt.act('tt_rec_view');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT404', null, 'H1b a recipient viewer also gets 404 before consent (no existence signal)');
select tt.act('tt_rec');
select tt.act('tt_buyer');
select public.respond_to_referral(tt.oid('R1'), true);
select tt.act('tt_rec');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT409', 'invalid_referral', 'H2 consented but not accepted cannot open an enquiry');
select public.respond_to_referral(tt.oid('R1'), true);

-- who may call it
select tt.act('tt_buyer');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT404', null, 'H3 buyer cannot open it (404)');
select tt.act('tt_ref');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT404', null, 'H4 referring business cannot open it (404)');
select tt.act('tt_out');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT404', null, 'H5 outsider gets 404');
select tt.act('tt_rec_view');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, 'PT403', null, 'H6 recipient viewer is forbidden');
select tt.anon();
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R1')) $$, '42501', null, 'H7 anonymous cannot execute it');
select tt.act('tt_rec');
select throws_ok($$ select public.open_referral_enquiry(gen_random_uuid()) $$, 'PT404', null, 'H8 unknown referral is 404');

-- success and idempotency
select tt.reg('N1', (public.open_referral_enquiry(tt.oid('R1')) ->> 'id')::uuid);
select is((select count(*)::int from public.enquiries where origin = 'referral'), 1, 'H9 one referral enquiry was created');
select is((public.open_referral_enquiry(tt.oid('R1')) ->> 'id')::uuid, tt.oid('N1'), 'H10 retry returns the same enquiry');
select is((public.open_referral_enquiry(tt.oid('R1')) ->> 'created')::boolean, false, 'H11 retry says created=false');
select tt.act('tt_rec_staff');
select is((public.open_referral_enquiry(tt.oid('R1')) ->> 'id')::uuid, tt.oid('N1'), 'H12 a colleague gets the same enquiry');
select tt.pg();
select results_eq($$ select buyer_org_id, seller_org_id, origin::text, topic, opening_note, opened_by_org_id, buyer_request_id from public.enquiries where id = tt.oid('N1') $$,
  $$ select tt.oid('B'), tt.oid('O'), 'referral', 'Synthetic cups', null::text, tt.oid('O'), null::uuid $$,
  'H13 enquiry has buyer, recipient, referral origin, the topic only and no copied note');
select is((select count(*)::int from public.referral_handoffs where referral_id = tt.oid('R1')), 1, 'H14 exactly one hand-off record');
select is((select count(*)::int from public.notifications where kind = 'enquiry.opened' and org_id = tt.oid('B') and entity_id = tt.oid('N1')::text), 1,
  'H15 the buyer is notified once');
select is((select count(*)::int from public.audit_log where action = 'referral.enquiry_opened' and entity_id = tt.oid('R1')::text), 1, 'H16 one audit event, no duplicates on retry');
select tt.act('tt_buyer');
select is((select count(*)::int from public.enquiries where id = tt.oid('N1')), 1, 'H17 buyer can see the new enquiry');
select tt.act('tt_rec');
select is((select count(*)::int from public.enquiries where id = tt.oid('N1')), 1, 'H18 recipient can see the new enquiry');
select tt.act('tt_ref');
select is((select count(*)::int from public.enquiries where id = tt.oid('N1')), 0, 'H19 referring business cannot see the new enquiry');
select is((select count(*)::int from public.referral_handoffs), 0, 'H20 referring business cannot read hand-off rows');
select tt.act('tt_out');
select is((select count(*)::int from public.enquiries where id = tt.oid('N1')), 0, 'H21 outsider cannot see it');

-- closing the new enquiry later does not let a retry create a second one
select tt.pg();
update public.enquiries set status = 'closed' where id = tt.oid('N1');
select tt.act('tt_rec');
select is((public.open_referral_enquiry(tt.oid('R1')) ->> 'id')::uuid, tt.oid('N1'), 'H22 retry after the enquiry closed still returns the same one');

-- request-linked referral: stops when the request is no longer open
select tt.act('tt_buyer');
select public.respond_to_referral(tt.oid('R2'), true);
select public.respond_to_referral(tt.oid('R3'), true);
select tt.act('tt_rec2');
select public.respond_to_referral(tt.oid('R2'), true);
select tt.act('tt_rec3');
select public.respond_to_referral(tt.oid('R3'), true);
select tt.act('tt_rec2');
select tt.reg('N2', (public.open_referral_enquiry(tt.oid('R2')) ->> 'id')::uuid);
select is((select buyer_request_id from public.enquiries where id = tt.oid('N2')), tt.id('REQ'), 'H23 request referral keeps the request link');
select tt.pg();
update public.buyer_requests set status = 'closed', closed_at = now() where id = tt.id('REQ');
select tt.act('tt_rec3');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R3')) $$, 'PT409', 'request_not_open', 'H24 closed request blocks a new hand-off');
select tt.act('tt_rec2');
select is((public.open_referral_enquiry(tt.oid('R2')) ->> 'id')::uuid, tt.oid('N2'), 'H25 an existing hand-off is still returned after the request closed');

-- recipient no longer available
select tt.pg();
update public.buyer_requests set status = 'open', closed_at = null where id = tt.id('REQ');
update public.business_listings set accepting_requests = false where org_id = tt.oid('O3');
select tt.act('tt_rec3');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R3')) $$, 'PT409', 'seller_not_available', 'H26 a recipient that stopped accepting requests cannot be handed an enquiry');
select tt.pg();
update public.business_listings set accepting_requests = true, live_status = 'suspended' where org_id = tt.oid('O3');
select tt.act('tt_rec3');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R3')) $$, 'PT409', 'seller_not_available', 'H27 a suspended recipient cannot be handed an enquiry');
select tt.pg();
update public.business_listings set live_status = 'published' where org_id = tt.oid('O3');
update public.enquiries set status = 'blocked' where id = tt.id('E2');
select tt.act('tt_rec3');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R3')) $$, 'PT409', 'invalid_referral', 'H28 a blocked source enquiry stops the hand-off');
select tt.pg();
update public.enquiries set status = 'closed' where id = tt.id('E2');
select tt.act('tt_rec3');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R3')) $$, 'PT409', 'invalid_referral', 'H28b a closed source enquiry stops the hand-off');
select tt.pg();
update public.enquiries set status = 'open' where id = tt.id('E2');
select tt.act('tt_rec3');
select tt.reg('N3', (public.open_referral_enquiry(tt.oid('R3')) ->> 'id')::uuid);
select tt.pg();
select is((select count(*)::int from public.enquiries where origin = 'referral' and buyer_org_id = tt.oid('B')), 3, 'H29 hand-offs for R1, R2, R3 produce three enquiries');

-- no direct writes
select tt.act('tt_rec');
select throws_ok($$ insert into public.referral_handoffs (referral_id, enquiry_id, opened_by) values (tt.oid('R1'), tt.oid('N1'), tt.uid('tt_rec')) $$, '42501', null, 'H30 authenticated cannot insert hand-off rows');
select throws_ok($$ insert into public.enquiries (buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by)
  values (tt.oid('B'), tt.oid('O'), 'referral', 'direct insert', tt.oid('O'), tt.uid('tt_rec')) $$, '42501', null, 'H31 authenticated cannot insert enquiries directly');
select tt.pg();
select is((select count(*)::int from public.referral_suggestions where status = 'recipient_accepted' and id in (tt.oid('R1'), tt.oid('R2'), tt.oid('R3'))), 3, 'H32 hand-off does not change the referral record');
select tt.act('tt_rec');
select is((select count(*)::int from public.referral_handoffs where referral_id = tt.oid('R1')), 1, 'H33 the recipient can read its own hand-off row');
select tt.act('tt_buyer');
select is((select count(*)::int from public.referral_handoffs where referral_id = tt.oid('R1')), 1, 'H34 the customer can read the hand-off row');
select tt.pg();
select is((select (details ->> 'reused')::boolean from public.audit_log where action = 'referral.enquiry_opened' and entity_id = tt.oid('R1')::text order by id limit 1), false, 'H35 audit records reused=false for a new enquiry');
-- a recipient the customer already talks to (reused enquiry), and one whose existing enquiry is blocked
select tt.pg();
insert into public.enquiries (buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by)
values (tt.oid('B'), tt.oid('O4'), 'listing', 'Existing talk four', tt.oid('B'), tt.uid('tt_buyer')),
       (tt.oid('B'), tt.oid('O5'), 'listing', 'Existing talk five', tt.oid('B'), tt.uid('tt_buyer'));
update public.enquiries set status = 'blocked' where topic = 'Existing talk five';
select tt.act('tt_ref');
select tt.reg('R4', public.propose_referral(tt.id('E1'), tt.oid('O4')));
select tt.reg('R5', public.propose_referral(tt.id('E1'), tt.oid('O5')));
select tt.act('tt_buyer');
select public.respond_to_referral(tt.oid('R4'), true);
select public.respond_to_referral(tt.oid('R5'), true);
select tt.act('tt_rec4');
select public.respond_to_referral(tt.oid('R4'), true);
select tt.act('tt_rec5');
select public.respond_to_referral(tt.oid('R5'), true);
select tt.act('tt_rec4');
select is((public.open_referral_enquiry(tt.oid('R4')) ->> 'created')::boolean, false, 'H36 an existing open enquiry with the recipient is reused, not duplicated');
select tt.pg();
select is((select count(*)::int from public.audit_log where action = 'referral.enquiry_opened' and entity_id = tt.oid('R4')::text and (details ->> 'reused')::boolean), 1, 'H37 the reuse is audited with reused=true');
select tt.act('tt_rec5');
select throws_ok($$ select public.open_referral_enquiry(tt.oid('R5')) $$, 'PT409', 'invalid_referral', 'H38 a blocked existing enquiry with the recipient stops the hand-off');
select tt.pg();
select * from finish();
rollback;
