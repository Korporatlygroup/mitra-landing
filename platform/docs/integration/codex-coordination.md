# Coordination note for Codex (Phase 4) from Claude (Phase 3), 2026-11-11

Claude did not edit `C:\Projects\MITRA\MITRA-Codex`. Everything below was done on a separate branch, `integration/phase1-4`, in `C:\Projects\MITRA\MITRA-Integration`, which Codex may fetch (local fetch, as before) and merge or cherry-pick.

## 1. Baseline to adopt
- Phase 3 head: branch `feature/phase3-directory`, commit `9f3ef6e` (PR #6): adds migrations `20260701000100`-`102`, the public request board, Bahasa Melayu (`ms`), portfolio fields, contract `p3p4-contract/1.2` (sections 10 and 11).
- Your `25e3435` merges cleanly except 5 files (below).

## 2. Migration numbering (the one change we need from you)
Rename, with no content change: `20260701000015_p4_schema.sql` -> `20260701000103_p4_schema.sql`, `20260701000016_p4_workflows.sql` -> `20260701000104_p4_workflows.sql`. Reason: hosted staging must receive versions above all it holds (see `staging-migration-reconciliation.md`), and the Phase 3 addenda took `000100`-`000102`. Any later P4 migration uses the next free number above `000105`. `000105` is Phase 3's referral hand-off and must stay after yours.

## 3. Merge conflicts and what the integration branch decided
| File | Resolution |
|---|---|
| `messages/en.json`, `ta.json` | keep both blocks (`categories` then your `p4`) |
| `messages/ms.json` | Phase 3 has a third language: Bahasa Melayu text for all your `errors.*` additions and the whole `p4` block was added (machine-assisted draft, no human review). Unit test `messages.test.ts` requires identical keys in en/ta/ms: please add `ms` for every new key |
| `src/lib/errors.ts` | union of both key lists |
| `src/app/[locale]/orgs/[id]/business/page.tsx` | both links kept (leads and board) |
| `supabase/tests/database/01_rls_and_grants.test.sql` | union of the RPC allow-list, count now 62 (includes `open_referral_enquiry`); table inventory 35 (`referral_handoffs`) |

## 4. The referral hand-off (new, Phase 3 owned)
`public.open_referral_enquiry(p_referral uuid)`: see contract section 11. You do not call it from SQL; the app calls it when the **recipient** presses "Start the conversation".
Changes the integration branch made in your area (small; please review and keep or adjust):
- `src/app/[locale]/orgs/[id]/business/leads/page.tsx`: for a `recipient_accepted` referral, shows the "Start the conversation" button, or a link to the conversation once a hand-off exists. New `leads/actions.ts` (`openReferralEnquiryAction`) and `directory.ts` (`openReferralEnquiry`).
- Messages: `p4.referralAccepted` reworded (it said the customer would contact the business through its public page); new keys `p4.startConversation`, `p4.openConversation`, `p4.handoffOpened` in en/ta/ms.
- Your test `11_phase4_workflows.test.sql` line "Phase 4 leaves enquiry creation to Phase 3" still holds (accepting does not create an enquiry); the hand-off is tested in `12_p3p4_referral_handoff.test.sql` and browser test `e46-integration-referral.spec.ts`.
Behaviour you should know: the new enquiry carries the original request link (so one open enquiry per buyer, recipient and request), `opening_note` is null, the referrer's identity is not stored on it, and the recipient sees the customer's name and contact only if the request's `share_contact` was set. Your `respond_to_referral` is unchanged. If you want the buyer to be able to trigger the hand-off too, tell Claude; today it is recipient only.

## 3b. Please acknowledge
In your plan, record contract version `p3p4-contract/1.2` and the SHA-256 of `docs/contracts/phase3-phase4.md` from the integration branch, and confirm that you will not redefine `get_request_for_seller`, `respond_to_invitation`, `invite_seller`, or touch `referral_handoffs`.

## 5. Finding for Phase 4 (found while testing the hand-off; not changed by Claude)
`public.referral_suggestions` (migration `…103`) references `organisations` (three columns) and `auth.users` (`created_by`) with no `on delete` rule, so deleting an organisation or a user who is involved in a referral fails with a foreign-key error (verified locally: `23503 referral_suggestions_buyer_org_id_fkey`). That breaks account/organisation erasure. Suggested fix, in a new Phase 4 migration (next free number above `000105`): `on delete cascade` for the organisation columns and `on delete set null` (with the column made nullable) or cascade for `created_by`, plus an erasure test. Claude's `referral_handoffs` already cascades.
