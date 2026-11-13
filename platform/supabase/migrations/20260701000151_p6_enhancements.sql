-- Phase 6 buyer negotiation, samples, repeat sourcing, and operational reads.
create table public.sourcing_rfq_counters (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sourcing_rfq_quotes(id) on delete cascade,
  quote_revision integer not null check(quote_revision > 0),
  rfq_id uuid not null references public.sourcing_rfqs(id) on delete cascade,
  partner_org_id uuid not null references public.organisations(id) on delete cascade,
  proposed_total numeric(16,2) not null check(proposed_total>=0),
  currency text not null check(currency in ('INR','MYR','USD')),
  note text not null check(char_length(note) between 1 and 1000),
  status text not null default 'open' check(status in ('open','accepted','declined','superseded')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index sourcing_rfq_counters_quote on public.sourcing_rfq_counters(quote_id,created_at desc);
create function private.p6_supersede_counters() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='sourcing_rfq_quote_revisions' then
    update public.sourcing_rfq_counters set status='superseded'
      where quote_id=new.quote_id and status='open' and quote_revision<new.revision;
  elsif tg_op='UPDATE' and old.status='submitted' and new.status<>'submitted' then
    update public.sourcing_rfq_counters set status='superseded'
      where quote_id=new.id and status='open';
  end if;
  return new;
end $$;
create trigger p6_counter_new_revision after insert on public.sourcing_rfq_quote_revisions
  for each row execute function private.p6_supersede_counters();
create trigger p6_counter_quote_status after update of status on public.sourcing_rfq_quotes
  for each row execute function private.p6_supersede_counters();

create function private.p6_preferred_quote_erased() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='preferred' then
    update public.sourcing_rfqs set preferred_quote_id=null,
      status=case when status='preferred_selected' then 'negotiating' else status end,
      version=version+1,updated_at=now()
      where id=old.rfq_id and preferred_quote_id=old.id;
    update public.sourcing_rfq_quotes set status='submitted',updated_at=now()
      where rfq_id=old.rfq_id and id<>old.id and status='rejected'
      and exists(select 1 from public.sourcing_rfqs r where r.id=old.rfq_id and r.status='negotiating')
      and exists(select 1 from public.sourcing_rfq_partners p
        join public.organisations o on o.id=p.partner_org_id and o.status='active'
        join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
        where p.rfq_id=old.rfq_id and p.partner_org_id=sourcing_rfq_quotes.partner_org_id and p.status='accepted');
  end if;
  return old;
end $$;
create trigger p6_preferred_quote_erased before delete on public.sourcing_rfq_quotes
  for each row execute function private.p6_preferred_quote_erased();
revoke all on function private.p6_supersede_counters(),private.p6_preferred_quote_erased()
  from public,anon,authenticated,service_role;
alter table public.sourcing_rfq_counters enable row level security;
revoke all on public.sourcing_rfq_counters from anon,authenticated;
grant select on public.sourcing_rfq_counters to authenticated;
create policy p6_counters_read on public.sourcing_rfq_counters for select to authenticated
  using((private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=sourcing_rfq_counters.rfq_id and p.partner_org_id=sourcing_rfq_counters.partner_org_id
      and p.status<>'declined')) or exists(select 1 from public.sourcing_rfqs r
    where r.id=rfq_id and private.is_member(r.buyer_org_id)));

create function public.list_sourcing_counters(p_rfq uuid,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_buyer boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  v_buyer:=r.id is not null and private.is_member(r.buyer_org_id);
  if not v_buyer and not(p_partner is not null and private.is_member(p_partner)
    and exists(select 1 from public.sourcing_rfq_partners p
      where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status<>'declined'))
    then perform private.raise_error('not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'quote_id',c.quote_id,'partner_org_id',c.partner_org_id,
    'proposed_total',c.proposed_total,'currency',c.currency,'note',c.note,'status',c.status,'created_at',c.created_at)
    order by c.created_at desc) from public.sourcing_rfq_counters c where c.rfq_id=p_rfq
    and (v_buyer or c.partner_org_id=p_partner)),'[]'::jsonb);
end $$;

