-- Reporting and blocking in Messages, and a moderation view for admins (12 October 2026).
--
-- Apple App Review guideline 1.2 and Google Play's user-generated-content policy ask for four
-- things in an app where people can write to each other: a way to report objectionable content,
-- a way to block abusive users, filtering of what gets through, and timely action on reports.
--
-- * Anyone in a conversation can report a message that is not their own, with a reason and an
--   optional note. One open report per person per message, at most 10 an hour and 30 a day.
--   Active admins and super admins are told straight away (`chat.reported`).
-- * Anyone can block another person they share a conversation with. For the blocker, the
--   person's messages are withheld by the database (the app shows "Message from someone you
--   blocked"), their photos and reactions are not offered, they never count as unread or send a
--   notification, and the blocked person cannot start a new direct conversation with them. In
--   groups, team channels and owner conversations a block only hides things for the blocker, so
--   nobody can be shut out of shared work by someone else's block.
-- * Admins and super admins see the reported messages (Reported messages), and either remove the
--   message (hidden for everyone, replaced by "Removed by an admin", its photos and videos no
--   longer opened) or dismiss the report. Every open report on the same message is decided
--   together. Stopping a person using Recharge at all stays in Access control.
--
-- Everything goes through the functions below; people never read these tables directly. The
-- report and block actions are chat actions (`reportMessage`, `blockUser`, `unblockUser`, read
-- section `blocks`); the moderation list and decision are team actions (read section
-- `chatReports`, action `decideChatReport`), like Feedback.

-- ---------------------------------------------------------------- tables
alter table private.chat_messages add column if not exists removed_at timestamptz;
alter table private.chat_messages add column if not exists removed_by uuid references public.workspace_profiles(user_id);
create index if not exists chat_messages_removed_by_idx on private.chat_messages(removed_by) where removed_by is not null;

create table if not exists private.chat_blocks (
 blocker_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 blocked_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id),
 check(blocker_id<>blocked_id)
);
create index if not exists chat_blocks_blocked_idx on private.chat_blocks(blocked_id);

