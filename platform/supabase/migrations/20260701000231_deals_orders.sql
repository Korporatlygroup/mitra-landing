-- Deals: an order (agreement) is created when a buyer accepts a quotation, plus an append-only event history for the
-- conversation. Additive: no existing table or function is changed. There is NO payment state here: nothing is marked paid,
-- secured, refunded or released (that needs an approved provider and verified provider events, see docs/payment-boundary.md).

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  enquiry_id uuid not null unique references public.enquiries(id),
  quotation_id uuid not null references public.quotations(id),
  quote_version_id uuid not null references public.quotation_versions(id),
  buyer_org_id uuid not null references public.organisations(id),
  seller_org_id uuid not null references public.organisations(id),
  currency text not null,
  total numeric(14,2) not null,
  scope_text text not null,
  items jsonb not null,
  delivery_timing text not null,
  terms_text text,
  exclusions text,
  service_date date,
  deposit_note text check (deposit_note is null or char_length(deposit_note) <= 500),
  status text not null default 'agreed' check (status in ('agreed','in_progress','buyer_confirmation_pending','completed','cancelled','disputed')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_buyer_idx on public.orders(buyer_org_id, created_at desc);
create index orders_seller_idx on public.orders(seller_org_id, created_at desc);

create table public.deal_events (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id),
  order_id uuid references public.orders(id),
  kind text not null check (char_length(kind) between 3 and 60),
  actor_org_id uuid references public.organisations(id),
  actor_user_id uuid,
  ref_id uuid,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index deal_events_enquiry_idx on public.deal_events(enquiry_id, created_at);

alter table public.orders enable row level security;
alter table public.deal_events enable row level security;
create policy orders_participants_read on public.orders for select to authenticated
  using (private.is_enquiry_member(enquiry_id));
create policy deal_events_participants_read on public.deal_events for select to authenticated
  using (private.is_enquiry_member(enquiry_id));
revoke all on public.orders, public.deal_events from anon, authenticated;
grant select on public.orders, public.deal_events to authenticated;

-- Quotation status changes are recorded as events; acceptance creates the order from the exact accepted version.
create function private.deal_on_quote_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.quotation_versions; o_id uuid; ref text; actor uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('sent','revision_requested','accepted','declined','withdrawn') then return new; end if;
  actor := case when new.status in ('sent','withdrawn') then new.seller_org_id else new.buyer_org_id end;
  insert into public.deal_events(enquiry_id,kind,actor_org_id,actor_user_id,ref_id)
  values(new.enquiry_id,'quote.'||new.status,actor,auth.uid(),coalesce(new.accepted_version_id,new.current_version_id));
  if new.status = 'accepted' then
    select * into v from public.quotation_versions where id = new.accepted_version_id;
    o_id := gen_random_uuid();
    ref := 'INOK-'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYMM')||'-'||upper(substr(md5(o_id::text),1,6));
    insert into public.orders(id,reference,enquiry_id,quotation_id,quote_version_id,buyer_org_id,seller_org_id,currency,total,scope_text,items,delivery_timing,terms_text,exclusions)
    select o_id,ref,new.enquiry_id,new.id,v.id,new.buyer_org_id,new.seller_org_id,v.currency,v.total,v.scope_text,
      coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price,'line_total',i.line_total) order by i.sort_order)
                from public.quotation_line_items i where i.quote_version_id = v.id),'[]'::jsonb),
      v.delivery_timing,v.terms_text,v.exclusions
    on conflict (enquiry_id) do nothing;
    if found then
      insert into public.deal_events(enquiry_id,order_id,kind,actor_org_id,actor_user_id)
      values(new.enquiry_id,o_id,'order.created',new.buyer_org_id,auth.uid());
      perform private.notify_org(new.buyer_org_id,'enquiry:write','order.created','order',o_id::text);
      perform private.notify_org(new.seller_org_id,'quote:send','order.created','order',o_id::text);
    end if;
  end if;
  return new;
end $$;
create trigger quotations_deal_events after update of status on public.quotations
  for each row execute function private.deal_on_quote_change();

