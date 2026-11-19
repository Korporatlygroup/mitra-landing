import { failFrom, ok, type Db, type Result } from './result';

export type OrderStatus = 'agreed' | 'in_progress' | 'buyer_confirmation_pending' | 'completed' | 'cancelled' | 'disputed';
export type OrderAction = 'start' | 'mark_delivered' | 'confirm' | 'dispute' | 'cancel';

export interface OrderRow {
  id: string; reference: string; enquiry_id: string; quotation_id: string; quote_version_id: string; buyer_org_id: string; seller_org_id: string;
  currency: string; total: string; scope_text: string; items: { description: string; quantity: string; unit: string; unit_price: string; line_total: string }[];
  delivery_timing: string; terms_text: string | null; exclusions: string | null; service_date: string | null; deposit_note: string | null;
  status: OrderStatus; version: number; created_at: string; updated_at: string;
}
export interface DealEventRow {
  id: string; enquiry_id: string; order_id: string | null; kind: string; actor_org_id: string | null; ref_id: string | null; note: string | null; created_at: string;
}

const ORDER_COLUMNS = 'id,reference,enquiry_id,quotation_id,quote_version_id,buyer_org_id,seller_org_id,currency,total,scope_text,items,delivery_timing,terms_text,exclusions,service_date,deposit_note,status,version,created_at,updated_at';

/** Row-level security limits every read to the two organisations in the enquiry. */
export async function getOrder(db: Db, id: string): Promise<OrderRow | null> {
  const { data } = await db.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  return (data as OrderRow | null) ?? null;
}
export async function getOrderForEnquiry(db: Db, enquiryId: string): Promise<OrderRow | null> {
  const { data } = await db.from('orders').select(ORDER_COLUMNS).eq('enquiry_id', enquiryId).maybeSingle();
  return (data as OrderRow | null) ?? null;
}
export async function listOrders(db: Db): Promise<OrderRow[]> {
  const { data } = await db.from('orders').select(ORDER_COLUMNS).order('created_at', { ascending: false }).limit(100);
  return (data ?? []) as OrderRow[];
}
export async function listDealEvents(db: Db, enquiryId: string): Promise<DealEventRow[]> {
  const { data } = await db.from('deal_events').select('id,enquiry_id,order_id,kind,actor_org_id,ref_id,note,created_at').eq('enquiry_id', enquiryId).order('created_at').limit(500);
  return (data ?? []) as DealEventRow[];
}

async function rpc<T>(db: Db, name: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(name, args);
  return error ? failFrom(error) : ok(data as T);
}
export const orderAction = (db: Db, orderId: string, action: OrderAction, note: string | null) => rpc<string>(db, 'order_action', { p_order: orderId, p_action: action, p_note: note });
export const setOrderDetails = (db: Db, orderId: string, serviceDate: string | null, depositNote: string | null) =>
  rpc<null>(db, 'set_order_details', { p_order: orderId, p_service_date: serviceDate, p_deposit_note: depositNote });
