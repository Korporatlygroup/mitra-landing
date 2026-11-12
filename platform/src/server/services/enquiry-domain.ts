/** Independent P4 input and reporting rules; persistence remains behind the P3 contract. */
export function cleanEnquiryMessage(body: string): string {
  if (typeof body !== 'string') throw new Error('invalid_message');
  const cleaned = body.trim();
  if (!cleaned || cleaned.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(cleaned)) {
    throw new Error('invalid_message');
  }
  // Return plain text. React will escape it when rendered as a text child.
  return cleaned;
}

export type LeadEvent = {
  enquiryId: string;
  receivedAt: Date;
  firstSellerReplyAt: Date | null;
  quoteSentAt: Date | null;
  outcome: 'reported_won' | 'reported_lost' | null;
  followUpAt: Date | null;
};

export type LeadMetrics = {
  enquiriesReceived: number;
  enquiriesAnswered: number;
  quotesSent: number;
  medianResponseMinutes: number | null;
  followUpsDue: number;
  reportedWins: number;
  reportedLosses: number;
};

/** Input must already be scoped to one authorized seller org by the database/service. */
export function calculateLeadMetrics(events: LeadEvent[], now: Date): LeadMetrics {
  if (Number.isNaN(now.getTime())) throw new Error('invalid_time');
  const unique = new Map(events.map((event) => [event.enquiryId, event]));
  if (unique.size !== events.length) throw new Error('duplicate_enquiry');
  const durations = events.flatMap((e) => e.firstSellerReplyAt && e.firstSellerReplyAt >= e.receivedAt
    ? [(e.firstSellerReplyAt.getTime() - e.receivedAt.getTime()) / 60000] : []).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const median = durations.length === 0 ? null : durations.length % 2 === 1
    ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  return {
    enquiriesReceived: events.length,
    enquiriesAnswered: events.filter((e) => e.firstSellerReplyAt !== null).length,
    quotesSent: events.filter((e) => e.quoteSentAt !== null).length,
    medianResponseMinutes: median,
    followUpsDue: events.filter((e) => e.followUpAt !== null && e.followUpAt <= now && e.outcome === null).length,
    reportedWins: events.filter((e) => e.outcome === 'reported_won').length,
    reportedLosses: events.filter((e) => e.outcome === 'reported_lost').length,
  };
}
