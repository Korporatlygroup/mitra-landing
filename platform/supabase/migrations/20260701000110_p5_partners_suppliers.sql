-- Phase 5 (1/5): partner organisations, wholesale suppliers, supplier evidence and review.
-- Contract: platform/docs/contracts/phase5-phase6.md. All writes go through the RPCs below (RLS: select policies only).
-- A 'partner' organisation is inert until MITRA approves its partner_profiles row (private.assert_partner_active).
-- Foreign keys: owned rows cascade from organisations, authorship columns are SET NULL, append-only history tables
-- (supplier_events) carry no foreign key at all, so organisation or account erasure is never blocked by them.

------------------------------------------------------------------------------------------------
-- Permissions (mirrored in src/lib/permissions.ts)
------------------------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('owner', 'supplier:manage'), ('manager', 'supplier:manage'), ('staff', 'supplier:manage'),
  ('owner', 'catalogue:manage'), ('manager', 'catalogue:manage'), ('staff', 'catalogue:manage'),
  ('owner', 'sourcing:respond'), ('manager', 'sourcing:respond'), ('staff', 'sourcing:respond'),
  ('admin_review', 'supplier:review'), ('admin_super', 'supplier:review'),
  ('admin_review', 'catalogue:review'), ('admin_super', 'catalogue:review'),
  ('admin_review', 'partner:manage'), ('admin_super', 'partner:manage'),
  ('admin_support', 'catalogue:moderate'), ('admin_super', 'catalogue:moderate');

------------------------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------------------------
create type public.partner_status as enum ('pending', 'approved', 'suspended');
create type public.supplier_status as enum ('draft', 'awaiting_review', 'more_info_needed', 'approved', 'rejected', 'suspended');

