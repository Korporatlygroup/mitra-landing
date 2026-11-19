# Erasure of agreements (orders): options and decision needed

Status: **open, no policy decided, no migration proposed for production.** Written 2026-11-19.

## The problem
Agreements (`orders`) and their events (`deal_events`), added in migration 000231, reference organisations, enquiries, quotations and quotation versions with
`NO ACTION`. Every other conversation record (enquiry, messages, quotations, reviews) is removed when an organisation is erased (000106). So today:
erasing an organisation, buyer, enquiry or user that took part in an agreement is **blocked by the database**. Production has no agreements yet, so nothing is stuck.
`13_p4_erasure` E0 detects this; until the policy is decided E0 excludes exactly these eight foreign keys and E0f pins them, so the exception is visible and
any change to it fails the test.

What an agreement holds: reference, amounts, items, scope, accepted terms (all copied snapshots, so the row is already readable without the quotation), the two
organisation ids, status and an event history with free-text notes (for example an "issue reported" note) and acting user ids. The audit log has no foreign keys
and already survives erasure.

## Options

| | A. Cascade (delete the agreement) | B. Keep blocking | C. Detach and keep (anonymise the erased side) | D. Tombstone the organisation |
|---|---|---|---|---|
| What happens when one party is erased | the agreement and events vanish for both | erasure is refused while agreements exist | the agreement stays for the other party; the erased side becomes "Former member"; its personal data and free text are removed | the organisation row stays as an anonymised stub; its profile, members and contact data are removed |
| Other party's records | **lost** (rejected: you do not want this) | kept | kept (amounts, scope, accepted terms, status, history) | kept |
| Privacy (PDPA erasure) | full | **not met** (data subject cannot be erased) | met for personal data; the retained record is business data needed for the other party's accounts and any claim | met for personal data; a stub with an id remains |
| Audit evidence | audit_log survives, the record it points to does not | intact | audit_log survives and the record it points to survives | intact |
| Schema change | foreign keys to CASCADE (small) | none | order and event organisation links nullable (SET NULL), a "former member" marker, new access rule for the remaining party (today access follows the enquiry, which is deleted), redaction of the erased party's notes | an erasure routine instead of a plain delete (a delete trigger or a service function); directory and search must hide stubs |
| Risk | data loss for a legitimate party | stuck erasure requests, legal exposure | RLS and screens must handle "the other side no longer exists"; more tests | stubs are entities that every query must remember to exclude |
| Effort | small | none | medium | medium |

## Recommendation (for your decision)
**Option C**, with a retention limit:
1. When an organisation is erased, its agreements are **kept for the other party** with the erased side shown as "Former INOK member". Amounts, items, scope,
   accepted terms, status and the event history stay, because they are the other party's record of what was agreed.
2. Personal data of the erased side is removed: organisation and user links are cleared; free-text notes written by the erased side in events are replaced by
   "Removed at the author's request"; the conversation (messages) is deleted as it is today.
3. Access for the remaining party is by its own organisation (a new additive read rule), no longer through the deleted enquiry.
4. The agreement itself is deleted after a **retention period** (to be fixed; accounting records are commonly kept for seven years in Malaysia, but INOK holds no
   money yet, so a shorter period may be justified). This needs your or legal advice; the number is not chosen here.
5. The audit log keeps its entries unchanged.
When **both** parties are erased, the agreement is deleted at once (nobody remains with a legitimate interest) unless a retention rule says otherwise.

Option D is the alternative if you prefer not to change how agreements are read; it keeps the conversation and needs stub filtering everywhere. Option A is not
recommended. Option B is not compatible with the erasure rule.

## Decisions needed from you
1. Option C (recommended), D, or another approach.
2. The retention period for a kept agreement.
3. Whether the other party keeps the conversation messages (default: no, messages are deleted with the erased side as today).

Nothing is implemented for production until these are decided. A parked prototype of option A exists only on a local branch and is not proposed.
