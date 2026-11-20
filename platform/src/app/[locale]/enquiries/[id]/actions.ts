'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { CANCELLATION_OPTIONS } from '@/server/services/deals';
import { calculateQuote } from '@/server/services/quote-calculation';
import { postMessage, saveQuoteDraft, sendQuoteVersion, respondToQuote, withdrawQuote, recordLead, proposeReferral, respondToReferral, submitReview, respondToReview } from '@/server/services/enquiries';

const text = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
const base = z.object({ enquiryId: uuidSchema });
const failResult = (r: { ok: false; errorKey: string } | { ok: true }) => r.ok ? success('p4.saved') : failure(r.errorKey);
const refresh = (id: string) => revalidatePath(`/enquiries/${id}`);

export async function messageAction(_prev: FormState, f: FormData): Promise<FormState> {
  const p = base.extend({ body: z.string().trim().min(1).max(4000), key: z.string().min(8).max(100) }).safeParse({ enquiryId: text(f, 'enquiryId'), body: text(f, 'body'), key: text(f, 'key') });
  if (!p.success) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await postMessage(supabase, p.data.enquiryId, p.data.body, p.data.key);
  if (r.ok) refresh(p.data.enquiryId);
  return failResult(r);
}

export async function saveQuoteAction(_prev: FormState, f: FormData): Promise<FormState> {
  const p = base.extend({ expectedVersion: z.coerce.number().int().nonnegative(), validUntil: z.iso.date(), scope: z.string().trim().min(3).max(2000),
    taxTreatment: z.string().trim().min(3).max(500), deliveryTiming: z.string().trim().min(3).max(500) }).safeParse({
      enquiryId: text(f, 'enquiryId'), expectedVersion: text(f, 'expectedVersion'), validUntil: text(f, 'validUntil'), scope: text(f, 'scope'),
      taxTreatment: text(f, 'taxTreatment'), deliveryTiming: text(f, 'deliveryTiming'),
    });
  if (!p.success) return failure('invalid_input');
  // Booking terms are part of the quotation the buyer accepts: the date, the deposit expectation (text only) and the cancellation conditions.
  const terms = z.object({
    bookingDate: z.iso.date(), completionBy: z.union([z.iso.date(), z.literal('')]),
    depositTerms: z.string().trim().min(3).max(500), cancellationOption: z.enum(CANCELLATION_OPTIONS), cancellationText: z.string().trim().max(500),
  }).safeParse({ bookingDate: text(f, 'bookingDate'), completionBy: text(f, 'completionBy'), depositTerms: text(f, 'depositTerms'), cancellationOption: text(f, 'cancellationOption'), cancellationText: text(f, 'cancellationText') });
  if (!terms.success) return failure('terms_required');
  if (terms.data.cancellationOption === 'custom' && terms.data.cancellationText.length < 3) return failure('terms_required');
  if (terms.data.completionBy && terms.data.completionBy < terms.data.bookingDate) return failure('invalid_date');
  const lines = [1, 2, 3, 4, 5].flatMap((n) => {
    const description = text(f, `description${n}`);
    return description ? [{ description, quantity: text(f, `quantity${n}`), unit: text(f, `unit${n}`), unitPrice: text(f, `unitPrice${n}`) }] : [];
  });
  let calc;
  try { calc = calculateQuote({ currency: 'MYR', lines, deliveryFee: text(f, 'deliveryFee') || '0', taxAmount: text(f, 'taxAmount') || '0' }); }
  catch { return failure('invalid_input'); }
  const draft = { currency: 'MYR', scope: p.data.scope, exclusions: text(f, 'exclusions'), tax_treatment: p.data.taxTreatment,
    delivery_timing: p.data.deliveryTiming, terms: text(f, 'terms'), valid_until: `${p.data.validUntil}T23:59:59+08:00`,
    delivery_fee: calc.deliveryFee, tax_amount: calc.taxAmount,
    booking_date: terms.data.bookingDate, completion_by: terms.data.completionBy, deposit_terms: terms.data.depositTerms,
    cancellation_option: terms.data.cancellationOption, cancellation_text: terms.data.cancellationOption === 'custom' ? terms.data.cancellationText : '',
    lines: calc.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice })) };
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await saveQuoteDraft(supabase, p.data.enquiryId, draft, p.data.expectedVersion);
  if (r.ok) refresh(p.data.enquiryId);
  return failResult(r);
}

