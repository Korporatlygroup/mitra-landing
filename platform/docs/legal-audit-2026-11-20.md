# Legal documents audit and management approval checklist (2026-11-20)

All six documents are in the application, in English and Bahasa Melayu, behind a visible **DRAFT banner** (`LEGAL_STATUS = 'draft'` in `src/lib/legal.ts`). Tamil shows the English text with a "translation pending" notice. Company details are visible placeholders. **Nothing here has been approved, and consent versions were not changed** (`CONSENT_VERSION = '2026-07'`, database `private.current_consent_version()` unchanged).

This is a drafting and consistency audit against the repository. It is not legal advice and it does not confirm that any statute applies to INOK.

## What changed in this branch (drafts only)
The drafts were written before agreements, booking terms and issue reports shipped. Updated in English and Malay, same structure in both (tested):
- **Terms of Service:** section 15 now describes booking terms (date, finish-by, deposit expectation as text, cancellation conditions), revisions, locked agreements and that an agreement is not a receipt or guarantee; new 15A (order progress and cancellation, no deposit handling, never "paid" or "protected"); new 24A (reporting an issue, INOK does not decide or move money); section 18 says deposit text is not a payment feature. New sections are numbered 15A and 24A so existing cross-references stay valid; renumber at finalisation.
- **Buyer, Seller and Supplier Policy:** obligations for honest booking terms, reading them before accepting, reporting issues honestly; INOK records agreements and shows issues to staff but does not decide.
- **Complaints and Community Standards:** how to report a problem with an agreement; states plainly that staff see issues in a read-only list and that there is **no** resolution workflow, refund or release function or automatic deadline yet.
- **Privacy Notice:** agreement and order data, purposes, who sees it, a proposed (unapproved) retention row, staff read-only issue list, and an honest statement that deletion where an agreement exists is not automatic yet and that we will not say data is deleted unless it is.
Not changed: Cookie Notice, Government Assistance Disclaimer (no new facts needed; see below). No company details, dates, approvals or retention periods were invented.

## Document by document
Legend: **Written** = confirmed against the code or the production site; **Unconfirmed** = statement not verifiable from the repository; **Proposal** = clearly marked in the text as for management approval.

### 1. Privacy Notice (16 sections)
- **Written and consistent with production:** data collected per feature; sharing table; hosting by Supabase in Tokyo (production region confirmed ap-northeast-1 by the Supabase backups endpoint) and Cloudflare; 10-character password rule; MFA for administrators; row-level security; quarantine of unscanned documents; no automatic backups on the current plan (confirmed: `pitr_enabled false`, no backups listed); email not active; 21-day target for data requests (system due date); the "Your data requests" screen and staff handling (`privacy_requests`, `/admin/privacy-requests`).
- **Missing company details:** company name, SSM number, registered address, privacy contact email, support contact, DPO contact, effective date, minimum age.
- **Unconfirmed:** transfer assessment for Japan, Cloudflare locations and supplier countries is stated as **not done**; processor agreements with Supabase and Cloudflare **not recorded**; "Circular 2/2025" on breach-record retention (I could not open it: the PDP pages I reached gave slides and a download, not text); the notice-language requirement (below); the claim that data portability exists: it is listed as a right, but there is **no export feature** in the product (requests are handled manually).
- **Proposed retention periods (all unapproved, already marked "proposed"):** account data deleted or anonymised within 30 days of verified closure; marketplace and supplier records 3 years; quotations and sourcing 3 years after last activity; messages 3 years after thread closes; verification documents 12 months after verification ends (decision record 3 years); security and audit logs 24 months; support and data requests 3 years; manual backups up to 90 days; agreements 3 years (new row). The platform does **not** currently delete anything on these schedules: no retention job exists.
- **Translation gaps:** Tamil missing (English shown with a notice). Malay exists and mirrors English; it needs review by a Malay-speaking lawyer.
- **Inconsistencies with production to resolve:** (a) the draft says "no email is sent until the email service is launched" but production **sign-up is open** and Supabase Auth would try to send a confirmation mail (see operational readiness); (b) the notice promises a data-portability right but no export exists; (c) section 9 says staging and production are separate: staging is not used any more, wording can be simplified.
- **Management approval:** all proposed retention periods; the transfer position; minimum age; DPO decision; whether to promise portability before it exists.
- **Malaysian legal review:** lawful-basis mapping against the Act; cross-border transfer wording; breach notification and DPO statements after the 2024 amendment; notice-language requirement; children and age; marketing consent wording.

### 2. Terms of Service (now 37 sections)
- **Written:** what INOK is (directory, messaging, quotations, sourcing; not a shop, payment or escrow service), eligibility, account security, buyer, seller, supplier and representative duties, verification limits, listings, quotations and agreements (updated), no payments, **no escrow** (section 19), no guaranteed results, prohibited conduct, complaints, suspension, liability and disclaimers.
- **Missing company details:** operator name, SSM, address, contact, governing court details if any, effective date.
- **Unconfirmed:** governing law and dispute forum text; limitation-of-liability wording; minimum age; the statement that INOK is "primarily" a platform (counsel to confirm the characterisation).
- **Proposal-type statements:** none numeric; the termination and appeal process depends on the complaints procedure.
- **Translation gaps:** Tamil missing; Malay to be reviewed.
- **Inconsistencies fixed here:** quotations/agreements/deposits/cancellation were not described; they now are. **Open:** the terms still say INOK "records the parties' agreement" - fine; they do not mention the staff-visible issue list (added in 24A).
- **Consent-version impact:** this is a material change to what users agree to (new sections). **Do not bump `CONSENT_VERSION` until management approves the text.** When approved, bump it together with `private.current_consent_version()` in a migration so existing users re-accept (the re-acceptance screen exists).