create function public.respond_sourcing_invitation(p_rfq uuid,p_partner uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; p public.sourcing_rfq_partners; v_status text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_partner,'sourcing:respond') then perform private.raise_error('not_found'); end if;
  perform private.assert_partner_active(p_partner);
  perform private.require_consent();
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  select * into p from public.sourcing_rfq_partners x where x.rfq_id=p_rfq and x.partner_org_id=p_partner for update;
  if r.id is null or p.rfq_id is null then perform private.raise_error('not_found'); end if;
  if r.status in ('closed','cancelled','preferred_selected') or p.status<>'invited'
    then perform private.raise_error('conflict','request_not_open'); end if;
  v_status:=case when p_accept then 'accepted' else 'declined' end;
  update public.sourcing_rfq_partners set status=v_status,responded_at=now()
    where rfq_id=p_rfq and partner_org_id=p_partner;
  if p_accept then update public.sourcing_rfqs set status='awaiting_quotes',
    version=version+1,updated_at=now() where id=p_rfq and status='submitted'; end if;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind)
    values(p_rfq,p_partner,auth.uid(),'partner_'||v_status);
  perform private.write_audit('sourcing.partner_'||v_status,p_partner,'sourcing_rfq',p_rfq::text,'{}'::jsonb);
  perform private.notify_org(r.buyer_org_id,'request:post','sourcing.partner_response','sourcing_rfq',p_rfq::text);
  return jsonb_build_object('rfq_id',p_rfq,'status',v_status);
end $$;

create function public.change_sourcing_status(p_rfq uuid,p_action text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_next text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or not private.has_permission(r.buyer_org_id,'request:post') then perform private.raise_error('not_found'); end if;
  perform private.require_consent();
  if r.version is distinct from p_expected_version then perform private.raise_error('conflict','stale_version'); end if;
  if p_action='cancel' and r.status in ('submitted','awaiting_quotes','negotiating') then v_next:='cancelled';
  elsif p_action='close' and r.status='preferred_selected' then v_next:='closed';
  else perform private.raise_error('conflict','invalid_transition'); end if;
  update public.sourcing_rfqs set status=v_next,version=version+1,updated_at=now() where id=p_rfq;
  insert into public.sourcing_rfq_events(rfq_id,actor_user_id,kind,is_global) values(p_rfq,auth.uid(),v_next,true);
  perform private.write_audit('sourcing.'||v_next,r.buyer_org_id,'sourcing_rfq',p_rfq::text,'{}'::jsonb);
  return jsonb_build_object('id',p_rfq,'status',v_next,'version',r.version+1);
end $$;

create table public.sourcing_templates (
  id uuid primary key default gen_random_uuid(),
  buyer_org_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check(char_length(title) between 2 and 100),
  items jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sourcing_templates_buyer on public.sourcing_templates(buyer_org_id,created_at desc);
alter table public.sourcing_templates enable row level security;
revoke all on public.sourcing_templates from anon,authenticated;
grant select on public.sourcing_templates to authenticated;
create policy p6_templates_read on public.sourcing_templates for select to authenticated
  using(private.is_member(buyer_org_id));

-- Public business names only. Contact data and supplier drafts stay private.
create function public.list_sourcing_partners()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',pp.display_name,
    'published_products',(select count(*) from public.products p join public.suppliers s on s.id=p.supplier_id
      where p.partner_org_id=o.id and p.status='published' and s.status='approved'))
    order by pp.display_name), '[]'::jsonb)
  from public.partner_profiles pp join public.organisations o on o.id=pp.org_id
  where pp.status='approved' and o.status='active'
$$;

