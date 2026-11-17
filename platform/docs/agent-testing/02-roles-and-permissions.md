# 2. User-role and permissions matrix

Source: `public.role_permissions` on `mitra-staging` (read 2026-11-17), the organisation types enum, and the route guards. Roles live on a membership (user + organisation); organisation type decides which workspace applies (`business`, `buyer`, `partner`, `mitra` = operator).

| Permission | owner | manager | staff | viewer | admin_super | admin_review | admin_ops | admin_content | admin_support |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| business:edit, catalogue:manage, supplier:manage, lead:manage, enquiry:write, quote:send, request:post, request:respond, sourcing:respond, review:write, assist:manage | yes | yes | yes | no | no | no | no | no | no |
| listing:publish (send listing for review), verification:submit / read | yes | yes | no | no | no | no | no | no | no |
| member:invite / remove / set_role | yes | yes | no | no | no | no | no | no | no |
| org:manage | yes | no | no | no | yes | no | no | no | no |
| audit:read | yes | no | no | no | yes | no | yes | no | no |
| admin:users (user and role console) | no | no | no | no | yes | no | no | no | no |
| verification:review / decide | no | no | no | no | yes | yes | no | no | no |
| listing:review | no | no | no | no | yes | yes | no | no | no |
| partner:manage, supplier:review, catalogue:review | no | no | no | no | yes | yes | no | no | no |
| catalogue:moderate, request:moderate | no | no | no | no | yes | no | no | no | yes |
| review:moderate | no | no | no | no | yes | yes | no | no | no |
| gov:view | no | no | no | no | yes | yes | yes | yes | no |
| gov:review | no | no | no | no | yes | yes | no | no | no |
| gov:source_admin | no | no | no | no | yes | no | yes | no | no |
| gov:publish, programme:publish | no | no | no | no | yes | no | no | yes | no |
| privacy:handle | no | no | no | no | yes | no | no | no | no |
| case:reply | no | no | no | no | yes | no | no | no | yes |
| report:view | no | no | no | no | yes | no | yes | no | no |

`viewer` has no permission rows: a viewer can read the organisation workspace but perform no write.

**Rules enforced in the database (not only in the UI):** a user cannot grant a role above their own (`cannot_grant_above_own_role`); administrator roles exist only in the `mitra` organisation (trigger); the first administrator can be bootstrapped exactly once (`bootstrap_first_admin`, consumed on staging); identity tables have no direct write grant (all writes go through audited functions); the audit log is append-only; four-eyes rule: a second administrator must approve government-source enabling and a programme edit.

**Visitors (no account)** may read the public directory, profiles, catalogue (approved items), Business help, news and legal pages. **Buyers** (type `buyer`) post requests, invite businesses, hold enquiries, accept quotations, request prices and sourcing. **Sellers** (type `business`) onboard, publish a listing after review, answer requests and quote. **Partners / suppliers** (type `partner`) work only after MITRA approves the partner organisation.
