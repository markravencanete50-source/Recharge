-- Messages redesign (Lee, round 5): the Clients tab filters owner conversations into Needs a reply, Waiting for reply and Closed, like
-- the Guests tab. Guest conversations already have Done; owner conversations had no such state. From here the team that answers an
-- owner (private.chat_owner_team: admins, the client relations or management rota, Stays on the owner's properties) can close an owner
-- conversation and reopen it. A new message from anyone reopens it by itself. Owners never close and never see whether it is closed.
-- "Who spoke last" is already in the list (last.fromOwner), so it needs no change.
-- chat_summary gains 'closed' (true only for the team's view of a closed owner conversation) by anchor and append, and the chat action
-- routes 'closeConversation' by anchor and append (the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
-- raises).

alter table private.chat_conversations add column if not exists closed_at timestamptz;
alter table private.chat_conversations add column if not exists closed_by uuid references public.workspace_profiles(user_id);
create index if not exists chat_conversations_closed_by_idx on private.chat_conversations(closed_by);
alter table private.chat_conversations drop constraint if exists chat_conversations_closed_owner_only;
alter table private.chat_conversations add constraint chat_conversations_closed_owner_only check(closed_at is null or kind='owner');

-- closeConversation {conversationId, closed}: the owner team closes (true) or reopens (false) an owner conversation.
create or replace function private.chat_close_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();c private.chat_conversations;
begin
 perform private.workspace_json_keys(input,array['action','conversationId','closed']);
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if jsonb_typeof(input->'closed') is distinct from 'boolean' then raise exception 'Choose close or reopen' using errcode='22023';end if;
 select * into c from private.chat_conversations x where x.id=(input->>'conversationId')::uuid for update;
 if c.id is null or c.kind<>'owner' or not private.chat_owner_team(c.owner_id,me) then raise exception 'Conversation not found' using errcode='42501';end if;
 if (input->>'closed')::boolean then
  update private.chat_conversations set closed_at=coalesce(closed_at,now()),closed_by=coalesce(closed_by,me) where id=c.id returning * into c;
 else
  update private.chat_conversations set closed_at=null,closed_by=null where id=c.id returning * into c;
 end if;
 return private.chat_summary(c,me);
end $fn$;

-- Any new message reopens a closed owner conversation.
create or replace function private.chat_reopen_on_message() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 update private.chat_conversations set closed_at=null,closed_by=null where id=new.conversation_id and closed_at is not null;
 return null;
end $fn$;
drop trigger if exists chat_reopen_on_message on private.chat_messages;
create trigger chat_reopen_on_message after insert on private.chat_messages for each row when (new.kind='text') execute function private.chat_reopen_on_message();

revoke all on function private.chat_close_action(jsonb),private.chat_reopen_on_message() from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'named',c.kind<>'group' or c.title is not null,$q$,
   $q$'named',c.kind<>'group' or c.title is not null,
  'closed',c.kind='owner' and c.owner_id<>me and c.closed_at is not null,$q$,
   $q$'closed',c.kind='owner' and c.owner_id<>me and c.closed_at is not null$q$],
  ['private.workspace_chat_action(jsonb)',
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;$q$,
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;
 if a='closeConversation' then return private.chat_close_action(input);end if;$q$,
   $q$if a='closeConversation' then return private.chat_close_action(input)$q$]
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