-- Evidence-backed suggestions only. No export eligibility, certificate or stock claims are inferred.
create function public.match_sourcing_rfq(p_rfq uuid,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_buyer boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  v_buyer:=r.id is not null and private.is_member(r.buyer_org_id);
  if not v_buyer and not(p_partner is not null and private.is_member(p_partner) and exists(
    select 1 from public.sourcing_rfq_partners p where p.rfq_id=p_rfq and p.partner_org_id=p_partner
      and p.status<>'declined'))
    then perform private.raise_error('not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id',i.id,'partner_org_id',p.partner_org_id,
    'product_id',ci.product_id,'supplier_id',s.id,'name',ci.name,'moq',ci.moq,'unit',ci.unit,
    'lead_time_max_days',ci.lead_time_max_days,'availability_confirmed_on',ci.availability_confirmed_on,
    'reasons',jsonb_build_array('Approved partner and supplier','Published product in the requested category',
      'Declared unit and minimum order quantity fit'),
    'unknown',jsonb_build_array('Export capability not evidenced','Certificates not evidenced',
      'Availability is a declaration, not live stock'),
    'deadline_fit',case when r.needed_by is null or ci.lead_time_max_days is null then null
      else ci.lead_time_max_days <= r.needed_by-current_date end)
    order by i.line_no,p.partner_org_id,ci.name)
    from public.sourcing_rfq_items i
    join public.sourcing_rfq_partners p on p.rfq_id=i.rfq_id and p.status<>'declined'
    join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
    join public.organisations o on o.id=p.partner_org_id and o.status='active'
    join public.products prod on prod.partner_org_id=p.partner_org_id and prod.status='published'
    join public.suppliers s on s.id=prod.supplier_id and s.status='approved'
    join public.catalogue_items ci on ci.product_id=prod.id and ci.category_slug=i.category_slug
      and ci.availability_status<>'unavailable'
      and lower(ci.unit)=lower(i.unit) and ci.moq<=i.quantity
    where i.rfq_id=p_rfq and i.category_slug is not null
      and (v_buyer or p.partner_org_id=p_partner)),'[]'::jsonb);
end $$;