create table if not exists private.chat_reports (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references private.chat_messages(id) on delete cascade,
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 author_id uuid not null references public.workspace_profiles(user_id),
 reporter_id uuid not null references public.workspace_profiles(user_id),
 reason text not null check(reason in ('offensive','harassment','media','spam','other')),
 note text not null default '' check(char_length(note)<=500),
 status text not null default 'open' check(status in ('open','actioned','dismissed')),
 handled_by uuid references public.workspace_profiles(user_id),
 handled_at timestamptz,
 created_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create unique index if not exists chat_reports_one_open_idx on private.chat_reports(message_id,reporter_id) where status='open';
create index if not exists chat_reports_status_idx on private.chat_reports(status,created_at desc,id);
create index if not exists chat_reports_message_idx on private.chat_reports(message_id);
create index if not exists chat_reports_conversation_idx on private.chat_reports(conversation_id);
create index if not exists chat_reports_author_idx on private.chat_reports(author_id);
create index if not exists chat_reports_reporter_idx on private.chat_reports(reporter_id,created_at desc);
create index if not exists chat_reports_handler_idx on private.chat_reports(handled_by);

do $$ declare t text; begin
 foreach t in array array['chat_blocks','chat_reports'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create or replace trigger business_write_limit before insert or update or delete on private.chat_blocks for each row execute function private.workspace_enforce_write_limit();
create or replace trigger business_write_limit before insert or update on private.chat_reports for each row execute function private.workspace_enforce_write_limit();

-- ---------------------------------------------------------------- helpers
-- Whether `blocker` has blocked `other`.
create or replace function private.chat_blocked(blocker uuid, other uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.chat_blocks b where b.blocker_id=blocker and b.blocked_id=other)
$fn$;
-- Whether a message is withheld from `me`: removed by an admin (for everyone), or written by
-- someone `me` has blocked. Group lines ("added Alex") are never withheld.
create or replace function private.chat_hidden(m private.chat_messages, me uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select m.removed_at is not null or (m.kind='text' and private.chat_blocked(me,m.author_id))
$fn$;
-- Whether two people share a conversation (or are both on the team, who can all see each other
-- in Messages), so nobody can probe for accounts they have no reason to know about.
create or replace function private.chat_shares(me uuid, other uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select (private.chat_is_team(me) and private.chat_is_team(other))
  or exists(select 1 from private.chat_members a join private.chat_members b on b.conversation_id=a.conversation_id where a.user_id=me and b.user_id=other)
  or exists(select 1 from private.chat_messages x where x.author_id=other and private.chat_can(x.conversation_id,me))
$fn$;
-- Whether a stored file may be opened: it must not be in a removed message or one from someone
-- the reader blocked. Admins may open the files of a message with an open report, to judge it.
create or replace function private.chat_file_open(msg uuid, conv uuid, me uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select case when msg is null then private.chat_can(conv,me)
  else exists(select 1 from private.chat_messages m where m.id=msg and m.removed_at is null and (
   (private.chat_can(conv,me) and not private.chat_blocked(me,m.author_id))
   or (coalesce(private.workspace_actor_role(),'') in ('admin','super_admin') and exists(select 1 from private.chat_reports r where r.message_id=m.id and r.status='open')))) end
$fn$;

-- The people you have blocked, newest first. An owner sees team members as the app names them
-- in their conversation ("Recharge · Fiona"), never by full name.
create or replace function private.chat_blocks_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,
   'fullName',case when actor='client' and p.role<>'client' then 'Recharge · '||split_part(p.full_name,' ',1) else p.full_name end,
   'role',p.role,'photo',private.chat_photo(p.user_id),'blockedAt',b.created_at) order by b.created_at desc,p.user_id)
  from private.chat_blocks b join public.workspace_profiles p on p.user_id=b.blocked_id where b.blocker_id=me),'[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------- reporting and blocking
create or replace function private.chat_moderation_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 msg private.chat_messages;rep private.chat_reports;other uuid;event_id bigint;note_text text:='';
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if a='reportMessage' then
  perform private.workspace_json_keys(input,array['action','requestId','messageId','reason','note']);
  req:=(input->>'requestId')::uuid;
  if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text||req::text,0));
  prior:=(select x from private.workspace_action_receipts x where x.actor_id=me and x.request_id=req);
  if prior.actor_id is not null then
   if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
   if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
   return prior.result;
  end if;
  msg:=(select m from private.chat_messages m where m.id=(input->>'messageId')::uuid);
  if msg.id is null or msg.kind<>'text' or not private.chat_can(msg.conversation_id,me) then raise exception 'Message not found' using errcode='42501';end if;
  if msg.author_id=me then raise exception 'You cannot report your own message' using errcode='22023';end if;
  if msg.removed_at is not null then raise exception 'That message has already been removed' using errcode='22023';end if;
  if coalesce(input->>'reason','') not in ('offensive','harassment','media','spam','other') then raise exception 'Choose a reason' using errcode='22023';end if;
  if input ? 'note' and jsonb_typeof(input->'note') not in ('string','null') then raise exception 'Invalid note' using errcode='22023';end if;
  note_text:=coalesce(btrim(input->>'note'),'');
  if char_length(note_text)>500 then raise exception 'Keep the note to 500 characters' using errcode='22023';end if;
  if exists(select 1 from private.chat_reports r where r.message_id=msg.id and r.reporter_id=me and r.status='open') then
   raise exception 'You have already reported this message. An admin will review it.' using errcode='22023';
  end if;
  if (select count(*) from private.chat_reports r where r.reporter_id=me and r.created_at>now()-interval '1 hour')>=10
   or (select count(*) from private.chat_reports r where r.reporter_id=me and r.created_at>now()-interval '1 day')>=30 then
   raise exception 'That is a lot of reports. Try again a little later, or tell an admin directly.' using errcode='P0001';
  end if;
  insert into private.chat_reports(message_id,conversation_id,author_id,reporter_id,reason,note)
   values(msg.id,msg.conversation_id,msg.author_id,me,input->>'reason',note_text) returning * into rep;
  -- Every active admin and super admin hears about it.
  insert into public.workspace_activity(actor_id,event_type) values(me,'chat.reported') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,event_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') and p.user_id<>me on conflict do nothing;
  result:=jsonb_build_object('reported',true,'reportId',rep.id,'authorId',msg.author_id,'blocked',private.chat_blocked(me,msg.author_id));
  insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(me,req,input,result);
  return result;
 elsif a='blockUser' then
  perform private.workspace_json_keys(input,array['action','userId']);
  other:=(input->>'userId')::uuid;
  if other is null or other=me then raise exception 'Choose someone else to block' using errcode='22023';end if;
  if not exists(select 1 from public.workspace_profiles p where p.user_id=other and p.status='active') or not private.chat_shares(me,other) then raise exception 'Person not found' using errcode='42501';end if;
  if not private.chat_blocked(me,other) and (select count(*) from private.chat_blocks b where b.blocker_id=me)>=200 then
   raise exception 'You have blocked as many people as you can. Unblock someone first.' using errcode='22023';
  end if;
  insert into private.chat_blocks(blocker_id,blocked_id) values(me,other) on conflict do nothing;
  return jsonb_build_object('blocked',true,'userId',other);
 elsif a='unblockUser' then
  perform private.workspace_json_keys(input,array['action','userId']);
  other:=(input->>'userId')::uuid;
  if other is null then raise exception 'Choose someone to unblock' using errcode='22023';end if;
  delete from private.chat_blocks where blocker_id=me and blocked_id=other;
  return jsonb_build_object('blocked',false,'userId',other);
 end if;
 raise exception 'Unknown chat action' using errcode='22023';
