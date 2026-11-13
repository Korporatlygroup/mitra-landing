begin;
create extension if not exists pgtap with schema extensions;
create schema p6t;
grant usage on schema p6t to public;
create table p6t.ids(k text primary key,v uuid);
grant select on p6t.ids to public;
create function p6t.id(k text) returns uuid language sql stable as $$select v from p6t.ids where ids.k=$1$$;
create function p6t.actor(k text) returns void language plpgsql as $$
declare v uuid;
begin
  reset role;
  select id into v from auth.users where email=k||'@example.test';
  perform set_config('request.jwt.claims',json_build_object('sub',v,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
end $$;
create function p6t.pg() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims','',true); end $$;
create function p6t.create_fixture() returns void language plpgsql as $$
declare k text; u uuid; o uuid;
begin
  foreach k in array array['buyer','partner','other','outsider'] loop
    u:=gen_random_uuid();
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values(u,'authenticated','authenticated',k||'@example.test',now(),'{}',
        '{"consents":{"terms":"2026-07","privacy":"2026-07"}}',now(),now());
    insert into p6t.ids values(k||'_user',u);
  end loop;
  foreach k in array array['buyer','partner','other'] loop
    insert into public.organisations(type,name,created_by)
      values(case when k='buyer' then 'buyer'::public.org_type else 'partner'::public.org_type end,
        'P6 '||k,p6t.id(k||'_user')) returning id into o;
    insert into p6t.ids values(k||'_org',o);
    insert into public.memberships(org_id,user_id,role) values(o,p6t.id(k||'_user'),'owner');
    if k<>'buyer' then insert into public.partner_profiles(org_id,status,display_name)
      values(o,'approved','P6 '||k); end if;
  end loop;
end $$;
select plan(86);
select p6t.create_fixture();
select p6t.actor('buyer');
select lives_ok($$select public.create_sourcing_rfq(p6t.id('buyer_org'),'synthetic-key-01',
  '[{"name":"Cotton rolls","unit":"rolls","quantity":"10.000","specification":"White"}]'::jsonb,
  array[p6t.id('partner_org'),p6t.id('other_org')],'Selangor','Shah Alam',current_date+30,'Synthetic request')$$,
  'buyer creates a custom-product request for two explicitly authorized partners');
select p6t.pg();
insert into p6t.ids select 'rfq',(select id from public.sourcing_rfqs order by created_at desc limit 1);
insert into p6t.ids select 'item',(select id from public.sourcing_rfq_items where rfq_id=p6t.id('rfq'));
select is((select count(*)::int from public.sourcing_rfq_partners where rfq_id=p6t.id('rfq')),2,'both recipients persisted');
select is((select count(*)::int from public.sourcing_rfq_items where rfq_id=p6t.id('rfq')),1,'custom item persisted');
select p6t.actor('buyer');
select is((public.create_sourcing_rfq(p6t.id('buyer_org'),'synthetic-key-01',
  '[{"name":"Cotton rolls","unit":"rolls","quantity":"10.000","specification":"White"}]'::jsonb,
  array[p6t.id('partner_org'),p6t.id('other_org')],'Selangor','Shah Alam',current_date+30,'Synthetic request')->>'created'), 'false',
  'duplicate submission is idempotent');
select throws_ok($$select public.create_sourcing_rfq(p6t.id('buyer_org'),'synthetic-key-01',
  '[{"name":"Different item","unit":"rolls","quantity":"10"}]'::jsonb,
  array[p6t.id('partner_org')],'Selangor')$$,'PT409',null,'idempotency key cannot hide changed payload');
select lives_ok($$select public.send_sourcing_message(p6t.id('rfq'),p6t.id('partner_org'),'Synthetic message')$$,
  'buyer can message an invited partner');
select p6t.actor('partner');
select throws_ok($$select public.send_sourcing_message(p6t.id('rfq'),p6t.id('partner_org'),'Too early')$$,
  'PT409',null,'invited partner cannot message before accepting');
select throws_ok($$select public.submit_sourcing_quote(p6t.id('rfq'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('item'),'unit_price','12.50')),
  0,0,14,'Too early',current_date+30,0)$$,'PT404',null,'invited partner cannot quote before accepting');
select lives_ok($$select public.respond_sourcing_invitation(p6t.id('rfq'),p6t.id('partner_org'),true)$$,
  'partner explicitly accepts assignment');
select p6t.pg();
insert into p6t.ids select 'document',public.service_register_sourcing_document(
  p6t.id('rfq'),p6t.id('partner_org'),p6t.id('partner_user'),'Synthetic.pdf','application/pdf',12,
  repeat('a',64),'sourcing/11111111-1111-4111-8111-111111111111.pdf');
insert into p6t.ids select 'buyer_document',public.service_register_sourcing_document(
  p6t.id('rfq'),p6t.id('partner_org'),p6t.id('buyer_user'),'Buyer.pdf','application/pdf',12,
  repeat('b',64),'sourcing/22222222-2222-4222-8222-222222222222.pdf');
update public.organisations set status='suspended' where id=p6t.id('partner_org');
select p6t.actor('partner');
select is((select count(*)::int from public.sourcing_rfq_documents where rfq_id=p6t.id('rfq')),0,
  'suspended partner loses direct document metadata access');
select throws_ok($$select public.get_sourcing_document_access(p6t.id('document'))$$,'PT404',null,
  'suspended partner cannot download buyer or partner documents');
select p6t.pg();
update public.organisations set status='active' where id=p6t.id('partner_org');
update public.organisations set status='suspended' where id=p6t.id('buyer_org');
select p6t.actor('buyer');
select is((select count(*)::int from public.sourcing_rfq_documents where rfq_id=p6t.id('rfq')),0,
  'suspended buyer loses direct document metadata access');
select throws_ok($$select public.list_sourcing_documents(p6t.id('rfq'),p6t.id('partner_org'))$$,'PT404',null,
  'suspended buyer cannot list thread documents');
select throws_ok($$select public.get_sourcing_document_access(p6t.id('document'))$$,'PT404',null,
  'suspended buyer cannot download thread documents');
select p6t.pg();
update public.organisations set status='active' where id=p6t.id('buyer_org');
update auth.users set banned_until=now()+interval '1 day' where id=p6t.id('buyer_user');
select throws_ok($$select public.service_register_sourcing_document(
  p6t.id('rfq'),p6t.id('partner_org'),p6t.id('buyer_user'),'Banned.pdf','application/pdf',12,
  repeat('c',64),'sourcing/33333333-3333-4333-8333-333333333333.pdf')$$,'PT403',null,
  'service registration refuses a banned buyer user');
update auth.users set banned_until=null where id=p6t.id('buyer_user');
select p6t.actor('partner');
select is(jsonb_array_length(public.list_sourcing_documents(p6t.id('rfq'),p6t.id('partner_org'))),2,
  'accepted partner sees its private attachment');
select is(public.get_sourcing_document_access(p6t.id('document'))->>'mime_type','application/pdf',
  'accepted partner gets audited clean document access');
select p6t.actor('buyer');
select is(jsonb_array_length(public.list_sourcing_documents(p6t.id('rfq'),p6t.id('partner_org'))),2,
  'buyer sees a document in its selected thread');
select p6t.actor('other');
select is((select count(*)::int from public.sourcing_rfq_documents where id=p6t.id('document')),0,
  'other invited partner cannot read document metadata');
select throws_ok($$select public.get_sourcing_document_access(p6t.id('document'))$$,'PT404',null,
  'other partner cannot download private document');
select p6t.actor('partner');
select throws_ok($$select public.remove_sourcing_document(p6t.id('buyer_document'))$$,'PT404',null,
  'partner cannot delete a buyer-uploaded thread document');
select lives_ok($$select public.remove_sourcing_document(p6t.id('document'))$$,
  'partner can remove its own thread document');
select is((select count(*)::int from public.sourcing_rfq_documents where id=p6t.id('document')),0,
  'removed document metadata is gone');
select p6t.pg();
select is((select count(*)::int from private.sourcing_storage_cleanup
  where storage_path='sourcing/11111111-1111-4111-8111-111111111111.pdf'),1,
  'removed private object is queued for retryable cleanup');
update public.sourcing_rfq_partners set status='declined'
  where rfq_id=p6t.id('rfq') and partner_org_id=p6t.id('partner_org');
select p6t.actor('partner');
select is((select count(*)::int from public.sourcing_rfq_documents where id=p6t.id('buyer_document')),0,
  'declined partner loses direct document metadata access');
select throws_ok($$select public.remove_sourcing_document(p6t.id('buyer_document'))$$,'PT404',null,
  'declined partner cannot delete a buyer document by known ID');
select p6t.actor('buyer');
select lives_ok($$select public.remove_sourcing_document(p6t.id('buyer_document'))$$,
  'buyer can clean up its own document after a partner declines');
select p6t.pg();
select is((select count(*)::int from private.sourcing_storage_cleanup
  where storage_path='sourcing/22222222-2222-4222-8222-222222222222.pdf'),1,
  'buyer document cleanup is queued after partner declines');
update public.sourcing_rfq_partners set status='accepted'
  where rfq_id=p6t.id('rfq') and partner_org_id=p6t.id('partner_org');
update public.sourcing_rfq_partners set responded_at=now()-interval '3 days'
  where rfq_id=p6t.id('rfq') and partner_org_id=p6t.id('partner_org');
select is(public.service_send_sourcing_reminders(20),1,
  'authorized accepted partner with no offer receives an operational reminder');
select is((select count(*)::int from public.notifications
  where org_id=p6t.id('partner_org') and kind='sourcing.quote_reminder'),1,
  'reminder is persisted for the authorized partner');
select is(public.service_send_sourcing_reminders(20),0,
  'repeated cron calls do not duplicate a recent reminder');
update private.sourcing_reminder_log set sent_at=now()-interval '8 days'
  where rfq_id=p6t.id('rfq') and partner_org_id=p6t.id('partner_org');
select is(public.service_send_sourcing_reminders(20),1,
  'an unanswered request may be reminded again after seven days');
select p6t.actor('partner');
select is((select count(*)::int from public.sourcing_rfq_messages where rfq_id=p6t.id('rfq')),1,
  'partner can read own thread');
select lives_ok($$select public.send_sourcing_message(p6t.id('rfq'),p6t.id('partner_org'),'Synthetic reply')$$,
  'partner can reply');
select lives_ok($$select public.submit_sourcing_quote(p6t.id('rfq'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('item'),'unit_price','12.50')),
  5.00,1.00,14,'Synthetic terms',current_date+30,0)$$,'partner submits persisted quote');
