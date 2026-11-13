import { failFrom, ok, type Db, type Result } from './result';

export interface SourcingPartner { id: string; name: string; published_products: number }
export interface SourcingItem {
  id: string; line_no: number; name: string; quantity: string; unit: string; category_slug: string | null;
  specification: string | null; catalogue_snapshot: Record<string, unknown> | null;
}
export interface SourcingOffer {
  id: string; partner_org_id: string; supplier_id: string | null; status: string; version: number; revision: number;
  offer: { currency: string; lines: Array<{ item_id: string; name: string; quantity: string; unit_price: string; amount: string }>;
    subtotal: string; charges: string; discount: string; total: string; terms: string | null;
    valid_until: string; lead_time_days: number | null };
}
export interface SourcingDetail {
  id: string; reference: string; status: string; version: number;
  buyer_org_id: string | null; partner_org_id: string | null;
  destination_state: string; destination_city: string | null; needed_by: string | null;
  note: string | null; preferred_quote_id: string | null; created_at: string;
  your_invitation_status: string | null;
  items: SourcingItem[];
  partners: Array<{ org_id: string; status: string }> | null;
  quotes: SourcingOffer[];
  messages: Array<{ id: number; partner_org_id: string; side: 'buyer' | 'partner'; body: string; at: string }>;
  samples: Array<{ id: string; item_id: string; partner_org_id: string; status: string; version: number; note: string | null }>;
}
export interface SourcingCounter {
  id: string; quote_id: string; partner_org_id: string; proposed_total: string;
  currency: string; note: string; status: string; created_at: string;
}
export interface SourcingMatch {
  item_id: string; partner_org_id: string; product_id: string; supplier_id: string;
  name: string; moq: string; unit: string; lead_time_max_days: number | null;
  availability_confirmed_on: string | null; reasons: string[]; unknown: string[];
  deadline_fit: boolean | null;
}
export interface SourcingDocument { id: string; name: string; at: string }
async function rpc<T>(db: Db, name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await db.rpc(name, args);
  return error ? failFrom(error) : ok(data as T);
}
export const listSourcingPartners = (db: Db) => rpc<SourcingPartner[]>(db, 'list_sourcing_partners');
export const matchSourcingRfq = (db: Db, id: string, partner: string | null = null) =>
  rpc<SourcingMatch[]>(db, 'match_sourcing_rfq', { p_rfq: id, p_partner: partner });
export const listSourcingRfqs = (db: Db, org: string, offset = 0) =>
  rpc<{ items: Array<{ id: string; reference: string; status: string; created_at: string }> }>(
    db, 'list_sourcing_rfqs', { p_org: org, p_offset: offset });
export const getSourcingRfq = (db: Db, id: string, partner: string | null = null) =>
  rpc<SourcingDetail>(db, 'get_sourcing_rfq', { p_rfq: id, p_partner: partner });
export const listSourcingDocuments = (db: Db, id: string, partner: string) =>
  rpc<SourcingDocument[]>(db, 'list_sourcing_documents', { p_rfq: id, p_partner: partner });
export const listSourcingCounters = (db: Db, id: string, partner: string | null = null) =>
  rpc<SourcingCounter[]>(db, 'list_sourcing_counters', { p_rfq: id, p_partner: partner });
export const getSourcingTimeline = (db: Db, id: string, partner: string | null = null) =>
  rpc<Array<{ kind: string; at: string }>>(db, 'sourcing_timeline', { p_rfq: id, p_partner: partner });
export const createSourcingRfq = (db: Db, p: {
  buyerOrg: string; key: string; items: unknown[]; partners: string[];
  state: string; city: string | null; neededBy: string | null; note: string | null; sourceRequest?: string | null;
}) => rpc<{ id: string; reference: string; created: boolean }>(db, 'create_sourcing_rfq', {
  p_buyer_org: p.buyerOrg, p_key: p.key, p_items: p.items, p_partner_orgs: p.partners,
  p_state: p.state, p_city: p.city, p_needed_by: p.neededBy, p_note: p.note, p_source_request: p.sourceRequest ?? null,
});
export const sendSourcingMessage = (db: Db, id: string, partner: string, body: string) =>
  rpc<{ id: number }>(db, 'send_sourcing_message', { p_rfq: id, p_partner: partner, p_body: body });
