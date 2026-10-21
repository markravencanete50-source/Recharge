-- Guest messages in English, part two (after 20261026000000).
--  * Inbox list previews: private.workspace_guest_translations_latest(uuid[]), service role only, gives the newest message of
--    each conversation with its stored translation, so the backend can show the list preview in English too. The
--    conversations passed are the ones the person was just allowed to list by workspace_guest_inbox_read.
--  * Replies in the guest's language: a VA writes in English and the reply is sent translated. The sent message is then
--    shown in English in the conversation, so workspace_guest_translations_put now also keeps translations of the team's
--    messages (it kept guest messages only).
-- Redefines private.workspace_guest_translations_put(jsonb) only. No DROP, no DELETE. Safe to run twice.

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
   where m.id=(r->>'id')::uuid
   on conflict(message_id) do nothing;
  get diagnostics n=row_count;stored:=stored+n;
 end loop;
 return stored;
end $fn$;

create or replace function private.workspace_guest_translations_latest(thread_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('threadId',t.id,'id',l.id,'direction',l.direction,'body',l.body,'language',tr.language,'english',tr.english)),'[]')
 from private.workspace_guest_threads t
 cross join lateral (select m.id,m.direction,m.body from private.workspace_guest_messages m where m.source=t.source and m.thread_ref=t.thread_ref
  order by m.sent_at desc,m.id desc limit 1) l
 left join private.workspace_guest_message_translations tr on tr.message_id=l.id
 where t.id=any((coalesce(thread_ids,'{}'::uuid[]))[1:300]);
$$;

create or replace function public.workspace_guest_translations_latest(thread_ids uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_guest_translations_latest(thread_ids);$$;
revoke all on function private.workspace_guest_translations_latest(uuid[]),public.workspace_guest_translations_latest(uuid[]),
 private.workspace_guest_translations_put(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_guest_translations_latest(uuid[]),public.workspace_guest_translations_latest(uuid[]),
 private.workspace_guest_translations_put(jsonb) to service_role;
