-- INOK Phase 6: multi-product sourcing. Phase 5's single-supplier requests remain unchanged.
create table public.sourcing_rfqs (
  id uuid primary key default gen_random_uuid(),
  buyer_org_id uuid not null references public.organisations(id) on delete cascade,
  source_request_id uuid references public.sourcing_requests(id) on delete set null,
  reference text not null unique default ('IR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  status text not null default 'submitted' check (status in ('submitted','awaiting_quotes','negotiating','preferred_selected','closed','cancelled')),
  destination_state text not null,
  destination_city text,
  needed_by date,
  note text,
  idempotency_key text not null,
  payload_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  preferred_quote_id uuid,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_org_id,idempotency_key),
  check (char_length(note) <= 2000),
  check (char_length(destination_city) <= 80)
);
create index sourcing_rfqs_buyer on public.sourcing_rfqs(buyer_org_id,created_at desc);

create table public.sourcing_rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.sourcing_rfqs(id) on delete cascade,
  line_no integer not null check (line_no between 1 and 20),
  product_id uuid references public.products(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  category_slug text references public.product_categories(slug) on delete set null,
  name_snapshot text not null check (char_length(name_snapshot) between 2 and 160),
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (char_length(unit) between 1 and 40),
  specification text check (char_length(specification) <= 2000),
  catalogue_snapshot jsonb,
  unique(rfq_id,line_no)
);

