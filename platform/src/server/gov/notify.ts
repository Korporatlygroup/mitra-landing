import type { GovRpc } from './worker';

/**
 * Notification run: queue due reminders, deliver in-app notifications, send emails through the mailer.
 * An email is marked "sent" only after the mail provider accepted it (the mailer resolved); a failure goes back to the
 * outbox for a limited number of retries. Subjects never contain business details. If no mailer is configured the in-app
 * notifications are still delivered and the email jobs stay queued for retry (reported as `email_unavailable`).
 */

export interface MailerLike {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface NotifyDeps {
  rpc: GovRpc;
  mailer: MailerLike | null;
  siteUrl: string;
  batch?: number;
}

export interface NotifySummary {
  reminders: number;
  emailJobs: number;
  emailsAccepted: number;
  emailsFailed: number;
  email_unavailable: boolean;
}

interface EmailJob { outbox_id: string; email: string; category: string; programme_name: string; programme_slug: string }

const BODY: Record<string, string> = {
  new_match: 'A newly confirmed programme may suit your business',
  opens: 'A programme you saved may now be open for applications',
  deadline: 'A programme you saved has an approaching deadline',
  rule_change: 'A programme you saved has changed its published terms',
  unavailable: 'A programme you saved is no longer listed',
  reminder: 'You asked us to remind you about a saved programme',
  recheck: 'A programme you saved has not been confirmed with its agency for a while, so check the official source before relying on it',
};

export async function runNotificationsOnce(deps: NotifyDeps): Promise<NotifySummary> {
  const out: NotifySummary = { reminders: 0, emailJobs: 0, emailsAccepted: 0, emailsFailed: 0, email_unavailable: false };
  const rem = await deps.rpc('gov_enqueue_reminders');
  if (rem.error) throw new Error(`reminders: ${rem.error.message}`);
  out.reminders = Number(rem.data ?? 0);
  const disp = await deps.rpc('gov_dispatch_outbox', { p_limit: deps.batch ?? 50 });
  if (disp.error) throw new Error(`dispatch: ${disp.error.message}`);
  const jobs = (disp.data ?? []) as EmailJob[];
  out.emailJobs = jobs.length;
  for (const job of jobs) {
    if (!deps.mailer) {
      out.email_unavailable = true;
      await deps.rpc('gov_mark_email', { p_outbox: job.outbox_id, p_accepted: false, p_error: 'mailer_not_configured' });
      continue;
    }
    try {
      await deps.mailer.send({
        to: job.email,
        subject: 'INOK: an update about business help',
        text:
          `${BODY[job.category] ?? 'There is an update'}.\n\n${job.programme_name}\n` +
          `${deps.siteUrl}/en/business-help/${job.programme_slug}\n\n` +
          'INOK is an independent platform. It is not a government agency and cannot apply on your behalf. ' +
          'Check requirements and apply only on the official agency channel.\n\n' +
          'You can change or stop these emails in your notification settings.',
      });
      await deps.rpc('gov_mark_email', { p_outbox: job.outbox_id, p_accepted: true });
      out.emailsAccepted += 1;
    } catch (err) {
      await deps.rpc('gov_mark_email', { p_outbox: job.outbox_id, p_accepted: false, p_error: `send_failed:${(err as Error).name}`.slice(0, 200) });
      out.emailsFailed += 1;
    }
  }
  return out;
}