export const submitSourcingQuote = (db: Db, p: {
  rfq: string; partner: string; supplier: string | null; currency: string;
  lines: Array<{ item_id: string; unit_price: string }>; charges: string; discount: string;
  leadDays: number; terms: string; validUntil: string; expectedVersion: number;
}) => rpc<{ id: string; revision: number; total: string; currency: string; version: number }>(
  db, 'submit_sourcing_quote', {
    p_rfq: p.rfq, p_partner: p.partner, p_supplier: p.supplier, p_currency: p.currency,
    p_lines: p.lines, p_charges: p.charges, p_discount: p.discount, p_lead_days: p.leadDays,
    p_terms: p.terms, p_valid_until: p.validUntil, p_expected_version: p.expectedVersion,
  });
export const selectSourcingQuote = (db: Db, rfq: string, quote: string, version: number) =>
  rpc<{ id: string; status: string; version: number }>(db, 'select_sourcing_quote',
    { p_rfq: rfq, p_quote: quote, p_expected_version: version });
export const respondSourcingInvitation = (db: Db, rfq: string, partner: string, accept: boolean) =>
  rpc<{ rfq_id: string; status: string }>(db, 'respond_sourcing_invitation',
    { p_rfq: rfq, p_partner: partner, p_accept: accept });
export const changeSourcingStatus = (db: Db, rfq: string, action: 'cancel' | 'close', version: number) =>
  rpc<{ id: string; status: string; version: number }>(db, 'change_sourcing_status',
    { p_rfq: rfq, p_action: action, p_expected_version: version });
export const proposeSourcingCounter = (db: Db, quote: string, total: string, note: string, version: number) =>
  rpc<{ id: string; version: number }>(db, 'propose_sourcing_counter',
    { p_quote: quote, p_total: total, p_note: note, p_expected_rfq_version: version });
export const respondSourcingCounter = (db: Db, counter: string, action: 'accept' | 'decline') =>
  rpc<{ id: string; status: string }>(db, 'respond_sourcing_counter', { p_counter: counter, p_action: action });
export const requestSourcingSample = (db: Db, rfq: string, partner: string, item: string, note: string) =>
  rpc<{ id: string; status: string }>(db, 'request_sourcing_sample',
    { p_rfq: rfq, p_partner: partner, p_item: item, p_note: note });
export const updateSourcingSample = (db: Db, sample: string, status: string, version: number) =>
  rpc<{ id: string; status: string; version: number }>(db, 'update_sourcing_sample',
    { p_sample: sample, p_status: status, p_expected_version: version });
export const repeatSourcingRfq = (db: Db, rfq: string) =>
  rpc<{ items: Array<{ name: string; quantity: string; unit: string; category_slug: string | null; specification: string | null }>;
    state: string; city: string | null }>(db, 'repeat_sourcing_rfq', { p_rfq: rfq });
export const listSourcingTemplates = (db: Db, org: string) =>
  rpc<Array<{ id: string; title: string; items: unknown[] }>>(db, 'list_sourcing_templates', { p_org: org });
export const saveSourcingTemplate = (db: Db, org: string, title: string, items: unknown[]) =>
  rpc<{ id: string }>(db, 'save_sourcing_template', { p_org: org, p_title: title, p_items: items });
export const sourcingOperations = (db: Db, offset = 0) =>
  rpc<{ total_requests: number; awaiting_quotes: number; preferred_selected: number;
    items: Array<{ id: string; reference: string; status: string; created_at: string }> }>(
    db, 'sourcing_operations', { p_offset: offset });
