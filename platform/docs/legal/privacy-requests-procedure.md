# Handling privacy requests (access, correction, deletion, portability, consent withdrawal, complaint)

Status: draft procedure for management approval. The in-app workflow exists (migration 225; staging only so far); the steps that touch data are manual and need a named person with the `privacy:handle` permission (admin_super, MFA).

## Intake
- Signed-in users: My account, "Your data requests". It records type, details and a due date 21 days out (the period is a proposal; confirm the statutory period with counsel). Others: email the privacy contact, then a staff member records it on their behalf.
- The queue is at `/admin/privacy-requests` (overdue items flagged). Every submit and close is in the audit log.

## Steps
1. **Verify identity.** The request must come from the signed-in account or from the account's email address. Do not accept identity-card images. For a request from outside the account, reply to the account email and ask the user to confirm from there.
2. **Mark in progress** with a short note.
3. **Access / portability:** export the person's rows (profile, consents, memberships, enquiries and messages they wrote, quotations, sourcing records, saved programmes, requests, audit entries where they are the actor) with a read-only query run by two people; send by the account email as a password-protected file, or a secure link. Remove other people's personal data from the export. Portability uses a common machine-readable format (JSON or CSV).
4. **Correction:** fix the profile fields the user cannot edit, or ask them to edit in My account. Verification evidence is corrected by a new upload, not by editing.
5. **Consent withdrawal:** marketing is withdrawn by the user in My account (or on their behalf via `set_marketing_consent`); the withdrawal is audited.
6. **Deletion:** check what must be kept (supplier records 3 years, records needed for an open dispute or investigation, audit entries). Delete the Auth user only when nothing blocks it: the database anonymises audit and history rows (migrations 106/107, tested in pgTAP 13 and 31). Delete storage objects of verification documents separately (queued cleanup). Backups age out under the 90-day rule. Tell the user what was kept and why.
7. **Complaint:** acknowledge, investigate, answer in writing; refer them to the Personal Data Protection Commissioner if unresolved.
8. **Close** with a written answer in the system. A refusal states the lawful reason.

## Targets and records
Acknowledge in 3 working days; answer within 21 days. The request, the answer and the audit rows are kept 3 years after closure. Overdue items are reviewed weekly by the DPO or privacy owner.

## Not built
Automated export and automated erasure; scheduled retention deletion; an email notice when a request changes status (email is not live).
