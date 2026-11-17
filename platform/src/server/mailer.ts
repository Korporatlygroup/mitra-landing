import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Lets the provider drop a repeated send of the same message (Resend honours it for 24 hours). */
  idempotencyKey?: string;
}

export interface Mailer {
  /** Resolves with the provider's message id when it gives one. Resolving means the provider ACCEPTED the message, not that it was delivered. */
  send(message: MailMessage): Promise<string | void>;
}

/** Thrown when Resend refuses or cannot be reached. Carries only a status code, never the response body or the message. */
export class MailSendError extends Error {
  constructor(public readonly status: number) {
    super(`resend_${status}`);
    this.name = 'MailSendError';
  }
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailConfigError';
  }
}

const DEV_SMTP_URL = 'smtp://127.0.0.1:54425';
const DEV_MAIL_FROM = 'INOK <no-reply@inok.local>';

/**
 * Resolves SMTP settings. In production SMTP_URL and MAIL_FROM are mandatory: there is no silent fallback,
 * so a mis-configured deployment fails loudly instead of pretending an invitation was sent.
 */
export function resolveMailConfig(env: Record<string, string | undefined> = process.env): { smtpUrl: string; from: string } {
  const production = env.NODE_ENV === 'production';
  const smtpUrl = env.SMTP_URL || (production ? '' : DEV_SMTP_URL);
  const from = env.MAIL_FROM || (production ? '' : DEV_MAIL_FROM);
  if (!smtpUrl) throw new MailConfigError('SMTP_URL is not configured');
  if (!from) throw new MailConfigError('MAIL_FROM is not configured');
  return { smtpUrl, from };
}

export function createSmtpMailer(env: Record<string, string | undefined> = process.env): Mailer {
  const { smtpUrl, from } = resolveMailConfig(env);
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

const DEFAULT_RESEND_FROM = 'INOK <no-reply@mail.inok.my>';

/**
 * Resend over HTTPS (works on Workers; no raw TCP). The key is a server-side secret and is only ever sent in the Authorization header.
 * The sender must belong to the verified `mail.inok.my` domain; MAIL_FROM overrides the default.
 */
export function createResendMailer(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Mailer {
  const key = env.RESEND_API_KEY;
  if (!key) throw new MailConfigError('RESEND_API_KEY is not configured');
  const from = env.MAIL_FROM || DEFAULT_RESEND_FROM;
  return {
    async send(message) {
      let res: Response;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey.slice(0, 256) } : {}),
          },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new MailSendError(0);
      }
      if (!res.ok) throw new MailSendError(res.status);
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      return typeof body?.id === 'string' ? body.id : undefined;
    },
  };
}

/** Resend when its key is configured, otherwise SMTP (local development and tests). */
export function getMailer(): Mailer {
  return process.env.RESEND_API_KEY ? createResendMailer() : createSmtpMailer();
}