-- One row per explicitly authorized receiving partner. No partner sees other partners' offers or messages.
create table public.sourcing_rfq_partners (
  rfq_id uuid not null references public.sourcing_rfqs(id) on delete cascade,
  partner_org_id uuid not null references public.organisations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'invited' check (status in ('invited','accepted','declined')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key(rfq_id,partner_org_id)
);
create index sourcing_rfq_partners_partner on public.sourcing_rfq_partners(partner_org_id,status,invited_at desc);

create table public.sourcing_rfq_messages (
  id bigint generated always as identity primary key,
  rfq_id uuid not null,
  partner_org_id uuid not null,
  author_org_id uuid references public.organisations(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key(rfq_id,partner_org_id) references public.sourcing_rfq_partners(rfq_id,partner_org_id) on delete cascade
);
create index sourcing_rfq_messages_thread on public.sourcing_rfq_messages(rfq_id,partner_org_id,id);

create table public.sourcing_rfq_quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null,
  partner_org_id uuid not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'submitted' check (status in ('submitted','withdrawn','preferred','rejected')),
  current_revision integer not null default 1,
  version integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct(rfq_id,partner_org_id,supplier_id),
  foreign key(rfq_id,partner_org_id) references public.sourcing_rfq_partners(rfq_id,partner_org_id) on delete cascade
);
create table public.sourcing_rfq_quote_revisions (
  quote_id uuid not null references public.sourcing_rfq_quotes(id) on delete cascade,
  revision integer not null check (revision > 0),
  currency text not null check (currency in ('INR','MYR','USD')),
  lines jsonb not null,
  subtotal numeric(16,2) not null check (subtotal >= 0),
  charges numeric(16,2) not null check (charges >= 0),
  discount numeric(16,2) not null check (discount >= 0),
  total numeric(16,2) not null check (total >= 0),
  lead_time_days integer check (lead_time_days between 0 and 365),
  terms text check (char_length(terms) <= 2000),
  valid_until date not null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  primary key(quote_id,revision),
  check(total = subtotal + charges - discount),
  check(valid_until >= submitted_at::date)
);
alter table public.sourcing_rfqs add constraint sourcing_rfqs_preferred_quote_fk
  foreign key(preferred_quote_id) references public.sourcing_rfq_quotes(id) on delete set null;

create table public.sourcing_rfq_samples (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null,
  partner_org_id uuid not null,
  item_id uuid references public.sourcing_rfq_items(id) on delete set null,
  status text not null default 'requested' check(status in ('requested','accepted','declined','preparing','dispatched','received','cancelled')),
  note text check(char_length(note) <= 1000),
  version integer not null default 0,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(rfq_id,partner_org_id) references public.sourcing_rfq_partners(rfq_id,partner_org_id) on delete cascade
);

create table public.sourcing_rfq_events (
  id bigint generated always as identity primary key,
  rfq_id uuid not null references public.sourcing_rfqs(id) on delete cascade,
  partner_org_id uuid references public.organisations(id) on delete set null,
  is_global boolean not null default false,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  entity_id text,
  at timestamptz not null default now()
);
create index sourcing_rfq_events_rfq on public.sourcing_rfq_events(rfq_id,id);

-- The Data API cannot mutate Phase 6 records directly; every write uses a checked RPC.
alter table public.sourcing_rfqs enable row level security;
alter table public.sourcing_rfq_items enable row level security;
alter table public.sourcing_rfq_partners enable row level security;
alter table public.sourcing_rfq_messages enable row level security;
alter table public.sourcing_rfq_quotes enable row level security;
alter table public.sourcing_rfq_quote_revisions enable row level security;
alter table public.sourcing_rfq_samples enable row level security;
alter table public.sourcing_rfq_events enable row level security;
revoke all on public.sourcing_rfqs,public.sourcing_rfq_items,public.sourcing_rfq_partners,
  public.sourcing_rfq_messages,public.sourcing_rfq_quotes,public.sourcing_rfq_quote_revisions,
  public.sourcing_rfq_samples,public.sourcing_rfq_events from anon,authenticated;
grant select on public.sourcing_rfqs,public.sourcing_rfq_items,public.sourcing_rfq_partners,
  public.sourcing_rfq_messages,public.sourcing_rfq_quotes,public.sourcing_rfq_quote_revisions,
  public.sourcing_rfq_samples,public.sourcing_rfq_events to authenticated;
create policy p6_rfqs_read on public.sourcing_rfqs for select to authenticated
  using(private.is_member(buyer_org_id));
create policy p6_items_read on public.sourcing_rfq_items for select to authenticated
  using(exists(select 1 from public.sourcing_rfqs r where r.id=rfq_id));
create policy p6_partners_read on public.sourcing_rfq_partners for select to authenticated
  using(private.is_member(partner_org_id) or exists(select 1 from public.sourcing_rfqs r
    where r.id=rfq_id and private.is_member(r.buyer_org_id)));
create policy p6_messages_read on public.sourcing_rfq_messages for select to authenticated
  using((private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=sourcing_rfq_messages.rfq_id and p.partner_org_id=sourcing_rfq_messages.partner_org_id
      and p.status<>'declined'))
    or exists(select 1 from public.sourcing_rfqs r
    where r.id=rfq_id and private.is_member(r.buyer_org_id)));
create policy p6_quotes_read on public.sourcing_rfq_quotes for select to authenticated
  using((private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=sourcing_rfq_quotes.rfq_id and p.partner_org_id=sourcing_rfq_quotes.partner_org_id
      and p.status<>'declined'))
    or exists(select 1 from public.sourcing_rfqs r
    where r.id=rfq_id and private.is_member(r.buyer_org_id)));
create policy p6_revisions_read on public.sourcing_rfq_quote_revisions for select to authenticated
  using(exists(select 1 from public.sourcing_rfq_quotes q where q.id=quote_id));
create policy p6_samples_read on public.sourcing_rfq_samples for select to authenticated
  using((private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=sourcing_rfq_samples.rfq_id and p.partner_org_id=sourcing_rfq_samples.partner_org_id
      and p.status<>'declined'))
    or exists(select 1 from public.sourcing_rfqs r
    where r.id=rfq_id and private.is_member(r.buyer_org_id)));
create policy p6_events_read on public.sourcing_rfq_events for select to authenticated
  using(partner_org_id is null and exists(select 1 from public.sourcing_rfqs r where r.id=rfq_id and private.is_member(r.buyer_org_id))
    or partner_org_id is not null and ((private.is_member(partner_org_id) and exists(select 1 from public.sourcing_rfq_partners p
      where p.rfq_id=sourcing_rfq_events.rfq_id and p.partner_org_id=sourcing_rfq_events.partner_org_id and p.status<>'declined'))
      or exists(select 1 from public.sourcing_rfqs r
      where r.id=rfq_id and private.is_member(r.buyer_org_id))));

