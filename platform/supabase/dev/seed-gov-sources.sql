-- LOCAL DEVELOPMENT ONLY. Registers the approved official source candidates as DISABLED sources.
-- Not part of migrations or supabase/seed.sql. For hosted environments register sources through the admin console
-- (gov_register_source) and have a second administrator approve enabling them.
-- Usage (local stack only): psql "$TEST_DB_URL" -f supabase/dev/seed-gov-sources.sql
insert into public.gov_agencies (code, name, domain) values
  ('TEKUN', 'TEKUN Nasional', 'tekun.gov.my'),
  ('MITRA', 'Unit Penyelarasan Pelaksanaan MITRA', 'mitra.gov.my'),
  ('SMECORP', 'SME Corporation Malaysia', 'smecorp.gov.my'),
  ('MYASSIST', 'MyASSIST MSME (SME Corp)', 'myassist-msme.gov.my'),
  ('DATAGOV', 'Malaysia Open Data (data.gov.my)', 'data.gov.my')
on conflict (code) do nothing;

insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, allowed_method, usage_restrictions, refresh_interval_minutes, freshness_hours, enabled)
select a.id, v.name, v.source_type, v.adapter, v.hosts, v.urls, v.method, v.restrictions, v.refresh, v.fresh, false
from (values
  ('TEKUN', 'TEKUN SPUMI scheme pages', 'website', 'tekun', array['www.tekun.gov.my'],
    array['https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi/'], 'public_pages',
    'robots.txt allows these pages. Content is published by TEKUN; INOK shows a summary and links to the official page.', 1440, 72),
  ('MITRA', 'MITRA Modal Insan programme list', 'website', 'page_monitor', array['www.mitra.gov.my'],
    array['https://www.mitra.gov.my/ms/modal-insan'], 'public_pages',
    'Page monitor only: a change is shown to an administrator, who enters or updates programmes by hand. Nothing is extracted automatically.', 1440, 72),
  ('MYASSIST', 'MyASSIST MSME FAQ and services', 'website', 'page_monitor', array['myassist-msme.gov.my'],
    array['https://myassist-msme.gov.my/faq/'], 'public_pages',
    'Page monitor only. A services FAQ, not a programme feed; no deadlines are published here.', 10080, 336),
  ('SMECORP', 'SME Corp all programmes (administrator maintained)', 'manual', 'manual', array['smecorp.gov.my'],
    array[]::text[], 'manual_entry',
    'robots.txt and the page answered HTTP 403 to automated requests when researched. Not monitored automatically; an administrator checks the page in a browser and enters verified facts by hand.', 10080, 336),
  ('DATAGOV', 'Malaysia Open Data (administrator maintained)', 'manual', 'manual', array['data.gov.my'],
    array[]::text[], 'manual_entry',
    'An open-data catalogue, not a programme list. No programme dataset has been identified; revisit if one is.', 10080, 336)
) as v(code, name, source_type, adapter, hosts, urls, method, restrictions, refresh, fresh)
join public.gov_agencies a on a.code = v.code
on conflict do nothing;
