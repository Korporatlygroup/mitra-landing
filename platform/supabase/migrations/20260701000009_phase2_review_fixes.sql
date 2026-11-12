-- Phase 2 independent-review fixes: H1 (conflict of interest), M1 (evidence still clean), L1, L2, L4.

------------------------------------------------------------------------------------------------
-- H1: a reviewer may never decide on, or open documents of, an organisation they have EVER been involved with
-- (any membership row including removed ones, submissions, uploads, profile edits).
------------------------------------------------------------------------------------------------
create function private.has_org_involvement(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user)
      or exists (select 1 from public.verification_claims c where c.org_id = p_org and c.submitted_by = p_user)
      or exists (select 1 from public.verification_events e
                 where e.org_id = p_org and e.actor_user_id = p_user
                   and e.event in ('claim_created', 'document_uploaded', 'document_removed', 'submitted', 'resubmitted', 'withdrawn'))
      or exists (select 1 from public.business_profiles bp where bp.org_id = p_org and bp.updated_by = p_user)
$$;

create or replace function public.start_review(p_claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claim public.verification_claims;
  v_org_status public.org_status;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:review') then perform private.raise_error('forbidden'); end if;
  select * into v_claim from public.verification_claims c where c.id = p_claim for update;
  if v_claim.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(v_claim.org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  select o.status into v_org_status from public.organisations o where o.id = v_claim.org_id;
  if v_org_status is distinct from 'active' then perform private.raise_error('conflict', 'org_not_active'); end if;
  if v_claim.status <> 'submitted' then perform private.raise_error('conflict', 'claim_not_reviewable'); end if;
  update public.verification_claims set status = 'in_review', reviewer_id = v_user, updated_at = now() where id = p_claim;
  perform private.add_event(p_claim, v_claim.org_id, v_user, 'review_started', jsonb_build_object('version', v_claim.version));
end;
$$;

-- M1: approving requires every document attached to this version to still be clean and present.
create or replace function public.decide_claim(p_claim uuid, p_decision text, p_reason text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claim public.verification_claims;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_status public.claim_status;
  v_event text;
  v_org_status public.org_status;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:decide') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_info') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;

  select * into v_claim from public.verification_claims c where c.id = p_claim for update;
  if v_claim.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(v_claim.org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  select o.status into v_org_status from public.organisations o where o.id = v_claim.org_id;
  if v_org_status is distinct from 'active' then perform private.raise_error('conflict', 'org_not_active'); end if;
  if v_claim.status not in ('submitted', 'in_review') then perform private.raise_error('conflict', 'claim_not_reviewable'); end if;
  if v_claim.version is distinct from p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;

  if p_decision = 'approve' and (
    not exists (select 1 from public.verification_claim_documents j where j.claim_id = p_claim and j.version = v_claim.version)
    or exists (
      select 1 from public.verification_claim_documents j
      join public.verification_documents d on d.id = j.document_id
      where j.claim_id = p_claim and j.version = v_claim.version and (d.scan_status <> 'clean' or d.removed_at is not null)
    )
  ) then
    perform private.raise_error('conflict', 'evidence_not_clean');
  end if;

  v_status := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_info' end;
  v_event := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'info_requested' end;

  update public.verification_claims set status = v_status, decided_at = now(), decided_by = v_user,
    decision_reason = v_reason, reviewer_id = coalesce(reviewer_id, v_user), updated_at = now()
  where id = p_claim;

  perform private.add_event(p_claim, v_claim.org_id, v_user, v_event,
    jsonb_build_object('version', v_claim.version, 'reason', v_reason));
  perform private.write_audit('verification.' || v_event, v_claim.org_id, 'verification_claim', p_claim::text,
    jsonb_build_object('claim_type', v_claim.claim_type, 'version', v_claim.version));

  insert into public.notifications (user_id, org_id, kind, entity_type, entity_id)
  select m.user_id, v_claim.org_id, 'verification.' || v_event, 'verification_claim', p_claim::text
  from public.memberships m
  where m.org_id = v_claim.org_id and m.status = 'active' and m.role in ('owner', 'manager');
end;
$$;

create or replace function public.get_document_access(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_doc public.verification_documents;
  v_allowed boolean := false;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('docaccess:' || v_user, 120, interval '1 hour');
  select * into v_doc from public.verification_documents d where d.id = p_doc;
  if v_doc.id is null then perform private.raise_error('not_found'); end if;

  if private.has_permission(v_doc.org_id, 'verification:read') then
    v_allowed := true;
  elsif private.has_platform_permission('verification:review')
        and not private.has_org_involvement(v_doc.org_id, v_user)
        and exists (
          select 1 from public.verification_claim_documents j
          join public.verification_claims c on c.id = j.claim_id
          where j.document_id = p_doc and c.status in ('submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale')
        ) then
    v_allowed := true;
  end if;
  if not v_allowed then perform private.raise_error('not_found'); end if;
  if v_doc.removed_at is not null or v_doc.scan_status <> 'clean' then perform private.raise_error('forbidden', 'document_not_available'); end if;

  perform private.add_event(v_doc.claim_id, v_doc.org_id, v_user, 'document_viewed', jsonb_build_object('document_id', p_doc));
  perform private.write_audit('verification.document_viewed', v_doc.org_id, 'verification_document', p_doc::text, '{}'::jsonb);
  return jsonb_build_object('storage_path', v_doc.storage_path, 'mime_type', v_doc.mime_type, 'display_name', v_doc.display_name);
end;
$$;

------------------------------------------------------------------------------------------------
-- L2: reviewers see only businesses that have actually submitted something.
------------------------------------------------------------------------------------------------
drop policy business_profiles_select on public.business_profiles;
create policy business_profiles_select on public.business_profiles for select to authenticated
  using (
    private.is_member(org_id)
    or (private.has_platform_permission('verification:review')
        and exists (select 1 from public.verification_claims c where c.org_id = business_profiles.org_id and c.status <> 'draft'))
  );

drop policy organisations_select_verification_staff on public.organisations;
create policy organisations_select_verification_staff on public.organisations for select to authenticated
  using (
    type = 'business' and private.has_platform_permission('verification:review')
    and exists (select 1 from public.verification_claims c where c.org_id = organisations.id and c.status <> 'draft')
  );

------------------------------------------------------------------------------------------------
-- L1: every member can see the verification STATUS of their own organisation (no documents, notes or reasons).
------------------------------------------------------------------------------------------------
create function public.get_verification_summary(p_org uuid)
returns table (claim_type public.claim_type, status public.claim_status, decided_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  return query
    select c.claim_type, c.status, c.decided_at from public.verification_claims c where c.org_id = p_org order by c.claim_type;
end;
$$;

revoke all on function private.has_org_involvement(uuid, uuid), public.get_verification_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_verification_summary(uuid) to authenticated;
