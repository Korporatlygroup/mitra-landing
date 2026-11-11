-- Phase 4 erasure: owned conversation data follows its organisation; surviving
-- conversations lose deleted user identifiers but keep their commercial history.
-- Audit events retain their action and time, with erased identities/details removed.

alter table public.enquiry_messages alter column sender_user_id drop not null;
alter table public.quotations alter column created_by drop not null;
alter table public.lead_activities alter column actor_user_id drop not null;
alter table public.referral_suggestions alter column created_by drop not null;
alter table public.business_reviews alter column author_user_id drop not null;
alter table public.referral_handoffs alter column opened_by drop not null;
alter table public.buyer_requests alter column created_by drop not null;
alter table public.enquiries alter column created_by drop not null;
alter table public.content_reports alter column reporter_user_id drop not null;
alter table public.listing_events alter column org_id drop not null;
alter table public.verification_events alter column org_id drop not null;

alter table public.enquiry_messages drop constraint enquiry_messages_sender_user_id_fkey,
  add constraint enquiry_messages_sender_user_id_fkey foreign key (sender_user_id) references auth.users(id) on delete set null;
alter table public.quotations drop constraint quotations_created_by_fkey,
  add constraint quotations_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.lead_activities drop constraint lead_activities_actor_user_id_fkey,
  add constraint lead_activities_actor_user_id_fkey foreign key (actor_user_id) references auth.users(id) on delete set null;
alter table public.referral_suggestions drop constraint referral_suggestions_created_by_fkey,
  add constraint referral_suggestions_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.business_reviews drop constraint business_reviews_author_user_id_fkey,
  add constraint business_reviews_author_user_id_fkey foreign key (author_user_id) references auth.users(id) on delete set null;
alter table public.referral_handoffs add constraint referral_handoffs_opened_by_fkey
  foreign key (opened_by) references auth.users(id) on delete set null;

alter table public.enquiry_messages drop constraint enquiry_messages_sender_org_id_fkey,
  add constraint enquiry_messages_sender_org_id_fkey foreign key (sender_org_id) references public.organisations(id) on delete cascade;
alter table public.quotations drop constraint quotations_seller_org_id_fkey,
  add constraint quotations_seller_org_id_fkey foreign key (seller_org_id) references public.organisations(id) on delete cascade;
alter table public.quotations drop constraint quotations_buyer_org_id_fkey,
  add constraint quotations_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations(id) on delete cascade;
alter table public.quotation_drafts drop constraint quotation_drafts_seller_org_id_fkey,
  add constraint quotation_drafts_seller_org_id_fkey foreign key (seller_org_id) references public.organisations(id) on delete cascade;
alter table public.lead_activities drop constraint lead_activities_seller_org_id_fkey,
  add constraint lead_activities_seller_org_id_fkey foreign key (seller_org_id) references public.organisations(id) on delete cascade;
alter table public.referral_suggestions drop constraint referral_suggestions_buyer_org_id_fkey,
  add constraint referral_suggestions_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations(id) on delete cascade;
alter table public.referral_suggestions drop constraint referral_suggestions_referrer_seller_org_id_fkey,
  add constraint referral_suggestions_referrer_seller_org_id_fkey foreign key (referrer_seller_org_id) references public.organisations(id) on delete cascade;
alter table public.referral_suggestions drop constraint referral_suggestions_proposed_seller_org_id_fkey,
  add constraint referral_suggestions_proposed_seller_org_id_fkey foreign key (proposed_seller_org_id) references public.organisations(id) on delete cascade;
alter table public.business_reviews drop constraint business_reviews_buyer_org_id_fkey,
  add constraint business_reviews_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations(id) on delete cascade;
alter table public.business_reviews drop constraint business_reviews_seller_org_id_fkey,
  add constraint business_reviews_seller_org_id_fkey foreign key (seller_org_id) references public.organisations(id) on delete cascade;

-- Sent quote history remains immutable while its quotation exists. When an
-- organisation erasure cascades the quotation, its versions and lines may go.
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

-- A user who opened a Phase 3 request/enquiry can be deleted while the
-- organisation's request/conversation remains visible to its active members.
-- These columns were historical UUIDs without foreign keys.
create or replace function private.enquiries_immutable_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.buyer_org_id is distinct from old.buyer_org_id
     or new.seller_org_id is distinct from old.seller_org_id or new.buyer_request_id is distinct from old.buyer_request_id
     or new.origin is distinct from old.origin
     or (new.created_by is distinct from old.created_by and
         not (new.created_by is null and current_setting('mitra.erasure_actor', true) = old.created_by::text))
     or new.opened_by_org_id is distinct from old.opened_by_org_id or new.topic is distinct from old.topic
     or new.opening_note is distinct from old.opening_note or new.created_at is distinct from old.created_at then
    raise exception 'immutable_columns' using errcode = 'PT409';
  end if;
  return new;
end $$;

-- Normal API roles still have no UPDATE/DELETE on audit_log. Only the trusted
-- erasure triggers set this transaction-local flag; even then action/time/source
-- and event identity remain immutable and details can only be erased.
create or replace function private.audit_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_setting('mitra.erasure_audit', true) = 'on'
     and current_user = 'postgres'
     and new.id = old.id and new.at = old.at and new.action = old.action and new.source = old.source
     and new.entity_type is not distinct from old.entity_type
     and (new.actor_user_id is not distinct from old.actor_user_id or new.actor_user_id is null)
     and (new.actor_org_id is not distinct from old.actor_org_id or new.actor_org_id is null)
     and (new.org_id is not distinct from old.org_id or new.org_id is null)
     and (new.entity_id is not distinct from old.entity_id or new.entity_id is null)
     and new.details = '{}'::jsonb then
    return new;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

