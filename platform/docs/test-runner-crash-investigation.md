# Investigation: test worker exits with code 3221226505 (0xC0000409)

Date: 2026-11-15. Machine: Windows 11 Pro 10.0.26200, AMD Ryzen 5 7500F (12 logical processors), 15.7 GB RAM, Node.js v24.15.0 (the "Krypton" LTS line, V8 13.6, libuv 1.51, OpenSSL 3.5.5), Vitest 5.1.0, Playwright 1.65.0, Next.js 16.4.5, Supabase CLI 3.0.0 with Docker. Everything below is local evidence. Nothing was changed in application code to hide or avoid the crash.

## What the code 3221226505 is
`0xC0000409` is `STATUS_STACK_BUFFER_OVERRUN`. Windows uses it for any "fast fail": a stack-cookie check, a failed `abort()` or `CHECK` inside Node or V8, or a control-flow or shadow-stack violation. It says a process killed itself on a fatal internal condition, not which one.

## Observations
| Experiment | Runs | Result |
|---|---|---|
| Bare Node children started with no application code (sequential 300, parallel 12 and 24: 1,500 processes, each allocating 8 MB) | 1,500 | **0 crashes** |
| Unit suite, process pool (`--pool=forks`), repeated | 40 runs (about 1,500 worker starts) | **0 crashes** |
| Integration suite (about 19 test files, one worker process per file, one file at a time), process pool | 11 runs | **3 crashes** (runs 1, 6, 10) |
| Integration suite, thread pool (`--pool=threads`) | 3 runs | **0 crashes** |
| Earlier sessions, same machine (earlier branch) | several | the same code at worker start in vitest and in two Playwright specs |

- Every integration crash had the same shape: `Worker exited unexpectedly with exit code 3221226505 during started state while running test file <file>`. The worker died while starting, before it ran any test code. The files were `hardening`, `p7-worker` and `mfa`: a different file each time, so no test file is the cause.
- The process was started with `NODE_OPTIONS=--report-on-fatalerror`. **No diagnostic report was written** for any crash. A V8 or Node fatal error that goes through Node's own handler writes one, so these deaths bypass it (an immediate fast fail or an operating-system level termination).
- Roughly 3 crashes in about 200 integration worker starts (about 1.5 percent each). The unit runs show none in about 1,500 starts, so process creation alone is not enough.
- Windows recorded no application-error or WER entries for node.exe in the last four days (only unrelated GPU "LiveKernelEvent" entries), so there is no faulting module name to read. Crash dumps are not enabled.
- The machine is under memory pressure: 3.0 to 3.2 GB of 15.7 GB physical memory free and 58 to 64 Docker containers running (many Supabase stacks left by other work trees; this investigation did not stop any that are not its own). Commit headroom was 9 GB free. A memory sampler (`p17logs/mem.log`) ran during the full browser run.
- Windows Defender real-time protection is on. Whether node.exe or the project folders are excluded could not be read (administrator rights needed). The CET user shadow stack mitigation for node.exe is not set at the system level.

## Not the cause (evidence)
- Bare Node start-up on this runtime, even under 24 parallel starts: 0 of 1,500.
- A specific test file or application code path: the file differs each time, and the death precedes test code.
- The thread pool: 0 of 3 (small sample, but consistent with the process-start pattern).
- A database reset or leftover data: the process dies at start, before the test file connects to the database.

## Not established
- The exact fast-fail sub-code (stack cookie, `abort()`, control-flow guard) and the faulting module. That needs a crash dump of node.exe.
- Whether Windows Defender, hardware shadow-stack enforcement or memory pressure triggers it. Each is plausible; none was tested because each needs an administrator-level or system-wide change.
- Whether another Node line behaves the same. Node 24 is the current LTS and the only runtime installed. Installing Node 22 for comparison means downloading a runtime, which was not done without approval.

## Residual risk and handling
- It is an infrastructure instability on this Windows machine. It was reproduced in the integration test runner, not caused by a failing assertion, and a rerun of the affected file passes.
- **Reports must never present a run with a crash as clean.** The run totals in `phase1-7-integration-report.md` list each crash and each separate rerun.
- In CI (Linux) this has not been seen in the earlier CI documentation; that was not re-checked here.

## Recommended next steps (each needs the owner's approval)
1. Enable Windows Error Reporting local dumps for node.exe (a registry change, administrator rights) and keep the next dump: it names the fast-fail code and the module.
2. Add a Defender exclusion for the project folder and node.exe, rerun the integration loop 20 times, compare (a security-setting change).
3. Disable CET user shadow stack for node.exe with `Set-ProcessMitigation` for one experiment (a security-setting change, revert afterwards).
4. Install Node 22 LTS next to Node 24 and repeat the loop.
5. In the meantime use the thread pool for local integration runs (`--pool=threads`), which showed none in this sample, and keep the process pool in CI.
6. Stop the unused local Supabase stacks of other work trees to restore memory headroom (owner's decision, they are not this work's).

## Separate finding found by this investigation (not a crash)
Row-level security cost on `audit_log` (and `verification_events`). After 11 integration runs the local audit table held about 9,400 rows. A signed-in user without membership running `select * from audit_log` takes 1.7 seconds although zero rows are visible, because the policy calls `private.has_platform_permission('audit:read')` once per row. Writing it as `(select private.has_platform_permission('audit:read'))` makes the database evaluate it once per statement: in a rolled-back test transaction the same query fell from 1,677 ms to 7 ms with the identical result. The same pattern is in `verification_events_select`. As the audit table grows this would push such queries past PostgREST's statement timeout (a real integration test `rpc-security` did time out twice with SQLSTATE 57014 in the later runs here). **No policy was changed**: changing row-level security is a protected, high-risk change that needs review and approval. Proposed migration after approval: recreate the two policies with the wrapped call and add an `EXPLAIN`-based pgTAP check that the plan contains an InitPlan.
