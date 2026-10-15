-- @mentions in team group chats (Lee: "like WhatsApp"), and what a message pop-up needs to look like a phone messenger (Alex).
-- In a group conversation (a team channel such as Guest relations or Everyone, or a group chat) a message can mention people in
-- it, or everyone. Never in a 1-to-1 chat, an owner's conversation, or a guest or client email.
--  * Stored as data, not read back out of the words: private.chat_mentions (message, person) and a new column
--    private.chat_messages.mentions_everyone (false by default). The words keep "@Erika Smith" so the message reads the same
--    everywhere; the app highlights a name only where the message really mentions that person.
--  * Checked here when the message is sent (private.chat_mention_save): only in group conversations, only people who are in the
--    conversation (a group's members, a channel's team), up to 50 at a time. @everyone: anyone in a group or team channel may use it
--    (private.chat_may_mention_everyone, the one place to narrow it later, for example to admins in the Everyone channel).
--  * A mentioned person is always told (private.chat_mention_notify), even in a channel they otherwise do not hear (admins only hear
--    Management and Everyone): the same notice as everyone else gets, added for them. @everyone tells everyone who can read the
--    conversation. Anyone who blocked the sender is never told.
--  * The conversation list says when there is an unread message that mentions you (or everyone): 'mentioned' in private.chat_summary.
--    Each message lists who it mentions ('mentions': id, name, and whether it is you) and 'mentionsEveryone'.
--  * Pop-ups: private.workspace_activity_details keeps the message a notice is about (new column message_id), and
--    private.integration_push_details adds the conversation (so a tap opens it and its pop-ups group together), the kind of
--    conversation (and, for the team, the owner's name in an owner's conversation), whether the message mentions this person or everyone, how many messages they have not read there, and the
--    sender's photo path and colour (the backend turns the path into a link that lasts an hour; an owner never gets a staff photo).
--    private.integration_claim_notifications hands the same details to phone-app pushes (never to email).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_chat_action (the send keys, saving mentions,
-- telling mentioned people), private.chat_summary, private.workspace_chat_read (messages), private.integration_push_details,
-- private.integration_claim_notifications.
-- No DROP, no DELETE. Safe to run twice.

