-- Phase 4 mutations are RPC-only. Never accept actor, participant, totals or status from the browser.
create function public.post_enquiry_message(p_enquiry uuid, p_body text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enquiries; v_org uuid; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries where id=p_enquiry for update;
  if e.id is null or not private.is_enquiry_member(p_enquiry) then perform private.raise_error('not_found'); end if;
  if e.status in ('closed','blocked') then perform private.raise_error('conflict','enquiry_closed'); end if;
  if e.buyer_request_id is not null and exists(select 1 from public.buyer_requests r where r.id=e.buyer_request_id and r.status <> 'open') then
    perform private.raise_error('conflict','request_not_open');
  end if;
  v_org := case when private.has_permission(e.buyer_org_id,'enquiry:write') then e.buyer_org_id
                when private.has_permission(e.seller_org_id,'enquiry:write') then e.seller_org_id end;
  if v_org is null then perform private.raise_error('forbidden'); end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 or p_body ~ '[[:cntrl:]]'
     or p_key is null or char_length(p_key) not between 8 and 100 then perform private.raise_error('invalid','invalid_message'); end if;
  select id into v_id from public.enquiry_messages where enquiry_id=p_enquiry and sender_user_id=auth.uid() and client_key=p_key;
  if v_id is not null then return v_id; end if;
  perform private.check_rate_limit('message:'||auth.uid(),60,interval '1 hour');
  insert into public.enquiry_messages(enquiry_id,sender_user_id,sender_org_id,body,client_key)
  values(p_enquiry,auth.uid(),v_org,btrim(p_body),p_key)
  on conflict(enquiry_id,sender_user_id,client_key) do update set body=public.enquiry_messages.body
  returning id into v_id;
  update public.enquiries set status=case when v_org=e.buyer_org_id then 'awaiting_seller'::public.enquiry_status else 'awaiting_buyer'::public.enquiry_status end,
    updated_at=now(),version=version+1 where id=e.id and status <> 'closed';
  perform private.notify_org(case when v_org=e.buyer_org_id then e.seller_org_id else e.buyer_org_id end,
    'enquiry:write','enquiry.message','enquiry',e.id::text);
  perform private.write_audit('enquiry.message',v_org,'enquiry',e.id::text,jsonb_build_object('message_id',v_id));
  return v_id;
end $$;

create function public.respond_to_quote(p_quotation uuid,p_version uuid,p_action text,p_reason text,p_expected_version integer)
returns text language plpgsql security definer set search_path = '' as $$
declare q public.quotations; v public.quotation_versions; e public.enquiries; v_status public.quote_status;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into q from public.quotations where id=p_quotation for update;
  if q.id is null or not private.is_enquiry_member(q.enquiry_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(q.buyer_org_id,'enquiry:write') then perform private.raise_error('forbidden'); end if;
  if q.version <> p_expected_version or q.status <> 'sent' or q.current_version_id is distinct from p_version then
    perform private.raise_error('conflict','stale_version'); end if;
  select * into v from public.quotation_versions where id=p_version and quotation_id=q.id;
  if v.id is null or v.valid_until <= now() then perform private.raise_error('conflict','quote_expired'); end if;
  select * into e from public.enquiries where id=q.enquiry_id for update;
  if e.status in ('closed','blocked') or (e.buyer_request_id is not null and exists(select 1 from public.buyer_requests r where r.id=e.buyer_request_id and r.status <> 'open')) then
    perform private.raise_error('conflict','enquiry_closed'); end if;
  if p_action='request_revision' then
    if char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then perform private.raise_error('invalid','reason_required'); end if;
    v_status:='revision_requested';
  elsif p_action='accept' then v_status:='accepted';
  elsif p_action='decline' then v_status:='declined';
  else perform private.raise_error('invalid','invalid_decision'); end if;
  update public.quotations set status=v_status,accepted_version_id=case when v_status='accepted' then v.id else null end,
    version=version+1,updated_at=now() where id=q.id;
  update public.enquiries set status=case when v_status='revision_requested' then 'awaiting_seller'::public.enquiry_status else status end,
    version=version+1,updated_at=now() where id=e.id;
  if v_status='revision_requested' then
    insert into public.enquiry_messages(enquiry_id,sender_user_id,sender_org_id,body)
    values(e.id,auth.uid(),q.buyer_org_id,btrim(p_reason));
  end if;
  perform private.notify_org(q.seller_org_id,'quote:send','quote.'||v_status::text,'quotation',q.id::text);
  perform private.write_audit('quote.'||v_status::text,q.buyer_org_id,'quotation',q.id::text,jsonb_build_object('version_id',v.id));
  return v_status::text;
end $$;

create function public.withdraw_quote(p_quotation uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.quotations;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into q from public.quotations where id=p_quotation for update;
  if q.id is null or not private.is_enquiry_member(q.enquiry_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(q.seller_org_id,'quote:send') then perform private.raise_error('forbidden'); end if;
  if q.status <> 'sent' or q.version <> p_expected_version then perform private.raise_error('conflict','stale_version'); end if;
  update public.quotations set status='withdrawn',version=version+1,updated_at=now() where id=q.id;
  perform private.notify_org(q.buyer_org_id,'enquiry:write','quote.withdrawn','quotation',q.id::text);
  perform private.write_audit('quote.withdrawn',q.seller_org_id,'quotation',q.id::text,'{}'::jsonb);
end $$;

create function public.record_lead_activity(p_enquiry uuid,p_stage public.lead_stage,p_note text,p_follow_up timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enquiries; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries where id=p_enquiry for update;
  if e.id is null or not private.is_enquiry_member(p_enquiry) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(e.seller_org_id,'lead:manage') then perform private.raise_error('forbidden'); end if;
  if char_length(coalesce(p_note,''))>2000 or (p_follow_up is not null and (p_follow_up<now()-interval '1 year' or p_follow_up>now()+interval '2 years')) then
    perform private.raise_error('invalid','invalid_data'); end if;
  insert into public.lead_activities(enquiry_id,seller_org_id,actor_user_id,stage,note,next_follow_up_at)
  values(e.id,e.seller_org_id,auth.uid(),p_stage,nullif(btrim(p_note),''),p_follow_up) returning id into v_id;
  perform private.write_audit('lead.stage',e.seller_org_id,'enquiry',e.id::text,jsonb_build_object('stage',p_stage));
  return v_id;
end $$;

create function public.propose_referral(p_enquiry uuid,p_proposed_seller uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enquiries; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries where id=p_enquiry for update;
  if e.id is null or not private.is_enquiry_member(p_enquiry) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(e.seller_org_id,'enquiry:write') then perform private.raise_error('forbidden'); end if;
  if e.status in ('closed','blocked') or p_proposed_seller in(e.buyer_org_id,e.seller_org_id) then perform private.raise_error('invalid','invalid_referral'); end if;
  if e.buyer_request_id is not null and exists(select 1 from public.buyer_requests b where b.id=e.buyer_request_id and b.status <> 'open') then
    perform private.raise_error('conflict','request_not_open'); end if;
  if not exists(select 1 from public.business_listings l join public.organisations o on o.id=l.org_id
    where l.org_id=p_proposed_seller and l.live_status='published' and o.status='active') then perform private.raise_error('not_found'); end if;
  select id into v_id from public.referral_suggestions where enquiry_id=p_enquiry and proposed_seller_org_id=p_proposed_seller;
  if v_id is not null then return v_id; end if;
  insert into public.referral_suggestions(enquiry_id,referrer_seller_org_id,proposed_seller_org_id,buyer_org_id,created_by)
  values(e.id,e.seller_org_id,p_proposed_seller,e.buyer_org_id,auth.uid())
  returning id into v_id;
  perform private.notify_org(e.buyer_org_id,'enquiry:write','referral.proposed','referral',v_id::text);
  perform private.write_audit('referral.proposed',e.seller_org_id,'referral',v_id::text,'{}'::jsonb);
  return v_id;
end $$;

create function public.respond_to_referral(p_referral uuid,p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.referral_suggestions; v_actor uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.referral_suggestions where id=p_referral for update;
  if r.id is null or not (private.is_member(r.buyer_org_id) or private.is_member(r.proposed_seller_org_id)) then perform private.raise_error('not_found'); end if;
  if r.status='proposed' and not private.has_permission(r.buyer_org_id,'enquiry:write') then perform private.raise_error('not_found'); end if;
  if exists(select 1 from public.enquiries e join public.buyer_requests b on b.id=e.buyer_request_id
    where e.id=r.enquiry_id and b.status <> 'open') then perform private.raise_error('conflict','request_not_open'); end if;
  if r.status='proposed' and private.has_permission(r.buyer_org_id,'enquiry:write') then
    v_actor:=r.buyer_org_id;
    update public.referral_suggestions set status=case when p_accept then 'buyer_consented'::public.referral_status else 'rejected'::public.referral_status end,
      buyer_consented_at=case when p_accept then now() else null end where id=r.id;
    if p_accept then perform private.notify_org(r.proposed_seller_org_id,'enquiry:write','referral.consented','referral',r.id::text); end if;
  elsif r.status='buyer_consented' and private.has_permission(r.proposed_seller_org_id,'enquiry:write') then
    v_actor:=r.proposed_seller_org_id;
    update public.referral_suggestions set status=case when p_accept then 'recipient_accepted'::public.referral_status else 'rejected'::public.referral_status end,
      recipient_accepted_at=case when p_accept then now() else null end where id=r.id;
    if p_accept then perform private.notify_org(r.buyer_org_id,'enquiry:write','referral.accepted','referral',r.id::text); end if;
  else perform private.raise_error('conflict','invalid_referral'); end if;
  perform private.write_audit('referral.response',v_actor,'referral',r.id::text,jsonb_build_object('accepted',p_accept));
  return case when p_accept then 'accepted' else 'rejected' end;
end $$;

create function public.submit_business_review(p_enquiry uuid,p_rating integer,p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enquiries; v_id uuid;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries where id=p_enquiry;
  if e.id is null or not private.is_enquiry_member(p_enquiry) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(e.buyer_org_id,'review:write') then perform private.raise_error('forbidden'); end if;
  if p_rating not between 1 and 5 or char_length(btrim(coalesce(p_text,''))) not between 10 and 2000 then perform private.raise_error('invalid','invalid_review'); end if;
  if not exists(select 1 from public.enquiry_messages m where m.enquiry_id=e.id and m.sender_org_id=e.seller_org_id)
     and not exists(select 1 from public.quotations q where q.enquiry_id=e.id and q.current_version_id is not null) then
    perform private.raise_error('forbidden','review_not_eligible'); end if;
  insert into public.business_reviews(enquiry_id,buyer_org_id,seller_org_id,author_user_id,rating,review_text)
  values(e.id,e.buyer_org_id,e.seller_org_id,auth.uid(),p_rating,btrim(p_text)) returning id into v_id;
  perform private.write_audit('review.submitted',e.buyer_org_id,'review',v_id::text,'{}'::jsonb);
  return v_id;
end $$;

create function public.respond_to_business_review(p_review uuid,p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.business_reviews;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into r from public.business_reviews where id=p_review for update;
  if r.id is null or not private.is_member(r.seller_org_id) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(r.seller_org_id,'enquiry:write') then perform private.raise_error('forbidden'); end if;
  if r.status <> 'published' or r.seller_response is not null or char_length(btrim(coalesce(p_text,''))) not between 3 and 2000 then
    perform private.raise_error('conflict','invalid_review'); end if;
  update public.business_reviews set seller_response=btrim(p_text),seller_response_status='pending',updated_at=now() where id=r.id;
  perform private.write_audit('review.responded',r.seller_org_id,'review',r.id::text,'{}'::jsonb);
end $$;

create function public.moderate_review_response(p_review uuid,p_approve boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.business_reviews;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('review:moderate') then perform private.raise_error('forbidden'); end if;
  select * into r from public.business_reviews where id=p_review for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(r.seller_org_id,auth.uid()) or private.has_org_involvement(r.buyer_org_id,auth.uid()) then
    perform private.raise_error('forbidden','conflict_of_interest'); end if;
  if r.status <> 'published' or r.seller_response_status <> 'pending' or p_approve is null
     or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then perform private.raise_error('conflict','invalid_review'); end if;
  update public.business_reviews set seller_response_status=case when p_approve then 'published' else 'removed' end,
    seller_response_moderation_reason=btrim(p_reason),updated_at=now() where id=r.id;
  perform private.write_audit('review.response_moderated',r.seller_org_id,'review',r.id::text,jsonb_build_object('approved',p_approve));
end $$;

create function public.moderate_business_review(p_review uuid,p_status public.review_status,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.business_reviews;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('review:moderate') then perform private.raise_error('forbidden'); end if;
  select * into r from public.business_reviews where id=p_review for update;
  if r.id is null then perform private.raise_error('not_found'); end if;
  if private.has_org_involvement(r.seller_org_id,auth.uid()) or private.has_org_involvement(r.buyer_org_id,auth.uid()) then
    perform private.raise_error('forbidden','conflict_of_interest'); end if;
  if p_status not in ('published','flagged','removed') or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    perform private.raise_error('invalid','reason_required'); end if;
  update public.business_reviews set status=p_status,moderation_reason=btrim(p_reason),updated_at=now() where id=r.id;
  perform private.write_audit('review.moderated',r.seller_org_id,'review',r.id::text,jsonb_build_object('status',p_status));
end $$;

-- Public listing readout exposes only moderated review content, never author or buyer IDs.
create function public.list_published_business_reviews(p_slug text)
returns table(rating integer,review_text text,seller_response text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.rating,r.review_text,case when r.seller_response_status='published' then r.seller_response else null end,r.created_at
  from public.business_reviews r join public.business_listings l on l.org_id=r.seller_org_id
  where l.slug=p_slug and l.live_status='published' and r.status='published'
  order by r.created_at desc limit 20
$$;

create function public.save_quote_draft(p_enquiry uuid,p_draft jsonb,p_expected_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enquiries; q public.quotations;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into e from public.enquiries where id=p_enquiry for update;
  if e.id is null or not private.is_enquiry_member(p_enquiry) then perform private.raise_error('not_found'); end if;
  if not private.has_permission(e.seller_org_id,'quote:send') then perform private.raise_error('forbidden'); end if;
  if e.status in ('closed','blocked') then perform private.raise_error('conflict','enquiry_closed'); end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or pg_column_size(p_draft)>30000 then perform private.raise_error('invalid','invalid_quote'); end if;
  select * into q from public.quotations where enquiry_id=p_enquiry for update;
  if q.id is null then
    if p_expected_version <> 0 then perform private.raise_error('conflict','stale_version'); end if;
    insert into public.quotations(enquiry_id,seller_org_id,buyer_org_id,created_by)
    values(e.id,e.seller_org_id,e.buyer_org_id,auth.uid()) returning * into q;
  else
    if q.version <> p_expected_version or q.status not in ('draft','revision_requested') then perform private.raise_error('conflict','stale_version'); end if;
    update public.quotations set version=version+1,updated_at=now() where id=q.id returning * into q;
  end if;
  insert into public.quotation_drafts(quotation_id,seller_org_id,data) values(q.id,e.seller_org_id,p_draft)
  on conflict(quotation_id) do update set data=excluded.data,updated_at=now();
  perform private.write_audit('quote.draft',e.seller_org_id,'quotation',q.id::text,'{}'::jsonb);
  return q.id;
end $$;

create function public.send_quote_version(p_quotation uuid,p_expected_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quotations; e public.enquiries; d jsonb; li jsonb; v_id uuid; v_subtotal numeric(14,2):=0;
  v_qty numeric(12,3); v_price numeric(12,2); v_line numeric(14,2); v_fee numeric(14,2); v_tax numeric(14,2);
  v_idx integer:=0; v_expiry timestamptz;
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
  insert into public.quotation_versions(quotation_id,version_number,currency,scope_text,exclusions,tax_treatment,delivery_timing,terms_text,valid_until,subtotal,delivery_fee,tax_amount,total)
  values(q.id,coalesce((select max(version_number)+1 from public.quotation_versions where quotation_id=q.id),1),'MYR',btrim(d->>'scope'),left(d->>'exclusions',2000),btrim(d->>'tax_treatment'),btrim(d->>'delivery_timing'),left(d->>'terms',2000),v_expiry,v_subtotal,v_fee,v_tax,v_subtotal+v_fee+v_tax)
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

create function public.seller_lead_metrics(p_seller_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_seller_org,'lead:manage') then perform private.raise_error('forbidden'); end if;
  with leads as (
    select e.id,e.created_at,
      (case when e.opened_by_org_id=p_seller_org then e.created_at else
        (select min(m.created_at) from public.enquiry_messages m where m.enquiry_id=e.id and m.sender_org_id=p_seller_org) end) first_reply,
      (select count(*) from public.quotation_versions v join public.quotations q on q.id=v.quotation_id where q.enquiry_id=e.id) quote_count,
      (select a.stage from public.lead_activities a where a.enquiry_id=e.id order by a.recorded_at desc,a.id desc limit 1) latest_stage,
      (select a.next_follow_up_at from public.lead_activities a where a.enquiry_id=e.id order by a.recorded_at desc,a.id desc limit 1) follow_up
    from public.enquiries e where e.seller_org_id=p_seller_org
  ), aggregates as (
    select count(*) received,count(first_reply) answered,sum(quote_count) quotes,
      percentile_cont(0.5) within group(order by extract(epoch from (first_reply-created_at))/60) filter(where first_reply is not null) median_minutes,
      count(*) filter(where follow_up<=now() and latest_stage not in('reported_won','reported_lost')) follow_ups_due,
      count(*) filter(where latest_stage='reported_won') reported_wins,
      count(*) filter(where latest_stage='reported_lost') reported_losses
    from leads
  ) select jsonb_build_object('enquiries_received',received,'enquiries_answered',answered,'quotes_sent',coalesce(quotes,0),
    'median_response_minutes',median_minutes,'follow_ups_due',follow_ups_due,'reported_wins',reported_wins,'reported_losses',reported_losses,
    'published_reviews',(select count(*) from public.business_reviews r where r.seller_org_id=p_seller_org and r.status='published')) into v from aggregates;
  return v;
end $$;

revoke all on function public.post_enquiry_message(uuid,text,text),public.save_quote_draft(uuid,jsonb,integer),
  public.send_quote_version(uuid,integer),public.respond_to_quote(uuid,uuid,text,text,integer),public.withdraw_quote(uuid,integer),
  public.record_lead_activity(uuid,public.lead_stage,text,timestamptz),public.propose_referral(uuid,uuid),
  public.respond_to_referral(uuid,boolean),public.submit_business_review(uuid,integer,text),
  public.respond_to_business_review(uuid,text),public.moderate_business_review(uuid,public.review_status,text),public.moderate_review_response(uuid,boolean,text),public.seller_lead_metrics(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.post_enquiry_message(uuid,text,text),public.save_quote_draft(uuid,jsonb,integer),
  public.send_quote_version(uuid,integer),public.respond_to_quote(uuid,uuid,text,text,integer),public.withdraw_quote(uuid,integer),
  public.record_lead_activity(uuid,public.lead_stage,text,timestamptz),public.propose_referral(uuid,uuid),
  public.respond_to_referral(uuid,boolean),public.submit_business_review(uuid,integer,text),
  public.respond_to_business_review(uuid,text),public.moderate_business_review(uuid,public.review_status,text),public.moderate_review_response(uuid,boolean,text),public.seller_lead_metrics(uuid)
  to authenticated;
revoke all on function public.list_published_business_reviews(text) from public,anon,authenticated,service_role;
grant execute on function public.list_published_business_reviews(text) to anon,authenticated;
