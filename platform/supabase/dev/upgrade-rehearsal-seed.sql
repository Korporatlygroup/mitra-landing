-- LOCAL ONLY. Representative, non-production, synthetic data for the Phase 1-6 -> Phase 7 upgrade rehearsal.
-- Run against a disposable local database that is migrated only up to 20260701000153. Never run against a hosted project.
-- It creates users, organisations of every type, memberships with several roles, a published business listing, a buyer
-- request, an enquiry with messages, a verification claim, notifications, a partner profile and a sourcing RFQ, then
-- writes a per-table fingerprint to rehearsal.before so the upgrade can be checked row for row.
begin;
create schema if not exists rehearsal;
create table rehearsal.ids (k text primary key, v uuid);
grant usage on schema rehearsal to public;
grant select on rehearsal.ids to public;

create function rehearsal.mkuser(p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', p_name || '@rehearsal.test', now(), '{}'::jsonb,
    '{"consents":{"terms":"2026-07","privacy":"2026-07"}}'::jsonb, now(), now());
  insert into rehearsal.ids values ('u_' || p_name, v);
  return v;
end $$;

create function rehearsal.id(k text) returns uuid language sql stable as $$ select v from rehearsal.ids where ids.k = $1 $$;

do $$
declare
  u_admin uuid := rehearsal.mkuser('admin');
  u_seller uuid := rehearsal.mkuser('seller');
  u_staff uuid := rehearsal.mkuser('seller_staff');
  u_buyer uuid := rehearsal.mkuser('buyer');
  u_partner uuid := rehearsal.mkuser('partner');
  u_idle uuid := rehearsal.mkuser('idle');
  o_mitra uuid; o_seller uuid; o_buyer uuid; o_partner uuid; v_cat uuid; v_req uuid; v_enq uuid;
begin
  insert into public.organisations (type, name, created_by) values ('mitra', 'INOK Operations (rehearsal)', u_admin) returning id into o_mitra;
  insert into public.memberships (org_id, user_id, role) values (o_mitra, u_admin, 'admin_super');
  insert into public.organisations (type, name, created_by) values ('business', 'Rehearsal Kedai', u_seller) returning id into o_seller;
  insert into public.memberships (org_id, user_id, role) values (o_seller, u_seller, 'owner'), (o_seller, u_staff, 'staff');
  insert into public.organisations (type, name, created_by) values ('buyer', 'Rehearsal Buyer', u_buyer) returning id into o_buyer;
  insert into public.memberships (org_id, user_id, role) values (o_buyer, u_buyer, 'owner');
  insert into public.organisations (type, name, created_by) values ('partner', 'Rehearsal Partner', u_partner) returning id into o_partner;
  insert into public.memberships (org_id, user_id, role) values (o_partner, u_partner, 'owner');
  insert into rehearsal.ids values ('o_mitra', o_mitra), ('o_seller', o_seller), ('o_buyer', o_buyer), ('o_partner', o_partner);

  select id into v_cat from public.business_categories order by sort limit 1;
  insert into public.business_profiles (org_id, business_name, category_id, description, state, district)
    values (o_seller, 'Rehearsal Kedai', v_cat, 'Synthetic business used to prove the upgrade keeps data.', 'Selangor', 'Shah Alam');
  insert into public.business_listings (org_id, slug, live_status, live_name, live_category_id, live_state, live_headline, live_description, live_version, published_at, review_status)
    values (o_seller, 'rehearsal-kedai', 'published', 'Rehearsal Kedai', v_cat, 'Selangor', 'Synthetic headline', 'Synthetic description', 1, now(), 'approved');
  insert into public.verification_claims (org_id, claim_type, status, version, snapshot, submitted_at, submitted_by)
    select o_seller, t.t, 'submitted', 1, '{"synthetic":true}'::jsonb, now(), u_seller from (select (enum_range(null::public.claim_type))[1] as t) t;

  insert into public.buyer_requests (buyer_org_id, created_by, idempotency_key, category_id, title, description, target_state, quantity, unit, status, version, submitted_at, expires_at)
    values (o_buyer, u_buyer, 'rehearsal-key-0001', v_cat, 'Rehearsal request for cotton', 'Synthetic buyer request.', 'Selangor', 40, 'kg', 'open', 1, now(), now() + interval '30 days')
    returning id into v_req;
  insert into public.enquiries (buyer_org_id, seller_org_id, buyer_request_id, origin, topic, opening_note, opened_by_org_id, created_by)
    values (o_buyer, o_seller, v_req, (enum_range(null::public.enquiry_origin))[1], 'Rehearsal enquiry', 'Synthetic note', o_buyer, u_buyer) returning id into v_enq;
  insert into public.enquiry_messages (enquiry_id, sender_user_id, sender_org_id, body, client_key)
    values (v_enq, u_buyer, o_buyer, 'Hello from the buyer (synthetic).', 'rehearsal-msg-01'),
           (v_enq, u_seller, o_seller, 'Hello from the seller (synthetic).', 'rehearsal-msg-02');
  insert into public.notifications (user_id, org_id, kind, entity_type, entity_id)
    values (u_seller, o_seller, 'enquiry.opened', 'enquiry', v_enq), (u_buyer, o_buyer, 'listing.approved', 'listing', o_seller);

  insert into public.partner_profiles (org_id, status, display_name) values (o_partner, 'approved', 'Rehearsal Partner');
  insert into rehearsal.ids values ('req', v_req), ('enq', v_enq);
end $$;

-- sourcing RFQ through the real RPC, as the buyer
select set_config('request.jwt.claims', json_build_object('sub', rehearsal.id('u_buyer'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select public.create_sourcing_rfq(rehearsal.id('o_buyer'), 'rehearsal-rfq-key',
  '[{"name":"Cotton rolls","unit":"rolls","quantity":"10.000","specification":"White"}]'::jsonb,
  array[rehearsal.id('o_partner')], 'Selangor', 'Shah Alam', current_date + 30, 'Synthetic rehearsal request');
reset role;

-- Fingerprint every table that exists now: row count and an order-independent hash of the whole row.
create table rehearsal.before (tbl text primary key, n bigint not null, h text not null, cols text[] not null);
do $$
declare r record; n bigint; h text; c text[];
begin
  for r in select c.oid, n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'private') and c.relkind = 'r' order by 1, 2 loop
    select array_agg(a.attname::text order by a.attnum) into c from pg_attribute a where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped;
    execute format('select count(*), coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), ''empty'') from %I.%I t', r.nspname, r.relname) into n, h;
    insert into rehearsal.before values (r.nspname || '.' || r.relname, n, h, c);
  end loop;
end $$;
commit;
select count(*) as tables, sum(n) as rows from rehearsal.before;
select tbl, n from rehearsal.before where n > 0 and tbl not like 'private.%' order by n desc limit 15;
