-- Phase 2 hardening from the DB test review.

-- Reviewers see metadata only of documents that were actually submitted; drafts stay private to the owner side.
drop policy verification_documents_select on public.verification_documents;
create policy verification_documents_select on public.verification_documents for select to authenticated
  using (
    private.has_permission(org_id, 'verification:read')
    or (
      private.has_platform_permission('verification:review')
      and exists (select 1 from public.verification_claim_documents j where j.document_id = id)
    )
  );

-- A clean document can still be flagged infected later (signature updates / re-scans); nothing else may change a final result.
create or replace function public.service_set_scan_result(p_doc uuid, p_status public.scan_status, p_engine text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.verification_documents;
begin
  select * into v_doc from public.verification_documents d where d.id = p_doc for update;
  if v_doc.id is null then perform private.raise_error('not_found'); end if;
  if p_status = 'pending' then perform private.raise_error('invalid', 'invalid_status'); end if;
  if not (v_doc.scan_status in ('pending', 'failed') or (v_doc.scan_status = 'clean' and p_status = 'infected')) then
    perform private.raise_error('conflict', 'already_scanned');
  end if;
  update public.verification_documents set scan_status = p_status, scan_engine = left(p_engine, 80), scanned_at = now() where id = p_doc;
  perform private.add_event(v_doc.claim_id, v_doc.org_id, null, 'scan_result',
    jsonb_build_object('document_id', p_doc, 'scan_status', p_status, 'previous', v_doc.scan_status));
end;
$$;
