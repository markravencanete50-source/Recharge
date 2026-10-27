-- Agreement follow-ups (Recharge Business Plan v1.0, "Sign Agreement: a. Follow Up"; Phase 1). When the management agreement
-- is sent and the owner has not signed it, Recharge follows up by itself, step by step:
--   automatic follow-up (24 hours), personal follow-up (24 hours), automatic follow-up 2 (48 hours), personal follow-up 2
--   (48 hours), two automatic follow-ups a week apart, then, a week later with still no answer, the onboarding is archived.
--  * Each step's wait counts from the step before it (the first from when the agreement was sent). An automatic step posts a
--    message in the owner's conversation in the app and emails it to them (through the owner email outbox, so it goes out only
--    while owner email is switched on). A personal step tells the team it is due, and is done once the consultant confirms all
--    four: a message in the app, an email, a WhatsApp message and a phone call. Every step is noted on the lead's activity.
--  * A reply from the owner (in the app, or by email into the same conversation) stops the automatic messages; the consultant
--    then follows up by hand. Signing ends it. Publishing the agreement again starts the sequence again.
--  * The steps are a setting, not code (private.workspace_followup_settings): admins and super admins change the wording, the
--    waits, how many steps there are and when to archive. A sequence keeps the steps it started with.
--  * The consultant can also stop the automatic messages (with a note, say the owner asked to wait) and start them again.
-- Who: the people who work with enquiries (private.workspace_can_enquiries); settings by admins and super admins; the sweep by
-- the backend (service role) every 15 minutes. New: two tables and the functions below. No existing function is changed.
-- Journeys already waiting on a signature start their sequence now, from the install, so nobody gets a burst of messages.
-- No DROP, no DELETE. Safe to run twice.

create table if not exists private.workspace_followup_settings (
 singleton boolean primary key default true check(singleton),
 steps jsonb not null check(jsonb_typeof(steps)='array'),
 archive_after_hours integer not null default 168 check(archive_after_hours between 1 and 4320),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_followup_settings enable row level security;
revoke all on private.workspace_followup_settings from public,anon,authenticated;
insert into private.workspace_followup_settings(singleton,steps,archive_after_hours) values(true,$json$[
 {"kind":"auto","afterHours":24,"message":"Hi {first_name}, have you had a chance to review your estimate and the management agreement for {property}? If you have any questions before going ahead, reply here and we'll be happy to help."},
 {"kind":"personal","afterHours":24},
 {"kind":"auto","afterHours":48,"message":"Hi {first_name}, just checking in on the management agreement for {property}. It only takes a few minutes to read and sign in the Recharge app, and we're here if anything needs explaining."},
 {"kind":"personal","afterHours":48},
 {"kind":"auto","afterHours":168,"message":"Hi {first_name}, your management agreement for {property} is still waiting for you. When you're ready, you can read and sign it in the Recharge app, or reply here with any questions."},
 {"kind":"auto","afterHours":168,"message":"Hi {first_name}, we haven't heard back about {property}, so we'll close your onboarding for now in a week. If you'd still like to go ahead, reply here at any time and we'll pick it up straight away."}
]$json$::jsonb,168) on conflict do nothing;

create table if not exists private.workspace_agreement_followups (
 property_id uuid primary key references private.workspace_journeys(property_id) on delete cascade,
 revision integer not null,
 started_at timestamptz not null,
 plan jsonb not null check(jsonb_typeof(plan)='array'),
 archive_after_hours integer not null check(archive_after_hours between 1 and 4320),
 -- The next step to do (0-based); past the last step, the sequence is waiting to archive.
 step integer not null default 0 check(step>=0),
 due_at timestamptz not null,
 -- A personal step's confirmations: channel -> {at, by}.
 checks jsonb not null default '{}' check(jsonb_typeof(checks)='object'),
 status text not null default 'running' check(status in ('running','stopped','signed','archived','ended')),
 reason text check(reason is null or char_length(reason)<=300),
 notified_step integer,
 updated_at timestamptz not null default now()
);
create index if not exists workspace_agreement_followups_due_idx on private.workspace_agreement_followups(due_at) where status='running';
alter table private.workspace_agreement_followups enable row level security;
revoke all on private.workspace_agreement_followups from public,anon,authenticated;

-- The steps, checked: 1 to 12 steps, each automatic (with a message of 1 to 1000 characters) or personal, waiting 1 hour to
-- 90 days; at least one step is automatic.
create or replace function private.workspace_followup_steps(steps jsonb) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare s jsonb;out jsonb:='[]';h integer;msg text;begin
 if jsonb_typeof(steps) is distinct from 'array' or jsonb_array_length(steps) not between 1 and 12 then raise exception 'Add between 1 and 12 follow-up steps' using errcode='22023';end if;
 for s in select value from jsonb_array_elements(steps) loop
  if jsonb_typeof(s) is distinct from 'object' or exists(select 1 from jsonb_object_keys(s) k where k not in ('kind','afterHours','message')) then raise exception 'Check the follow-up steps' using errcode='22023';end if;
  if s->>'kind' not in ('auto','personal') then raise exception 'Each step is automatic or personal' using errcode='22023';end if;
  if jsonb_typeof(s->'afterHours') is distinct from 'number' or (s->>'afterHours')::numeric<>floor((s->>'afterHours')::numeric) then raise exception 'Each step waits a whole number of hours' using errcode='22023';end if;
  h:=(s->>'afterHours')::integer;
  if h not between 1 and 2160 then raise exception 'Each step waits between 1 hour and 90 days' using errcode='22023';end if;
  if s->>'kind'='auto' then
   msg:=btrim(coalesce(s->>'message',''));
   if char_length(msg) not between 1 and 1000 then raise exception 'Write the message for each automatic step (up to 1000 characters)' using errcode='22023';end if;
   out:=out||jsonb_build_array(jsonb_build_object('kind','auto','afterHours',h,'message',msg));
  else
   out:=out||jsonb_build_array(jsonb_build_object('kind','personal','afterHours',h));
  end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(out) x where x->>'kind'='auto') then raise exception 'Keep at least one automatic step' using errcode='22023';end if;
 return out;
