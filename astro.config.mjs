import { defineConfig } from 'astro/config';

// Static output. Set `site` once hosting is decided (geta.com.my / korporatlygroup.com / standalone).
export default defineConfig({
  output: 'static',
  // Emit every asset (incl. small font subsets) as a file rather than a data: URI, so font-src stays 'self'.
  vite: { build: { assetsInlineLimit: 0 } },
  // Content-Security-Policy as a <meta> tag: Astro hashes every bundled/inline script and style.
  // Everything is self-hosted (fonts, media), so only 'self' is allowed. Headers a <meta> tag
  // can't carry (frame-ancestors, HSTS, ...) are set by the host: see vercel.json and public/_headers.
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "media-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        // Add the enquiry-form host here once contact.formAction is set.
        "form-action 'self'",
        'upgrade-insecure-requests',
      ],
      // Reveal delays are inline style="--d:…" attributes: CSS custom properties only, no script.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
    },
  },
});
