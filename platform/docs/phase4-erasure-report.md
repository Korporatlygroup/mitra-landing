# Phase 4 account-erasure fix (local review)

Base: PR #7 `integration/phase1-4` at `e0781e2302172f8b356dbe74f4543a33d203a75a`. Branch: `codex/phase4-erasure-fix` in `C:\Projects\MITRA\MITRA-Erasure-Fix`. Migration `20260701000106_phase4_erasure.sql` uses the number reserved by `p5p6-contract/0.2`; migration 105 and the Phase 5 range are untouched. No hosted database was changed or reset.

## Root cause and change

Phase 4's direct foreign keys from referrals, messages, quotations, leads and reviews to organizations and users had default `NO ACTION`. Deleting a participating organization or author failed with `23503`. Referral handoffs also kept an unrestricted `opened_by` UUID. Migration 106 changes owned organization references to `ON DELETE CASCADE` and nullable author references to `ON DELETE SET NULL`; the handoff opener gains a nullable FK. A surviving conversation keeps its commercial record but no deleted author ID.

Phase 3 requests/enquiries and Phase 2/3 event tables had author UUIDs without deletion rules. Migration 106 nulls those IDs on user deletion. Narrow exceptions to the append-only guards permit only erasure redaction of the actor/org and details; event type, time and identity stay fixed. Normal direct UPDATE/DELETE and quote-version mutation remain forbidden. Sent quote versions and lines may cascade only after their parent quotation or version is already gone. Deleted user/org UUIDs and email occurrences are removed from matching audit details, retaining action/time/source; string matching treats email punctuation literally.

## Evidence

| Check | Result |
|---|---:|
| New migration applied to isolated 56522 stack | Pass |
| New migration applied during fresh 56622 stack startup | Pass |
| Database/RLS suite on 56622 | 1,062/1,062 pass, 12 files |
| Integration suite on 56622 | 120/120 pass, 15 files |
| Unit suite | 301/301 pass, 20 files |
| Typecheck | Pass |
| New synthetic erasure cases | 3/3 pass |

The new cases delete participating users and all three organization roles. They cover accepted referrals, opened recipient enquiries, a sent quotation version and line item, private messages, lead notes, review authors, cross-organization audit references, append-only event redaction, literal email matching, and a linked verification claim/document. RLS checks show the buyer colleague can read the surviving authorized enquiry, an outsider cannot, and neither can read it after the recipient organization is removed.

Independent read-only review found the initial event and sent-quote deletion blockers; both were reproduced and fixed. The reviewer found no new critical authorization bypass in the revised migration. A final implementation review should include the exact final SQL diff before integration.

## Remaining operational dependency

Database cascades do **not** delete private Storage objects. A real organization-erasure workflow must enumerate its `verification_documents.storage_path` values, delete the objects through the authorized Storage API with a retryable checkpoint, verify absence, then delete the organization row. The database regression uses synthetic metadata only and does not claim Storage cleanup. Phase 5 supplier media needs the same coordinated policy. Until that workflow exists, an operator must not treat SQL deletion alone as complete erasure.
