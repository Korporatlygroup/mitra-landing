// Calls the application's job routes on a schedule. The routes enforce their own bearer secret, rate limits, leases and
// duplicate prevention, and the database refuses work while its switches are off, so a repeated or overlapping call is safe.
interface Env {
  APP_ORIGIN: string;
  GOV_WORKER_SECRET: string;
  CRON_SECRET: string;
}

const worker = {
  async scheduled(controller: { cron: string }, env: Env): Promise<void> {
    const gov = controller.cron === '*/15 * * * *';
    const route = gov ? 'gov' : 'rescan';
    const secret = gov ? env.GOV_WORKER_SECRET : env.CRON_SECRET;
    const res = await fetch(`${env.APP_ORIGIN}/api/v1/jobs/${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55_000),
    });
    // Only the route and the status are logged (never a body or a secret).
    console.log(JSON.stringify({ job: route, status: res.status }));
    if (!res.ok) throw new Error(`job route ${route} answered ${res.status}`);
  },
};

export default worker;
