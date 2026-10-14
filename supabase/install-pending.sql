-- Named pop-ups and Round 1: the 3 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261020700000%' or version like '20261020800000%' or version like '20261020850000%') then raise exception 'Named pop-ups and Round 1 is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261020700000_direct_push =====
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261020700000','direct_push');

-- ===== 20261020800000_enquiry_duplicates =====
-- Client enquiries (Lee and Alex, client meeting):
--  * The New Property Enquiry Form no longer asks for a correspondence address or "Are you an existing client?". The public
--    submit (private.workspace_enquiry_public) stops requiring them. Forms answered before keep both answers, and the two keys
--    are still accepted, so a form already open in someone's browser can still be sent.
--  * A possible duplicate no longer comes from "existing client". Beside the same address (unchanged), a returned form is
--    flagged when its email (their answer, or the address the form was sent to) is an owner's sign-in email ('existing_owner';
--    duplicate_of is one of that owner's properties, when they have one), or when its email or phone matches another answered
--    enquiry that is not closed ('same_contact'; duplicate_of is that enquiry's property, unless archived). Phone numbers are
--    compared by their digits, with +44 read as 0. The check is private.workspace_enquiry_contact_duplicate, new here, called
--    at the end of private.workspace_enquiry_create_property. Enquiries flagged 'existing_client' before keep it.
--  * When a returned form is a possible duplicate, the people told it is back (the person who sent it and the admins) also
--    get an 'enquiry.duplicate' notice (an activity row and their notification outbox rows), so someone checks before valuing.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_enquiry_create_property (only
-- 20261015200000 defines it), private.workspace_enquiry_public (defined in 20261010300000, patched in 20261015200000).
-- Safe to run twice: the reason check is replaced only while it lacks the new reasons, the new functions are "create or
-- replace", and each patch is skipped once its sentinel is there.

do $$
begin
 if exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason'
   and pg_get_constraintdef(oid) not like '%same_contact%') then
  alter table private.workspace_client_enquiries drop constraint workspace_client_enquiries_duplicate_reason;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_duplicate_reason
   check(duplicate_reason in ('','same_address','existing_owner','same_contact','existing_client'));
 end if;
end $$;

-- A phone number reduced for comparing: digits only, +44 or 0044 (with or without the "(0)") read as 0. Null when too short.
create or replace function private.workspace_phone_key(phone text) returns text language sql immutable set search_path='' as $fn$
 select case when char_length(x.k)>=10 then x.k end from (select regexp_replace(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'^(00)?440?','0') as k) x
$fn$;

