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
select plan(34);
select tt.mkuser(n) from unnest(array['tt_buyer','tt_seller','tt_other','tt_viewer','tt_mod']) n;
select tt.reg('B',tt.mkorg('buyer','Buyer Test','tt_buyer'));
select tt.reg('S',tt.mkorg('business','Seller Test','tt_seller'));
select tt.reg('O',tt.mkorg('business','Other Test','tt_other'));
insert into public.business_profiles(org_id,business_name,category_id)
select tt.oid('O'),'Other Test',id from public.business_categories order by id limit 1;
insert into public.business_listings(org_id,slug,live_status) values(tt.oid('O'),'other-test','published');
insert into public.enquiries(buyer_org_id,seller_org_id,origin,topic,opened_by_org_id,created_by)
values(tt.oid('B'),tt.oid('S'),'listing','Synthetic uniforms',tt.oid('B'),tt.uid('tt_buyer')) returning id;
insert into tt.ids(label,id) select 'E',id from public.enquiries where topic='Synthetic uniforms';
select tt.act('tt_other');
select is((select count(*)::int from public.enquiries where id=tt.id('E')),0,'other org cannot read enquiry');
select throws_ok($$ select public.post_enquiry_message(tt.id('E'),'Unrelated message','other-key-123') $$,'PT404',null,'other org cannot post message');
select tt.act('tt_seller');
select tt.reg('M',public.post_enquiry_message(tt.id('E'),'We can make the uniforms.','seller-key-123'));
select is((select count(*)::int from public.enquiry_messages where enquiry_id=tt.id('E')),1,'seller message persists');
select is(public.post_enquiry_message(tt.id('E'),'We can make the uniforms.','seller-key-123'),tt.oid('M'),'message retry returns same id');
select is((select count(*)::int from public.enquiry_messages where enquiry_id=tt.id('E')),1,'retry does not duplicate');
select tt.reg('Q',public.save_quote_draft(tt.id('E'),jsonb_build_object('currency','MYR','scope','100 uniforms','tax_treatment','Tax included as stated','delivery_timing','Within three weeks','valid_until',(now()+interval '7 days')::text,'delivery_fee','5.00','tax_amount','0.00','lines',jsonb_build_array(jsonb_build_object('description','Uniforms','quantity','2.500','unit','pieces','unit_price','3.33'))),0));
select tt.act('tt_buyer');
select is((select count(*)::int from public.quotation_drafts where quotation_id=tt.oid('Q')),0,'buyer cannot read seller draft');
select tt.act('tt_seller');
select tt.reg('V1',public.send_quote_version(tt.oid('Q'),0));
select is((select total from public.quotation_versions where id=tt.oid('V1')),13.33::numeric,'server computes rounded total');
select tt.pg();
select throws_ok($$ update public.quotation_versions set total=0 where id=tt.oid('V1') $$,'PT409',null,'sent quote version is immutable');
select tt.act('tt_other');
select is((select count(*)::int from public.quotations where id=tt.oid('Q')),0,'other org cannot read quote');
select tt.act('tt_seller');
select throws_ok($$ select public.respond_to_quote(tt.oid('Q'),tt.oid('V1'),'accept',null,1) $$,'PT403',null,'seller cannot accept');
select tt.act('tt_buyer');
select is(public.respond_to_quote(tt.oid('Q'),tt.oid('V1'),'request_revision','Please add shirts',1),'revision_requested','buyer requests revision');
select throws_ok($$ select public.respond_to_quote(tt.oid('Q'),tt.oid('V1'),'accept',null,1) $$,'PT409',null,'stale version cannot be accepted');
select tt.act('tt_seller');
select public.save_quote_draft(tt.id('E'),jsonb_build_object('currency','MYR','scope','100 uniforms and shirts','tax_treatment','Tax included as stated','delivery_timing','Within three weeks','valid_until',(now()+interval '7 days')::text,'delivery_fee','5.00','tax_amount','0.00','lines',jsonb_build_array(jsonb_build_object('description','Uniforms and shirts','quantity','3','unit','pieces','unit_price','3.33'))),2);
select tt.reg('V2',public.send_quote_version(tt.oid('Q'),3));
select tt.act('tt_buyer');
select throws_ok($$ select public.respond_to_quote(tt.oid('Q'),tt.oid('V1'),'accept',null,4) $$,'PT409',null,'superseded version cannot be accepted');
select is(public.respond_to_quote(tt.oid('Q'),tt.oid('V2'),'accept',null,4),'accepted','buyer accepts latest');
select tt.act('tt_other');
select is((select count(*)::int from public.lead_activities where enquiry_id=tt.id('E')),0,'other org cannot read seller notes');
select tt.addm(tt.oid('S'),'tt_viewer','viewer');
select tt.act('tt_viewer');
select is((select count(*)::int from public.lead_activities where enquiry_id=tt.id('E')),0,'seller viewer cannot read private lead notes');
select tt.act('tt_other');
select is((select count(*)::int from public.referral_suggestions where enquiry_id=tt.id('E')),0,'recipient sees no referral before buyer consent');
select tt.act('tt_seller');
select tt.reg('R',public.propose_referral(tt.id('E'),tt.oid('O')));
select is(public.propose_referral(tt.id('E'),tt.oid('O')),tt.oid('R'),'referral retry is idempotent');
select tt.act('tt_other');
select is((select count(*)::int from public.referral_suggestions where id=tt.oid('R')),0,'recipient cannot see pending buyer decision');
select throws_ok($$ select public.respond_to_referral(tt.oid('R'),true) $$,'PT404',null,'recipient cannot accept before consent');
select tt.act('tt_buyer');
select is(public.respond_to_referral(tt.oid('R'),true),'accepted','buyer consents to referral');
select tt.act('tt_other');
select is((select count(*)::int from public.referral_suggestions where id=tt.oid('R')),1,'recipient sees consented referral');
select is(public.respond_to_referral(tt.oid('R'),true),'accepted','recipient accepts referral');
select is((select count(*)::int from public.enquiries where origin='referral'),0,'Phase 4 leaves enquiry creation to the Phase 3 contract');
select tt.act('tt_buyer');
select tt.reg('REV',public.submit_business_review(tt.id('E'),5,'Seller provided a clear synthetic quotation.'));
select tt.act('tt_seller');
select is((select count(*)::int from public.business_reviews where id=tt.oid('REV')),0,'seller cannot read unmoderated review text');
select tt.pg();
select tt.reg('MITRA',coalesce((select id from public.organisations where type='mitra' limit 1),tt.mkorg('mitra','MITRA Test','tt_mod','admin_review')));
insert into public.memberships(org_id,user_id,role) values(tt.oid('MITRA'),tt.uid('tt_mod'),'admin_review') on conflict(org_id,user_id) do nothing;
select tt.addm(tt.oid('MITRA'),'tt_seller','admin_review');
select tt.act('tt_seller','aal2');
select throws_ok($$ select public.moderate_business_review(tt.oid('REV'),'published','Reviewed content') $$,'PT403',null,'involved moderator cannot publish own seller review');
select tt.act('tt_mod','aal2');
select public.moderate_business_review(tt.oid('REV'),'published','Reviewed content');
select is((select status::text from public.business_reviews where id=tt.oid('REV')),'published','independent moderator can publish review');
select tt.act('tt_other');
select is((select count(*)::int from public.business_reviews where id=tt.oid('REV')),0,'unrelated authenticated user cannot read buyer identity on review row');
select tt.pg();
insert into public.business_profiles(org_id,business_name,category_id)
select tt.oid('S'),'Seller Test',id from public.business_categories order by id limit 1;
insert into public.business_listings(org_id,slug,live_status) values(tt.oid('S'),'seller-test','published');
select tt.anon();
select is((select count(*)::int from public.list_published_business_reviews('seller-test')),1,'anonymous visitors can read only published review content');
select throws_ok($$ select count(*) from public.business_reviews $$,'42501',null,'anonymous visitors cannot read review table directly');
select tt.act('tt_seller');
select is((public.seller_lead_metrics(tt.oid('S'))->>'quotes_sent')::int,2,'seller analytics counts persisted quotation versions');
select public.respond_to_business_review(tt.oid('REV'),'Thank you for this synthetic feedback.');
select tt.anon();
select is((select seller_response from public.list_published_business_reviews('seller-test')),null::text,'pending seller response stays out of public readout');
select tt.act('tt_seller','aal2');
select throws_ok($$ select public.moderate_review_response(tt.oid('REV'),true,'Looks appropriate') $$,'PT403',null,'involved moderator cannot approve seller response');
select tt.act('tt_mod','aal2');
select public.moderate_review_response(tt.oid('REV'),true,'Looks appropriate');
select tt.anon();
select is((select seller_response from public.list_published_business_reviews('seller-test')),'Thank you for this synthetic feedback.','approved seller response appears publicly');
select tt.pg();
select * from finish();
rollback;
