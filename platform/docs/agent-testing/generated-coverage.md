# Generated coverage (from test-results/agents)

Generated 2026-11-17T06:11:44.278Z. Latest result per check per target; reruns replace earlier results.

## Target: staging Cloudflare Worker (Free plan)

Checks: 145; pass 135, fail 5, observed 4, disabled 1, other 0.

Failures by classification: application 1, hosting 4.

| Scenario | Pass | Fail | Observed | Disabled |
|---|---:|---:|---:|---:|
| a11y | 9 | 0 | 0 | 0 |
| admin | 0 | 1 | 0 | 0 |
| auth | 6 | 0 | 0 | 0 |
| authz | 22 | 0 | 0 | 0 |
| catalogue | 0 | 1 | 0 | 0 |
| documents | 4 | 1 | 0 | 1 |
| infra | 0 | 0 | 1 | 0 |
| isolation | 22 | 0 | 1 | 0 |
| mobile | 8 | 0 | 0 | 0 |
| onboarding | 3 | 2 | 2 | 0 |
| provision | 7 | 0 | 0 | 0 |
| public | 54 | 0 | 0 | 0 |

### Failed checks

- **onboarding** — Buyer B: home page after sign-in shows a dashboard, not a blank page _(application)_: TimeoutError: locator.innerText: Timeout 25000ms exceeded.
- **onboarding** — Seller: sign in through the login form _(hosting)_: TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
- **admin** — sign in with password then TOTP second step _(hosting)_: TimeoutError: page.waitForURL: Timeout 20000ms exceeded.
- **documents** — download route returns 404/401 for an unknown or foreign document id _(hosting)_: Error: expect(received).toContain(expected) // indexOf
- **catalogue** — partner workspace before approval shows a clear state, not an error _(hosting)_: Error: HOSTING?: /en/orgs/7feac2f9-c27f-4097-811e-ef53534bce27/partner still 503 after 4 attempts

### Disabled, observed and designed limitations

- observed: **infra** — sign-in rate limit reached for buyerA; waited 150 s (attempt 1): shared source address for all agents
- observed: **onboarding** — Buyer A: organisation already exists (reused)
- observed: **onboarding** — Buyer B: organisation already exists (reused)
- observed: **isolation** — seller reads buyer_request_private (phone) only where unlocked: 0 rows
- disabled: **documents** — document download for an unscanned file: No malware scanner: files stay quarantined, scanner-dependent flows are closed by design

## Target: control host (same code and staging database, no Worker CPU limit)

Checks: 280; pass 245, fail 12, observed 17, disabled 6, other 0.

Failures by classification: application 12.

| Scenario | Pass | Fail | Observed | Disabled |
|---|---:|---:|---:|---:|
| a11y | 14 | 2 | 0 | 0 |
| account | 2 | 0 | 0 | 0 |
| admin | 23 | 0 | 1 | 0 |
| admin-authz | 2 | 2 | 0 | 0 |
| admin-review | 3 | 1 | 1 | 0 |
| auth | 6 | 0 | 0 | 0 |
| authz | 22 | 0 | 0 | 0 |
| catalogue | 9 | 2 | 2 | 0 |
| documents | 5 | 0 | 0 | 1 |
| exploratory | 4 | 1 | 1 | 0 |
| gov | 5 | 0 | 0 | 2 |
| infra | 0 | 0 | 2 | 0 |
| isolation | 26 | 0 | 2 | 0 |
| language | 1 | 0 | 0 | 0 |
| mobile | 21 | 0 | 0 | 0 |
| news | 1 | 0 | 0 | 0 |
| notifications | 3 | 0 | 1 | 1 |
| onboarding | 12 | 0 | 4 | 0 |
| privacy | 2 | 0 | 0 | 0 |
| provision | 6 | 0 | 0 | 0 |
| public | 54 | 0 | 0 | 0 |
| quotation | 8 | 2 | 0 | 0 |
| request | 3 | 1 | 0 | 0 |
| search | 1 | 0 | 0 | 0 |
| secrets | 1 | 0 | 1 | 0 |
| seller-listing | 4 | 0 | 0 | 0 |
| seller-onboarding | 4 | 1 | 1 | 1 |
| sourcing | 3 | 0 | 1 | 1 |

### Failed checks