-- A returned form from someone we may already know: an owner with that email, or another open enquiry with that email or
-- phone. Left alone when the same address already flagged it. Called once, from the public submit.
create or replace function private.workspace_enquiry_contact_duplicate(enquiry_id uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries; mails text[]; phone text; owner uuid; other private.workspace_client_enquiries;
begin
 select * into e from private.workspace_client_enquiries x where x.id=enquiry_id for update;
 if e.id is null or e.answers is null or e.duplicate_reason='same_address' then return;end if;
 mails:=array_remove(array[lower(btrim(coalesce(e.answers->>'email',''))),lower(btrim(e.recipient_email))],'');
 phone:=private.workspace_phone_key(e.answers->>'phone');
 -- An owner already in Recharge: their sign-in email.
 select p.user_id into owner from public.workspace_profiles p join auth.users u on u.id=p.user_id
  where p.role='client' and p.status<>'revoked' and lower(u.email)=any(mails) order by p.created_at,p.user_id limit 1;
 if owner is not null then
  update private.workspace_client_enquiries set duplicate_reason='existing_owner',
   duplicate_of=(select a.property_id from public.workspace_property_assignments a join public.workspace_properties x on x.id=a.property_id
    where a.user_id=owner and a.assignment='client' and x.status<>'archived' order by x.created_at,x.id limit 1)
   where id=e.id;
  return;
 end if;
 -- Another answered enquiry, not closed, with the same email or phone.
 select x.* into other from private.workspace_client_enquiries x where x.id<>e.id and x.status<>'closed' and x.answers is not null
  and (lower(btrim(coalesce(x.answers->>'email','')))=any(mails) or lower(x.recipient_email)=any(mails) or (phone is not null and private.workspace_phone_key(x.answers->>'phone')=phone))
  order by x.submitted_at,x.id limit 1;
 update private.workspace_client_enquiries set duplicate_reason=case when other.id is null then '' else 'same_contact' end,
  duplicate_of=(select x.id from public.workspace_properties x where x.id=other.property_id and x.status<>'archived')
  where id=e.id;
end $fn$;

revoke all on function private.workspace_phone_key(text),private.workspace_enquiry_contact_duplicate(uuid) from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- "Are you an existing client?" no longer flags a duplicate; the contact check below does instead.
  ['private.workspace_enquiry_create_property(uuid)',
   $q$duplicate_reason=case when dup is not null then 'same_address' when ans->>'existingClient'='yes' then 'existing_client' else '' end$q$,
   $q$duplicate_reason=case when dup is not null then 'same_address' else '' end$q$,
   $q$then 'same_address' else '' end$q$],
  ['private.workspace_enquiry_create_property(uuid)',
   $q$return prop;$q$,
   $q$perform private.workspace_enquiry_contact_duplicate(e.id);
 return prop;$q$,
   $q$private.workspace_enquiry_contact_duplicate(e.id)$q$],
  -- The questions every form must answer, without the correspondence address and "existing client".
  ['private.workspace_enquiry_public(jsonb)',
   $q$array['fullName','correspondenceAddress','email','phone','existingClient','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop$q$,
   $q$array['fullName','email','phone','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop$q$,
   $q$array['fullName','email','phone','propertyAddress'$q$],
  -- A possible duplicate: the same people as enquiry.received hear it.
  ['private.workspace_enquiry_public(jsonb)',
   $q$return jsonb_build_object('state','answered');$q$,
   $q$-- A possible duplicate (20261020800000): the same people hear it, so someone checks before valuing.
  if e.duplicate_reason<>'' then
   insert into public.workspace_activity(actor_id,event_type) values(null,'enquiry.duplicate') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.status='active' and (p.user_id=e.sent_by or p.role in ('admin','super_admin')) on conflict do nothing;
  end if;
  return jsonb_build_object('state','answered');$q$,
   $q$'enquiry.duplicate'$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261020800000','enquiry_duplicates');

-- ===== 20261020850000_no_lunch_pauses =====
-- Lunch comes off the clock (Alex, client meeting): team members can no longer start a Lunch pause. Lunch is unpaid
-- anyway; Break and Emergency stay exactly as they are. Shifts from before keep their lunch pauses: the table still
-- allows them, they are still read and totalled by the stored pay rule, and the app shows them as "Lunch" in the history.
-- Starting a lunch pause is refused with "Choose a break or an emergency" (Lee: no mention of lunch). Someone already on a lunch pause when this is installed can
-- still go back to work or clock out as before.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_pause_action (defined in
-- 20261011010000; nothing later patches it).
-- Safe to run twice.

do $patch$
declare
 fixes text[][]:=array[
  -- Starting a pause: a break or an emergency only.
  ['private.workspace_pause_action(jsonb)',
   $q$if coalesce(input->>'kind','') not in ('lunch','break','emergency') then raise exception 'Choose lunch, a break or an emergency' using errcode='22023';end if;$q$,
   $q$if coalesce(input->>'kind','') not in ('break','emergency') then raise exception 'Choose a break or an emergency' using errcode='22023';end if;$q$,
   $q$not in ('break','emergency') then raise exception 'Choose a break or an emergency'$q$]
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

revoke all on function private.workspace_pause_action(jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('20261020850000','no_lunch_pauses');

commit;
