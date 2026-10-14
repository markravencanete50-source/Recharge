-- Reporting guest and client messages (Lee: "in the channel manager there is no button to report a message; it should have
-- one, since we already built the reported messages"). Session C, 14 October 2026.
--
-- Team chat could already be reported (20261012010000). This adds the same report to every incoming message in Messages:
--   * Guests: a message from a guest, from the channel manager (Hostaway) or logged by hand ("Guest message"), or by email
--     to guestrelations@ ("Guest email"). Whoever can open that conversation can report it (guest_inbox_can).
--   * Clients: an email to ownerrelations@ from someone who is not an owner yet ("Client email", 20261019500000). Whoever
--     can open those conversations can report it (workspace_email_owner_team: admins, and client relations and management).
--   Our own sent messages, and replies recorded by the team, cannot be reported. Same reasons, note, one open report per
--   person per message, and the same hourly and daily limits as Team chat (counted across both kinds of report).
-- The reports sit in their own table (private.inbox_reports: a source and a reference to the one message) and show in the
-- same Reported messages view for admins and super admins, beside the Team chat reports. Admins either dismiss a report or
-- hide the message in the app: the team sees "Hidden by an admin" in its place, with no words or attachments, in the list
-- and in the conversation. Hiding cannot delete anything from Airbnb, Booking.com or the sender's mailbox, and there is no
-- block for guests or clients. Every open report on the message is decided together, and the people who reported it are
-- told (inbox.report_hidden, or chat.report_reviewed when it stays). Admins and super admins are told of each new report
-- (inbox.reported). Owners never see any of it.
--
-- The report goes through the chat action (reportInboxMessage); the decision through the team actions
-- (decideMessageReport); the list through the existing chatReports read.
-- Replaced whole: private.chat_reports_read() (defined only in 20261012010000, never patched). Everything else is new or
-- patched by anchor and append (the anchor stays in place, a sentinel stops a second run, a missing or repeated anchor
-- raises, and a patch that does not take raises). Safe to run twice.

-- ---------------------------------------------------------------- tables
alter table private.workspace_guest_messages add column if not exists hidden_at timestamptz;
alter table private.workspace_guest_messages add column if not exists hidden_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_client_email_messages add column if not exists hidden_at timestamptz;
alter table private.workspace_client_email_messages add column if not exists hidden_by uuid references public.workspace_profiles(user_id);
create index if not exists workspace_guest_messages_hidden_by_idx on private.workspace_guest_messages(hidden_by) where hidden_by is not null;
create index if not exists workspace_client_email_messages_hidden_by_idx on private.workspace_client_email_messages(hidden_by) where hidden_by is not null;

create table if not exists private.inbox_reports (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('guest','client_email')),
 guest_message_id uuid references private.workspace_guest_messages(id) on delete cascade,
 client_email_message_id uuid references private.workspace_client_email_messages(id) on delete cascade,
 reporter_id uuid not null references public.workspace_profiles(user_id),
 reason text not null check(reason in ('offensive','harassment','media','spam','other')),
 note text not null default '' check(char_length(note)<=500),
 status text not null default 'open' check(status in ('open','actioned','dismissed')),
 handled_by uuid references public.workspace_profiles(user_id),
 handled_at timestamptz,
 created_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 check((source='guest' and guest_message_id is not null and client_email_message_id is null)
  or (source='client_email' and client_email_message_id is not null and guest_message_id is null))
);
create unique index if not exists inbox_reports_one_open_guest_idx on private.inbox_reports(guest_message_id,reporter_id) where status='open' and guest_message_id is not null;
create unique index if not exists inbox_reports_one_open_email_idx on private.inbox_reports(client_email_message_id,reporter_id) where status='open' and client_email_message_id is not null;
create index if not exists inbox_reports_status_idx on private.inbox_reports(status,created_at desc,id);
create index if not exists inbox_reports_guest_idx on private.inbox_reports(guest_message_id) where guest_message_id is not null;
create index if not exists inbox_reports_email_idx on private.inbox_reports(client_email_message_id) where client_email_message_id is not null;
create index if not exists inbox_reports_reporter_idx on private.inbox_reports(reporter_id,created_at desc);
create index if not exists inbox_reports_handler_idx on private.inbox_reports(handled_by) where handled_by is not null;
alter table private.inbox_reports enable row level security;
revoke all on private.inbox_reports from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.inbox_reports for each row execute function private.workspace_enforce_write_limit();