end $fn$;

-- The wait before a step, or before archiving once the steps are done.
create or replace function private.workspace_followup_wait(f private.workspace_agreement_followups,at_step integer) returns interval language sql immutable set search_path='' as $$
 select make_interval(hours=>case when at_step<jsonb_array_length(f.plan) then (f.plan->at_step->>'afterHours')::integer else f.archive_after_hours end)
$$;

-- A note on the lead's activity (every open lead for the property).
create or replace function private.workspace_followup_note(prop uuid,words text,actor uuid) returns void language sql security definer set search_path='' as $$
 insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by)
 select e.id,'event',left(words,2000),actor from private.workspace_client_enquiries e where e.property_id=prop and e.status<>'closed';
$$;

-- Who hears that a personal follow-up is due, or that the owner replied: whoever sent or valued the lead, whoever published
-- the agreement, and client relations for the property (private.workspace_owner_chasers).
create or replace function private.workspace_followup_team(prop uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select array(select distinct u from (
   select e.sent_by u from private.workspace_client_enquiries e where e.property_id=prop and e.status<>'closed'
   union select e.valued_by from private.workspace_client_enquiries e where e.property_id=prop and e.status<>'closed'
   union select a.actor_id from public.workspace_activity a where a.property_id=prop and a.event_type='journey.publishAgreement'
   union select unnest(private.workspace_owner_chasers(prop))) x
  join public.workspace_profiles p on p.user_id=x.u where p.status='active' and p.role in ('admin','super_admin','stays'))
$$;

create or replace function private.workspace_followup_tell(prop uuid,event text,at_time timestamptz) returns void language plpgsql security definer set search_path='' as $fn$
declare ev bigint;begin
 insert into public.workspace_activity(property_id,event_type,created_at) values(prop,event,at_time) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id) select u,ev from unnest(private.workspace_followup_team(prop)) u on conflict do nothing;
end $fn$;

-- When the agreement was last sent, and by whom.
create or replace function private.workspace_followup_sent(prop uuid) returns table(sent_at timestamptz,sent_by uuid) language sql stable security definer set search_path='' as $$
 select a.created_at,a.actor_id from public.workspace_activity a where a.property_id=prop and a.event_type='journey.publishAgreement' order by a.created_at desc,a.id desc limit 1
$$;