select p6t.pg();
select is(public.service_send_sourcing_reminders(20),0,
  'a partner that has quoted does not receive a missing-offer reminder');
select p6t.actor('partner');
select throws_ok($$select public.submit_sourcing_quote(p6t.id('rfq'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('item'),'unit_price','12.50')),
  1000000000000.00,0,14,'Too large',current_date+30,0)$$,'PT422',null,
  'SQL rejects charges above the same 12-digit money limit as the pure calculator');
select p6t.pg();
insert into p6t.ids select 'quote',(select id from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq'));
select is((select total from public.sourcing_rfq_quote_revisions where quote_id=p6t.id('quote') and revision=1),129.00::numeric,
  'server computes exact quote total');
select p6t.actor('buyer');
select lives_ok($$select public.propose_sourcing_counter(p6t.id('quote'),120.00,'Could you offer this price?',
  (select version from public.sourcing_rfqs where id=p6t.id('rfq')))$$,'buyer proposes a private counteroffer');
select p6t.pg();
insert into p6t.ids select 'counter',(select id from public.sourcing_rfq_counters where quote_id=p6t.id('quote'));
select p6t.actor('partner');
select lives_ok($$select public.respond_sourcing_counter(p6t.id('counter'),'accept')$$,'partner accepts counteroffer');
select lives_ok($$select public.submit_sourcing_quote(p6t.id('rfq'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('item'),'unit_price','11.50')),
  5.00,0.00,14,'Revised synthetic terms',current_date+30,0)$$,'partner issues a new revision');
