-- Phase 5 review fixes (independent review findings). Local only; 110-114 are untouched.
-- H1 suspended supplier cannot be lifted by review; M1 sourcing snapshot locks the product; M2 re-upload after commit
-- creates a new job; M4 supplier private data needs supplier:manage (aal2 for owners) or an uninvolved reviewer;
-- M5 reviewer reads respect conflict of interest; M7 approving a suspended partner needs a reason; L2 hidden/bidi
-- characters in text; L3 media for a suspended supplier; L5 unchanged resubmission; L8 duplicate _row in staged import.
-- Functions are re-created with CREATE OR REPLACE (signatures unchanged, so grants are kept).

-- L2: hidden characters. Bidi overrides/isolates/marks, zero-width space, word joiner and BOM are rejected in text
-- (ZWNJ/ZWJ are kept: Indic scripts need them). A formula starter is also recognised behind leading invisible
-- characters, NBSP, soft hyphen or newlines.
create or replace function private.formula_text(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and regexp_replace(p, '^[[:space:]\u00a0\u00ad\u200b\u200c\u200d\u2060\ufeff]+', '') ~ E'^[=+@\\t\\r-]'
$$;

create or replace function private.bad_text(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null
              when char_length(p) > p_max then 'too_long'
              when p ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then 'invalid_text'
              when p ~ '[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]' then 'invalid_text'
              when private.formula_text(p) then 'formula_text' end
$$;

-- Same signature and behaviour as the Phase 3 helper, plus rejection of the hidden characters above.
create or replace function private.clean_text(p_val text, p_min integer, p_max integer, p_err text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_val, '')), '');
begin
  if v is null then return null; end if;
  if char_length(v) < p_min or char_length(v) > p_max or v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]'
     or v ~ '[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]' then
    perform private.raise_error('invalid', p_err);
  end if;
  return v;
end;
$$;

-- M2: dedupe only while previewed. A committed/failed/cancelled job no longer blocks a re-upload of the same file.
alter table public.import_jobs drop constraint import_jobs_partner_org_id_supplier_id_file_sha256_mode_key;
create unique index import_jobs_previewed_unique on public.import_jobs (partner_org_id, supplier_id, file_sha256, mode)
  where status = 'previewed';

