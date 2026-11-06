import { describe, expect, it } from 'vitest';
import { buildInviteEmail, cleanText, quoteName } from '@/server/invite-email';
import { MailConfigError, createSmtpMailer, resolveMailConfig } from '@/server/mailer';

describe('mailer configuration', () => {
  it('uses the local Mailpit default outside production', () => {
    const c = resolveMailConfig({ NODE_ENV: 'development' });
    expect(c.smtpUrl).toBe('smtp://127.0.0.1:54425');
    expect(c.from).toContain('@');
  });
  it('honours SMTP_URL and MAIL_FROM', () => {
    expect(resolveMailConfig({ SMTP_URL: 'smtp://mail.test:25', MAIL_FROM: 'a@b.test', NODE_ENV: 'production' })).toEqual({
      smtpUrl: 'smtp://mail.test:25',
      from: 'a@b.test',
    });
  });
  it('throws a clear error in production when SMTP_URL is unset (no silent success)', () => {
    expect(() => createSmtpMailer({ NODE_ENV: 'production', MAIL_FROM: 'a@b.test' })).toThrow(MailConfigError);
    expect(() => createSmtpMailer({ NODE_ENV: 'production', MAIL_FROM: 'a@b.test' })).toThrow(/SMTP_URL/);
    expect(() => createSmtpMailer({ NODE_ENV: 'production', SMTP_URL: 'smtp://x:25' })).toThrow(/MAIL_FROM/);
  });
});

const SEPARATORS = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f' + SEPARATORS + ']');

describe('invitation email', () => {
  const link = 'http://127.0.0.1:3000/en/invite/' + 'a'.repeat(64);
  const mail = buildInviteEmail({ to: 'x@y.test', orgName: 'Kumar <Traders>', role: 'manager', link });
  it('contains the link, English and Tamil text', () => {
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('You have been invited');
    expect(/[஀-௿]/.test(mail.text)).toBe(true);
    expect(mail.to).toBe('x@y.test');
  });
  it('shows the organisation name only as quoted data and escapes it in HTML', () => {
    expect(mail.text).toContain('“Kumar <Traders>”');
    expect(mail.html).toContain('Kumar &lt;Traders&gt;');
    expect(mail.html).not.toContain('<Traders>');
    expect(mail.subject).not.toContain('Kumar');
  });
});

describe('invitation email header safety', () => {
  const link = 'http://127.0.0.1:3000/en/invite/' + 'b'.repeat(64);
  const attacks = [
    'Evil\r\nBcc: attacker@evil.test',
    'Evil\nSubject: pwned',
    `Evil${String.fromCharCode(0x2028)}Bcc: x@y.test`,
    `Evil${String.fromCharCode(0x2029)}Bcc: x@y.test`,
    'Evil\u0085Bcc: x@y.test',
    'Evil\u0000\u0007\u001b[31m',
    '"; filename=x\r\n\r\n<script>alert(1)</script>',
  ];

  it.each(attacks)('org name %j never reaches the subject or any header', (name) => {
    const mail = buildInviteEmail({ to: 'x@y.test', orgName: name, role: 'viewer', link });
    expect(mail.subject).not.toMatch(CONTROL);
    expect(mail.subject).not.toContain('Evil');
    expect(Object.keys(mail).sort()).toEqual(['html', 'subject', 'text', 'to']);
    expect(mail.to).toBe('x@y.test');
  });

  it.each(attacks)('org name %j is flattened to one quoted line in the body', (name) => {
    const mail = buildInviteEmail({ to: 'x@y.test', orgName: name, role: 'viewer', link });
    const quoted = mail.text.match(/“([^”]*)”/);
    expect(quoted).not.toBeNull();
    expect(quoted![1]).not.toMatch(CONTROL);
    expect(mail.html).not.toContain('<script>');
  });

  it('subject is the same fixed text for every organisation', () => {
    const a = buildInviteEmail({ to: 'x@y.test', orgName: 'Alpha', role: 'staff', link }).subject;
    const b = buildInviteEmail({ to: 'x@y.test', orgName: 'Beta', role: 'staff', link }).subject;
    expect(a).toBe(b);
  });

  it('truncates long names to 80 characters and strips controls', () => {
    expect([...cleanText('a'.repeat(200), 80)]).toHaveLength(80);
    expect(quoteName('x'.repeat(200))).toMatch(/^“x{79}…”$/);
    expect(cleanText('a\r\nb\tc', 80)).toBe('a b c');
  });

  it.each(['a@b.test\r\nBcc: x@y.test', 'a@b.test, c@d.test', 'A <a@b.test>', 'a b@c.test', ''])('rejects recipient %j', (to) => {
    expect(() => buildInviteEmail({ to, orgName: 'Org', role: 'viewer', link })).toThrow();
  });

  it('rejects a non-http link', () => {
    expect(() => buildInviteEmail({ to: 'x@y.test', orgName: 'Org', role: 'viewer', link: 'javascript:alert(1)' })).toThrow();
  });
});
