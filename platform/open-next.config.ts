// Cloudflare Workers build settings for the INOK application (OpenNext adapter).
// Staging starts with the adapter's default cache: every page is dynamic (no ISR), so no R2 bucket is needed to deploy.
// An incremental cache (R2) can be added later; see docs/cloudflare-deployment-runbook.md.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