-- ---------------------------------------------------------------- reporting
create or replace function private.inbox_report_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;src text;mid uuid;
 g private.workspace_guest_messages;th private.workspace_guest_threads;e private.workspace_client_email_messages;et private.workspace_client_email_threads;
 rep private.inbox_reports;event_id bigint;note_text text:='';
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','source','messageId','reason','note']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=me and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 src:=input->>'source';mid:=(input->>'messageId')::uuid;
 if src='guest' then
  g:=(select x from private.workspace_guest_messages x where x.id=mid);
  th:=(select t from private.workspace_guest_threads t where t.source=g.source and t.thread_ref=g.thread_ref);
  if g.id is null or th.id is null or not private.guest_inbox_can(th.property_id) then raise exception 'Message not found' using errcode='42501';end if;
  if g.direction<>'guest' then raise exception 'You can only report a message the guest sent' using errcode='22023';end if;
  if g.hidden_at is not null then raise exception 'An admin has already hidden that message' using errcode='22023';end if;
 elsif src='client_email' then
  e:=(select x from private.workspace_client_email_messages x where x.id=mid);
  et:=(select t from private.workspace_client_email_threads t where t.id=e.thread_id);
  if e.id is null or et.id is null or et.status not in ('open','closed') or e.status<>'received' or not private.workspace_email_owner_team() then
   raise exception 'Message not found' using errcode='42501';end if;
  if e.direction<>'in' then raise exception 'You can only report an email the sender wrote' using errcode='22023';end if;
  if e.hidden_at is not null then raise exception 'An admin has already hidden that message' using errcode='22023';end if;
 else raise exception 'Choose a message to report' using errcode='22023';end if;
 if coalesce(input->>'reason','') not in ('offensive','harassment','media','spam','other') then raise exception 'Choose a reason' using errcode='22023';end if;
 if input ? 'note' and jsonb_typeof(input->'note') not in ('string','null') then raise exception 'Invalid note' using errcode='22023';end if;
 note_text:=coalesce(btrim(input->>'note'),'');
 if char_length(note_text)>500 then raise exception 'Keep the note to 500 characters' using errcode='22023';end if;
 if exists(select 1 from private.inbox_reports r where r.reporter_id=me and r.status='open' and (r.guest_message_id=g.id or r.client_email_message_id=e.id)) then
  raise exception 'You have already reported this message. An admin will review it.' using errcode='22023';
 end if;
 if (select count(*) from private.inbox_reports r where r.reporter_id=me and r.created_at>now()-interval '1 hour')
   +(select count(*) from private.chat_reports r where r.reporter_id=me and r.created_at>now()-interval '1 hour')>=10
  or (select count(*) from private.inbox_reports r where r.reporter_id=me and r.created_at>now()-interval '1 day')
   +(select count(*) from private.chat_reports r where r.reporter_id=me and r.created_at>now()-interval '1 day')>=30 then
  raise exception 'That is a lot of reports. Try again a little later, or tell an admin directly.' using errcode='P0001';
 end if;
 insert into private.inbox_reports(source,guest_message_id,client_email_message_id,reporter_id,reason,note)
  values(src,g.id,e.id,me,input->>'reason',note_text) returning * into rep;
 -- Every active admin and super admin hears about it.
 insert into public.workspace_activity(actor_id,event_type) values(me,'inbox.reported') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,event_id)
  select p.user_id,event_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') and p.user_id<>me on conflict do nothing;
 result:=jsonb_build_object('reported',true,'reportId',rep.id);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(me,req,input,result);
 return result;
end $fn$;

