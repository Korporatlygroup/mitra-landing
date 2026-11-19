# Payment boundary: what exists, what does not, and how a provider will plug in

Status 2026-11-19: **no payment provider is connected and no payment is processed.** Fiuu and Tazapay are being investigated only. There is no API contract, no pricing and no regulatory arrangement. Nothing in the code or the database can mark anything paid, secured, refunded or released.

## What exists now (deals, migration 000231)
- `orders`: one agreement per enquiry, created automatically when the buyer accepts a quotation. It copies the exact accepted version (items, total, currency, delivery, terms). Statuses: `agreed`, `in_progress`, `buyer_confirmation_pending`, `completed`, `cancelled`, `disputed`. There is deliberately **no** payment status.
- `deal_events`: append-only history shown in the conversation (quotation sent, changes requested, accepted, declined, withdrawn, order created and order steps).
- `public.order_action` and `public.set_order_details` are the only ways an order changes. Participants only; fixed transitions; no direct table writes, so the agreed amount cannot be altered by either side.
- Accepting a quotation is an agreement, not a payment. The order page says so, and that INOK holds no money.

## What a provider adapter will add later (not built)
Interface sketch: `src/server/payments/provider.ts` (types only, imported by nothing).
1. Buyer chooses protected payment on an order that is `agreed`.
2. INOK creates one provider transaction (idempotency key = order id; amount and currency read from `orders`, never from the browser).
3. The buyer pays on the provider's hosted page. A browser redirect is never proof of payment.
4. Provider webhook (signature verified, replay-safe) moves a new `order_payments` record to `secured`; INOK reconciles with the provider's status API.
5. Seller delivers. Buyer confirms or disputes; the provider releases, refunds or holds funds under its own terms.
6. INOK shows the provider's resulting status. Every change is appended to a transaction event history.
Fields to add only once confirmed with the provider: provider reference, status, checkout URL, amount and currency, release, refund and dispute status. No provider-specific field is added now.

## Fees (proposal only, not approved)
Management is considering about 1% per completed transaction. **No fee is applied or stored.** A future fee model should support percentage and fixed platform fees, provider fees shown separately, allocation between buyer and seller, and reversal on refund. Before building, confirm with each provider: automatic commission split, platform payouts, separate provider charges, refunds that involve platform fees, MYR support and marketplace onboarding.

## Services and advance bookings
The order records a booking date and a deposit note (text only, arranged between the parties). Escrow, when it exists, protects the payment; it does not guarantee that a provider will attend. The order page says the agreement does not guarantee delivery or attendance. Completion evidence is the seller's note when marking delivered; disputes are reported by the buyer and shown in the history.

## Not done, on purpose
Checkout, holding funds, settlement, automatic release, refunds, WhatsApp or SMS notifications, a provider SDK, any storage of card data.
