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

select plan(36);

-- ============================ S6: RLS everywhere ============================
select is_empty(
  $$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'S6.1 no table in public/private has RLS disabled');

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'rate_limit_events'
       and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.cmd in ('SELECT', 'ALL')) $$,
  'S6.2 every public table except rate_limit_events has at least one SELECT policy');

select is(
  (select count(*)::int from pg_policies where (schemaname, tablename) in (('public', 'rate_limit_events'), ('private', 'bootstrap_state'))),
  0, 'S6.3 rate_limit_events and private.bootstrap_state have no policy at all (deny all for API roles)');

select is_empty(
  $$ select p.tablename || '.' || p.policyname from pg_policies p
     where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and p.tablename <> 'profiles' $$,
  'S6.4 no write policies on any public table except profiles (all writes go through RPCs)');

select is_empty(
  $$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')
       and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'S6.5 every view/matview in public/private is security_invoker (none expected)');

-- =================== S7: function hygiene and privileges ===================
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'S7.1 every SECURITY DEFINER function in public/private pins search_path to ""');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'S7.2 every function (definer or not) in public/private pins search_path to ""');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['compare_items', 'get_catalogue_item', 'get_listing', 'get_product_media_access', 'gov_get_programme', 'gov_list_programmes', 'list_published_business_reviews', 'search_catalogue', 'search_listings'],
  'S7.3 anon can execute only the three public directory reads, the four public catalogue reads and the Phase 7 public programme list, nothing else in public or private');

select is_empty(
  $$ select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S')
       and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
            or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')) $$,
  'S7.4 anon has no privilege on any table/view/sequence in public or private');

select ok(not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('public', 'private', 'USAGE'),
  'S7.5 anon / PUBLIC have no USAGE on schema private');

