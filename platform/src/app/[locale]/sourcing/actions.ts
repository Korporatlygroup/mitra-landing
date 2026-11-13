'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { actionUser } from '@/server/action-user';
import {
  changeSourcingStatus, createSourcingRfq, proposeSourcingCounter, requestSourcingSample, respondSourcingCounter,
  respondSourcingInvitation,
  saveSourcingTemplate, selectSourcingQuote, sendSourcingMessage, submitSourcingQuote, updateSourcingSample,
} from '@/server/services/p6-sourcing';

const id = z.uuid();
const locale = z.enum(['en', 'ta', 'ms']);
const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.string().regex(/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/).refine((v) => Number(v) > 0);
const item = z.object({
  product_id: id.optional(), name: text(160).optional(), unit: text(40).optional(),
  category_slug: z.string().max(40).optional(), quantity, specification: z.string().max(2000).optional(),
}).refine((v) => v.product_id || (v.name && v.unit));
const error = (key: string): FormState => failure(key);
async function db() {
  const ctx = await actionUser();
  return ctx.user ? ctx.supabase : null;
}

export async function createSourcingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    locale, org: id, key: z.string().min(8).max(80), state: text(80),
    city: z.string().max(80), neededBy: z.string(), note: z.string().max(2000),
    items: z.string().max(30000),
  }).safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return error('invalid_input');
  let items: unknown;
  try { items = JSON.parse(parsed.data.items); } catch { return error('invalid_input'); }
  const checked = z.array(item).min(1).max(20).safeParse(items);
  const partners = z.array(id).min(1).max(5).safeParse(form.getAll('partner').map(String));
  if (!checked.success || !partners.success || new Set(partners.data).size !== partners.data.length) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const d = parsed.data;
  const result = await createSourcingRfq(client, {
    buyerOrg: d.org, key: d.key, items: checked.data, partners: partners.data,
    state: d.state, city: d.city || null, neededBy: d.neededBy || null, note: d.note || null,
  });
  if (!result.ok) return error(result.errorKey);
  revalidatePath('/', 'layout');
  redirect(`/${d.locale}/sourcing/${result.data.id}`);
}

export async function sendSourcingMessageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, partner: id, body: text(2000) }).safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_message');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await sendSourcingMessage(client, p.data.rfq, p.data.partner, p.data.body);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.messageSent');
}

export async function submitSourcingQuoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({
    locale, rfq: id, partner: id, supplier: z.string(), currency: z.enum(['INR','MYR','USD']),
    lines: z.string().max(30000), charges: money, discount: money,
    leadDays: z.coerce.number().int().min(0).max(365), terms: z.string().max(2000),
    validUntil: z.iso.date(), expectedVersion: z.coerce.number().int().min(0),
  }).safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_quote');
  let lines: unknown;
  try { lines = JSON.parse(p.data.lines); } catch { return error('invalid_quote'); }
  const checked = z.array(z.object({ item_id: id, unit_price: money })).min(1).max(20).safeParse(lines);
  if (!checked.success) return error('invalid_quote');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await submitSourcingQuote(client, {
    rfq: p.data.rfq, partner: p.data.partner, supplier: p.data.supplier || null,
    currency: p.data.currency, lines: checked.data, charges: p.data.charges, discount: p.data.discount,
    leadDays: p.data.leadDays, terms: p.data.terms, validUntil: p.data.validUntil,
    expectedVersion: p.data.expectedVersion,
  });
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.quoteSent');
}

export async function selectSourcingQuoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, quote: id, version: z.coerce.number().int().min(0) })
    .safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await selectSourcingQuote(client, p.data.rfq, p.data.quote, p.data.version);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.offerChosen');
}

export async function proposeSourcingCounterAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, quote: id, total: money, note: text(1000),
    version: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await proposeSourcingCounter(client, p.data.quote, p.data.total, p.data.note, p.data.version);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.counterSent');
}

export async function respondSourcingCounterAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, counter: id, action: z.enum(['accept','decline']) })
    .safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await respondSourcingCounter(client, p.data.counter, p.data.action);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.counterAnswered');
}

export async function requestSourcingSampleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, partner: id, item: id, note: z.string().max(1000) })
    .safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await requestSourcingSample(client, p.data.rfq, p.data.partner, p.data.item, p.data.note);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.sampleRequested');
}

export async function updateSourcingSampleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, sample: id,
    status: z.enum(['accepted','declined','preparing','dispatched','received','cancelled']),
    version: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await updateSourcingSample(client, p.data.sample, p.data.status, p.data.version);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.sampleUpdated');
}

export async function saveSourcingTemplateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, org: id, rfq: id, title: text(100), items: z.string().max(30000) })
    .safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  let items: unknown;
  try { items = JSON.parse(p.data.items); } catch { return error('invalid_input'); }
  const checked = z.array(item).min(1).max(20).safeParse(items);
  if (!checked.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await saveSourcingTemplate(client, p.data.org, p.data.title, checked.data);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.templateSaved');
}

export async function respondSourcingInvitationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, partner: id, decision: z.enum(['accept','decline']) })
    .safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await respondSourcingInvitation(client, p.data.rfq, p.data.partner, p.data.decision === 'accept');
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.requestUpdated');
}

export async function changeSourcingStatusAction(_prev: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ locale, rfq: id, action: z.enum(['cancel','close']),
    version: z.coerce.number().int().min(0) }).safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return error('invalid_input');
  const client = await db();
  if (!client) return error('unauthenticated');
  const r = await changeSourcingStatus(client, p.data.rfq, p.data.action, p.data.version);
  if (!r.ok) return error(r.errorKey);
  revalidatePath(`/${p.data.locale}/sourcing/${p.data.rfq}`);
  return success('p6.requestUpdated');
}