create function private.p6_quote_lines(p_rfq uuid,p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare el jsonb; i public.sourcing_rfq_items; n numeric; price numeric; amount numeric; subtotal numeric:=0; result jsonb:='[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>20
    then perform private.raise_error('invalid','invalid_lines'); end if;
  if (select count(*) from public.sourcing_rfq_items x where x.rfq_id=p_rfq)<>jsonb_array_length(p_lines)
    then perform private.raise_error('invalid','all_lines_required'); end if;
  for el in select jsonb_array_elements(p_lines) loop
    if jsonb_typeof(el)<>'object' or (el->>'item_id') is null or (el->>'unit_price') is null
      or (el->>'unit_price') !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
      then perform private.raise_error('invalid','invalid_lines'); end if;
    begin select * into i from public.sourcing_rfq_items x where x.id=(el->>'item_id')::uuid and x.rfq_id=p_rfq;
    exception when invalid_text_representation then perform private.raise_error('invalid','invalid_lines'); end;
    if i.id is null or result @> jsonb_build_array(jsonb_build_object('item_id',i.id))
      then perform private.raise_error('invalid','invalid_lines'); end if;
    price:=(el->>'unit_price')::numeric;
    amount:=round(i.quantity*price,2);
    subtotal:=subtotal+amount;
    if subtotal>99999999999999.99 then perform private.raise_error('invalid','invalid_total'); end if;
    result:=result || jsonb_build_array(jsonb_build_object('item_id',i.id,'name',i.name_snapshot,
      'quantity',i.quantity::text,'unit',i.unit,'unit_price',price::text,'amount',amount::text));
  end loop;
  return jsonb_build_object('lines',result,'subtotal',subtotal);
end $$;

revoke all on function private.p6_quote_lines(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.p6_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  -- FK SET NULL redacts deleted participant identifiers while retaining commercial history.
  if tg_table_name='sourcing_rfq_messages' then
    if tg_op='UPDATE' then
      if (to_jsonb(new)-array['author_org_id','author_user_id'])=(to_jsonb(old)-array['author_org_id','author_user_id'])
        and (new.author_org_id is not distinct from old.author_org_id or
          (new.author_org_id is null and not exists(select 1 from public.organisations o where o.id=old.author_org_id)))
        and (new.author_user_id is not distinct from old.author_user_id or
          (new.author_user_id is null and not exists(select 1 from auth.users u where u.id=old.author_user_id)))
        then return new; end if;
    elsif not exists(select 1 from public.sourcing_rfq_partners p
      where p.rfq_id=old.rfq_id and p.partner_org_id=old.partner_org_id) then return old; end if;
  elsif tg_table_name='sourcing_rfq_quote_revisions' then
    if tg_op='UPDATE' then
      if (to_jsonb(new)-'submitted_by')=(to_jsonb(old)-'submitted_by')
        and new.submitted_by is null and not exists(select 1 from auth.users u where u.id=old.submitted_by)
        then return new; end if;
    elsif not exists(select 1 from public.sourcing_rfq_quotes q where q.id=old.quote_id)
      then return old; end if;
  elsif tg_table_name='sourcing_rfq_events' then
    if tg_op='UPDATE' then
      if (to_jsonb(new)-array['actor_user_id','partner_org_id'])=(to_jsonb(old)-array['actor_user_id','partner_org_id'])
        and (new.actor_user_id is not distinct from old.actor_user_id or
          (new.actor_user_id is null and not exists(select 1 from auth.users u where u.id=old.actor_user_id)))
        and (new.partner_org_id is not distinct from old.partner_org_id or
          (new.partner_org_id is null and not exists(select 1 from public.organisations o where o.id=old.partner_org_id)))
        then return new; end if;
    elsif not exists(select 1 from public.sourcing_rfqs r where r.id=old.rfq_id)
      then return old; end if;
  end if;
  raise exception 'Phase 6 history is immutable' using errcode='42501';
end $$;
create trigger p6_quote_revisions_immutable before update or delete on public.sourcing_rfq_quote_revisions
  for each row execute function private.p6_immutable();
create trigger p6_messages_immutable before update or delete on public.sourcing_rfq_messages
  for each row execute function private.p6_immutable();
create trigger p6_events_immutable before update or delete on public.sourcing_rfq_events
  for each row execute function private.p6_immutable();

create function public.create_sourcing_rfq(p_buyer_org uuid,p_key text,p_items jsonb,p_partner_orgs uuid[],
  p_state text,p_city text default null,p_needed_by date default null,p_note text default null,p_source_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; el jsonb; v_id uuid; v_product uuid; v_sup uuid; v_snap jsonb; v_category text;
  v_name text; v_qty text; v_unit text; v_spec text; v_partner uuid; v_hash text; v_count integer:=0;
  v_city text:=private.clean_text(p_city,1,80,'invalid_district');
  v_note text:=private.clean_text(p_note,1,2000,'invalid_note');
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_buyer_org,'request:post') then perform private.raise_error('forbidden'); end if;
  if (select o.type from public.organisations o where o.id=p_buyer_org) not in ('buyer','business')
    then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  if p_key is null or char_length(p_key) not between 8 and 80
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20
    or p_partner_orgs is null or array_length(p_partner_orgs,1) not between 1 and 5
    or not private.valid_state(p_state)
    or (p_needed_by is not null and (p_needed_by<current_date or p_needed_by>current_date+730))
    then perform private.raise_error('invalid','invalid_data'); end if;
  if p_source_request is not null and not exists(select 1 from public.sourcing_requests s
    where s.id=p_source_request and s.buyer_org_id=p_buyer_org)
    then perform private.raise_error('not_found'); end if;
  v_hash:=encode(extensions.digest(jsonb_build_object('items',p_items,'partners',p_partner_orgs,
    'state',p_state,'city',v_city,'date',p_needed_by,'note',v_note,'source',p_source_request)::text,'sha256'),'hex');
  select * into r from public.sourcing_rfqs x where x.buyer_org_id=p_buyer_org and x.idempotency_key=p_key;
  if r.id is not null then
    if r.payload_hash<>v_hash then perform private.raise_error('conflict','idempotency_key_reused'); end if;
    return jsonb_build_object('id',r.id,'reference',r.reference,'created',false);
  end if;
  perform private.check_rate_limit('p6rfq:'||auth.uid(),30,interval '1 day');
  -- The buyer authorizes each recipient explicitly. Lock approval rows before making invitations.
  if (select count(distinct x) from unnest(p_partner_orgs) x)<>array_length(p_partner_orgs,1)
    then perform private.raise_error('invalid','duplicate_partner'); end if;
  foreach v_partner in array p_partner_orgs loop
    perform 1 from public.partner_profiles pp join public.organisations o on o.id=pp.org_id
      where pp.org_id=v_partner and pp.status='approved' and o.type='partner' and o.status='active' for share of pp,o;
    if not found then perform private.raise_error('invalid','partner_not_available'); end if;
  end loop;
  insert into public.sourcing_rfqs(buyer_org_id,source_request_id,destination_state,destination_city,needed_by,
    note,idempotency_key,payload_hash,created_by)
    values(p_buyer_org,p_source_request,p_state,v_city,p_needed_by,v_note,p_key,v_hash,auth.uid())
    on conflict(buyer_org_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select * into r from public.sourcing_rfqs x where x.buyer_org_id=p_buyer_org and x.idempotency_key=p_key;
    if r.payload_hash<>v_hash then perform private.raise_error('conflict','idempotency_key_reused'); end if;
    return jsonb_build_object('id',r.id,'reference',r.reference,'created',false);
  end if;
  for el in select jsonb_array_elements(p_items) loop
    v_count:=v_count+1;
    if jsonb_typeof(el)<>'object' or (el->>'quantity') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$'
      then perform private.raise_error('invalid','invalid_item'); end if;
    v_qty:=el->>'quantity';
    if v_qty::numeric<=0 then perform private.raise_error('invalid','invalid_quantity'); end if;
    v_spec:=private.clean_text(el->>'specification',1,2000,'invalid_specification');
    v_product:=null; v_sup:=null; v_snap:=null; v_category:=null;
    if el ? 'product_id' and nullif(el->>'product_id','') is not null then
      begin v_product:=(el->>'product_id')::uuid;
      exception when invalid_text_representation then perform private.raise_error('invalid','invalid_item'); end;
      select p.supplier_id into v_sup from public.products p where p.id=v_product and p.status='published' for share;
      if v_sup is null or not private.product_visible(v_product) then perform private.raise_error('not_found'); end if;
      v_snap:=private.sourcing_snapshot(v_product,null,v_qty::numeric);
      v_name:=v_snap->>'name'; v_unit:=v_snap->>'unit';
      select ci.category_slug into v_category from public.catalogue_items ci where ci.product_id=v_product;
    else
      v_name:=private.clean_text(el->>'name',2,160,'invalid_name');
      v_unit:=private.clean_text(el->>'unit',1,40,'invalid_unit');
      if v_name is null or v_unit is null then perform private.raise_error('invalid','invalid_item'); end if;
      v_category:=nullif(el->>'category_slug','');
      if v_category is not null and not exists(select 1 from public.product_categories c where c.slug=v_category and c.active)
        then perform private.raise_error('invalid','invalid_category'); end if;
    end if;
    insert into public.sourcing_rfq_items(rfq_id,line_no,product_id,supplier_id,category_slug,name_snapshot,quantity,unit,specification,catalogue_snapshot)
      values(v_id,v_count,v_product,v_sup,v_category,v_name,v_qty::numeric,v_unit,v_spec,v_snap);
  end loop;
  foreach v_partner in array p_partner_orgs loop
    insert into public.sourcing_rfq_partners(rfq_id,partner_org_id) values(v_id,v_partner);
    perform private.notify_org(v_partner,'sourcing:respond','sourcing.rfq_received','sourcing_rfq',v_id::text);
  end loop;
  insert into public.sourcing_rfq_events(rfq_id,actor_user_id,kind,is_global) values(v_id,auth.uid(),'submitted',true);
  perform private.write_audit('sourcing.rfq_submitted',p_buyer_org,'sourcing_rfq',v_id::text,
    jsonb_build_object('lines',v_count,'partner_count',array_length(p_partner_orgs,1)));
  select * into r from public.sourcing_rfqs x where x.id=v_id;
  return jsonb_build_object('id',v_id,'reference',r.reference,'created',true);
end $$;

create function public.list_sourcing_rfqs(p_org uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,
    'reference',x.reference,'status',x.status,'created_at',x.created_at,'needed_by',x.needed_by)
    order by x.created_at desc,x.id) from (select r.* from public.sourcing_rfqs r
      where r.buyer_org_id=p_org or exists(select 1 from public.sourcing_rfq_partners p
        where p.rfq_id=r.id and p.partner_org_id=p_org and p.status<>'declined')
      order by r.created_at desc,r.id limit 25 offset greatest(coalesce(p_offset,0),0)) x),'[]'::jsonb));