select is(
  (select array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by (p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')') collate "default")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  ARRAY(SELECT x FROM unnest(ARRAY['accept_invitation(p_token text)', 'create_invitation(p_org uuid, p_email text, p_role member_role)',
        'create_org(p_type org_type, p_name text)', 'decide_claim(p_claim uuid, p_decision text, p_reason text, p_expected_version integer)',
        'end_request(p_request uuid, p_status text, p_reason text)', 'enquiry_parties(p_enquiry uuid)', 'find_candidates(p_request uuid, p_broaden boolean)',
        'get_document_access(p_doc uuid)', 'get_listing(p_slug text)', 'get_request_for_seller(p_request uuid, p_seller_org uuid)',
        'get_verification_summary(p_org uuid)', 'grant_consent(p_purpose text, p_version text)',
        'handle_report(p_report uuid, p_action text, p_note text)', 'invite_seller(p_request uuid, p_seller_org uuid)',
        'list_board_requests(p_seller_org uuid, p_category text, p_state text, p_offset integer)',
        'list_buyer_requests(p_org uuid)', 'list_published_business_reviews(p_slug text)', 'list_request_matches(p_request uuid)',
        'list_seller_requests(p_seller_org uuid, p_filter text)', 'mark_notification_read(p_id uuid)',
        'open_listing_enquiry(p_buyer_org uuid, p_slug text, p_topic text, p_note text)',
        'reinstate_listing(p_org uuid, p_reason text)', 'remove_document(p_doc uuid)', 'remove_member(p_org uuid, p_user uuid)',
        'remove_request(p_request uuid, p_reason text)', 'rename_org(p_org uuid, p_name text)',
        'report_content(p_type text, p_target text, p_reason text, p_note text)', 'republish_listing(p_org uuid)',
        'respond_to_invitation(p_request uuid, p_seller_org uuid, p_response text, p_note text)',
        'review_listing(p_org uuid, p_decision text, p_reason text, p_expected_version integer)',
        'revoke_invitation(p_invitation uuid)', 'save_business_profile(p_org uuid, p_data jsonb)',
        'save_listing_draft(p_org uuid, p_data jsonb, p_expected_version integer)',
        'save_representative(p_org uuid, p_name text, p_role text, p_email text, p_phone text)',
        'save_request_draft(p_org uuid, p_request uuid, p_key text, p_data jsonb, p_expected_version integer)',
        'search_listings(p_q text, p_category text, p_state text, p_limit integer, p_offset integer)',
        'set_accepting_requests(p_org uuid, p_value boolean)', 'set_member_role(p_org uuid, p_user uuid, p_role member_role)', 'set_request_visibility(p_request uuid, p_visibility text)',
        'start_review(p_claim uuid)', 'submit_claim(p_org uuid, p_type claim_type, p_document_ids uuid[], p_note text)',
        'submit_listing(p_org uuid, p_expected_version integer)', 'submit_request(p_request uuid, p_expected_version integer)',
        'suspend_listing(p_org uuid, p_reason text)', 'unpublish_listing(p_org uuid)', 'withdraw_claim(p_claim uuid)',
        'withdraw_consent(p_id uuid)', 'withdraw_listing_submission(p_org uuid)',
        'open_referral_enquiry(p_referral uuid)',
        'moderate_business_review(p_review uuid, p_status review_status, p_reason text)',
        'moderate_review_response(p_review uuid, p_approve boolean, p_reason text)',
        'post_enquiry_message(p_enquiry uuid, p_body text, p_key text)',
        'propose_referral(p_enquiry uuid, p_proposed_seller uuid)',
        'record_lead_activity(p_enquiry uuid, p_stage lead_stage, p_note text, p_follow_up timestamp with time zone)',
        'respond_to_business_review(p_review uuid, p_text text)',
        'respond_to_quote(p_quotation uuid, p_version uuid, p_action text, p_reason text, p_expected_version integer)',
        'respond_to_referral(p_referral uuid, p_accept boolean)',
        'save_quote_draft(p_enquiry uuid, p_draft jsonb, p_expected_version integer)',
        'send_quote_version(p_quotation uuid, p_expected_version integer)',
        'submit_business_review(p_enquiry uuid, p_rating integer, p_text text)',
        'withdraw_quote(p_quotation uuid, p_expected_version integer)',
        'accept_partner_invitation(p_token text)', 'approve_partner(p_org uuid, p_reason text)',
        'cancel_import(p_job uuid)', 'catalogue_stats()',
        'close_sourcing_request(p_request uuid, p_note text)', 'commit_import(p_job uuid, p_confirm_overwrite boolean)',
        'compare_items(p_ids uuid[])', 'get_catalogue_item(p_id uuid)',
        'get_import(p_org uuid, p_job uuid, p_kind text, p_offset integer)', 'get_my_product(p_org uuid, p_product uuid)',
        'get_product_for_review(p_product uuid)', 'get_product_media_access(p_media uuid)',
        'get_sourcing_request(p_request uuid)', 'get_supplier(p_supplier uuid)',
        'get_supplier_document_access(p_doc uuid)', 'handle_product_report(p_report uuid, p_action text, p_note text)',
        'list_imports(p_org uuid, p_supplier uuid, p_offset integer)', 'list_my_products(p_org uuid, p_supplier uuid, p_status text, p_offset integer, p_limit integer)',
        'list_my_sourcing_requests(p_buyer_org uuid, p_offset integer)', 'list_my_suppliers(p_org uuid)',
        'list_partner_orgs(p_status text, p_offset integer)', 'list_partner_requests(p_org uuid, p_status text, p_offset integer)',
        'list_product_reports(p_status text, p_offset integer)', 'list_product_reviews(p_offset integer)',
        'list_saved_products(p_offset integer)', 'list_supplier_reviews(p_scope text, p_offset integer)',
        'provision_partner(p_name text, p_owner_email text, p_display_name text)', 'publish_product(p_org uuid, p_product uuid, p_expected_version integer)',
        'reinstate_product(p_product uuid, p_reason text)', 'reinstate_supplier(p_supplier uuid, p_reason text)',
        'remove_product_media(p_media uuid)', 'remove_supplier_document(p_doc uuid)',
        'reply_sourcing_request(p_request uuid, p_note text)', 'report_product(p_product uuid, p_reason text, p_note text)',
        'resend_partner_invitation(p_org uuid, p_owner_email text)', 'respond_sourcing_request(p_request uuid, p_action text, p_note text, p_expected_version integer)',
        'review_product(p_product uuid, p_decision text, p_reason text, p_expected_version integer)', 'review_supplier(p_supplier uuid, p_decision text, p_reason text, p_checks text[], p_expected_version integer)',
        'save_partner_profile(p_org uuid, p_display_name text, p_contact_email text)', 'save_product(p_product uuid)',
        'save_product_draft(p_org uuid, p_supplier uuid, p_product uuid, p_data jsonb, p_expected_version integer)', 'save_supplier_draft(p_org uuid, p_supplier uuid, p_data jsonb, p_expected_version integer)',
        'search_catalogue(p_q text, p_category text, p_supplier uuid, p_moq_max numeric, p_price_min numeric, p_price_max numeric, p_currency text, p_offset integer, p_limit integer)', 'stage_import(p_partner_org uuid, p_supplier uuid, p_mode text, p_file_name text, p_sha256 text, p_rows jsonb)',
        'submit_product(p_org uuid, p_product uuid, p_expected_version integer)', 'submit_sourcing_request(p_buyer_org uuid, p_key text, p_items jsonb, p_destination_state text, p_destination_city text, p_needed_by date, p_notes text)',
        'submit_supplier(p_org uuid, p_supplier uuid, p_expected_version integer)', 'suspend_partner(p_org uuid, p_reason text)',
        'suspend_product(p_product uuid, p_reason text)', 'suspend_supplier(p_supplier uuid, p_reason text)',
        'unpublish_product(p_org uuid, p_product uuid)', 'unsave_product(p_product uuid)',
        'update_product_media(p_media uuid, p_alt text, p_sort integer)', 'withdraw_sourcing_request(p_request uuid)',
        'withdraw_supplier_submission(p_org uuid, p_supplier uuid)',
        'seller_lead_metrics(p_seller_org uuid)',
        'gov_decide_proposal(p_proposal uuid, p_decision text, p_reason text, p_expected_status text)', 'gov_decide_source_change(p_change uuid, p_approve boolean, p_reason text)',
        'gov_list_programmes(p_funding_type text, p_query text, p_limit integer, p_offset integer)', 'gov_propose_source_change(p_source uuid, p_change jsonb, p_reason text)',
        'gov_register_source(p_agency_code text, p_agency_name text, p_domain text, p_name text, p_type text, p_adapter text, p_hosts text[], p_urls text[], p_method text, p_restrictions text)',
        'gov_set_programme_state(p_programme uuid, p_state text, p_reason text)', 'gov_set_setting(p_key text, p_enabled boolean, p_reason text)',
        'gov_get_profile(p_org uuid)', 'gov_save_profile(p_org uuid, p_data jsonb, p_expected_version integer)', 'gov_save_programme(p_org uuid, p_programme uuid)',
        'gov_unsave_programme(p_org uuid, p_programme uuid)', 'gov_update_tracking(p_org uuid, p_programme uuid, p_data jsonb, p_expected_version integer)',
        'gov_list_saved(p_org uuid)', 'gov_get_programme(p_slug text)', 'gov_get_prefs()', 'gov_set_prefs(p_data jsonb)']) AS x ORDER BY x),
  'S7.6 authenticated can execute exactly the 133 allow-listed public RPCs (62 up to Phase 4, 55 added by Phase 5, 16 added by Phase 7)');

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['can_manage_members', 'current_aal', 'current_consent_version', 'has_partner_involvement', 'has_permission', 'has_platform_permission', 'invalid_invitation', 'is_admin_role', 'is_enquiry_member', 'is_member',
        'request_buyer_org', 'request_has_open_report', 'requires_mfa', 'role_rank', 'shares_org'],
  'S7.7 authenticated can execute exactly the 15 allow-listed private helpers (14 + has_partner_involvement for the reviewer RLS branches, 000115) (not write_audit / check_rate_limit / raise_error / triggers)');

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  array['bootstrap_first_admin', 'gov_claim_jobs', 'gov_complete_job', 'gov_dispatch_outbox', 'gov_enqueue_due_jobs', 'gov_enqueue_reminders', 'gov_fail_job', 'gov_job_source', 'gov_mark_email', 'gov_mark_missing', 'gov_submit_candidate', 'service_auth_attempt', 'service_list_unscanned_documents', 'service_list_unscanned_product_media',
        'service_list_unscanned_supplier_documents', 'service_org_recipient_emails', 'service_record_auth_event', 'service_record_rejected_upload',
        'service_register_document', 'service_register_product_media', 'service_register_supplier_document', 'service_set_product_media_scan',
        'service_set_scan_result', 'service_set_supplier_document_scan'],
  'S7.8 service_role executes exactly the 24 allow-listed service_* / bootstrap / worker functions from public (8 up to Phase 4, 6 from Phase 5, 10 Phase 7 worker RPCs)');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('service_role', p.oid, 'EXECUTE') $$,
  'S7.9 service_role cannot execute any function in schema private (write_audit etc.)');