end $fn$;

-- ---------------------------------------------------------------- moderation (admins and super admins)
create or replace function private.chat_report_view(r private.chat_reports) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'note',r.note,'createdAt',r.created_at,'version',r.version,
  'messageId',r.message_id,'conversationId',r.conversation_id,
  'conversation',(select case when c.department is not null then coalesce(c.title,'Team channel')
    when c.kind='group' then coalesce(c.title,'Group chat')
    when c.kind='owner' then 'Owner conversation: '||coalesce((select o.full_name from public.workspace_profiles o where o.user_id=c.owner_id),'Owner')
    else 'Direct message: '||coalesce((select string_agg(p.full_name,' and ' order by p.full_name) from private.chat_members mm join public.workspace_profiles p on p.user_id=mm.user_id where mm.conversation_id=c.id),'two people') end
   from private.chat_conversations c where c.id=r.conversation_id),
  'body',m.body,'sentAt',m.created_at,'removed',m.removed_at is not null,'removedAt',m.removed_at,
  'attachmentCount',(select count(*) from private.chat_attachments a where a.message_id=r.message_id),
  'attachments',case when r.status='open' and m.removed_at is null then private.chat_attachments_json(r.message_id) else '[]'::jsonb end,
  'authorId',r.author_id,'authorName',(select p.full_name from public.workspace_profiles p where p.user_id=r.author_id),'authorRole',(select p.role from public.workspace_profiles p where p.user_id=r.author_id),
  'reporterId',r.reporter_id,'reporterName',(select p.full_name from public.workspace_profiles p where p.user_id=r.reporter_id),
  'handledAt',r.handled_at,'handledByName',(select p.full_name from public.workspace_profiles p where p.user_id=r.handled_by),
  'sameMessageReports',(select count(*) from private.chat_reports x where x.message_id=r.message_id),
  'authorReports',(select count(*) from private.chat_reports x where x.author_id=r.author_id))
 from private.chat_messages m where m.id=r.message_id
$fn$;

-- Open reports first, then the most recent of the rest.
create or replace function private.chat_reports_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Moderation access required' using errcode='42501';end if;
 return jsonb_build_object('open',(select count(*) from private.chat_reports x where x.status='open'),
  'items',(select coalesce(jsonb_agg(private.chat_report_view(r) order by (r.status='open') desc,r.created_at desc,r.id),'[]'::jsonb) from (
    select * from private.chat_reports x order by (x.status='open') desc,x.created_at desc,x.id limit 300) r));
