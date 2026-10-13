-- Message notices (client answer 12): "notifications for any message that's related to that person's department; any chat
-- I'm in, I want a notification for; any chat a cleaner is in, they get a notification for; same for landlords."
-- How it works: sending a chat message adds one 'chat.message' (or 'chat.owner_message') activity row and a notice for each
-- person in private.chat_audience (the members; for an owner's conversation the owner and the team that answers owners; for a team
-- channel everyone in that department, admins only in Management and Everyone), except the sender and anyone who blocked them.
-- Who is in the audience is unchanged here. What changes is the "once per conversation until read" rule: a person was told only
-- if they had read the conversation since the message before, so someone who had never opened it (no read row: a new starter, a
-- person newly added to a channel or group) was told about the first message only and never again. Now the time each person was
-- last told is kept in private.chat_notified, and they are told again once they have read since then.
-- The workflow notice routes (workspace_notice_routes) are not touched. workspace_chat_action is patched by anchor and append:
-- the anchor stays first, a sentinel stops a second run, and a missing or repeated anchor raises.

create table if not exists private.chat_notified (
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 notified_at timestamptz not null,
 primary key(conversation_id,user_id)
);
create index if not exists chat_notified_user_idx on private.chat_notified(user_id);
alter table private.chat_notified enable row level security;
revoke all on private.chat_notified from public,anon,authenticated;

-- Is this person due a notice for this conversation: never told, or told before they last read it.
create or replace function private.chat_notice_due(target uuid,subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce((select n.notified_at from private.chat_notified n where n.conversation_id=target and n.user_id=subject),'-infinity'::timestamptz)
  <=coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=subject),'-infinity'::timestamptz)
$fn$;

revoke all on function private.chat_notice_due(uuid,uuid) from public,anon,authenticated;

-- The send branch keeps its own notice (people who had read since the message before) and then adds one for everyone due by the
-- new rule, recording when each was told. Everyone the old rule tells is also due by the new one, so the record covers them all.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_chat_action(jsonb)',
   $q$and coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=u),'-infinity')>=coalesce(previous,'-infinity')$q$,
   $q$and coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=u),'-infinity')>=coalesce(previous,'-infinity')
   on conflict do nothing;
  -- Once per conversation until read (20261014320000): everyone due a notice is told and the time is recorded.
  with due as (select u from private.chat_audience(target) u where u<>me and not private.chat_blocked(u,me) and private.chat_notice_due(target,u)),
  noted as (insert into private.chat_notified(conversation_id,user_id,notified_at) select target,u,now() from due
   on conflict(conversation_id,user_id) do update set notified_at=excluded.notified_at returning user_id)
  insert into private.workspace_notification_outbox(user_id,event_id) select n.user_id,ev from noted n$q$,
   $q$private.chat_notice_due(target,u)$q$]
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
