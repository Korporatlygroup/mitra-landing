# What management must provide before the legal pages can be published

All six policies are drafts in `src/content/legal`. Operator details are placeholders defined once in `src/lib/legal.ts` (`OPERATOR`). To publish: fill them in, have the text reviewed by a Malaysian lawyer, then set `LEGAL_STATUS` to `'approved'` (this removes the draft banner and noindex). If the approved text changes what users agree to, bump the consent version together in `src/lib/consent.ts` and a migration changing `private.current_consent_version()`, so existing users are asked to accept again.

## Facts only management has
| # | Item | Where it appears |
|---|---|---|
| 1 | Registered company name of the operating entity | every document |
| 2 | SSM registration number | Terms, Privacy, Marketplace, Cookies |
| 3 | Registered business address | Terms, Privacy |
| 4 | Privacy contact email | Privacy, Cookies, Complaints |
| 5 | Customer support contact | Terms, Complaints, Government notice |
| 6 | Data Protection Officer contact (if one is appointed) | Privacy |
| 7 | Effective date | every document |

## Decisions
| # | Decision | Draft position |
|---|---|---|
| 8 | Retention periods (privacy section 10) | Proposed values with reasons; confirm or change |
| 9 | Minimum account age | Draft says 18 |
| 10 | Complaints procedure: inbox, acknowledgement and reply times | 3 working days and 14 days proposed |
| 11 | Time limit for answering data requests | 21 days proposed |
| 12 | Limit of INOK's liability to business users; dispute clause (mediation or arbitration); governing law confirmation | Bracketed in Terms 31 to 33 |
| 13 | Whether the e-trade Regulations apply, and the disclosure fields to add | See `supplier-disclosure-audit.md` |
| 14 | Cross-border transfer assessment; processor agreements with Supabase and Cloudflare; stay in Tokyo or recreate in Singapore | Draft states the assessment is not done |
| 15 | Whether to appoint a DPO before launch | Mandatory only above the Circular's thresholds; recommended anyway |
| 16 | Classification opinion on registering as a data controller | Probably not a named class; get counsel's opinion |
| 17 | Session cookie lifetime (library default 400 days) | Shorten if preferred |
| 18 | Approval of the Government Assistance Notice | Draft |
| 19 | Native-speaker review of Bahasa Melayu text and a Tamil translation (currently English shown with a notice) | Pending |
| 20 | Incident roles and who files with the Commissioner | See `incident-response.md` |
| 21 | Whether landing page links go live and when | Prepared, not changed |