------------------------------------------------------------------------------------------------
-- Wholesale goods taxonomy (names are translated in messages/*.json as pcat.<slug>)
------------------------------------------------------------------------------------------------
create table public.product_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  sort integer not null default 0,
  active boolean not null default true
);
insert into public.product_categories (slug, sort) values
  ('textiles-apparel', 10), ('food-groceries', 20), ('spices-condiments', 30), ('jewellery-accessories', 40),
  ('home-kitchen', 50), ('religious-items-puja', 60), ('cosmetics-personal-care', 70), ('stationery-books', 80),
  ('hardware-tools', 90), ('electronics-accessories', 100), ('packaging', 110), ('other', 999);

------------------------------------------------------------------------------------------------
-- Partner profile: one per partner organisation, MITRA approves it
------------------------------------------------------------------------------------------------
create table public.partner_profiles (
  org_id uuid primary key references public.organisations (id) on delete cascade,
  status public.partner_status not null default 'pending',
  display_name text not null check (char_length(display_name) between 2 and 160),
  contact_email text check (char_length(contact_email) <= 254),
  provisioned_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 1000),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_profiles_status on public.partner_profiles (status, created_at);

create function private.partner_profiles_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select o.type from public.organisations o where o.id = new.org_id) is distinct from 'partner' then
    perform private.raise_error('invalid', 'org_not_partner');
  end if;
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    perform private.raise_error('invalid', 'immutable_columns');
  end if;
  return new;
end;
$$;
create trigger partner_profiles_integrity before insert or update on public.partner_profiles
  for each row execute function private.partner_profiles_integrity();

------------------------------------------------------------------------------------------------
-- Suppliers: records owned by a partner (not auth users). `draft` is edited, live_* is the approved snapshot.
-- A resubmission of an approved supplier keeps the supplier live while draft_submitted_version is set.
------------------------------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9._-]{2,30}$'),
  status public.supplier_status not null default 'draft',
  draft jsonb not null default '{}'::jsonb,
  draft_version integer not null default 0,
  draft_submitted_version integer,
  live_draft_version integer,
  live_name text check (char_length(live_name) between 2 and 160),
  live_country text check (char_length(live_country) between 2 and 60),
  live_state_city text check (char_length(live_state_city) <= 100),
  live_main_category text check (live_main_category ~ '^[a-z0-9-]{2,40}$'),
  live_description text check (char_length(live_description) <= 2000),
  live_capabilities jsonb not null default '[]'::jsonb,
  review_checks text[] not null default '{}',
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  decision_reason text check (char_length(decision_reason) <= 1000),
  submitted_at timestamptz,
  submitted_by uuid references auth.users (id) on delete set null,
  suspended_reason text check (char_length(suspended_reason) <= 1000),
  suspended_at timestamptz,
  suspended_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_org_id, code),
  check (status not in ('approved', 'suspended') or live_name is not null)
);
create index suppliers_partner on public.suppliers (partner_org_id, status);
create index suppliers_review on public.suppliers (submitted_at) where draft_submitted_version is not null;

-- Contact details and registration number: partner members and reviewers only, never public or buyer-visible.
create table public.supplier_private (
  supplier_id uuid primary key references public.suppliers (id) on delete cascade,
  contact_name text check (char_length(contact_name) <= 120),
  contact_email text check (char_length(contact_email) <= 254),
  contact_phone text check (contact_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  registration_id text check (char_length(registration_id) <= 60),
  website text check (char_length(website) <= 200),
  updated_at timestamptz not null default now()
);

create table public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  doc_type text not null check (doc_type in ('business_registration', 'tax_registration', 'export_licence', 'trade_reference', 'catalogue', 'other')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique check (storage_path ~ '^supplier/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{8,120}$'),
  scan_status public.scan_status not null default 'pending',
  scan_engine text check (char_length(scan_engine) <= 80),
  scanned_at timestamptz,
  locked boolean not null default false,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index supplier_documents_supplier on public.supplier_documents (supplier_id) where removed_at is null;
create index supplier_documents_scan on public.supplier_documents (coalesce(scanned_at, created_at))
  where scan_status in ('pending', 'failed') and removed_at is null;

-- Append-only history. No foreign keys on purpose (an erasure cascade must not hit the append-only trigger).
create table public.supplier_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  supplier_id uuid not null,
  partner_org_id uuid not null,
  actor_user_id uuid,
  kind text not null check (kind in ('submitted', 'resubmitted', 'withdrawn', 'approved', 'rejected', 'more_info_requested',
    'suspended', 'reinstated', 'document_uploaded', 'document_removed', 'document_viewed', 'scan_result')),
  from_status text,
  to_status text,
  reason text,
  details jsonb not null default '{}'::jsonb
);
create index supplier_events_supplier on public.supplier_events (supplier_id, at);

create function private.supplier_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'supplier_events is append-only' using errcode = '42501';
end;
$$;
create trigger supplier_events_no_update_delete before update or delete on public.supplier_events
  for each row execute function private.supplier_events_immutable();
create trigger supplier_events_no_truncate before truncate on public.supplier_events
  for each statement execute function private.supplier_events_immutable();

------------------------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------------------------
-- Text that a spreadsheet would execute as a formula (also a good general hygiene rule for catalogue text).
create function private.formula_text(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p is not null and btrim(p) ~ E'^[=+@\\t\\r-]' $$;

create function private.notify_platform(p_permission text, p_kind text, p_entity_type text, p_entity_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select o.id into v_org from public.organisations o where o.type = 'mitra';
  if v_org is not null then
    perform private.notify_org(v_org, p_permission, p_kind, p_entity_type, p_entity_id);
  end if;
end;
$$;

-- Every partner write goes through this: the organisation must be a partner with an approved profile.
create function private.assert_partner_active(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organisations o join public.partner_profiles pp on pp.org_id = o.id
    where o.id = p_org and o.type = 'partner' and o.status = 'active' and pp.status = 'approved'
  ) then
    perform private.raise_error('conflict', 'partner_not_approved');
  end if;
end;
$$;

-- Conflict of interest for reviewers: ever a member of the partner, or the admin who provisioned it.
create function private.has_partner_involvement(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_involvement(p_org, p_user)
      or exists (select 1 from public.partner_profiles pp where pp.org_id = p_org and pp.provisioned_by = p_user)
$$;

create function private.add_supplier_event(p_supplier uuid, p_org uuid, p_actor uuid, p_kind text,
  p_from text, p_to text, p_reason text, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.supplier_events (supplier_id, partner_org_id, actor_user_id, kind, from_status, to_status, reason, details)
  values (p_supplier, p_org, p_actor, p_kind, p_from, p_to, p_reason, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Reason text for decisions: control characters and over-long text are refused; a minimum length is optional.
create function private.clean_reason(p_reason text, p_min integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null then
    if p_min > 0 then perform private.raise_error('invalid', 'reason_required'); end if;
    return null;
  end if;
  if char_length(v) > 1000 or v ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' or char_length(v) < p_min then
    perform private.raise_error('invalid', 'reason_required');
  end if;
  return v;
end;
$$;

-- Merges supplier draft fields (public part only). Contact details are handled separately.
create function private.clean_supplier_draft(p_cur jsonb, p_new jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_cur, '{}'::jsonb);
  k text;
  t text;
  arr jsonb := '[]'::jsonb;
  item text;
begin
  for k in select jsonb_object_keys(p_new) loop
    if k not in ('name', 'country', 'state_city', 'main_category', 'description', 'capabilities', 'code',
                 'contact_name', 'contact_email', 'contact_phone', 'registration_id', 'website') then
      perform private.raise_error('invalid', 'unknown_field');
    end if;
  end loop;
  foreach k in array array['name', 'country', 'state_city', 'description'] loop
    if p_new ? k then
      t := private.clean_text(p_new ->> k, case k when 'name' then 2 when 'country' then 2 else 1 end,
        case k when 'name' then 160 when 'country' then 60 when 'state_city' then 100 else 2000 end, 'invalid_' || k);
      if private.formula_text(t) then perform private.raise_error('invalid', 'formula_text'); end if;
      v := v || jsonb_build_object(k, t);
    end if;
  end loop;
  if p_new ? 'main_category' then
    t := nullif(btrim(coalesce(p_new ->> 'main_category', '')), '');
    if t is not null and not exists (select 1 from public.product_categories c where c.slug = t and c.active) then
      perform private.raise_error('invalid', 'invalid_category');
    end if;
    v := v || jsonb_build_object('main_category', t);
  end if;
  if p_new ? 'capabilities' then
    if jsonb_typeof(p_new -> 'capabilities') <> 'array' or jsonb_array_length(p_new -> 'capabilities') > 10 then
      perform private.raise_error('invalid', 'invalid_capabilities');
    end if;
    for item in select jsonb_array_elements_text(p_new -> 'capabilities') loop
      t := private.clean_text(item, 2, 60, 'invalid_capabilities');
      if t is null or private.formula_text(t) then perform private.raise_error('invalid', 'invalid_capabilities'); end if;
      arr := arr || to_jsonb(t);
    end loop;
    v := v || jsonb_build_object('capabilities', arr);
  end if;
  return v;
end;
$$;

create function private.assert_supplier_complete(p_draft jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(char_length(p_draft ->> 'name'), 0) < 2 or coalesce(char_length(p_draft ->> 'country'), 0) < 2
     or coalesce(char_length(p_draft ->> 'main_category'), 0) < 2 or coalesce(char_length(p_draft ->> 'description'), 0) < 20 then
    perform private.raise_error('invalid', 'supplier_incomplete');
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- Partner profile and admin approval
------------------------------------------------------------------------------------------------
-- A partner organisation owner asks to be approved (creates the pending profile) or edits the labels.
create function public.save_partner_profile(p_org uuid, p_display_name text, p_contact_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := private.clean_text(p_display_name, 2, 160, 'invalid_name');
  v_email text := lower(private.clean_text(p_contact_email, 1, 254, 'invalid_email'));
  v_new boolean := false;
  v_rows integer;
  pp public.partner_profiles;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'org:manage') then perform private.raise_error('forbidden'); end if;
  if (select o.type from public.organisations o where o.id = p_org) is distinct from 'partner' then
    perform private.raise_error('invalid', 'org_not_partner');
  end if;
  perform private.require_consent();
  perform private.check_rate_limit('partnerprofile:' || v_user, 30, interval '1 hour');
  if v_name is null then perform private.raise_error('invalid', 'invalid_name'); end if;
  if v_email is not null and not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;

  insert into public.partner_profiles (org_id, display_name, contact_email) values (p_org, v_name, v_email)
  on conflict (org_id) do nothing;
  get diagnostics v_rows = row_count;
  v_new := v_rows = 1;
  select * into pp from public.partner_profiles where org_id = p_org for update;
  if not v_new then
    update public.partner_profiles set display_name = v_name, contact_email = v_email, version = version + 1, updated_at = now()
    where org_id = p_org;
  else
    perform private.notify_platform('partner:manage', 'partner.submitted', 'organisation', p_org::text);
  end if;
  perform private.write_audit(case when v_new then 'partner.requested' else 'partner.profile_saved' end, p_org,
    'partner_profile', p_org::text, '{}'::jsonb);
  return jsonb_build_object('org_id', p_org, 'status', pp.status, 'created', v_new);
end;
$$;

create function public.approve_partner(p_org uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pp public.partner_profiles;
  v_reason text := private.clean_reason(p_reason, 0);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  select * into pp from public.partner_profiles where org_id = p_org for update;
  if pp.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if (select o.status from public.organisations o where o.id = p_org) is distinct from 'active' then
    perform private.raise_error('conflict', 'org_not_active');
  end if;
  if pp.status = 'approved' then return; end if; -- retry-safe
  update public.partner_profiles set status = 'approved', decided_by = v_user, decided_at = now(),
    decision_reason = v_reason, version = version + 1, updated_at = now() where org_id = p_org;
  perform private.write_audit('partner.approved', p_org, 'partner_profile', p_org::text,
    jsonb_build_object('from', pp.status, 'reason', v_reason));
  perform private.notify_org(p_org, 'org:manage', 'partner.decided', 'organisation', p_org::text);
end;
$$;

create function public.suspend_partner(p_org uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  pp public.partner_profiles;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  select * into pp from public.partner_profiles where org_id = p_org for update;
  if pp.org_id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(p_org, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if pp.status = 'suspended' then return; end if;
  update public.partner_profiles set status = 'suspended', decided_by = v_user, decided_at = now(),
    decision_reason = v_reason, version = version + 1, updated_at = now() where org_id = p_org;
  perform private.write_audit('partner.suspended', p_org, 'partner_profile', p_org::text,
    jsonb_build_object('from', pp.status, 'reason', v_reason));
  perform private.notify_org(p_org, 'org:manage', 'partner.decided', 'organisation', p_org::text);
end;
$$;

-- Admin provisioning: MITRA creates an approved partner organisation and invites its owner by e-mail. The admin
-- never becomes a member. The generic accept_invitation() refuses these invitations (its inviter must be a member of
-- the organisation), so the owner accepts through accept_partner_invitation() below.
create function public.provision_partner(p_name text, p_owner_email text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := private.clean_text(p_name, 2, 160, 'invalid_name');
  v_display text := coalesce(private.clean_text(p_display_name, 2, 160, 'invalid_name'), v_name);
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_org uuid;
  v_token text;
  v_inv uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  if v_name is null then perform private.raise_error('invalid', 'invalid_name'); end if;
  if char_length(v_email) > 254 or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    perform private.raise_error('invalid', 'invalid_email');
  end if;
  perform private.check_rate_limit('provision:' || v_user, 20, interval '1 day');
  perform private.check_rate_limit('invite_to:' || encode(extensions.digest(v_email, 'sha256'), 'hex'), 3, interval '1 day');

  insert into public.organisations (type, name, created_by) values ('partner', v_name, null) returning id into v_org;
  insert into public.partner_profiles (org_id, status, display_name, contact_email, provisioned_by, decided_by, decided_at, decision_reason)
  values (v_org, 'approved', v_display, v_email, v_user, v_user, now(), 'provisioned by MITRA');
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, role, token_hash, expires_at, invited_by)
  values (v_org, v_email, 'owner', encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', v_user)
  returning id into v_inv;
  perform private.write_audit('partner.provisioned', v_org, 'partner_profile', v_org::text, jsonb_build_object('invitation_id', v_inv));
  return jsonb_build_object('org_id', v_org, 'invitation_id', v_inv, 'token', v_token);
end;
$$;

-- Re-send: revokes the pending owner invitation and issues a new one. Only while the partner has no active owner.
create function public.resend_partner_invitation(p_org uuid, p_owner_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_token text;
  v_inv uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  if not exists (select 1 from public.partner_profiles pp where pp.org_id = p_org and pp.provisioned_by is not null) then
    perform private.raise_error('not_found');
  end if;
  if exists (select 1 from public.memberships m where m.org_id = p_org and m.role = 'owner' and m.status = 'active') then
    perform private.raise_error('conflict', 'already_member');
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    perform private.raise_error('invalid', 'invalid_email');
  end if;
  perform private.check_rate_limit('provision:' || v_user, 20, interval '1 day');
  perform private.check_rate_limit('invite_to:' || encode(extensions.digest(v_email, 'sha256'), 'hex'), 3, interval '1 day');
  update public.invitations set revoked_at = now() where org_id = p_org and accepted_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, role, token_hash, expires_at, invited_by)
  values (p_org, v_email, 'owner', encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', v_user)
  returning id into v_inv;
  perform private.write_audit('partner.invitation_resent', p_org, 'partner_profile', p_org::text, jsonb_build_object('invitation_id', v_inv));
  return jsonb_build_object('org_id', p_org, 'invitation_id', v_inv, 'token', v_token);
end;
$$;

-- Same checks as accept_invitation() (confirmed e-mail match, single generic failure, rate limit), but the inviter
-- must be an admin who still holds partner:manage and the invitation must belong to a provisioned partner.
create function public.accept_partner_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.require_consent();
  perform private.check_rate_limit('accept:' || v_user, 10, interval '1 hour');
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return private.invalid_invitation(); end if;
  select * into v_inv from public.invitations i where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  select lower(u.email) into v_email from auth.users u where u.id = v_user and u.email_confirmed_at is not null and u.deleted_at is null;
  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at < now()
     or v_email is null or lower(v_inv.email::text) <> v_email or v_inv.role <> 'owner'
     or not exists (select 1 from public.organisations o join public.partner_profiles pp on pp.org_id = o.id
                    where o.id = v_inv.org_id and o.type = 'partner' and o.status = 'active' and pp.provisioned_by is not null)
     or not exists (select 1 from public.memberships m join public.organisations mo on mo.id = m.org_id and mo.type = 'mitra'
                    join public.role_permissions rp on rp.role = m.role and rp.permission = 'partner:manage'
                    where m.user_id = v_inv.invited_by and m.status = 'active')
     or exists (select 1 from public.memberships m where m.org_id = v_inv.org_id and m.role = 'owner' and m.status = 'active') then
    return private.invalid_invitation();
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_user, 'owner')
  on conflict (org_id, user_id) do update set role = 'owner', status = 'active', removed_at = null;
  update public.invitations set accepted_at = now(), accepted_by = v_user where id = v_inv.id;
  return jsonb_build_object('org_id', v_inv.org_id, 'role', 'owner');
end;
$$;

------------------------------------------------------------------------------------------------
-- Supplier drafts, submission and review
------------------------------------------------------------------------------------------------
create function public.save_supplier_draft(p_org uuid, p_supplier uuid, p_data jsonb, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_code text;
  v_draft jsonb;
  v_email text;
  v_phone text;
  v_website text;
  v_cname text;
  v_reg text;
  pr public.supplier_private;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'supplier:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  perform private.require_consent();
  perform private.check_rate_limit('supplier:' || v_user, 200, interval '1 hour');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;

  if p_supplier is null then
    if (select count(*) from public.suppliers x where x.partner_org_id = p_org) >= 100 then
      perform private.raise_error('conflict', 'supplier_limit_reached');
    end if;
    v_code := nullif(btrim(coalesce(p_data ->> 'code', '')), '');
    if v_code is null then v_code := 'SUP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6)); end if;
    if v_code !~ '^[A-Za-z0-9._-]{2,30}$' then perform private.raise_error('invalid', 'invalid_code'); end if;
    begin
      insert into public.suppliers (partner_org_id, code, created_by) values (p_org, v_code, v_user) returning * into s;
    exception when unique_violation then
      perform private.raise_error('conflict', 'code_exists');
    end;
  else
    select * into s from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_org for update;
    if s.id is null then perform private.raise_error('not_found'); end if;
    if p_data ? 'code' and (p_data ->> 'code') is distinct from s.code then perform private.raise_error('invalid', 'immutable_columns'); end if;
    if s.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;
    if s.draft_submitted_version is not null then perform private.raise_error('conflict', 'supplier_under_review'); end if;
    if p_expected_version is distinct from s.draft_version then perform private.raise_error('conflict', 'stale_version'); end if;
  end if;

  v_draft := private.clean_supplier_draft(s.draft, p_data - 'code' - 'contact_name' - 'contact_email' - 'contact_phone' - 'registration_id' - 'website');

  select * into pr from public.supplier_private where supplier_id = s.id;
  v_cname := case when p_data ? 'contact_name' then private.clean_text(p_data ->> 'contact_name', 1, 120, 'invalid_contact') else pr.contact_name end;
  v_email := case when p_data ? 'contact_email' then lower(private.clean_text(p_data ->> 'contact_email', 1, 254, 'invalid_email')) else pr.contact_email end;
  if v_email is not null and not private.valid_email(v_email) then perform private.raise_error('invalid', 'invalid_email'); end if;
  v_phone := case when p_data ? 'contact_phone' then private.clean_text(p_data ->> 'contact_phone', 1, 20, 'invalid_phone') else pr.contact_phone end;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$' then perform private.raise_error('invalid', 'invalid_phone'); end if;
  v_reg := case when p_data ? 'registration_id' then private.clean_text(p_data ->> 'registration_id', 1, 60, 'invalid_registration') else pr.registration_id end;
  v_website := case when p_data ? 'website' then private.clean_text(p_data ->> 'website', 1, 200, 'invalid_website') else pr.website end;
  if v_website is not null and v_website !~ '^https?://[^[:space:]]+$' then perform private.raise_error('invalid', 'invalid_website'); end if;
  if private.formula_text(v_cname) or private.formula_text(v_reg) then perform private.raise_error('invalid', 'formula_text'); end if;
  insert into public.supplier_private (supplier_id, contact_name, contact_email, contact_phone, registration_id, website)
  values (s.id, v_cname, v_email, v_phone, v_reg, v_website)
  on conflict (supplier_id) do update set contact_name = excluded.contact_name, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone, registration_id = excluded.registration_id, website = excluded.website, updated_at = now();

  update public.suppliers set draft = v_draft, draft_version = s.draft_version + 1, version = s.version + 1,
    status = case when s.status in ('more_info_needed', 'rejected') then 'draft'::public.supplier_status else s.status end,
    updated_at = now()
  where id = s.id;
  perform private.write_audit('supplier.draft_saved', p_org, 'supplier', s.id::text, '{}'::jsonb);
  return jsonb_build_object('id', s.id, 'code', s.code, 'version', s.draft_version + 1,
    'status', case when s.status in ('more_info_needed', 'rejected') then 'draft' else s.status::text end);
end;
$$;

create function public.submit_supplier(p_org uuid, p_supplier uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  pr public.supplier_private;
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
  if s.status = 'approved' and s.live_draft_version is not distinct from s.draft_version then
    perform private.raise_error('conflict', 'nothing_to_submit');
  end if;
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

create function public.withdraw_supplier_submission(p_org uuid, p_supplier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.suppliers;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org, 'supplier:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_org);
  select * into s from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_org for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if s.draft_submitted_version is null then perform private.raise_error('conflict', 'supplier_not_pending'); end if;
  update public.suppliers set draft_submitted_version = null, version = s.version + 1, updated_at = now(),
    status = case when s.status = 'approved' then 'approved'::public.supplier_status else 'draft'::public.supplier_status end
  where id = s.id;
  perform private.add_supplier_event(s.id, p_org, auth.uid(), 'withdrawn', s.status::text,
    case when s.status = 'approved' then 'approved' else 'draft' end, null, '{}'::jsonb);
  perform private.write_audit('supplier.withdrawn', p_org, 'supplier', s.id::text, '{}'::jsonb);
end;
$$;

create function public.review_supplier(p_supplier uuid, p_decision text, p_reason text, p_checks text[], p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_reason text;
  v_checks text[] := coalesce(p_checks, array[]::text[]);
  v_to public.supplier_status;
  v_kind text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('supplier:review') then perform private.raise_error('forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'request_info') then perform private.raise_error('invalid', 'invalid_decision'); end if;
  v_reason := private.clean_reason(p_reason, case when p_decision = 'approve' then 0 else 5 end);
  select * into s from public.suppliers x where x.id = p_supplier for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(s.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if s.draft_submitted_version is null then perform private.raise_error('conflict', 'supplier_not_pending'); end if;
  if p_expected_version is distinct from s.draft_submitted_version then perform private.raise_error('conflict', 'stale_version'); end if;

  if p_decision = 'approve' then
    if cardinality(v_checks) < 1 or cardinality(v_checks) > 6
       or exists (select 1 from unnest(v_checks) c where c not in
         ('contact_reachable', 'registration_document_seen', 'address_consistent', 'catalogue_consistent', 'trade_reference', 'identity_document_seen'))
       or cardinality(v_checks) <> (select count(distinct c) from unnest(v_checks) c) then
      perform private.raise_error('invalid', 'invalid_checks');
    end if;
    perform private.assert_partner_active(s.partner_org_id);
    perform private.assert_supplier_complete(s.draft);
    if not exists (select 1 from public.supplier_documents d where d.supplier_id = s.id and d.removed_at is null and d.scan_status = 'clean') then
      perform private.raise_error('conflict', 'documents_not_ready');
    end if;
    update public.suppliers set status = 'approved', draft_submitted_version = null, live_draft_version = s.draft_submitted_version,
      live_name = s.draft ->> 'name', live_country = s.draft ->> 'country', live_state_city = s.draft ->> 'state_city',
      live_main_category = s.draft ->> 'main_category', live_description = s.draft ->> 'description',
      live_capabilities = coalesce(s.draft -> 'capabilities', '[]'::jsonb), review_checks = v_checks, reviewed_at = now(),
      reviewed_by = v_user, decision_reason = v_reason, version = s.version + 1, updated_at = now()
    where id = s.id;
    v_to := 'approved'; v_kind := 'approved';
  else
    v_to := case when s.live_name is not null then 'approved'::public.supplier_status
                 when p_decision = 'reject' then 'rejected'::public.supplier_status else 'more_info_needed'::public.supplier_status end;
    v_kind := case p_decision when 'reject' then 'rejected' else 'more_info_requested' end;
    update public.suppliers set status = v_to, draft_submitted_version = null, decision_reason = v_reason,
      version = s.version + 1, updated_at = now()
    where id = s.id;
  end if;
  perform private.add_supplier_event(s.id, s.partner_org_id, v_user, v_kind, s.status::text, v_to::text, v_reason,
    jsonb_build_object('draft_version', s.draft_submitted_version, 'checks', v_checks));
  perform private.write_audit('supplier.' || v_kind, s.partner_org_id, 'supplier', s.id::text,
    jsonb_build_object('reason', v_reason, 'checks', v_checks, 'draft_version', s.draft_submitted_version));
  perform private.notify_org(s.partner_org_id, 'supplier:manage', 'supplier.decided', 'supplier', s.id::text);
end;
$$;

create function public.suspend_supplier(p_supplier uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not (private.has_platform_permission('supplier:review') or private.has_platform_permission('catalogue:moderate')) then
    perform private.raise_error('forbidden');
  end if;
  select * into s from public.suppliers x where x.id = p_supplier for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(s.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if s.status = 'suspended' then return; end if;
  if s.status <> 'approved' then perform private.raise_error('conflict', 'supplier_not_approved'); end if;
  update public.suppliers set status = 'suspended', suspended_reason = v_reason, suspended_at = now(), suspended_by = v_user,
    version = s.version + 1, updated_at = now()
  where id = s.id;
  perform private.add_supplier_event(s.id, s.partner_org_id, v_user, 'suspended', 'approved', 'suspended', v_reason, '{}'::jsonb);
  perform private.write_audit('supplier.suspended', s.partner_org_id, 'supplier', s.id::text, jsonb_build_object('reason', v_reason));
  perform private.notify_org(s.partner_org_id, 'supplier:manage', 'supplier.suspended', 'supplier', s.id::text);
end;
$$;

create function public.reinstate_supplier(p_supplier uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  s public.suppliers;
  v_reason text := private.clean_reason(p_reason, 5);
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('supplier:review') then perform private.raise_error('forbidden'); end if;
  select * into s from public.suppliers x where x.id = p_supplier for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if private.has_partner_involvement(s.partner_org_id, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if s.status <> 'suspended' then perform private.raise_error('conflict', 'supplier_not_suspended'); end if;
  update public.suppliers set status = 'approved', suspended_reason = null, version = s.version + 1, updated_at = now() where id = s.id;
  perform private.add_supplier_event(s.id, s.partner_org_id, v_user, 'reinstated', 'suspended', 'approved', v_reason, '{}'::jsonb);
  perform private.write_audit('supplier.reinstated', s.partner_org_id, 'supplier', s.id::text, jsonb_build_object('reason', v_reason));
  perform private.notify_org(s.partner_org_id, 'supplier:manage', 'supplier.decided', 'supplier', s.id::text);
end;
$$;

------------------------------------------------------------------------------------------------
-- Supplier reads (partner members and reviewers; everyone else gets 404)
------------------------------------------------------------------------------------------------
create function private.supplier_summary(s public.suppliers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'partner_org_id', s.partner_org_id, 'code', s.code, 'status', s.status,
    'name', coalesce(s.live_name, s.draft ->> 'name'), 'country', coalesce(s.live_country, s.draft ->> 'country'),
    'draft_version', s.draft_version, 'draft_submitted_version', s.draft_submitted_version, 'live_draft_version', s.live_draft_version,
    'has_unsubmitted_changes', s.status = 'approved' and s.draft_submitted_version is null and s.live_draft_version is distinct from s.draft_version,
    'version', s.version, 'reviewed_at', s.reviewed_at, 'review_checks', s.review_checks,
    'decision_reason', s.decision_reason, 'submitted_at', s.submitted_at, 'updated_at', s.updated_at)
$$;

create function public.list_my_suppliers(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(private.supplier_summary(s) order by s.created_at desc, s.id)
    from public.suppliers s where s.partner_org_id = p_org), '[]'::jsonb));
end;
$$;

create function public.get_supplier(p_supplier uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.suppliers;
  v_member boolean;
  v_reviewer boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into s from public.suppliers x where x.id = p_supplier;
  if s.id is null then perform private.raise_error('not_found'); end if;
  v_member := private.is_member(s.partner_org_id);
  v_reviewer := private.has_platform_permission('supplier:review') and s.status <> 'draft'
                and not private.has_partner_involvement(s.partner_org_id, auth.uid());
  if not v_member and not v_reviewer then perform private.raise_error('not_found'); end if;
  return private.supplier_summary(s) || jsonb_build_object(
    'draft', s.draft,
    'live', jsonb_build_object('name', s.live_name, 'country', s.live_country, 'state_city', s.live_state_city,
      'main_category', s.live_main_category, 'description', s.live_description, 'capabilities', s.live_capabilities),
    'private', (select to_jsonb(p) - 'supplier_id' from public.supplier_private p where p.supplier_id = s.id),
    'suspended_reason', s.suspended_reason,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'display_name', d.display_name,
        'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'scan_status', d.scan_status, 'locked', d.locked, 'created_at', d.created_at)
        order by d.created_at) from public.supplier_documents d where d.supplier_id = s.id and d.removed_at is null), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'from_status', e.from_status, 'to_status', e.to_status,
        'reason', e.reason, 'at', e.at) order by e.id)
        from public.supplier_events e where e.supplier_id = s.id and e.kind not in ('document_viewed', 'scan_result')), '[]'::jsonb));
end;
$$;

------------------------------------------------------------------------------------------------
-- Evidence documents. Upload and scan are done by trusted server code (service role), exactly like Phase 2.
-- Content lives in the private bucket `verification-docs` under the prefix `supplier/<org>/<supplier>/`.
------------------------------------------------------------------------------------------------
create function public.service_register_supplier_document(
  p_org uuid, p_user uuid, p_supplier uuid, p_doc_type text, p_display_name text, p_mime text, p_size bigint,
  p_sha256 text, p_storage_path text, p_scan_status public.scan_status, p_scan_engine text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  s public.suppliers;
begin
  if not exists (
    select 1 from public.memberships m
    join public.organisations o on o.id = m.org_id and o.status = 'active' and o.type = 'partner'
    join public.partner_profiles pp on pp.org_id = o.id and pp.status = 'approved'
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'supplier:manage'
    where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
  ) then
    perform private.raise_error('forbidden');
  end if;
  select * into s from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_org for update;
  if s.id is null then perform private.raise_error('not_found'); end if;
  if s.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;
  if p_doc_type not in ('business_registration', 'tax_registration', 'export_licence', 'trade_reference', 'catalogue', 'other') then
    perform private.raise_error('invalid', 'invalid_doc_type');
  end if;
  if p_storage_path is null or p_storage_path !~ ('^supplier/' || p_org::text || '/' || p_supplier::text || '/[A-Za-z0-9._-]{8,120}$') then
    perform private.raise_error('invalid', 'invalid_path');
  end if;
  if p_scan_status = 'infected' then perform private.raise_error('invalid', 'infected_not_stored'); end if;
  if (select count(*) from public.supplier_documents d where d.supplier_id = p_supplier and d.removed_at is null) >= 20 then
    perform private.raise_error('conflict', 'document_limit_reached');
  end if;
  if char_length(v_name) < 1 or v_name ~ '[[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_name'); end if;
  insert into public.supplier_documents (supplier_id, partner_org_id, doc_type, display_name, mime_type, size_bytes, sha256,
    storage_path, scan_status, scan_engine, scanned_at, uploaded_by)
  values (p_supplier, p_org, p_doc_type, left(v_name, 120), p_mime, p_size, p_sha256, p_storage_path, p_scan_status,
    left(p_scan_engine, 80), case when p_scan_status in ('clean', 'failed') then now() end, p_user)
  returning id into v_id;
  perform private.add_supplier_event(p_supplier, p_org, p_user, 'document_uploaded', null, null, null,
    jsonb_build_object('document_id', v_id, 'doc_type', p_doc_type, 'scan_status', p_scan_status));
  return v_id;
end;
$$;

create function public.service_set_supplier_document_scan(p_doc uuid, p_status public.scan_status, p_engine text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.supplier_documents;
begin
  select * into d from public.supplier_documents x where x.id = p_doc for update;
  if d.id is null then perform private.raise_error('not_found'); end if;
  if p_status = 'pending' then perform private.raise_error('invalid', 'invalid_status'); end if;
  if not (d.scan_status in ('pending', 'failed') or (d.scan_status = 'clean' and p_status = 'infected')) then
    perform private.raise_error('conflict', 'already_scanned');
  end if;
  update public.supplier_documents set scan_status = p_status, scan_engine = left(p_engine, 80), scanned_at = now() where id = p_doc;
  perform private.add_supplier_event(d.supplier_id, d.partner_org_id, null, 'scan_result', null, null, null,
    jsonb_build_object('document_id', p_doc, 'scan_status', p_status, 'previous', d.scan_status));
end;
$$;

create function public.service_list_unscanned_supplier_documents(p_limit integer)
returns table (id uuid, storage_path text, mime_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.storage_path, d.mime_type from public.supplier_documents d
  where d.scan_status in ('pending', 'failed') and d.removed_at is null
  order by coalesce(d.scanned_at, d.created_at), d.created_at
  limit least(greatest(p_limit, 1), 100)
$$;

create function public.remove_supplier_document(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.supplier_documents;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into d from public.supplier_documents x where x.id = p_doc for update;
  if d.id is null or not private.has_permission(d.partner_org_id, 'supplier:manage') then perform private.raise_error('not_found'); end if;
  perform private.assert_partner_active(d.partner_org_id);
  if d.removed_at is not null then perform private.raise_error('not_found'); end if;
  if d.locked then perform private.raise_error('conflict', 'document_in_use'); end if;
  update public.supplier_documents set removed_at = now() where id = p_doc;
  perform private.add_supplier_event(d.supplier_id, d.partner_org_id, auth.uid(), 'document_removed', null, null, null,
    jsonb_build_object('document_id', p_doc));
  return d.storage_path;
end;
$$;

create function public.get_supplier_document_access(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d public.supplier_documents;
  v_allowed boolean := false;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('supdocaccess:' || v_user, 120, interval '1 hour');
  select * into d from public.supplier_documents x where x.id = p_doc;
  if d.id is null then perform private.raise_error('not_found'); end if;
  if private.has_permission(d.partner_org_id, 'supplier:manage') then
    v_allowed := true;
  elsif d.locked and private.has_platform_permission('supplier:review')
        and not private.has_partner_involvement(d.partner_org_id, v_user) then
    v_allowed := true;
  end if;
  if not v_allowed then perform private.raise_error('not_found'); end if;
  if d.removed_at is not null or d.scan_status <> 'clean' then perform private.raise_error('forbidden', 'document_not_available'); end if;
  perform private.add_supplier_event(d.supplier_id, d.partner_org_id, v_user, 'document_viewed', null, null, null,
    jsonb_build_object('document_id', p_doc));
  perform private.write_audit('supplier.document_viewed', d.partner_org_id, 'supplier_document', p_doc::text, '{}'::jsonb);
  return jsonb_build_object('storage_path', d.storage_path, 'mime_type', d.mime_type, 'display_name', d.display_name);
end;
$$;

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.partner_profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_private enable row level security;
alter table public.supplier_documents enable row level security;
alter table public.supplier_events enable row level security;

create policy product_categories_select on public.product_categories for select to authenticated using (active);
create policy partner_profiles_select on public.partner_profiles for select to authenticated
  using (private.is_member(org_id) or private.has_platform_permission('partner:manage'));
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.is_member(partner_org_id)
         or (private.has_platform_permission('supplier:review') and (status <> 'draft' or draft_submitted_version is not null)));
-- A row is visible exactly when its supplier is (RLS applies to the sub-select), so reviewers see contact details
-- only for suppliers that were submitted, and never for another partner's draft.
create policy supplier_private_select on public.supplier_private for select to authenticated
  using (exists (select 1 from public.suppliers s where s.id = supplier_id));
create policy supplier_documents_select on public.supplier_documents for select to authenticated
  using (private.is_member(partner_org_id) or (locked and private.has_platform_permission('supplier:review')));
create policy supplier_events_select on public.supplier_events for select to authenticated
  using (private.is_member(partner_org_id) or private.has_platform_permission('supplier:review'));

grant select on public.product_categories, public.partner_profiles, public.suppliers, public.supplier_private,
  public.supplier_documents, public.supplier_events to authenticated;

revoke all on function
  private.partner_profiles_integrity(), private.supplier_events_immutable(), private.formula_text(text),
  private.notify_platform(text, text, text, text), private.assert_partner_active(uuid), private.has_partner_involvement(uuid, uuid),
  private.add_supplier_event(uuid, uuid, uuid, text, text, text, text, jsonb), private.clean_reason(text, integer),
  private.clean_supplier_draft(jsonb, jsonb), private.assert_supplier_complete(jsonb), private.supplier_summary(public.suppliers),
  public.save_partner_profile(uuid, text, text), public.approve_partner(uuid, text), public.suspend_partner(uuid, text),
  public.provision_partner(text, text, text), public.resend_partner_invitation(uuid, text), public.accept_partner_invitation(text),
  public.save_supplier_draft(uuid, uuid, jsonb, integer), public.submit_supplier(uuid, uuid, integer),
  public.withdraw_supplier_submission(uuid, uuid), public.review_supplier(uuid, text, text, text[], integer),
  public.suspend_supplier(uuid, text), public.reinstate_supplier(uuid, text), public.list_my_suppliers(uuid), public.get_supplier(uuid),
  public.service_register_supplier_document(uuid, uuid, uuid, text, text, text, bigint, text, text, public.scan_status, text),
  public.service_set_supplier_document_scan(uuid, public.scan_status, text), public.service_list_unscanned_supplier_documents(integer),
  public.remove_supplier_document(uuid), public.get_supplier_document_access(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.save_partner_profile(uuid, text, text), public.approve_partner(uuid, text), public.suspend_partner(uuid, text),
  public.provision_partner(text, text, text), public.resend_partner_invitation(uuid, text), public.accept_partner_invitation(text),
  public.save_supplier_draft(uuid, uuid, jsonb, integer), public.submit_supplier(uuid, uuid, integer),
  public.withdraw_supplier_submission(uuid, uuid), public.review_supplier(uuid, text, text, text[], integer),
  public.suspend_supplier(uuid, text), public.reinstate_supplier(uuid, text), public.list_my_suppliers(uuid), public.get_supplier(uuid),
  public.remove_supplier_document(uuid), public.get_supplier_document_access(uuid)
  to authenticated;

grant execute on function
  public.service_register_supplier_document(uuid, uuid, uuid, text, text, text, bigint, text, text, public.scan_status, text),
  public.service_set_supplier_document_scan(uuid, public.scan_status, text), public.service_list_unscanned_supplier_documents(integer)
  to service_role;
