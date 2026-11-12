-- Phase 5 (3/5): spreadsheet import staging. The application parses CSV/XLSX (never evaluating formulas) and hands the
-- rows to stage_import(); every row is validated again here in SQL, on staging and again on commit.
-- Committing writes DRAFT products only. It never publishes. Lock order: supplier (share), job, products (by sku).

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.organisations (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  mode text not null check (mode in ('create_only', 'create_or_update')),
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed', 'cancelled')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  counts jsonb not null default '{}'::jsonb,
  overwrite_confirmed boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  committed_by uuid references auth.users (id) on delete set null,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_org_id, supplier_id, file_sha256, mode)
);
create index import_jobs_partner on public.import_jobs (partner_org_id, created_at desc);

create table public.import_rows (
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_no integer not null check (row_no > 0),
  sku text,
  status text not null check (status in ('valid', 'invalid', 'duplicate')),
  action text check (action in ('create', 'update')),
  errors jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  primary key (job_id, row_no)
);
create index import_rows_job_status on public.import_rows (job_id, status, row_no);

-- Validates ONE row for a given supplier. Used by staging and again by commit.
-- Returns {errors: [...], data: {...normalised draft fields incl. sku}, sku, action}.
create function private.check_import_row(p_partner uuid, p_supplier uuid, p_mode text, p_row jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text[] := array[]::text[];
  d jsonb;
  k text;
  v_sku text;
  v_action text;
  v_status public.product_status;
  v_pending boolean;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('errors', jsonb_build_array('invalid_row'), 'data', '{}'::jsonb, 'sku', null, 'action', null);
  end if;
  if pg_column_size(p_row) > 20000 then
    return jsonb_build_object('errors', jsonb_build_array('row_too_large'), 'data', '{}'::jsonb, 'sku', null, 'action', null);
  end if;
  d := '{}'::jsonb;
  -- _client_invalid: the application's own validator rejected this row (array of 'field:key' strings). The row can never be valid.
  if p_row ? '_client_invalid' and jsonb_typeof(p_row -> '_client_invalid') not in ('null') then
    if jsonb_typeof(p_row -> '_client_invalid') <> 'array' or jsonb_array_length(p_row -> '_client_invalid') > 100 then
      return jsonb_build_object('errors', jsonb_build_array('invalid_row'), 'data', '{}'::jsonb, 'sku', null, 'action', null);
    end if;
    if jsonb_array_length(p_row -> '_client_invalid') > 0 then e := array_append(e, 'client_validation_failed'::text); end if;
  end if;
  for k in select jsonb_object_keys(p_row) loop
    if k in ('_row', '_client_invalid') then continue; end if;
    if jsonb_typeof(p_row -> k) = 'null' or (jsonb_typeof(p_row -> k) = 'string' and btrim(p_row ->> k) = '') then continue; end if;
    d := d || jsonb_build_object(k, case when jsonb_typeof(p_row -> k) = 'string' then to_jsonb(btrim(p_row ->> k)) else p_row -> k end);
  end loop;
  -- A price mode is implied by the columns present.
  if not d ? 'price_mode' then
    if d ? 'tiers' then d := d || '{"price_mode":"tiers"}'::jsonb;
    elsif d ? 'unit_price' then d := d || '{"price_mode":"fixed"}'::jsonb;
    end if;
  end if;
  e := e || private.validate_product_data(d, false);
  v_sku := nullif(d ->> 'sku', '');
  foreach k in array array['sku', 'name', 'category_slug', 'unit', 'moq', 'currency'] loop
    if not d ? k and not (k = 'currency' and d ->> 'price_mode' = 'request') then e := e || (k || '_required'); end if;
  end loop;
  if not d ? 'price_mode' then e := array_append(e, 'price_required'::text); end if;
  if d ->> 'price_mode' = 'fixed' and not d ? 'unit_price' then e := array_append(e, 'price_required'::text); end if;
  if d ->> 'price_mode' = 'tiers' and not d ? 'tiers' then e := array_append(e, 'tiers_required'::text); end if;
  if d ->> 'price_mode' = 'fixed' and d ? 'tiers' then e := array_append(e, 'tiers_not_allowed'::text); end if;
  if d ->> 'price_mode' = 'tiers' and d ? 'unit_price' then e := array_append(e, 'unit_price_not_allowed'::text); end if;
  if d ->> 'price_mode' = 'request' and (d ? 'tiers' or d ? 'unit_price') then e := array_append(e, 'price_not_allowed'::text); end if;

  if v_sku is not null and v_sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then
    select x.status, exists (select 1 from public.product_revisions r where r.id = x.pending_revision_id and r.status = 'submitted')
      into v_status, v_pending
    from public.products x where x.supplier_id = p_supplier and x.partner_org_id = p_partner and lower(x.sku) = lower(v_sku);
    if v_status is null then
      v_action := 'create';
    elsif p_mode = 'create_only' then
      e := array_append(e, 'sku_exists'::text);
    elsif v_status = 'suspended' then
      e := array_append(e, 'product_suspended'::text);
    elsif v_pending then
      e := array_append(e, 'product_under_review'::text);
    else
      v_action := 'update';
    end if;
  end if;
  return jsonb_build_object('errors', to_jsonb(e), 'data', d, 'sku', v_sku, 'action', case when cardinality(e) = 0 then v_action end);
end;
$$;

create function private.import_job_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', j.id, 'supplier_id', j.supplier_id, 'mode', j.mode, 'status', j.status, 'file_name', j.file_name,
    'counts', j.counts, 'created_at', j.created_at, 'committed_at', j.committed_at)
  from public.import_jobs j where j.id = p_id