-- ---------------------------------------------------------------- moderation (admins and super admins)
-- One report as the Reported messages view shows it, in the same shape as a Team chat report (chat_report_view), with
-- the source, who sent it (a guest or an email sender has no account), the property and the conversation to open.
create or replace function private.inbox_report_view(r private.inbox_reports) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',r.id,'status',r.status,'reason',r.reason,'note',r.note,'createdAt',r.created_at,'version',r.version,
  'source',m.source,'messageId',m.message_id,'conversationId',m.thread_id,'openId',m.open_id,
  'conversation',m.conversation,'propertyName',m.property_name,
  'body',coalesce(m.body,''),'sentAt',m.sent_at,'removed',m.hidden_at is not null,'removedAt',m.hidden_at,
  'attachmentCount',m.files,'attachments','[]'::jsonb,
  'authorId',null,'authorName',m.sender,'authorRole',null,
  'reporterId',r.reporter_id,'reporterName',(select p.full_name from public.workspace_profiles p where p.user_id=r.reporter_id),
  'handledAt',r.handled_at,'handledByName',(select p.full_name from public.workspace_profiles p where p.user_id=r.handled_by),
  'sameMessageReports',(select count(*) from private.inbox_reports x where x.source=r.source and (x.guest_message_id=r.guest_message_id or x.client_email_message_id=r.client_email_message_id)),
  'authorReports',m.sender_reports)
 from (
  select case when t.source='email' or g.channel='email' then 'guest_email' else 'guest_message' end source,g.id message_id,t.id thread_id,'guest:'||t.id open_id,
   coalesce(pr.name,'No property yet') conversation,pr.name property_name,g.body,g.sent_at,g.hidden_at,coalesce(nullif(btrim(t.guest_name),''),'Guest') sender,
   (select count(*) from private.workspace_email_attachments a where a.guest_message_id=g.id) files,
   (select count(*) from private.inbox_reports x join private.workspace_guest_messages y on y.id=x.guest_message_id where y.source=t.source and y.thread_ref=t.thread_ref) sender_reports
  from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
   left join public.workspace_properties pr on pr.id=t.property_id
  where r.source='guest' and g.id=r.guest_message_id
  union all
  select 'client_email',e.id,t.id,'email:'||t.id,coalesce(nullif(t.subject,''),'Email'),null,e.body,e.sent_at,e.hidden_at,coalesce(nullif(btrim(t.name),''),t.address),
   (select count(*) from private.workspace_email_attachments a where a.client_email_message_id=e.id),
   (select count(*) from private.inbox_reports x join private.workspace_client_email_messages y on y.id=x.client_email_message_id
     join private.workspace_client_email_threads z on z.id=y.thread_id where lower(z.address)=lower(t.address))
  from private.workspace_client_email_messages e join private.workspace_client_email_threads t on t.id=e.thread_id
  where r.source='client_email' and e.id=r.client_email_message_id) m
$fn$;

-- Open reports first, then the most recent of the rest: Team chat and guest and client messages together.
create or replace function private.chat_reports_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Moderation access required' using errcode='42501';end if;
 return jsonb_build_object('open',(select count(*) from private.chat_reports x where x.status='open')+(select count(*) from private.inbox_reports x where x.status='open'),
  'items',(select coalesce(jsonb_agg(s.v order by s.o desc,s.at desc,s.id) filter(where s.v is not null),'[]'::jsonb) from (
    select case when k.kind='chat' then (select private.chat_report_view(r) from private.chat_reports r where r.id=k.id)
     else (select private.inbox_report_view(r) from private.inbox_reports r where r.id=k.id) end v,k.o,k.at,k.id
    from (select 'chat' kind,x.id,x.status='open' o,x.created_at at from private.chat_reports x
     union all select 'inbox',x.id,x.status='open',x.created_at from private.inbox_reports x
     order by 3 desc,4 desc,2 limit 300) k) s));
end $fn$;

