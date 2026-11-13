-- Phase 5 review fixes, second independent review of 000115. Local only; 110-115 are untouched.
-- M1 supplier_events reads follow the same reviewer predicate as suppliers (conflict of interest + draft filter);
-- M2 a documents-only resubmission is allowed; M3 formula_text strips only intended invisibles (tab/CR stay formula risks,
-- as before 000115); M4 has_partner_involvement answers only about the caller.
-- Functions are re-created with CREATE OR REPLACE (signatures unchanged, so grants are kept).

-- M3: invisible characters that are skipped before the formula check: space, NBSP, soft hyphen, ZWSP, ZWNJ, ZWJ,
-- word joiner, BOM. Tab, CR and newline are NOT skipped: a leading tab/CR is itself a formula risk (as in 000110),
-- and a leading newline ahead of "- bullet" in a multi-line description behaves as it did before 000115.
create or replace function private.formula_text(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and regexp_replace(p, '^[  ­​‌‍⁠﻿]+', '') ~ E'^[=+@\t\r-]'
$$;

-- M4: the helper used inside RLS and RPCs; it may only be asked about the calling user, so it cannot probe others.
create or replace function private.has_partner_involvement(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_user = auth.uid()
    and (private.has_org_involvement(p_org, p_user)
         or exists (select 1 from public.partner_profiles pp where pp.org_id = p_org and pp.provisioned_by = p_user)),
    false)
$$;

-- M1: same reviewer predicate as suppliers_select (not the draft, not a partner the reviewer was involved with).
drop policy supplier_events_select on public.supplier_events;
create policy supplier_events_select on public.supplier_events for select to authenticated
  using (private.is_member(partner_org_id)
         or (private.has_platform_permission('supplier:review')
             and not private.has_partner_involvement(partner_org_id, auth.uid())
             and exists (select 1 from public.suppliers s
                         where s.id = supplier_events.supplier_id and (s.status <> 'draft' or s.draft_submitted_version is not null))));

-- M2: nothing_to_submit no longer blocks a documents-only resubmission: a clean, non-removed document registered after
-- the last decision (approved / rejected / more_info_requested / reinstated) counts as a change.
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
  v_last_decision timestamptz;
  v_new_doc boolean;
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
  select max(e.at) into v_last_decision from public.supplier_events e
  where e.supplier_id = s.id and e.kind in ('approved', 'rejected', 'more_info_requested', 'reinstated');
  v_new_doc := exists (select 1 from public.supplier_documents d
                       where d.supplier_id = s.id and d.removed_at is null and d.scan_status = 'clean'
                         and (v_last_decision is null or d.created_at > v_last_decision));
  if s.status = 'approved' and s.live_draft_version is not distinct from s.draft_version and not v_new_doc then
    perform private.raise_error('conflict', 'nothing_to_submit');
  end if;
  -- A rejected / more_info_needed supplier goes back to draft on the first edit, so these statuses mean "unchanged"
  -- unless a new clean document was added after the decision.
  if s.status in ('rejected', 'more_info_needed') and not v_new_doc then perform private.raise_error('conflict', 'nothing_to_submit'); end if;
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
