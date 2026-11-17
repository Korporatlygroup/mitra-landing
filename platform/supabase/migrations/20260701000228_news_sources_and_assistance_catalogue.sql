-- News attribution (publisher, source URL, source publication date, retrieval date) and the starting catalogue of assistance sources and news.
-- Additive: four nullable columns on news_posts, three news functions re-declared with those fields, new agencies/sources (disabled, manual entry)
-- and DRAFT news items. Nothing here is published: programme candidates are queued separately for review, and the news rows are drafts that an
-- administrator must approve. No programme is marked open by this migration.

alter table public.news_posts
  add column source_url text check (source_url ~ '^https://' and char_length(source_url) <= 500),
  add column publisher text check (char_length(publisher) <= 120),
  add column source_published_on date,
  add column retrieved_on date;
alter table public.news_posts add constraint news_posts_source_needs_publisher check (source_url is null or publisher is not null);


create or replace function public.admin_news_save(p_id uuid, p_data jsonb, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  n public.news_posts;
  v_title text; v_summary text; v_body text; v_cat text; v_lang text; v_deadline date; v_publish timestamptz;
  v_sectors text[]; v_states text[]; v_src text; v_pub text; v_srcdate date; v_ret date;
begin
  perform private.assert_news_staff();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_title := btrim(coalesce(p_data ->> 'title', '')); v_summary := btrim(coalesce(p_data ->> 'summary', '')); v_body := btrim(coalesce(p_data ->> 'body', ''));
  v_cat := p_data ->> 'category'; v_lang := coalesce(nullif(p_data ->> 'language', ''), 'en');
  begin
    v_deadline := nullif(p_data ->> 'deadline_on', '')::date;
    v_publish := nullif(p_data ->> 'publish_at', '')::timestamptz;
    v_sectors := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_data -> 'sectors', '[]'::jsonb)) x where btrim(x) ~ '^[a-z0-9-]{2,40}$'), '{}');
    v_states := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_data -> 'states', '[]'::jsonb)) x where btrim(x) <> '' and char_length(btrim(x)) <= 40), '{}');
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  v_src := nullif(btrim(coalesce(p_data ->> 'source_url', '')), '');
  v_pub := nullif(btrim(coalesce(p_data ->> 'publisher', '')), '');
  begin
    v_srcdate := nullif(p_data ->> 'source_published_on', '')::date;
    v_ret := nullif(p_data ->> 'retrieved_on', '')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
    perform private.raise_error('invalid', 'invalid_data');
  end;
  if (v_src is not null and (v_src !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:443)?(/[^[:space:]<>"]*)?$' or char_length(v_src) > 500))
     or (v_pub is not null and char_length(v_pub) > 120) or (v_src is not null and v_pub is null) then
    perform private.raise_error('invalid', 'invalid_source');
  end if;
  if char_length(v_title) not between 3 and 160 or char_length(v_summary) not between 10 and 400 or char_length(v_body) not between 10 and 20000
     or v_cat not in ('grants', 'training', 'deadlines', 'community') or v_lang not in ('en', 'ta', 'ms') then
    perform private.raise_error('invalid', 'invalid_data');
  end if;
  if p_id is null then
    insert into public.news_posts (title, summary, body, category, sectors, states, language, deadline_on, publish_at, author_id, source_url, publisher, source_published_on, retrieved_on)
    values (v_title, v_summary, v_body, v_cat, v_sectors, v_states, v_lang, v_deadline, v_publish, auth.uid(), v_src, v_pub, v_srcdate, v_ret) returning * into n;
    perform private.write_audit('news.created', null, 'news_post', n.id::text, jsonb_build_object('category', v_cat));
  else
    select * into n from public.news_posts where id = p_id for update;
    if n.id is null then perform private.raise_error('not_found'); end if;
    if n.version <> p_expected_version then perform private.raise_error('conflict', 'stale_version'); end if;
    update public.news_posts set title = v_title, summary = v_summary, body = v_body, category = v_cat, sectors = v_sectors, states = v_states,
      language = v_lang, deadline_on = v_deadline, publish_at = v_publish, source_url = v_src, publisher = v_pub, source_published_on = v_srcdate, retrieved_on = v_ret,
      version = version + 1, updated_at = now()
    where id = p_id returning * into n;
    perform private.write_audit('news.updated', null, 'news_post', n.id::text, jsonb_build_object('category', v_cat));
  end if;
  return jsonb_build_object('id', n.id, 'version', n.version, 'status', n.status);
end;
$$;

create or replace function public.news_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare n public.news_posts;
begin
  select * into n from public.news_posts where id = p_id;
  if n.id is null or not private.news_visible(n) then perform private.raise_error('not_found'); end if;
  return jsonb_build_object('id', n.id, 'title', n.title, 'summary', n.summary, 'body', n.body, 'category', n.category, 'sectors', n.sectors,
    'states', n.states, 'language', n.language, 'deadline_on', n.deadline_on, 'source_url', n.source_url, 'publisher', n.publisher, 'source_published_on', n.source_published_on, 'retrieved_on', n.retrieved_on, 'published_at', coalesce(n.publish_at, n.created_at),
    'saved', auth.uid() is not null and exists (select 1 from public.news_saved s where s.post_id = n.id and s.user_id = auth.uid()));
end;
$$;

create or replace function public.news_list(p_category text, p_language text, p_sector text, p_state text, p_saved_only boolean, p_limit integer, p_offset integer) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50); v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000); v_total integer; v_items jsonb;
begin
  if p_category is not null and p_category not in ('grants', 'training', 'deadlines', 'community') then perform private.raise_error('invalid', 'invalid_data'); end if;
  if p_language is not null and p_language not in ('en', 'ta', 'ms') then perform private.raise_error('invalid', 'invalid_data'); end if;
  if coalesce(p_saved_only, false) and auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  with base as (
    select n.* from public.news_posts n
    where private.news_visible(n)
      and (p_category is null or n.category = p_category)
      and (p_language is null or n.language = p_language)
      and (p_sector is null or cardinality(n.sectors) = 0 or p_sector = any (n.sectors))
      and (p_state is null or cardinality(n.states) = 0 or p_state = any (n.states))
      and (not coalesce(p_saved_only, false) or exists (select 1 from public.news_saved s where s.post_id = n.id and s.user_id = auth.uid()))
  )
  select (select count(*) from base),
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'summary', x.summary, 'category', x.category, 'sectors', x.sectors,
      'states', x.states, 'language', x.language, 'deadline_on', x.deadline_on, 'publisher', x.publisher, 'source_published_on', x.source_published_on, 'published_at', coalesce(x.publish_at, x.created_at),
      'saved', auth.uid() is not null and exists (select 1 from public.news_saved s where s.post_id = x.id and s.user_id = auth.uid())) order by coalesce(x.publish_at, x.created_at) desc, x.id)
      from (select * from base order by coalesce(publish_at, created_at) desc, id offset v_off limit v_limit) x), '[]'::jsonb)
  into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;


