-- Phase 3: directory, customer request board, matching. Schema, helpers, RLS.
-- Contract: platform/docs/contracts/phase3-phase4.md. All writes go through the RPCs in the next two migrations.
-- Public (anonymous) reads happen ONLY through security-definer RPCs; no table is granted to anon.

------------------------------------------------------------------------------------------------
-- Permissions
------------------------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('owner', 'listing:publish'), ('manager', 'listing:publish'),
  ('owner', 'request:post'), ('manager', 'request:post'), ('staff', 'request:post'),
  ('owner', 'request:respond'), ('manager', 'request:respond'), ('staff', 'request:respond'),
  ('admin_review', 'listing:review'), ('admin_super', 'listing:review'),
  ('admin_super', 'request:moderate'), ('admin_support', 'request:moderate');

------------------------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------------------------
create type public.listing_live_status as enum ('unpublished', 'published', 'suspended');
create type public.listing_review_status as enum ('editing', 'pending_review', 'changes_requested', 'rejected', 'approved');
create type public.request_status as enum ('draft', 'open', 'closed', 'expired', 'withdrawn', 'removed');
create type public.match_status as enum ('candidate', 'invited', 'interested', 'question', 'declined', 'expired', 'withdrawn');
create type public.enquiry_status as enum ('open', 'awaiting_buyer', 'awaiting_seller', 'closed', 'blocked');
create type public.enquiry_origin as enum ('listing', 'request_invitation', 'referral');
create type public.report_reason as enum ('misleading', 'offensive', 'spam', 'scam', 'other');

------------------------------------------------------------------------------------------------
-- Listings: one row per business. `draft` is what the owner edits; `live_*` and the service/portfolio
-- tables are the approved public snapshot. Editing the draft never changes what the public sees.
------------------------------------------------------------------------------------------------
create table public.business_listings (
  org_id uuid primary key references public.business_profiles (org_id) on delete cascade,
  slug text unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  live_status public.listing_live_status not null default 'unpublished',
  accepting_requests boolean not null default true,
  live_name text check (char_length(live_name) between 2 and 160),
  live_category_id uuid references public.business_categories (id),
  live_state text,
  live_district text check (char_length(live_district) <= 80),
  live_headline text check (char_length(live_headline) <= 160),
  live_description text check (char_length(live_description) <= 2000),
  live_show_phone boolean not null default false,
  live_show_email boolean not null default false,
  live_phone text check (live_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  live_email text check (char_length(live_email) <= 254),
  live_version integer not null default 0,
  published_at timestamptz,
  draft jsonb not null default '{}'::jsonb,
  draft_version integer not null default 0,
  review_status public.listing_review_status not null default 'editing',
  review_reason text check (char_length(review_reason) <= 1000),
  submitted_at timestamptz,
  submitted_by uuid,
  decided_at timestamptz,
  decided_by uuid,
  suspended_reason text check (char_length(suspended_reason) <= 1000),
  suspended_at timestamptz,
  suspended_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (live_status = 'unpublished' or slug is not null)
);
create index business_listings_public on public.business_listings (live_status, published_at desc);
create index business_listings_review on public.business_listings (review_status, submitted_at);

create table public.business_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.business_listings (org_id) on delete cascade,
  category_id uuid not null references public.business_categories (id),
  name text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 600),
  nationwide boolean not null default false,
  areas text[] not null default '{}',
  min_order_qty numeric(14, 3) check (min_order_qty > 0),
  min_order_unit text check (char_length(min_order_unit) <= 30),
  lead_time_days integer check (lead_time_days between 0 and 365),
  capacity_note text check (char_length(capacity_note) <= 300),
  sort integer not null default 0,
  check (nationwide or cardinality(areas) > 0)
);
create index business_services_org on public.business_services (org_id);
create index business_services_category on public.business_services (category_id);

create table public.business_portfolio (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.business_listings (org_id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  description text check (char_length(description) <= 600),
  sort integer not null default 0
);
create index business_portfolio_org on public.business_portfolio (org_id);

-- Append-only moderation and lifecycle history for a listing.
create table public.listing_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  org_id uuid not null,
  actor_user_id uuid,
  event text not null check (event in ('submitted', 'withdrawn', 'approved', 'rejected', 'changes_requested',
    'suspended', 'reinstated', 'unpublished', 'republished')),
  details jsonb not null default '{}'::jsonb
);
create index listing_events_org on public.listing_events (org_id, at);

create function private.listing_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'listing_events is append-only' using errcode = '42501';
end;
$$;
create trigger listing_events_no_update_delete before update or delete on public.listing_events
  for each row execute function private.listing_events_immutable();
create trigger listing_events_no_truncate before truncate on public.listing_events
  for each statement execute function private.listing_events_immutable();