select is((select count(*)::int from public.sourcing_rfq_quote_revisions where quote_id=p6t.id('quote')),2,
  'original quote revision retained');
select is((select status from public.sourcing_rfq_counters where id=p6t.id('counter')),'accepted',
  'accepted counter history survives a later revision');
select p6t.actor('buyer');
select lives_ok($$select public.propose_sourcing_counter(p6t.id('quote'),110.00,'Revised offer?',
  (select version from public.sourcing_rfqs where id=p6t.id('rfq')))$$,
  'buyer can counter the latest quote revision');
select p6t.pg();
insert into p6t.ids select 'stale_counter',(select id from public.sourcing_rfq_counters
  where quote_id=p6t.id('quote') and status='open');
select p6t.actor('partner');
select lives_ok($$select public.submit_sourcing_quote(p6t.id('rfq'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('item'),'unit_price','11.00')),
  5.00,0.00,14,'Third synthetic revision',current_date+30,1)$$,
  'partner can revise again while a counter is open');
select is((select status from public.sourcing_rfq_counters where id=p6t.id('stale_counter')),'superseded',
  'new quote revision automatically supersedes older counter');
select throws_ok($$select public.respond_sourcing_counter(p6t.id('stale_counter'),'accept')$$,'PT409',null,
  'partner cannot accept a counter for an old quote revision');