end $$;

create function public.get_sourcing_rfq(p_rfq uuid,p_partner uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_buyer boolean; v_partner boolean;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq;
  if r.id is null then perform private.raise_error('not_found'); end if;
  v_buyer:=private.is_member(r.buyer_org_id);
  v_partner:=p_partner is not null and private.is_member(p_partner) and exists(
    select 1 from public.sourcing_rfq_partners p where p.rfq_id=p_rfq and p.partner_org_id=p_partner
      and p.status<>'declined');
  if not v_buyer and not v_partner then perform private.raise_error('not_found'); end if;
  return jsonb_build_object('id',r.id,'reference',r.reference,'status',r.status,'version',r.version,
    'buyer_org_id',case when v_buyer then r.buyer_org_id end,'partner_org_id',case when v_partner then p_partner end,
    'destination_state',r.destination_state,'destination_city',r.destination_city,'needed_by',r.needed_by,
    'note',r.note,'preferred_quote_id',r.preferred_quote_id,'created_at',r.created_at,
    'your_invitation_status',case when v_partner then
      (select p.status from public.sourcing_rfq_partners p where p.rfq_id=p_rfq and p.partner_org_id=p_partner) end,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'line_no',i.line_no,'name',i.name_snapshot,
      'category_slug',i.category_slug,
      'quantity',i.quantity,'unit',i.unit,'specification',i.specification,'catalogue_snapshot',i.catalogue_snapshot)
      order by i.line_no) from public.sourcing_rfq_items i where i.rfq_id=p_rfq),'[]'::jsonb),
    'partners',case when v_buyer then coalesce((select jsonb_agg(jsonb_build_object('org_id',p.partner_org_id,
      'status',p.status) order by p.invited_at) from public.sourcing_rfq_partners p where p.rfq_id=p_rfq),'[]'::jsonb) end,
    'quotes',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'partner_org_id',q.partner_org_id,
      'supplier_id',q.supplier_id,'status',q.status,'version',q.version,'revision',q.current_revision,
      'offer',jsonb_build_object('currency',v.currency,'lines',v.lines,'subtotal',v.subtotal::text,
        'charges',v.charges::text,'discount',v.discount::text,'total',v.total::text,'terms',v.terms,
        'valid_until',v.valid_until,'lead_time_days',v.lead_time_days))
      order by q.created_at) from public.sourcing_rfq_quotes q join public.sourcing_rfq_quote_revisions v
      on v.quote_id=q.id and v.revision=q.current_revision where q.rfq_id=p_rfq
      and (v_buyer or q.partner_org_id=p_partner)),'[]'::jsonb),
    'samples',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'item_id',s.item_id,
      'partner_org_id',s.partner_org_id,'status',s.status,'version',s.version,'note',s.note)
      order by s.created_at) from public.sourcing_rfq_samples s where s.rfq_id=p_rfq
      and (v_buyer or s.partner_org_id=p_partner)),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'partner_org_id',m.partner_org_id,
      'side',case when m.author_org_id=r.buyer_org_id then 'buyer' else 'partner' end,'body',m.body,'at',m.created_at)
      order by m.id) from public.sourcing_rfq_messages m where m.rfq_id=p_rfq
      and (v_buyer or m.partner_org_id=p_partner)),'[]'::jsonb));
