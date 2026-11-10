import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The repo root holds an unrelated Astro site with its own lockfile; pin Turbopack to this app.
  turbopack: { root: path.resolve(import.meta.dirname) },
  reactStrictMode: true,
  agentRules: false,
  // Document uploads (max 10 MiB, enforced by the server action itself) go through a server action AND through the
  // proxy. Next buffers the request body for the proxy and silently truncates it at proxyClientMaxBodySize (default
  // 10 MB), which broke uploads of ~10 MiB with "Unexpected end of form". Both limits sit above 10 MiB + multipart
  // overhead so the action's own check stays authoritative and over-limit files get the clear "file too large" message.
  //
  // KNOWN RESIDUAL RISK: these limits apply to every proxied route, not only uploads. src/proxy.ts refuses POSTs over
  // 1 MB (by Content-Length) outside the two upload pages, but /api and /auth bypass the proxy and chunked bodies carry
  // no length; put edge/WAF body limits in front, or move uploads to a dedicated route in a later hardening pass.
  experimental: {
    serverActions: { bodySizeLimit: '16mb' },
    proxyClientMaxBodySize: '16mb',
  },
  async headers() {
    const common = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ];
    return [
      { source: '/:path*', headers: common },
      // Pages get a per-request nonce CSP from src/proxy.ts (see src/lib/csp.ts). The proxy does not run for
      // these two non-page route groups (JSON and redirects only), so they get a locked-down static policy.
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" }],
      },
      {
        source: '/auth/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