------------------------------------------------------------------------------------------------
-- Customer requests
------------------------------------------------------------------------------------------------
create table public.buyer_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_org_id uuid not null references public.organisations (id) on delete cascade,
  created_by uuid not null,
  idempotency_key text check (char_length(idempotency_key) between 8 and 80),
  category_id uuid references public.business_categories (id),
  title text check (char_length(title) between 5 and 140),
  description text check (char_length(description) <= 2000),
  target_state text check (target_state in ('Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
    'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya')),
  target_district text check (char_length(target_district) <= 80),
  quantity numeric(14, 3) check (quantity > 0),
  unit text check (char_length(unit) <= 30),
  needed_by date,
  budget_min numeric(14, 2) check (budget_min >= 0),
  budget_max numeric(14, 2) check (budget_max >= 0),
  currency char(3) not null default 'MYR' check (currency = 'MYR'),
  visibility text not null default 'private_invite' check (visibility = 'private_invite'),
  share_contact boolean not null default false,
  status public.request_status not null default 'draft',
  version integer not null default 0,
  submitted_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  closed_reason text check (char_length(closed_reason) <= 500),
  removed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_org_id, idempotency_key),
  check (budget_max is null or budget_min is null or budget_max >= budget_min),
  check (status = 'draft' or (title is not null and category_id is not null and target_state is not null and description is not null))
);
create index buyer_requests_org on public.buyer_requests (buyer_org_id, status, created_at desc);
create index buyer_requests_open on public.buyer_requests (status, expires_at);

-- Buyer contact details: visible only to the buyer organisation; revealed to a seller by RPC after consent.
create table public.buyer_request_private (
  request_id uuid primary key references public.buyer_requests (id) on delete cascade,
  contact_phone text check (contact_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  contact_email text check (char_length(contact_email) <= 254),
  updated_at timestamptz not null default now()
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  buyer_org_id uuid not null references public.organisations (id) on delete cascade,
  seller_org_id uuid not null references public.organisations (id) on delete cascade,
  buyer_request_id uuid references public.buyer_requests (id) on delete cascade,
  origin public.enquiry_origin not null,
  status public.enquiry_status not null default 'open',
  topic text not null check (char_length(topic) between 3 and 200),
  opening_note text check (char_length(opening_note) <= 1000),
  opened_by_org_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0,
  check (buyer_org_id <> seller_org_id),
  check (opened_by_org_id in (buyer_org_id, seller_org_id))
);
create unique index enquiries_one_open_per_pair on public.enquiries
  (buyer_org_id, seller_org_id, coalesce(buyer_request_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'closed';
create index enquiries_buyer on public.enquiries (buyer_org_id, updated_at desc);
create index enquiries_seller on public.enquiries (seller_org_id, updated_at desc);

create function private.enquiries_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.buyer_org_id is distinct from old.buyer_org_id
     or new.seller_org_id is distinct from old.seller_org_id or new.buyer_request_id is distinct from old.buyer_request_id
     or new.origin is distinct from old.origin or new.created_by is distinct from old.created_by
     or new.opened_by_org_id is distinct from old.opened_by_org_id or new.topic is distinct from old.topic
     or new.opening_note is distinct from old.opening_note or new.created_at is distinct from old.created_at then
    raise exception 'immutable_columns' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
create trigger enquiries_immutable before update on public.enquiries
  for each row execute function private.enquiries_immutable_columns();

create table public.request_seller_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.buyer_requests (id) on delete cascade,
  seller_org_id uuid not null references public.organisations (id) on delete cascade,
  status public.match_status not null default 'candidate',
  reason_codes text[] not null default '{}',
  caution_codes text[] not null default '{}',
  invited_by uuid,
  invited_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  response_note text check (char_length(response_note) <= 500),
  enquiry_id uuid references public.enquiries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, seller_org_id)
);
create index request_matches_seller on public.request_seller_matches (seller_org_id, status);

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('listing', 'request')),
  listing_org_id uuid references public.business_listings (org_id) on delete cascade,
  request_id uuid references public.buyer_requests (id) on delete cascade,
  reporter_user_id uuid not null,
  reason public.report_reason not null,
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  handled_by uuid,
  handled_at timestamptz,
  handler_note text check (char_length(handler_note) <= 1000),
  created_at timestamptz not null default now(),
  check ((target_type = 'listing' and listing_org_id is not null and request_id is null)
      or (target_type = 'request' and request_id is not null and listing_org_id is null))
);
create unique index content_reports_one_open_listing on public.content_reports (reporter_user_id, listing_org_id)
  where status = 'open' and listing_org_id is not null;
create unique index content_reports_one_open_request on public.content_reports (reporter_user_id, request_id)
  where status = 'open' and request_id is not null;
create index content_reports_queue on public.content_reports (status, created_at);

------------------------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------------------------
create function private.is_enquiry_member(p_enquiry uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enquiries e
    where e.id = p_enquiry and (private.is_member(e.buyer_org_id) or private.is_member(e.seller_org_id))
  )