end $$;

create function public.send_sourcing_message(p_rfq uuid,p_partner uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; v_side uuid; v_id bigint; v_body text;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or not exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status<>'declined')
    then perform private.raise_error('not_found'); end if;
  if private.has_permission(r.buyer_org_id,'request:post') then v_side:=r.buyer_org_id;
  elsif private.has_permission(p_partner,'sourcing:respond') then
    if not exists(select 1 from public.sourcing_rfq_partners p
      where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted')
      then perform private.raise_error('conflict','invitation_not_accepted'); end if;
    perform private.assert_partner_active(p_partner); v_side:=p_partner;
  else perform private.raise_error('not_found'); end if;
  if r.status in ('closed','cancelled') then perform private.raise_error('conflict','request_not_open'); end if;
  perform private.require_consent();
  v_body:=private.clean_text(p_body,1,2000,'invalid_message');
  if v_body is null then perform private.raise_error('invalid','invalid_message'); end if;
  perform private.check_rate_limit('p6msg:'||auth.uid(),100,interval '1 hour');
  insert into public.sourcing_rfq_messages(rfq_id,partner_org_id,author_org_id,author_user_id,body)
    values(p_rfq,p_partner,v_side,auth.uid(),v_body) returning id into v_id;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(p_rfq,p_partner,auth.uid(),'message',v_id::text);
  perform private.notify_org(case when v_side=r.buyer_org_id then p_partner else r.buyer_org_id end,
    case when v_side=r.buyer_org_id then 'sourcing:respond' else 'request:post' end,
    'sourcing.message','sourcing_rfq',p_rfq::text);
  return jsonb_build_object('id',v_id);
end $$;

create function public.submit_sourcing_quote(p_rfq uuid,p_partner uuid,p_supplier uuid,p_currency text,p_lines jsonb,
  p_charges numeric,p_discount numeric,p_lead_days integer,p_terms text,p_valid_until date,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; q public.sourcing_rfq_quotes; v_math jsonb; v_sub numeric; v_total numeric; v_rev integer;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_partner,'sourcing:respond') then perform private.raise_error('forbidden'); end if;
  perform private.require_consent();
  perform private.assert_partner_active(p_partner);
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or not exists(select 1 from public.sourcing_rfq_partners p
    where p.rfq_id=p_rfq and p.partner_org_id=p_partner and p.status='accepted')
    then perform private.raise_error('not_found'); end if;
  if r.status in ('closed','cancelled','preferred_selected') then perform private.raise_error('conflict','request_not_open'); end if;
  if p_supplier is not null and not exists(select 1 from public.suppliers s
    where s.id=p_supplier and s.partner_org_id=p_partner and s.status='approved')
    then perform private.raise_error('invalid','supplier_not_available'); end if;
  if p_currency not in ('INR','MYR','USD') or p_charges is null or p_discount is null
    or p_charges<0 or p_discount<0 or scale(p_charges)>2 or scale(p_discount)>2
    or p_charges>999999999999.99 or p_discount>999999999999.99
    or p_lead_days not between 0 and 365 or p_valid_until<current_date or p_valid_until>current_date+365
    then perform private.raise_error('invalid','invalid_quote'); end if;
  v_math:=private.p6_quote_lines(p_rfq,p_lines);
  v_sub:=(v_math->>'subtotal')::numeric; v_total:=v_sub+p_charges-p_discount;
  if v_total<0 or v_total>99999999999999.99 then perform private.raise_error('invalid','invalid_total'); end if;
  select * into q from public.sourcing_rfq_quotes x where x.rfq_id=p_rfq and x.partner_org_id=p_partner
    and x.supplier_id is not distinct from p_supplier for update;
  if q.id is null then
    if p_expected_version is distinct from null and p_expected_version<>0 then perform private.raise_error('conflict','stale_version'); end if;
    insert into public.sourcing_rfq_quotes(rfq_id,partner_org_id,supplier_id,created_by)
      values(p_rfq,p_partner,p_supplier,auth.uid()) returning * into q;
    v_rev:=1;
  else
    if p_expected_version is null or p_expected_version<>q.version then perform private.raise_error('conflict','stale_version'); end if;
    if q.status<>'submitted' then perform private.raise_error('conflict','quote_not_open'); end if;
    if q.supplier_id is distinct from p_supplier then perform private.raise_error('conflict','supplier_changed'); end if;
    v_rev:=q.current_revision+1;
    update public.sourcing_rfq_quotes set current_revision=v_rev,version=version+1,updated_at=now() where id=q.id;
  end if;
  insert into public.sourcing_rfq_quote_revisions(quote_id,revision,currency,lines,subtotal,charges,discount,total,
    lead_time_days,terms,valid_until,submitted_by)
    values(q.id,v_rev,p_currency,v_math->'lines',v_sub,p_charges,p_discount,v_total,
      p_lead_days,private.clean_text(p_terms,1,2000,'invalid_terms'),p_valid_until,auth.uid());
  update public.sourcing_rfqs set status=case when status='submitted' then 'awaiting_quotes' else 'negotiating' end,
    version=version+1,updated_at=now() where id=p_rfq;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(p_rfq,p_partner,auth.uid(),case when v_rev=1 then 'quote_submitted' else 'quote_revised' end,q.id::text);
  perform private.write_audit('sourcing.quote_submitted',p_partner,'sourcing_rfq_quote',q.id::text,
    jsonb_build_object('rfq_id',p_rfq,'revision',v_rev));
  perform private.notify_org(r.buyer_org_id,'request:post','sourcing.quote_received','sourcing_rfq',p_rfq::text);
  return jsonb_build_object('id',q.id,'revision',v_rev,'total',v_total,'currency',p_currency,
    'version',case when v_rev=1 then 0 else q.version+1 end);
end $$;

create function public.select_sourcing_quote(p_rfq uuid,p_quote uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.sourcing_rfqs; q public.sourcing_rfq_quotes; v_valid date;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.sourcing_rfqs x where x.id=p_rfq for update;
  if r.id is null or not private.has_permission(r.buyer_org_id,'request:post') then perform private.raise_error('not_found'); end if;
  perform private.require_consent();
  if r.version is distinct from p_expected_version then perform private.raise_error('conflict','stale_version'); end if;
  if r.status in ('closed','cancelled','preferred_selected') then perform private.raise_error('conflict','request_not_open'); end if;
  select * into q from public.sourcing_rfq_quotes x where x.id=p_quote and x.rfq_id=p_rfq for update;
  if q.id is null or q.status<>'submitted' then perform private.raise_error('not_found'); end if;
  if not exists(select 1 from public.sourcing_rfq_partners p
    join public.organisations o on o.id=p.partner_org_id and o.status='active'
    join public.partner_profiles pp on pp.org_id=p.partner_org_id and pp.status='approved'
    where p.rfq_id=p_rfq and p.partner_org_id=q.partner_org_id and p.status='accepted')
    then perform private.raise_error('conflict','partner_not_available'); end if;
  select v.valid_until into v_valid from public.sourcing_rfq_quote_revisions v where v.quote_id=q.id and v.revision=q.current_revision;
  if v_valid<current_date then perform private.raise_error('conflict','quote_expired'); end if;
  update public.sourcing_rfq_quotes set status='rejected',updated_at=now() where rfq_id=p_rfq and id<>p_quote and status='submitted';
  update public.sourcing_rfq_quotes set status='preferred',updated_at=now() where id=p_quote;
  update public.sourcing_rfqs set preferred_quote_id=p_quote,status='preferred_selected',version=version+1,updated_at=now() where id=p_rfq;
  insert into public.sourcing_rfq_events(rfq_id,partner_org_id,actor_user_id,kind,entity_id)
    values(p_rfq,q.partner_org_id,auth.uid(),'preferred_selected',p_quote::text);
  perform private.write_audit('sourcing.preferred_selected',r.buyer_org_id,'sourcing_rfq',p_rfq::text,
    jsonb_build_object('quote_id',p_quote));
  perform private.notify_org(q.partner_org_id,'sourcing:respond','sourcing.selected','sourcing_rfq',p_rfq::text);
  return jsonb_build_object('id',p_rfq,'status','preferred_selected','version',r.version+1);
end $$;

revoke all on function private.p6_immutable(),
  public.create_sourcing_rfq(uuid,text,jsonb,uuid[],text,text,date,text,uuid),
  public.list_sourcing_rfqs(uuid,integer),public.get_sourcing_rfq(uuid,uuid),
  public.send_sourcing_message(uuid,uuid,text),
  public.submit_sourcing_quote(uuid,uuid,uuid,text,jsonb,numeric,numeric,integer,text,date,integer),
  public.select_sourcing_quote(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function
  public.create_sourcing_rfq(uuid,text,jsonb,uuid[],text,text,date,text,uuid),
  public.list_sourcing_rfqs(uuid,integer),public.get_sourcing_rfq(uuid,uuid),
  public.send_sourcing_message(uuid,uuid,text),
  public.submit_sourcing_quote(uuid,uuid,uuid,text,jsonb,numeric,numeric,integer,text,date,integer),
  public.select_sourcing_quote(uuid,uuid,integer) to authenticated;
