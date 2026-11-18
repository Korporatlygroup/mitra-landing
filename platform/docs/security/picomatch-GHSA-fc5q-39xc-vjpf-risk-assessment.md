# Risk assessment: picomatch ReDoS (GHSA-fc5q-39xc-vjpf) in the dependency audit

Status: **APPROVED by the owner on 2026-11-18 (narrow, temporary exception for GHSA-fc5q-39xc-vjpf only, expiring 2027-01-15) and implemented** in `platform/scripts/audit-gate.mjs` and the CI audit step. Before approval the audit step was `npm audit --audit-level=high` and failed because of this advisory.
Date of assessment: 2026-11-18. Project: `platform/` (INOK). Scope examined: lockfile, installed tree, the generated Cloudflare Worker bundle (`.open-next/`), upstream release data.

## 1. The advisory

- GHSA-fc5q-39xc-vjpf, "picomatch vulnerable to ReDoS through single-branch repeated extglobs", CVSS 7.5 (high).
- Published 2026-10-19; **updated 2026-11-17 15:56 UTC**: the vulnerable range now reads `<= 4.0.7` with **no patched version**.
  Until that update the project's pinned `4.0.7` was treated as fixed, which is why CI passed on 2026-11-17 morning and fails now with no change to our dependencies.
- Upstream: picomatch's newest release is 4.0.7 (2026-08-24). Nothing newer exists, so there is nothing to upgrade to. (npm's `fixAvailable` hints only point at breaking downgrades of unrelated tools, e.g. vitest 3.1.4; those do not remove picomatch.)

## 2. Every path that brings picomatch in (from `npm explain picomatch` and the lockfile)

| Installed copy | Pulled in by | Kind |
|---|---|---|
| `picomatch@2.3.2` (root) | `micromatch@4.0.8` <- `fast-glob@3.3.1` <- `@next/eslint-plugin-next` <- `eslint-config-next` ; and `fast-glob@3.3.3` <- `@node-minify/utils` <- `@node-minify/core`/`terser` <- `@opennextjs/aws` <- `@opennextjs/cloudflare` | dev only (lint; Cloudflare build tool) |
| `picomatch@4.0.7` (`tinyglobby/node_modules`, `vite/node_modules`, `vitest/node_modules`) | `tinyglobby` <- `vite`, `vitest`, `@typescript-eslint/*` <- `typescript-eslint` <- `eslint-config-next` | dev only (tests, lint) |
| `picomatch@4.0.7` (`@parcel/watcher/node_modules`) | `@parcel/watcher@2.6.0` <- **`next-intl@4.14.9`** (a `dependencies` entry) | listed as production by `npm audit --omit=dev` |

`npm audit --omit=dev` reports exactly 2 high findings: `@parcel/watcher` and `picomatch`, both from the last row (next-intl).

## 3. Can anything be upgraded, removed or replaced safely?

Checked against the registry on 2026-11-18:

- `next-intl` latest is 4.15.1 and still depends on `@parcel/watcher ^2.4.1`.
- `@parcel/watcher` latest is 2.6.0 (installed) and depends on `picomatch ^4.0.4`.
- `tinyglobby` latest is 0.2.17 (installed) and depends on `picomatch ^4.0.4`; `vitest` 5.1.0 and `@opennextjs/cloudflare` 1.20.17 are the latest; `vite` and `eslint-config-next` have only patch updates that keep the same dependencies.
- `overrides` cannot help: every picomatch version at or below 4.0.7 (including 2.x and 3.x) is inside the affected range, and no other implementation is drop-in for these packages.
- Removing `@parcel/watcher` (override to a stub) or dropping next-intl would be unsupported and would risk breaking the build; it is not recommended for a risk that is not reachable (section 4).

Result: **no safe remediation exists today.** Re-check when picomatch publishes a patched release.

## 4. Is the vulnerable code in, or reachable from, production?

