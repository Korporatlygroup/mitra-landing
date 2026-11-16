# Hosting the full INOK platform on Cloudflare: evaluation, evidence and plan

Date: 2026-11-16. Decision from management: standardise on **Cloudflare (hosting and DNS) and Supabase**; no other hosting provider unless unavoidable. This replaces the Vercel recommendation in `phase1-7-staging-readiness.md` section 1. Everything below was tested **locally** in `workerd` (Cloudflare's open-source Workers runtime, started by `wrangler dev --local`) against the local Supabase stack. **Nothing was deployed to Cloudflare, and hosted behaviour (real network, real limits, real CPU time) is not verified.**

## 1. Access (what I can and cannot see)
| Question | Answer |
|---|---|
| Authenticated access to the Cloudflare account from this machine | **No.** No `wrangler` login, no `CLOUDFLARE_*` variable, no Cloudflare connector in this session. I cannot list Workers, DNS, or builds. |
| Landing page project | A **Cloudflare Worker named `mitra-landing`** (Workers Builds, not a Pages project), in the account whose id appears in the build links (`e28ff6ab…`). Evidence: the GitHub check run "Workers Builds: mitra-landing" by the `cloudflare-workers-and-pages` app on `main` (success, 2026-11-13, script `mitra-landing`, production). |
| GitHub integration | Connected. The Cloudflare Workers & Pages GitHub app is installed and authorised for `Korporatlygroup/mitra-landing` (private; the signed-in GitHub user has admin rights on it). I could not read the installation list (needs `admin:org`), so the evidence is the check run. |
| Repository layout | **One repository holds both**: the Astro landing page at the root and the whole platform in `platform/`. |
| Build settings, root directory, build command, watch paths, env vars | Not visible without Cloudflare access. The Astro config is `output: 'static'`. |
| Non-production branches | Workers Builds also runs on other branches and **fails** on `staging`, `integration/phase1-4` and `platform/phase3-directory` (the repository's own CI is green there). Cause unknown without the build log. It means any push of a platform branch triggers a landing-page build; and a push or merge to `main` redeploys the live `inok.my`. |
| Deployment permission | Unknown for Cloudflare. For GitHub I have read and write rights but will not push or merge without approval. |

### What management must grant (narrowest set)
Prefer a **scoped API token** (dashboard, Manage Account, API Tokens) over any administrator role, limited to the INOK account and the `inok.my` zone. Permission names below are the dashboard's wording as I know it; confirm them in the token screen.
1. Account: Workers Scripts (Edit), Workers R2 Storage (Edit), Workers Builds Configuration (Read; Edit only if I should create the build), Account Settings (Read).
2. Zone `inok.my` only: DNS (Read first; Edit only for the exact records approved), Workers Routes (Edit) or custom domains.
3. Optional, for protecting staging: Access: Apps and Policies (Edit).
4. A person with the Super Administrator or Administrator role keeps the actions that I should not hold: billing (Workers Paid plan), account members, and the final DNS change.
5. Or no token at all: management can run the commands I prepare (`wrangler login` on their side) and tell me the result.
Pasting a token into chat is not needed; it can be placed in an environment variable on this machine.

## 2. Can the application run on Workers? Evidence
Method: `@opennextjs/cloudflare@1.20.17` and `wrangler@4.162.0` installed in a **scratch copy** of the integrated branch (the repository is unchanged). The adapter's peer range is `next >=16.4.5`, matching the application's Next 16.4.5.

| Check | Result |
|---|---|
| Build of the unmodified application | **Succeeds** (all routes, the proxy, the 10 API routes). Warning: Node.js middleware (the Next 16 `proxy.ts`) is "experimental" in the adapter and not officially maintained by OpenNext. |
| Bundle size | 15.5 MiB uncompressed, **2,993 KiB gzip** in total: only just under the free plan's 3 MiB limit; fine for the 10 MiB paid limit. The paid plan is expected anyway for CPU time. |
| Health and pages in workerd | `/api/v1/health` 200; `/en` 200 (the 230 KB page). |
| Browser journeys through the Workers build (Playwright, desktop, local Supabase) | Subset run 1 (27 tests): 26 passed, 1 failed. Larger run (80 tests across auth, MFA, security, uploads, reviewer, directory, quotations, partner and buyer catalogue, sourcing, government assistance, admin workflow, Malay): **78 passed, 2 failed**. The two failures are described in section 3 (items 2 and 3). These are single local runs, not a full regression: the remaining 130 tests were not run on the Workers build. |
| Supabase auth and SSR sessions, sign-up, sign-in, password reset, errors | Passed in the runs above (specs e1, e13, e5 admin MFA, e7, e8, e10 with the one intermittent failure noted in section 3, item 2b). |
| Server actions, API routes | Passed (forms in every journey; route handlers for documents, health, jobs). |
| Database connectivity | Passed (Supabase over HTTPS from the Worker). |
| Private uploads and downloads | Passed (e23 uploads with the scan stub, e26 download security). |
| Malware scanning over TCP (clamd INSTREAM) | **Works** in a probe Worker using the real `scanWithClamd`: clean file reported clean, EICAR reported infected, a closed port reported `unavailable` (fail-closed). |
| SMTP email (nodemailer, the real `createSmtpMailer`) | **Works** in the probe Worker: the message arrived in the local mail catcher. Real provider delivery not tested. |
| Scheduler routes `/api/v1/jobs/gov` and `/api/v1/jobs/rescan` | 200 with the right bearer, 401 with a wrong one, 404 when the secret is unset, 405 for GET. |
| Government source fetching (`safeFetch`, the SSRF guard) | **Does not work unchanged.** See section 3. |

## 3. Exact incompatibilities and the smallest fixes
1. **Government monitor fetch (`src/server/gov/safe-fetch.ts`).** `https.request(url, { lookup, agent: false })` throws `The options.lookup option is not implemented` in Workers (isolated: `agent: false` and `timeout` work; only `lookup` fails). The `lookup` hook is how the guard refuses private addresses at connect time. Everything else in that module works (`dns.promises.lookup` and `resolve4` return real answers).
   Smallest fix, no external service: the module already accepts an injectable `transport`. Add a second transport for the Workers runtime that pre-resolves with the same guard, then uses `fetch` with manual redirects (prepared in `deploy/cloudflare-app/workers-fetch-transport.ts.template`; not applied). In the probe: a public page returned 200 and a public name that resolves to 127.0.0.1 was refused as `private_address`. Trade-off: the address is checked before the request rather than pinned at connect time; Workers cannot reach private networks, which limits the exposure. This is a security-relevant code change and needs your approval plus its own tests.
2. **Stale form after a server action: unresolved, reproducible.** The E2E test e81 "B + C" (a second edit of a saved programme's tracking stage) failed in 4 of 5 runs on the Workers build and passed in every Node run (two full desktop runs, one mobile, earlier runs). After the first save the database holds the new stage and the page shows "Updated.", but the form still shows the old stage, so the next save overwrites it with the old value. Configuring the adapter's R2 incremental cache did not fix it (one passing run, then a failure in the larger run; the pass is not evidence). Hypotheses not yet proven: the refreshed page data after `revalidatePath('/', 'layout')` is not reaching the form in the Workers runtime, or React resets the form to stale defaults. A real defect risk for any form that relies on refreshed defaults; it must be root-caused before Cloudflare staging is called accepted. A test-only wait did not fix it, so I did not keep that change.
2b. **Intermittent locale redirect.** E10 "weak password" ended on `/en/signup` instead of `/ta/signup/check-email` once in the 80-test run; run alone it passed 4 of 4. Not understood; may be timing, may be a Workers-only difference in the locale cookie or redirect. Needs repeats on staging.
3. **Next 16 proxy as Node middleware** is experimental in the adapter. It worked in every tested journey, but it is the component most exposed to adapter changes. Pin the adapter version, test every upgrade.
4. **Not testable locally:** Workers CPU-time and subrequest limits for heavy pages, cold-start latency, the Cloudflare network path to Supabase (Singapore) and to the SMTP provider, outbound TCP restrictions (port 25 is blocked on Workers; 465 and 587 are the usual ports for SMTP), and the paid-plan requirement. These need a staging deployment.
5. **Email transport risk.** nodemailer over TCP worked locally, but if a provider's TLS or connection behaviour fails from the Cloudflare network, the fallback is an HTTPS send (Resend API) behind the existing mailer function: a small code change, only if staging shows it is needed.
6. **Malware scanner host.** clamd itself cannot run in a Worker. It needs a small always-on container or VM reachable over TCP from the Worker (for example a Cloudflare Container, or a small VM). Workers can open outbound TCP to a public host; the scanner port should be restricted and the traffic should not cross the internet unencrypted (put it behind a tunnel, or use a scanning service with an HTTPS API instead). This is the one external service that cannot be avoided.
7. **Windows test-runner crash** (3221226505) is unrelated to Cloudflare; it appeared once in a Playwright worker during this evaluation, matching `test-runner-crash-investigation.md`.

## 4. Architecture (prepared, nothing changed)
```
inok.my            -> existing Worker "mitra-landing" (Astro static)           unchanged
app.inok.my        -> Worker "inok-app-production" (OpenNext)                  custom domain, after approval
staging.inok.my    -> Worker "inok-app-staging" (OpenNext) behind Cloudflare Access
scheduler          -> Worker "inok-scheduler-<env>" (Cron Triggers) -> app job routes (POST + bearer secret)
cache              -> one R2 bucket per environment (incremental cache)
data               -> Supabase: mitra-staging (staging), inok-production (production); clamd host; mail provider (last)
```
- **Same repository, separate Workers.** Keep the landing Worker building from `main` at the repository root. Create the app Workers as additional Workers Builds projects on the same repository with **root directory `platform`**, and set **build watch paths** on every project so a landing change does not rebuild the app and a platform change does not rebuild the landing page (landing: exclude `platform/**`; app: include `platform/**`). Staging builds from the `staging` branch; production from `main` (or a `release` branch, which is safer: merging platform code to `main` would otherwise also trigger the landing build unless watch paths exclude it).
- **Fix the failing branch builds** on the landing Worker (read the build log; probably a non-production branch build setting) before pushing platform branches, so they stop showing red.
- **Domains.** Attach `app.inok.my` and `staging.inok.my` as Worker custom domains (Cloudflare creates proxied DNS records). These are DNS changes on the live zone, so each needs your approval; the apex `inok.my` record is not touched.
- **Staging protection.** Cloudflare Access on `staging.inok.my` (email one-time-PIN for named testers). The scheduler must not be blocked: call the app from the scheduler Worker with a **service binding** instead of a public URL, or add an Access bypass for `/api/v1/jobs/*` (the routes still require their bearer secret). Also send `X-Robots-Tag: noindex` on staging.
- **Auth redirects.** Supabase Auth Site URL = the Worker's origin (`https://staging.inok.my`, later `https://app.inok.my`); allow-list `https://<origin>/auth/callback` only. The app redirects users to the right dashboard after sign-in (browser-tested locally).
- **Landing page links** (not edited): Register Your Business -> `https://app.inok.my/en/signup`; Sign In -> `https://app.inok.my/en/login`; Explore Businesses -> `https://app.inok.my/en/directory`; Government Assistance -> `https://app.inok.my/en/business-help`. Use `/ms` or `/ta` for the other languages. Do not call registration official MITRA enrolment.

## 5. Approval gates (nothing below has been done)
1. Approve adding the adapter and wrangler as dev dependencies, the two config files, and the Workers fetch transport (code + tests). Local commit only.
2. Management provides a scoped Cloudflare token (or runs the commands). Create `inok-app-staging`, its R2 bucket, and the build project. No DNS yet.
3. Approve the staging custom domain and Access policy. Deploy staging; run the staging acceptance suite against the real Worker.
4. Approve the scheduler Worker for staging; run one full cycle.
5. Only after staging acceptance: production Worker, `app.inok.my`, and the landing-page links.
