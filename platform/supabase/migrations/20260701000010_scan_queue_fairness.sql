-- D6: documents that cannot be scanned must not starve newer ones. A retried document is stamped (scanned_at) by
-- service_set_scan_result(..., 'failed'), so ordering by the last attempt rotates it to the back of the queue.
create or replace function public.service_list_unscanned_documents(p_limit integer)
returns table (id uuid, storage_path text, mime_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.storage_path, d.mime_type from public.verification_documents d
  where d.scan_status in ('pending', 'failed') and d.removed_at is null
  order by coalesce(d.scanned_at, d.created_at), d.created_at
  limit least(greatest(p_limit, 1), 100)
$$;
