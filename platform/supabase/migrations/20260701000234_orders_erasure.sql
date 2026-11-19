-- Erasure for agreements. Additive: only foreign-key delete actions change; no table, column or policy is added or removed.
--
-- Problem (found by 13_p4_erasure E0, failing since 000231): orders and deal_events pointed at organisations, enquiries, quotations and
-- quotation versions with NO ACTION, so erasing a business, a buyer, an enquiry or a user who took part in an agreement was blocked.
--
-- Rule, the same as for the enquiry itself, its messages and its quotations (000106): when an organisation is erased, everything that exists only
-- because of the conversation between the two organisations goes with it. The other organisation keeps its profile, its other enquiries and its
-- other agreements. The append-only audit_log has no foreign keys and is untouched, so the audit trail of "order.*" actions survives erasure.
-- A person's user id is never left behind: deal_events.actor_user_id becomes a real reference that is set to null when the user is erased
-- (like every other authorship column since 000106). Sent quotation versions stay immutable: they are removed only by the cascade, never directly.

alter table public.orders
  drop constraint orders_enquiry_id_fkey,
  drop constraint orders_quotation_id_fkey,
  drop constraint orders_quote_version_id_fkey,
  drop constraint orders_buyer_org_id_fkey,
  drop constraint orders_seller_org_id_fkey,
  add constraint orders_enquiry_id_fkey foreign key (enquiry_id) references public.enquiries (id) on delete cascade,
  add constraint orders_quotation_id_fkey foreign key (quotation_id) references public.quotations (id) on delete cascade,
  add constraint orders_quote_version_id_fkey foreign key (quote_version_id) references public.quotation_versions (id) on delete cascade,
  add constraint orders_buyer_org_id_fkey foreign key (buyer_org_id) references public.organisations (id) on delete cascade,
  add constraint orders_seller_org_id_fkey foreign key (seller_org_id) references public.organisations (id) on delete cascade;

-- An event's actor organisation is one of the two organisations of the enquiry, so its events leave with the enquiry; the cascade is also set
-- here so that no event can ever block the erasure of an organisation.
alter table public.deal_events
  drop constraint deal_events_enquiry_id_fkey,
  drop constraint deal_events_order_id_fkey,
  drop constraint deal_events_actor_org_id_fkey,
  add constraint deal_events_enquiry_id_fkey foreign key (enquiry_id) references public.enquiries (id) on delete cascade,
  add constraint deal_events_order_id_fkey foreign key (order_id) references public.orders (id) on delete cascade,
  add constraint deal_events_actor_org_id_fkey foreign key (actor_org_id) references public.organisations (id) on delete cascade;

-- actor_user_id was a bare uuid. Clear any id that no longer exists, then make it a reference that is cleared on erasure.
update public.deal_events set actor_user_id = null where actor_user_id is not null and not exists (select 1 from auth.users u where u.id = deal_events.actor_user_id);
alter table public.deal_events
  add constraint deal_events_actor_user_id_fkey foreign key (actor_user_id) references auth.users (id) on delete set null;
