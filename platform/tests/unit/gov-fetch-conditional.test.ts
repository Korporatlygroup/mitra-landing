import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { safeFetch, type Transport } from '@/server/gov/safe-fetch';

const HOSTS = ['www.mitra.gov.my'];

function recording(status: number, headers: Record<string, string>, body = ''): { transport: Transport; sent: Record<string, string>[] } {
  const sent: Record<string, string>[] = [];
  const transport: Transport = async (_url, init) => {
    sent.push(init.headers);
    const stream = Readable.from([Buffer.from(body)]);
    return { status, headers, stream, destroy: () => stream.destroy() };
  };
  return { transport, sent };
}

describe('conditional requests', () => {
  it('sends the stored validators', async () => {
    const { transport, sent } = recording(304, { etag: '"v2"' });
    await safeFetch('https://www.mitra.gov.my/ms/modal-insan', {
      allowedHosts: HOSTS, userAgent: 'T', transport, validators: { etag: '"v1"', lastModified: 'Thu, 22 Oct 2026 08:00:00 GMT' },
    });
    expect(sent[0]!['If-None-Match']).toBe('"v1"');
    expect(sent[0]!['If-Modified-Since']).toBe('Thu, 22 Oct 2026 08:00:00 GMT');
  });
  it('treats 304 as not modified: no body, no content-type check, validators returned', async () => {
    const { transport } = recording(304, { etag: '"v1"', 'last-modified': 'Thu, 22 Oct 2026 08:00:00 GMT' });
    const r = await safeFetch('https://www.mitra.gov.my/ms/modal-insan', { allowedHosts: HOSTS, userAgent: 'T', transport, validators: { etag: '"v1"' } });
    expect(r.status).toBe(304);
    expect(r.text).toBe('');
    expect(r.etag).toBe('"v1"');
    expect(r.lastModified).toBe('Thu, 22 Oct 2026 08:00:00 GMT');
  });
  it('sends no validator headers when none are stored', async () => {
    const { transport, sent } = recording(200, { 'content-type': 'text/html; charset=utf-8', etag: '"a"' }, '<p>hi</p>');
    const r = await safeFetch('https://www.mitra.gov.my/ms/modal-insan', { allowedHosts: HOSTS, userAgent: 'T', transport });
    expect(sent[0]).not.toHaveProperty('If-None-Match');
    expect(sent[0]).not.toHaveProperty('If-Modified-Since');
    expect(r.etag).toBe('"a"');
  });
  it('never puts a malformed validator on the wire', async () => {
    const { transport, sent } = recording(200, { 'content-type': 'text/html' }, 'x');
    await safeFetch('https://www.mitra.gov.my/x', { allowedHosts: HOSTS, userAgent: 'T', transport, validators: { etag: '"a"\r\nX-Evil: 1', lastModified: 'bad\nvalue' } });
    expect(sent[0]).not.toHaveProperty('If-None-Match');
    expect(sent[0]).not.toHaveProperty('If-Modified-Since');
  });
  it('a 200 with new content still returns the body and fresh validators', async () => {
    const { transport } = recording(200, { 'content-type': 'text/html', etag: '"v2"' }, '<p>new</p>');
    const r = await safeFetch('https://www.mitra.gov.my/x', { allowedHosts: HOSTS, userAgent: 'T', transport, validators: { etag: '"v1"' } });
    expect(r.status).toBe(200);
    expect(r.text).toContain('new');
    expect(r.etag).toBe('"v2"');
  });
});