-- Seller adds booking details while the agreement is still open (service date, deposit expectation as text only).
create function public.set_order_details(p_order uuid, p_service_date date, p_deposit_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not private.is_enquiry_member(o.enquiry_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(o.seller_org_id,'quote:send') then perform private.raise_error('forbidden'); end if;
  if o.status <> 'agreed' then perform private.raise_error('conflict','order_not_open'); end if;
  if char_length(coalesce(p_deposit_note,'')) > 500 then perform private.raise_error('invalid','invalid_data'); end if;
  update public.orders set service_date = p_service_date, deposit_note = nullif(btrim(p_deposit_note),''), version = version+1, updated_at = now() where id = o.id;
  insert into public.deal_events(enquiry_id,order_id,kind,actor_org_id,actor_user_id) values(o.enquiry_id,o.id,'order.details_updated',o.seller_org_id,auth.uid());
end $$;

-- The only way an order changes state. Participants only; fixed transitions; no payment states.
create function public.order_action(p_order uuid, p_action text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_new text; v_actor uuid; v_other uuid; v_other_perm text; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not private.is_enquiry_member(o.enquiry_id) then perform private.raise_error('not_found'); end if;
  if v_note is not null and char_length(v_note) > 2000 then perform private.raise_error('invalid','invalid_data'); end if;
  if p_action = 'start' and o.status = 'agreed' and private.has_permission(o.seller_org_id,'quote:send') then
    v_new := 'in_progress'; v_actor := o.seller_org_id; v_other := o.buyer_org_id; v_other_perm := 'enquiry:write';
  elsif p_action = 'mark_delivered' and o.status = 'in_progress' and private.has_permission(o.seller_org_id,'quote:send') then
    if v_note is null or char_length(v_note) < 3 then perform private.raise_error('invalid','note_required'); end if;
    v_new := 'buyer_confirmation_pending'; v_actor := o.seller_org_id; v_other := o.buyer_org_id; v_other_perm := 'enquiry:write';
  elsif p_action = 'confirm' and o.status = 'buyer_confirmation_pending' and private.has_permission(o.buyer_org_id,'enquiry:write') then
    v_new := 'completed'; v_actor := o.buyer_org_id; v_other := o.seller_org_id; v_other_perm := 'quote:send';
  elsif p_action = 'dispute' and o.status in ('in_progress','buyer_confirmation_pending') and private.has_permission(o.buyer_org_id,'enquiry:write') then
    if v_note is null or char_length(v_note) < 3 then perform private.raise_error('invalid','note_required'); end if;
    v_new := 'disputed'; v_actor := o.buyer_org_id; v_other := o.seller_org_id; v_other_perm := 'quote:send';
  elsif p_action = 'cancel' and o.status = 'agreed' then
    if private.has_permission(o.buyer_org_id,'enquiry:write') then v_actor := o.buyer_org_id; v_other := o.seller_org_id; v_other_perm := 'quote:send';
    elsif private.has_permission(o.seller_org_id,'quote:send') then v_actor := o.seller_org_id; v_other := o.buyer_org_id; v_other_perm := 'enquiry:write';
    else perform private.raise_error('forbidden'); end if;
    v_new := 'cancelled';
  else
    perform private.raise_error('conflict','invalid_order_action');
  end if;
  update public.orders set status = v_new, version = version+1, updated_at = now() where id = o.id;
  insert into public.deal_events(enquiry_id,order_id,kind,actor_org_id,actor_user_id,note)
  values(o.enquiry_id,o.id,'order.'||v_new,v_actor,auth.uid(),v_note);
  perform private.notify_org(v_other,v_other_perm,'order.'||v_new,'order',o.id::text);
  perform private.write_audit('order.'||v_new,v_actor,'order',o.id::text,'{}'::jsonb);
  return v_new;
end $$;

revoke all on function public.set_order_details(uuid,date,text), public.order_action(uuid,text,text) from public, anon;
grant execute on function public.set_order_details(uuid,date,text), public.order_action(uuid,text,text) to authenticated;

revoke all on function private.deal_on_quote_change() from public, anon, authenticated;
