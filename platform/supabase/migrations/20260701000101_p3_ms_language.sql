-- Phase 3.1: Bahasa Melayu (ms) as a third interface language. Profiles may now store 'ms'; sign-up metadata 'ms' is honoured.
alter table public.profiles drop constraint profiles_language_check;
alter table public.profiles add constraint profiles_language_check check (language in ('en', 'ta', 'ms'));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose text;
begin
  insert into public.profiles (id, display_name, language)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
    case when new.raw_user_meta_data ->> 'language' in ('ta', 'ms') then new.raw_user_meta_data ->> 'language' else 'en' end
  )
  on conflict (id) do nothing;

  foreach v_purpose in array array['terms', 'privacy'] loop
    if new.raw_user_meta_data -> 'consents' ->> v_purpose = private.current_consent_version() then
      insert into public.consents (user_id, purpose, version) values (new.id, v_purpose, private.current_consent_version());
    end if;
  end loop;

  perform private.write_audit_as(new.id, 'auth.signup', null, 'user', new.id::text, '{}'::jsonb);
  return new;
end;
$$;
