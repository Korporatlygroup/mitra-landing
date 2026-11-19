begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures: two buyers (BA erased in the test, BB untouched), one seller S, one agreement each (OA with BA, OB with BB), events, audit rows.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000003a1', 'authenticated', 'authenticated', 'er-ba@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000003a2', 'authenticated', 'authenticated', 'er-bb@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000003a3', 'authenticated', 'authenticated', 'er-s@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.organisations (id, type, name, created_by) values
  ('00000000-0000-4000-8000-0000000003b1', 'buyer', 'Erasure BA', '00000000-0000-4000-8000-0000000003a1'),
  ('00000000-0000-4000-8000-0000000003b2', 'buyer', 'Erasure BB', '00000000-0000-4000-8000-0000000003a2'),
  ('00000000-0000-4000-8000-0000000003b3', 'business', 'Erasure S', '00000000-0000-4000-8000-0000000003a3');
insert into public.enquiries (id, buyer_org_id, seller_org_id, origin, topic, opened_by_org_id, created_by) values
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003b3', 'listing', 'Erasure enquiry A', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003a1'),
  ('00000000-0000-4000-8000-0000000003c2', '00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-0000000003b3', 'listing', 'Erasure enquiry B', '00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-0000000003a2');
insert into public.quotations (id, enquiry_id, seller_org_id, buyer_org_id, status, created_by) values
  ('00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003b3', '00000000-0000-4000-8000-0000000003b1', 'sent', '00000000-0000-4000-8000-0000000003a3'),
  ('00000000-0000-4000-8000-0000000003d2', '00000000-0000-4000-8000-0000000003c2', '00000000-0000-4000-8000-0000000003b3', '00000000-0000-4000-8000-0000000003b2', 'sent', '00000000-0000-4000-8000-0000000003a3');
insert into public.quotation_versions (id, quotation_id, version_number, currency, scope_text, tax_treatment, delivery_timing, valid_until, subtotal, delivery_fee, tax_amount, total) values
  ('00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003d1', 1, 'MYR', 'Scope A', 'None', 'Soon', now() + interval '5 days', 100, 0, 0, 100),
  ('00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-0000000003d2', 1, 'MYR', 'Scope B', 'None', 'Soon', now() + interval '5 days', 200, 0, 0, 200);
insert into public.orders (id, reference, enquiry_id, quotation_id, quote_version_id, buyer_org_id, seller_org_id, currency, total, scope_text, items, delivery_timing) values
  ('00000000-0000-4000-8000-0000000003f1', 'INOK-ER-A', '00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003e1', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003b3', 'MYR', 100, 'Scope A', '[]', 'Soon'),
  ('00000000-0000-4000-8000-0000000003f2', 'INOK-ER-B', '00000000-0000-4000-8000-0000000003c2', '00000000-0000-4000-8000-0000000003d2', '00000000-0000-4000-8000-0000000003e2', '00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-0000000003b3', 'MYR', 200, 'Scope B', '[]', 'Soon');
insert into public.deal_events (enquiry_id, order_id, kind, actor_org_id, actor_user_id) values
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003f1', 'order.created', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003a1'),
  ('00000000-0000-4000-8000-0000000003c1', '00000000-0000-4000-8000-0000000003f1', 'order.in_progress', '00000000-0000-4000-8000-0000000003b3', '00000000-0000-4000-8000-0000000003a3'),
  ('00000000-0000-4000-8000-0000000003c2', '00000000-0000-4000-8000-0000000003f2', 'order.created', '00000000-0000-4000-8000-0000000003b2', '00000000-0000-4000-8000-0000000003a2'),
  ('00000000-0000-4000-8000-0000000003c2', '00000000-0000-4000-8000-0000000003f2', 'order.in_progress', '00000000-0000-4000-8000-0000000003b3', '00000000-0000-4000-8000-0000000003a3');
insert into public.audit_log (actor_org_id, org_id, action, entity_type, entity_id)
  values ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000003b1', 'order.completed', 'order', '00000000-0000-4000-8000-0000000003f1');

-- Structure: no delete action blocks erasure any more.
select is((select count(*)::int from pg_constraint where contype = 'f' and conrelid in ('public.orders'::regclass, 'public.deal_events'::regclass) and confdeltype in ('a', 'r')), 0, 'no foreign key of orders or deal_events uses NO ACTION or RESTRICT');
select is((select confdeltype::text from pg_constraint where conname = 'deal_events_actor_user_id_fkey'), 'n', 'a person is not left behind: deal_events.actor_user_id is set to null on user erasure');
select is((select count(*)::int from public.orders where id in ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003f2')), 2, 'both agreements exist before erasure');

-- Erasing a user clears the person from the event history but keeps the events.
select lives_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000003a3' $$, 'erasing the seller user succeeds');
select is((select count(*)::int from public.deal_events where actor_user_id = '00000000-0000-4000-8000-0000000003a3'), 0, 'no event still carries the erased user id');
select is((select count(*)::int from public.deal_events where order_id in ('00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003f2')), 4, 'the events themselves are kept when only a user is erased');

-- Erasing a buyer organisation removes its agreement and events, and nothing of the other buyer.
select lives_ok($$ delete from public.organisations where id = '00000000-0000-4000-8000-0000000003b1' $$, 'erasing a buyer organisation with an agreement succeeds');
select is((select count(*)::int from public.orders where id = '00000000-0000-4000-8000-0000000003f1'), 0, 'its agreement is gone');
select is((select count(*)::int from public.deal_events where enquiry_id = '00000000-0000-4000-8000-0000000003c1'), 0, 'its events are gone');
select is((select count(*)::int from public.orders where id = '00000000-0000-4000-8000-0000000003f2'), 1, 'the other buyer agreement with the same seller is intact');
select is((select count(*)::int from public.deal_events where enquiry_id = '00000000-0000-4000-8000-0000000003c2'), 2, 'its events are intact');
select is((select count(*)::int from public.organisations where id = '00000000-0000-4000-8000-0000000003b3'), 1, 'the seller organisation remains');

-- Audit requirement: the audit trail of the erased agreement survives.
select is((select count(*)::int from public.audit_log where action = 'order.completed' and entity_id = '00000000-0000-4000-8000-0000000003f1'), 1, 'the audit_log row for the erased agreement is kept');

-- Agreement integrity: a sent quotation version still cannot be deleted on its own while an agreement refers to it.
select throws_ok($$ delete from public.quotation_versions where id = '00000000-0000-4000-8000-0000000003e2' $$, 'PT409', 'sent_quote_immutable', 'a sent quotation version cannot be deleted directly');

-- Erasing the seller organisation removes the remaining agreement.
select lives_ok($$ delete from public.organisations where id = '00000000-0000-4000-8000-0000000003b3' $$, 'erasing the seller organisation succeeds');
select is((select count(*)::int from public.orders where id = '00000000-0000-4000-8000-0000000003f2') + (select count(*)::int from public.deal_events where enquiry_id = '00000000-0000-4000-8000-0000000003c2'), 0, 'the remaining agreement and its events are gone');

select * from finish();
rollback;