select p6t.actor('buyer');
select lives_ok($$select public.request_sourcing_sample(p6t.id('rfq'),p6t.id('partner_org'),p6t.id('item'),'Synthetic sample')$$,
  'buyer requests a sample');
select p6t.pg();
insert into p6t.ids select 'sample',(select id from public.sourcing_rfq_samples where rfq_id=p6t.id('rfq'));
select p6t.actor('partner');
select lives_ok($$select public.update_sourcing_sample(p6t.id('sample'),'accepted',0)$$,'partner accepts sample');
select p6t.actor('buyer');
select lives_ok($$select public.save_sourcing_template(p6t.id('buyer_org'),'Repeat rolls',
  '[{"name":"Cotton rolls","unit":"rolls","quantity":"10"}]'::jsonb)$$,'buyer saves sourcing template');
select is(jsonb_array_length(public.list_sourcing_templates(p6t.id('buyer_org'))),1,'buyer lists saved template');
select is(jsonb_array_length(public.repeat_sourcing_rfq(p6t.id('rfq'))->'items'),1,
  'repeat sourcing returns editable snapshots');
select lives_ok($$select public.create_sourcing_rfq(p6t.id('buyer_org'),'synthetic-multi-02',
  '[{"name":"Cotton rolls","unit":"rolls","quantity":"10"},{"name":"Paper packs","unit":"packs","quantity":"5"}]'::jsonb,
  array[p6t.id('partner_org'),p6t.id('other_org')],'Selangor')$$,
  'buyer creates a two-product request for competing partners');
select p6t.pg();
insert into p6t.ids select 'rfq2',id from public.sourcing_rfqs where idempotency_key='synthetic-multi-02';
insert into p6t.ids select 'rfq2a',id from public.sourcing_rfq_items where rfq_id=p6t.id('rfq2') and line_no=1;
insert into p6t.ids select 'rfq2b',id from public.sourcing_rfq_items where rfq_id=p6t.id('rfq2') and line_no=2;
select p6t.actor('partner');
select lives_ok($$select public.respond_sourcing_invitation(p6t.id('rfq2'),p6t.id('partner_org'),true)$$,
  'first competing partner accepts');
select lives_ok($$select public.submit_sourcing_quote(p6t.id('rfq2'),p6t.id('partner_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('rfq2a'),'unit_price','12.50'),
    jsonb_build_object('item_id',p6t.id('rfq2b'),'unit_price','20.00')),
  0,0,14,'Two-line offer',current_date+30,0)$$,'first partner quotes both products');
select p6t.actor('other');
select lives_ok($$select public.respond_sourcing_invitation(p6t.id('rfq2'),p6t.id('other_org'),true)$$,
  'second competing partner accepts');
select lives_ok($$select public.submit_sourcing_quote(p6t.id('rfq2'),p6t.id('other_org'),null,'INR',
  jsonb_build_array(jsonb_build_object('item_id',p6t.id('rfq2a'),'unit_price','11.00'),
    jsonb_build_object('item_id',p6t.id('rfq2b'),'unit_price','19.00')),
  0,0,14,'Competing offer',current_date+30,0)$$,'second partner quotes both products');