### 3. Marketplace Policy ("Buyer, Seller and Supplier Policy")
- **Written:** seller, buyer, supplier obligations; INOK's operator role; a section on the Consumer Protection (Electronic Trade Transaction) Regulations 2024 (P.U.(A) 449) with the disclosure list.
- **Official source check:** the official AGC Laws of Malaysia listing returns **P.U.(A) 449/2024** and its text for regulation 8(1) (an online marketplace operator keeps supplier records for three years). I could not download the full regulation PDF in my browser session, so the rest of section 6 (disclosure list, in-force date 25 December 2024, complaint channel duty) was **not re-verified here** and must be checked by counsel against the gazetted text.
- **Missing company details:** operator name and SSM (placeholders).
- **Unconfirmed:** whether the Regulations apply to INOK (business-to-business, no payments, no completed orders). The draft already says this is a legal question. The audit of seller fields against the disclosure list is referenced as being "in the compliance documents": confirm it exists and is current.
- **Proposals:** three-year supplier-record retention (matches regulation 8 if it applies).
- **Translation gaps:** Tamil missing.
- **Management approval / legal review:** applicability; whether INOK is a "marketplace operator"; whether the seller disclosure fields must be mandatory before listings go live (today they are partly optional).

### 4. Complaints Policy
- **Written:** what can be reported, how (Report button on listing, product, review, request; data requests; email for everything else), what happens next, limits of INOK, community standards, suspension and appeal, escalation (KPDN, Tribunal for Consumer Claims, bank, police, PDP Commissioner). New: agreement issue reports.
- **Missing:** support and privacy email addresses (placeholders) - **the only route for fraud and disputes is email to an address that does not exist yet**.
- **Unconfirmed / proposal:** acknowledgement within 3 working days and reply within 14 days are **proposals** in a management note; no code enforces them. Reports have no assignee, due date or evidence attachment (`content_reports` has status, handler and note only). Issue reports on agreements have no resolution workflow.
- **Translation gaps:** Tamil missing.
- **Management approval:** the targets, who handles each category, escalation chain, evidence handling (what may be uploaded: nothing today).

### 5. Cookie Notice
- **Written and verified:** only the language cookie `NEXT_LOCALE` is set for visitors (checked on production headers 2026-11-20); sign-in cookies after login; no analytics or advertising. The text says the list was checked "on the live staging site": update the wording to production.
- **Missing:** contact email and operator placeholders.
- **Translation gaps:** Tamil missing. **Legal review:** whether a consent banner is needed (none for essential cookies is the draft's position).

### 6. Government Assistance Disclaimer
- **Written:** programmes are information from official sources, not advice or approval; each programme shows its source. No change needed for agreements. **Missing:** operator placeholders. **Translation:** Tamil missing. **Legal review:** wording about not being a government service and about eligibility statements.

## Standing legal points to put to counsel (not verified by me)
1. **Notice language:** my recollection is that the PDPA requires the personal-data notice in the national and English languages. I did not verify this from the official text in this session. If so, Malay + English satisfy it and Tamil is optional.
2. **Which obligations apply now:** data controller registration, DPO appointment, breach notification (to the Commissioner and to affected people) and portability were introduced or changed by the 2024 amendment. The PDP Department's pages I reached point to a DPO guide, a breach-notification (DBN) reporting channel and a circular on appointments and breach notification, but I could read only slides, so applicability and deadlines were not confirmed.
3. **Cross-border transfers** (Japan, Cloudflare, India): the transfer assessment is not done.
4. **Marketplace Regulations** applicability (above).
5. **Online marketplace and Companies/SSM details** to publish on the site (company name, SSM number, address) are required to publish truthful operator information; I did not invent them.

## Sources used (official or primary)
- PDP Department homepage and Act 709 reprint page: https://www.pdp.gov.my/ and https://www.pdp.gov.my/akta/akta-perlindungan-data-peribadi-2010-akta-709-cetakan-semula/ (reached; PDFs/slides not read in full).
- PDP DPO guide and breach-notification (DBN) pages, circular slides (reached; image content only).
- AGC Laws of Malaysia listing for P.U.(A) 449/2024 (search result snippet for regulation 8(1)); KPDN repository copy of the gazette.
- Supabase documentation on backups and SMTP (read in full): https://supabase.com/docs/guides/platform/backups and https://supabase.com/docs/guides/auth/auth-smtp.

## Management approval checklist (one page)
Tick each before changing `LEGAL_STATUS` to approved.
- [ ] Registered company name, SSM number, registered address (and trading name if different)
- [ ] Privacy contact email, support contact email, complaints contact, and (if required) DPO name and contact
- [ ] Effective date and "last updated" date
- [ ] Minimum account age
- [ ] Retention schedule (every row in Privacy section 10) approved or amended
- [ ] Decision on data-portability promise (build an export or soften the wording)
- [ ] Cross-border transfer assessment completed; processor terms with Supabase and Cloudflare recorded
- [ ] Complaint acknowledgement and reply targets; who handles each type; escalation chain; evidence handling
- [ ] Agreement-erasure policy (Option C details: `erasure-option-c-proposal.md` section 11)
- [ ] Whether Tamil legal texts are required, and who translates them
- [ ] Malay texts reviewed by a Malay-speaking lawyer
- [ ] Malaysian lawyer's review of all six documents (including marketplace regulations applicability)
- [ ] Decision to approve: then set `LEGAL_STATUS = 'approved'`, fill `OPERATOR`, bump `CONSENT_VERSION` and `private.current_consent_version()` together (users re-accept), and release with a normal approval
