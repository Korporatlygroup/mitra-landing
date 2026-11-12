import { describe, expect, it } from 'vitest';
import { transitionQuote, type QuoteState } from '@/server/services/quote-state';

const now = new Date('2026-11-10T00:00:00Z');
const future = new Date('2026-11-20T00:00:00Z');
const draft: QuoteState = { status: 'draft', version: 0, currentVersionId: null, acceptedVersionId: null, validUntil: null };
const sent = transitionQuote(draft, { action: 'send', actor: 'seller', expectedVersion: 0, versionId: 'v1', validUntil: future, now });

describe('Phase 4 quote transitions', () => {
  it('sends, requests revision, sends a new version and accepts only that version', () => {
    const requested = transitionQuote(sent, { action: 'request_revision', actor: 'buyer', expectedVersion: 1, versionId: 'v1', now });
    const revised = transitionQuote(requested, { action: 'send', actor: 'seller', expectedVersion: 2, versionId: 'v2', validUntil: future, now });
    expect(() => transitionQuote(revised, { action: 'accept', actor: 'buyer', expectedVersion: 3, versionId: 'v1', now })).toThrow();
    expect(transitionQuote(revised, { action: 'accept', actor: 'buyer', expectedVersion: 3, versionId: 'v2', now })).toMatchObject({ status: 'accepted', acceptedVersionId: 'v2', version: 4 });
  });
  it('rejects self acceptance, stale writes, expiry and withdrawn offers', () => {
    expect(() => transitionQuote(sent, { action: 'accept', actor: 'seller', expectedVersion: 1, versionId: 'v1', now })).toThrow();
    expect(() => transitionQuote(sent, { action: 'accept', actor: 'buyer', expectedVersion: 0, versionId: 'v1', now })).toThrow('quote_conflict');
    expect(() => transitionQuote(sent, { action: 'accept', actor: 'buyer', expectedVersion: 1, versionId: 'v1', now: future })).toThrow();
    const withdrawn = transitionQuote(sent, { action: 'withdraw', actor: 'seller', expectedVersion: 1, now });
    expect(() => transitionQuote(withdrawn, { action: 'accept', actor: 'buyer', expectedVersion: 2, versionId: 'v1', now })).toThrow();
  });
  it('does not resend a previously sent version', () => {
    const requested = transitionQuote(sent, { action: 'request_revision', actor: 'buyer', expectedVersion: 1, versionId: 'v1', now });
    expect(() => transitionQuote(requested, { action: 'send', actor: 'seller', expectedVersion: 2, versionId: 'v1', validUntil: future, now })).toThrow();
  });
});