create function public.propose_sourcing_counter(p_quote uuid,p_total numeric,p_note text,p_expected_rfq_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.sourcing_rfq_quotes; r public.sourcing_rfqs; v_currency text; v_id uuid; v_note text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into q from public.sourcing_rfq_quotes x where x.id=p_quote;
  if q.id is null then perform private.raise_error('not_found'); end if;
  select * into r from public.sourcing_rfqs x where x.id=q.rfq_id for update;
  if not private.has_permission(r.buyer_org_id,'request:post') then perform private.raise_error('not_found'); end if;
  perform private.require_consent();
  if r.version is distinct from p_expected_rfq_version then perform private.raise_error('conflict','stale_version'); end if;
  if r.status in ('closed','cancelled','preferred_selected') or q.status<>'submitted'
    then perform private.raise_error('conflict','request_not_open'); end if;
  if p_total is null or p_total<0 or scale(p_total)>2 or p_total>99999999999999.99
    then perform private.raise_error('invalid','invalid_total'); end if;
  v_note:=private.clean_text(p_note,1,1000,'invalid_note');
  if v_note is null then perform private.raise_error('invalid','invalid_note'); end if;
  select currency into v_currency from public.sourcing_rfq_quote_revisions
    where quote_id=p_quote and revision=q.current_revision;
  update public.sourcing_rfq_counters set status='superseded' where quote_id=p_quote and status='open';
  insert into public.sourcing_rfq_counters(quote_id,quote_revision,rfq_id,partner_org_id,proposed_total,currency,note,created_by)
    values(p_quote,q.current_revision,r.id,q.partner_org_id,p_total,v_currency,v_note,auth.uid()) returning id into v_id;
  update public.sourcing_rfqs set status='negotiating',version=version+1,updated_at=now() where id=r.id;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(r.id,q.partner_org_id,auth.uid(),'counter_proposed',v_id::text);
  perform private.write_audit('sourcing.counter_proposed',r.buyer_org_id,'sourcing_rfq_counter',v_id::text,
    jsonb_build_object('rfq_id',r.id));
  perform private.notify_org(q.partner_org_id,'sourcing:respond','sourcing.counter','sourcing_rfq',r.id::text);
  return jsonb_build_object('id',v_id,'version',r.version+1);
end $$;

create function public.respond_sourcing_counter(p_counter uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sourcing_rfq_counters; r public.sourcing_rfqs; q public.sourcing_rfq_quotes;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into c from public.sourcing_rfq_counters x where x.id=p_counter;
  if c.id is null then perform private.raise_error('not_found'); end if;
  if not private.has_permission(c.partner_org_id,'sourcing:respond') then perform private.raise_error('not_found'); end if;
  perform private.assert_partner_active(c.partner_org_id);
  perform private.require_consent();
  if p_action not in ('accept','decline') then perform private.raise_error('invalid','invalid_action'); end if;
  select * into r from public.sourcing_rfqs x where x.id=c.rfq_id for update;
  select * into c from public.sourcing_rfq_counters x where x.id=p_counter for update;
  select * into q from public.sourcing_rfq_quotes x where x.id=c.quote_id for update;
  if c.status<>'open' or q.status<>'submitted' or q.current_revision<>c.quote_revision
    or r.status in ('closed','cancelled','preferred_selected')
    then perform private.raise_error('conflict','counter_not_open'); end if;
  update public.sourcing_rfq_counters set status=case when p_action='accept' then 'accepted' else 'declined' end,
    responded_at=now() where id=c.id;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(r.id,c.partner_org_id,auth.uid(),'counter_'||p_action,c.id::text);
  perform private.write_audit('sourcing.counter_'||p_action,c.partner_org_id,'sourcing_rfq_counter',c.id::text,
    jsonb_build_object('rfq_id',r.id));
  perform private.notify_org(r.buyer_org_id,'request:post','sourcing.counter_response','sourcing_rfq',r.id::text);
  return jsonb_build_object('id',c.id,'status',case when p_action='accept' then 'accepted' else 'declined' end);
end $$;

create function public.request_sourcing_sample(p_rfq uuid,p_partner uuid,p_item uuid,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or not private.has_permission(r.buyer_org_id,'request:post') then perform private.raise_error('not_found'); end if;
  if r.status in ('closed','cancelled','preferred_selected') or not exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted') then perform private.raise_error('conflict','request_not_open'); end if;
  if not exists(select 1 from public.sourcing_rfq_items i where i.id=p_item and i.rfq_id=p_rfq)
    then perform private.raise_error('invalid','invalid_item'); end if;
  perform private.require_consent();
  insert into public.sourcing_rfq_samples(rfq_id,partner_org_id,item_id,note,requested_by)
    values(p_rfq,p_partner,p_item,private.clean_text(p_note,1,1000,'invalid_note'),auth.uid()) returning id into v_id;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(p_rfq,p_partner,auth.uid(),'sample_requested',v_id::text);
  perform private.notify_org(p_partner,'sourcing:respond','sourcing.sample_requested','sourcing_rfq',p_rfq::text);
  return jsonb_build_object('id',v_id,'status','requested');
end $$;

create function public.update_sourcing_sample(p_sample uuid,p_status text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sourcing_rfq_samples; r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into s from public.sourcing_rfq_samples x where x.id=p_sample;
  if s.id is null then perform private.raise_error('not_found'); end if;
  select * into r from public.sourcing_rfqs x where x.id=s.rfq_id for update;
  select * into s from public.sourcing_rfq_samples x where x.id=p_sample for update;
  if r.status in ('closed','cancelled') then perform private.raise_error('conflict','request_not_open'); end if;
  if s.version is distinct from p_expected_version then perform private.raise_error('conflict','stale_version'); end if;
  if not ((s.status='requested' and p_status in ('accepted','declined','cancelled'))
    or (s.status='accepted' and p_status in ('preparing','cancelled'))
    or (s.status='preparing' and p_status in ('dispatched','cancelled'))
    or (s.status='dispatched' and p_status='received'))
    then perform private.raise_error('conflict','invalid_transition'); end if;
  if p_status='cancelled' then
    if not private.has_permission(r.buyer_org_id,'request:post') then perform private.raise_error('not_found'); end if;
  else
    if not private.has_permission(s.partner_org_id,'sourcing:respond') then perform private.raise_error('not_found'); end if;
    perform private.assert_partner_active(s.partner_org_id);
  end if;
  perform private.require_consent();
  update public.sourcing_rfq_samples set status=p_status,version=version+1,updated_at=now() where id=p_sample;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(s.rfq_id,s.partner_org_id,auth.uid(),'sample_'||p_status,s.id::text);
  perform private.write_audit('sourcing.sample_'||p_status,
    case when p_status='cancelled' then r.buyer_org_id else s.partner_org_id end,
    'sourcing_rfq_sample',s.id::text,jsonb_build_object('rfq_id',s.rfq_id));
  return jsonb_build_object('id',s.id,'status',p_status,'version',s.version+1);
end $$;

create function public.save_sourcing_template(p_org uuid,p_title text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; el jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_org,'request:post') then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20
    then perform private.raise_error('invalid','invalid_items'); end if;
  for el in select jsonb_array_elements(p_items) loop
    if jsonb_typeof(el)<>'object' or private.clean_text(el->>'name',2,160,'invalid_name') is null
      or private.clean_text(el->>'unit',1,40,'invalid_unit') is null
      or (el->>'quantity') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' or (el->>'quantity')::numeric<=0
      then perform private.raise_error('invalid','invalid_item'); end if;
  end loop;
  insert into public.sourcing_templates(buyer_org_id,title,items,created_by)
    values(p_org,private.clean_text(p_title,2,100,'invalid_title'),p_items,auth.uid()) returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;
create function public.list_sourcing_templates(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'items',t.items)
    order by t.created_at desc) from public.sourcing_templates t where t.buyer_org_id=p_org),'[]'::jsonb);
end $$;

-- Safe repeat operation returns editable snapshots; the buyer authorizes recipients again on submission.
create function public.repeat_sourcing_rfq(p_rfq uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  if r.id is null or not private.has_permission(r.buyer_org_id,'request:post')
    then perform private.raise_error('not_found'); end if;
  return jsonb_build_object('source_rfq_id',r.id,'state',r.destination_state,'city',r.destination_city,
    'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.name_snapshot,'quantity',i.quantity,
      'unit',i.unit,'category_slug',i.category_slug,'specification',i.specification) order by i.line_no)
      from public.sourcing_rfq_items i where i.rfq_id=r.id),'[]'::jsonb));
