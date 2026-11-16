# Supabase advisor review (193 warnings, 0 errors) — 2026-11-16

Both hosted projects report the same 193 warnings. Reviewed by querying the staging catalogue (identical schema to production, parity verified) rather than assuming they are harmless.

| Group | Count | Finding | Verdict |
|---|---|---|---|
| `SECURITY DEFINER` functions executable by `anon` | 13 | 10 are public-directory/catalogue/news/programme readers whose bodies return only published or visible rows; 3 (`get_product_media_access`, `news_get`, `news_list`) check `auth.uid()` or visibility inside | **Intended**. No sensitive data path found. Each has a pgTAP assertion for the anonymous result |
| `SECURITY DEFINER` functions executable by `authenticated` | 179 | the same 179 functions include the 13 anonymous ones above; every function pins `search_path`; 159 contain an explicit caller check in the body; 10 are the public readers above; 10 more (`admin_news_*` → `assert_news_staff`, `biz_product_*` → `assert_biz_org`, `gov_get_profile`, `gov_list_saved`, `gov_unsave_programme`, `gov_update_tracking` → `assert_assist_org`) delegate to an assertion helper as their first statement; `list_sourcing_partners` returns approved partner names and published-product counts (directory-level data) | **Intended**. No function without an authorization step found that touches non-public data |
| Permissive policy overlap | 1 | `organisations` has two SELECT policies (member and verification staff) | **Performance note only**, not a security issue; leave |
| Always-true policy | 1 | `role_permissions_select` (authenticated read of the permission catalogue) | **Intended** reference data, no personal data |

Additional checks that matter more than the advisor text:
- `anon` has **0** table grants in `public`, `private` and `auth`; `authenticated` has **0** INSERT/UPDATE/DELETE grants on public tables: every write goes through an RPC with its own authorization.
- The `private` schema is not usable by `anon` (not in the API schema list).
- RLS is enabled on all 87 public tables; no view lacks `security_invoker`.
- Storage buckets are private and have no API-role policy (hosted test: anon, buyer and seller cannot list, read or write).
- The `graphql` and `graphql_public` schemas are visible to `anon`, but with no table grants they expose no data. Optional hardening: disable `pg_graphql` if it is not used (not changed here).

Residual risk: a future migration could add a `SECURITY DEFINER` function without a caller check. The pgTAP suite (`01` privilege inventory) fails on an unexpected anonymous or authenticated grant; keep it in the release gate.
