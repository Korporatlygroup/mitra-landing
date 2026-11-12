-- Phase 2: seller onboarding, business profiles and claim-level verification.
-- Wording rule (plan 5A.9): "documents reviewed by MITRA" only. Nothing here asserts an official SSM check.
-- Writes happen only through the RPCs below. Document CONTENT lives in private Storage and is reachable only
-- through server code (service role) after get_document_access() has authorised and logged the access.

------------------------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------------------------
create type public.registration_status as enum ('registered', 'unregistered');
create type public.claim_type as enum ('business_registration', 'business_location', 'representative_authority');
create type public.claim_status as enum ('draft', 'submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale', 'withdrawn');
create type public.doc_type as enum ('ssm_certificate', 'ssm_form', 'business_licence', 'address_proof', 'authorisation_letter', 'other');
create type public.scan_status as enum ('pending', 'clean', 'infected', 'failed');

------------------------------------------------------------------------------------------------
-- Permissions
------------------------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('owner', 'business:edit'), ('owner', 'verification:submit'), ('owner', 'verification:read'),
  ('manager', 'business:edit'), ('manager', 'verification:submit'), ('manager', 'verification:read'),
  ('staff', 'business:edit'),
  ('admin_review', 'verification:decide'),
  ('admin_super', 'verification:decide');

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------
create table public.business_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_en text not null,
  name_ta text not null,
  sort integer not null default 100,
  active boolean not null default true
);

insert into public.business_categories (slug, name_en, name_ta, sort) values
  ('food-beverage', 'Food and beverage', 'உணவு மற்றும் பானங்கள்', 10),
  ('retail-shop', 'Retail shop', 'சில்லறை கடை', 20),
  ('tailoring-apparel', 'Tailoring and apparel', 'தையல் மற்றும் ஆடை', 30),
  ('beauty-wellness', 'Beauty and wellness', 'அழகு மற்றும் நலம்', 40),
  ('home-services', 'Home and repair services', 'வீட்டுச் சேவைகள்', 50),
  ('education-training', 'Education and training', 'கல்வி மற்றும் பயிற்சி', 60),
  ('tech-digital', 'Technology and digital', 'தொழில்நுட்பம் மற்றும் டிஜிட்டல்', 70),
  ('manufacturing', 'Manufacturing and crafts', 'உற்பத்தி மற்றும் கைவினை', 80),
  ('agriculture', 'Agriculture', 'விவசாயம்', 90),
  ('transport-logistics', 'Transport and logistics', 'போக்குவரத்து மற்றும் விநியோகம்', 100),
  ('events-hospitality', 'Events and hospitality', 'நிகழ்வுகள் மற்றும் விருந்தோம்பல்', 110),
  ('professional-services', 'Professional services', 'தொழில்முறை சேவைகள்', 120),
  ('other', 'Other', 'மற்றவை', 900);

