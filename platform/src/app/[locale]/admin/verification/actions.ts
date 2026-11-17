'use server';

import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { getSiteUrl } from '@/lib/env';
import { parseForm } from '@/lib/form';
import { failure, success, type FormState } from '@/lib/form-state';
import { decisionSchema, startReviewSchema } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import { getMailer } from '@/server/mailer';
import * as priv from '@/server/privileged';
import { scanBytes } from '@/server/scanner';
import { rescanDepsFrom, rescanPending } from '@/server/services/documents';
import { requiresMfa } from '@/lib/permissions';
import { adminMfaRequired, getMfaStatus } from '@/server/services/mfa';
import { getRolePermissions, listMyMemberships } from '@/server/services/orgs';
import { decideClaim, getClaim, startReview } from '@/server/services/verification';
import { buildDecisionEmail } from '@/server/verification-email';

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function startReviewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const p = parseForm(startReviewSchema, formData);
  if (!p.ok) return failure(p.errorKey);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const r = await startReview(supabase, p.data.claimId);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath('/', 'layout');
  return success('adminVer.reviewStarted');
}

/** Saves the decision (the database enforces permission, conflict of interest and the expected version). */
export async function decideAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Checklist ticks from the review drawer are written into the reason, so they end up in the audit trail.
  const checks = formData.getAll('checks').map(String).filter(Boolean);
  if (checks.length > 0) {
    const tt = await getTranslations({ locale: String(formData.get('locale') ?? 'en') });
    formData.set('reason', `${String(formData.get('reason') ?? '').trim()}\n${tt('adm2.checkedPrefix')}: ${checks.join('; ')}`.slice(0, 1000));
  }
  const p = parseForm(decisionSchema, formData);
  if (!p.ok) return failure(p.errorKey, p.values);
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const d = p.data;

  const claim = await getClaim(supabase, d.claimId);
  const r = await decideClaim(supabase, d.claimId, d.decision, d.reason, d.expectedVersion);
  if (!r.ok) return failure(r.errorKey, { decision: d.decision, reason: d.reason });

  // Best-effort email. A failure here must never fail the (already saved) decision; logs carry no addresses.
  if (claim) {
    try {
      const recipients = await priv.recipientEmails(claim.org_id);
      const mailer = getMailer();
      let failed = 0;
      for (const to of recipients) {
        try {
          await mailer.send(
            buildDecisionEmail({
              to,
              claimType: claim.claim_type,
              decision: d.decision,
              reason: d.reason,
              siteUrl: getSiteUrl(),
              orgId: claim.org_id,
            }),
          );
        } catch {
          failed++;
        }
      }
      if (failed) console.error('decision email not delivered', { failed, total: recipients.length });
    } catch {
      console.error('decision email not sent');
    }
  }
  revalidatePath('/', 'layout');
  return success('adminVer.decided');
}

/** Rescans pending documents now. Requires a reviewer role at aal2 in the MITRA organisation. */
export async function scanNowAction(): Promise<FormState> {
  const { supabase, user } = await currentUser();
  if (!user) return failure('unauthenticated');
  const mine = (await listMyMemberships(supabase, user.id)).find((m) => m.org.type === 'mitra');
  const allowed = mine ? (await getRolePermissions(supabase, mine.role)).has('verification:review') : false;
  const mfaOk = mine && !requiresMfa(mine.role, mine.org.type, await adminMfaRequired(supabase)) ? true : (await getMfaStatus(supabase)).currentLevel === 'aal2';
  if (!allowed || !mfaOk) return failure('forbidden');

  const summary = await rescanPending(rescanDepsFrom(priv, scanBytes));
  revalidatePath('/', 'layout');
  return success('adminVer.scanDone', {
    clean: String(summary.clean),
    infected: String(summary.infected),
    waiting: String(summary.waiting),
  });
}
