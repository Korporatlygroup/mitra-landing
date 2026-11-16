-- The private evidence bucket was only defined in supabase/config.toml (local) and created by hand on the hosted staging project.
-- A new hosted project (production) is built from migrations alone, so the bucket must be created here, exactly like
-- `catalogue-media` in migration 111. On the existing staging project the row already exists and nothing changes.
-- Private, no storage policy for any API role (only trusted server code with the service key reads or writes), 10 MiB, PDF/PNG/JPEG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;
