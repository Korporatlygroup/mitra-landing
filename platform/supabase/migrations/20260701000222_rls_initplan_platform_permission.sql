-- Performance only, same access rules. The platform-wide permission check does not depend on the row, so it is wrapped in
-- (select ...) and the planner evaluates it once per statement (an InitPlan) instead of once per audit or event row.
-- Measured locally with about 9,400 audit rows: 1,677 ms down to 7 ms for a user without the permission, identical result.
drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    (org_id is not null and private.has_permission(org_id, 'audit:read'))
    or (select private.has_platform_permission('audit:read'))
  );

drop policy verification_events_select on public.verification_events;
create policy verification_events_select on public.verification_events for select to authenticated
  using (private.has_permission(org_id, 'verification:read') or (select private.has_platform_permission('verification:review')));