-- Public-facing business facts. Full address and phone/email are kept in business_private.
create table public.business_profiles (
  org_id uuid primary key references public.organisations (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 160),
  category_id uuid not null references public.business_categories (id),
  description text check (char_length(description) <= 1000),
  registration_status public.registration_status not null default 'unregistered',
  ssm_number text check (ssm_number ~ '^([0-9]{12}|[0-9]{6,7}-?[A-Z])$'),
  business_type text check (business_type in ('sole_proprietorship', 'partnership', 'sdn_bhd', 'llp', 'other')),
  state text check (state in ('Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis',
    'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya')),
  district text check (char_length(district) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (registration_status = 'registered' or (ssm_number is null and business_type is null))
);

create table public.business_private (
  org_id uuid primary key references public.organisations (id) on delete cascade,
  address_line text check (char_length(address_line) <= 200),
  postcode text check (postcode ~ '^[0-9]{5}$'),
  contact_phone text check (contact_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  contact_email text check (char_length(contact_email) <= 254),
  updated_at timestamptz not null default now()
);

-- Minimum data to judge authority: name and capacity. No identity-card number or image is collected.
create table public.business_representatives (
  org_id uuid primary key references public.organisations (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role_title text not null check (role_title in ('owner', 'director', 'partner', 'authorised_person')),
  contact_email text check (char_length(contact_email) <= 254),
  contact_phone text check (contact_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  updated_at timestamptz not null default now()
);

create table public.verification_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  claim_type public.claim_type not null,
  status public.claim_status not null default 'draft',
  version integer not null default 0,
  snapshot jsonb,
  owner_note text check (char_length(owner_note) <= 1000),
  submitted_at timestamptz,
  submitted_by uuid,
  reviewer_id uuid,
  decided_at timestamptz,
  decided_by uuid,
  decision_reason text check (char_length(decision_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, claim_type)
);
create index verification_claims_status on public.verification_claims (status, submitted_at);

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  claim_id uuid not null references public.verification_claims (id) on delete cascade,
  doc_type public.doc_type not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  scan_status public.scan_status not null default 'pending',
  scan_engine text check (char_length(scan_engine) <= 80),
  scanned_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index verification_documents_claim on public.verification_documents (claim_id) where removed_at is null;

create table public.verification_claim_documents (
  claim_id uuid not null references public.verification_claims (id) on delete cascade,
  version integer not null,
  document_id uuid not null references public.verification_documents (id) on delete restrict,
  primary key (claim_id, version, document_id)
);

-- Append-only history of everything that happens to a claim.
create table public.verification_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  claim_id uuid not null,
  org_id uuid not null,
  actor_user_id uuid,
  event text not null check (event in ('claim_created', 'document_uploaded', 'document_removed', 'document_viewed',
    'scan_result', 'submitted', 'resubmitted', 'withdrawn', 'review_started', 'approved', 'rejected',
    'info_requested', 'marked_stale')),
  details jsonb not null default '{}'::jsonb
);
create index verification_events_claim on public.verification_events (claim_id, at);

create function private.verification_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'verification_events is append-only' using errcode = '42501';
end;
$$;
create trigger verification_events_no_update_delete before update or delete on public.verification_events
  for each row execute function private.verification_events_immutable();
create trigger verification_events_no_truncate before truncate on public.verification_events
  for each statement execute function private.verification_events_immutable();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid,
  kind text not null check (char_length(kind) <= 60),
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;

------------------------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------------------------
create function private.add_event(p_claim uuid, p_org uuid, p_actor uuid, p_event text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.verification_events (claim_id, org_id, actor_user_id, event, details)
  values (p_claim, p_org, p_actor, p_event, coalesce(p_details, '{}'::jsonb));
end;
$$;

create function private.ensure_claim(p_org uuid, p_type public.claim_type, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.verification_claims c where c.org_id = p_org and c.claim_type = p_type;
  if v_id is null then
    insert into public.verification_claims (org_id, claim_type) values (p_org, p_type) returning id into v_id;
    perform private.add_event(v_id, p_org, p_actor, 'claim_created', jsonb_build_object('claim_type', p_type));
  end if;
  return v_id;
end;
$$;

-- Exactly the facts a reviewer is asked to check. NULL means the profile is not complete enough to submit.
create function private.claim_snapshot(p_org uuid, p_type public.claim_type)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_type = 'business_registration' then
    select jsonb_build_object('business_name', bp.business_name, 'ssm_number', bp.ssm_number, 'business_type', bp.business_type)
      into v_result
    from public.business_profiles bp
    where bp.org_id = p_org and bp.registration_status = 'registered' and bp.ssm_number is not null;
  elsif p_type = 'business_location' then
    select jsonb_build_object('state', bp.state, 'district', bp.district, 'address_line', pr.address_line, 'postcode', pr.postcode)
      into v_result
    from public.business_profiles bp join public.business_private pr on pr.org_id = bp.org_id
    where bp.org_id = p_org and bp.state is not null and pr.address_line is not null;
  elsif p_type = 'representative_authority' then
    select jsonb_build_object('full_name', r.full_name, 'role_title', r.role_title, 'business_name', bp.business_name)
      into v_result
    from public.business_representatives r join public.business_profiles bp on bp.org_id = r.org_id
    where r.org_id = p_org;
  end if;
  return v_result;
end;
$$;

-- Editing the facts behind a claim after submission voids it: the owner must resubmit.
create function private.mark_stale_claims(p_org uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.verification_claims;
begin
  for c in
    select * from public.verification_claims x
    where x.org_id = p_org and x.status in ('approved', 'submitted', 'in_review')
  loop
    if private.claim_snapshot(p_org, c.claim_type) is distinct from c.snapshot then
      update public.verification_claims set status = 'stale', updated_at = now() where id = c.id;
      perform private.add_event(c.id, p_org, p_actor, 'marked_stale',
        jsonb_build_object('from', c.status, 'reason', 'details_changed'));
    end if;
  end loop;
end;
$$;

create function private.is_active_member(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user and m.status = 'active')
$$;

create function private.valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_email is null or (char_length(p_email) <= 254 and p_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$') $$;

------------------------------------------------------------------------------------------------
-- Business profile and representative (partial saves allowed: "save and finish later")
------------------------------------------------------------------------------------------------
create function public.save_business_profile(p_org uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_type public.org_type;
  v_cur public.business_profiles;
  v_pri public.business_private;
  v_name text;
  v_cat uuid;
  v_desc text;
  v_reg public.registration_status;
  v_ssm text;
  v_btype text;
  v_state text;
  v_district text;
  v_addr text;
  v_post text;
  v_phone text;
  v_email text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'business:edit') then perform private.raise_error('forbidden'); end if;
  select o.type into v_type from public.organisations o where o.id = p_org;
  if v_type is distinct from 'business' then perform private.raise_error('invalid', 'org_not_business'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('bizprofile:' || v_user, 60, interval '1 hour');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;

  select * into v_cur from public.business_profiles where org_id = p_org;
  select * into v_pri from public.business_private where org_id = p_org;

  v_name := case when p_data ? 'business_name' then btrim(p_data ->> 'business_name') else v_cur.business_name end;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 160 or v_name ~ '[[:cntrl:]]' then
    perform private.raise_error('invalid', 'invalid_name');
  end if;

  if p_data ? 'category_slug' then
    select c.id into v_cat from public.business_categories c where c.slug = p_data ->> 'category_slug' and c.active;
    if v_cat is null then perform private.raise_error('invalid', 'invalid_category'); end if;
  else
    v_cat := v_cur.category_id;
    if v_cat is null then perform private.raise_error('invalid', 'category_required'); end if;
  end if;

  v_desc := case when p_data ? 'description' then nullif(btrim(p_data ->> 'description'), '') else v_cur.description end;
  if v_desc is not null and (char_length(v_desc) > 1000 or v_desc ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]') then
    perform private.raise_error('invalid', 'invalid_description');
  end if;

  v_reg := coalesce(v_cur.registration_status, 'unregistered');
  if p_data ? 'registration_status' then
    if p_data ->> 'registration_status' not in ('registered', 'unregistered') then
      perform private.raise_error('invalid', 'invalid_registration_status');
    end if;
    v_reg := (p_data ->> 'registration_status')::public.registration_status;
  end if;

  v_ssm := case when p_data ? 'ssm_number'
    then upper(nullif(regexp_replace(coalesce(p_data ->> 'ssm_number', ''), '\s', '', 'g'), '')) else v_cur.ssm_number end;
  v_btype := case when p_data ? 'business_type' then nullif(btrim(p_data ->> 'business_type'), '') else v_cur.business_type end;
  if v_reg = 'unregistered' then
    v_ssm := null;
    v_btype := null;
  else
    if v_ssm is not null and v_ssm !~ '^([0-9]{12}|[0-9]{6,7}-?[A-Z])$' then perform private.raise_error('invalid', 'invalid_ssm'); end if;
    if v_btype is not null and v_btype not in ('sole_proprietorship', 'partnership', 'sdn_bhd', 'llp', 'other') then
      perform private.raise_error('invalid', 'invalid_business_type');
    end if;
  end if;

  v_state := case when p_data ? 'state' then nullif(btrim(p_data ->> 'state'), '') else v_cur.state end;
  if v_state is not null and v_state not in ('Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
    'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya') then
    perform private.raise_error('invalid', 'invalid_state');
  end if;
  v_district := case when p_data ? 'district' then nullif(btrim(p_data ->> 'district'), '') else v_cur.district end;
  if v_district is not null and (char_length(v_district) > 80 or v_district ~ '[[:cntrl:]]') then
    perform private.raise_error('invalid', 'invalid_district');
  end if;

  v_addr := case when p_data ? 'address_line' then nullif(btrim(p_data ->> 'address_line'), '') else v_pri.address_line end;
  if v_addr is not null and (char_length(v_addr) > 200 or v_addr ~ '[[:cntrl:]]') then perform private.raise_error('invalid', 'invalid_address'); end if;
  v_post := case when p_data ? 'postcode' then nullif(btrim(p_data ->> 'postcode'), '') else v_pri.postcode end;
  if v_post is not null and v_post !~ '^[0-9]{5}$' then perform private.raise_error('invalid', 'invalid_postcode'); end if;
  v_phone := case when p_data ? 'contact_phone' then nullif(btrim(p_data ->> 'contact_phone'), '') else v_pri.contact_phone end;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_phone'); end if;
  v_email := case when p_data ? 'contact_email' then lower(nullif(btrim(p_data ->> 'contact_email'), '')) else v_pri.contact_email end;
  if not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;

  insert into public.business_profiles (org_id, business_name, category_id, description, registration_status, ssm_number,
    business_type, state, district, updated_by)
  values (p_org, v_name, v_cat, v_desc, v_reg, v_ssm, v_btype, v_state, v_district, v_user)
  on conflict (org_id) do update set business_name = excluded.business_name, category_id = excluded.category_id,
    description = excluded.description, registration_status = excluded.registration_status, ssm_number = excluded.ssm_number,
    business_type = excluded.business_type, state = excluded.state, district = excluded.district,
    updated_at = now(), updated_by = excluded.updated_by;

  insert into public.business_private (org_id, address_line, postcode, contact_phone, contact_email)
  values (p_org, v_addr, v_post, v_phone, v_email)
  on conflict (org_id) do update set address_line = excluded.address_line, postcode = excluded.postcode,
    contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, updated_at = now();

  perform private.mark_stale_claims(p_org, v_user);
  perform private.write_audit('business.profile_saved', p_org, 'business_profile', p_org::text, '{}'::jsonb);
end;
$$;

create function public.save_representative(p_org uuid, p_name text, p_role text, p_email text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'business:edit') then perform private.raise_error('forbidden'); end if;
  if not exists (select 1 from public.business_profiles bp where bp.org_id = p_org) then
    perform private.raise_error('conflict', 'profile_required');
  end if;
  perform private.require_consent();
  perform private.check_rate_limit('bizrep:' || v_user, 60, interval '1 hour');
  if char_length(v_name) < 2 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_name'); end if;
  if p_role is null or p_role not in ('owner', 'director', 'partner', 'authorised_person') then perform private.raise_error('invalid', 'invalid_role'); end if;
  if not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_phone'); end if;

  insert into public.business_representatives (org_id, full_name, role_title, contact_email, contact_phone)
  values (p_org, v_name, p_role, v_email, v_phone)
  on conflict (org_id) do update set full_name = excluded.full_name, role_title = excluded.role_title,
    contact_email = excluded.contact_email, contact_phone = excluded.contact_phone, updated_at = now();

  perform private.mark_stale_claims(p_org, v_user);
  perform private.write_audit('business.representative_saved', p_org, 'business_representative', p_org::text, '{}'::jsonb);
end;
$$;

------------------------------------------------------------------------------------------------
-- Claims: submit, withdraw, review, decide
------------------------------------------------------------------------------------------------
create function public.submit_claim(p_org uuid, p_type public.claim_type, p_document_ids uuid[], p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claim public.verification_claims;
  v_snapshot jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ids uuid[] := coalesce(p_document_ids, array[]::uuid[]);
  v_version integer;
  v_valid integer;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'verification:submit') then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('submitclaim:' || v_user, 30, interval '1 hour');
  if v_note is not null and (char_length(v_note) > 1000 or v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]') then
    perform private.raise_error('invalid', 'invalid_note');
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 5 then perform private.raise_error('invalid', 'document_count'); end if;

  perform private.ensure_claim(p_org, p_type, v_user);
  select * into v_claim from public.verification_claims c where c.org_id = p_org and c.claim_type = p_type for update;
  if v_claim.status not in ('draft', 'needs_info', 'rejected', 'stale', 'withdrawn') then
    perform private.raise_error('conflict', 'claim_not_resubmittable');
  end if;

  v_snapshot := private.claim_snapshot(p_org, p_type);
  if v_snapshot is null then perform private.raise_error('conflict', 'details_incomplete'); end if;

  select count(*) into v_valid from public.verification_documents d
  where d.id = any (v_ids) and d.org_id = p_org and d.claim_id = v_claim.id and d.removed_at is null and d.scan_status = 'clean';
  if v_valid <> cardinality(array(select distinct x from unnest(v_ids) x)) then
    perform private.raise_error('conflict', 'documents_not_ready');
  end if;

  v_version := v_claim.version + 1;
  insert into public.verification_claim_documents (claim_id, version, document_id)
  select v_claim.id, v_version, d from unnest(v_ids) d group by d;

  update public.verification_claims set
    status = 'submitted', version = v_version, snapshot = v_snapshot, owner_note = v_note,
    submitted_at = now(), submitted_by = v_user, reviewer_id = null, decided_at = null, decided_by = null,
    decision_reason = null, updated_at = now()
  where id = v_claim.id;

  perform private.add_event(v_claim.id, p_org, v_user, case when v_claim.version = 0 then 'submitted' else 'resubmitted' end,
    jsonb_build_object('version', v_version, 'documents', cardinality(v_ids)));
  perform private.write_audit('verification.submitted', p_org, 'verification_claim', v_claim.id::text,
    jsonb_build_object('claim_type', p_type, 'version', v_version));
  return jsonb_build_object('claim_id', v_claim.id, 'version', v_version);
end;
$$;

create function public.withdraw_claim(p_claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.verification_claims;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into v_claim from public.verification_claims c where c.id = p_claim for update;
  if v_claim.id is null or not private.has_permission(v_claim.org_id, 'verification:submit') then
    perform private.raise_error('forbidden');
  end if;
  if v_claim.status not in ('submitted', 'in_review', 'needs_info') then perform private.raise_error('conflict', 'claim_not_withdrawable'); end if;
  update public.verification_claims set status = 'withdrawn', updated_at = now() where id = p_claim;
  perform private.add_event(p_claim, v_claim.org_id, auth.uid(), 'withdrawn', '{}'::jsonb);
end;
$$;

create function public.start_review(p_claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_claim public.verification_claims;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:review') then perform private.raise_error('forbidden'); end if;
  select * into v_claim from public.verification_claims c where c.id = p_claim for update;
  if v_claim.id is null then perform private.raise_error('not_found'); end if;
  if private.is_active_member(v_claim.org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if v_claim.status <> 'submitted' then perform private.raise_error('conflict', 'claim_not_reviewable'); end if;
  update public.verification_claims set status = 'in_review', reviewer_id = v_user, updated_at = now() where id = p_claim;
  perform private.add_event(p_claim, v_claim.org_id, v_user, 'review_started', jsonb_build_object('version', v_claim.version));
end;
$$;

create function public.decide_claim(p_claim uuid, p_decision text, p_reason text, p_expected_version integer)
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
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('verification:decide') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_info') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 or v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then
    perform private.raise_error('invalid', 'reason_required');
  end if;

  select * into v_claim from public.verification_claims c where c.id = p_claim for update;
  if v_claim.id is null then perform private.raise_error('not_found'); end if;
  if private.is_active_member(v_claim.org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if v_claim.status not in ('submitted', 'in_review') then perform private.raise_error('conflict', 'claim_not_reviewable'); end if;
  if v_claim.version is distinct from p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;

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

------------------------------------------------------------------------------------------------
-- Documents. Upload + scan are done by trusted server code (service role); the browser never writes storage.
------------------------------------------------------------------------------------------------
create function public.service_register_document(
  p_org uuid, p_user uuid, p_claim_type public.claim_type, p_doc_type public.doc_type, p_display_name text,
  p_mime text, p_size bigint, p_sha256 text, p_storage_path text, p_scan_status public.scan_status, p_scan_engine text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim uuid;
  v_id uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  -- Defence in depth: the server already authorised the user, the database re-checks the same rule.
  if not exists (
    select 1 from public.memberships m
    join public.organisations o on o.id = m.org_id and o.status = 'active' and o.type = 'business'
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'verification:submit'
    where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
  ) then
    perform private.raise_error('forbidden');
  end if;
  if (p_claim_type = 'business_registration' and p_doc_type not in ('ssm_certificate', 'ssm_form', 'business_licence'))
     or (p_claim_type = 'business_location' and p_doc_type not in ('address_proof', 'business_licence', 'ssm_certificate'))
     or (p_claim_type = 'representative_authority' and p_doc_type not in ('authorisation_letter', 'ssm_form', 'other')) then
    perform private.raise_error('invalid', 'invalid_doc_type');
  end if;
  if p_scan_status = 'infected' then perform private.raise_error('invalid', 'infected_not_stored'); end if;
  if (select count(*) from public.verification_documents d where d.org_id = p_org and d.removed_at is null) >= 50 then
    perform private.raise_error('conflict', 'document_limit_reached');
  end if;
  if char_length(v_name) < 1 or v_name ~ '[[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_name'); end if;

  v_claim := private.ensure_claim(p_org, p_claim_type, p_user);
  insert into public.verification_documents (org_id, claim_id, doc_type, display_name, mime_type, size_bytes, sha256,
    storage_path, scan_status, scan_engine, scanned_at, uploaded_by)
  values (p_org, v_claim, p_doc_type, left(v_name, 120), p_mime, p_size, p_sha256, p_storage_path, p_scan_status, p_scan_engine,
    case when p_scan_status in ('clean', 'failed') then now() end, p_user)
  returning id into v_id;

  perform private.add_event(v_claim, p_org, p_user, 'document_uploaded',
    jsonb_build_object('document_id', v_id, 'doc_type', p_doc_type, 'scan_status', p_scan_status));
  return v_id;
end;
$$;

create function public.service_set_scan_result(p_doc uuid, p_status public.scan_status, p_engine text)
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
  if v_doc.scan_status not in ('pending', 'failed') then perform private.raise_error('conflict', 'already_scanned'); end if;
  if p_status = 'pending' then perform private.raise_error('invalid', 'invalid_status'); end if;
  update public.verification_documents set scan_status = p_status, scan_engine = left(p_engine, 80), scanned_at = now() where id = p_doc;
  perform private.add_event(v_doc.claim_id, v_doc.org_id, null, 'scan_result',
    jsonb_build_object('document_id', p_doc, 'scan_status', p_status));
end;
$$;

create function public.service_list_unscanned_documents(p_limit integer)
returns table (id uuid, storage_path text, mime_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.storage_path, d.mime_type from public.verification_documents d
  where d.scan_status in ('pending', 'failed') and d.removed_at is null
  order by d.created_at limit least(greatest(p_limit, 1), 100)
$$;

create function public.service_org_recipient_emails(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(u.email)), array[]::text[])
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and m.status = 'active' and m.role in ('owner', 'manager')
    and u.email_confirmed_at is not null and u.deleted_at is null and u.email is not null
$$;

create function public.remove_document(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.verification_documents;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into v_doc from public.verification_documents d where d.id = p_doc for update;
  if v_doc.id is null or not private.has_permission(v_doc.org_id, 'verification:submit') then perform private.raise_error('forbidden'); end if;
  if v_doc.removed_at is not null then perform private.raise_error('not_found'); end if;
  -- Evidence attached to a submitted or decided version stays, so the decision history remains reviewable.
  if exists (select 1 from public.verification_claim_documents j where j.document_id = p_doc) then
    perform private.raise_error('conflict', 'document_in_use');
  end if;
  update public.verification_documents set removed_at = now() where id = p_doc;
  perform private.add_event(v_doc.claim_id, v_doc.org_id, auth.uid(), 'document_removed', jsonb_build_object('document_id', p_doc));
  return v_doc.storage_path;
end;
$$;

-- Authorises AND logs every access to document content. Returns where the server may read it from.
create function public.get_document_access(p_doc uuid)
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
        and not private.is_active_member(v_doc.org_id, v_user)
        and exists (
          select 1 from public.verification_claim_documents j
          join public.verification_claims c on c.id = j.claim_id
          where j.document_id = p_doc and c.status in ('submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale')
        ) then
    v_allowed := true;
  end if;
  if not v_allowed then perform private.raise_error('not_found'); end if;
  -- Unscanned or infected evidence is never served to anyone.
  if v_doc.removed_at is not null or v_doc.scan_status <> 'clean' then perform private.raise_error('forbidden', 'document_not_available'); end if;

  perform private.add_event(v_doc.claim_id, v_doc.org_id, v_user, 'document_viewed', jsonb_build_object('document_id', p_doc));
  perform private.write_audit('verification.document_viewed', v_doc.org_id, 'verification_document', p_doc::text, '{}'::jsonb);
  return jsonb_build_object('storage_path', v_doc.storage_path, 'mime_type', v_doc.mime_type, 'display_name', v_doc.display_name);
end;
$$;

create function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  update public.notifications set read_at = now() where id = p_id and user_id = auth.uid() and read_at is null;
end;
$$;

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------
alter table public.business_categories enable row level security;
alter table public.business_profiles enable row level security;
alter table public.business_private enable row level security;
alter table public.business_representatives enable row level security;
alter table public.verification_claims enable row level security;
alter table public.verification_documents enable row level security;
alter table public.verification_claim_documents enable row level security;
alter table public.verification_events enable row level security;
alter table public.notifications enable row level security;

create policy business_categories_select on public.business_categories for select to authenticated using (active);
create policy business_profiles_select on public.business_profiles for select to authenticated
  using (private.is_member(org_id) or private.has_platform_permission('verification:review'));
create policy business_private_select on public.business_private for select to authenticated
  using (private.has_permission(org_id, 'business:edit'));
create policy business_representatives_select on public.business_representatives for select to authenticated
  using (private.has_permission(org_id, 'verification:read'));
create policy verification_claims_select on public.verification_claims for select to authenticated
  using (private.has_permission(org_id, 'verification:read') or private.has_platform_permission('verification:review'));
create policy verification_documents_select on public.verification_documents for select to authenticated
  using (private.has_permission(org_id, 'verification:read') or private.has_platform_permission('verification:review'));
create policy verification_claim_documents_select on public.verification_claim_documents for select to authenticated
  using (exists (select 1 from public.verification_claims c where c.id = claim_id));
create policy verification_events_select on public.verification_events for select to authenticated
  using (private.has_permission(org_id, 'verification:read') or private.has_platform_permission('verification:review'));
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- Reviewers must be able to show the organisation name next to a claim.
create policy organisations_select_verification_staff on public.organisations for select to authenticated
  using (type = 'business' and private.has_platform_permission('verification:review'));

grant select on public.business_categories, public.business_profiles, public.business_private,
  public.business_representatives, public.verification_claims, public.verification_documents,
  public.verification_claim_documents, public.verification_events, public.notifications to authenticated;

-- Implicit PUBLIC execute on new functions must be revoked explicitly.
revoke all on function
  private.verification_events_immutable(), private.add_event(uuid, uuid, uuid, text, jsonb),
  private.ensure_claim(uuid, public.claim_type, uuid), private.claim_snapshot(uuid, public.claim_type),
  private.mark_stale_claims(uuid, uuid), private.is_active_member(uuid, uuid), private.valid_email(text),
  public.save_business_profile(uuid, jsonb), public.save_representative(uuid, text, text, text, text),
  public.submit_claim(uuid, public.claim_type, uuid[], text), public.withdraw_claim(uuid), public.start_review(uuid),
  public.decide_claim(uuid, text, text, integer),
  public.service_register_document(uuid, uuid, public.claim_type, public.doc_type, text, text, bigint, text, text, public.scan_status, text),
  public.service_set_scan_result(uuid, public.scan_status, text), public.service_list_unscanned_documents(integer),
  public.service_org_recipient_emails(uuid), public.remove_document(uuid), public.get_document_access(uuid),
  public.mark_notification_read(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.save_business_profile(uuid, jsonb), public.save_representative(uuid, text, text, text, text),
  public.submit_claim(uuid, public.claim_type, uuid[], text), public.withdraw_claim(uuid), public.start_review(uuid),
  public.decide_claim(uuid, text, text, integer), public.remove_document(uuid), public.get_document_access(uuid),
  public.mark_notification_read(uuid)
  to authenticated;

grant execute on function
  public.service_register_document(uuid, uuid, public.claim_type, public.doc_type, text, text, bigint, text, text, public.scan_status, text),
  public.service_set_scan_result(uuid, public.scan_status, text), public.service_list_unscanned_documents(integer),
  public.service_org_recipient_emails(uuid)
  to service_role;

------------------------------------------------------------------------------------------------
-- Rejected uploads (infected / malformed) leave an audit trace without storing the file.
------------------------------------------------------------------------------------------------
create function public.service_record_rejected_upload(p_org uuid, p_user uuid, p_claim_type public.claim_type, p_reason text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason not in ('infected', 'bad_type', 'too_large', 'unsafe_content', 'empty') then
    perform private.raise_error('invalid', 'invalid_reason');
  end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then perform private.raise_error('invalid', 'invalid_hash'); end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then perform private.raise_error('not_found', 'unknown_user'); end if;
  insert into public.audit_log (actor_user_id, org_id, action, entity_type, entity_id, details, source)
  values (p_user, p_org, 'verification.upload_rejected', 'verification_claim', p_claim_type::text,
          jsonb_build_object('reason', p_reason, 'sha256', p_sha256), 'app-server');
end;
$$;
revoke all on function public.service_record_rejected_upload(uuid, uuid, public.claim_type, text, text) from public, anon, authenticated, service_role;
grant execute on function public.service_record_rejected_upload(uuid, uuid, public.claim_type, text, text) to service_role;
