# Phase 3 report: directory, customer requests, matching (updated 2026-11-11)

Branch `feature/phase3-directory` (remote `platform/phase3-directory`), PR #6 stacked on PR #5 (Phase 2), which is stacked on PR #3 (Phase 1). Nothing is merged. Nothing is applied to hosted staging. Contract for Phase 4: `docs/contracts/phase3-phase4.md` (`p3p4-contract/1.1`).

## Delivered
- **Seller:** public page editor (draft vs approved version), services with areas, portfolio examples (title, description, type of work, month; text only), preview, review, withdraw, unpublish/republish, busy switch.
- **Buyer:** directory search, business page with enquiry and report, five-step request wizard with save/resume and a **visibility choice** (suitable businesses can find it, or only businesses I invite; default is invite-only), my requests, explained matches, invitations (max 10), close/withdraw.
- **Public request board (new):** sellers open "Find customer requests", filter by category and state, read permitted details, and answer Interested / Ask a question / Cannot take it. A reply creates the same match row and the same enquiry as an invitation reply. Eligibility is decided in the database (`private.board_eligible`).
- **Admin:** listing review queue, suspend/reinstate, reports queue, audit; no self-approval.
- **Languages:** English, Tamil, Bahasa Melayu (see `i18n-coverage.md`).
- **Enquiry seam** for Phase 4 unchanged (one `enquiries` table, no quotation tables).

## Migrations
`000012`, `000013`, `000014` (Phase 3 as committed in `6ef9f01`); addenda `20260701000100_p3_request_board`, `…101_p3_ms_language`, `…102_p3_portfolio_fields`. Phase 4 numbering conflict to resolve: see `staging-migration-reconciliation.md` (ordering rule).

## Evidence (all LOCAL on a separate local Supabase stack; PR CI results below)
| Check | Result |
|---|---|
| pgTAP | 988 pass (Phase 1-2: 749; Phase 3 and addenda: 239) |
| Unit | 285 pass |
| Integration | 114 pass, 2 skip |
| Playwright (360px and 1280px, axe) | 281 pass in one full run; one test (E2) lost its worker to a Windows browser crash and passed on rerun together with E24 (16 pass). An earlier full run was cut short by the same kind of crash and was discarded and rerun. |
| typecheck, lint (0 errors, 4 old warnings), platform build, Astro build | pass |
| CI on PR #6 | first run: 260 passed, 2 mobile admin-form clicks failed (hydration race, fixed in test); second run failed on a stale two-language email assertion (E24, fixed in this commit). A third CI run must be checked after this push. The `Workers Builds: mitra-landing` check fails on PR #5 as well; it is the landing site's Cloudflare build, not Phase 3. |

## Public request board: test results
pgTAP B1-B22 and H1-H4 (eligibility, privacy, 404 without leaks, retries, caps, visibility freeze, contact guard, reports); E43 (full buyer-to-seller journey, privacy of name/phone/email in the HTML, filters, ineligible seller and cross-organisation 404, session loss, withdraw empties the board, Tamil); E43b (invitation-only never on the board); E44/E45 for Bahasa Melayu and usability.

## Independent reviews
- Phase 3 reviews 1 and 2 (earlier): no open critical or high.
- Phase 3.1 review (board, languages, portfolio): critical none, high none. Medium: (1) board requests could not be reported before replying; (2) contact guard bypassable (spaces, line breaks, spelled-out emails, chat links, the `unit` field); (3) a resubmit after posting showed an error. **All three fixed** with tests (H1-H4). Low items accepted: the 20-reply cap reveals that many others replied (minor); board declines create match rows (bounded); the portfolio category label uses messages in all languages; `sweep_requests` is a write on read paths (pre-existing).
- Migration reconciliation plan: independently reviewed, approve with changes; changes applied.
- Limit: the reviewers are model-based; no human security review has happened.

## Portfolio
Text entries with type of work and month, add/edit/remove (clear the entry), preview, empty state. **Image uploads are not implemented** on purpose: there is no public bucket, and no malware scanner is configured (ClamAV is not available), so public images could not be scanned or checked. Needed first: a scanner, a separate public bucket with restricted upload policy, type/size validation and metadata stripping, explicit publication, and a content-safety check. The editor tells sellers that photos cannot be added yet.

## Usability
Checked with synthetic accounts at 360px and 1280px (E43-E45): incomplete and invalid input, phone width, language switch halfway, lost session, resuming a request, empty states, no permission, other users' pages. Found and fixed: sideways scroll in description lists with long labels (Bahasa Melayu), an invalid contact list on public pages without a phone or email. **Not done:** a left sidebar for desktop and a simplified phone menu; the app still uses a top bar that wraps on phones. Changing it touches every page and test, so it needs its own change. **No real user testing has been done**; this is not user validation.

## Not done / dependencies
- Hosted: no migration applied, history mismatch not yet repaired (plan ready, needs owner approval), no hosted app deployment, no hosted tests. See `staging-readiness.md`: no Vercel or other hosting configured, no malware scanner, auth redirect URLs and SMTP unverified, no error monitoring.
- Tamil and Bahasa Melayu text are machine-assisted drafts; no fluent human review.
- Phase 4 migration numbers: 000015-000099 were promised to Codex but hosted ordering needs them above 000102 if Phase 3 goes first. Codex must be told.
- Anonymous directory search needs an edge rate limit. Email delivery of new notifications is untested; they are in-app only. Legal pages are placeholders.
- Indian partner sourcing is deliberately not built.
