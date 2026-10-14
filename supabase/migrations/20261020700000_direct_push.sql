-- Direct pop-ups (Lee, 14 October: "make it more direct: Mark, new guest message; John, guest, replied"). A pop-up now names the
-- person it is for, who sent it and what it says: "Mark, new guest message from John" with "Rose Cottage: What time is check-in?",
-- "Mark, Alex sent you a message", "Mark, new email from Sarah Jones", or for work "Mark, new to-do for you" with who, what and where.
-- Pop-ups are encrypted for the one device they go to (RFC 8291), so Apple and Google only relay them. Email notices keep the general
-- wording (lib/notice-copy.ts), as an email can be forwarded or read on a shared screen.
--  * private.workspace_activity_details: for a message notice, who sent it, the start of the message, the conversation's name for
--    a group or channel, and whether it is a reply. Written where the notice is made: guest messages (the trigger, replaced whole;
--    only 20261015310000 defines it), team and owner chat (workspace_chat_action, by anchor), client email (workspace_client_email_in,
--    by anchor). Kept 3 days, like the pop-up record.
--  * private.integration_push_details(outbox): what a pop-up says about one notice; integration_claim_web_push returns it (by anchor).
--    An owner never sees a staff name: their team is "Recharge", as in the Updates feed.
-- Safe to run twice (sentinels; the table and the replaced functions are "if not exists" / "create or replace").

create table if not exists private.workspace_activity_details (
 event_id bigint primary key references public.workspace_activity(id) on delete cascade,
 who text check(who is null or char_length(who)<=200),
 preview text check(preview is null or char_length(preview)<=300),
 context text check(context is null or char_length(context)<=120),
 replied boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists workspace_activity_details_created_idx on private.workspace_activity_details(created_at);
alter table private.workspace_activity_details enable row level security;
revoke all on private.workspace_activity_details from public,anon,authenticated;

-- One line of text from a message: spaces collapsed, cut to fit a pop-up.
create or replace function private.workspace_push_line(body text,size integer default 300) returns text language sql immutable set search_path='' as $$
 select nullif(left(btrim(regexp_replace(coalesce(body,''),'\s+',' ','g')),size),'')
$$;

-- Guest messages: replaced whole (only 20261015310000 defines it). The same notices as before, now with the guest's name, the start of
-- the message and whether the conversation had earlier messages (a reply).
create or replace function private.workspace_guest_message_notices() returns trigger language plpgsql security definer set search_path='' as $fn$
declare m record;ev bigint;me uuid:=auth.uid();
begin
 begin
  for m in select a.id,a.property_id,a.source,a.thread_ref,a.body,a.sent_at from added a where a.direction='guest' and a.sent_at>now()-interval '24 hours' order by a.sent_at,a.id loop
   insert into public.workspace_activity(actor_id,property_id,event_type) values(me,m.property_id,'guest.message') returning id into ev;
   insert into private.workspace_activity_details(event_id,who,preview,replied)
    values(ev,(select left(t.guest_name,200) from private.workspace_guest_threads t where t.source=m.source and t.thread_ref=m.thread_ref),private.workspace_push_line(m.body),
     exists(select 1 from private.workspace_guest_messages x where x.source=m.source and x.thread_ref=m.thread_ref and x.id<>m.id and x.sent_at<=m.sent_at))
    on conflict do nothing;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select u,ev from private.workspace_guest_message_recipients(m.property_id) u where u is distinct from me
   on conflict do nothing;
  end loop;
 exception when others then
  -- A notice is never worth losing the guest's message.
  raise warning 'Guest message notices skipped: %',sqlerrm;
 end;
 return null;
end $fn$;

-- What a pop-up says about one notice: the person it is for, who did it, the message, and the work and property it is about.
create or replace function private.integration_push_details(outbox bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
  'recipient',rp.full_name,
  'who',case when rp.role='client' and a.event_type like 'chat.%' then 'Recharge' else d.who end,
  'preview',d.preview,
  'context',case when rp.role='client' then null else d.context end,
  'replied',d.replied,
  'actorName',case when a.actor_id is null or a.actor_id=o.user_id then null when rp.role='client' then 'Recharge' else ap.full_name end,
  'workTitle',w.title,
  'propertyName',pr.name))
 from private.workspace_notification_outbox o
 join public.workspace_activity a on a.id=o.event_id
 join public.workspace_profiles rp on rp.user_id=o.user_id
 left join private.workspace_activity_details d on d.event_id=a.id
 left join public.workspace_profiles ap on ap.user_id=a.actor_id
 left join public.workspace_work_items w on w.id=a.work_id
 left join public.workspace_properties pr on pr.id=coalesce(a.property_id,w.property_id)
 where o.id=outbox
$$;

do $patch$
declare
 fixes text[][]:=array[
  -- Team and owner chat: who wrote, the start of the message, and the group or channel name.
  ['private.workspace_chat_action(jsonb)',
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(me,conv.property_id,case when conv.kind='owner' and conv.owner_id=me then 'chat.owner_message' else 'chat.message' end) returning id into ev;$q$,
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(me,conv.property_id,case when conv.kind='owner' and conv.owner_id=me then 'chat.owner_message' else 'chat.message' end) returning id into ev;
  -- Direct pop-ups (20261020700000): who wrote, the start of the message, the group or channel.
  insert into private.workspace_activity_details(event_id,who,preview,context,replied) values(ev,(select left(p.full_name,200) from public.workspace_profiles p where p.user_id=me),
   private.workspace_push_line(msg.body),case when conv.kind='group' then left(conv.title,120) end,previous is not null) on conflict do nothing;$q$,
   $q$-- Direct pop-ups (20261020700000): who wrote$q$],
  -- Client email: who sent it and its subject (or the start of the email), and whether it joined an earlier conversation.
  ['private.workspace_client_email_in(text,text,text,text,text,timestamp with time zone,text,text,text[],jsonb)',
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(null,null,'client.email') returning id into ev;$q$,
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(null,null,'client.email') returning id into ev;
  -- Direct pop-ups (20261020700000): the sender and the subject.
  insert into private.workspace_activity_details(event_id,who,preview,replied) values(ev,left(coalesce(th.name,sname,sender),200),
   coalesce(private.workspace_push_line(subj),private.workspace_push_line(regexp_replace(body,'^Subject: [^\n]*\n+',''))),not fresh) on conflict do nothing;$q$,
   $q$-- Direct pop-ups (20261020700000): the sender and the subject.$q$],
  -- The claim hands each pop-up its details.
  ['private.integration_claim_web_push()',
   $q$'eventType',c.event_type,$q$,
   $q$'eventType',c.event_type,'details',private.integration_push_details(c.outbox_id),$q$,
   $q$private.integration_push_details(c.outbox_id)$q$],
  -- Details are kept as long as the pop-up record (3 days).
  ['private.integration_claim_web_push()',
   $q$delete from private.workspace_web_push_sent where sent_at<now()-interval '3 days';$q$,
   $q$delete from private.workspace_web_push_sent where sent_at<now()-interval '3 days';
 delete from private.workspace_activity_details where created_at<now()-interval '3 days';$q$,
   $q$delete from private.workspace_activity_details where created_at$q$]
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

revoke all on function private.workspace_push_line(text,integer),private.integration_push_details(bigint),private.workspace_guest_message_notices() from public,anon,authenticated,service_role;