end $$;

create function public.sourcing_timeline(p_rfq uuid,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  if r.id is null or not(private.is_member(r.buyer_org_id) or (p_partner is not null
    and private.is_member(p_partner) and exists(select 1 from public.sourcing_rfq_partners p
      where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status<>'declined')))
    then perform private.raise_error('not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'at',e.at,'partner_org_id',
    case when private.is_member(r.buyer_org_id) then e.partner_org_id else null end)
    order by e.id) from public.sourcing_rfq_events e where e.rfq_id=p_rfq
    and (private.is_member(r.buyer_org_id) or e.partner_org_id=p_partner or e.is_global)),'[]'::jsonb);
end $$;

create function public.sourcing_operations(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('report:view') then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('total_requests',(select count(*) from public.sourcing_rfqs),
    'awaiting_quotes',(select count(*) from public.sourcing_rfqs where status='awaiting_quotes'),
    'preferred_selected',(select count(*) from public.sourcing_rfqs where status='preferred_selected'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'reference',x.reference,
      'status',x.status,'created_at',x.created_at) order by x.created_at desc)
      from (select id,reference,status,created_at from public.sourcing_rfqs
        order by created_at desc limit 25 offset greatest(coalesce(p_offset,0),0)) x),'[]'::jsonb));
end $$;

revoke all on function public.propose_sourcing_counter(uuid,numeric,text,integer),
  public.respond_sourcing_invitation(uuid,uuid,boolean),public.change_sourcing_status(uuid,text,integer),
  public.list_sourcing_counters(uuid,uuid),
  public.respond_sourcing_counter(uuid,text),public.request_sourcing_sample(uuid,uuid,uuid,text),
  public.update_sourcing_sample(uuid,text,integer),public.save_sourcing_template(uuid,text,jsonb),
  public.list_sourcing_templates(uuid),public.repeat_sourcing_rfq(uuid),public.sourcing_timeline(uuid,uuid),
  public.sourcing_operations(integer),public.list_sourcing_partners(),
  public.match_sourcing_rfq(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.propose_sourcing_counter(uuid,numeric,text,integer),
  public.respond_sourcing_invitation(uuid,uuid,boolean),public.change_sourcing_status(uuid,text,integer),
  public.list_sourcing_counters(uuid,uuid),
  public.respond_sourcing_counter(uuid,text),public.request_sourcing_sample(uuid,uuid,uuid,text),
  public.update_sourcing_sample(uuid,text,integer),public.save_sourcing_template(uuid,text,jsonb),
  public.list_sourcing_templates(uuid),public.repeat_sourcing_rfq(uuid),public.sourcing_timeline(uuid,uuid),
  public.sourcing_operations(integer),public.list_sourcing_partners(),
  public.match_sourcing_rfq(uuid,uuid) to authenticated;