create or replace function private.listing_events_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user = 'postgres'
     and current_setting('mitra.erasure_actor', true) = old.actor_user_id::text
     and new.actor_user_id is null and new.id = old.id and new.at = old.at
     and new.org_id = old.org_id and new.event = old.event and new.details = '{}'::jsonb then
    return new;
  end if;
  if tg_op = 'UPDATE' and current_user = 'postgres'
     and current_setting('mitra.erasure_org', true) = old.org_id::text
     and new.org_id is null and new.id = old.id and new.at = old.at
     and new.actor_user_id is not distinct from old.actor_user_id
     and new.event = old.event and new.details = '{}'::jsonb then
    return new;
  end if;
  raise exception 'listing_events is append-only' using errcode = '42501';
end $$;

create or replace function private.verification_events_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user = 'postgres'
     and current_setting('mitra.erasure_actor', true) = old.actor_user_id::text
     and new.actor_user_id is null and new.id = old.id and new.at = old.at
     and new.claim_id = old.claim_id and new.org_id = old.org_id
     and new.event = old.event and new.details = '{}'::jsonb then
    return new;
  end if;
  if tg_op = 'UPDATE' and current_user = 'postgres'
     and current_setting('mitra.erasure_org', true) = old.org_id::text
     and new.org_id is null and new.id = old.id and new.at = old.at
     and new.claim_id = old.claim_id and new.actor_user_id is not distinct from old.actor_user_id
     and new.event = old.event and new.details = '{}'::jsonb then
    return new;
  end if;
  raise exception 'verification_events is append-only' using errcode = '42501';
end $$;

create function private.redact_deleted_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_previous text;
begin
  v_previous := current_setting('mitra.erasure_actor', true);
  perform set_config('mitra.erasure_actor', old.id::text, true);
  update public.buyer_requests set created_by = null where created_by = old.id;
  update public.enquiries set created_by = null where created_by = old.id;
  update public.listing_events set actor_user_id = null, details = '{}'::jsonb where actor_user_id = old.id;
  update public.verification_events set actor_user_id = null, details = '{}'::jsonb where actor_user_id = old.id;
  perform set_config('mitra.erasure_actor', coalesce(v_previous, ''), true);

  update public.business_profiles set updated_by = null where updated_by = old.id;
  update public.business_listings set submitted_by = null where submitted_by = old.id;
  update public.business_listings set suspended_by = null where suspended_by = old.id;
  update public.buyer_requests set removed_by = null where removed_by = old.id;
  update public.request_seller_matches set invited_by = null where invited_by = old.id;
  update public.content_reports set reporter_user_id = null where reporter_user_id = old.id;
  update public.content_reports set handled_by = null where handled_by = old.id;
  update public.verification_claims set submitted_by = null where submitted_by = old.id;
  update public.verification_claims set decided_by = null where decided_by = old.id;
  update public.verification_documents set uploaded_by = null where uploaded_by = old.id;
  update public.business_listings set decided_by = null where decided_by = old.id;
  delete from public.rate_limit_events where strpos(key, old.id::text) > 0
    or (old.email is not null and strpos(key, old.email) > 0);

  v_previous := current_setting('mitra.erasure_audit', true);
  perform set_config('mitra.erasure_audit', 'on', true);
  update public.audit_log
    set actor_user_id = case when actor_user_id = old.id then null else actor_user_id end,
        entity_id = case when entity_id = old.id::text then null else entity_id end,
        details = '{}'::jsonb
    where actor_user_id = old.id or entity_id = old.id::text
       or strpos(details::text, old.id::text) > 0
       or (old.email is not null and strpos(details::text, old.email) > 0);
  perform set_config('mitra.erasure_audit', coalesce(v_previous, ''), true);
  return old;
end $$;
create trigger zz_redact_deleted_user after delete on auth.users
  for each row execute function private.redact_deleted_user();

create function private.redact_deleted_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_previous text;
begin
  v_previous := current_setting('mitra.erasure_org', true);
  perform set_config('mitra.erasure_org', old.id::text, true);
  update public.listing_events set org_id = null, details = '{}'::jsonb where org_id = old.id;
  update public.verification_events set org_id = null, details = '{}'::jsonb where org_id = old.id;
  perform set_config('mitra.erasure_org', coalesce(v_previous, ''), true);

  v_previous := current_setting('mitra.erasure_audit', true);
  perform set_config('mitra.erasure_audit', 'on', true);
  update public.audit_log
    set actor_org_id = case when actor_org_id = old.id then null else actor_org_id end,
        org_id = case when org_id = old.id then null else org_id end,
        entity_id = case when entity_id = old.id::text then null else entity_id end,
        details = '{}'::jsonb
    where actor_org_id = old.id or org_id = old.id or entity_id = old.id::text
       or details::text like '%' || old.id::text || '%';
  perform set_config('mitra.erasure_audit', coalesce(v_previous, ''), true);
  return old;
end $$;
create trigger zz_redact_deleted_org after delete on public.organisations
  for each row execute function private.redact_deleted_org();

revoke all on function private.redact_deleted_user(), private.redact_deleted_org() from public, anon, authenticated, service_role;
