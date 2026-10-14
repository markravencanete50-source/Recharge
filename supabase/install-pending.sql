-- FOR LEE (morning of 15 October 2026): voice notes in chat. One paste, then run.
-- The safe part (new column, bucket types, functions) is already on live, installed by the lead on 14 October.
-- This paste adds the part the lead does not run: it swaps the two old checks on chat attachments
-- (photo and video only) for ones that also allow voice notes, then records the migration as done.
-- Photos and videos already sent are not touched. The voice-note app code goes live after this.

-- Voice notes in chat: the 1 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261021100000%') then raise exception 'Voice notes in chat is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261021100000_chat_voice_notes =====
-- Voice notes in Messages (Alex, on a phone: "like WhatsApp"). A voice note is a chat file of a new kind, 'audio', kept
-- exactly like chat photos and videos: in the private chat-files bucket, uploaded with a one-off link (prepareFiles),
-- claimed by the message that sends it, and opened only with short-lived signed links by people in the conversation
-- (private.workspace_chat_files, unchanged). The app records AAC in MP4 (Safari, every iPhone browser) or converts the
-- recording to WAV (Chrome, Firefox, Android), so every note plays on an iPhone.
-- private.chat_attachments: kind may be 'audio'; mime may be audio/mp4 or audio/wav; a new column duration_ms (the
--   note's length in milliseconds, 1 to 305,000, required for a voice note and empty for anything else, checked by a
--   new constraint chat_attachments_duration_check).
--   SECTION 1 is the one DROP (agreed with the lead; Lee pastes it himself): Postgres cannot change a check in place,
--   so the two column checks chat_attachments_kind_check and chat_attachments_mime_check are swapped for wider ones of
--   the same names in a single ALTER TABLE statement (atomic: there is no moment without them). No row, column or
--   function is removed, and every existing row passes the wider checks. It only runs while the old narrow checks are
--   there, so a second run drops nothing.
--   SECTION 2 (everything else) installs safely before or after section 1: until the checks widen, a voice note is
--   refused by the table (nothing can make one until the app's voice notes are released), and photos and videos work
--   exactly as before.
-- storage bucket chat-files: audio/mp4 and audio/wav are added to the allowed types (size limit unchanged at 50 MB).
-- Patched by anchor (sentinel, an anchor that must occur once):
--   private.chat_more_action (prepareFiles: a voice note is sent on its own, .m4a or .wav, up to 10 MB, with its length),
--   private.chat_attach (a voice note on its own; the stored copy up to 10 MB),
--   private.chat_attachments_json (each file carries durationMs),
--   private.chat_attachment_label (a voice note reads "🎤 Voice note (0:42)" in the list and in previews),
--   private.workspace_chat_action (a pop-up for a message with no words carries that label, so it reads
--   "Alex sent a voice note (0:42)", and a photo "📷 Photo", instead of nothing).
-- New: private.chat_voice_length(integer), "0:42" from milliseconds. No DELETE, no function dropped. Safe to run twice.

-- ================================================================ SECTION 1: the constraint swap (contains a DROP)
do $swap$
begin
 if exists(select 1 from pg_constraint where conrelid='private.chat_attachments'::regclass and conname in ('chat_attachments_kind_check','chat_attachments_mime_check')
   and position('audio' in pg_get_constraintdef(oid))=0) then
  alter table private.chat_attachments
   drop constraint if exists chat_attachments_kind_check,
   add constraint chat_attachments_kind_check check(kind in ('image','video','audio')),
   drop constraint if exists chat_attachments_mime_check,
   add constraint chat_attachments_mime_check check(mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','audio/mp4','audio/wav'));
 end if;
end $swap$;
-- ================================================================ END OF SECTION 1

-- ================================================================ SECTION 2: no DROP, no DELETE
-- ---------------------------------------------------------------- the files table
alter table private.chat_attachments add column if not exists duration_ms integer;
do $checks$
begin
 if not exists(select 1 from pg_constraint where conrelid='private.chat_attachments'::regclass and conname='chat_attachments_duration_check') then
  alter table private.chat_attachments add constraint chat_attachments_duration_check
   check(case when kind='audio' then coalesce(duration_ms between 1 and 305000,false) else duration_ms is null end);
 end if;
end $checks$;

do $bucket$
begin
 if to_regclass('storage.buckets') is not null then
  execute $q$update storage.buckets set allowed_mime_types=allowed_mime_types||array(select t from unnest(array['audio/mp4','audio/wav']) t where t<>all(allowed_mime_types))
   where id='chat-files' and allowed_mime_types is not null and not allowed_mime_types@>array['audio/mp4','audio/wav']$q$;
 end if;
end $bucket$;

-- "0:42", "4:59": a voice note's length, rounded to the second (at least 0:01).
create or replace function private.chat_voice_length(ms integer) returns text language sql immutable set search_path='' as $$
 select (greatest(1,round(coalesce(ms,0)/1000.0))::integer/60)::text||':'||lpad((greatest(1,round(coalesce(ms,0)/1000.0))::integer%60)::text,2,'0')
$$;
revoke all on function private.chat_voice_length(integer) from public,anon,authenticated;

-- ---------------------------------------------------------------- the functions, by anchor
do $patch$
declare
 fixes constant text[][] := array[
  -- prepareFiles: a voice note goes on its own.
  ['private.chat_more_action(jsonb)',
   $q$if (select count(*) from jsonb_array_elements(input->'files') x where x->>'mime' like 'video/%')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;$q$,
   $q$if (select count(*) from jsonb_array_elements(input->'files') x where x->>'mime' like 'video/%')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;
  -- Voice notes (20261021100000): one at a time, on its own.
  if exists(select 1 from jsonb_array_elements(input->'files') x where x->>'mime' like 'audio/%') and jsonb_array_length(input->'files')>1 then raise exception 'Send a voice note on its own' using errcode='22023';end if;$q$,
   $q$Send a voice note on its own$q$],
  ['private.chat_more_action(jsonb)',
   $q$when 'video/webm' then 'webm' end;$q$,
   $q$when 'video/webm' then 'webm' when 'audio/mp4' then 'm4a' when 'audio/wav' then 'wav' end;$q$,
   $q$when 'audio/wav' then 'wav'$q$],
  ['private.chat_more_action(jsonb)',
   $q$fkind:=case when f->>'mime' like 'video/%' then 'video' else 'image' end;$q$,
   $q$fkind:=case when f->>'mime' like 'video/%' then 'video' when f->>'mime' like 'audio/%' then 'audio' else 'image' end;
   if fkind='audio' and (jsonb_typeof(f->'durationMs') is distinct from 'number' or (f->>'durationMs')::numeric not between 1 and 305000) then
    raise exception 'Voice notes can be up to 5 minutes' using errcode='22023';end if;$q$,
   $q$Voice notes can be up to 5 minutes$q$],
  ['private.chat_more_action(jsonb)',
   $q$(f->>'bytes')::numeric>(case when fkind='video' then 52428800 else 15728640 end) then$q$,
   $q$(f->>'bytes')::numeric>(case when fkind='video' then 52428800 when fkind='audio' then 10485760 else 15728640 end) then$q$,
   $q$when fkind='audio' then 10485760$q$],
  ['private.chat_more_action(jsonb)',
   $q$case when fkind='video' then 'Videos can be up to 50 MB' else$q$,
   $q$case when fkind='video' then 'Videos can be up to 50 MB' when fkind='audio' then 'Voice notes can be up to 10 MB' else$q$,
   $q$Voice notes can be up to 10 MB$q$],
  ['private.chat_more_action(jsonb)',
   $q$insert into private.chat_attachments(id,conversation_id,uploader_id,path,kind,mime,bytes,name,width,height)$q$,
   $q$insert into private.chat_attachments(id,conversation_id,uploader_id,path,kind,mime,bytes,name,width,height,duration_ms)$q$,
   $q$name,width,height,duration_ms)$q$],
  ['private.chat_more_action(jsonb)',
   $q$case when jsonb_typeof(f->'height')='number' and (f->>'height')::numeric between 1 and 20000 then (f->>'height')::numeric::integer end);$q$,
   $q$case when jsonb_typeof(f->'height')='number' and (f->>'height')::numeric between 1 and 20000 then (f->>'height')::numeric::integer end,
     case when fkind='audio' then round((f->>'durationMs')::numeric)::integer end);$q$,
   $q$case when fkind='audio' then round((f->>'durationMs')::numeric)::integer end$q$],
  -- Sending: a voice note on its own, and its stored copy up to 10 MB.
  ['private.chat_attach(uuid,uuid,uuid,jsonb)',
   $q$if (select count(*) from private.chat_attachments a where a.id=any(wanted) and a.kind='video')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;$q$,
   $q$if (select count(*) from private.chat_attachments a where a.id=any(wanted) and a.kind='video')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;
 if exists(select 1 from private.chat_attachments a where a.id=any(wanted) and a.kind='audio') and cardinality(wanted)>1 then raise exception 'Send a voice note on its own' using errcode='22023';end if;$q$,
   $q$Send a voice note on its own$q$],
  ['private.chat_attach(uuid,uuid,uuid,jsonb)',
   $q$between 1 and case when a.kind='video' then 52428800 else 15728640 end$q$,
   $q$between 1 and case when a.kind='video' then 52428800 when a.kind='audio' then 10485760 else 15728640 end$q$,
   $q$when a.kind='audio' then 10485760$q$],
  ['private.chat_attachments_json(uuid)',
   $q$'width',a.width,'height',a.height)$q$,
   $q$'width',a.width,'height',a.height,'durationMs',a.duration_ms)$q$,
   $q$'durationMs',a.duration_ms$q$],
  ['private.chat_attachment_label(uuid)',
   $q$select case when count(*)=0 then '' when$q$,
   $q$select case when count(*)=0 then '' when count(*) filter(where a.kind='audio')>0 then '🎤 Voice note ('||private.chat_voice_length(max(a.duration_ms))||')' when$q$,
   $q$Voice note ($q$],
  -- A pop-up for a voice note (or photos) with no words says what was sent.
  ['private.workspace_chat_action(jsonb)',
   $q$private.workspace_push_line(msg.body),case when conv.kind='group' then left(conv.title,120) end,previous is not null) on conflict do nothing;$q$,
   $q$coalesce(private.workspace_push_line(msg.body),nullif(private.chat_attachment_label(msg.id),'')),case when conv.kind='group' then left(conv.title,120) end,previous is not null) on conflict do nothing;$q$,
   $q$nullif(private.chat_attachment_label(msg.id),'')$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261021100000','chat_voice_notes');

commit;
