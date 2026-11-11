-- Phase 3 integration migration: referral hand-off (Phase 3 owns the enquiries seam).
-- MUST run after the Phase 4 migrations (...103 schema, ...104 workflows): it reads public.referral_suggestions.
--
-- Phase 4 records a referral through proposed -> buyer_consented -> recipient_accepted, but may never insert into
-- public.enquiries (contract p3p4-contract/1.1, section 4). This function is the one place where an accepted referral
-- becomes a conversation: the RECIPIENT business opens the enquiry with the customer, using the Phase 3 opening path.
--
-- What it guarantees
--   * only an active member of the recipient organisation holding request:respond can call it; anyone else gets 404
--     (a member without the permission gets 403);
--   * the referral must be recipient_accepted, which Phase 4 only reaches after the buyer consented first;
--   * one enquiry per referral for ever (referral_handoffs primary key), and one open enquiry per
--     (buyer, recipient, request) through private.open_enquiry, so retries and double clicks return the same enquiry;
--   * the original request (if any) must still be open; the buyer organisation and the recipient listing must still be
--     active, published and accepting requests;
--   * the buyer's consent has no expiry and no withdrawal path in Phase 4 yet (accepted limit, see contract section 11); a closed or
--     blocked source enquiry stops the hand-off, and the topic is copied from the source enquiry (accepted, see contract);
--   * nothing from the original conversation is copied except its topic: no messages, no quotes, no notes, and no
--     identity of the referring business. The buyer's name/contact follow the existing share_contact rule.

create table public.referral_handoffs (
  referral_id uuid primary key references public.referral_suggestions (id) on delete cascade,
  enquiry_id uuid not null references public.enquiries (id) on delete cascade,
  opened_by uuid not null,
  created_at timestamptz not null default now()
);
create index referral_handoffs_enquiry on public.referral_handoffs (enquiry_id);
alter table public.referral_handoffs enable row level security;
create policy referral_handoffs_select on public.referral_handoffs for select to authenticated
  using (private.is_enquiry_member(enquiry_id));
grant select on public.referral_handoffs to authenticated;

create function public.open_referral_enquiry(p_referral uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  r public.referral_suggestions;
  e public.enquiries;
  q public.buyer_requests;
  v_done uuid;
  v_open jsonb;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  -- unlocked look first: a caller who is not allowed to know about the referral never takes its row lock
  select * into r from public.referral_suggestions where id = p_referral;
  if r.id is null or r.buyer_consented_at is null or not private.is_member(r.proposed_seller_org_id) then
    perform private.raise_error('not_found');   -- before the customer agrees, the recipient cannot tell that a referral exists
  end if;
  if not private.has_permission(r.proposed_seller_org_id, 'request:respond') then perform private.raise_error('forbidden'); end if;
  select * into r from public.referral_suggestions where id = p_referral for update;
  if r.id is null then perform private.raise_error('not_found'); end if;

  -- retry safety first: a referral that already has its enquiry always returns it, even if the request has closed since
  select h.enquiry_id into v_done from public.referral_handoffs h where h.referral_id = r.id;
  if v_done is not null then return jsonb_build_object('id', v_done, 'created', false); end if;

  if r.status <> 'recipient_accepted' or r.buyer_consented_at is null or r.recipient_accepted_at is null then
    perform private.raise_error('conflict', 'invalid_referral');
  end if;
  perform private.require_consent();

  select * into e from public.enquiries where id = r.enquiry_id;
  if e.id is null or e.status in ('blocked', 'closed') then perform private.raise_error('conflict', 'invalid_referral'); end if;
  if e.buyer_request_id is not null then
    select * into q from public.buyer_requests where id = e.buyer_request_id for share;
    if q.id is null or q.status <> 'open' or (q.expires_at is not null and q.expires_at <= now()) then
      perform private.raise_error('conflict', 'request_not_open');
    end if;
  end if;
  if not exists (select 1 from public.organisations o where o.id = r.buyer_org_id and o.status = 'active') then
    perform private.raise_error('conflict', 'invalid_referral');
  end if;
  if not exists (select 1 from public.business_listings l join public.organisations o on o.id = l.org_id and o.status = 'active'
                 where l.org_id = r.proposed_seller_org_id and l.live_status = 'published' and l.accepting_requests) then
    perform private.raise_error('conflict', 'seller_not_available');
  end if;

  perform private.check_rate_limit('refopen:' || v_user, 20, interval '1 day');
  v_open := private.open_enquiry(r.buyer_org_id, r.proposed_seller_org_id, e.buyer_request_id, 'referral', e.topic, null,
                                 r.proposed_seller_org_id, v_user);
  if (select x.status from public.enquiries x where x.id = (v_open ->> 'id')::uuid) = 'blocked' then
    perform private.raise_error('conflict', 'invalid_referral');
  end if;
  insert into public.referral_handoffs (referral_id, enquiry_id, opened_by)
  values (r.id, (v_open ->> 'id')::uuid, v_user)
  on conflict (referral_id) do nothing;
  perform private.write_audit('referral.enquiry_opened', r.proposed_seller_org_id, 'referral', r.id::text,
                              jsonb_build_object('enquiry_id', v_open ->> 'id', 'reused', not (v_open ->> 'created')::boolean));
  if (v_open ->> 'created')::boolean then
    perform private.notify_org(r.buyer_org_id, 'request:post', 'enquiry.opened', 'enquiry', v_open ->> 'id');
  end if;
  return v_open;
end;
$$;
revoke all on function public.open_referral_enquiry(uuid) from public, anon, authenticated, service_role;
grant execute on function public.open_referral_enquiry(uuid) to authenticated;
