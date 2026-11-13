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
grant select, insert on tt.o to public;
create function tt.oid(p_label text) returns uuid language sql stable as $$ select id from tt.o where label = p_label $$;
create function tt.reg(p_label text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.o (label, id) values (p_label, p_id);
  return p_id;
end $$;

-- Registry of every synthetic row, per "world", so a row can still be counted after its organisation is gone.
create table tt.rows (world text not null, tbl text not null, pk text not null, id uuid not null);
create function tt.rg(p_world text, p_tbl text, p_pk text, p_id uuid) returns uuid language plpgsql as $$
begin
  insert into tt.rows (world, tbl, pk, id) values (p_world, p_tbl, p_pk, p_id);
  return p_id;
end $$;
-- registered rows of a table that still exist / were registered
create function tt.alive(p_world text, p_tbl text) returns int language plpgsql as $$
declare v_pk text; v_n int;
begin
  select pk into v_pk from tt.rows where world = p_world and tbl = p_tbl limit 1;
  execute format('select count(*)::int from public.%I t where t.%I in (select id from tt.rows where world = %L and tbl = %L)', p_tbl, v_pk, p_world, p_tbl) into v_n;
  return v_n;
end $$;
create function tt.total(p_world text, p_tbl text) returns int language sql stable as $$
  select count(*)::int from tt.rows where world = p_world and tbl = p_tbl $$;
create function tt.all_alive(p_world text) returns boolean language sql as $$
  select coalesce(bool_and(tt.alive(world, tbl) = tt.total(world, tbl)), false)
  from (select distinct world, tbl from tt.rows where world = p_world) s $$;
-- how many registered rows of the listed tables still exist
create function tt.alive_sum(p_world text, p_tbls text[]) returns int language sql as $$
  select coalesce(sum(tt.alive(p_world, t)), 0)::int from unnest(p_tbls) t $$;

create table tt.n (label text primary key, n int not null);

-- One world: buyer org B, seller/referrer org S1, referred seller org S2, and a row in every Phase 1-4 table that refers to them.
create function tt.build(w text) returns void language plpgsql as $$
declare
  v_cat uuid := (select id from public.business_categories order by id limit 1);
  b uuid; s1 uuid; s2 uuid; ub uuid; u1 uuid; u2 uuid;
  req uuid; e1 uuid; e2 uuid; q uuid; qv uuid; ref uuid; clm uuid; doc uuid;
begin
  perform tt.mkuser(w || '_ub'); perform tt.mkuser(w || '_u1'); perform tt.mkuser(w || '_u2');
  b := tt.reg(w || 'B', tt.mkorg('buyer', w || ' Buyer', w || '_ub'));
  s1 := tt.reg(w || 'S1', tt.mkorg('business', w || ' Seller One', w || '_u1'));
  s2 := tt.reg(w || 'S2', tt.mkorg('business', w || ' Seller Two', w || '_u2'));
  ub := tt.uid(w || '_ub'); u1 := tt.uid(w || '_u1'); u2 := tt.uid(w || '_u2');
  perform tt.pg();
  perform tt.rg(w, 'organisations', 'id', x) from unnest(array[b, s1, s2]) x;

  -- profiles, listings, services, portfolio, private data, representatives, verification
  insert into public.business_profiles (org_id, business_name, category_id) values (s1, w || ' One', v_cat), (s2, w || ' Two', v_cat);
  perform tt.rg(w, 'business_profiles', 'org_id', x) from unnest(array[s1, s2]) x;
  insert into public.business_listings (org_id, slug, live_status) values (s1, 'tt-' || lower(w) || '-one', 'published'), (s2, 'tt-' || lower(w) || '-two', 'published');
  perform tt.rg(w, 'business_listings', 'org_id', x) from unnest(array[s1, s2]) x;
  insert into public.business_private (org_id) values (s1);
  perform tt.rg(w, 'business_private', 'org_id', s1);
  insert into public.business_representatives (org_id, full_name, role_title) values (s1, 'Synthetic Person', 'director');
  perform tt.rg(w, 'business_representatives', 'org_id', s1);
  with ins as (
    insert into public.business_services (org_id, category_id, name, nationwide) values (s1, v_cat, 'Svc', true) returning id) insert into tt.rows select w, 'business_services', 'id', id from ins;
  with ins as (
    insert into public.business_portfolio (org_id, title) values (s1, 'Job') returning id) insert into tt.rows select w, 'business_portfolio', 'id', id from ins;
  insert into public.verification_claims (org_id, claim_type) values (s1, 'business_registration') returning id into clm;
  perform tt.rg(w, 'verification_claims', 'id', clm);
  insert into public.verification_documents (org_id, claim_id, doc_type, display_name, mime_type, size_bytes, sha256, storage_path)
  values (s1, clm, 'ssm_certificate', 'doc.pdf', 'application/pdf', 100, repeat('a', 64), 'tt/' || w || '/doc.pdf') returning id into doc;
  perform tt.rg(w, 'verification_documents', 'id', doc);
  insert into public.verification_claim_documents (claim_id, version, document_id) values (clm, 1, doc);
  perform tt.rg(w, 'verification_claim_documents', 'claim_id', clm);

  -- a request with private data, invitation matches, reports and notifications; two enquiries
  insert into public.buyer_requests (buyer_org_id, created_by, title, description, category_id, target_state, status, expires_at)
  values (b, ub, w || ' Uniforms', 'Synthetic description for the erasure test.', v_cat, 'Selangor', 'open', now() + interval '10 days') returning id into req;
  perform tt.rg(w, 'buyer_requests', 'id', req);
  insert into public.buyer_request_private (request_id) values (req);
  perform tt.rg(w, 'buyer_request_private', 'request_id', req);
  insert into public.enquiries (buyer_org_id, seller_org_id, buyer_request_id, origin, topic, opened_by_org_id, created_by)
  values (b, s1, req, 'request_invitation', w || ' enquiry one', s1, u1) returning id into e1;
  insert into public.enquiries (buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by)
  values (b, s2, 'referral', w || ' enquiry two', s2, u2) returning id into e2;
  perform tt.rg(w, 'enquiries', 'id', x) from unnest(array[e1, e2]) x;
  with ins as (
    insert into public.request_seller_matches (request_id, seller_org_id, enquiry_id) values (req, s1, e1), (req, s2, null) returning id) insert into tt.rows select w, 'request_seller_matches', 'id', id from ins;
  with ins as (
    insert into public.content_reports (target_type, listing_org_id, reporter_user_id, reason) values ('listing', s1, ub, 'spam') returning id) insert into tt.rows select w, 'content_reports', 'id', id from ins;
  with ins as (
    insert into public.content_reports (target_type, request_id, reporter_user_id, reason) values ('request', req, u1, 'spam') returning id) insert into tt.rows select w, 'content_reports', 'id', id from ins;
  with ins as (
    insert into public.notifications (user_id, org_id, kind) values (ub, b, 'tt'), (u1, s1, 'tt'), (u2, s2, 'tt') returning id) insert into tt.rows select w, 'notifications', 'id', id from ins;

  -- Phase 4: messages from both sides, a sent quote (draft, version, lines), lead notes, a referral with its hand-off, a review
  with ins as (
    insert into public.enquiry_messages (enquiry_id, sender_user_id, sender_org_id, body) values
      (e1, ub, b, 'buyer says hi'), (e1, u1, s1, 'seller says hi'), (e2, u2, s2, 'second seller says hi') returning id) insert into tt.rows select w, 'enquiry_messages', 'id', id from ins;
  insert into public.quotations (enquiry_id, seller_org_id, buyer_org_id, status, created_by) values (e1, s1, b, 'sent', u1) returning id into q;
  perform tt.rg(w, 'quotations', 'id', q);
  insert into public.quotation_drafts (quotation_id, seller_org_id, data) values (q, s1, '{}'::jsonb);
  perform tt.rg(w, 'quotation_drafts', 'quotation_id', q);
  insert into public.quotation_versions (quotation_id, version_number, currency, scope_text, tax_treatment, delivery_timing, valid_until, subtotal, delivery_fee, tax_amount, total)
  values (q, 1, 'MYR', 'Synthetic scope', 'No tax', 'Two weeks', now() + interval '10 days', 100, 10, 0, 110) returning id into qv;
  perform tt.rg(w, 'quotation_versions', 'id', qv);
  update public.quotations set current_version_id = qv, version = 1 where id = q;
  with ins as (
    insert into public.quotation_line_items (quote_version_id, description, quantity, unit, unit_price, line_total, sort_order)
    values (qv, 'Item A', 2, 'pcs', 50, 100, 0), (qv, 'Item B', 1, 'pcs', 0, 0, 1) returning id) insert into tt.rows select w, 'quotation_line_items', 'id', id from ins;
  with ins as (
    insert into public.lead_activities (enquiry_id, seller_org_id, actor_user_id, stage) values (e1, s1, u1, 'contacted'), (e1, s1, u1, 'quoted') returning id) insert into tt.rows select w, 'lead_activities', 'id', id from ins;
  insert into public.referral_suggestions (enquiry_id, referrer_seller_org_id, proposed_seller_org_id, buyer_org_id, status, buyer_consented_at, recipient_accepted_at, created_by)
  values (e1, s1, s2, b, 'recipient_accepted', now(), now(), u1) returning id into ref;
  perform tt.rg(w, 'referral_suggestions', 'id', ref);
  insert into public.referral_handoffs (referral_id, enquiry_id, opened_by) values (ref, e2, u2);
  perform tt.rg(w, 'referral_handoffs', 'referral_id', ref);
  with ins as (
    insert into public.business_reviews (enquiry_id, buyer_org_id, seller_org_id, author_user_id, rating, review_text)
    values (e1, b, s1, ub, 5, 'Synthetic review text for the test.') returning id) insert into tt.rows select w, 'business_reviews', 'id', id from ins;
end $$;

select plan(41);
select tt.build(w) from unnest(array['U', 'S', 'R', 'B', 'C']) w;

-- 0. Guard: no Phase 1-4 foreign key to organisations / auth.users / enquiries / buyer_requests / quotations may block a delete.
select is((select count(*)::int from pg_constraint c
           where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confdeltype in ('a', 'r')
             and c.confrelid in ('public.organisations'::regclass, 'auth.users'::regclass, 'public.enquiries'::regclass,
                                 'public.buyer_requests'::regclass, 'public.quotations'::regclass, 'public.referral_suggestions'::regclass,
                                 'public.business_listings'::regclass, 'public.business_profiles'::regclass)
             ),
          0, 'E0 no foreign key from a public table to organisations, users, enquiries or requests blocks deletion (NO ACTION / RESTRICT)');
select ok((select coalesce(array_agg(distinct a.attname::text), '{}'::text[]) from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
           where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace and c.confdeltype = 'n')
          @> array['accepted_by', 'actor_user_id', 'author_user_id', 'created_by', 'invited_by', 'sender_user_id']::text[],
          'E0b the Phase 1-4 authorship columns that point at auth.users are ON DELETE SET NULL (later phases may add more)');
select is((select bool_and(tt.all_alive(w)) from unnest(array['U', 'S', 'R', 'B', 'C']) w), true, 'E0c the synthetic worlds are fully built');
insert into tt.n select 'auditR', count(*) from public.audit_log where org_id = tt.oid('RS1');
insert into tt.n select 'auditB', count(*) from public.audit_log where org_id = tt.oid('BB');
create table tt.audit_before (label text not null, id bigint not null, action text not null, at timestamptz not null);
insert into tt.audit_before select 'auditR', id, action, at from public.audit_log where org_id = tt.oid('RS1');
insert into tt.audit_before select 'auditB', id, action, at from public.audit_log where org_id = tt.oid('BB');
select is((select count(*)::int from tt.n where n > 0), 2, 'E0d the organisations have audit history before erasure');

-- A. Users who created things are deleted (organisations stay).
select lives_ok($$ delete from auth.users where id = tt.uid('U_u1') $$, 'EA1 deleting the seller user who sent messages, quotes, lead notes and a referral succeeds');
select lives_ok($$ delete from auth.users where id = tt.uid('U_ub') $$, 'EA2 deleting the buyer user who sent messages, wrote a review and reported content succeeds');
select lives_ok($$ delete from auth.users where id = tt.uid('U_u2') $$, 'EA3 deleting the referred seller user who sent a message succeeds');
select is(tt.alive_sum('U', array['organisations', 'enquiries', 'enquiry_messages', 'quotations', 'quotation_versions', 'quotation_line_items',
  'quotation_drafts', 'lead_activities', 'referral_suggestions', 'referral_handoffs', 'business_reviews', 'buyer_requests', 'request_seller_matches', 'content_reports']),
  (select sum(tt.total('U', t))::int from unnest(array['organisations', 'enquiries', 'enquiry_messages', 'quotations', 'quotation_versions', 'quotation_line_items',
  'quotation_drafts', 'lead_activities', 'referral_suggestions', 'referral_handoffs', 'business_reviews', 'buyer_requests', 'request_seller_matches', 'content_reports']) t),
  'EA4 every business record of the deleted users is retained (the other side keeps its conversation, quote, notes, referral and review)');
select is((select count(*)::int from public.enquiry_messages where id in (select id from tt.rows where world = 'U' and tbl = 'enquiry_messages') and sender_user_id is null), 3,
  'EA5 enquiry_messages.sender_user_id is anonymised to NULL');
select is((select count(*)::int from public.quotations where id in (select id from tt.rows where world = 'U' and tbl = 'quotations') and created_by is null), 1, 'EA6 quotations.created_by is NULL');
select is((select count(*)::int from public.lead_activities where id in (select id from tt.rows where world = 'U' and tbl = 'lead_activities') and actor_user_id is null), 2, 'EA7 lead_activities.actor_user_id is NULL');
select is((select count(*)::int from public.referral_suggestions where id in (select id from tt.rows where world = 'U' and tbl = 'referral_suggestions') and created_by is null), 1, 'EA8 referral_suggestions.created_by is NULL');
select is((select count(*)::int from public.business_reviews where id in (select id from tt.rows where world = 'U' and tbl = 'business_reviews') and author_user_id is null), 1, 'EA9 business_reviews.author_user_id is NULL');
select is(tt.alive('U', 'notifications'), 0, 'EA10 the deleted users'' notifications are removed');
select is((select count(*)::int from public.quotation_versions where id in (select id from tt.rows where world = 'U' and tbl = 'quotation_versions')), 1, 'EA11 the sent quote snapshot is untouched');

-- B. A referred (proposed) seller organisation is erased: its referral, hand-off and enquiry go; the referrer and buyer keep theirs.
select lives_ok($$ delete from public.organisations where id = tt.oid('SS2') $$, 'EB1 deleting a seller organisation that was referred to succeeds');
select is(tt.alive_sum('S', array['referral_suggestions', 'referral_handoffs']), 0, 'EB2 the referral and its hand-off are gone');
select is(tt.alive('S', 'enquiries'), 1, 'EB3 only the enquiry with the erased organisation is gone; the buyer and referrer keep theirs');
select is(tt.alive('S', 'enquiry_messages'), 2, 'EB4 the surviving enquiry keeps its messages');
select is(tt.alive_sum('S', array['quotations', 'quotation_versions', 'quotation_line_items', 'quotation_drafts', 'lead_activities', 'business_reviews']), 1 + 1 + 2 + 1 + 2 + 1,
  'EB5 the surviving enquiry keeps its quote (with versions and lines), lead notes and review');
select is(tt.alive_sum('S', array['organisations', 'business_listings', 'business_profiles', 'buyer_requests', 'verification_claims', 'verification_documents',
  'verification_claim_documents']), 2 + 1 + 1 + 1 + 1 + 1 + 1, 'EB6 the buyer, the referrer and its listing, request and verification records are intact (only the erased organisation''s go)');
select is(tt.alive('S', 'request_seller_matches'), 1, 'EB7 the erased organisation''s request match is removed, the referrer''s stays');

-- C. A seller (and referrer) organisation is erased: its enquiry with all that hangs on it goes, the other enquiry stays.
select lives_ok($$ delete from public.organisations where id = tt.oid('RS1') $$,
  'EC1 deleting a seller organisation with a sent quote, referral, review, lead notes and verification documents succeeds');
select is(tt.alive_sum('R', array['enquiry_messages', 'quotations', 'quotation_drafts', 'quotation_versions', 'quotation_line_items', 'lead_activities',
  'referral_suggestions', 'referral_handoffs', 'business_reviews']), 1, 'EC2 the erased organisation''s conversation, quote (versions and lines), notes, referral, hand-off and review are gone (one message on the other enquiry stays)');
select is(tt.alive('R', 'enquiries'), 1, 'EC3 the buyer''s other enquiry (with the referred seller) survives');
select is(tt.alive_sum('R', array['business_profiles', 'business_listings', 'business_private', 'business_representatives', 'business_services', 'business_portfolio',
  'verification_claims', 'verification_documents', 'verification_claim_documents']), 2, 'EC4 its profile, listing, services, portfolio, private data and verification records are gone; the other seller''s listing stays');
select is(tt.alive_sum('R', array['organisations', 'buyer_requests', 'buyer_request_private']), 2 + 1 + 1, 'EC5 the buyer and the referred seller, and the buyer''s request, are intact');
select is(tt.alive('R', 'request_seller_matches'), 1, 'EC6 only the match for the erased organisation is removed');
select is(tt.alive('R', 'content_reports'), 1, 'EC7 the report on the erased listing is removed, the report on the buyer''s request stays');
select is((select count(*)::int from tt.audit_before b join public.audit_log a using (id)
           where b.label = 'auditR' and a.action = b.action and a.at = b.at
             and a.org_id is null and a.details = '{}'::jsonb),
          (select n from tt.n where label = 'auditR'),
  'EC8 the erased organisation''s audit actions and times survive without its identifier or details');

-- D. A buyer organisation is erased: its requests and every enquiry, quote, review and referral on them go; the sellers stay.
select lives_ok($$ delete from public.organisations where id = tt.oid('BB') $$, 'ED1 deleting a buyer organisation with requests, enquiries, quotes and reviews succeeds');
select is(tt.alive_sum('B', array['enquiries', 'enquiry_messages', 'quotations', 'quotation_drafts', 'quotation_versions', 'quotation_line_items', 'lead_activities',
  'referral_suggestions', 'referral_handoffs', 'business_reviews', 'buyer_requests', 'buyer_request_private', 'request_seller_matches']), 0,
  'ED2 everything that hung on the buyer''s enquiries and requests is gone');
select is(tt.alive_sum('B', array['organisations', 'business_listings', 'business_profiles', 'business_services', 'business_portfolio', 'verification_claims',
  'verification_documents', 'verification_claim_documents', 'business_private', 'business_representatives']), 2 + 2 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1,
  'ED3 the two sellers, their listings and verification records are intact');
select is(tt.alive('B', 'content_reports'), 1, 'ED4 the report on the seller''s listing stays, the report on the buyer''s request is gone');
select is((select count(*)::int from tt.audit_before b join public.audit_log a using (id)
           where b.label = 'auditB' and a.action = b.action and a.at = b.at
             and a.org_id is null and a.details = '{}'::jsonb),
          (select n from tt.n where label = 'auditB'),
  'ED5 the buyer organisation''s audit actions and times survive without its identifier or details');

-- E. Unrelated organisations are untouched by all of the above.
select is(tt.all_alive('C'), true, 'EE1 an unrelated world (buyer, two sellers, quote, referral, review) is completely intact');
select is((select count(*)::int from public.enquiry_messages where id in (select id from tt.rows where world = 'C' and tbl = 'enquiry_messages') and sender_user_id is not null), 3,
  'EE2 its authorship links are untouched');

-- F. Immutability is not weakened: a sent quote can still never be changed or deleted directly.
select throws_ok($$ delete from public.quotation_versions where id in (select id from tt.rows where world = 'C' and tbl = 'quotation_versions') $$, 'PT409', 'sent_quote_immutable', 'EF1 a quote version cannot be deleted directly');
select throws_ok($$ delete from public.quotation_line_items where id in (select id from tt.rows where world = 'C' and tbl = 'quotation_line_items') $$, 'PT409', 'sent_quote_immutable', 'EF2 a quote line cannot be deleted directly');
select throws_ok($$ update public.quotation_versions set scope_text = 'changed text' where id in (select id from tt.rows where world = 'C' and tbl = 'quotation_versions') $$, 'PT409', 'sent_quote_immutable', 'EF3 a quote version cannot be updated');
select is(tt.alive_sum('C', array['quotations', 'quotation_versions', 'quotation_line_items']), 4, 'EF5 the unrelated quote is still whole');

select * from finish();
rollback;