export async function sendQuoteAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'quotationId'), enquiryId = text(f, 'enquiryId'), version = Number(text(f, 'expectedVersion'));
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(enquiryId).success || !Number.isSafeInteger(version)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  // A draft saved before booking terms existed must get them before it can be sent.
  const { data: dr } = await supabase.from('quotation_drafts').select('data').eq('quotation_id', id).maybeSingle();
  const dd = (dr?.data ?? {}) as Record<string, unknown>;
  if (!dd.booking_date || !dd.deposit_terms || !dd.cancellation_option) return failure('terms_required');
  const r = await sendQuoteVersion(supabase, id, version);
  if (r.ok) refresh(enquiryId);
  return failResult(r);
}

export async function respondQuoteAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'quotationId'), enquiryId = text(f, 'enquiryId'), versionId = text(f, 'versionId');
  const expected = Number(text(f, 'expectedVersion')), action = text(f, 'decision');
  if (![id, enquiryId, versionId].every((v) => uuidSchema.safeParse(v).success) || !Number.isSafeInteger(expected) || !['request_revision', 'accept', 'decline'].includes(action)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await respondToQuote(supabase, id, versionId, action, text(f, 'reason') || null, expected);
  if (r.ok) refresh(enquiryId);
  return failResult(r);
}

export async function withdrawQuoteAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'quotationId'), enquiryId = text(f, 'enquiryId'), version = Number(text(f, 'expectedVersion'));
  if (![id, enquiryId].every((v) => uuidSchema.safeParse(v).success) || !Number.isSafeInteger(version)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await withdrawQuote(supabase, id, version); if (r.ok) refresh(enquiryId); return failResult(r);
}

export async function leadAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'enquiryId'), stage = text(f, 'stage'), when = text(f, 'followUpAt');
  if (!uuidSchema.safeParse(id).success || !['new','contacted','quoted','discussing','reported_won','reported_lost'].includes(stage)) return failure('invalid_input');
  const date = when ? new Date(when) : null;
  if (date && Number.isNaN(date.getTime())) return failure('invalid_date');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await recordLead(supabase, id, stage, text(f, 'note') || null, date?.toISOString() ?? null);
  if (r.ok) refresh(id); return failResult(r);
}

export async function referralAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'enquiryId'), seller = text(f, 'sellerOrgId');
  if (![id, seller].every((v) => uuidSchema.safeParse(v).success)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await proposeReferral(supabase, id, seller); if (r.ok) refresh(id); return failResult(r);
}

export async function respondReferralAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'enquiryId'), referral = text(f, 'referralId');
  if (![id, referral].every((v) => uuidSchema.safeParse(v).success)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await respondToReferral(supabase, referral, text(f, 'decision') === 'accept');
  if (r.ok) { refresh(id); revalidatePath('/', 'layout'); }
  return failResult(r);
}

export async function reviewAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'enquiryId'), rating = Number(text(f, 'rating'));
  if (!uuidSchema.safeParse(id).success || !Number.isInteger(rating) || rating < 1 || rating > 5) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await submitReview(supabase, id, rating, text(f, 'reviewText')); if (r.ok) refresh(id); return failResult(r);
}

export async function reviewResponseAction(_prev: FormState, f: FormData): Promise<FormState> {
  const id = text(f, 'enquiryId'), review = text(f, 'reviewId');
  if (![id, review].every((v) => uuidSchema.safeParse(v).success)) return failure('invalid_input');
  const { supabase, user } = await actionUser(); if (!user) return failure('unauthenticated');
  const r = await respondToReview(supabase, review, text(f, 'response')); if (r.ok) refresh(id); return failResult(r);
}