-- An automatic follow-up: a message in the owner's conversation from whoever sent the agreement (or a super admin), a notice
-- to the owner, and the same words by email to the owner's sign-in address.
create or replace function private.workspace_followup_post(f private.workspace_agreement_followups,at_time timestamptz) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;p public.workspace_properties;own public.workspace_profiles;author uuid;conv uuid;mid uuid;ev bigint;body text;mail text;begin
 select * into j from private.workspace_journeys where property_id=f.property_id;
 select * into p from public.workspace_properties where id=f.property_id;
 select * into own from public.workspace_profiles where user_id=j.client_id;
 author:=(select s.sent_by from private.workspace_followup_sent(f.property_id) s join public.workspace_profiles x on x.user_id=s.sent_by where x.status='active' and x.role<>'client');
 author:=coalesce(author,(select x.user_id from public.workspace_profiles x where x.status='active' and x.role='super_admin' order by x.created_at,x.user_id limit 1));
 if author is null or own.user_id is null then return;end if;
 body:=replace(replace(f.plan->f.step->>'message','{first_name}',coalesce(nullif(split_part(btrim(coalesce(own.full_name,'')),' ',1),''),'there')),'{property}',coalesce(nullif(btrim(p.name),''),'your property'));
 insert into private.chat_conversations(kind,owner_id,created_by) values('owner',own.user_id,own.user_id) on conflict do nothing;
 conv:=(select c.id from private.chat_conversations c where c.kind='owner' and c.owner_id=own.user_id);
 insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at) values(conv,author,left(body,4000),gen_random_uuid(),at_time) returning id into mid;
 update private.chat_conversations set last_message_at=greatest(last_message_at,at_time) where id=conv;
 insert into public.workspace_activity(actor_id,event_type,created_at) values(author,'chat.message',at_time) returning id into ev;
 insert into private.workspace_activity_details(event_id,who,preview,context,replied) values(ev,'Recharge',private.workspace_push_line(body),null,false) on conflict do nothing;
 insert into private.workspace_notification_outbox(user_id,event_id) values(own.user_id,ev) on conflict do nothing;
 mail:=(select lower(u.email) from auth.users u where u.id=own.user_id);
 if mail is not null and char_length(mail) between 3 and 320 then
  insert into private.workspace_email_outbox(chat_message_id,to_address,subject,body)
   values(mid,mail,left('Your management agreement for '||coalesce(nullif(btrim(p.name),''),'your property'),300),left(body||E'\n\nYou can read and sign your agreement in the Recharge app.',4000))
   on conflict(chat_message_id) do nothing;
 end if;
end $fn$;