-- Hide the message in the app, or dismiss the report. Either decides every open report on that message together.
create or replace function private.inbox_report_decide(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;rep private.inbox_reports;decision text;
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
 if coalesce(decision,'') not in ('hide','dismiss') then raise exception 'Choose to hide the message or dismiss the report' using errcode='22023';end if;
 select * into rep from private.inbox_reports x where x.id=(input->>'reportId')::uuid for update;
 if rep.id is null then raise exception 'Report not found' using errcode='P0002';end if;
 if rep.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 if rep.status<>'open' then raise exception 'This report has already been dealt with' using errcode='40001';end if;
 if decision='hide' then
  update private.workspace_guest_messages m set hidden_at=coalesce(m.hidden_at,now()),hidden_by=coalesce(m.hidden_by,auth.uid()) where m.id=rep.guest_message_id;
  update private.workspace_client_email_messages m set hidden_at=coalesce(m.hidden_at,now()),hidden_by=coalesce(m.hidden_by,auth.uid()) where m.id=rep.client_email_message_id;
 end if;
 -- Everyone whose open report this decides is told; nobody learns which admin decided.
 with ev as (insert into public.workspace_activity(actor_id,event_type) values(null,case when decision='hide' then 'inbox.report_hidden' else 'chat.report_reviewed' end) returning id)
 insert into private.workspace_notification_outbox(user_id,event_id)
  select r.reporter_id,ev.id from ev,(select distinct x.reporter_id from private.inbox_reports x where x.status='open' and x.source=rep.source
    and (x.guest_message_id=rep.guest_message_id or x.client_email_message_id=rep.client_email_message_id)) r
  join public.workspace_profiles p on p.user_id=r.reporter_id and p.status='active' on conflict do nothing;
 update private.inbox_reports x set status=case when decision='hide' then 'actioned' else 'dismissed' end,handled_by=auth.uid(),handled_at=now(),version=x.version+1
  where x.status='open' and x.source=rep.source and (x.guest_message_id=rep.guest_message_id or x.client_email_message_id=rep.client_email_message_id);
 select * into rep from private.inbox_reports x where x.id=rep.id;
 result:=private.inbox_report_view(rep);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.inbox_report_action(jsonb),private.inbox_report_view(private.inbox_reports),private.chat_reports_read(),private.inbox_report_decide(jsonb)
 from public,anon,authenticated;

-- ---------------------------------------------------------------- patches
do $patch$
declare
 fixes text[][]:=array[
  -- Reporting a guest or client message is a chat action, beside reporting a Team chat message.
  ['private.workspace_chat_action(jsonb)',
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;$q$,
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;
 if a='reportInboxMessage' then return private.inbox_report_action(input);end if;$q$,
   $q$private.inbox_report_action(input)$q$],
  -- The decision is a team action, beside the Team chat one.
  ['private.workspace_teams_action(jsonb)',
   $q$if input->>'action'='decideChatReport' then return private.chat_report_decide(input);end if;$q$,
   $q$if input->>'action'='decideChatReport' then return private.chat_report_decide(input);end if;
 if input->>'action'='decideMessageReport' then return private.inbox_report_decide(input);end if;$q$,
   $q$private.inbox_report_decide(input)$q$],
  -- Guests: a hidden message is "Hidden by an admin" in the list, and has no words or files in the conversation.
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$with msgs as (select m.direction,m.body,m.sent_at,m.id,m.created_at from private.workspace_guest_messages m$q$,
   $q$with msgs as (select m.direction,case when m.hidden_at is not null then 'Hidden by an admin' else m.body end body,m.sent_at,m.id,m.created_at from private.workspace_guest_messages m$q$,
   $q$'Hidden by an admin' else m.body end body,m.sent_at,m.id$q$],
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'sentAt',m.sent_at,'delivery',m.delivery,$q$,
   $q$jsonb_build_object('id',m.id,'direction',m.direction,'body',case when m.hidden_at is not null then '' else m.body end,'hidden',m.hidden_at is not null,'sentAt',m.sent_at,'delivery',m.delivery,$q$,
   $q$'hidden',m.hidden_at is not null,'sentAt',m.sent_at,'delivery'$q$],
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$where a.guest_message_id=m.id)$q$,
   $q$where a.guest_message_id=m.id and m.hidden_at is null)$q$,
   $q$a.guest_message_id=m.id and m.hidden_at is null$q$],
  -- Clients: the same for email from someone who is not an owner yet.
  ['private.workspace_client_email_json(private.workspace_client_email_threads)',
   $q$'preview',(select left(last.body,160) from last)$q$,
   $q$'preview',(select case when last.hidden_at is not null then 'Hidden by an admin' else left(last.body,160) end from last)$q$,
   $q$when last.hidden_at is not null then 'Hidden by an admin'$q$],
  ['private.workspace_client_email_read(text,uuid)',
   $q$jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'sentAt',m.sent_at,$q$,
   $q$jsonb_build_object('id',m.id,'direction',m.direction,'body',case when m.hidden_at is not null then '' else m.body end,'hidden',m.hidden_at is not null,'sentAt',m.sent_at,$q$,
   $q$'hidden',m.hidden_at is not null,'sentAt',m.sent_at,$q$],
  ['private.workspace_client_email_read(text,uuid)',
   $q$where a.client_email_message_id=m.id)$q$,
   $q$where a.client_email_message_id=m.id and m.hidden_at is null)$q$,
   $q$a.client_email_message_id=m.id and m.hidden_at is null$q$],
  -- The files of a hidden message no longer open.
  ['private.workspace_email_files(uuid[])',
   $q$where g.id=a.guest_message_id and private.guest_inbox_can(t.property_id)$q$,
   $q$where g.id=a.guest_message_id and g.hidden_at is null and private.guest_inbox_can(t.property_id)$q$,
   $q$g.id=a.guest_message_id and g.hidden_at is null$q$],
  ['private.workspace_email_files(uuid[])',
   $q$(a.client_email_message_id is not null and private.workspace_email_owner_team())$q$,
   $q$(a.client_email_message_id is not null and private.workspace_email_owner_team()
   and not exists(select 1 from private.workspace_client_email_messages h where h.id=a.client_email_message_id and h.hidden_at is not null))$q$,
   $q$h.id=a.client_email_message_id and h.hidden_at is not null$q$]
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
