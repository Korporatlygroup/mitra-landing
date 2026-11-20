# Production backup options and recommendation (2026-11-20)

Nothing was activated and the plan was not changed. Prices are from Supabase's published pricing page and backup documentation, read on 2026-11-20; confirm them in the dashboard before buying, because they can change.

## What production has now
Read-only check of `inok-production` (`supabase backups list`): region **ap-northeast-1 (Tokyo)**, `walg_enabled: true`, **`pitr_enabled: false`, no backups listed**. That is consistent with a Free-plan project (the plan itself could not be read without dashboard or billing access, so please confirm it): the Supabase documentation says automatic daily backups exist only for Pro, Team and Enterprise projects, and recommends that Free projects export their data regularly with `supabase db dump` and keep off-site copies. A Free project also pauses after a week of inactivity, which is a separate availability risk for a live site.
The only recovery today is our own logical backup (schema + data-only dump of `public`, `private`, `auth`, `storage`, plus a storage listing and checksum). Procedure in `backup-and-recovery.md`; it was exercised on 2026-11-19 and 2026-11-20 and the restore into a clean database matched production in all 99 tables.

## Options
| Option | Cost (published) | What you get | Recovery capability | Setup |
|---|---|---|---|---|
| A. Stay on Free + manual dumps (today) | $0 | Whatever we dump | Restore to the moment of the last dump; anything after is lost; recovery is a manual rebuild (about an hour of work, tested) | Already in place; must be run by a person before every release and on a schedule |
| B. **Pro plan** | from **$25 per month** per organisation (first project included; extra projects from $10/mo; compute and usage extra) | Daily backups kept **7 days**, restorable from the dashboard; no pause for inactivity; email support; 8 GB disk | Restore to any of the last 7 daily backups (up to a day of data lost); project is unavailable during the restore | Upgrade the organisation in the dashboard (billing details needed); no code change |
| C. Pro + **Point-in-Time Recovery** add-on | Pro $25 + PITR: about **$100/month for 7-day recovery**, ~$200 for 14 days, ~$400 for 28 days | Restore to any second within the retention window; PITR replaces the daily backups | Data loss of seconds, not hours | Enable PITR in the dashboard on a Pro project (needs the Pro plan, and the add-on is billed hourly) |
| D. Team plan | higher tier (see pricing page) | Daily backups kept 14 days | As B but longer | Only if team/SSO features are needed |
Important limits that apply to every option: Supabase backups **do not include storage objects** (files); only their metadata is in the database. Production currently holds 0 files, but verification documents will be files once uploads open, so object backups need their own copy job (`deploy/backup/storage-backup.mjs`). Daily backups do not store custom role passwords. Deleting a project deletes its backups. Restoring a backup replaces the current database, so restore into a new project first when you want to keep current data.

## Recommendation
1. **Move production to Pro before any real business data enters** (about $25/month plus usage). It removes the inactivity pause and gives 7 daily backups, which is the proportionate protection for the current stage. Keep the manual verified dump before every release (it also covers storage metadata).
2. **Do not buy PITR yet** (about $100/month): at the current volume, up to a day of loss is acceptable; revisit when transactions flow or when real money or legally relevant agreements are held. Re-evaluate at the first paying or high-volume customers.
3. Add a **second copy** of each dump off the company computer (a company cloud folder with access limited to two owners): dumps contain personal data and password hashes, so encrypt them.
4. Run a **restore drill** after the upgrade and every quarter (the script exists).
5. Add a calendar owner for "backup before release" and "restore drill".

## Decision for you
Approve or decline the Pro upgrade (and who owns the Supabase organisation's billing). Until you decide, nothing changes and the manual dump remains the only recovery.