-- Archiving after the last step: the journey, the property and its onboarding work item, as closing an enquiry does.
create or replace function private.workspace_followup_archive(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;begin
 select * into j from private.workspace_journeys where property_id=prop for update;
 if j.property_id is null or j.stage<>'agreement' or j.signed_at is not null then return;end if;
 update private.workspace_journeys set stage='archived',version=version+1,updated_at=now() where property_id=prop;
 update public.workspace_properties set status='archived',version=version+1,updated_at=now() where id=prop;
 update public.workspace_work_items set status='declined',version=version+1,updated_at=now() where id=j.work_id and status<>'declined';
end $fn$;

-- The sweep, every 15 minutes (the backend, service role): start, restart and end sequences, stop on a reply, and do the due
-- steps (at most 50 a run, one step per property per run).
create or replace function private.workspace_agreement_followup_sweep(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;f private.workspace_agreement_followups;st private.workspace_followup_settings;sent timestamptz;conv uuid;
 started integer:=0;sent_auto integer:=0;due_personal integer:=0;stopped integer:=0;archived integer:=0;begin
 perform pg_advisory_xact_lock(hashtext('workspace_agreement_followup_sweep'));
 select * into st from private.workspace_followup_settings where singleton;
 -- Start (or restart, after the agreement is published again) for every journey waiting on a signature.
 for j in select x.* from private.workspace_journeys x left join private.workspace_agreement_followups y on y.property_id=x.property_id
   where x.stage='agreement' and x.agreement_revision>0 and x.signed_at is null
     and (y.property_id is null or (y.revision<>x.agreement_revision and y.status<>'archived')) limit 200 loop
  sent:=least(at_time,coalesce((select s.sent_at from private.workspace_followup_sent(j.property_id) s),at_time));
  insert into private.workspace_agreement_followups as y(property_id,revision,started_at,plan,archive_after_hours,step,due_at,checks,status,reason,notified_step,updated_at)
   values(j.property_id,j.agreement_revision,sent,st.steps,st.archive_after_hours,0,sent+make_interval(hours=>(st.steps->0->>'afterHours')::integer),'{}','running',null,null,at_time)
   on conflict(property_id) do update set revision=excluded.revision,started_at=excluded.started_at,plan=excluded.plan,archive_after_hours=excluded.archive_after_hours,
    step=0,due_at=excluded.due_at,checks='{}',status='running',reason=null,notified_step=null,updated_at=at_time;
  perform private.workspace_followup_note(j.property_id,'Agreement follow-ups started: the first automatic follow-up goes out if the owner has not signed by '
   ||to_char((sent+make_interval(hours=>(st.steps->0->>'afterHours')::integer)) at time zone 'Europe/London','FMDD Mon, HH24:MI'),null);
  started:=started+1;
 end loop;
 -- Signed, or moved on some other way: the sequence ends.
 for f in select y.* from private.workspace_agreement_followups y join private.workspace_journeys x on x.property_id=y.property_id
   where y.status in ('running','stopped') and (x.stage<>'agreement' or x.signed_at is not null) loop
  update private.workspace_agreement_followups set status=case when (select x.signed_at from private.workspace_journeys x where x.property_id=f.property_id) is not null then 'signed' else 'ended' end,
   updated_at=at_time where property_id=f.property_id;
 end loop;
 -- A reply from the owner since the sequence started stops the automatic messages.
 for f in select y.* from private.workspace_agreement_followups y join private.workspace_journeys x on x.property_id=y.property_id
   where y.status='running' and exists(select 1 from private.chat_conversations c join private.chat_messages m on m.conversation_id=c.id
     where c.kind='owner' and c.owner_id=x.client_id and m.author_id=x.client_id and m.created_at>y.started_at) loop
  update private.workspace_agreement_followups set status='stopped',reason='The owner replied',updated_at=at_time where property_id=f.property_id;
  perform private.workspace_followup_note(f.property_id,'The owner replied, so the automatic follow-ups have stopped. Follow up personally.',null);
  perform private.workspace_followup_tell(f.property_id,'enquiry.follow_up_replied',at_time);
  stopped:=stopped+1;
 end loop;
 -- The due steps.
 for f in select y.* from private.workspace_agreement_followups y where y.status='running' and y.due_at<=at_time order by y.due_at limit 50 for update skip locked loop
  if f.step>=jsonb_array_length(f.plan) then
   perform private.workspace_followup_archive(f.property_id);
   update private.workspace_agreement_followups set status='archived',reason='No answer after the last follow-up',updated_at=at_time where property_id=f.property_id;
   perform private.workspace_followup_note(f.property_id,'No answer after the last follow-up, so the onboarding was archived.',null);
   perform private.workspace_followup_tell(f.property_id,'enquiry.follow_up_archived',at_time);
   archived:=archived+1;
  elsif f.plan->f.step->>'kind'='auto' then
   perform private.workspace_followup_post(f,at_time);
   update private.workspace_agreement_followups set step=f.step+1,due_at=at_time+private.workspace_followup_wait(f,f.step+1),checks='{}',notified_step=null,updated_at=at_time
    where property_id=f.property_id;
   perform private.workspace_followup_note(f.property_id,'Automatic follow-up '||(select count(*) from jsonb_array_elements(f.plan) with ordinality x(v,n) where x.v->>'kind'='auto' and x.n<=f.step+1)
    ||' sent to the owner in the app and by email.',null);
   sent_auto:=sent_auto+1;
  elsif f.notified_step is distinct from f.step then
   update private.workspace_agreement_followups set notified_step=f.step,updated_at=at_time where property_id=f.property_id;
   perform private.workspace_followup_note(f.property_id,'Personal follow-up due: a message in the app, an email, a WhatsApp message and a phone call. Tick each one on the ticket once done.',null);
   perform private.workspace_followup_tell(f.property_id,'enquiry.follow_up_due',at_time);
   due_personal:=due_personal+1;
  end if;
 end loop;
 return jsonb_build_object('started',started,'sent',sent_auto,'personalDue',due_personal,'stopped',stopped,'archived',archived);
end $fn$;

-- What the ticket and the settings card show.
create or replace function private.workspace_followup_view(f private.workspace_agreement_followups) returns jsonb language sql stable security definer set search_path='' as $$
 select case when f.property_id is null then null else jsonb_build_object('propertyId',f.property_id,'status',f.status,'reason',f.reason,'step',f.step,'dueAt',f.due_at,
  'startedAt',f.started_at,'plan',f.plan,'archiveAfterHours',f.archive_after_hours,'checks',f.checks,'updatedAt',f.updated_at) end
$$;
create or replace function private.workspace_followup_settings_view() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('steps',s.steps,'archiveAfterHours',s.archive_after_hours,'updatedAt',s.updated_at,'updatedByName',p.full_name,
  'canEdit',coalesce(private.workspace_actor_role() in ('admin','super_admin'),false))
 from private.workspace_followup_settings s left join public.workspace_profiles p on p.user_id=s.updated_by where s.singleton
$$;

create or replace function private.workspace_agreement_followup_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare f private.workspace_agreement_followups;j private.workspace_journeys;begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if target is null then return jsonb_build_object('settings',private.workspace_followup_settings_view(),'followUp',null,'stage',null);end if;
 select * into j from private.workspace_journeys where property_id=target;
 select * into f from private.workspace_agreement_followups where property_id=target;
 return jsonb_build_object('settings',private.workspace_followup_settings_view(),'followUp',private.workspace_followup_view(f),'stage',j.stage);
end $fn$;

--   { action: 'confirm', requestId, propertyId, channel: 'chat'|'email'|'whatsapp'|'phone' }   a personal follow-up, one channel
--   { action: 'stop', requestId, propertyId, note? }    stop the automatic messages
--   { action: 'resume', requestId, propertyId }         start them again from the step they stopped at
--   { action: 'saveSettings', requestId, steps, archiveAfterHours }   admins and super admins
create or replace function private.workspace_agreement_followup_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 f private.workspace_agreement_followups;j private.workspace_journeys;ch text;ticks jsonb;note text;
 names constant jsonb:='{"chat":"message in the app","email":"email","whatsapp":"WhatsApp message","phone":"phone call"}';begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if a is null or a not in ('confirm','stop','resume','saveSettings') then raise exception 'Unknown follow-up action' using errcode='22023';end if;
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','steps','archiveAfterHours'],64000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change the follow-up steps' using errcode='42501';end if;
  if jsonb_typeof(input->'archiveAfterHours') is distinct from 'number' or (input->>'archiveAfterHours')::numeric<>floor((input->>'archiveAfterHours')::numeric)
   or (input->>'archiveAfterHours')::numeric not between 1 and 4320 then raise exception 'Archive between 1 hour and 180 days after the last step' using errcode='22023';end if;
  update private.workspace_followup_settings set steps=private.workspace_followup_steps(input->'steps'),archive_after_hours=(input->>'archiveAfterHours')::integer,
   updated_by=auth.uid(),updated_at=now() where singleton;
  result:=jsonb_build_object('settings',private.workspace_followup_settings_view(),'followUp',null,'stage',null);
 else
  if coalesce(input->>'propertyId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Property not found' using errcode='P0002';end if;
  select * into f from private.workspace_agreement_followups where property_id=(input->>'propertyId')::uuid for update;
  if f.property_id is null then raise exception 'No follow-ups have started for this property yet' using errcode='P0002';end if;
  select * into j from private.workspace_journeys where property_id=f.property_id;
  if a='confirm' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','channel']);
   ch:=input->>'channel';
   if ch is null or not names?ch then raise exception 'Choose how you followed up' using errcode='22023';end if;
   if f.status not in ('running','stopped') or f.step>=jsonb_array_length(f.plan) or f.plan->f.step->>'kind'<>'personal' then
    raise exception 'There is no personal follow-up to tick right now' using errcode='22023';end if;
   if f.checks?ch then raise exception 'That one is already ticked' using errcode='22023';end if;
   ticks:=f.checks||jsonb_build_object(ch,jsonb_build_object('at',now(),'by',auth.uid()));
   if (select count(*) from jsonb_object_keys(names) k where ticks?k)=4 then
    update private.workspace_agreement_followups set step=f.step+1,checks='{}',notified_step=null,due_at=now()+private.workspace_followup_wait(f,f.step+1),updated_at=now()
     where property_id=f.property_id;
    perform private.workspace_followup_note(f.property_id,'Personal follow-up done: a message in the app, an email, a WhatsApp message and a phone call.',auth.uid());
   else
    update private.workspace_agreement_followups set checks=ticks,updated_at=now() where property_id=f.property_id;
    perform private.workspace_followup_note(f.property_id,'Followed up personally by '||(names->>ch)||'.',auth.uid());
   end if;
  elsif a='stop' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','note']);
   if f.status<>'running' then raise exception 'The automatic follow-ups are not running' using errcode='22023';end if;
   note:=nullif(btrim(coalesce(input->>'note','')),'');
   if note is not null and char_length(note)>300 then raise exception 'Keep the note to 300 characters' using errcode='22023';end if;
   update private.workspace_agreement_followups set status='stopped',reason=coalesce(note,'Stopped by the team'),updated_at=now() where property_id=f.property_id;
   perform private.workspace_followup_note(f.property_id,'Stopped the automatic follow-ups'||coalesce(': '||note,'.'),auth.uid());
  else
   perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
   if f.status<>'stopped' then raise exception 'The follow-ups are not stopped' using errcode='22023';end if;
   if j.stage<>'agreement' or j.signed_at is not null then raise exception 'The agreement is no longer waiting for a signature' using errcode='22023';end if;
   -- Resuming counts as a fresh start for "the owner replied": only a later reply stops it again.
   update private.workspace_agreement_followups set status='running',reason=null,started_at=now(),due_at=now()+private.workspace_followup_wait(f,f.step),notified_step=null,updated_at=now()
    where property_id=f.property_id;
   perform private.workspace_followup_note(f.property_id,'Started the automatic follow-ups again.',auth.uid());
  end if;
  select * into f from private.workspace_agreement_followups where property_id=f.property_id;
  result:=jsonb_build_object('settings',private.workspace_followup_settings_view(),'followUp',private.workspace_followup_view(f),'stage',j.stage);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

create or replace function public.workspace_agreement_followup_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_agreement_followup_read(target) $$;
create or replace function public.workspace_agreement_followup_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_agreement_followup_action(input) $$;
create or replace function public.workspace_agreement_followup_sweep() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_agreement_followup_sweep() $$;

revoke all on function private.workspace_followup_steps(jsonb),private.workspace_followup_wait(private.workspace_agreement_followups,integer),
 private.workspace_followup_note(uuid,text,uuid),private.workspace_followup_team(uuid),private.workspace_followup_tell(uuid,text,timestamptz),
 private.workspace_followup_sent(uuid),private.workspace_followup_post(private.workspace_agreement_followups,timestamptz),private.workspace_followup_archive(uuid),
 private.workspace_followup_view(private.workspace_agreement_followups),private.workspace_followup_settings_view(),
 private.workspace_agreement_followup_sweep(timestamptz),public.workspace_agreement_followup_sweep(),
 private.workspace_agreement_followup_read(uuid),public.workspace_agreement_followup_read(uuid),
 private.workspace_agreement_followup_action(jsonb),public.workspace_agreement_followup_action(jsonb)
 from public,anon,authenticated,service_role;
-- The public wrappers run as the caller, so the caller may execute the private function they call.
grant execute on function private.workspace_agreement_followup_read(uuid),public.workspace_agreement_followup_read(uuid),
 private.workspace_agreement_followup_action(jsonb),public.workspace_agreement_followup_action(jsonb) to authenticated;
grant execute on function private.workspace_agreement_followup_sweep(timestamptz),public.workspace_agreement_followup_sweep() to service_role;

-- Journeys already waiting on a signature start now, from the install.
insert into private.workspace_agreement_followups(property_id,revision,started_at,plan,archive_after_hours,step,due_at)
select j.property_id,j.agreement_revision,now(),s.steps,s.archive_after_hours,0,now()+make_interval(hours=>(s.steps->0->>'afterHours')::integer)
from private.workspace_journeys j cross join private.workspace_followup_settings s
where s.singleton and j.stage='agreement' and j.agreement_revision>0 and j.signed_at is null
on conflict(property_id) do nothing;