select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'insert,update,delete,truncate'),
  'S7.10 service_role has no INSERT/UPDATE/DELETE/TRUNCATE privilege on audit_log');

select tt.svc();
select throws_ok($$ insert into public.audit_log (action) values ('forged') $$, '42501', null,
  'S7.11 service_role direct INSERT into audit_log is rejected (permission denied)');
select tt.pg();

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.memberships', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.organisations', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.invitations', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.role_permissions', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.consents', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.rate_limit_events', 'select,insert,update,delete,truncate'),
  'S7.12 authenticated has no write privilege on identity/audit tables and no access to rate_limit_events');

select ok(
  not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'select')
  and has_column_privilege('authenticated', 'public.invitations', 'email', 'select'),
  'S7.13 token_hash is not column-selectable by authenticated (other invitation columns are)');

select ok(
  not has_table_privilege('authenticated', 'private.bootstrap_state', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.bootstrap_state', 'select,insert,update,delete'),
  'S7.14 bootstrap_state is not accessible to authenticated or service_role');

select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attnum > 0
     and has_column_privilege('authenticated', 'public.profiles', a.attname, 'update')),
  array['display_name', 'language'],
  'S7.15 authenticated may update only profiles.display_name and profiles.language');

select ok(not has_function_privilege('authenticated', 'private.has_org_involvement(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'private.has_org_involvement(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('service_role', 'private.has_org_involvement(uuid, uuid)', 'EXECUTE'),
  'S7.30 private.has_org_involvement is not executable by authenticated, anon or service_role');

-- anon behaves as expected over real statements
select tt.anon();
select throws_ok($$ select * from public.organisations $$, '42501', null, 'S7.16 anon select on organisations denied');
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'S7.17 anon select on audit_log denied');
select throws_ok($$ select public.create_org('business', 'Anon Org') $$, '42501', null, 'S7.18 anon cannot call create_org');
select throws_ok($$ select public.accept_invitation(repeat('a', 64)) $$, '42501', null, 'S7.19 anon cannot call accept_invitation');
select throws_ok($$ select public.bootstrap_first_admin('x@example.test') $$, '42501', null, 'S7.20 anon cannot call bootstrap_first_admin');
select throws_ok($$ select public.service_record_auth_event(gen_random_uuid(), 'auth.login') $$, '42501', null,
  'S7.21 anon cannot call service_record_auth_event');
select throws_ok($$ select private.write_audit('x', null, null, null, '{}'::jsonb) $$, '42501', null,
  'S7.22 anon cannot call private.write_audit');

-- authenticated cannot reach internal functions
select tt.pg();
select tt.mkuser('tt_s7_user');
select tt.act('tt_s7_user');
select throws_ok($$ select private.write_audit('forged.event', null, null, null, '{}'::jsonb) $$, '42501', null,
  'S7.23 authenticated cannot call private.write_audit');
select throws_ok($$ select private.check_rate_limit('x', 1, interval '1 hour') $$, '42501', null,
  'S7.24 authenticated cannot call private.check_rate_limit');
select throws_ok($$ select public.bootstrap_first_admin('tt_s7_user@example.test') $$, '42501', null,
  'S7.25 authenticated cannot call bootstrap_first_admin');
select throws_ok($$ select public.service_record_auth_event(gen_random_uuid(), 'auth.login') $$, '42501', null,
  'S7.26 authenticated cannot call service_record_auth_event');
select throws_ok($$ select * from public.rate_limit_events $$, '42501', null, 'S7.27 authenticated cannot read rate_limit_events');
select throws_ok($$ select * from private.bootstrap_state $$, '42501', null, 'S7.28 authenticated cannot read private.bootstrap_state');
select throws_ok($$ select token_hash from public.invitations $$, '42501', null, 'S7.29 authenticated cannot select token_hash');

select tt.pg();
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
  69, 'S6.6 inventory: exactly the 69 expected public tables exist (35 up to Phase 4, 19 from Phase 5, 15 from Phase 7; new tables must come with RLS tests)');

select * from finish();
rollback;
