# Ten-business simulation (local, synthetic): results 2026-11-23

Ten fictional Malaysian businesses used the platform through the real user interface on an **isolated local copy** (clean database, production build). Nothing here touched production, staging or any real person. Names, owners and emails (`example.test`) are invented. Spec: `tests/e2e/sim-ten-businesses.spec.ts` (opt-in: `SIM=1`). Run on a 1280 px desktop and a 360 px phone, each from a freshly reset database.

## The ten businesses
| # | Business | Role | Language used to sign up |
|---|---|---|---|
| B1 | Kedai Katering Lestari (Shah Alam) | seller | Bahasa Melayu |
| B2 | Ahmad Cetak Digital (Kuala Lumpur) | seller | English |
| B3 | Mohan Tailoring and Textiles (Penang) | seller | Tamil |
| B4 | Siti Dekorasi Majlis (Johor Bahru) | seller | Bahasa Melayu |
| B5 | Sri Murugan Sweets and Snacks (Ipoh) | seller | Tamil |
| B6 | Wei Packaging Supplies (Klang) | both: sells packaging, buys flyers | English |
| B7 | Priya Boutique (Subang Jaya) | buyer | English |
| B8 | Kumar Cafe and Bistro (Brickfields) | buyer | English |
| B9 | Fatimah Online Store (Kajang) | buyer | Bahasa Melayu |
| B10 | Raju Logistics Services (Petaling Jaya) | both: sells delivery, buys banners | English |

## What they did (all through the UI, all passed on desktop and phone)
1. **Registration:** all ten signed up (three languages), confirmed by email link, created their organisation. Database check: exactly the two required consents recorded for each of the ten (20 rows), **no marketing consent for anyone**.
2. **Onboarding:** the seven sellers used the three-step quick start (name and category, state and town, one line plus description plus service plus WhatsApp). Each was left **waiting for review, not published**.
3. **Staff review:** an INOK administrator approved the seven listings (second-factor sign-in); seven went live. A visitor then found each by name in the directory, and a buyer business (Priya Boutique) was **not** listed as a business.
4. **Seven conversations, each ending differently:**
   - T1 Kumar Cafe to Katering Lestari: enquiry, reply, quotation with booking terms, **buyer asks for changes, seller sends version 2** (new date, deposit text, cancellation option), buyer accepts, seller starts, seller marks delivered with a note, buyer confirms: **completed**, RM720.
   - T2 Priya Boutique to Mohan Tailoring: accepted, work started, **buyer reports "not delivered"**: status "Issue reported", RM1,020.
   - T3 Fatimah Online Store to Wei Packaging (Malay message): accepted, then **cancelled by the buyer before work started**, RM360.
   - T4 Wei Packaging (as buyer) to Ahmad Cetak: quotation **declined**.
   - T5 Raju Logistics (as buyer) to Ahmad Cetak: conversation only, no quotation.
   - T6 Kumar Cafe to Sri Murugan Sweets: complete, RM1,250.
   - T7 Priya Boutique to Siti Dekorasi: complete, RM900.
5. **What each buyer saw before accepting:** the booking terms (date, deposit expectation, cancellation) on the quotation card; accepted terms were **locked** on all five agreements.
6. **Staff and notifications:** the administrator's read-only issues list shows exactly the one reported issue (Priya Boutique), with no refund, paid or escrow wording; only the affected seller (Mohan) got the issue notification.
7. **Privacy:** other buyers, other sellers and a visitor could not open conversations or agreements that were not theirs (404 or redirect to login).
8. **Each business's own pages** (Home, My deals, orders, notifications) loaded in its own language with no untranslated keys and no sideways scroll.
9. **Totals and states** match the story: RM360 cancelled, RM720 completed, RM900 completed, RM1,020 issue reported, RM1,250 completed. **No order was ever marked paid, secured or refunded.**
Database after the run (desktop): 10 users, 7 business and 5 buyer organisations, 7 published listings, 7 enquiries, 7 quotation versions, 5 agreements, 57 notifications.

## Other parts of the platform run on the same database (existing journeys, desktop, 26 of 26 passed)
Request board (buyer posts a request, seller replies), moderation and reports; product catalogue (search, compare, save, request a price); Government Assistance (browse, answer questions, explained match, save, tracking, admin review and publish, reminders, Tamil and Malay pages); supplier sourcing journey in English, Tamil and Malay; server-side authorization suite.

## Limits (be honest when quoting this)
- Synthetic people on a local copy: it shows the **software works end to end**, not that real businesses will use it or like it. No real user has tested it.
- Production was not used; signed-in production flows remain unverified.
- Email in this run was a local mail catcher; **delivery to a real inbox in production is still unproven.**
- Not simulated: payments and escrow (not built), real documents with a malware scanner, volume and load.