-- M7
create or replace function public.approve_partner(p_org uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pp public.partner_profiles;
  v_reason text := private.clean_reason(p_reason, 0);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  select * into pp from public.partner_profiles where org_id = p_org for update;
  if pp.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if (select o.status from public.organisations o where o.id = p_org) is distinct from 'active' then
    perform private.raise_error('conflict', 'org_not_active');
  end if;
  if pp.status = 'approved' then return; end if; -- retry-safe
  if pp.status = 'suspended' then v_reason := private.clean_reason(p_reason, 5); end if; -- M7: reinstating needs a reason
  update public.partner_profiles set status = 'approved', decided_by = v_user, decided_at = now(),
    decision_reason = v_reason, version = version + 1, updated_at = now() where org_id = p_org;
  perform private.write_audit('partner.approved', p_org, 'partner_profile', p_org::text,
    jsonb_build_object('from', pp.status, 'reason', v_reason));
  perform private.notify_org(p_org, 'org:manage', 'partner.decided', 'organisation', p_org::text);
end;
$$;

-- L5
create or replace function public.submit_supplier(p_org uuid, p_supplier uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  pr public.supplier_private;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'supplier:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  perform private.require_consent();
  perform private.check_rate_limit('supplier_submit:' || v_user, 30, interval '1 hour');
  select * into s from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_org for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if s.draft_submitted_version is not null then return; end if; -- retry-safe
  if s.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;
  if s.status = 'approved' and s.live_draft_version is not distinct from s.draft_version then
    perform private.raise_error('conflict', 'nothing_to_submit');
  end if;
  -- L5: a rejected / more_info_needed supplier goes back to draft on the first edit, so these statuses mean unchanged.
  if s.status in ('rejected', 'more_info_needed') then perform private.raise_error('conflict', 'nothing_to_submit'); end if;
  if p_expected_version is distinct from s.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;
  perform private.assert_supplier_complete(s.draft);
  select * into pr from public.supplier_private where supplier_id = s.id;
  if pr.supplier_id is null or pr.contact_name is null or (pr.contact_email is null and pr.contact_phone is null) then
    perform private.raise_error('invalid', 'supplier_incomplete');
  end if;
  if not exists (select 1 from public.supplier_documents d where d.supplier_id = s.id and d.removed_at is null and d.scan_status = 'clean') then
    perform private.raise_error('conflict', 'documents_not_ready');
  end if;

  update public.supplier_documents set locked = true where supplier_id = s.id and removed_at is null and scan_status = 'clean';
  update public.suppliers set draft_submitted_version = s.draft_version, submitted_at = now(), submitted_by = v_user,
    status = case when s.status = 'approved' then 'approved'::public.supplier_status else 'awaiting_review'::public.supplier_status end,
    version = s.version + 1, updated_at = now()
  where id = s.id;
  perform private.add_supplier_event(s.id, p_org, v_user, case when s.status = 'approved' then 'resubmitted' else 'submitted' end,
    s.status::text, case when s.status = 'approved' then 'approved' else 'awaiting_review' end, null,
    jsonb_build_object('draft_version', s.draft_version));
  perform private.write_audit('supplier.submitted', p_org, 'supplier', s.id::text, jsonb_build_object('draft_version', s.draft_version));
  perform private.notify_platform('supplier:review', 'supplier.submitted', 'supplier', s.id::text);
end;
$$;

-- H1
create or replace function public.withdraw_supplier_submission(p_org uuid, p_supplier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.suppliers;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'supplier:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  select * into s from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_org for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if s.draft_submitted_version is null then perform private.raise_error('conflict', 'supplier_not_pending'); end if;
  update public.suppliers set draft_submitted_version = null, version = s.version + 1, updated_at = now(),
    status = case when s.status in ('approved', 'suspended') then s.status else 'draft'::public.supplier_status end
  where id = s.id;
  perform private.add_supplier_event(s.id, p_org, auth.uid(), 'withdrawn', s.status::text,
    case when s.status in ('approved', 'suspended') then s.status::text else 'draft' end, null, '{}'::jsonb);
  perform private.write_audit('supplier.withdrawn', p_org, 'supplier', s.id::text, '{}'::jsonb);
end;
$$;

create or replace function public.review_supplier(p_supplier uuid, p_decision text, p_reason text, p_checks text[], p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_reason text;
  v_checks text[] := coalesce(p_checks, array[]::text[]);
  v_to public.supplier_status;
  v_kind text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('supplier:review') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_info') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  v_reason := private.clean_reason(p_reason, case when p_decision = 'approve' then 0 else 5 end);
  select * into s from public.suppliers x where x.id = p_supplier for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(s.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if s.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if; -- H1: only reinstate_supplier lifts a suspension
  if s.draft_submitted_version is null then perform private.raise_error('conflict', 'supplier_not_pending'); end if;
  if p_expected_version is distinct from s.draft_submitted_version then perform private.raise_error('conflict', 'stale_version'); end if;

  if p_decision = 'approve' then
    if cardinality(v_checks) < 1 or cardinality(v_checks) > 6
       or exists (select 1 from unnest(v_checks) c where c not in
         ('contact_reachable', 'registration_document_seen', 'address_consistent', 'catalogue_consistent', 'trade_reference', 'identity_document_seen'))
       or cardinality(v_checks) <> (select count(distinct c) from unnest(v_checks) c) then
      perform private.raise_error('invalid', 'invalid_checks');
    end if;
    perform private.assert_partner_active(s.partner_org_id);
    perform private.assert_supplier_complete(s.draft);
    if not exists (select 1 from public.supplier_documents d where d.supplier_id = s.id and d.removed_at is null and d.scan_status = 'clean') then
      perform private.raise_error('conflict', 'documents_not_ready');
    end if;
    update public.suppliers set status = 'approved', draft_submitted_version = null, live_draft_version = s.draft_submitted_version,
      live_name = s.draft ->> 'name', live_country = s.draft ->> 'country', live_state_city = s.draft ->> 'state_city',
      live_main_category = s.draft ->> 'main_category', live_description = s.draft ->> 'description',
      live_capabilities = coalesce(s.draft -> 'capabilities', '[]'::jsonb), review_checks = v_checks, reviewed_at = now(),
      reviewed_by = v_user, decision_reason = v_reason, version = s.version + 1, updated_at = now()
    where id = s.id;
    v_to := 'approved'; v_kind := 'approved';
  else
    v_to := case when s.live_name is not null then 'approved'::public.supplier_status
                 when p_decision = 'reject' then 'rejected'::public.supplier_status else 'more_info_needed'::public.supplier_status end;
    v_kind := case p_decision when 'reject' then 'rejected' else 'more_info_requested' end;
    update public.suppliers set status = v_to, draft_submitted_version = null, decision_reason = v_reason,
      version = s.version + 1, updated_at = now()
    where id = s.id;
  end if;
  perform private.add_supplier_event(s.id, s.partner_org_id, v_user, v_kind, s.status::text, v_to::text, v_reason,
    jsonb_build_object('draft_version', s.draft_submitted_version, 'checks', v_checks));
  perform private.write_audit('supplier.' || v_kind, s.partner_org_id, 'supplier', s.id::text,
    jsonb_build_object('reason', v_reason, 'checks', v_checks, 'draft_version', s.draft_submitted_version));
  perform private.notify_org(s.partner_org_id, 'supplier:manage', 'supplier.decided', 'supplier', s.id::text);
end;
$$;

create or replace function public.suspend_supplier(p_supplier uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not (private.has_platform_permission('supplier:review') or private.has_platform_permission('catalogue:moderate')) then
    perform private.raise_error('forbidden');
  end if;
  select * into s from public.suppliers x where x.id = p_supplier for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(s.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if s.status = 'suspended' then return; end if;
  if s.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_approved'); end if;
  update public.suppliers set status = 'suspended', draft_submitted_version = null, suspended_reason = v_reason, suspended_at = now(), suspended_by = v_user,
    version = s.version + 1, updated_at = now()
  where id = s.id;
  perform private.add_supplier_event(s.id, s.partner_org_id, v_user, 'suspended', 'approved', 'suspended', v_reason, '{}'::jsonb);
  perform private.write_audit('supplier.suspended', s.partner_org_id, 'supplier', s.id::text, jsonb_build_object('reason', v_reason));
  perform private.notify_org(s.partner_org_id, 'supplier:manage', 'supplier.suspended', 'supplier', s.id::text);
end;
$$;

-- M4
create or replace function public.get_supplier(p_supplier uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.suppliers;
  v_member boolean;
  v_reviewer boolean;
  v_private boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into s from public.suppliers x where x.id = p_supplier;
  if s.id is null then perform private.raise_error('not_found'); end if;
  v_member := private.is_member(s.partner_org_id);
  v_reviewer := private.has_platform_permission('supplier:review') and s.status <> 'draft'
                and not private.has_partner_involvement(s.partner_org_id, auth.uid());
  if not v_member and not v_reviewer then perform private.raise_error('not_found'); end if;
  -- M4: private contact/registration fields need supplier:manage (aal2 for owners, via has_permission) or an uninvolved reviewer.
  v_private := private.has_permission(s.partner_org_id, 'supplier:manage') or v_reviewer;
  return private.supplier_summary(s) || jsonb_build_object(
    'draft', s.draft,
    'live', jsonb_build_object('name', s.live_name, 'country', s.live_country, 'state_city', s.live_state_city,
      'main_category', s.live_main_category, 'description', s.live_description, 'capabilities', s.live_capabilities),
    'private', case when v_private then (select to_jsonb(p) - 'supplier_id' from public.supplier_private p where p.supplier_id = s.id) end,
    'suspended_reason', s.suspended_reason,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'display_name', d.display_name,
        'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'scan_status', d.scan_status, 'locked', d.locked, 'created_at', d.created_at)
        order by d.created_at) from public.supplier_documents d where d.supplier_id = s.id and d.removed_at is null), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
        'reason', e.reason, 'at', e.at) order by e.id)
        from public.supplier_events e where e.supplier_id = s.id and e.kind not in ('document_viewed', 'scan_result')), '[]'::jsonb));
end;
$$;

-- L3
create or replace function public.service_register_product_media(
  p_org uuid, p_user uuid, p_product uuid, p_mime text, p_size bigint, p_sha256 text, p_storage_path text,
  p_scan_status public.scan_status, p_scan_engine text, p_alt text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.products;
  v_id uuid;
  v_alt text := nullif(btrim(coalesce(p_alt, '')), '');
begin
  if not exists (
    select 1 from public.memberships m
    join public.organisations o on o.id = m.org_id and o.status = 'active' and o.type = 'partner'
    join public.partner_profiles pp on pp.org_id = o.id and pp.status = 'approved'
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'catalogue:manage'
    where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
  ) then
    perform private.raise_error('forbidden');
  end if;
  select * into pr from public.products x where x.id = p_product and x.partner_org_id = p_org for update;
  if pr.id is null then perform private.raise_error('not_found'); end if;
  if pr.status = 'suspended' then perform private.raise_error('conflict', 'product_suspended'); end if;
  if exists (select 1 from public.suppliers x where x.id = pr.supplier_id and x.status = 'suspended') then
    perform private.raise_error('conflict', 'supplier_suspended');
  end if;
  if p_storage_path is null or p_storage_path !~ ('^products/' || p_org::text || '/' || p_product::text || '/[A-Za-z0-9._-]{8,120}$') then
    perform private.raise_error('invalid', 'invalid_path');
  end if;
  if p_scan_status = 'infected' then perform private.raise_error('invalid', 'infected_not_stored'); end if;
  if (select count(*) from public.product_media m where m.product_id = p_product and m.removed_at is null) >= 8 then
    perform private.raise_error('conflict', 'media_limit_reached');
  end if;
  if v_alt is not null and (char_length(v_alt) > 200 or v_alt ~ '[[:cntrl:]]') then perform private.raise_error('invalid', 'invalid_alt'); end if;
  insert into public.product_media (product_id, partner_org_id, storage_path, mime_type, size_bytes, sha256, scan_status, scan_engine,
    scanned_at, alt, sort, uploaded_by)
  values (p_product, p_org, p_storage_path, p_mime, p_size, p_sha256, p_scan_status, left(p_scan_engine, 80),
    case when p_scan_status in ('clean', 'failed') then now() end, v_alt,
    (select coalesce(max(m.sort), 0) + 1 from public.product_media m where m.product_id = p_product), p_user)
  returning id into v_id;
  return v_id;
end;
$$;

-- M2, L8
create or replace function public.stage_import(p_partner_org uuid, p_supplier uuid, p_mode text, p_file_name text, p_sha256 text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_file_name, ''));
  sp public.suppliers;
  j public.import_jobs;
  v_created boolean := false;
  v_inserted integer;
  v_n integer;
  v_valid integer;
  v_invalid integer;
  v_dup integer;
  v_status text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_partner_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_partner_org);
  perform private.require_consent();
  perform private.check_rate_limit('import_stage:' || v_user, 30, interval '1 hour');
  if p_mode is null or p_mode not in ('create_only', 'create_or_update') then perform private.raise_error('invalid', 'invalid_mode'); end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then perform private.raise_error('invalid', 'invalid_file_hash'); end if;
  v_name := regexp_replace(v_name, '^.*[\\/]', '');
  if char_length(v_name) < 1 or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_file_name'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 then perform private.raise_error('invalid', 'empty_file'); end if;
  if v_n > 2000 then perform private.raise_error('invalid', 'too_many_rows'); end if;
  if pg_column_size(p_rows) > 8000000 then perform private.raise_error('invalid', 'file_too_large'); end if;

  select * into sp from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_partner_org for share;
  if sp.id is null then perform private.raise_error('not_found'); end if;
  if sp.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;

  -- L8: a repeated _row would otherwise surface as a primary-key violation.
  if exists (
    select 1 from (
      select case when jsonb_typeof(a.x) = 'object' and (a.x ->> '_row') ~ '^[0-9]{1,7}$' and (a.x ->> '_row')::integer > 0
                  then (a.x ->> '_row')::integer else a.ord::integer end row_no
      from jsonb_array_elements(p_rows) with ordinality a (x, ord)) q
    group by q.row_no having count(*) > 1
  ) then perform private.raise_error('invalid', 'invalid_row_number'); end if;

  insert into public.import_jobs (partner_org_id, supplier_id, mode, file_name, file_sha256, created_by)
  values (p_partner_org, p_supplier, p_mode, left(v_name, 200), p_sha256, v_user)
  on conflict (partner_org_id, supplier_id, file_sha256, mode) where status = 'previewed' do nothing;
  get diagnostics v_inserted = row_count;
  v_created := v_inserted = 1;
  select * into j from public.import_jobs x
  where x.partner_org_id = p_partner_org and x.supplier_id = p_supplier and x.file_sha256 = p_sha256 and x.mode = p_mode
    and x.status = 'previewed' for update;
  if j.id is null then perform private.raise_error('conflict', 'import_busy'); end if;
  -- M2: a retry of the same file returns the job only while it is still previewed; once committed (or failed or
  -- cancelled) the same file creates a new job.
  if not v_created then
    return jsonb_build_object('job_id', j.id, 'created', false, 'status', j.status, 'counts', j.counts,
      'rows', private.import_rows_json(j.id, 'problems', 0, 200));
  end if;
  delete from public.import_rows where job_id = j.id;

  insert into public.import_rows (job_id, row_no, sku, status, action, errors, data)
  with src as (
    select a.ord, a.x,
           case when jsonb_typeof(a.x) = 'object' and (a.x ->> '_row') ~ '^[0-9]{1,7}$' and (a.x ->> '_row')::integer > 0
                then (a.x ->> '_row')::integer else a.ord::integer end row_no
    from jsonb_array_elements(p_rows) with ordinality a (x, ord)
  ), chk as (
    select s.row_no, private.check_import_row(p_partner_org, p_supplier, p_mode, s.x) r from src s
  ), dup as (
    select c.row_no from (select x.row_no, row_number() over (partition by lower(x.r ->> 'sku') order by x.row_no) rn
                          from chk x where x.r ->> 'sku' is not null) c where c.rn > 1
  )
  select j.id, c.row_no, c.r ->> 'sku',
         case when c.row_no in (select row_no from dup) then 'duplicate'
              when jsonb_array_length(c.r -> 'errors') > 0 then 'invalid' else 'valid' end,
         case when jsonb_array_length(c.r -> 'errors') = 0 and c.row_no not in (select row_no from dup) then c.r ->> 'action' end,
         case when c.row_no in (select row_no from dup) then (c.r -> 'errors') || '"duplicate_sku_in_file"'::jsonb else c.r -> 'errors' end,
         c.r -> 'data'
  from chk c;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_n then perform private.raise_error('invalid', 'invalid_row_number'); end if;

  select count(*) filter (where status = 'valid'), count(*) filter (where status = 'invalid'), count(*) filter (where status = 'duplicate')
    into v_valid, v_invalid, v_dup from public.import_rows where job_id = j.id;
  v_status := case when v_valid = 0 then 'failed' else 'previewed' end;
  update public.import_jobs set status = v_status, counts = jsonb_build_object('total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup),
    created_by = v_user, overwrite_confirmed = false, committed_at = null, committed_by = null, updated_at = now()
  where id = j.id;
  perform private.write_audit('catalogue.import_staged', p_partner_org, 'import_job', j.id::text,
    jsonb_build_object('mode', p_mode, 'total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup, 'supplier_id', p_supplier));
  return jsonb_build_object('job_id', j.id, 'created', v_created, 'status', v_status,
    'counts', jsonb_build_object('total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup),
    'rows', private.import_rows_json(j.id, 'problems', 0, 200));
end;
$$;

-- M1
create or replace function public.submit_sourcing_request(p_buyer_org uuid, p_key text, p_items jsonb, p_destination_state text,
  p_destination_city text, p_needed_by date, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_type public.org_type;
  v_city text := private.clean_text(p_destination_city, 1, 80, 'invalid_district');
  v_notes text := private.clean_text(p_notes, 1, 2000, 'invalid_notes');
  v_hash text;
  r public.sourcing_requests;
  el jsonb;
  v_n integer;
  v_pid uuid;
  v_first uuid;
  v_sup uuid;
  sp public.suppliers;
  v_qty text;
  v_lines jsonb := '[]'::jsonb;
  v_snap jsonb;
  v_ref text;
  v_try integer := 0;
  v_new boolean := false;
  v_id uuid;
  v_seen text[] := array[]::text[];
  v_key text;
  v_vsku text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_buyer_org, 'request:post') then perform private.raise_error('forbidden'); end if;
  select o.type into v_type from public.organisations o where o.id = p_buyer_org;
  if v_type not in ('buyer', 'business') then perform private.raise_error('invalid', 'invalid_org_type'); end if;
  perform private.require_consent();
  if p_key is null or char_length(p_key) not between 8 and 80 then perform private.raise_error('invalid', 'invalid_data'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 then perform private.raise_error('invalid', 'items_required'); end if;
  if v_n > 20 then perform private.raise_error('invalid', 'too_many_items'); end if;
  if p_destination_state is null or not private.valid_state(p_destination_state) then perform private.raise_error('invalid', 'invalid_state'); end if;
  if p_needed_by is not null and (p_needed_by < current_date or p_needed_by > current_date + 730) then perform private.raise_error('invalid', 'invalid_date'); end if;
  v_hash := encode(extensions.digest(jsonb_build_object('i', p_items, 's', p_destination_state, 'c', v_city, 'd', p_needed_by, 'n', v_notes)::text, 'sha256'), 'hex');

  select * into r from public.sourcing_requests x where x.buyer_org_id = p_buyer_org and x.idempotency_key = p_key;
  if r.id is not null then
    if r.payload_hash <> v_hash then perform private.raise_error('conflict', 'idempotency_key_reused'); end if;
    return jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'created', false);
  end if;
  perform private.check_rate_limit('srcreq:' || v_user, 40, interval '1 day');

  -- Resolve every line. The first product decides the supplier; all lines must share it (supplier row locked first).
  for el in select jsonb_array_elements(p_items) loop
    if jsonb_typeof(el) <> 'object' or exists (select 1 from jsonb_object_keys(el) kk where kk not in ('product_id', 'variant_sku', 'quantity')) then
      perform private.raise_error('invalid', 'invalid_data');
    end if;
    begin
      v_pid := (el ->> 'product_id')::uuid;
    exception when others then
      perform private.raise_error('invalid', 'invalid_data');
    end;
    v_qty := el ->> 'quantity';
    if v_qty is null or v_qty !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' or private.safe_numeric(v_qty) <= 0 then perform private.raise_error('invalid', 'invalid_quantity'); end if;
    v_vsku := nullif(btrim(coalesce(el ->> 'variant_sku', '')), '');
    v_key := v_pid::text || '|' || coalesce(lower(v_vsku), '');
    if v_key = any (v_seen) then perform private.raise_error('invalid', 'duplicate_item'); end if;
    v_seen := v_seen || v_key;
    if v_first is null then
      v_first := v_pid;
      select p.supplier_id into v_sup from public.products p where p.id = v_pid and p.status = 'published';
      if v_sup is null then perform private.raise_error('not_found'); end if;
      select * into sp from public.suppliers x where x.id = v_sup for share;
    end if;
    if not exists (select 1 from public.products p where p.id = v_pid and p.status = 'published' and p.supplier_id = v_sup) then
      if exists (select 1 from public.products p where p.id = v_pid and p.status = 'published') then
        perform private.raise_error('invalid', 'mixed_suppliers');
      end if;
      perform private.raise_error('not_found');
    end if;
    if not private.product_visible(v_pid) then perform private.raise_error('conflict', 'supplier_not_available'); end if;
    -- M1: lock the product row so the snapshot cannot mix revisions with a concurrent publish/unpublish.
    perform 1 from public.products p where p.id = v_pid and p.status = 'published' for share;
    if not found then perform private.raise_error('not_found'); end if;
    v_snap := private.sourcing_snapshot(v_pid, v_vsku, private.safe_numeric(v_qty));
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'variant_sku', v_vsku, 'quantity', private.safe_numeric(v_qty),
      'unit', v_snap ->> 'unit', 'snapshot', v_snap));
  end loop;

  loop
    v_try := v_try + 1;
    v_ref := private.new_sourcing_reference();
    insert into public.sourcing_requests (reference, buyer_org_id, partner_org_id, supplier_id, supplier_name, destination_state,
      destination_city, needed_by, notes, idempotency_key, payload_hash, created_by)
    values (v_ref, p_buyer_org, sp.partner_org_id, sp.id, sp.live_name, p_destination_state, v_city, p_needed_by, v_notes, p_key, v_hash, v_user)
    on conflict do nothing returning id into v_id;
    exit when v_id is not null or v_try >= 5;
    -- A conflict is either the idempotency key (a concurrent retry) or, very rarely, the reference.
    select * into r from public.sourcing_requests x where x.buyer_org_id = p_buyer_org and x.idempotency_key = p_key;
    if r.id is not null then
      if r.payload_hash <> v_hash then perform private.raise_error('conflict', 'idempotency_key_reused'); end if;
      return jsonb_build_object('id', r.id, 'reference', r.reference, 'status', r.status, 'created', false);
    end if;
  end loop;
  if v_id is null then perform private.raise_error('conflict', 'reference_unavailable'); end if;

  insert into public.sourcing_request_items (request_id, line_no, product_id, variant_id, snapshot, quantity, unit)
  select v_id, x.ord::integer, (x.l ->> 'product_id')::uuid,
         (select cv.id from public.catalogue_variants cv where cv.product_id = (x.l ->> 'product_id')::uuid and lower(cv.sku) = lower(x.l ->> 'variant_sku')),
         x.l -> 'snapshot', (x.l ->> 'quantity')::numeric, x.l ->> 'unit'
  from jsonb_array_elements(v_lines) with ordinality x (l, ord);
  insert into public.sourcing_request_events (request_id, actor_user_id, kind) values (v_id, v_user, 'submitted');
  perform private.write_audit('sourcing.submitted', p_buyer_org, 'sourcing_request', v_id::text,
    jsonb_build_object('reference', v_ref, 'partner_org_id', sp.partner_org_id, 'supplier_id', sp.id, 'lines', v_n));
  perform private.notify_org(sp.partner_org_id, 'sourcing:respond', 'sourcing.received', 'sourcing_request', v_id::text);
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'submitted', 'created', true);
end;
$$;

-- M5 / M4: policies. Reviewers never see records of a partner they were involved with; supplier_private
-- additionally needs supplier:manage (aal2 for owners) for members.
drop policy suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.is_member(partner_org_id)
         or (private.has_platform_permission('supplier:review') and (status <> 'draft' or draft_submitted_version is not null)
             and not private.has_partner_involvement(partner_org_id, auth.uid())));

drop policy supplier_private_select on public.supplier_private;
create policy supplier_private_select on public.supplier_private for select to authenticated
  using (exists (
    select 1 from public.suppliers s
    where s.id = supplier_id
      and (private.has_permission(s.partner_org_id, 'supplier:manage')
           or (private.has_platform_permission('supplier:review') and (s.status <> 'draft' or s.draft_submitted_version is not null)
               and not private.has_partner_involvement(s.partner_org_id, auth.uid())))));

drop policy supplier_documents_select on public.supplier_documents;
create policy supplier_documents_select on public.supplier_documents for select to authenticated
  using (private.is_member(partner_org_id)
         or (locked and private.has_platform_permission('supplier:review') and not private.has_partner_involvement(partner_org_id, auth.uid())));

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (private.is_member(partner_org_id)
         or (private.has_platform_permission('catalogue:review') and status <> 'draft'
             and not private.has_partner_involvement(partner_org_id, auth.uid())));

drop policy product_revisions_select on public.product_revisions;
create policy product_revisions_select on public.product_revisions for select to authenticated
  using (private.is_member(partner_org_id)
         or (private.has_platform_permission('catalogue:review') and not private.has_partner_involvement(partner_org_id, auth.uid())));

drop policy product_media_select on public.product_media;
create policy product_media_select on public.product_media for select to authenticated
  using (private.is_member(partner_org_id) or (private.has_platform_permission('catalogue:review')
         and not private.has_partner_involvement(partner_org_id, auth.uid())
         and exists (select 1 from public.products p where p.id = product_id)));

-- The reviewer branches above call this helper from RLS, which runs as the calling role.
grant execute on function private.has_partner_involvement(uuid, uuid) to authenticated;
