-- Phase 6 private sourcing attachments. Reuse the private verification-docs bucket.
-- Objects are scan-gated and their random paths are queued for retryable deletion.
create table public.sourcing_rfq_documents (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null,
  partner_org_id uuid not null,
  author_org_id uuid references public.organisations(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  display_name text not null check(char_length(display_name) between 1 and 120),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes bigint not null check(size_bytes between 1 and 10485760),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique check(storage_path ~ '^sourcing/[0-9a-f-]{36}\.(pdf|png|jpg)$'),
  created_at timestamptz not null default now(),
  foreign key(rfq_id,partner_org_id) references public.sourcing_rfq_partners(rfq_id,partner_org_id) on delete cascade
);
create index sourcing_rfq_documents_thread on public.sourcing_rfq_documents(rfq_id,partner_org_id,created_at);
alter table public.sourcing_rfq_documents enable row level security;
revoke all on public.sourcing_rfq_documents from anon,authenticated;
grant select on public.sourcing_rfq_documents to authenticated;
create policy p6_documents_read on public.sourcing_rfq_documents for select to authenticated
  using(exists(select 1 from public.sourcing_rfqs r
      join public.organisations o on o.id=r.buyer_org_id and o.status='active'
      where r.id=rfq_id and private.is_member(r.buyer_org_id))
    or (private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
      join public.organisations o on o.id=p.partner_org_id and o.status='active'
      join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
      where p.rfq_id=sourcing_rfq_documents.rfq_id and p.partner_org_id=sourcing_rfq_documents.partner_org_id
        and p.status='accepted')));

