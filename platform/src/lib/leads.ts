/** Cards on the Requests & leads board. Built on the server from buyer requests (invitations) and enquiries; the database decides every status. */
export type LeadColumn = 'new' | 'talking' | 'quoted' | 'won' | 'lost';
export type LeadTag = 'due' | 'new' | 'shared' | 'quote' | 'won' | 'lost' | 'declined' | 'talking' | 'closed';

export interface LeadCard {
  /** request:<id> or enquiry:<id> */
  key: string;
  kind: 'request' | 'enquiry';
  column: LeadColumn;
  tag: LeadTag;
  title: string;
  /** "buyer · area" line */
  sub: string;
  qty: string | null;
  neededBy: string | null;
  requestId: string | null;
  enquiryId: string | null;
  /** Newest first. */
  at: string;
  quote: { version: number; total: string; validUntil: string } | null;
  /** True when this card can be answered with "I'm interested" / "Not for us". */
  canAnswer: boolean;
  /** True when "Mark won" / "Mark lost" applies (an enquiry that is not already closed out). */
  canClose: boolean;
}

export interface LeadDetail {
  title: string;
  buyer: string | null;
  area: string;
  qty: string;
  neededBy: string;
  budget: string;
  description: string;
  reasons: string[];
  phone: string | null;
  email: string | null;
}

/** Column of an enquiry from its latest self-reported stage and quotation status. */
export function enquiryColumn(stage: string | null, quoteStatus: string | null, enquiryStatus: string): LeadColumn {
  if (stage === 'reported_won' || quoteStatus === 'accepted') return 'won';
  if (stage === 'reported_lost' || ['closed', 'blocked'].includes(enquiryStatus) || ['declined', 'withdrawn', 'expired'].includes(quoteStatus ?? '')) return 'lost';
  if (quoteStatus === 'sent' || quoteStatus === 'revision_requested' || stage === 'quoted') return 'quoted';
  return 'talking';
}