end $fn$;

-- Remove the message (hidden for everyone) or dismiss the report. Either decides every open
-- report on that message together. `paths` lists the stored files of a removed message so the
-- server can delete them; the route takes it out of the answer.
create or replace function private.chat_report_decide(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;rep private.chat_reports;
 paths jsonb:='[]'::jsonb;decision text;
begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Moderation access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','reportId','version','decision']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 decision:=input->>'decision';
 if coalesce(decision,'') not in ('remove','dismiss') then raise exception 'Choose to remove the message or dismiss the report' using errcode='22023';end if;
 select * into rep from private.chat_reports x where x.id=(input->>'reportId')::uuid for update;
 if rep.id is null then raise exception 'Report not found' using errcode='P0002';end if;
 if rep.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 if rep.status<>'open' then raise exception 'This report has already been dealt with' using errcode='40001';end if;
 if rep.author_id=auth.uid() then raise exception 'Another admin needs to review a report about your own message' using errcode='42501';end if;
 if decision='remove' then
  update private.chat_messages m set removed_at=coalesce(m.removed_at,now()),removed_by=coalesce(m.removed_by,auth.uid()) where m.id=rep.message_id;
  paths:=coalesce((select jsonb_agg(a.path order by a.position,a.created_at) from private.chat_attachments a where a.message_id=rep.message_id),'[]'::jsonb);
 end if;
 update private.chat_reports x set status=case when decision='remove' then 'actioned' else 'dismissed' end,handled_by=auth.uid(),handled_at=now(),version=x.version+1
  where x.message_id=rep.message_id and x.status='open';
 select * into rep from private.chat_reports x where x.id=rep.id;
 result:=private.chat_report_view(rep)||case when decision='remove' then jsonb_build_object('paths',paths) else '{}'::jsonb end;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.chat_blocked(uuid,uuid),private.chat_hidden(private.chat_messages,uuid),private.chat_shares(uuid,uuid),private.chat_file_open(uuid,uuid,uuid),
 private.chat_blocks_read(),private.chat_moderation_action(jsonb),private.chat_report_view(private.chat_reports),private.chat_reports_read(),private.chat_report_decide(jsonb)
 from public,anon,authenticated;

-- ---------------------------------------------------------------- patches to Messages and Team
do $$
declare
 fixes text[][] := array[
  -- Reporting and blocking are chat actions.
  ['private.workspace_chat_action(jsonb)',
   $q$if a='startProperty' then return private.chat_start_property(input);end if;$q$,
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;
 if a='startProperty' then return private.chat_start_property(input);end if;$q$,
   $q$private.chat_moderation_action(input)$q$],
  -- A new direct conversation cannot be started with someone who blocked you (or whom you blocked);
  -- an existing one carries on, and the blocker simply never sees what the other person writes.
  ['private.workspace_chat_action(jsonb)',
   $q$insert into private.chat_conversations(id,kind,created_by) values(new_id,'direct',me);$q$,
   $q$if private.chat_blocked(other,me) or private.chat_blocked(me,other) then raise exception 'You cannot start a new conversation with this person' using errcode='42501';end if;
   insert into private.chat_conversations(id,kind,created_by) values(new_id,'direct',me);$q$,
   $q$You cannot start a new conversation with this person$q$],
  -- Nobody is notified of a message from someone they blocked.
  ['private.workspace_chat_action(jsonb)',
   $q$select u,ev from private.chat_audience(target) u where u<>me$q$,
   $q$select u,ev from private.chat_audience(target) u where u<>me and not private.chat_blocked(u,me)$q$,
   $q$not private.chat_blocked(u,me)$q$],
  -- Reading a conversation: removed messages and messages from people you blocked arrive with no
  -- words, photos, videos or reactions (the app says why).
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$select jsonb_build_object('id',x.id,'body',x.body,'at',x.created_at,'mine',x.author_id=me,$q$,
   $q$select jsonb_build_object('id',x.id,'body',case when private.chat_hidden(x,me) then '' else x.body end,'at',x.created_at,'mine',x.author_id=me,
     'removed',x.removed_at is not null,'blocked',x.removed_at is null and x.kind='text' and private.chat_blocked(me,x.author_id),$q$,
   $q$'removed',x.removed_at is not null$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$'attachments',private.chat_attachments_json(x.id),'reactions',private.chat_reactions_json(x.id,me)) item$q$,
   $q$'attachments',case when private.chat_hidden(x,me) then '[]'::jsonb else private.chat_attachments_json(x.id) end,
     'reactions',case when private.chat_hidden(x,me) then '[]'::jsonb else private.chat_reactions_json(x.id,me) end) item$q$,
   $q$then '[]'::jsonb else private.chat_attachments_json(x.id)$q$],
  -- They are not unread, and they are not offered in New message.
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$join private.chat_messages x on x.conversation_id=c.id and x.author_id<>me and x.kind='text'$q$,
   $q$join private.chat_messages x on x.conversation_id=c.id and x.author_id<>me and x.kind='text' and x.removed_at is null and not private.chat_blocked(me,x.author_id)$q$,
   $q$not private.chat_blocked(me,x.author_id)$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$where p.status='active' and p.role<>'client' and p.user_id<>me and p.full_name<>''$q$,
   $q$where p.status='active' and p.role<>'client' and p.user_id<>me and p.full_name<>'' and not private.chat_blocked(me,p.user_id) and not private.chat_blocked(p.user_id,me)$q$,
   $q$not private.chat_blocked(p.user_id,me)$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$if section='members' then return private.chat_members_read(target);end if;$q$,
   $q$if section='members' then return private.chat_members_read(target);end if;
 if section='blocks' then return private.chat_blocks_read();end if;$q$,
   $q$private.chat_blocks_read()$q$],
  -- The conversation list: the last line and the unread count follow the same rules.
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'body',coalesce(nullif(left(x.body,140),''),private.chat_attachment_label(x.id))$q$,
   $q$'body',case when x.removed_at is not null then 'Message removed' when x.kind='text' and private.chat_blocked(me,x.author_id) then 'Message from someone you blocked'
    else coalesce(nullif(left(x.body,140),''),private.chat_attachment_label(x.id)) end$q$,
   $q$'Message from someone you blocked'$q$],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me and x.kind='text'$q$,
   $q$'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me and x.kind='text' and x.removed_at is null and not private.chat_blocked(me,x.author_id)$q$,
   $q$not private.chat_blocked(me,x.author_id)$q$],
  -- No reacting to a removed message or one from someone you blocked.
  ['private.chat_more_action(jsonb)',
   $q$or msg.kind<>'text' then raise exception 'Message not found'$q$,
   $q$or msg.kind<>'text' or msg.removed_at is not null or private.chat_blocked(me,msg.author_id) then raise exception 'Message not found'$q$,
   $q$msg.removed_at is not null$q$],
  -- Files: none from a removed message (or one you blocked); admins may open those of an open report.
  ['private.workspace_chat_files(uuid[])',
   $q$private.chat_can(a.conversation_id,me)$q$,
   $q$private.chat_file_open(a.message_id,a.conversation_id,me)$q$,
   $q$private.chat_file_open(a.message_id$q$],
  -- Moderation: the reported messages and the decision, beside Feedback.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$ elsif section='feedback' then result:=private.workspace_feedback_read();$q$,
   $q$ elsif section='feedback' then result:=private.workspace_feedback_read();
 elsif section='chatReports' then result:=private.chat_reports_read();$q$,
   $q$private.chat_reports_read()$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if input->>'action' in ('sendFeedback','updateFeedback') then return private.workspace_feedback_action(input);end if;$q$,
   $q$if input->>'action'='decideChatReport' then return private.chat_report_decide(input);end if;
 if input->>'action' in ('sendFeedback','updateFeedback') then return private.workspace_feedback_action(input);end if;$q$,
   $q$private.chat_report_decide(input)$q$]
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
