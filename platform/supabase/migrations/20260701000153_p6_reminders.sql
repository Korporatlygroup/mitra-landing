-- Operational, in-app reminders for accepted sourcing partners who have not quoted.
-- No marketing message is sent; only existing authorized partner members are notified.
create table private.sourcing_reminder_log (
  rfq_id uuid not null,
  partner_org_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key(rfq_id,partner_org_id),
  foreign key(rfq_id,partner_org_id) references public.sourcing_rfq_partners(rfq_id,partner_org_id) on delete cascade
);
alter table private.sourcing_reminder_log enable row level security;
revoke all on private.sourcing_reminder_log from anon,authenticated,service_role;

create function public.service_send_sourcing_reminders(p_limit integer default 20)
returns integer language plpgsql security definer set search_path='' as $$
declare p record; v_count integer:=0;
begin
  for p in
    select sp.rfq_id,sp.partner_org_id from public.sourcing_rfq_partners sp
    join public.sourcing_rfqs r on r.id=sp.rfq_id
      and r.status in ('submitted','awaiting_quotes','negotiating')
    join public.organisations buyer on buyer.id=r.buyer_org_id and buyer.status='active'
    join public.organisations partner on partner.id=sp.partner_org_id and partner.status='active'
    join public.partner_profiles pp on pp.org_id=sp.partner_org_id and pp.status='approved'
    left join private.sourcing_reminder_log log on log.rfq_id=sp.rfq_id and log.partner_org_id=sp.partner_org_id
    where sp.status='accepted' and coalesce(sp.responded_at,sp.invited_at)<now()-interval '2 days'
      and (log.sent_at is null or log.sent_at<now()-interval '7 days')
      and not exists(select 1 from public.sourcing_rfq_quotes q where q.rfq_id=sp.rfq_id
        and q.partner_org_id=sp.partner_org_id and q.status in ('submitted','preferred'))
    order by coalesce(log.sent_at,sp.responded_at,sp.invited_at),sp.rfq_id
    limit least(greatest(p_limit,1),50)
    for update of sp skip locked
  loop
    insert into private.sourcing_reminder_log(rfq_id,partner_org_id,sent_at)
      values(p.rfq_id,p.partner_org_id,now())
      on conflict(rfq_id,partner_org_id) do update set sent_at=excluded.sent_at;
    perform private.notify_org(p.partner_org_id,'sourcing:respond','sourcing.quote_reminder',
      'sourcing_rfq',p.rfq_id::text);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.service_send_sourcing_reminders(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.service_send_sourcing_reminders(integer) to service_role;
