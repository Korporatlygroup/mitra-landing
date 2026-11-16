# Security incident and personal data breach procedure (draft for management approval)

Legal basis read in this session: PDPA s.12B (Act A1727) and the Commissioner's Circular 2/2025. The Commissioner's full guideline PDF (more than 10 MB) was not read; confirm its details with counsel.

## Roles (management to name)
Incident owner: [name]. Deputy: [name]. Data Protection Officer or privacy contact: [name]. Legal adviser: [name]. Cloudflare and Supabase account owners: [names].

## 1. Detect and report
Sources: user reports to the support email, administrator reports, Supabase or Cloudflare notices, unusual audit-log entries (`audit_log`), Worker logs, failed-login spikes. Anyone who suspects an incident tells the incident owner at once and writes down the time they became aware. **That time starts the clock.**

## 2. Contain (first hour)
Rotate keys that may be exposed (Supabase secret key, Worker secrets, access keys); suspend affected accounts or the Worker (set `ACCESS_GATE=required`, or remove the route); revoke sessions (Supabase Auth sign-out all); disable publishing switches. Never delete evidence.

## 3. Preserve evidence
Export the relevant audit rows, Worker logs and Supabase logs to a restricted folder with hashes; take a database backup with `deploy/backup/backup.sh`; record who did what and when.

## 4. Assess
Decide whether personal data was lost, misused or accessed without authority (a "personal data breach"). Record: what data, how many people, how it was found, cause, systems affected, likely consequences. The Circular treats a breach as likely to cause **significant harm** if it risks physical harm, financial loss, damage to credit record or property; misuse for unlawful purposes; contains sensitive personal data; allows identity fraud when combined with other data; or is of **significant scale (more than 1,000 individuals)**.

## 5. Notify the Personal Data Protection Commissioner
As soon as practicable after there is reason to believe a breach occurred, through the Commissioner's data breach notification channel. Provide within **72 hours** of the breach: details (time of awareness, data and breach type, how identified, number of individuals, estimated records, affected systems), likely consequences, chronology, measures taken or proposed, measures for affected individuals, and the DPO or contact details. If later than 72 hours, state the reasons with evidence. If information is not all available, supply the rest in stages and not later than **30 days** after the first notification. Offence: fine up to RM250,000 or two years' imprisonment, or both.

## 6. Notify affected people
If the breach causes or is likely to cause significant harm: within **7 days after** notifying the Commissioner, tell each affected individual what happened, the likely consequences, what is being done, what they can do to reduce harm, and who to contact, in plain language. Use public communication only if direct notice is impractical or disproportionate.

## 7. Notify others
Processors (Supabase, Cloudflare) are bound to tell INOK and assist; INOK also tells any other regulator or the police where a law requires or fraud is suspected.

## 8. Recover and learn
Fix the cause, restore from backup if needed (`docs/backup-and-recovery.md`), confirm with tests, and review the controls. **Keep the breach-notification record, physical and electronic, for at least 2 years.** Update the Privacy Notice if practice changes.

## Known gaps
No on-call rota; no external monitoring or alerting; production has no automatic backups; the incident roles above are unnamed; the procedure has not been rehearsed.
