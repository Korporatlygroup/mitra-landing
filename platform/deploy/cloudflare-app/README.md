# Cloudflare Workers deployment files (prepared, not wired, nothing deployed)

See `docs/cloudflare-hosting-evaluation.md` for the evidence and the approval gates.
Adding these files to the build also needs `@opennextjs/cloudflare@1.20.17` and `wrangler` as dev dependencies in `platform/package.json` (tested versions) and these scripts:
`"cf:build": "opennextjs-cloudflare build"`, `"cf:deploy": "opennextjs-cloudflare deploy"`.
Required secrets per environment: `SUPABASE_SECRET_KEY`, `SMTP_URL`, `CLAMD_HOST`, `CLAMD_PORT`, `CRON_SECRET`, `GOV_WORKER_SECRET`, `GOV_WORKER_CONTACT`.

The Workers fetch transport for the government monitor is already in `src/server/gov/safe-fetch.ts` (selected automatically inside a Worker).
