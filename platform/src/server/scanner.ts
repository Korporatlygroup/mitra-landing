import net from 'node:net';

/**
 * ClamAV `clamd` INSTREAM client over TCP, no dependencies.
 * Protocol: send "zINSTREAM\0", then chunks of [4-byte big-endian length][data], then a zero-length chunk;
 * clamd answers "stream: OK", "stream: <signature> FOUND" or "... ERROR" (NUL-terminated).
 *
 * Fail-closed contract: anything other than a definite OK / FOUND answer is `unavailable`, and the pipeline then
 * quarantines the file (stored privately, status "pending", never served).
 */

export type ScanOutcome =
  | { status: 'clean'; engine: string }
  | { status: 'infected'; engine: string; signature: string }
  | { status: 'unavailable'; engine: string; reason: string };

export interface ClamdOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  chunkSize?: number;
}

export type Scanner = (bytes: Uint8Array) => Promise<ScanOutcome>;

const ENGINE = 'clamd';
const unavailable = (reason: string): ScanOutcome => ({ status: 'unavailable', engine: ENGINE, reason });

/** Parses a clamd reply line. Exported for tests. */
export function parseClamdReply(reply: string): ScanOutcome {
  const text = reply.replace(/\0/g, '').trim();
  if (/ERROR$/.test(text)) return unavailable('clamd_error');
  if (/FOUND$/.test(text)) {
    const m = text.match(/^stream:\s*(.*?)\s+FOUND$/);
    return { status: 'infected', engine: ENGINE, signature: (m?.[1] ?? 'unknown').slice(0, 120) };
  }
  if (/^stream:\s*OK$/.test(text)) return { status: 'clean', engine: ENGINE };
  return unavailable('unexpected_reply');
}

export function scanWithClamd(bytes: Uint8Array, opts: ClamdOptions = {}): Promise<ScanOutcome> {
  const { host, port = 3310, timeoutMs = 15_000, chunkSize = 64 * 1024 } = opts;
  if (!host) return Promise.resolve(unavailable('not_configured'));

  return new Promise<ScanOutcome>((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const socket = net.connect({ host, port });

    const finish = (outcome: ScanOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(timeoutMs, () => finish(unavailable('timeout')));
    socket.on('error', () => finish(unavailable('connection_error')));
    socket.on('data', (d: Buffer) => {
      chunks.push(d);
      // A z-command reply ends with NUL; stop as soon as we have it.
      if (d.includes(0)) finish(parseClamdReply(Buffer.concat(chunks).toString('utf8')));
    });
    socket.on('end', () => {
      if (!chunks.length) finish(unavailable('no_reply'));
      else finish(parseClamdReply(Buffer.concat(chunks).toString('utf8')));
    });
    socket.on('close', () => {
      if (!settled) finish(chunks.length ? parseClamdReply(Buffer.concat(chunks).toString('utf8')) : unavailable('closed'));
    });

    socket.on('connect', () => {
      try {
        socket.write('zINSTREAM\0');
        for (let off = 0; off < bytes.length; off += chunkSize) {
          const part = Buffer.from(bytes.subarray(off, Math.min(off + chunkSize, bytes.length)));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length, 0);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk: end of stream
      } catch {
        finish(unavailable('write_error'));
      }
    });
  });
}

/** Small semaphore: at most `max` tasks run at once, the rest wait in order. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** At most 4 concurrent clamd connections per process, so uploads cannot open unlimited scanner connections. */
export const MAX_CONCURRENT_SCANS = 4;
const limit = createLimiter(MAX_CONCURRENT_SCANS);

/** Scanner configured from CLAMD_HOST / CLAMD_PORT. CLAMD_HOST unset means `unavailable` (fail closed to quarantine). */
export const scanBytes: Scanner = (bytes) =>
  limit(() =>
    scanWithClamd(bytes, {
      host: process.env.CLAMD_HOST || undefined,
      port: process.env.CLAMD_PORT ? Number(process.env.CLAMD_PORT) : 3310,
    }),
  );
