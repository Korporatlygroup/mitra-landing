# Agreement erasure: Option C ("Detach and keep") implementation proposal

Status: **proposal only. Nothing is implemented, no migration exists for it, nothing is applied anywhere.** Direction chosen by the owner: Option C, subject to privacy and legal review. Written 2026-11-20. Background and the other options: `erasure-of-agreements.md`.

## 1. The problem in one paragraph
Agreements (`orders`) and their event history (`deal_events`) hold foreign keys to organisations, enquiries, quotations and quotation versions with no delete action. Erasing an organisation, a buyer or a user who took part in an agreement is therefore refused by the database. Account deletion is also not a self-service feature today: a person files a "deletion" data request and staff handle it by hand (`privacy_requests`, 21-day due date). Production has no agreements yet. `pgTAP 13` pins the eight blocking keys so the issue is visible in CI.

## 2. What exists today (facts from the repository)
| Record | Holds | Today on erasure of one party |
|---|---|---|
| `enquiries` | the two organisation ids, topic | removed with either organisation (cascade) |
| `enquiry_messages` | body text, sender user and organisation; **no attachments** | removed with the enquiry; sender user id is set to null if the user is erased |
| `quotations`, `quotation_versions`, `quotation_line_items` | price, scope, items, booking terms; sent versions are immutable and can be removed only by cascade | removed with the enquiry |
| `orders` | reference, both organisation ids, snapshot of the accepted quotation (items, scope, total, booking terms), status, version | **blocks erasure** |
| `deal_events` | step history, acting organisation and user id, free-text note (delivery note, cancel note, issue reason and description) | **blocks erasure** (organisation, enquiry and order keys; the user id is a bare uuid with no key) |
| `audit_log` | action, actor, entity id, small details; no foreign keys | survives erasure by design |
| documents in sourcing (`p6_documents`) | attachments to sourcing requests, private bucket | separate workflow; not part of agreements |

An `orders` row is already a self-contained snapshot: the items, scope, total, terms and delivery text are copied into it, so it can be read without the quotation or the enquiry.

## 3. Proposed behaviour
1. **One party erased, the other remains.** The agreement is kept for the remaining party. The erased side is shown as "Former INOK member". Amounts, items, scope, accepted booking terms, status and the sequence of steps with times remain.
2. **Personal data of the erased side is removed or anonymised** (section 5).
3. **Both parties erased.** The agreement and its events are deleted immediately, unless a legal hold applies (section 8).
4. **Retention limit.** A kept agreement is deleted automatically after the retention period (to be decided, section 9).
5. **No silent partial erasure.** A deletion request is marked completed only when every item in the checklist (section 7) has succeeded. Otherwise it stays open with a note saying exactly what remains and why.