-- Assistance sources. Manual entry only: never fetched automatically (enabled = false). Programme candidates are added through
-- gov_submit_candidate so that they land in the review queue as pending proposals.
insert into public.gov_agencies (code, name, domain) values
  ('MITRA', 'Malaysian Indian Community Transformation Unit (MITRA)', 'mitra.gov.my'),
  ('TEKUN', 'TEKUN Nasional', 'tekun.gov.my'),
  ('SMECORP', 'SME Corporation Malaysia', 'smecorp.gov.my')
on conflict (code) do nothing;

insert into public.gov_sources (agency_id, name, source_type, adapter, allowed_hosts, approved_urls, allowed_method, usage_restrictions, enabled)
select a.id, 'INOK editorial entry (official pages, checked 2026-11-17)', 'manual', 'manual', array[a.domain, 'www.' || a.domain],
       case a.code when 'MITRA' then array['https://www.mitra.gov.my/ms/modal-insan']
                   when 'TEKUN' then array['https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat/']
                   else array['https://smecorp.gov.my/'] end,
       'manual_entry',
       'Entered by hand from the agency''s public pages. The site is not fetched automatically. SME Corp pages refused automated access (HTTP 403) on 2026-11-17, so SME Corp entries are unconfirmed.',
       false
  from public.gov_agencies a
 where a.code in ('MITRA', 'TEKUN', 'SMECORP')
