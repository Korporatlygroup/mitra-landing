-- WP5: INOK staff can SEE the agreements on which a participant reported an issue. Read only: this changes nothing, decides nothing and moves no money.
-- Participants keep their existing order_action('dispute', note); the note now starts with a reason code in square brackets (for example "[not_delivered] ...").
-- Same pattern and permission as the other staff queues (report:view); anyone else gets not_found.

create function public.admin_order_issues(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_platform_permission('report:view') then perform private.raise_error('not_found'); end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then perform private.raise_error('invalid', 'invalid_data'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'reference', x.reference, 'enquiry_id', x.enquiry_id, 'currency', x.currency, 'total', x.total,
      'buyer_name', x.buyer_name, 'seller_name', x.seller_name, 'reported_at', x.reported_at, 'note', x.note, 'reported_by', x.reported_by) order by x.reported_at desc)
    from (
      select o.id, o.reference, o.enquiry_id, o.currency, o.total, b.name buyer_name, s.name seller_name, e.created_at reported_at, e.note,
             case when e.actor_org_id = o.buyer_org_id then 'buyer' else 'seller' end reported_by
      from public.orders o
      join public.organisations b on b.id = o.buyer_org_id
      join public.organisations s on s.id = o.seller_org_id
      join lateral (select d.created_at, d.note, d.actor_org_id from public.deal_events d where d.order_id = o.id and d.kind = 'order.disputed' order by d.created_at desc limit 1) e on true
      where o.status = 'disputed'
      order by e.created_at desc limit p_limit
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_order_issues(integer) from public, anon;
grant execute on function public.admin_order_issues(integer) to authenticated;