## 4. Data-model changes (additive, one migration, applied only after approval)
- `orders`: make `buyer_org_id`, `seller_org_id` nullable with `ON DELETE SET NULL`; make `enquiry_id`, `quotation_id`, `quote_version_id` nullable with `ON DELETE SET NULL` (the snapshot columns make them non-essential); do **not** add name-snapshot columns (a business name can identify a sole trader, so the erased side shows only "Former INOK member"); add `buyer_erased_at`, `seller_erased_at` timestamps; add `retain_until date` (set from the retention rule when the agreement completes or is cancelled, and tightened when a party is erased).
- `deal_events`: `enquiry_id` nullable with `ON DELETE SET NULL`; `order_id` stays `ON DELETE CASCADE`; `actor_org_id` `ON DELETE SET NULL`; `actor_user_id` becomes a real key to `auth.users` with `ON DELETE SET NULL` (today it is a bare uuid, which leaves an erased person's id behind); a `redacted boolean` flag.
- Free-text redaction: a function `private.redact_order_party(p_org uuid)` (SECURITY DEFINER, called from the erasure trigger) that, for events whose acting organisation is the erased one, replaces `note` with a fixed marker ("Removed at the author's request") and sets `redacted = true`. The structured fields (kind, time, status) are kept so the history still reads correctly.
- Trigger `BEFORE DELETE ON organisations` (and on user deletion for user-level links) calls the redaction and stamps `*_erased_at` before the foreign keys are cleared. Existing cascades for enquiries, messages and quotations stay as they are.
- New access rule (section 6). No change to payment or status logic; the order status machine is untouched.
- The migration is additive in effect (relaxes constraints, adds nullable columns and a function) and is covered by a rollback script like 000232/000233. It does not rewrite existing rows.

## 5. Personal data: remove, anonymise, keep
| Item | Treatment | Reason |
|---|---|---|
| Erased party's organisation name and profile | removed (organisation deleted); agreement shows "Former INOK member" | personal data of a sole trader or representative |
| User ids on events (`actor_user_id`) | set to null | no person left identifiable by id |
| Acting organisation on events | set to null; event shows "Former INOK member" | |
| Free-text notes written by the erased side (delivery note, cancel note, issue description) | replaced with the fixed marker | free text can contain names, phone numbers, addresses |
| Amounts, items, scope, accepted booking terms, dates, status, reference | **kept** for the remaining party | the agreed transaction record; business data; needed for the other party's accounts and any claim |
| Notes written by the **remaining** party | kept | its own data |
| Reason code of a reported issue (e.g. not delivered) | kept (no free text) | structured, not personal |
| Conversation messages (`enquiry_messages`) | deleted with the enquiry (unchanged) | personal communications; the agreement snapshot is sufficient for the record. Decision 3 below can change this |
| Notifications about the agreement | deleted with the user as today | |
| `audit_log` entries (entity id, actor, action) | kept unchanged | legitimate audit evidence; no free text; it already has no foreign keys. Whether the actor id there must also be pseudonymised is a legal question (decision 6) |

## 6. Access for the remaining party
Today the read rule on `orders` and `deal_events` is "member of the enquiry" (`private.is_enquiry_member(enquiry_id)`). After the enquiry is gone that rule would hide the agreement from everyone. Proposal: add a second read policy: a user can read an order when they are a member of `buyer_org_id` or `seller_org_id` (using the existing `private.is_member(org)` helper) and for its events through their order. Staff access stays through the report permission only (the existing read-only issues function). The remaining party keeps the screens it has today (agreement page, activity, booking terms); the missing counterparty is rendered as "Former INOK member", with no profile link and no contact actions. Status actions that need the other side (for example the buyer confirming delivery) are disabled once the other side is erased and the page says why; the remaining party can still cancel while "agreed" and can still read everything.

## 7. Administrative handling of a deletion request
1. The person files "deletion" in My account (exists). Status open, due in 21 days (exists).
2. A staff member with `privacy:handle` (exists; admin_super only today) opens the request in `/admin/privacy-requests` (exists).
3. **New:** the page shows a checklist computed by a read-only function for that user: organisations owned, agreements as buyer or seller (count, status), open issues, pending reports, verification documents held, whether the user is the last owner of an organisation.
4. **Blockers, shown in plain words:** an open or in-progress agreement, an open reported issue, or being the last owner with other members. The staff member either waits, asks the person to cancel or finish them, or records a legal-hold decision.
5. **Erase** (new, staff-confirmed with a typed confirmation): runs the erasure as one transaction (redact, detach, delete user and organisation), writes an audit entry, and reports the result of every step.
6. The request may be set to "completed" only if the erasure function returned success for every step (enforced in the database, not only in the screen). Otherwise "in progress" with the note, or "rejected" with the legal reason.
7. The person is told in writing what was removed and what was kept and why (agreement record kept for the other party for N years).
Email notification of the outcome depends on email being configured (it is not yet).

## 8. Legal hold and disputes
An agreement with an open reported issue, or one under a legal request, is not detached until the hold is released. The hold is recorded by staff with a reason (a short required text) and appears in the audit log. Holds have a review date.

## 9. Retention and eventual deletion
A scheduled job (the platform already runs a Worker cron every 2 minutes) deletes agreements whose `retain_until` has passed, together with their events. The proposed period in the Privacy Notice draft is **3 years** after completion or cancellation, aligned with the three-year marketplace record rule in P.U.(A) 449/2024 regulation 8 (verified against the official snippet only; counsel to confirm applicability to INOK). It is **not approved**. Backups keep deleted data until they expire (section 11 of the Privacy Notice draft proposes up to 90 days; not approved).

## 10. Automated tests (written with the migration, not before)
pgTAP (clean database):
- no foreign key of `orders` or `deal_events` blocks deleting an organisation or user (replaces the pinned exception in 13, E0f);
- erase the **buyer** organisation: seller still sees the agreement; buyer name absent; events kept; buyer's free-text notes redacted; seller's notes intact; amounts and terms unchanged; audit rows kept;
- erase the **seller**: mirror test;
- erase **both**: agreement and events gone;
- erase a **user** only (organisation stays): events keep, user id null;
- an unrelated agreement between other parties is untouched;
- a stranger still sees nothing (RLS); the remaining party can read through the new policy; a former member cannot;
- legal hold blocks the detach; release lets it proceed;
- retention job deletes only expired agreements;
- the data-request cannot be set to completed when a step failed.
End-to-end (Playwright, desktop and phone, three languages): a buyer and a seller complete a booking-terms agreement; the seller deletes through the staff flow; the buyer's agreement page shows "Former INOK member", terms intact, no seller contact; the seller's login no longer works; the buyer's other agreements are unaffected. Permission regression suites rerun.

## 11. Decisions needed (management and legal)
1. **Retention period** for a kept agreement (proposal 3 years; accounting records are often kept longer in Malaysia: counsel to say what applies to INOK, which holds no money today).
2. **What may lawfully be kept** after the erased side leaves: amounts, items, scope, terms, dates, status and the structured issue reason are proposed; confirm each.
3. **Conversation messages**: delete with the erased side (proposed, as today) or keep a redacted copy for the other party.
4. **Both parties erased:** delete at once (proposed) or hold for the retention period.
5. **Legal-hold authority:** who may place and release a hold, and the review interval.
6. **Audit log:** keep actor ids unchanged (proposed) or pseudonymise on erasure.
7. **Who may run an erasure:** admin_super only (as for data requests today) or a dedicated role; whether a second approver is required.
8. **Response times:** the 21-day system due date is an internal target mirroring the Act's access-request period; confirm what INOK promises for deletion requests.
9. **Remaining-party notice:** whether the other party is told that the counterparty account was closed.
10. **Wording** of the Privacy Notice and Terms once decided (the drafts already say deletion with agreements is not automatic).

## 12. Release plan (after decisions)
Own PR and migration, local clean-database verification, backup and verified restore, production approval separately, rollback script (re-add the dropped constraints is impossible once rows hold nulls, so rollback is "stop using the new policy and redeploy"; the data-level fallback is the pre-release backup). Not scheduled.

## 13. Copies outside the database (added 2026-11-20; part of the same unapproved proposal)
Erasure in the database does not reach every copy. For each, the proposal and what management must accept:
| Copy | Holds | Treatment proposed | Note |
|---|---|---|---|
| Resend (email provider, now live for Auth and notification mail) | recipient address, subject, delivery status | rely on the provider's own log retention (its pricing page lists 30 days); no INOK action | processor terms and location still to be confirmed; add to the Privacy Notice (done in the draft) |
| Supabase backups | the whole database as of the backup | deleted data persists until the backup expires; today only manual dumps exist (see `backup-options-2026-11-20.md`); if Pro daily backups are bought, the 7-day window applies | the Privacy Notice draft proposes up to 90 days for manual backups; not approved |
| Manual logical dumps (company machine) | personal data and password hashes | encrypt, keep two copies, destroy on the schedule | decide the schedule |
| Cloudflare logs | request metadata incl. IP | provider retention, outside INOK control | transfer assessment pending |
| Notification emails already sent | text of the notification (no names, prices or messages by design) | cannot be recalled | |
The erasure confirmation sent to the person must say that backups and provider logs expire on their own schedule.