create table private.sourcing_storage_cleanup (
  storage_path text primary key,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table private.sourcing_storage_cleanup enable row level security;
revoke all on private.sourcing_storage_cleanup from anon,authenticated,service_role;
create function private.p6_queue_document_cleanup() returns trigger language plpgsql set search_path='' as $$
begin
  insert into private.sourcing_storage_cleanup(storage_path) values(old.storage_path)
    on conflict(storage_path) do nothing;
  return old;
end $$;
create trigger p6_document_cleanup after delete on public.sourcing_rfq_documents
  for each row execute function private.p6_queue_document_cleanup();
revoke all on function private.p6_queue_document_cleanup() from public,anon,authenticated,service_role;

create function public.authorize_sourcing_document_upload(p_rfq uuid,p_partner uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  if r.id is null or r.status in ('closed','cancelled') or not exists(
    select 1 from public.sourcing_rfq_partners p
    join public.organisations o on o.id=p.partner_org_id and o.status='active'
    join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
    where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted')
    then perform private.raise_error('not_found'); end if;
  if not(private.has_permission(r.buyer_org_id,'request:post')
    or private.has_permission(p_partner,'sourcing:respond')) then perform private.raise_error('not_found'); end if;
  perform private.require_consent();
  return true;
end $$;

create function public.service_register_sourcing_document(
  p_rfq uuid,p_partner uuid,p_user uuid,p_name text,p_mime text,p_size bigint,p_sha256 text,p_path text
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_org uuid; v_id uuid;
begin
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or r.status in ('closed','cancelled') or not exists(
    select 1 from public.sourcing_rfq_partners p
    join public.organisations o on o.id=p.partner_org_id and o.status='active'
    join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
    where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted')
    then perform private.raise_error('not_found'); end if;
  if not exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<now()))
    or (select count(distinct c.purpose) from public.consents c where c.user_id=p_user
      and c.withdrawn_at is null and c.purpose in ('terms','privacy')
      and c.version=private.current_consent_version())<2
    then perform private.raise_error('forbidden'); end if;
  if exists(select 1 from public.memberships m join public.role_permissions rp
      on rp.role=m.role and rp.permission='request:post'
      join public.organisations o on o.id=m.org_id and o.status='active'
      where m.org_id=r.buyer_org_id and m.user_id=p_user and m.status='active') then v_org:=r.buyer_org_id;
  elsif exists(select 1 from public.memberships m join public.role_permissions rp
      on rp.role=m.role and rp.permission='sourcing:respond'
      join public.organisations o on o.id=m.org_id and o.status='active'
      join public.partner_profiles pp on pp.org_id=m.org_id and pp.status='approved'
      where m.org_id=p_partner and m.user_id=p_user and m.status='active') then v_org:=p_partner;
  else perform private.raise_error('forbidden'); end if;
  if p_path is null or p_path !~ '^sourcing/[0-9a-f-]{36}\.(pdf|png|jpg)$'
    or p_mime not in ('application/pdf','image/png','image/jpeg')
    or (p_mime='application/pdf' and right(p_path,4)<>'.pdf')
    or (p_mime='image/png' and right(p_path,4)<>'.png')
    or (p_mime='image/jpeg' and right(p_path,4)<>'.jpg')
    or p_size not between 1 and 10485760 or p_sha256 !~ '^[0-9a-f]{64}$'
    or char_length(btrim(coalesce(p_name,''))) not between 1 and 120
    then perform private.raise_error('invalid','invalid_file'); end if;
  if (select count(*) from public.sourcing_rfq_documents d where d.rfq_id=p_rfq and d.partner_org_id=p_partner)>=20
    then perform private.raise_error('conflict','document_limit_reached'); end if;
  insert into public.sourcing_rfq_documents(rfq_id,partner_org_id,author_org_id,author_user_id,
    display_name,mime_type,size_bytes,sha256,storage_path)
    values(p_rfq,p_partner,v_org,p_user,p_name,p_mime,p_size,p_sha256,p_path) returning id into v_id;
  delete from private.sourcing_storage_cleanup where storage_path=p_path;
  perform private.write_audit('sourcing.document_uploaded',v_org,'sourcing_rfq_document',v_id::text,
    jsonb_build_object('rfq_id',p_rfq));
  perform private.notify_org(case when v_org=r.buyer_org_id then p_partner else r.buyer_org_id end,
    case when v_org=r.buyer_org_id then 'sourcing:respond' else 'request:post' end,
    'sourcing.document_uploaded','sourcing_rfq',p_rfq::text);
  return v_id;
end $$;

create function public.list_sourcing_documents(p_rfq uuid,p_partner uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  if r.id is null or not exists(select 1 from public.sourcing_rfq_partners p
      join public.organisations o on o.id=p.partner_org_id and o.status='active'
      join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
      where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted')
    or not((private.is_member(r.buyer_org_id) and exists(select 1 from public.organisations o
      where o.id=r.buyer_org_id and o.status='active')) or private.is_member(p_partner))
    then perform private.raise_error('not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'at',d.created_at)
    order by d.created_at) from public.sourcing_rfq_documents d
    where d.rfq_id=p_rfq and d.partner_org_id=p_partner),'[]'::jsonb);
end $$;

create function public.get_sourcing_document_access(p_doc uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.sourcing_rfq_documents; r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  perform private.check_rate_limit('p6doc:'||auth.uid(),120,interval '1 hour');
  select * into d from public.sourcing_rfq_documents x where x.id=p_doc;
  if d.id is null then perform private.raise_error('not_found'); end if;
  select * into r from public.sourcing_rfqs x where x.id=d.rfq_id;
  if not (private.is_member(r.buyer_org_id) and exists(select 1 from public.organisations o
      where o.id=r.buyer_org_id and o.status='active')) and not(private.is_member(d.partner_org_id)
    and exists(select 1 from public.sourcing_rfq_partners p
      join public.organisations o on o.id=p.partner_org_id and o.status='active'
      join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
      where p.rfq_id=d.rfq_id and p.partner_org_id=d.partner_org_id and p.status='accepted'))
    then perform private.raise_error('not_found'); end if;
  perform private.write_audit('sourcing.document_viewed',case when private.is_member(r.buyer_org_id)
    then r.buyer_org_id else d.partner_org_id end,'sourcing_rfq_document',p_doc::text,'{}'::jsonb);
  return jsonb_build_object('rfq_id',d.rfq_id,'partner_org_id',d.partner_org_id,
    'storage_path',d.storage_path,'mime_type',d.mime_type,'display_name',d.display_name);
end $$;

create function public.remove_sourcing_document(p_doc uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.sourcing_rfq_documents; r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into d from public.sourcing_rfq_documents x where x.id=p_doc for update;
  if d.id is null then perform private.raise_error('not_found'); end if;
  select * into r from public.sourcing_rfqs x where x.id=d.rfq_id for update;
  if not(private.has_permission(r.buyer_org_id,'request:post')
      or (d.author_org_id=d.partner_org_id and private.has_permission(d.partner_org_id,'sourcing:respond')
        and exists(select 1 from public.sourcing_rfq_partners p
          join public.organisations o on o.id=p.partner_org_id and o.status='active'
          join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
          where p.rfq_id=d.rfq_id and p.partner_org_id=d.partner_org_id and p.status='accepted')))
    then perform private.raise_error('not_found'); end if;
  delete from public.sourcing_rfq_documents where id=p_doc;
  perform private.write_audit('sourcing.document_removed',case when private.is_member(r.buyer_org_id)
    then r.buyer_org_id else d.partner_org_id end,'sourcing_rfq_document',p_doc::text,'{}'::jsonb);
  return jsonb_build_object('id',p_doc,'removed',true);
end $$;

create function public.service_list_sourcing_cleanup(p_limit integer)
returns table(storage_path text) language sql security definer set search_path='' as $$
  update private.sourcing_storage_cleanup q set attempts=attempts+1
    where q.storage_path in (select x.storage_path from private.sourcing_storage_cleanup x
      where x.queued_at<now()-interval '10 minutes'
      order by x.queued_at limit least(greatest(p_limit,1),50))
    returning q.storage_path
$$;
create function public.service_queue_sourcing_cleanup(p_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_path is null or p_path !~ '^sourcing/[0-9a-f-]{36}\.(pdf|png|jpg)$'
    then perform private.raise_error('invalid','invalid_path'); end if;
  insert into private.sourcing_storage_cleanup(storage_path) values(p_path)
    on conflict(storage_path) do nothing;
end $$;
create function public.service_complete_sourcing_cleanup(p_path text) returns void
language plpgsql security definer set search_path='' as $$
begin delete from private.sourcing_storage_cleanup where storage_path=p_path; end $$;

revoke all on function
  public.service_register_sourcing_document(uuid,uuid,uuid,text,text,bigint,text,text),
  public.authorize_sourcing_document_upload(uuid,uuid),
  public.list_sourcing_documents(uuid,uuid),public.get_sourcing_document_access(uuid),
  public.remove_sourcing_document(uuid),public.service_list_sourcing_cleanup(integer),
  public.service_complete_sourcing_cleanup(text),public.service_queue_sourcing_cleanup(text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_sourcing_documents(uuid,uuid),public.get_sourcing_document_access(uuid),
  public.remove_sourcing_document(uuid),public.authorize_sourcing_document_upload(uuid,uuid) to authenticated;
grant execute on function public.service_register_sourcing_document(uuid,uuid,uuid,text,text,bigint,text,text),
  public.service_list_sourcing_cleanup(integer),public.service_complete_sourcing_cleanup(text) to service_role;
grant execute on function public.service_queue_sourcing_cleanup(text) to service_role;
