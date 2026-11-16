# Privacy and security audit (2026-11-16)

Verified against code, local database, staging and production. "Hosted" = the deployed Worker and real Supabase project; "local" = local stack only.

## 1. Implemented and evidenced
| Area | Evidence |
|---|---|
| Sign-in, sign-out, session refresh, global sign-out | Hosted tests (`staging.spec.ts`) |
| Password recovery (link, weak password refused, old link and password dead) | Hosted test (token created with the admin API; **email delivery unverified**) |
| MFA for privileged users; admin session at aal1 refused | Hosted test; pgTAP |
| Role-based access and tenant isolation (RLS on all 88 public tables, anonymous has no table grants, signed-in users have no direct writes) | pgTAP 01, 02, 03, 31; advisor review; hosted isolation tests; sourcing and document cross-tenant tests |
| Private storage, no public URLs, no API-role policy | Hosted test; production public URL refused |
| Upload checks (type, size, active content), quarantine and fail-closed scanning | Local suites (e23, e24b, e26) and hosted `sourcing-uploads.spec.ts` (valid PDF stays pending, not downloadable, cannot be sent) |
| Audit trail append-only | pgTAP 05, 13 |
| Consent versioning, timestamp, account link, re-acceptance screen | pgTAP 07, 31; local e92; hosted legal test |
| Optional marketing consent: never pre-ticked, never required, withdrawable, audited | pgTAP 31; local e92 (both viewports); hosted legal test |
| Data requests with 21-day due date, queue, audit, isolation | Migration 225; pgTAP 31; local e92; hosted legal test |
| Production: sign-up disabled, gated, empty (0 users, 0 organisations, 0 audit rows), 41 migrations | Rechecked today |
| Only the documented cookie is set for visitors; no third-party requests on public pages | Local e92; hosted legal test |

## 2. Missing or incomplete (not remediated)
| Gap | Consequence |
|---|---|
| Malware scanner not operational | Verification documents and attachments cannot be approved or downloaded; document-based verification cannot launch |
| No transactional email | Confirmation, recovery, notifications cannot reach users; public sign-up must stay off |
| Production has no automatic backups (Free plan) | Manual backup and tested restore only; no point-in-time recovery |
| Erasure and export are manual staff procedures | Cannot meet requests at scale; no scheduled retention deletion |
| Incident roles unnamed, procedure not rehearsed, no alerting | Slow detection and response |
| Seller disclosure fields from the e-trade Regulations (payment methods, sale terms, safety declaration, public address, delivery cost) | See `supplier-disclosure-audit.md` |
| Processor agreements and cross-border assessment not on file | Notice cannot claim compliant transfers |
| Cloudflare Worker logging retention and content not reviewed | IP and request data may sit in Cloudflare logs (`observability` is enabled in `wrangler.jsonc`) |
| Tamil legal translation absent | English shown with a notice |
| Admin queue for data requests built, but no email or in-app notice to the user on status change | User must look in My account |

## 3. Statements that were false or incomplete, and what changed
- The old placeholder pages for Terms and Privacy said what a notice "will" explain; they are replaced by full drafts. The notice now states the real limits (no scanner, no production backups, Tokyo hosting, transfer assessment not complete) and promises no compliance.
- The previous product had no way to ask for access, correction or deletion; added.
- The sign-up form had no optional marketing choice and no cookie link; added.

## 4. Remediation performed today
Migration 225 (applied to staging; **not** to production), new pages and pgTAP and browser tests, the `privacy:handle` permission for admin_super only, and the documents in `docs/legal`.

## 5. Compliance assessment
| Question | Answer |
|---|---|
| Must INOK register as a data controller? | Probably not: the 13 classes in the Order do not name marketplaces or directories (closest: Wholesale and Retail, Direct Selling). Counsel to confirm; Circular 1/2026 on registration was not read |
| Is a Data Protection Officer mandatory? | Only above 20,000 data subjects, 10,000 sensitive-data subjects, or regular systematic monitoring (Circular 1/2025). Not at launch scale; appointing one is recommended |
| Do cross-border transfers need more safeguards? | Yes, an assessment and processor terms are needed (Tokyo, Cloudflare edge, overseas suppliers); the guideline text was not read |
| Is a data protection impact assessment indicated? | Recommended before enabling verification uploads (identity-related documents). Not shown to be mandatory |
| Are marketplace operator duties fully implemented? | No: see disclosure audit (supplier disclosure checks, complete record fields) |
| Are user-facing disclosures adequate? | Drafts are complete in content but unapproved, with placeholders for operator details |