- **Worker bundle** (`npm run cf:build:production`, `.open-next/`): searched for picomatch and for `@parcel/watcher`.
  - `@parcel/watcher`: **not present** in the bundle.
  - npm `picomatch` package (`node_modules/picomatch`): **not present** in the bundle.
  - The only occurrences are inside Next.js's own vendored copy `next/dist/compiled/picomatch` (not resolved by npm and not flagged by `npm audit`), used by Next for image `remotePatterns`/local patterns and build tracing. This project has no `images` configuration and does not import `next/image`.
- **How next-intl uses the watcher:** `@parcel/watcher` is imported only by next-intl's optional source-file *extractor* (`SourceFileWatcher`), which runs in the Node process during `next dev`/`next build` when the extractor feature is configured. `next.config.ts` only uses `createNextIntlPlugin('./src/i18n/request.ts')`; the extractor is not enabled, and nothing from it is bundled into the Worker.

## 5. Exploitability

The flaw is a regular-expression denial of service: it needs an attacker-controlled **glob pattern** containing repeated single-branch extglobs to be compiled by picomatch. In this project:

- No request path (page, server action, API route, cron job) accepts a glob pattern from a user or from stored data.
- Dev tools (ESLint, vitest, vite, tinyglobby, fast-glob, the OpenNext build) compile patterns written in the repository's own config files.
- Impact if it were triggered: CPU exhaustion of a CI job or a developer machine, not data exposure or code execution.

## 6. CI exposure

- Where it runs: GitHub Actions jobs (checks and four E2E shards) and developers' machines.
- Secrets in those jobs: none beyond the local demo Supabase keys (the workflow is documented as "no secrets, no hosted services").
- Patterns come from files in the pull request under review. A malicious pull request could in principle put a crafted pattern in a tool config file; the effect would be a slow or timed-out CI job (the job has `timeout-minutes`).

## 7. Compensating controls

- Production bundle verified free of the npm picomatch and of `@parcel/watcher` (rerun the check at each release: `grep -rIl "node_modules/picomatch\|parcel/watcher" platform/.open-next`).
- CI job timeouts (45 and 60 minutes) bound the damage of a hung job.
- Pull requests are reviewed before merge; branch protection stays in place.
- `npm audit` stays strict for every other advisory.

## 8. Proposed exception scope (for approval; not applied)

If approved, apply it narrowly:

- Only advisory **GHSA-fc5q-39xc-vjpf**, only while the advisory has no patched version.
- Implemented as an explicit allow-list entry in the audit step (for example `scripts/audit-gate.mjs`, prepared but **not committed**), which still fails on any other high or critical advisory.
- **Expiry date** in the file (proposed 2027-01-15); after it the gate fails again.
- The entry records the reason and a link to this document.
- A reminder to re-run `npm outdated picomatch` and `npm audit` weekly until a patched release appears, then delete the exception.

Alternative the approver may prefer: keep CI strict and wait for a patched picomatch (the release would be blocked until then).

## 9. Decision and implementation

The owner approved the exception in section 8 on 2026-11-18. Implementation:

- `scripts/audit-gate.mjs` runs `npm audit --json`, writes the raw report to `reports/npm-audit-raw.json` (uploaded as the `platform-check-reports` CI artifact) and evaluates it.
- Exceptions are per advisory id (never per package). A different advisory on the same package still fails. Anything high or critical that is not on the list fails.
- The exception is valid strictly before **2027-01-15**; on that date the gate fails again.
- The gate fails closed: unparsable output, an unexpected report version/shape, an advisory without an id, or a high finding with no advisory behind it all fail the job.
- Unit tests (`tests/unit/audit-gate.test.ts`) cover the exception, a second advisory on the same package, a critical advisory, expiry on and after the date, and the fail-closed cases.
- To remove the exception: delete the `EXCEPTIONS` entry once a patched picomatch is released and installed.
