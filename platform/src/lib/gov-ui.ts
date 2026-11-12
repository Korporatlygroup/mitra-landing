import { z } from 'zod';
import type { OrgMembership } from './buyer-orgs';

export const GOV_NEEDS = ['financing', 'grant', 'training', 'growth'] as const;
export type GovNeed = (typeof GOV_NEEDS)[number];

/** Which published funding types answer a declared need (mirrors the database mapping for new-match notices). */
export const NEED_TO_FUNDING: Record<GovNeed, string[] | null> = {
  financing: ['financing'],
  grant: ['grant', 'subsidy'],
  training: ['training'],
  growth: null, // everything else, shown unfiltered
};

export const parseNeed = (v: unknown): GovNeed | null => (typeof v === 'string' && (GOV_NEEDS as readonly string[]).includes(v) ? (v as GovNeed) : null);

/** Business organisations the user may answer for (owner, manager, staff). A UI hint only: the database decides. */
export function eligibleAssistOrgs<T extends OrgMembership>(memberships: T[]): T[] {
  return memberships.filter((m) => m.org.type === 'business' && m.org.status === 'active' && ['owner', 'manager', 'staff'].includes(m.role));
}

export const formatRm = (v: string | null | undefined): string => {
  if (!v) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-MY', { maximumFractionDigits: 2 }) : v;
};

const optInt = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(min).max(max).optional());
const optEnum = <T extends [string, ...string[]]>(vals: T) => z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(vals).optional());

export const govProfileSchema = z.object({
  orgId: z.uuid(),
  version: z.coerce.number().int().min(0),
  need: z.preprocess((v) => (v === '' ? undefined : v), z.enum(GOV_NEEDS).optional()),
  business_size: optEnum(['micro', 'small', 'medium']),
  employees: optInt(0, 100000),
  years_operating: optInt(0, 200),
  registration: optEnum(['registered', 'licensed', 'none']),
  state: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(60).optional()),
  community: optEnum(['indian', 'other', 'prefer_not']),
  citizenship: optEnum(['malaysian', 'other', 'prefer_not']),
  owner_age: optInt(16, 100),
});

export const govTrackingSchema = z.object({
  orgId: z.uuid(),
  programmeId: z.uuid(),
  version: z.coerce.number().int().min(1),
  tracking_status: z.enum(['interested', 'preparing', 'applied_externally', 'awaiting_decision', 'outcome_recorded', 'not_interested']),
  note: z.string().max(500).optional(),
  applied_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  outcome: optEnum(['approved', 'declined', 'withdrawn', 'other']),
  reminder_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

export const govSaveSchema = z.object({ orgId: z.uuid(), programmeId: z.uuid() });

export const govPrefsSchema = z.object({
  paused_until: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  frequency: z.enum(['immediate', 'daily', 'weekly']),
});

/** Only the programme's own application link, and only https: anything else is never rendered as a link. */
export function safeHttpsUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
