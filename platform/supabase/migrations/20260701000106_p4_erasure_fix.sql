-- Phase 4 erasure fix. Additive: changes constraints and one trigger function; no applied migration is edited.
--
-- Problem: the Phase 4 tables (103) referenced public.organisations and auth.users with the default NO ACTION rule, so
-- deleting an organisation or a user that had ever sent a message, quote, lead note, referral or review failed with 23503.
-- Separately, the append-only guards on quotation_versions / quotation_line_items rejected every DELETE, which also
-- blocked the ON DELETE CASCADE that follows an enquiry (and therefore an organisation) being erased.
--
-- Rules (same model as Phase 1: organisations.created_by, invitations.* are SET NULL; membership-like rows CASCADE):
--  * Organisation columns on Phase 4 rows -> ON DELETE CASCADE. Every such row belongs to an enquiry, and Phase 3 already
--    cascades enquiries when either party organisation is erased (enquiries.buyer_org_id / seller_org_id). A referral
--    that names a third organisation (proposed_seller_org_id) disappears with that organisation but leaves the
--    enquiry between the buyer and the referrer intact.
--  * User (authorship) columns -> ON DELETE SET NULL, and the columns become nullable. The other party, and the user's
--    own organisation, still need the message / quote / lead note / referral / review; only the author link is erased.
--  * audit_log, listing_events, verification_events have no foreign keys, so erasure never touches them (unchanged).

alter table public.enquiry_messages
  drop constraint enquiry_messages_sender_org_id_fkey,
  drop constraint enquiry_messages_sender_user_id_fkey,
  alter column sender_user_id drop not null,
  add constraint enquiry_messages_sender_org_id_fkey foreign key (sender_org_id) references public.organisations (id) on delete cascade,
  add constraint enquiry_messages_sender_user_id_fkey foreign key (sender_user_id) references auth.users (id) on delete set null;

alter table public.quotations
  drop constraint quotations_seller_org_id_fkey,
  drop constraint quotations_buyer_org_id_fkey,
  drop constraint quotations_created_by_fkey,
  alter column created_by drop not null,
  add constraint quotations_seller_org_id_fkey foreign key (seller_org_id) references public.organisations (id) on delete cascade,
  add constraint quotations_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations (id) on delete cascade,
  add constraint quotations_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.quotation_drafts
  drop constraint quotation_drafts_seller_org_id_fkey,
  add constraint quotation_drafts_seller_org_id_fkey foreign key (seller_org_id) references public.organisations (id) on delete cascade;

alter table public.lead_activities
  drop constraint lead_activities_seller_org_id_fkey,
  drop constraint lead_activities_actor_user_id_fkey,
  alter column actor_user_id drop not null,
  add constraint lead_activities_seller_org_id_fkey foreign key (seller_org_id) references public.organisations (id) on delete cascade,
  add constraint lead_activities_actor_user_id_fkey foreign key (actor_user_id) references auth.users (id) on delete set null;

alter table public.referral_suggestions
  drop constraint referral_suggestions_buyer_org_id_fkey,
  drop constraint referral_suggestions_referrer_seller_org_id_fkey,
  drop constraint referral_suggestions_proposed_seller_org_id_fkey,
  drop constraint referral_suggestions_created_by_fkey,
  alter column created_by drop not null,
  add constraint referral_suggestions_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations (id) on delete cascade,
  add constraint referral_suggestions_referrer_seller_org_id_fkey foreign key (referrer_seller_org_id) references public.organisations (id) on delete cascade,
  add constraint referral_suggestions_proposed_seller_org_id_fkey foreign key (proposed_seller_org_id) references public.organisations (id) on delete cascade,
  add constraint referral_suggestions_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.business_reviews
  drop constraint business_reviews_buyer_org_id_fkey,
  drop constraint business_reviews_seller_org_id_fkey,
  drop constraint business_reviews_author_user_id_fkey,
  alter column author_user_id drop not null,
  add constraint business_reviews_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations (id) on delete cascade,
  add constraint business_reviews_seller_org_id_fkey foreign key (seller_org_id) references public.organisations (id) on delete cascade,
  add constraint business_reviews_author_user_id_fkey foreign key (author_user_id) references auth.users (id) on delete set null;

-- Sent quotes stay immutable: UPDATE is still always rejected, and a snapshot can still never be deleted on its own.
-- A DELETE is allowed only when its parent row is already gone, which happens only through the ON DELETE CASCADE chain
-- (organisation -> enquiry -> quotation -> version -> line item). No role has DELETE on these tables, so there is no
-- direct path to the parent-missing state.
create or replace function private.quotation_snapshot_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'quotation_versions' then
      if not exists (select 1 from public.quotations q where q.id = old.quotation_id) then return old; end if;
    elsif tg_table_name = 'quotation_line_items' then
      if not exists (select 1 from public.quotation_versions v where v.id = old.quote_version_id) then return old; end if;
    end if;
  end if;
  raise exception 'sent_quote_immutable' using errcode = 'PT409';
end $$;
revoke all on function private.quotation_snapshot_immutable() from public, anon, authenticated, service_role;
