# Remaining privacy, business-verification and complaint-handling requirements (2026-11-20)

Requirements and proposals only. **No company details, thresholds, deadlines or legal obligations are invented here**; everything that needs a number, a name or a legal conclusion is marked "management" or "counsel". Related: `legal-audit-2026-11-20.md`, `erasure-option-c-proposal.md`, `operational-readiness-2026-11-20.md`, `docs/legal/*`.

Stale statements found in existing documents (not fixed here): `docs/legal/privacy-requests-procedure.md` says the workflow is "staging only so far" and "email is not live"; production has the data-request workflow (migration 225 applied) and email is configured (delivery unproven).

## 1. Privacy
| # | Requirement | Today | Needed |
|---|---|---|---|
| P1 | Data requests (access, correction, deletion, portability, consent withdrawal, complaint) | In-app intake with a 21-day due date, staff queue, audit trail; handling is manual | Named privacy owner and backup (management); written reply template; confirm the period INOK promises (counsel) |
| P2 | Portability / access export | **No export feature**; the Privacy draft lists portability as a right | Decide: build a per-user export (scope: profile, consents, memberships, messages the user wrote, quotations, agreements, saved items) or soften the wording (management + counsel) |
| P3 | Deletion | Manual; **blocked for anyone with an agreement** | Option C implementation after decisions (`erasure-option-c-proposal.md`); until then each deletion request is answered with what could and could not be removed, never "deleted" unless it was |
| P4 | Retention | Proposed periods in the Privacy draft; **no job deletes anything on a schedule** | Approve the schedule (management + counsel); then a scheduled deletion job with tests; document backup expiry |
| P5 | Processors and transfers | Supabase (Tokyo), Cloudflare, Resend named; no signed terms recorded; transfer assessment not done; Turnstile would add Cloudflare as a processor | Record processor terms; transfer assessment (counsel); confirm Resend processing location |
| P6 | Breach response | Draft `docs/legal/incident-response.md` | Named roles, who notifies the Commissioner and people, contact path (management + counsel) |
| P7 | Records of processing | `docs/legal/data-processing-inventory.md` exists | Review against the current features (agreements, booking terms, issue reports, email) and keep updated |
| P8 | DPO / registration questions | Open in `management-information-required.md` | Counsel's opinion on whether INOK must appoint a DPO or register as a data controller or processor |
| P9 | Notice language and translations | English and Malay drafts; Tamil missing | Counsel: language requirement for the notice; native review of Malay; decide on Tamil |
| P10 | Consent versioning | `CONSENT_VERSION = '2026-07'`, DB function must match | When text is approved: bump both together so users re-accept; not done |
| P11 | Cookie and Turnstile | Only `NEXT_LOCALE` for visitors (verified) | Re-check cookies after Turnstile is enabled |

## 2. Business verification
| # | Requirement | Today | Needed |
|---|---|---|---|
| V1 | Written verification standard | None | Per claim type: what evidence is acceptable, what the reviewer checks, what a "reviewed" label means and does not mean, outcomes (approve, request changes, reject) and the wording of each. Management writes; I can draft a skeleton from the code on request |
| V2 | Document scanning | No scanner; uploads stay quarantined, so **document verification cannot complete** | Decide: connect a scanner (options in `malware-scanning-options.md`) or do not offer document verification yet and say so on the page |
| V3 | Staffing and separation of duties | One staff membership in production | At least two reviewers; the conflict-of-interest rule only works with more than one |
| V4 | Sensitive evidence handling | Private bucket, short-lived access, audit; users told not to send identity-card images | Retention for evidence (proposal in the Privacy draft is unapproved); who may download; what happens when a document is sent that should not have been |
| V5 | Turnaround and communication | No target; no email proven | Decide a target and how decisions reach the applicant (in-app today; email after delivery is proven) |
| V6 | Re-verification and revocation | Reviewer can withdraw verification | Rules for when to revisit (expired documents, complaints) |
| V7 | Staff access recovery | Single point of failure | A second owner on Supabase, Cloudflare and GitHub; recovery process (management) |

## 3. Complaint handling
| # | Requirement | Today | Needed |
|---|---|---|---|
| C1 | Intake channels | In-app Report on listings, products, reviews, requests; issue report on agreements; data requests; **email addresses do not exist yet** | Email Routing for `support@`, `complaints@`, `privacy@` (`email-routing-proposal.md`) |
| C2 | Ownership | Reports have a handler and note only | Named owner per category (fraud, listing quality, abuse, privacy, agreement issues); backup |
| C3 | Tracking fields | Status (open, dismissed, actioned), handler, note | Proposal for a later build: assignee, due date, category, outcome, escalation level, link to evidence; until then a shared sheet recording who, when, outcome |
| C4 | Response targets | Policy proposes acknowledge in 3 working days, reply in 14 days; not enforced | Management approves or changes; staff reminder routine |
| C5 | Evidence | No attachments; the conversation and agreement history are the evidence | Decide what staff may request (screenshots, receipts), where it is stored and for how long; never identity-card images or bank details |
| C6 | Agreement issues | Buyer reports; seller is notified; staff list is read-only; seller cannot reply; no resolution workflow | Seller response and staff resolution notes (feature), after the process is decided; no refund or payment outcome until a payment partner exists |
| C7 | Escalation | Described in the policy (KPDN, Tribunal, bank, police, Commissioner) | Internal rule: who decides suspension, who contacts authorities, who signs outgoing replies |
| C8 | Reporting to management | None | Monthly counts by category and time to first response (can come from the existing tables) |
| C9 | Marketplace regulation duty | Policy says a complaint channel exists | Counsel: whether the 2024 e-trade regulations oblige a specific channel and record-keeping for INOK |

## 4. Decisions needed (management unless stated)
1. Privacy owner and backup; answer period promised for requests.
2. Whether to build export (P2) or soften the portability wording.
3. Retention schedule approval (counsel input).
4. Whether INOK offers document verification before a scanner exists.
5. Reviewer headcount and a second owner for Supabase, Cloudflare and GitHub.
6. Complaint owners per category and the response targets.
7. Escalation rules and who may speak to authorities.
8. Counsel questions: notice language, DPO and registration, transfers, e-trade regulation applicability.
