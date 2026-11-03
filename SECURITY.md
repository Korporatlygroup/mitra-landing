# Security

## Reporting
Email tech@korporatlygroup.com with details. Please don't open a public issue for a vulnerability.

## Threat model
The site is a **static Astro build**: HTML, CSS, JS and media files with no server code, database, PHP, login or
stored user data. Most of the attack surface belongs to the host, so hosting choices matter more than the code.

## PHP2Shell (CVE-2026-109618, CVE-2026-109619): assessed 2026-11-03
- **The site: not affected.** It ships no PHP and needs no PHP runtime. The build tool (Astro, Node) never runs PHP.
- **The dev machine: not affected.** PHP isn't installed (no php.exe, XAMPP, WAMP or Laragon).
- **Hosting: the risk depends on the host.**
  - Vercel, Netlify or Cloudflare Pages serve static files without PHP: not affected. (korporatlygroup.com already runs on Vercel.)
  - geta.com.my runs WordPress (PHP) on LiteSpeed. If the page is hosted there, the server's PHP must first be
    patched to **8.5.12 / 8.4.27 / 8.3.36 / 8.2.35 or later**. PHP 8.1 and older are end-of-life and get no fix,
    so they must be upgraded. Ask the hosting provider to confirm the version in writing. Also update WordPress
    core, plugins and themes. A compromised WordPress server could tamper with this page even though the page has no PHP.

## Controls in this repo
| Control | Where | Standard |
|---|---|---|
| Content-Security-Policy (`default-src 'self'`, hashed scripts/styles, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) | `astro.config.mjs` → `security.csp` (emitted as a `<meta>`) | OWASP A03 (injection/XSS), Secure Headers Project |
| HSTS, `frame-ancestors 'none'` + `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP | `vercel.json` (Vercel) and `public/_headers` (Netlify/Cloudflare): keep in sync | OWASP Secure Headers, Mozilla Observatory |
| All assets self-hosted (fonts via @fontsource, media in `public/media/`), no third-party scripts or trackers | `package.json`, `content/media.json` | Supply-chain minimisation, privacy (PDPA 2010) |
| External links `rel="noopener noreferrer"` | `Mitra.astro`, `Contact.astro` | Reverse tabnabbing |
| Enquiry form only renders for an `https://` action; length limits plus a honeypot | `Contact.astro` | OWASP A04, A05 |
| Dependabot weekly updates; `npm audit` clean at assessment | `.github/dependabot.yml` | OWASP A06 |
| No secrets in the repo; `.env*` ignored; raw media and participant data never committed | `.gitignore`, `CLAUDE.md` | OWASP A02, PDPA |

## Before launch (checklist)
- [ ] Pick a host. Static hosting (Vercel/Netlify/Cloudflare Pages) is recommended. If it's geta.com.my, confirm PHP is patched first (see above).
- [ ] Set `site` in `astro.config.mjs`. Enforce HTTPS on the domain.
- [ ] If the enquiry form is enabled, add its host to `form-action` in `astro.config.mjs`, and use a form service with spam filtering and a privacy notice (PDPA).
- [ ] After deploy, scan the live URL at https://securityheaders.com and https://developer.mozilla.org/en-US/observatory, and aim for an A grade.
- [ ] Turn on GitHub secret scanning, push protection and Dependabot alerts (repo Settings → Code security).
- [ ] Require 2FA for everyone with access to the GitHub org, the host and the domain registrar.
- [ ] Run `npm audit` before each release.
