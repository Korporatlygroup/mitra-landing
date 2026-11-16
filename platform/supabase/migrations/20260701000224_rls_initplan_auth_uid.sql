-- Performance only, same access rules (advisor lint auth_rls_initplan). Thirteen SELECT policies call auth.uid() once per row;
-- wrapping it as (select auth.uid()) makes the planner evaluate it once per statement (an InitPlan), as migration 222 did for the platform
-- permission check. Each policy keeps its table, command, role and condition; only the auth.uid() call is wrapped.
-- Found by the Supabase security and performance advisors on the hosted staging project; the tables are empty there today.

drop policy dash_dismissals_own on public.dash_dismissals;
create policy dash_dismissals_own on public.dash_dismissals for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy gov_prefs_select on public.gov_notification_prefs;
create policy gov_prefs_select on public.gov_notification_prefs for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy gov_outbox_select on public.gov_outbox;
create policy gov_outbox_select on public.gov_outbox for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy news_digests_own on public.news_digests;
create policy news_digests_own on public.news_digests for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy news_prefs_own on public.news_prefs;
create policy news_prefs_own on public.news_prefs for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy news_saved_own on public.news_saved;
create policy news_saved_own on public.news_saved for select to authenticated
  using ((user_id = (select auth.uid())));

drop policy product_media_select on public.product_media;
create policy product_media_select on public.product_media for select to authenticated
  using ((private.is_member(partner_org_id) OR (private.has_platform_permission('catalogue:review'::text) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE (p.id = product_media.product_id))))));

drop policy product_revisions_select on public.product_revisions;
create policy product_revisions_select on public.product_revisions for select to authenticated
  using ((private.is_member(partner_org_id) OR (private.has_platform_permission('catalogue:review'::text) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))))));

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using ((private.is_member(partner_org_id) OR (private.has_platform_permission('catalogue:review'::text) AND (status <> 'draft'::product_status) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))))));

drop policy supplier_documents_select on public.supplier_documents;
create policy supplier_documents_select on public.supplier_documents for select to authenticated
  using ((private.is_member(partner_org_id) OR (locked AND private.has_platform_permission('supplier:review'::text) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))))));

drop policy supplier_events_select on public.supplier_events;
create policy supplier_events_select on public.supplier_events for select to authenticated
  using ((private.is_member(partner_org_id) OR (private.has_platform_permission('supplier:review'::text) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))) AND (EXISTS ( SELECT 1
   FROM suppliers s
  WHERE ((s.id = supplier_events.supplier_id) AND ((s.status <> 'draft'::supplier_status) OR (s.draft_submitted_version IS NOT NULL))))))));

drop policy supplier_private_select on public.supplier_private;
create policy supplier_private_select on public.supplier_private for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM suppliers s
  WHERE ((s.id = supplier_private.supplier_id) AND (private.has_permission(s.partner_org_id, 'supplier:manage'::text) OR (private.has_platform_permission('supplier:review'::text) AND ((s.status <> 'draft'::supplier_status) OR (s.draft_submitted_version IS NOT NULL)) AND (NOT private.has_partner_involvement(s.partner_org_id, (select auth.uid())))))))));

drop policy suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using ((private.is_member(partner_org_id) OR (private.has_platform_permission('supplier:review'::text) AND ((status <> 'draft'::supplier_status) OR (draft_submitted_version IS NOT NULL)) AND (NOT private.has_partner_involvement(partner_org_id, (select auth.uid()))))));