$$;

create function private.request_buyer_org(p_request uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select r.buyer_org_id from public.buyer_requests r where r.id = p_request $$;

create function private.request_has_open_report(p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.content_reports c where c.request_id = p_request and c.status = 'open') $$;

-- Text hygiene: trims, maps empty to null, rejects control characters and over-long values with a given error key.
create function private.clean_text(p_val text, p_min integer, p_max integer, p_err text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_val, '')), '');
begin
  if v is null then return null; end if;
  if char_length(v) < p_min or char_length(v) > p_max or v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', p_err);
  end if;
  return v;
end;
$$;

create function private.valid_state(p_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_state in ('Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang',
    'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya')
$$;

-- In-app notification to every active member of an org whose role holds a permission.
create function private.notify_org(p_org uuid, p_permission text, p_kind text, p_entity_type text, p_entity_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, org_id, kind, entity_type, entity_id)
  select distinct m.user_id, p_org, p_kind, p_entity_type, p_entity_id
  from public.memberships m
  join public.role_permissions rp on rp.role = m.role and rp.permission = p_permission
  where m.org_id = p_org and m.status = 'active';
end;
$$;

-- Requests past expires_at become 'expired'; their live invitations expire with them.
create function private.sweep_requests()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never-invited candidates are deleted (a seller must never learn it was a candidate); invitations expire.
  with ex as (
    update public.buyer_requests set status = 'expired', closed_at = now(), updated_at = now()
    where status = 'open' and expires_at < now()
    returning id
  ), del as (
    delete from public.request_seller_matches m using ex where m.request_id = ex.id and m.status = 'candidate'
  )
  update public.request_seller_matches m set status = 'expired', updated_at = now()
  from ex where m.request_id = ex.id and m.status = 'invited';
end;
$$;

------------------------------------------------------------------------------------------------
-- RLS: members read their own; reviewers read what their duty needs; nobody writes directly.
------------------------------------------------------------------------------------------------
alter table public.business_listings enable row level security;
alter table public.business_services enable row level security;
alter table public.business_portfolio enable row level security;
alter table public.listing_events enable row level security;
alter table public.buyer_requests enable row level security;
alter table public.buyer_request_private enable row level security;
alter table public.enquiries enable row level security;
alter table public.request_seller_matches enable row level security;
alter table public.content_reports enable row level security;

create policy business_listings_select on public.business_listings for select to authenticated
  using (private.is_member(org_id)
         or (private.has_platform_permission('listing:review') and (review_status <> 'editing' or live_version > 0)));
create policy business_services_select on public.business_services for select to authenticated
  using (private.is_member(org_id) or private.has_platform_permission('listing:review'));
create policy business_portfolio_select on public.business_portfolio for select to authenticated
  using (private.is_member(org_id) or private.has_platform_permission('listing:review'));
create policy listing_events_select on public.listing_events for select to authenticated
  using (private.has_permission(org_id, 'business:edit') or private.has_platform_permission('listing:review'));

create policy buyer_requests_select on public.buyer_requests for select to authenticated
  using (private.is_member(buyer_org_id)
         or (private.has_platform_permission('request:moderate') and private.request_has_open_report(id)));
create policy buyer_request_private_select on public.buyer_request_private for select to authenticated
  using (private.has_permission(private.request_buyer_org(request_id), 'request:post'));

create policy enquiries_select on public.enquiries for select to authenticated
  using (private.is_member(buyer_org_id) or private.is_member(seller_org_id));

create policy matches_select_buyer on public.request_seller_matches for select to authenticated
  using (private.is_member(private.request_buyer_org(request_id)));
-- Sellers read their invitations only through get_request_for_seller / list_seller_requests (no direct table access).

create policy content_reports_select on public.content_reports for select to authenticated
  using (reporter_user_id = (select auth.uid())
         or (target_type = 'listing' and private.has_platform_permission('listing:review'))
         or (target_type = 'request' and private.has_platform_permission('request:moderate')));

grant select on public.business_listings, public.business_services, public.business_portfolio, public.listing_events,
  public.buyer_requests, public.buyer_request_private, public.enquiries, public.request_seller_matches,
  public.content_reports to authenticated;

revoke all on function
  private.listing_events_immutable(), private.enquiries_immutable_columns(), private.is_enquiry_member(uuid),
  private.request_buyer_org(uuid), private.request_has_open_report(uuid), private.clean_text(text, integer, integer, text),
  private.valid_state(text), private.notify_org(uuid, text, text, text, text), private.sweep_requests()
  from public, anon, authenticated, service_role;
-- RLS policies call these as the invoking role, so authenticated needs execute (same pattern as private.is_member).
grant execute on function private.is_enquiry_member(uuid), private.request_buyer_org(uuid), private.request_has_open_report(uuid)
  to authenticated;