-- ---------------------------------------------------------------- storage
create table if not exists private.chat_mentions (
 message_id uuid not null references private.chat_messages(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 primary key(message_id,user_id)
);
create index if not exists chat_mentions_user_idx on private.chat_mentions(user_id);
alter table private.chat_mentions enable row level security;
revoke all on private.chat_mentions from public,anon,authenticated;

alter table private.chat_messages add column if not exists mentions_everyone boolean not null default false;
alter table private.workspace_activity_details add column if not exists message_id uuid references private.chat_messages(id) on delete cascade;

-- ---------------------------------------------------------------- rules
-- Who may mention everyone: anyone in a group conversation or team channel.
create or replace function private.chat_may_mention_everyone(target uuid,subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.chat_conversations c where c.id=target and c.kind='group') and private.chat_can(target,subject)
$fn$;

-- Saves the people a new message mentions ('mentions': ids, 'mentionEveryone': true), after checking them.
create or replace function private.chat_mention_save(message uuid,target uuid,author uuid,input jsonb) returns void language plpgsql security definer set search_path='' as $fn$
declare listed jsonb:=coalesce(nullif(input->'mentions','null'::jsonb),'[]'::jsonb);everyone jsonb:=coalesce(nullif(input->'mentionEveryone','null'::jsonb),'false'::jsonb);people uuid[];
begin
 if jsonb_typeof(listed)<>'array' or jsonb_typeof(everyone)<>'boolean' then raise exception 'Check the mentions' using errcode='22023';end if;
 if jsonb_array_length(listed)>50 then raise exception 'Mention up to 50 people at a time' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(listed) e where jsonb_typeof(e)<>'string' or (e#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
  raise exception 'Check the mentions' using errcode='22023';end if;
 people:=array(select distinct (e#>>'{}')::uuid from jsonb_array_elements(listed) e);
 if cardinality(people)=0 and everyone='false'::jsonb then return;end if;
 if not exists(select 1 from private.chat_conversations c where c.id=target and c.kind='group') then raise exception 'Mentions are for group conversations' using errcode='22023';end if;
 if everyone='true'::jsonb and not private.chat_may_mention_everyone(target,author) then raise exception 'You cannot mention everyone here' using errcode='42501';end if;
 if exists(select 1 from unnest(people) u where not (private.chat_is_team(u) and private.chat_can(target,u))) then raise exception 'Mention only people in this conversation' using errcode='22023';end if;
 insert into private.chat_mentions(message_id,user_id) select message,u from unnest(people) u where u<>author on conflict do nothing;
 if everyone='true'::jsonb then update private.chat_messages set mentions_everyone=true where id=message;end if;
end $fn$;

-- Tells the people a message mentions (or, for @everyone, everyone who can read it), whether or not they hear the conversation.
create or replace function private.chat_mention_notify(message uuid,target uuid,author uuid,ev bigint) returns void language sql security definer set search_path='' as $fn$
 insert into private.workspace_notification_outbox(user_id,event_id)
 select p.user_id,ev from public.workspace_profiles p
 where p.status='active' and p.role<>'client' and p.user_id<>author and private.chat_can(target,p.user_id) and not private.chat_blocked(p.user_id,author)
  and (exists(select 1 from private.chat_mentions m where m.message_id=message and m.user_id=p.user_id)
   or coalesce((select x.mentions_everyone from private.chat_messages x where x.id=message),false))
 on conflict do nothing
$fn$;

-- Who a message mentions, for the person reading it.
create or replace function private.chat_mentions_json(message uuid,reader uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',p.full_name,'you',m.user_id=reader) order by p.full_name),'[]'::jsonb)
 from private.chat_mentions m join public.workspace_profiles p on p.user_id=m.user_id where m.message_id=message
$fn$;

-- An unread message in this conversation mentions the reader (or everyone).
create or replace function private.chat_mentioned(target uuid,reader uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.chat_messages x where x.conversation_id=target and x.author_id<>reader and x.kind='text' and x.removed_at is null
  and not private.chat_blocked(reader,x.author_id)
  and x.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=reader),'-infinity'::timestamptz)
  and (x.mentions_everyone or exists(select 1 from private.chat_mentions m where m.message_id=x.id and m.user_id=reader)))
$fn$;

revoke all on function private.chat_may_mention_everyone(uuid,uuid),private.chat_mention_save(uuid,uuid,uuid,jsonb),private.chat_mention_notify(uuid,uuid,uuid,bigint),
 private.chat_mentions_json(uuid,uuid),private.chat_mentioned(uuid,uuid) from public,anon,authenticated;

-- ---------------------------------------------------------------- the functions, by anchor
do $patch$
declare
 fixes constant text[][] := array[
  -- Sending: two new keys.
  ['private.workspace_chat_action(jsonb)',
   $q$array['action','requestId','conversationId','body','attachments']$q$,
   $q$array['action','requestId','conversationId','body','attachments','mentions','mentionEveryone']$q$,
   $q$'mentionEveryone'$q$],
  -- Sending: the mentions are checked and saved with the message (a refusal sends nothing).
  ['private.workspace_chat_action(jsonb)',
   $q$perform private.chat_attach(new_id,target,me,coalesce(nullif(input->'attachments','null'::jsonb),'[]'::jsonb));$q$,
   $q$perform private.chat_attach(new_id,target,me,coalesce(nullif(input->'attachments','null'::jsonb),'[]'::jsonb));
  -- Mentions (20261021400000): checked and saved with the message.
  perform private.chat_mention_save(new_id,target,me,input);$q$,
   $q$private.chat_mention_save(new_id,target,me,input)$q$],
  -- Sending: the notice knows its message, and mentioned people are told even where they do not hear the conversation.
  ['private.workspace_chat_action(jsonb)',
   $q$-- Once per conversation until read (20261014320000): everyone due a notice is told and the time is recorded.$q$,
   $q$-- Mentions (20261021400000): the notice knows its message; mentioned people are always told.
  update private.workspace_activity_details set message_id=msg.id where event_id=ev;
  perform private.chat_mention_notify(msg.id,target,me,ev);
  -- Once per conversation until read (20261014320000): everyone due a notice is told and the time is recorded.$q$,
   $q$private.chat_mention_notify(msg.id,target,me,ev)$q$],
  -- The list: an unread message mentions you.
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id$q$,
   $q$'mentioned',private.chat_mentioned(c.id,me),
  'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id$q$,
   $q$'mentioned',private.chat_mentioned(c.id,me)$q$],
  -- Each message: who it mentions.
  ['private.workspace_chat_read(text,uuid,timestamp with time zone)',
   $q$'reactions',case when private.chat_hidden(x,me) then '[]'::jsonb else private.chat_reactions_json(x.id,me) end) item$q$,
   $q$'reactions',case when private.chat_hidden(x,me) then '[]'::jsonb else private.chat_reactions_json(x.id,me) end,
     'mentions',case when private.chat_hidden(x,me) then '[]'::jsonb else private.chat_mentions_json(x.id,me) end,'mentionsEveryone',x.mentions_everyone and not private.chat_hidden(x,me)) item$q$,
   $q$private.chat_mentions_json(x.id,me)$q$],
  -- Pop-ups: the conversation, a mention, the unread count, and the sender's photo (never a staff photo for an owner).
  ['private.integration_push_details(bigint)',
   $q$'propertyName',pr.name))$q$,
   $q$'propertyName',pr.name,
  'conversationId',(select x.conversation_id from private.chat_messages x where x.id=d.message_id),
  'conversationKind',(select c.kind from private.chat_messages x join private.chat_conversations c on c.id=x.conversation_id where x.id=d.message_id),
  'ownerName',case when rp.role<>'client' then (select op.full_name from private.chat_messages x join private.chat_conversations c on c.id=x.conversation_id and c.kind='owner'
   join public.workspace_profiles op on op.user_id=c.owner_id where x.id=d.message_id) end,
  'mention',case when exists(select 1 from private.chat_mentions m where m.message_id=d.message_id and m.user_id=o.user_id) then 'you'
   when (select x.mentions_everyone from private.chat_messages x where x.id=d.message_id) then 'everyone' end,
  'unreadCount',case when d.message_id is not null then (select count(*) from private.chat_messages t join private.chat_messages x on x.id=d.message_id
   where t.conversation_id=x.conversation_id and t.author_id<>o.user_id and t.kind='text' and t.removed_at is null and t.created_at<=x.created_at
    and not private.chat_blocked(o.user_id,t.author_id)
    and t.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=x.conversation_id and r.user_id=o.user_id),'-infinity'::timestamptz)) end,
  'senderPhotoPath',case when d.message_id is not null and rp.role<>'client' then ap.avatar_path end,
  'senderColour',case when d.message_id is not null and rp.role<>'client' then ap.avatar_preset end))$q$,
   $q$'senderPhotoPath'$q$],
  -- Phone-app pushes get the same details (email never does).
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$'createdAt',created_at,$q$,
   $q$'createdAt',created_at,'details',case when channel='push' then private.integration_push_details(outbox_id) end,$q$,
   $q$private.integration_push_details(outbox_id)$q$]
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
