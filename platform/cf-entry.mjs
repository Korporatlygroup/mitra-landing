// Worker entry for the INOK application: access gate in front of the OpenNext handler.
// While ACCESS_GATE is "required" (every pre-launch Worker), a request is served only if it carries the access key, as HTTP Basic
// credentials (any user name, the key as password), the x-inok-access-key header, or the inok_access cookie. A missing key
// configuration denies everything (fail closed). The scheduler's job routes and the health check stay reachable: the job routes
// enforce their own bearer secret and answer 404/401 otherwise. Removing the gate for launch is a deliberate config change.
import app from './.open-next/worker.js';
import { servePublicPage } from './public-page-cache.mjs';

export * from './.open-next/worker.js';

const OPEN_PATHS = new Set(['/api/v1/health', '/api/v1/jobs/gov', '/api/v1/jobs/rescan']);

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i += 1) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

function presentedKey(request) {
  const header = request.headers.get('x-inok-access-key');
  if (header) return header;
  const auth = request.headers.get('authorization') ?? '';
  if (/^basic /i.test(auth)) {
    try {
      const decoded = atob(auth.slice(6).trim());
      return decoded.slice(decoded.indexOf(':') + 1);
    } catch {
      return '';
    }
  }
  const cookie = /(?:^|;\s*)inok_access=([^;]+)/.exec(request.headers.get('cookie') ?? '');
  return cookie ? decodeURIComponent(cookie[1]) : '';
}

export default {
  async fetch(request, env, ctx) {
    if (env.ACCESS_GATE === 'required') {
      const path = new URL(request.url).pathname;
      if (!OPEN_PATHS.has(path)) {
        const key = env.ACCESS_GATE_KEY;
        const given = presentedKey(request);
        if (!key || !given || !(await sameSecret(given, key))) {
          return new Response('Authentication required', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="INOK pre-launch", charset="UTF-8"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
          });
        }
      }
    }
    return servePublicPage(request, () => app.fetch(request, env, ctx), { ctx });
  },
};
