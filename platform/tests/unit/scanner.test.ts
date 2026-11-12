import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseClamdReply, scanWithClamd } from '@/server/scanner';

type Mode = 'ok' | 'found' | 'error' | 'hang' | 'garbage' | 'close';

interface Fake {
  port: number;
  received: Uint8Array | null;
  command: string;
  close(): Promise<void>;
}

/** In-test clamd: speaks just enough of the INSTREAM protocol to check framing and return a canned verdict. */
async function startFake(mode: Mode): Promise<Fake> {
  const fake: Fake = { port: 0, received: null, command: '', close: async () => undefined };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let parsed = false;
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (parsed) return;
      const nul = buf.indexOf(0);
      if (nul === -1) return;
      fake.command = buf.subarray(0, nul).toString();
      let off = nul + 1;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        if (buf.length < off + 4 + len) return;
        parts.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
      parsed = true;
      fake.received = new Uint8Array(Buffer.concat(parts));
      if (mode === 'ok') socket.end('stream: OK\0');
      else if (mode === 'found') socket.end('stream: Win.Test.EICAR_HDB-1 FOUND\0');
      else if (mode === 'error') socket.end('INSTREAM size limit exceeded. ERROR\0');
      else if (mode === 'garbage') socket.end('whatever\0');
      else if (mode === 'close') socket.destroy();
      // 'hang': say nothing
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.port = (server.address() as net.AddressInfo).port;
  fake.close = () =>
    new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    });
  return fake;
}

let open: Fake | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe('parseClamdReply', () => {
  it('parses OK, FOUND and ERROR', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'clean', engine: 'clamd' });
    expect(parseClamdReply('stream: Eicar-Signature FOUND\0')).toEqual({ status: 'infected', engine: 'clamd', signature: 'Eicar-Signature' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR')).toMatchObject({ status: 'unavailable' });
    expect(parseClamdReply('???')).toMatchObject({ status: 'unavailable' });
    expect(parseClamdReply('')).toMatchObject({ status: 'unavailable' });
  });
});

describe('clamd INSTREAM client', () => {
  it('sends zINSTREAM with length-prefixed chunks and reports clean', async () => {
    open = await startFake('ok');
    const payload = new Uint8Array(150_000).map((_, i) => i % 251);
    const r = await scanWithClamd(payload, { host: '127.0.0.1', port: open.port, chunkSize: 64 * 1024 });
    expect(r).toEqual({ status: 'clean', engine: 'clamd' });
    expect(open.command).toBe('zINSTREAM');
    expect(Buffer.from(open.received!).equals(Buffer.from(payload))).toBe(true);
  });

  it('reports infected with the signature', async () => {
    open = await startFake('found');
    const r = await scanWithClamd(new Uint8Array([1, 2, 3]), { host: '127.0.0.1', port: open.port });
    expect(r).toEqual({ status: 'infected', engine: 'clamd', signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('treats ERROR replies, garbage and dropped connections as unavailable (fail closed)', async () => {
    for (const mode of ['error', 'garbage', 'close'] as const) {
      open = await startFake(mode);
      const r = await scanWithClamd(new Uint8Array([1, 2, 3]), { host: '127.0.0.1', port: open.port });
      expect(r.status, mode).toBe('unavailable');
      await open.close();
      open = null;
    }
  });

  it('times out when clamd never answers', async () => {
    open = await startFake('hang');
    const started = Date.now();
    const r = await scanWithClamd(new Uint8Array([1, 2, 3]), { host: '127.0.0.1', port: open.port, timeoutMs: 250 });
    expect(r).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('is unavailable when the host is not configured', async () => {
    expect(await scanWithClamd(new Uint8Array([1]), {})).toMatchObject({ status: 'unavailable', reason: 'not_configured' });
  });

  it('is unavailable when nothing is listening', async () => {
    const probe = await startFake('ok');
    const port = probe.port;
    await probe.close();
    expect(await scanWithClamd(new Uint8Array([1]), { host: '127.0.0.1', port, timeoutMs: 1000 })).toMatchObject({ status: 'unavailable' });
  });
});
