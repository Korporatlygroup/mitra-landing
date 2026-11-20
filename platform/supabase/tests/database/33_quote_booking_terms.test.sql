begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Structure: additive, nullable columns, so quotations and agreements made before this change stay valid.
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'quotation_versions'
  and column_name in ('booking_date','completion_by','deposit_terms','cancellation_option','cancellation_text') and is_nullable = 'YES'), 5, 'quotation_versions has the five nullable booking-term columns');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'orders'
  and column_name in ('completion_by','cancellation_option','cancellation_text') and is_nullable = 'YES'), 3, 'orders has the nullable terms columns');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'terms_locked'), 'false', 'terms_locked defaults to false, so older agreements stay editable');
select is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'terms_locked'), 'NO', 'terms_locked is never null');

-- The cancellation option is a closed list; deposit and custom text are length-limited.
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.quotation_versions'::regclass and conname like '%cancellation_option%') ~ 'free_7d.*deposit_kept.*no_cancel.*custom', 'quotation_versions limits the cancellation option');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.orders'::regclass and conname like '%cancellation_option%') ~ 'free_7d.*deposit_kept.*no_cancel.*custom', 'orders limits the cancellation option');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.quotation_versions'::regclass and conname like '%deposit_terms%') ~ '500', 'deposit text is limited to 500 characters');

-- Money: no payment state was introduced, and the functions keep their privileges.
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('quotation_versions','orders') and column_name ~ '(paid|escrow|refund|payout|released)'), 'no payment-related column exists');
select is(has_function_privilege('anon', 'public.send_quote_version(uuid,integer)', 'execute'), false, 'anon cannot execute send_quote_version');
select is(has_function_privilege('authenticated', 'public.send_quote_version(uuid,integer)', 'execute'), true, 'authenticated can execute send_quote_version (the function checks the seller permission)');
select is(has_function_privilege('anon', 'public.set_order_details(uuid,date,text)', 'execute'), false, 'anon cannot execute set_order_details');
select is(has_function_privilege('authenticated', 'private.deal_on_quote_change()', 'execute'), false, 'the acceptance trigger function is not callable by users');

-- A sent version is still immutable.
select is((select count(*)::int from pg_trigger where tgrelid = 'public.quotation_versions'::regclass and tgname ~ 'immutable' and not tgisinternal), 1, 'the immutability trigger on quotation_versions is still in place');

select * from finish();
rollback;
