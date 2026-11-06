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