on conflict (agency_id, name) do nothing;

-- News drafts. Original summaries of public reports; every claim below was read on the cited page on 2026-11-17. Drafts stay hidden until an
-- administrator approves them. Allocation announcements are news, not open applications.
insert into public.news_posts (title, summary, body, category, language, status, publish_at, source_url, publisher, source_published_on, retrieved_on)
select v.title, v.summary, v.body, v.category, 'en', 'draft', v.published_text::timestamptz, v.url, v.publisher, v.published_text::date, date '2026-11-17'
  from (values
    ('Budget 2027 lifts MITRA''s allocation to RM150 million',
     'Treasury officials said MITRA''s 2027 allocation rises from RM100 million to RM150 million. For next year they also cited RM100 million for TEKUN''s SPUMI scheme and RM50 million of Amanah Ikhtiar microcredit for Indian women entrepreneurs.',
     E'The Treasury secretary-general said on 12 October 2026 that MITRA''s allocation under Budget 2027 increases from RM100 million to RM150 million, with youth skills training among the aims.\n\nHe also mentioned RM100 million for the SPUMI scheme under TEKUN Nasional and RM50 million in microcredit through Amanah Ikhtiar for Indian women entrepreneurs, both for next year.\n\nThis is a budget allocation, not an open application. Check the agency''s own page for application dates and conditions before you apply.',
     'grants', '2026-10-12T11:55:00Z', 'https://www.thestar.com.my/news/nation/2026/10/12/budget-2027-mitra-gets-rm150mil-to-boost-indian-community-programmes', 'The Star (Bernama)'),
    ('Uyarvu MADANI: demand far above the grants available, more funding under consideration',
     'MITRA reported about 8,400 applications for its Uyarvu MADANI startup grants against roughly 780 places and said more funding is being considered. No new application round is confirmed in this report.',
     E'On 27 October 2026 the minister said MITRA had received 8,368 applications for the Uyarvu MADANI grant but could fund about 780 entrepreneurs; across both phases about 1,100 to 1,150 might be helped.\n\nThe government is considering extra funding and other financing routes. Uyarvu MADANI is a grant, unlike the repayable financing offered by Amanah Ikhtiar and SPUMI.\n\nThe report does not announce a new application round. Treat any reopening as unconfirmed until MITRA publishes dates on its official site.',
     'grants', '2026-10-27T06:35:00Z', 'https://www.malaymail.com/news/malaysia/2026/10/27/ramanan-more-funding-being-considered-for-uyarvu-madani-to-help-small-indian-entrepreneurs/240788', 'Malay Mail (Bernama)'),
    ('TEKUN updates its SPUMI financing conditions page',
     'TEKUN''s official SPUMI conditions page, last updated 27 October 2026, lists Islamic financing of RM1,000 to RM100,000 for Indian-community Malaysian entrepreneurs aged 18 to 65, applied for at a TEKUN branch.',
     E'TEKUN Nasional''s Skim Pembangunan Usahawan Masyarakat India (SPUMI) page shows an update date of 27 October 2026.\n\nFinancing is repayable, not a grant: it is Islamic (tawarruq) financing from RM1,000 to RM100,000 over 6 to 120 months, with a stated profit rate of 4% a year on the financing amount, a savings contribution, a wakalah fee and mandatory takaful.\n\nThe page asks for a valid business registration, a business that is wholly owned by Malaysian citizens from the Indian community, and applicants aged 18 to 65. Applications are made at a TEKUN branch. Always confirm the current conditions with TEKUN.',
     'grants', '2026-10-27T00:00:00Z', 'https://www.tekun.gov.my/skim-pembangunan-usahawan-masyarakat-india-spumi-syarat-syarat/', 'TEKUN Nasional')
  ) as v(title, summary, body, category, published_text, url, publisher)
 where not exists (select 1 from public.news_posts n where n.source_url = v.url);
