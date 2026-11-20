-- WP4: booking terms live INSIDE the quotation, before the buyer accepts. Additive only: nullable columns, two functions replaced
-- (send_quote_version validates the terms when they are present; the acceptance trigger copies them to the agreement).
-- Nothing here touches money: the deposit is plain text an expectation between the two businesses, never a payment state.
-- Quotations sent before this migration have no terms (columns stay null) and keep working exactly as before.

alter table public.quotation_versions
  add column booking_date date,
  add column completion_by date,
  add column deposit_terms text check (deposit_terms is null or char_length(deposit_terms) between 3 and 500),
  add column cancellation_option text check (cancellation_option is null or cancellation_option in ('free_7d','deposit_kept','no_cancel','custom')),
  add column cancellation_text text check (cancellation_text is null or char_length(cancellation_text) between 3 and 500);

-- The agreement keeps the accepted wording. service_date and deposit_note (existing columns) receive the booking date and deposit text.
alter table public.orders
  add column completion_by date,
  add column cancellation_option text check (cancellation_option is null or cancellation_option in ('free_7d','deposit_kept','no_cancel','custom')),
  add column cancellation_text text check (cancellation_text is null or char_length(cancellation_text) between 3 and 500),
  add column terms_locked boolean not null default false;

create or replace function public.send_quote_version(p_quotation uuid,p_expected_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quotations; e public.enquiries; d jsonb; li jsonb; v_id uuid; v_subtotal numeric(14,2):=0;
  v_qty numeric(12,3); v_price numeric(12,2); v_line numeric(14,2); v_fee numeric(14,2); v_tax numeric(14,2);
  v_idx integer:=0; v_expiry timestamptz;
  v_book date; v_done date; v_dep text; v_opt text; v_ctext text; v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into q from public.quotations where id=p_quotation for update;
  if q.id is null or not private.is_enquiry_member(q.enquiry_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(q.seller_org_id,'quote:send') then perform private.raise_error('forbidden'); end if;
  if q.version <> p_expected_version or q.status not in ('draft','revision_requested') then perform private.raise_error('conflict','stale_version'); end if;
  select * into e from public.enquiries where id=q.enquiry_id for update;
  if e.status in ('closed','blocked') or (e.buyer_request_id is not null and exists(select 1 from public.buyer_requests r where r.id=e.buyer_request_id and r.status <> 'open')) then
    perform private.raise_error('conflict','enquiry_closed');
  end if;
  select data into d from public.quotation_drafts where quotation_id=q.id;
  if d is null then perform private.raise_error('invalid','invalid_quote'); end if;
  if d->>'currency' <> 'MYR' or char_length(btrim(coalesce(d->>'scope',''))) not between 3 and 2000
     or char_length(btrim(coalesce(d->>'tax_treatment',''))) not between 3 and 500
     or char_length(btrim(coalesce(d->>'delivery_timing',''))) not between 3 and 500
     or jsonb_typeof(d->'lines') <> 'array' or jsonb_array_length(d->'lines') not between 1 and 50
     or coalesce(d->>'delivery_fee','') !~ '^\d{1,10}(\.\d{1,2})?$'
     or coalesce(d->>'tax_amount','') !~ '^\d{1,10}(\.\d{1,2})?$'
     or coalesce(d->>'valid_until','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' then
    perform private.raise_error('invalid','invalid_quote');
  end if;
  begin v_expiry:=(d->>'valid_until')::timestamptz; exception when others then perform private.raise_error('invalid','invalid_date'); end;
  if v_expiry <= now()+interval '1 hour' or v_expiry > now()+interval '90 days' then perform private.raise_error('invalid','invalid_date'); end if;
  -- Booking terms (WP4). When the draft carries them they are all validated; the app always sends them, older drafts and API callers may omit them.
  if d ? 'booking_date' then
    begin
      if coalesce(d->>'booking_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
      v_book := (d->>'booking_date')::date;
      if coalesce(d->>'completion_by','') <> '' then
        if d->>'completion_by' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
        v_done := (d->>'completion_by')::date;
      end if;
    exception when others then perform private.raise_error('invalid','invalid_date'); end;
    if v_book < v_today or v_book > v_today + 730 or (v_done is not null and (v_done < v_book or v_done > v_book + 730)) then
      perform private.raise_error('invalid','invalid_date');
    end if;
    v_dep := btrim(coalesce(d->>'deposit_terms',''));
    v_opt := coalesce(d->>'cancellation_option','');
    v_ctext := nullif(btrim(coalesce(d->>'cancellation_text','')),'');
    if char_length(v_dep) not between 3 and 500 or v_opt not in ('free_7d','deposit_kept','no_cancel','custom')
       or (v_opt = 'custom' and (v_ctext is null or char_length(v_ctext) not between 3 and 500)) then
      perform private.raise_error('invalid','invalid_terms');
    end if;
    if v_opt <> 'custom' then v_ctext := null; end if;
  end if;
  v_fee:=(d->>'delivery_fee')::numeric; v_tax:=(d->>'tax_amount')::numeric;
  for li in select value from jsonb_array_elements(d->'lines') loop
    if jsonb_typeof(li)<>'object' or char_length(btrim(coalesce(li->>'description',''))) not between 1 and 500
       or char_length(btrim(coalesce(li->>'unit',''))) not between 1 and 40
       or coalesce(li->>'quantity','') !~ '^\d{1,9}(\.\d{1,3})?$'
       or coalesce(li->>'unit_price','') !~ '^\d{1,10}(\.\d{1,2})?$' then perform private.raise_error('invalid','invalid_line'); end if;
    v_qty:=(li->>'quantity')::numeric; v_price:=(li->>'unit_price')::numeric;
    if v_qty<=0 then perform private.raise_error('invalid','invalid_quantity'); end if;
    v_line:=round(v_qty*v_price,2); v_subtotal:=v_subtotal+v_line;
    if v_subtotal+v_fee+v_tax > 999999999999.99 then perform private.raise_error('invalid','amount_too_large'); end if;
    v_idx:=v_idx+1;
  end loop;
  insert into public.quotation_versions(quotation_id,version_number,currency,scope_text,exclusions,tax_treatment,delivery_timing,terms_text,valid_until,subtotal,delivery_fee,tax_amount,total,
    booking_date,completion_by,deposit_terms,cancellation_option,cancellation_text)
  values(q.id,coalesce((select max(version_number)+1 from public.quotation_versions where quotation_id=q.id),1),'MYR',btrim(d->>'scope'),left(d->>'exclusions',2000),btrim(d->>'tax_treatment'),btrim(d->>'delivery_timing'),left(d->>'terms',2000),v_expiry,v_subtotal,v_fee,v_tax,v_subtotal+v_fee+v_tax,
    v_book,v_done,nullif(v_dep,''),nullif(v_opt,''),v_ctext)
  returning id into v_id;
  v_idx:=0;
  for li in select value from jsonb_array_elements(d->'lines') loop
    v_qty:=(li->>'quantity')::numeric; v_price:=(li->>'unit_price')::numeric;
    v_line:=round(v_qty*v_price,2);
    insert into public.quotation_line_items(quote_version_id,description,quantity,unit,unit_price,line_total,sort_order)
    values(v_id,btrim(li->>'description'),v_qty,btrim(li->>'unit'),v_price,v_line,v_idx);
    v_idx:=v_idx+1;
  end loop;
  update public.quotations set status='sent',current_version_id=v_id,version=version+1,updated_at=now() where id=q.id;
  delete from public.quotation_drafts where quotation_id=q.id;
  update public.enquiries set status='awaiting_buyer',version=version+1,updated_at=now() where id=e.id;
  perform private.notify_org(q.buyer_org_id,'enquiry:write','quote.sent','quotation',q.id::text);
  perform private.write_audit('quote.sent',q.seller_org_id,'quotation',q.id::text,jsonb_build_object('version_id',v_id));
  return v_id;
end $$;

-- Accepting a quotation creates the agreement and copies the accepted terms, which are then locked.
create or replace function private.deal_on_quote_change() returns trigger language plpgsql security definer set search_path = '' as $$
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
    insert into public.orders(id,reference,enquiry_id,quotation_id,quote_version_id,buyer_org_id,seller_org_id,currency,total,scope_text,items,delivery_timing,terms_text,exclusions,
      service_date,deposit_note,completion_by,cancellation_option,cancellation_text,terms_locked)
    select o_id,ref,new.enquiry_id,new.id,v.id,new.buyer_org_id,new.seller_org_id,v.currency,v.total,v.scope_text,
      coalesce((select jsonb_agg(jsonb_build_object('description',i.description,'quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price,'line_total',i.line_total) order by i.sort_order)
                from public.quotation_line_items i where i.quote_version_id = v.id),'[]'::jsonb),
      v.delivery_timing,v.terms_text,v.exclusions,
      v.booking_date,v.deposit_terms,v.completion_by,v.cancellation_option,v.cancellation_text,(v.booking_date is not null)
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

-- The seller's "add details later" form stays for agreements made before this change. When the terms came from the accepted quotation
-- they cannot be edited here: a change needs a new quotation version (the existing revision process) or a cancelled agreement.
create or replace function public.set_order_details(p_order uuid, p_service_date date, p_deposit_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not private.is_enquiry_member(o.enquiry_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(o.seller_org_id,'quote:send') then perform private.raise_error('forbidden'); end if;
  if o.status <> 'agreed' then perform private.raise_error('conflict','order_not_open'); end if;
  if o.terms_locked then perform private.raise_error('conflict','terms_locked'); end if;
  if char_length(coalesce(p_deposit_note,'')) > 500 then perform private.raise_error('invalid','invalid_data'); end if;
  update public.orders set service_date = p_service_date, deposit_note = nullif(btrim(p_deposit_note),''), version = version+1, updated_at = now() where id = o.id;
  insert into public.deal_events(enquiry_id,order_id,kind,actor_org_id,actor_user_id) values(o.enquiry_id,o.id,'order.details_updated',o.seller_org_id,auth.uid());
end $$;
