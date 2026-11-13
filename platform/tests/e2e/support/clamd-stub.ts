import http from 'node:http';
import net from 'node:net';
import { CLAMD_CONTROL_PORT, CLAMD_PORT } from './env';

/**
 * The standard EICAR antivirus test string, built from two pieces so this source file itself does not trip
 * an on-access scanner (the stub below matches the joined string).
 */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface StubHandle {
  close(): Promise<void>;
}

/**
 * Stub clamd (INSTREAM protocol) on a fixed local port, plus a tiny HTTP control server so specs (which run in
 * worker processes) can switch the scanner "down" (connections refused) and "up" again.
 *   GET /down  /up  /scans
 */
export async function startClamdStub(): Promise<StubHandle> {
  let scans = 0;
  const sockets = new Set<net.Socket>();

  const handler = (sock: net.Socket) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let started = false;
    const parts: Buffer[] = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        if (buf.length < 10) return;
        if (buf.subarray(0, 10).toString('latin1') !== 'zINSTREAM\0') {
          sock.end('UNKNOWN COMMAND\0');
          return;
        }
        buf = buf.subarray(10);
        started = true;
      }
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          scans++;
          const infected = Buffer.concat(parts).includes(Buffer.from(EICAR, 'latin1'));
          sock.end(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        parts.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  };

  let server: net.Server | null = null;
  const up = async () => {
    if (server) return;
    const s = net.createServer(handler);
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(CLAMD_PORT, '127.0.0.1', () => resolve());
    });
    server = s;
  };
  const down = async () => {
    const s = server;
    server = null;
    if (!s) return;
    for (const sock of sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  };

  await up();
  const control = http.createServer((req, res) => {
    const done = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);
    };
    if (req.url === '/down') void down().then(() => done('down'));
    else if (req.url === '/up') void up().then(() => done('up'), () => done('error'));
    else if (req.url === '/scans') done(String(scans));
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => control.listen(CLAMD_CONTROL_PORT, '127.0.0.1', () => resolve()));

  return {
    close: async () => {
      await down();
      await new Promise<void>((resolve) => control.close(() => resolve()));
    },
  };
}

/** Used by specs (worker processes). */
export const scanner = {
  async down(): Promise<void> {
    await fetch(`http://127.0.0.1:${CLAMD_CONTROL_PORT}/down`);
  },
  async up(): Promise<void> {
    const r = await fetch(`http://127.0.0.1:${CLAMD_CONTROL_PORT}/up`);
    if ((await r.text()) !== 'up') throw new Error('stub scanner could not come back up');
  },
  async scans(): Promise<number> {
    return Number(await (await fetch(`http://127.0.0.1:${CLAMD_CONTROL_PORT}/scans`)).text());
  },
};
