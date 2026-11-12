-- Review N1: has_org_involvement() looks events up by (org, actor) on every decision and document view.
create index verification_events_org_actor on public.verification_events (org_id, actor_user_id);
