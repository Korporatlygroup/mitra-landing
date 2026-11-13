import net from 'node:net';

/** The standard EICAR antivirus test string (harmless; every scanner flags it). */
export const EICAR = 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface ClamdStub {
  port: number;
  /** number of completed INSTREAM scans */
  readonly scans: number;
  /** size in bytes of the last streamed payload */
  readonly lastSize: number;
  close(): Promise<void>;
}

/**
 * Minimal clamd INSTREAM server for tests.
 * Protocol: "zINSTREAM\0", then [4-byte big-endian length][data] chunks, ended by a zero-length chunk.
 * Reply (NUL-terminated): "stream: OK" or "stream: Eicar-Test-Signature FOUND" when the payload contains EICAR.
 */
export async function startClamdStub(): Promise<ClamdStub> {
  let scans = 0;
  let lastSize = 0;
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let started = false;
    const parts: Buffer[] = [];
    sock.on('error', () => {});
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
          const payload = Buffer.concat(parts);
          scans++;
          lastSize = payload.length;
          const infected = payload.includes(Buffer.from(EICAR, 'latin1'));
          sock.end(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        parts.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    get scans() {
      return scans;
    },
    get lastSize() {
      return lastSize;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A TCP port on which nothing is listening (simulates "scanner down"). */
export async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