select is((select count(*)::int from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq2')),1,
  'second partner sees only its own competing offer');
select p6t.actor('partner');
select is((select count(*)::int from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq2')),1,
  'first partner sees only its own competing offer');
select p6t.actor('buyer');
select is((select count(*)::int from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq2')),2,
  'buyer can compare both persisted offers');
select lives_ok($$select public.select_sourcing_quote(p6t.id('rfq2'),
  (select id from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq2') and partner_org_id=p6t.id('other_org')),
  (select version from public.sourcing_rfqs where id=p6t.id('rfq2')))$$,
  'buyer selects a competing two-product offer');
select is((select status from public.sourcing_rfqs where id=p6t.id('rfq2')),'preferred_selected',
  'multi-product comparison persists preferred selection');
select p6t.actor('other');
select is((select count(*)::int from public.sourcing_rfq_messages where rfq_id=p6t.id('rfq')),0,
  'other invited partner cannot read private thread');
select is((select count(*)::int from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq')),0,
  'other invited partner cannot read private quote');
select throws_ok($$select public.get_sourcing_rfq(p6t.id('rfq'),p6t.id('partner_org'))$$,'PT404',null,
  'partner cannot claim another partner context');
select lives_ok($$select public.respond_sourcing_invitation(p6t.id('rfq'),p6t.id('other_org'),false)$$,
  'other partner declines assignment');
select throws_ok($$select public.get_sourcing_rfq(p6t.id('rfq'),p6t.id('other_org'))$$,'PT404',null,
  'declined partner loses request access');
select is((select count(*)::int from public.sourcing_rfq_events where rfq_id=p6t.id('rfq')),0,
  'declined partner cannot directly read event metadata');
select is((select count(*)::int from public.sourcing_rfqs where id=p6t.id('rfq')),0,
  'declined partner cannot read request directly');
select p6t.actor('outsider');
select is((select count(*)::int from public.sourcing_rfqs where id=p6t.id('rfq')),0,'outsider cannot read request');
select throws_ok($$select public.send_sourcing_message(p6t.id('rfq'),p6t.id('partner_org'),'intrusion')$$,'PT404',null,
  'outsider cannot message');
select p6t.actor('buyer');
select lives_ok($$select public.select_sourcing_quote(p6t.id('rfq'),p6t.id('quote'),
  (select version from public.sourcing_rfqs where id=p6t.id('rfq')))$$,'buyer selects preferred quote');
select is((select status from public.sourcing_rfqs where id=p6t.id('rfq')),'preferred_selected','selection persists');
select throws_ok($$select public.request_sourcing_sample(p6t.id('rfq'),p6t.id('partner_org'),p6t.id('item'),'Late')$$,
  'PT409',null,'new samples cannot be requested after quote selection');
select throws_ok($$select public.select_sourcing_quote(p6t.id('rfq'),p6t.id('quote'),0)$$,'PT409',null,
  'stale concurrent selection is rejected');
select lives_ok($$select public.change_sourcing_status(p6t.id('rfq'),'close',
  (select version from public.sourcing_rfqs where id=p6t.id('rfq')))$$,'buyer closes a selected request');
select p6t.pg();
select throws_ok($$update public.sourcing_rfq_quote_revisions set total=1 where quote_id=p6t.id('quote')$$,'42501',null,
  'submitted revision cannot be edited');
select lives_ok($$delete from auth.users where id=p6t.id('partner_user')$$,
  'participating partner user can be deleted');
select is((select submitted_by from public.sourcing_rfq_quote_revisions where quote_id=p6t.id('quote') and revision=1),
  null::uuid,'quote history redacts deleted author');
insert into public.sourcing_rfq_documents(rfq_id,partner_org_id,author_org_id,author_user_id,
  display_name,mime_type,size_bytes,sha256,storage_path)
  values(p6t.id('rfq'),p6t.id('partner_org'),p6t.id('buyer_org'),p6t.id('buyer_user'),
    'Erasure.pdf','application/pdf',12,repeat('d',64),
    'sourcing/44444444-4444-4444-8444-444444444444.pdf');
select is((select count(*)::int from public.sourcing_rfq_documents where rfq_id=p6t.id('rfq')),1,
  'synthetic document exists before partner erasure');
select lives_ok($$delete from public.organisations where id=p6t.id('partner_org')$$,
  'participating partner organization can be deleted');
select is((select count(*)::int from public.sourcing_rfq_quotes where rfq_id=p6t.id('rfq')),0,
  'deleted partner leaves no orphaned quote');
select is((select preferred_quote_id from public.sourcing_rfqs where id=p6t.id('rfq')),null::uuid,
  'deleted partner clears the selected quote reference');
select is((select status from public.sourcing_rfqs where id=p6t.id('rfq')),'closed',
  'erasing a partner keeps a closed request closed');
select is((select count(*)::int from private.sourcing_storage_cleanup
  where storage_path='sourcing/44444444-4444-4444-8444-444444444444.pdf'),1,
  'partner erasure queues its private object for cleanup');
select lives_ok($$delete from public.organisations where id=p6t.id('buyer_org')$$,
  'buyer organization erasure cascades request and history');
select * from finish();
rollback;