$$;

create function public.stage_import(p_partner_org uuid, p_supplier uuid, p_mode text, p_file_name text, p_sha256 text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_file_name, ''));
  sp public.suppliers;
  j public.import_jobs;
  v_created boolean := false;
  v_inserted integer;
  v_n integer;
  v_valid integer;
  v_invalid integer;
  v_dup integer;
  v_status text;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  if not private.has_permission(p_partner_org, 'catalogue:manage') then perform private.raise_error('forbidden'); end if;
  perform private.assert_partner_active(p_partner_org);
  perform private.require_consent();
  perform private.check_rate_limit('import_stage:' || v_user, 30, interval '1 hour');
  if p_mode is null or p_mode not in ('create_only', 'create_or_update') then perform private.raise_error('invalid', 'invalid_mode'); end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then perform private.raise_error('invalid', 'invalid_file_hash'); end if;
  v_name := regexp_replace(v_name, '^.*[\\/]', '');
  if char_length(v_name) < 1 or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then perform private.raise_error('invalid', 'invalid_file_name'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then perform private.raise_error('invalid', 'invalid_data'); end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 then perform private.raise_error('invalid', 'empty_file'); end if;
  if v_n > 2000 then perform private.raise_error('invalid', 'too_many_rows'); end if;
  if pg_column_size(p_rows) > 8000000 then perform private.raise_error('invalid', 'file_too_large'); end if;

  select * into sp from public.suppliers x where x.id = p_supplier and x.partner_org_id = p_partner_org for share;
  if sp.id is null then perform private.raise_error('not_found'); end if;
  if sp.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;

  insert into public.import_jobs (partner_org_id, supplier_id, mode, file_name, file_sha256, created_by)
  values (p_partner_org, p_supplier, p_mode, left(v_name, 200), p_sha256, v_user)
  on conflict (partner_org_id, supplier_id, file_sha256, mode) do nothing;
  get diagnostics v_inserted = row_count;
  v_created := v_inserted = 1;
  select * into j from public.import_jobs x
  where x.partner_org_id = p_partner_org and x.supplier_id = p_supplier and x.file_sha256 = p_sha256 and x.mode = p_mode for update;
  -- A retry of the same file returns the same job (previewed or already committed); failed or cancelled ones are re-staged.
  if not v_created and j.status in ('previewed', 'committed') then
    return jsonb_build_object('job_id', j.id, 'created', false, 'status', j.status, 'counts', j.counts,
      'rows', private.import_rows_json(j.id, 'problems', 0, 200));
  end if;
  delete from public.import_rows where job_id = j.id;

  insert into public.import_rows (job_id, row_no, sku, status, action, errors, data)
  with src as (
    select a.ord, a.x,
           case when jsonb_typeof(a.x) = 'object' and (a.x ->> '_row') ~ '^[0-9]{1,7}$' and (a.x ->> '_row')::integer > 0
                then (a.x ->> '_row')::integer else a.ord::integer end row_no
    from jsonb_array_elements(p_rows) with ordinality a (x, ord)
  ), chk as (
    select s.row_no, private.check_import_row(p_partner_org, p_supplier, p_mode, s.x) r from src s
  ), dup as (
    select c.row_no from (select x.row_no, row_number() over (partition by lower(x.r ->> 'sku') order by x.row_no) rn
                          from chk x where x.r ->> 'sku' is not null) c where c.rn > 1
  )
  select j.id, c.row_no, c.r ->> 'sku',
         case when c.row_no in (select row_no from dup) then 'duplicate'
              when jsonb_array_length(c.r -> 'errors') > 0 then 'invalid' else 'valid' end,
         case when jsonb_array_length(c.r -> 'errors') = 0 and c.row_no not in (select row_no from dup) then c.r ->> 'action' end,
         case when c.row_no in (select row_no from dup) then (c.r -> 'errors') || '"duplicate_sku_in_file"'::jsonb else c.r -> 'errors' end,
         c.r -> 'data'
  from chk c;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_n then perform private.raise_error('invalid', 'invalid_row_number'); end if;

  select count(*) filter (where status = 'valid'), count(*) filter (where status = 'invalid'), count(*) filter (where status = 'duplicate')
    into v_valid, v_invalid, v_dup from public.import_rows where job_id = j.id;
  v_status := case when v_valid = 0 then 'failed' else 'previewed' end;
  update public.import_jobs set status = v_status, counts = jsonb_build_object('total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup),
    created_by = v_user, overwrite_confirmed = false, committed_at = null, committed_by = null, updated_at = now()
  where id = j.id;
  perform private.write_audit('catalogue.import_staged', p_partner_org, 'import_job', j.id::text,
    jsonb_build_object('mode', p_mode, 'total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup, 'supplier_id', p_supplier));
  return jsonb_build_object('job_id', j.id, 'created', v_created, 'status', v_status,
    'counts', jsonb_build_object('total', v_n, 'valid', v_valid, 'invalid', v_invalid, 'duplicate', v_dup),
    'rows', private.import_rows_json(j.id, 'problems', 0, 200));
end;
$$;

-- kind: 'problems' (invalid and duplicate rows), 'valid', or 'all'.
create function private.import_rows_json(p_job uuid, p_kind text, p_offset integer, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('row_no', r.row_no, 'sku', r.sku, 'status', r.status, 'action', r.action,
           'errors', r.errors, 'name', r.data ->> 'name') order by r.row_no), '[]'::jsonb)
  from (select * from public.import_rows x where x.job_id = p_job
        and (p_kind = 'all' or (p_kind = 'valid' and x.status = 'valid') or (p_kind = 'problems' and x.status <> 'valid'))
        order by x.row_no limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) r
$$;

create function public.commit_import(p_job uuid, p_confirm_overwrite boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  j public.import_jobs;
  v_partner uuid;
  v_supplier uuid;
  sp public.suppliers;
  r public.import_rows;
  chk jsonb;
  pr public.products;
  v_draft jsonb;
  v_old jsonb;
  v_errs text[];
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_cs text[] := array[]::text[];
  v_us text[] := array[]::text[];
  v_id uuid;
begin
  if v_user is null then perform private.raise_error('unauthenticated'); end if;
  select x.partner_org_id, x.supplier_id into v_partner, v_supplier from public.import_jobs x where x.id = p_job;
  if v_partner is null or not private.has_permission(v_partner, 'catalogue:manage') then perform private.raise_error('not_found'); end if;
  perform private.assert_partner_active(v_partner);
  perform private.require_consent();
  perform private.check_rate_limit('import_commit:' || v_user, 30, interval '1 hour');
  select * into sp from public.suppliers x where x.id = v_supplier and x.partner_org_id = v_partner for share;
  select * into j from public.import_jobs x where x.id = p_job for update;
  if j.status = 'committed' then
    return jsonb_build_object('job_id', j.id, 'status', 'committed', 'created', coalesce((j.counts ->> 'created')::integer, 0),
      'updated', coalesce((j.counts ->> 'updated')::integer, 0), 'skipped', coalesce((j.counts ->> 'skipped')::integer, 0), 'repeat', true);
  end if;
  if j.status <> 'previewed' then perform private.raise_error('conflict', 'job_not_previewed'); end if;
  if sp.status = 'suspended' then perform private.raise_error('conflict', 'supplier_suspended'); end if;
  if j.mode = 'create_or_update' and p_confirm_overwrite is not true then
    perform private.raise_error('invalid', 'overwrite_confirmation_required');
  end if;

  for r in select * from public.import_rows x where x.job_id = j.id and x.status = 'valid' order by lower(x.sku), x.row_no loop
    -- Staged rows are never trusted: they are checked again against the current catalogue.
    chk := private.check_import_row(v_partner, v_supplier, j.mode, r.data);
    if jsonb_array_length(chk -> 'errors') > 0 or chk ->> 'sku' is distinct from r.sku then
      update public.import_rows set status = 'invalid', action = null, errors = chk -> 'errors' where job_id = r.job_id and row_no = r.row_no;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_draft := chk -> 'data';
    if v_draft ->> 'price_mode' in ('fixed', 'tiers') and not v_draft ? 'price_confirmed_on' then
      v_draft := v_draft || jsonb_build_object('price_confirmed_on', current_date::text);
    end if;
    if v_draft ? 'availability_status' and not v_draft ? 'availability_confirmed_on' then
      v_draft := v_draft || jsonb_build_object('availability_confirmed_on', current_date::text);
    end if;
    if chk ->> 'action' = 'create' then
      if (select count(*) from public.products x where x.supplier_id = v_supplier) >= 5000 then
        perform private.raise_error('conflict', 'product_limit_reached');
      end if;
      insert into public.products (supplier_id, partner_org_id, sku, draft, draft_version, version, created_by)
      values (v_supplier, v_partner, r.sku, v_draft, 1, 1, v_user)
      on conflict do nothing returning id into v_id;
      if v_id is null then
        update public.import_rows set status = 'invalid', action = null, errors = '["sku_exists"]'::jsonb where job_id = r.job_id and row_no = r.row_no;
        v_skipped := v_skipped + 1;
      else
        v_created := v_created + 1;
        v_cs := v_cs || r.sku;
      end if;
      v_id := null;
    else
      select * into pr from public.products x where x.supplier_id = v_supplier and x.partner_org_id = v_partner and lower(x.sku) = lower(r.sku) for update;
      -- Price columns replace each other: switching mode drops the other mode's fields from the existing draft.
      v_old := pr.draft;
      if v_draft ->> 'price_mode' = 'fixed' then v_old := v_old - 'tiers';
      elsif v_draft ->> 'price_mode' = 'tiers' then v_old := v_old - 'unit_price';
      elsif v_draft ->> 'price_mode' = 'request' then v_old := v_old - 'tiers' - 'unit_price';
      end if;
      v_draft := private.merge_product_draft(v_old, v_draft - 'sku');
      v_errs := private.validate_product_data(v_draft, false);
      if cardinality(v_errs) > 0 then
        update public.import_rows set status = 'invalid', action = null, errors = to_jsonb(v_errs) where job_id = r.job_id and row_no = r.row_no;
        v_skipped := v_skipped + 1;
      else
        update public.products set draft = v_draft, draft_version = pr.draft_version + 1, version = pr.version + 1, updated_at = now(),
          status = case when pr.status in ('changes_requested', 'rejected') then 'draft'::public.product_status else pr.status end
        where id = pr.id;
        v_updated := v_updated + 1;
        v_us := v_us || pr.sku;
      end if;
    end if;
  end loop;
  if v_created + v_updated = 0 then perform private.raise_error('invalid', 'no_valid_rows'); end if;

  update public.import_jobs set status = 'committed', committed_at = now(), committed_by = v_user, overwrite_confirmed = coalesce(p_confirm_overwrite, false),
    counts = counts || jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped), updated_at = now()
  where id = j.id;
  perform private.write_audit('catalogue.import_committed', v_partner, 'import_job', j.id::text,
    jsonb_build_object('mode', j.mode, 'supplier_id', v_supplier, 'created', v_created, 'updated', v_updated, 'skipped', v_skipped,
      'overwrite_confirmed', coalesce(p_confirm_overwrite, false), 'skus_created', to_jsonb(v_cs[1:500]), 'skus_updated', to_jsonb(v_us[1:500]),
      'truncated', cardinality(v_cs) > 500 or cardinality(v_us) > 500));
  return jsonb_build_object('job_id', j.id, 'status', 'committed', 'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'repeat', false);
end;
$$;

create function public.cancel_import(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.import_jobs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  select * into j from public.import_jobs x where x.id = p_job for update;
  if j.id is null or not private.has_permission(j.partner_org_id, 'catalogue:manage') then perform private.raise_error('not_found'); end if;
  perform private.assert_partner_active(j.partner_org_id);
  if j.status = 'cancelled' then return; end if;
  if j.status <> 'previewed' then perform private.raise_error('conflict', 'job_not_previewed'); end if;
  update public.import_jobs set status = 'cancelled', updated_at = now() where id = j.id;
  perform private.write_audit('catalogue.import_cancelled', j.partner_org_id, 'import_job', j.id::text, '{}'::jsonb);
end;
$$;

create function public.list_imports(p_org uuid, p_supplier uuid default null, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  return jsonb_build_object('offset', v_off, 'items', coalesce((
    select jsonb_agg(private.import_job_json(x.id) order by x.created_at desc, x.id)
    from (select j.id, j.created_at from public.import_jobs j where j.partner_org_id = p_org and (p_supplier is null or j.supplier_id = p_supplier)
          order by j.created_at desc, j.id limit 25 offset v_off) x), '[]'::jsonb));
end;
$$;

create function public.get_import(p_org uuid, p_job uuid, p_kind text default 'problems', p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j public.import_jobs;
begin
  if auth.uid() is null then perform private.raise_error('unauthenticated'); end if;
  if not private.is_member(p_org) then perform private.raise_error('forbidden'); end if;
  if p_kind not in ('problems', 'valid', 'all') then perform private.raise_error('invalid', 'invalid_status'); end if;
  select * into j from public.import_jobs x where x.id = p_job and x.partner_org_id = p_org;
  if j.id is null then perform private.raise_error('not_found'); end if;
  return private.import_job_json(j.id) || jsonb_build_object('rows', private.import_rows_json(j.id, p_kind, coalesce(p_offset, 0), 100));
end;
$$;

alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
create policy import_jobs_select on public.import_jobs for select to authenticated using (private.is_member(partner_org_id));
create policy import_rows_select on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id));
grant select on public.import_jobs, public.import_rows to authenticated;

revoke all on function
  private.check_import_row(uuid, uuid, text, jsonb), private.import_job_json(uuid),
  private.import_rows_json(uuid, text, integer, integer),
  public.stage_import(uuid, uuid, text, text, text, jsonb), public.commit_import(uuid, boolean), public.cancel_import(uuid),
  public.list_imports(uuid, uuid, integer), public.get_import(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.stage_import(uuid, uuid, text, text, text, jsonb), public.commit_import(uuid, boolean), public.cancel_import(uuid),
  public.list_imports(uuid, uuid, integer), public.get_import(uuid, uuid, text, integer)
  to authenticated;
