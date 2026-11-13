-- Phase 5 (5/5): admin queues, product report handling and real catalogue statistics (counts only, nothing estimated).

create function public.list_partner_orgs(p_status text default null, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('partner:manage') then perform private.raise_error('forbidden'); end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'suspended') then perform private.raise_error('invalid', 'invalid_status'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.partner_profiles pp where p_status is null or pp.status::text = p_status),
    'items', coalesce((select jsonb_agg(jsonb_build_object('org_id', x.org_id, 'name', x.name, 'display_name', x.display_name, 'status', x.status,
        'provisioned', x.provisioned_by is not null, 'created_at', x.created_at, 'decided_at', x.decided_at,
        'decision_reason', x.decision_reason, 'conflict_of_interest', private.has_partner_involvement(x.org_id, auth.uid()))
        order by x.created_at desc, x.org_id)
      from (select pp.org_id, o.name, pp.display_name, pp.status, pp.provisioned_by, pp.created_at, pp.decided_at, pp.decision_reason
            from public.partner_profiles pp join public.organisations o on o.id = pp.org_id
            where p_status is null or pp.status::text = p_status
            order by pp.created_at desc, pp.org_id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

-- scope 'pending' = a submission awaits a decision (new supplier or a revised approved one); 'all' = everything submitted.
create function public.list_supplier_reviews(p_scope text default 'pending', p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('supplier:review') then perform private.raise_error('forbidden'); end if;
  if p_scope not in ('pending', 'all') then perform private.raise_error('invalid', 'invalid_status'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.suppliers s where (p_scope = 'all' and (s.status <> 'draft' or s.draft_submitted_version is not null))
                                                         or (p_scope = 'pending' and s.draft_submitted_version is not null)),
    'items', coalesce((select jsonb_agg(private.supplier_summary(s) || jsonb_build_object(
          'partner_name', (select pp.display_name from public.partner_profiles pp where pp.org_id = s.partner_org_id),
          'conflict_of_interest', private.has_partner_involvement(s.partner_org_id, auth.uid()))
        order by s.submitted_at nulls last, s.id)
      from public.suppliers s
      where (p_scope = 'all' and (s.status <> 'draft' or s.draft_submitted_version is not null))
         or (p_scope = 'pending' and s.draft_submitted_version is not null)), '[]'::jsonb));
end;
$$;

create function public.list_product_reviews(p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('catalogue:review') then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.product_revisions r where r.status = 'submitted'),
    'items', coalesce((select jsonb_agg(private.product_summary(x.product_id) || jsonb_build_object(
          'revision_no', x.rev_no, 'submitted_at', x.submitted_at, 'supplier_name', x.supplier_name, 'partner_name', x.partner_name,
          'conflict_of_interest', private.has_partner_involvement(x.partner_org_id, auth.uid())) order by x.submitted_at, x.product_id)
      from (select r.product_id, r.rev_no, r.submitted_at, p.partner_org_id,
                   coalesce(s.live_name, s.draft ->> 'name') supplier_name,
                   (select pp.display_name from public.partner_profiles pp where pp.org_id = p.partner_org_id) partner_name
            from public.product_revisions r join public.products p on p.id = r.product_id join public.suppliers s on s.id = p.supplier_id
            where r.status = 'submitted' order by r.submitted_at, r.product_id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

create function public.get_product_for_review(p_product uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.products;
  rev public.product_revisions;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('catalogue:review') then perform private.raise_error('forbidden'); end if;
  select * into p from public.products x where x.id = p_product;
  if p.id is null or p.status = 'draft' then perform private.raise_error('not_found'); end if;
  select * into rev from public.product_revisions r where r.id = p.pending_revision_id;
  return private.product_summary(p.id) || jsonb_build_object(
    'revision', case when rev.id is not null then jsonb_build_object('id', rev.id, 'rev_no', rev.rev_no, 'status', rev.status,
        'data', rev.data, 'reason', rev.reason, 'submitted_at', rev.submitted_at) end,
    'live_revision', (select r.data from public.product_revisions r where r.id = p.live_revision_id),
    'supplier', (select private.supplier_summary(s) from public.suppliers s where s.id = p.supplier_id),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'alt', m.alt, 'sort', m.sort) order by m.sort, m.created_at)
        from public.product_media m where m.id = any (coalesce(rev.media_ids, array[]::uuid[])) and m.removed_at is null and m.scan_status = 'clean'), '[]'::jsonb),
    'conflict_of_interest', private.has_partner_involvement(p.partner_org_id, auth.uid()));
end;
$$;

create function public.list_product_reports(p_status text default 'open', p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('catalogue:moderate') then perform private.raise_error('forbidden'); end if;
  if p_status not in ('open', 'actioned', 'dismissed') then perform private.raise_error('invalid', 'invalid_status'); end if;
  return jsonb_build_object('offset', v_off,
    'total', (select count(*) from public.product_reports r where r.status = p_status),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'product_id', x.product_id, 'reason', x.reason, 'note', x.note,
          'status', x.status, 'created_at', x.created_at, 'handler_note', x.handler_note, 'product_name', x.name, 'product_status', x.pstatus,
          'supplier_name', x.supplier_name, 'conflict_of_interest', private.has_partner_involvement(x.partner_org_id, auth.uid()))
          order by x.created_at, x.id)
      from (select r.id, r.product_id, r.reason, r.note, r.status, r.created_at, r.handler_note, p.draft ->> 'name' as name,
                   p.status as pstatus, p.partner_org_id, coalesce(s.live_name, s.draft ->> 'name') as supplier_name
            from public.product_reports r join public.products p on p.id = r.product_id join public.suppliers s on s.id = p.supplier_id
            where r.status = p_status order by r.created_at, r.id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

-- Actions: 'dismiss' or 'suspend_product' (suspends the product at once and closes every open report on it).
create function public.handle_product_report(p_report uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  rp public.product_reports;
  v_partner uuid;
  v_note text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('catalogue:moderate') then perform private.raise_error('forbidden'); end if;
  if p_action not in ('dismiss', 'suspend_product') then perform private.raise_error('invalid', 'invalid_action'); end if;
  v_note := private.clean_reason(p_note, case when p_action = 'suspend_product' then 5 else 0 end);
  select * into rp from public.product_reports r where r.id = p_report for update;
  if rp.id is null then perform private.raise_error('not_found'); end if;
  select p.partner_org_id into v_partner from public.products p where p.id = rp.product_id;
  if private.has_partner_involvement(v_partner, v_user) then perform private.raise_error('forbidden', 'conflict_of_interest'); end if;
  if rp.status <> 'open' then perform private.raise_error('conflict', 'report_not_open'); end if;
  if p_action = 'suspend_product' then
    perform public.suspend_product(rp.product_id, v_note);
    update public.product_reports set status = 'actioned', handled_by = v_user, handled_at = now(), handler_note = v_note
    where product_id = rp.product_id and status = 'open';
  else
    update public.product_reports set status = 'dismissed', handled_by = v_user, handled_at = now(), handler_note = v_note where id = rp.id;
  end if;
  perform private.write_audit('product.report_' || case p_action when 'dismiss' then 'dismissed' else 'actioned' end, v_partner, 'product_report',
    rp.id::text, jsonb_build_object('product_id', rp.product_id, 'reason', v_note));
end;
$$;

create function public.catalogue_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_elig integer;
  v_resp integer;
  v_median numeric;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not (private.has_platform_permission('report:view') or private.has_platform_permission('supplier:review')
          or private.has_platform_permission('catalogue:review') or private.has_platform_permission('catalogue:moderate')) then
    perform private.raise_error('forbidden');
  end if;
  select count(*) filter (where r.status <> 'withdrawn' and r.partner_org_id is not null),
         count(*) filter (where r.status <> 'withdrawn' and r.partner_org_id is not null and r.first_response_at is not null),
         percentile_cont(0.5) within group (order by extract(epoch from (r.first_response_at - r.created_at)))
           filter (where r.first_response_at is not null)
    into v_elig, v_resp, v_median
  from public.sourcing_requests r;
  return jsonb_build_object(
    'generated_at', now(),
    'approved_suppliers', (select count(*) from public.suppliers s join public.partner_profiles pp on pp.org_id = s.partner_org_id and pp.status = 'approved'
                           join public.organisations o on o.id = s.partner_org_id and o.status = 'active' where s.status = 'approved'),
    'published_products', (select count(*) from private.visible_product_ids()),
    'suppliers_awaiting_review', (select count(*) from public.suppliers s where s.draft_submitted_version is not null),
    'products_awaiting_review', (select count(*) from public.product_revisions r where r.status = 'submitted'),
    'outdated_availability', (select count(*) from private.visible_product_ids() v join public.catalogue_items ci on ci.product_id = v.product_id
                              where ci.availability_confirmed_on < current_date - 90),
    'open_product_reports', (select count(*) from public.product_reports r where r.status = 'open'),
    'enquiries_received', (select count(*) from public.sourcing_requests),
    'enquiries_received_30d', (select count(*) from public.sourcing_requests r where r.created_at > now() - interval '30 days'),
    'partner_response', jsonb_build_object('requests', v_elig, 'responded', v_resp,
        'response_rate', case when v_elig > 0 then round(v_resp::numeric / v_elig, 4) end,
        'median_response_seconds', case when v_resp > 0 then round(v_median) end),
    'imports', jsonb_build_object('jobs_failed', (select count(*) from public.import_jobs j where j.status = 'failed'),
        'rows_invalid', (select coalesce(sum(coalesce((j.counts ->> 'invalid')::integer, 0) + coalesce((j.counts ->> 'duplicate')::integer, 0)), 0)
                         from public.import_jobs j)));
end;
$$;

revoke all on function
  public.list_partner_orgs(text, integer), public.list_supplier_reviews(text, integer), public.list_product_reviews(integer),
  public.get_product_for_review(uuid), public.list_product_reports(text, integer), public.handle_product_report(uuid, text, text),
  public.catalogue_stats()
  from public, anon, authenticated, service_role;
grant execute on function
  public.list_partner_orgs(text, integer), public.list_supplier_reviews(text, integer), public.list_product_reviews(integer),
  public.get_product_for_review(uuid), public.list_product_reports(text, integer), public.handle_product_report(uuid, text, text),
  public.catalogue_stats()
  to authenticated;
