-- Guest messages in English (Guests and Guest emails in Messages). A guest message written in another language, such as
-- Japanese or Chinese, is translated into English once, by the backend (Cloudflare Workers AI, lib/guest-translation-server.ts),
-- and kept here, so the team reads it in English and can still open the original.
--  * private.workspace_guest_message_translations: one row per guest message checked. language is the language's English
--    name ("Japanese"); english is the translation, or null when the message was already in English.
--  * workspace_guest_translations_get(uuid[]) and workspace_guest_translations_put(jsonb), service role only: the backend
--    reads the stored translations for the messages a person has just been allowed to read, and stores new ones. Who may
--    read a conversation is still decided by workspace_guest_inbox_read; nothing here is reachable by a signed-in user.
-- A translation is removed with its message. No existing function is changed. No DROP, no DELETE. Safe to run twice.

create table if not exists private.workspace_guest_message_translations (
  message_id uuid primary key references private.workspace_guest_messages(id) on delete cascade,
  language text not null check(language ~ '^[A-Za-z][A-Za-z ()-]{0,39}$'),
  english text check(english is null or char_length(english) between 1 and 12000),
  created_at timestamptz not null default now()
);
alter table private.workspace_guest_message_translations enable row level security;
revoke all on private.workspace_guest_message_translations from public,anon,authenticated;

create or replace function private.workspace_guest_translations_get(ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.message_id,'language',t.language,'english',t.english)),'[]')
 from private.workspace_guest_message_translations t where t.message_id=any((coalesce(ids,'{}'::uuid[]))[1:300]);
$$;

create or replace function private.workspace_guest_translations_put(items jsonb) returns integer language plpgsql security definer set search_path='' as $fn$
declare r jsonb;stored integer:=0;n integer;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>50 then raise exception 'Invalid translations' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('id','language','english'))
   or coalesce(r->>'id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(r->>'language','')!~'^[A-Za-z][A-Za-z ()-]{0,39}$'
   or (r ? 'english' and jsonb_typeof(r->'english') not in ('string','null'))
   or char_length(coalesce(r->>'english',''))>12000 then raise exception 'Invalid translations' using errcode='22023';end if;
  insert into private.workspace_guest_message_translations(message_id,language,english)
   select m.id,r->>'language',nullif(trim(r->>'english'),'') from private.workspace_guest_messages m
   where m.id=(r->>'id')::uuid and m.direction='guest'
   on conflict(message_id) do nothing;
  get diagnostics n=row_count;stored:=stored+n;
 end loop;
 return stored;
end $fn$;

create or replace function public.workspace_guest_translations_get(ids uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_guest_translations_get(ids);$$;
create or replace function public.workspace_guest_translations_put(items jsonb) returns integer language sql security invoker set search_path='' as $$select private.workspace_guest_translations_put(items);$$;
revoke all on function private.workspace_guest_translations_get(uuid[]),public.workspace_guest_translations_get(uuid[]),
 private.workspace_guest_translations_put(jsonb),public.workspace_guest_translations_put(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_guest_translations_get(uuid[]),public.workspace_guest_translations_get(uuid[]),
 private.workspace_guest_translations_put(jsonb),public.workspace_guest_translations_put(jsonb) to service_role;
