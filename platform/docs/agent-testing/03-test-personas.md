# 3. Test-persona definitions (Phase B)

All personas are synthetic and **staging-only** (`mitra-staging`, ref `udxzukodfqjzdukweygy`). Emails use the reserved `example.test` domain. Every persona has its own browser context (no shared cookies), its own organisation, and its credentials in a **secure test-secret store outside the repository** (`~/.inok-test-secrets/staging-agents.json` by default, override with `INOK_TEST_SECRETS_DIR`; file mode 0600; never printed, never committed; it holds passwords and the administrators' TOTP seeds). Source of truth for the definitions: `tests/agents/personas.ts`.

| Key | Persona | Email | Organisation (type) | Role | MFA | Goal in the scenarios |
|---|---|---|---|---|---|---|
| buyerA | Agent Buyer A | agent-buyer-a@example.test | AGENT Buyer A Trading (test) (buyer) | owner | no | Posts a request, negotiates and accepts a quotation, browses catalogue and help |
| buyerB | Agent Buyer B | agent-buyer-b@example.test | AGENT Buyer B Retail (test) (buyer) | owner | no | Outsider/competitor: must never see Buyer A's private data |
| seller | Agent Seller | agent-seller@example.test | AGENT Seller Kedai Uniform (test) (business) | owner | no | Onboards, publishes a listing, answers requests, quotes, uses government help |
| supplier | Agent Supplier | agent-supplier@example.test | AGENT Supplier Chennai Textiles (test) (partner) | owner | no | Partner workspace, supplier records, product and request screens |
| admin | Agent Admin | agent-admin@example.test | MITRA Administration (mitra) | admin_super | TOTP | Reviews listings, partners, queues; checks console |
| admin2 | Agent Admin Two | agent-admin2@example.test | MITRA Administration (mitra) | admin_review | TOTP | Second person for four-eyes rules; proves reviewer limits |

**How they were provisioned (and what was not possible):**
- Accounts were created through the Supabase Auth admin API with `email_confirm`, because email delivery does not exist on staging. Organisations were created by the personas themselves through the real `/orgs/new` form.
- The one-time `bootstrap_first_admin` had already been consumed on staging, so the first agent administrator was added to the operator organisation with an operator-side staging statement (the method earlier hosted suites used). **This is not the in-app path.** The in-app path (an administrator invites by email) cannot complete on staging because the invitation link is only emailed, so `admin2` was added the same operator-side way. Neither step weakens MFA: both administrators must sign in with TOTP and the console refuses a session without the second step.
- MFA enrolment for the two administrators used the Auth API; sign-in uses the real login form and the TOTP step.
- No real identities, documents or contact details were used. The verification document used in the upload check is a generated, harmless one-page PDF with a random tag.
- Staging already contained 62 `admin_super` memberships from earlier hosted test runs (see report finding TI-01).
