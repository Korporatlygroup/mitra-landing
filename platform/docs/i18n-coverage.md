# Language coverage: English, Tamil, Bahasa Melayu

Status on 2026-11-10 (local verification only).

| | English (en) | Tamil (ta) | Bahasa Melayu (ms) |
|---|---|---|---|
| Message keys | 935 | 935 | 935 (identical key set, checked by a unit test) |
| Source | written by the team | machine-assisted first draft | machine-assisted first draft |
| Fluent human review | not needed | **not done** | **not done** |
| Language switcher | yes | yes | yes (EN, TA, BM) |
| Saved to the account | yes | yes | yes (migration `20260701000101`: profiles accept `ms`) |
| Category names | database | database | `messages/ms.json` `categories.*` (helper `src/lib/category.ts`) |
| Invitation and decision emails | yes | yes | yes (all three languages in one email) |

What the unit tests check: same keys, no empty values, `{placeholders}` identical, no Tamil script inside Bahasa Melayu text, Bahasa Melayu not copied from English, and a wording lint that bans guarantee, official-check and "verified by SSM or the government" claims in all three languages (the Bahasa Melayu list is `dijamin`, `terjamin`, `jaminan`, `disahkan oleh ssm`, `disahkan kerajaan`, `pengesahan rasmi` and similar).

What the browser tests cover in Bahasa Melayu (`e44-bahasa-melayu.spec.ts`, plus `ms` in the loops of E1 sign-up/login and E28 accessibility): language switching and persistence, sign-up and login, a login error message, account language change, public directory and no-result help, request wizard, my requests, seller overview, listing editor, request inbox and board, admin listings and reports queues. All run at 360px and 1280px with axe (serious and critical = fail) and a no-sideways-scroll check. E43 and E45 add Tamil and Bahasa Melayu passes through the board and the listing editor.

Terminology choices for Malaysian small businesses (for the reviewer to confirm): "permintaan" for request, "perniagaan" for business, "halaman awam" for public page, "semakan/disemak" for review/reviewed (never "disahkan", to avoid implying an official check), "pentadbir" for administrator, "kuantiti", "bajet", "tetamu".

Not claimed: no native-speaker or professional translator has read the Tamil or Bahasa Melayu text. `_meta` in each file says so. Both languages must be reviewed before public launch, especially legal pages (still placeholders in all languages), error messages and the reviewer-facing admin text.

Known gaps: the Astro landing page at the repository root is unchanged and has no Bahasa Melayu version. Legal pages are placeholder text in every language.
