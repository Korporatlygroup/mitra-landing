import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailConfigError';
  }
}

const DEV_SMTP_URL = 'smtp://127.0.0.1:54425';
const DEV_MAIL_FROM = 'MITRA <no-reply@mitra.local>';

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

export function getMailer(): Mailer {
  return createSmtpMailer();
}
