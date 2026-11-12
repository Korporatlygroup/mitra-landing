import { describe, expect, it } from 'vitest';
import { calculateLeadMetrics, cleanEnquiryMessage, type LeadEvent } from '@/server/services/enquiry-domain';

describe('enquiry message input', () => {
  it('keeps content as plain text and rejects control characters', () => {
    expect(cleanEnquiryMessage('  <script>alert(1)</script>  ')).toBe('<script>alert(1)</script>');
    expect(() => cleanEnquiryMessage('hello\u0000world')).toThrow();
    expect(() => cleanEnquiryMessage(' '.repeat(4001))).toThrow();
  });
});

describe('seller metrics', () => {
  const receivedAt = new Date('2026-11-10T00:00:00Z');
  const events: LeadEvent[] = [
    { enquiryId: 'a', receivedAt, firstSellerReplyAt: new Date('2026-11-10T00:10:00Z'), quoteSentAt: new Date('2026-11-10T01:00:00Z'), outcome: 'reported_won', followUpAt: null },
    { enquiryId: 'b', receivedAt, firstSellerReplyAt: new Date('2026-11-10T00:30:00Z'), quoteSentAt: null, outcome: null, followUpAt: new Date('2026-11-10T02:00:00Z') },
    { enquiryId: 'c', receivedAt, firstSellerReplyAt: null, quoteSentAt: null, outcome: null, followUpAt: null },
  ];
  it('derives counts and median from actual records', () => {
    expect(calculateLeadMetrics(events, new Date('2026-11-10T03:00:00Z'))).toMatchObject({ enquiriesReceived: 3, enquiriesAnswered: 2, quotesSent: 1, medianResponseMinutes: 20, followUpsDue: 1, reportedWins: 1 });
  });
  it('uses null rather than an invented response time for no data', () => {
    expect(calculateLeadMetrics([], receivedAt).medianResponseMinutes).toBeNull();
  });
});
