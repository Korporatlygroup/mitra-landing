import { describe, expect, it, vi } from 'vitest';
import { createResendMailer, MailConfigError, MailSendError } from '@/server/mailer';
import { buildNotificationEmail, groupOf, linkPath, runNotificationEmailsOnce, type ClaimedEmail } from '@/server/transactional-email';

const row = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  queue_id: '11111111-1111-4111-8111-111111111111', kind: 'quote.sent', entity_type: 'quotation', entity_id: '22222222-2222-4222-8222-222222222222',
  org_id: '33333333-3333-4333-8333-333333333333', email: 'person@example.test', language: 'en', attempts: 1, ...over,
});

describe('Resend mailer', () => {
  it('refuses to start without a key', () => {
    expect(() => createResendMailer({})).toThrow(MailConfigError);
  });
  it('posts to Resend with the bearer key, INOK sender and an idempotency key, and returns the message id', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const id = await createResendMailer({ RESEND_API_KEY: 're_test_key' }, f as unknown as typeof fetch).send({ to: 'a@example.test', subject: 'S', text: 'T', idempotencyKey: 'k1' });
    expect(id).toBe('msg_1');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer re_test_key');
    expect(h['Idempotency-Key']).toBe('k1');
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'INOK <no-reply@mail.inok.my>', to: ['a@example.test'] });
  });
  it('turns a refusal into an error that carries only the status', async () => {
    const f = vi.fn(async () => new Response('{"message":"secret detail about person@example.test"}', { status: 422 }));
    const err = await createResendMailer({ RESEND_API_KEY: 'k' }, f as unknown as typeof fetch).send({ to: 'a@example.test', subject: 'S', text: 'T' }).catch((e) => e);
    expect(err).toBeInstanceOf(MailSendError);
    expect(String(err.message)).toBe('resend_422');
    expect(JSON.stringify(err)).not.toContain('person@example.test');
  });
  it('reports a network failure as status 0', async () => {
    const f = vi.fn(async () => { throw new Error('boom'); });
    const err = await createResendMailer({ RESEND_API_KEY: 'k' }, f as unknown as typeof fetch).send({ to: 'a@example.test', subject: 'S', text: 'T' }).catch((e) => e);
    expect((err as MailSendError).status).toBe(0);
  });
});

describe('notification email content', () => {
  it('groups kinds written with dots or underscores', () => {
    expect(groupOf('quote.sent')).toBe('quote');
    expect(groupOf('verification_approved')).toBe('verification');
    expect(groupOf('sourcing_rfq_received')).toBe('sourcing');
    expect(groupOf('something.new')).toBe('other');
  });
  it('has a fixed subject, no entity details, a language-prefixed link and the idempotency key', () => {
    const m = buildNotificationEmail(row({ kind: 'enquiry.opened', entity_type: 'enquiry' }), 'https://app.inok.my/');
    expect(m.subject).toBe('INOK: new activity on an enquiry');
    expect(m.text).toContain('https://app.inok.my/en/enquiries/22222222-2222-4222-8222-222222222222');
    expect(m.text).not.toContain('33333333');
    expect(m.idempotencyKey).toBe('notification-email/11111111-1111-4111-8111-111111111111');
    expect(m.html).toContain('INOK');
  });
  it('writes in the person\'s language and falls back to English', () => {
    expect(buildNotificationEmail(row({ language: 'ms' }), 'https://x.test').subject).toMatch(/sebut harga/);
    expect(buildNotificationEmail(row({ language: 'ta' }), 'https://x.test').text).toContain('https://x.test/ta/');
    expect(buildNotificationEmail(row({ language: 'xx' }), 'https://x.test').text).toContain('https://x.test/en/');
  });
  it('never builds a path from a malformed id', () => {
    expect(linkPath(row({ entity_type: 'enquiry', entity_id: '../../admin?x=1' }))).toBe('/notifications');
    expect(linkPath(row({ entity_type: 'quotation' }))).toBe('/notifications');
  });
  it('refuses an address with control characters or several recipients', () => {
    expect(() => buildNotificationEmail(row({ email: 'a@example.test\r\nbcc:x@y.test' }), 'https://x.test')).toThrow();
    expect(() => buildNotificationEmail(row({ email: 'a@example.test, b@example.test' }), 'https://x.test')).toThrow();
  });
});

describe('delivery run', () => {
  const rpcWith = (rows: ClaimedEmail[]) => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push([name, args]);
      return { data: name === 'claim_notification_emails' ? rows : null, error: null };
    });
    return { rpc: rpc as never, calls };
  };
  it('marks sent only after the provider accepted, and keeps going after a failure', async () => {
    const { rpc, calls } = rpcWith([row({ queue_id: 'a' }), row({ queue_id: 'b' })]);
    const send = vi.fn().mockRejectedValueOnce(new MailSendError(503)).mockResolvedValueOnce('msg_2');
    const out = await runNotificationEmailsOnce({ rpc, mailer: { send }, siteUrl: 'https://x.test' });
    expect(out).toMatchObject({ claimed: 2, accepted: 1, failed: 1 });
    const marks = calls.filter(([n]) => n === 'mark_notification_email').map(([, a]) => a);
    expect(marks[0]).toMatchObject({ p_queue: 'a', p_ok: false, p_error: 'resend_503' });
    expect(marks[1]).toMatchObject({ p_queue: 'b', p_ok: true, p_provider: 'msg_2' });
  });
  it('leaves messages queued (not lost) when no mailer is configured', async () => {
    const { rpc, calls } = rpcWith([row()]);
    const out = await runNotificationEmailsOnce({ rpc, mailer: null, siteUrl: 'https://x.test' });
    expect(out.email_unavailable).toBe(true);
    expect(calls.find(([n]) => n === 'mark_notification_email')?.[1]).toMatchObject({ p_ok: false, p_error: 'mailer_not_configured' });
  });
  it('fails the run when the claim itself fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } })) as never;
    await expect(runNotificationEmailsOnce({ rpc, mailer: null, siteUrl: 'x' })).rejects.toThrow(/claim/);
  });
});
