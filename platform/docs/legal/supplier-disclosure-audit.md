# Seller and supplier fields against the Consumer Protection (Electronic Trade Transaction) Regulations 2024 (2026-11-16)

Source: P.U.(A) 449, Schedule to regulation 3 (Gazette text read), regulations 7 and 8. Whether the Regulations apply to INOK's business-to-business directory is for counsel (applicability matrix, row 11). Until then this audit treats the Schedule as the standard sellers should meet.

| # | Required disclosure | Where INOK holds it | Public or buyer-visible? | Gap |
|---|---|---|---|---|
| 1 | Supplier or company name | `live_name`, `business_profiles.business_name` | Yes | None |
| 2 | Marketplace website address | INOK itself | Yes | Operator details are placeholders until management supplies them |
| 3 | Email and telephone | `business_private.contact_*` (private); `live_phone`, `live_email` only if the seller opts in | Only if the seller opts in | Gap: default hidden |
| 4 | Address of the place of trade | `business_private.address_line`, `postcode` (private); state and district public | State and district only | Gap: full address not public (sole-proprietor home address conflict) |
| 5 | Main features | `live_description`, `biz_products.description` | Yes | None |
| 6 | Full price including delivery, tax, other costs | `biz_products.price_cents` or "ask for a quote"; quotations carry `delivery_fee`, `tax_treatment`, total | Product price yes; delivery and tax only in a quotation | Gap on product pages |
| 7 | Payment methods | Not stored | No | Gap: no field |
| 8 | Terms of sale and purchase | Quotation `terms` | Only in a quotation | Gap on listings and products |
| 9 | Estimated delivery time | Quotation `delivery_timing`; sourcing `lead_days` | Only in a quotation | Gap on product pages |
| 10 | Health and safety standard declaration | Not stored | No | Gap: no field |

## Operator records (regulation 8, three years)
Held: name, address, telephone, email, SSM number and business name, transaction and advertisement records. **Not held: ID card or passport number, business account number** (deliberately not collected). Three-year retention is proposed in the Privacy Notice; no job enforces it and none is needed until three years of data exist.

## Status
**Not implemented:** the missing disclosure fields and the ID and bank-account record fields. They touch the publishing workflow, public views, review queue and every locale, and the scope depends on counsel's answer; collecting identity numbers without that answer works against data minimisation. **Implemented:** the Marketplace Policy (section 6) tells sellers which disclosures are expected; the complaint channel (regulation 7(1)(b)) is the in-app report buttons plus a complaint email placeholder.

Proposed design once management decides: table `business_trade_disclosures(org_id, payment_methods text[], delivery_and_charges text, sale_terms text, safety_standard_note text, show_business_address boolean)`, edited by owners and managers, shown on the published listing, plus a reviewer checklist item "disclosures present" (regulation 7(1)(a)).

## Decisions
1. Do the Regulations apply to INOK's directory and sourcing tools?
2. Publish a business address or disclose on request? Collect ID or bank-account numbers, or document why not?
3. Approve the disclosure fields and the checklist item.