- **seller-onboarding** — step 1 to 4 accept valid details _(application)_: TimeoutError: locator.click: Timeout 25000ms exceeded.
- **admin-review** — listing queue shows the seller listing _(application)_: Error: expect(locator).toBeVisible() failed
- **request** — five-step request form: validation on step 1 then complete _(application)_: TimeoutError: locator.waitFor: Timeout 25000ms exceeded.
- **quotation** — seller sees the invitation in the request inbox and shows interest _(application)_: Error: expect(locator).toBeVisible() failed
- **a11y** — single main landmark: /en/admin/sourcing _(application)_: 2 <main> elements on one page
- **admin-authz** — buyerA: HTTP status of the denial page _(application)_: status 200 with an in-page message (should be 403)
- **admin-authz** — seller: HTTP status of the denial page _(application)_: status 200 with an in-page message (should be 403)
- **catalogue** — administrator partner list shows the supplier organisation _(application)_: Error: expect(locator).toContainText(expected) failed
- **a11y** — single main landmark: /en/sourcing _(application)_: 2 <main> elements on one page
- **exploratory** — back button after sign-out does not reveal private pages _(application)_: TimeoutError: locator.click: Timeout 25000ms exceeded.
- **quotation** — Buyer A sees the seller interest and opens the enquiry _(application)_: TimeoutError: locator.click: Timeout 25000ms exceeded.
- **catalogue** — administrator partner list shows the supplier and approves it _(application)_: TimeoutError: locator.click: Timeout 25000ms exceeded.

### Disabled, observed and designed limitations

- observed: **seller-onboarding** — upload response message
- disabled: **seller-onboarding** — business verification approval path (document → admin decision): No malware scanner on staging: uploads stay quarantined, so a claim cannot be submitted or approved through the UI. Postponed by design.
- observed: **admin** — admin_review on /admin/users: 200 IN INOK INOK Admin INOK reviewer · 2-step sign-in Overview REVIEW Verification Listings Pr
- observed: **admin-review** — listing queue: seller listing already decided in an earlier run
- observed: **infra** — sign-in rate limit reached for buyerA; waited 75 s (attempt 1): shared source address for all agents
- observed: **isolation** — seller reads buyer_request_private (phone) only where unlocked: 0 rows
- disabled: **documents** — document download for an unscanned file: No malware scanner: files stay quarantined, scanner-dependent flows are closed by design
- observed: **secrets** — cookies readable by scripts: none
- observed: **catalogue** — partner home text before approval: IN INOK Directory Products from India Create AS AGENT Supplier Chennai Textiles (test) Partner Home Suppliers Products Import Catalogue Buyer Requests Notifications Settings Team Tell us about your or
- disabled: **gov** — published government programme records: Government publication stays off until records are verified against official sources (publishing_enabled=false); catalogue may be empty
- disabled: **gov** — scheduled monitoring and reminder emails: Scheduler runs, monitoring switch is off; no mail provider
- observed: **infra** — sign-in rate limit reached for buyerA; waited 150 s (attempt 1): shared source address for all agents
- observed: **catalogue** — catalogue products visible to buyers: 0 product cards
- observed: **sourcing** — full RFQ → partner quote → sample → choice journey: Needs an approved supplier with a published product; exercised end-to-end by tests/hosted/sourcing-uploads.spec.ts (see report)
- disabled: **sourcing** — RFQ attachments: Attachments are refused while no scanner exists (fail-closed)
- observed: **exploratory** — buyer org opening /business/listing: 404 Page not found We could not find that page. Go to the home page
- observed: **notifications** — in-app notification text after quotation events: IN INOK Directory Products from India Create AB AGENT Buyer A Trading (test) Individual buyer Home Messages Saved products My product requests GROW Government help News & bulletins Team Settings Messa
- disabled: **notifications** — email notification of quotation events: No mail provider on staging; in-app notifications only
- observed: **isolation** — enquiry page for Buyer B shows: 404 Page not found We could not find that page. Go to the home page
- observed: **onboarding** — Buyer A: organisation already exists (reused)
- observed: **onboarding** — Buyer B: organisation already exists (reused)
- observed: **onboarding** — Seller: organisation already exists (reused)
- observed: **onboarding** — Supplier (partner): organisation already exists (reused)

## Worker 5xx events (hosting evidence)

Total logged 5xx/navigation failures on the Worker: 46; navigations that recovered on a retry: 0.

| Status and path | Count |
|---|---:|
| 503 /en/login | 30 |
| 503 /en/orgs/:id/partner | 8 |
| 503 /api/v1/documents/:id | 4 |
| 500 /api/v1/documents/:id | 4 |

## Findings recorded by the suite (3)

- **P3** [test-infra] staging data hygiene: Staging holds 63 admin_super memberships from earlier hosted test runs
- **P2** [application] quotations: Send quotation fails with "Someone changed this item" after saving the draft twice without reloading
- **P3** [test-infra] staging data hygiene: Staging holds 63 admin_super memberships from earlier hosted test runs
