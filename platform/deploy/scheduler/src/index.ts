// Calls the application's job routes on a schedule. The routes enforce their own bearer secret, rate limits, leases and
// duplicate prevention, and the database refuses work while its switches are off, so a repeated or overlapping call is safe.
// When an APP service binding exists the call stays inside Cloudflare (no public hop, and it works behind Cloudflare Access);
// otherwise it uses a public fetch to APP_ORIGIN.
interface Env {
  APP_ORIGIN: string;
  GOV_WORKER_SECRET: string;
  CRON_SECRET: string;
  APP?: { fetch: (request: Request) => Promise<Response> };
}

async function callJob(env: Env, route: 'gov' | 'rescan'): Promise<{ job: string; status: number }> {
  const secret = route === 'gov' ? env.GOV_WORKER_SECRET : env.CRON_SECRET;
  const request = new Request(`${env.APP_ORIGIN}/api/v1/jobs/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
  const res = env.APP ? await env.APP.fetch(request) : await fetch(request, { signal: AbortSignal.timeout(55_000) });
  return { job: route, status: res.status };
}

const worker = {
  async scheduled(controller: { cron: string }, env: Env): Promise<void> {
    const route = controller.cron === '*/15 * * * *' ? 'gov' : 'rescan';
    const out = await callJob(env, route);
    // Only the route and the status are logged (never a body or a secret).
    console.log(JSON.stringify(out));
    if (out.status < 200 || out.status >= 300) throw new Error(`job route ${route} answered ${out.status}`);
  },
  // Manual, authenticated trigger for one controlled run: POST /run/gov or /run/rescan with the scheduler's own secret.
  async fetch(request: Request, env: Env & { SCHEDULER_TRIGGER_SECRET?: string }): Promise<Response> {
    const url = new URL(request.url);
    const m = /^\/run\/(gov|rescan)$/.exec(url.pathname);
    const secret = env.SCHEDULER_TRIGGER_SECRET;
    if (!m || request.method !== 'POST' || !secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Not found', { status: 404 });
    const out = await callJob(env, m[1] as 'gov' | 'rescan');
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  },
};

export default worker;
