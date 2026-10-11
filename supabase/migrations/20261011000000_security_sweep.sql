-- Security sweep (11 October 2026).
--
-- 1. Chat photos and videos while a super admin views the app as someone: like the messages
--    themselves, only files in conversations the super admin could open on their own.
-- 2. Photos and videos added to a message but never sent: at most 18 waiting per person (three
--    messages' worth) and 60 added an hour, so nobody can fill storage with files they never send.

create or replace function private.workspace_chat_files(ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();viewer uuid:=private.workspace_viewer();
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if ids is null or cardinality(ids)>60 then raise exception 'Choose up to 60 files' using errcode='22023';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'mime',a.mime,'name',a.name,'kind',a.kind))
  from private.chat_attachments a where a.id=any(ids) and (a.message_id is not null or a.uploader_id=me) and private.chat_can(a.conversation_id,me)
   and (viewer is null or private.chat_can(a.conversation_id,viewer))),'[]'::jsonb);
end $fn$;
revoke all on function private.workspace_chat_files(uuid[]) from public,anon;
grant execute on function private.workspace_chat_files(uuid[]) to authenticated;

do $$
declare
 fixes text[][] := array[
  ['private.chat_more_action(jsonb)',
   $q$if (select count(*) from private.chat_attachments x where x.uploader_id=me and x.created_at>now()-interval '1 hour')>=120 then raise exception 'Too many uploads. Please wait a little.' using errcode='22023';end if;$q$,
   $q$if (select count(*) from private.chat_attachments x where x.uploader_id=me and x.created_at>now()-interval '1 hour')>=60 then raise exception 'Too many uploads. Please wait a little.' using errcode='22023';end if;
  if (select count(*) from private.chat_attachments x where x.uploader_id=me and x.message_id is null and x.created_at>now()-interval '6 hours')+jsonb_array_length(input->'files')>18 then
   raise exception 'You have photos or videos waiting to be sent. Send or remove them first.' using errcode='22023';end if;$q$,
   $q$You have photos or videos waiting to be sent.$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
