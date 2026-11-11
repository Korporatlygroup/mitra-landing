-- Phase 4 only. Phase 3 owns public.enquiries and its participant identity.
create type public.quote_status as enum ('draft','sent','revision_requested','accepted','declined','withdrawn','expired');
create type public.lead_stage as enum ('new','contacted','quoted','discussing','reported_won','reported_lost');
create type public.review_status as enum ('pending','published','flagged','removed');
create type public.referral_status as enum ('proposed','buyer_consented','recipient_accepted','rejected','withdrawn');

insert into public.role_permissions(role,permission) values
  ('owner','enquiry:write'),('manager','enquiry:write'),('staff','enquiry:write'),
  ('owner','quote:send'),('manager','quote:send'),('staff','quote:send'),
  ('owner','lead:manage'),('manager','lead:manage'),('staff','lead:manage'),
  ('owner','review:write'),('manager','review:write'),('staff','review:write'),
  ('admin_review','review:moderate'),('admin_super','review:moderate')
on conflict do nothing;

create table public.enquiry_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id),
  sender_org_id uuid not null references public.organisations(id),
  body text not null check (char_length(body) between 1 and 4000 and body !~ '[[:cntrl:]]'),
  client_key text check (char_length(client_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (enquiry_id,sender_user_id,client_key)
);
create index enquiry_messages_thread on public.enquiry_messages(enquiry_id,created_at,id);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null unique references public.enquiries(id) on delete cascade,
  seller_org_id uuid not null references public.organisations(id),
  buyer_org_id uuid not null references public.organisations(id),
  status public.quote_status not null default 'draft',
  current_version_id uuid,
  accepted_version_id uuid,
  version integer not null default 0 check (version >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (seller_org_id <> buyer_org_id)
);
create index quotations_seller on public.quotations(seller_org_id,updated_at desc);
create index quotations_buyer on public.quotations(buyer_org_id,updated_at desc);

create table public.quotation_drafts (
  quotation_id uuid primary key references public.quotations(id) on delete cascade,
  seller_org_id uuid not null references public.organisations(id),
  data jsonb not null check (pg_column_size(data) <= 30000),
  updated_at timestamptz not null default now()
);

create table public.quotation_versions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  currency char(3) not null check (currency = 'MYR'),
  scope_text text not null check (char_length(scope_text) between 3 and 2000),
  exclusions text check (char_length(exclusions) <= 2000),
  tax_treatment text not null check (char_length(tax_treatment) between 3 and 500),
  delivery_timing text not null check (char_length(delivery_timing) between 3 and 500),
  terms_text text check (char_length(terms_text) <= 2000),
  valid_until timestamptz not null,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  delivery_fee numeric(14,2) not null check (delivery_fee >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  total numeric(14,2) not null check (total = subtotal + delivery_fee + tax_amount and total >= 0),
  sent_at timestamptz not null default now(),
  unique(quotation_id,version_number),
  unique(quotation_id,id)
);
create table public.quotation_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_version_id uuid not null references public.quotation_versions(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null check (char_length(unit) between 1 and 40),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total = round(quantity * unit_price,2)),
  sort_order integer not null check (sort_order between 0 and 49),
  unique(quote_version_id,sort_order)
);

alter table public.quotations add constraint quote_current_version_fk foreign key(id,current_version_id)
  references public.quotation_versions(quotation_id,id) deferrable initially deferred;
alter table public.quotations add constraint quote_accepted_version_fk foreign key(id,accepted_version_id)
  references public.quotation_versions(quotation_id,id) deferrable initially deferred;

create function private.quotation_snapshot_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'sent_quote_immutable' using errcode = 'PT409';
end $$;
create trigger quotation_versions_immutable before update or delete on public.quotation_versions
  for each row execute function private.quotation_snapshot_immutable();
create trigger quotation_line_items_immutable before update or delete on public.quotation_line_items
  for each row execute function private.quotation_snapshot_immutable();
revoke all on function private.quotation_snapshot_immutable() from public,anon,authenticated,service_role;

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  seller_org_id uuid not null references public.organisations(id),
  actor_user_id uuid not null references auth.users(id),
  stage public.lead_stage not null,
  note text check (char_length(note) <= 2000),
  next_follow_up_at timestamptz,
  recorded_at timestamptz not null default now()
);
create index lead_activities_seller_due on public.lead_activities(seller_org_id,next_follow_up_at) where next_follow_up_at is not null;
create index lead_activities_enquiry on public.lead_activities(enquiry_id,recorded_at desc);

create table public.referral_suggestions (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  referrer_seller_org_id uuid not null references public.organisations(id),
  proposed_seller_org_id uuid not null references public.organisations(id),
  buyer_org_id uuid not null references public.organisations(id),
  status public.referral_status not null default 'proposed',
  buyer_consented_at timestamptz,
  recipient_accepted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(enquiry_id,proposed_seller_org_id),
  check(referrer_seller_org_id <> proposed_seller_org_id and buyer_org_id <> proposed_seller_org_id)
);

create table public.business_reviews (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null unique references public.enquiries(id) on delete cascade,
  buyer_org_id uuid not null references public.organisations(id),
  seller_org_id uuid not null references public.organisations(id),
  author_user_id uuid not null references auth.users(id),
  rating integer not null check(rating between 1 and 5),
  review_text text not null check(char_length(review_text) between 10 and 2000),
  status public.review_status not null default 'pending',
  seller_response text check(char_length(seller_response) <= 2000),
  seller_response_status text check(seller_response_status in ('pending','published','removed')),
  seller_response_moderation_reason text check(char_length(seller_response_moderation_reason) <= 1000),
  moderation_reason text check(char_length(moderation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(buyer_org_id <> seller_org_id)
);
create index business_reviews_seller_status on public.business_reviews(seller_org_id,status,created_at desc);

alter table public.enquiry_messages enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_drafts enable row level security;
alter table public.quotation_versions enable row level security;
alter table public.quotation_line_items enable row level security;
alter table public.lead_activities enable row level security;
alter table public.referral_suggestions enable row level security;
alter table public.business_reviews enable row level security;

create policy enquiry_messages_read on public.enquiry_messages for select to authenticated using(private.is_enquiry_member(enquiry_id));
create policy quotations_read on public.quotations for select to authenticated using(private.is_enquiry_member(enquiry_id));
create policy quotation_drafts_read on public.quotation_drafts for select to authenticated using(private.has_permission(seller_org_id,'quote:send'));
create policy quotation_versions_read on public.quotation_versions for select to authenticated using(exists(select 1 from public.quotations q where q.id=quotation_id and private.is_enquiry_member(q.enquiry_id)));
create policy quotation_line_items_read on public.quotation_line_items for select to authenticated using(exists(select 1 from public.quotation_versions v join public.quotations q on q.id=v.quotation_id where v.id=quote_version_id and private.is_enquiry_member(q.enquiry_id)));
create policy lead_activities_read on public.lead_activities for select to authenticated using(private.has_permission(seller_org_id,'lead:manage'));
create policy referrals_read on public.referral_suggestions for select to authenticated using(private.is_member(referrer_seller_org_id) or private.is_member(buyer_org_id) or (buyer_consented_at is not null and private.is_member(proposed_seller_org_id)));
create policy reviews_read on public.business_reviews for select to authenticated using(private.is_member(buyer_org_id) or (status='published' and private.is_member(seller_org_id)) or private.has_platform_permission('review:moderate'));

grant select on public.enquiry_messages,public.quotations,public.quotation_versions,public.quotation_line_items,public.lead_activities,public.referral_suggestions,public.business_reviews to authenticated;
grant select on public.quotation_drafts to authenticated;
