/**
 * Payment-provider boundary (NOT CONNECTED). No provider (Fiuu, Tazapay or another) has been approved: there is no API contract,
 * pricing or regulatory arrangement. This file only fixes the shape that a future adapter must satisfy, so messaging and orders
 * never need to change. See docs/payment-boundary.md. Nothing imports this module yet and no payment is ever created.
 *
 * Rules every adapter must follow:
 *  - the provider holds the funds; INOK never stores card details or holds money;
 *  - a payment is "secured", "released" or "refunded" ONLY after a verified provider webhook (signature checked, replay-safe),
 *    never because of a browser redirect, and always reconciled with the provider;
 *  - the amount and currency come from the accepted order (orders.total, orders.currency), never from the browser;
 *  - at most one open transaction per order (idempotency key = order id);
 *  - every change is appended to a transaction event history.
 */
export type PaymentStatus = 'not_started' | 'pending' | 'secured' | 'released' | 'refunded' | 'disputed' | 'failed' | 'cancelled';

export interface PaymentTransaction {
  orderId: string;
  providerReference: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  checkoutUrl: string | null;
}

export interface ProviderEvent {
  providerEventId: string;
  providerReference: string;
  status: PaymentStatus;
  occurredAt: string;
}

export interface PaymentProvider {
  /** Creates the provider transaction for an order and returns where the buyer completes checkout (provider-hosted). */
  createTransaction(input: { orderId: string; amount: string; currency: string; idempotencyKey: string }): Promise<PaymentTransaction>;
  /** Verifies the signature of a webhook body and returns the event, or throws. Must not trust any other input. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<ProviderEvent>;
  /** Reads the authoritative status from the provider, for reconciliation. */
  fetchStatus(providerReference: string): Promise<PaymentStatus>;
}

/** Fee model placeholder: nothing is charged. Values are decided only after provider confirmation and management approval. */
export interface FeeRule { kind: 'percentage' | 'fixed'; value: string; payer: 'buyer' | 'seller' | 'split'; label: string }
