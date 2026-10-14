-- Round 10 (email subject, estimate email, enquiry delete, reported guest and client messages): the 4 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '2026101951%' or version like '2026101952%' or version like '20261020%') then raise exception 'Round 10 (email subject, estimate email, enquiry delete, reported guest and client messages) is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261019510000_client_email_new_subject =====
-- Client email conversations, round 2 (Lee: one conversation per person, but show each new subject).
-- A new email from the same person on a different subject joins their open conversation as before, and now:
--   * the message starts with its "Subject: ..." line, like the first email of a conversation;
--   * the conversation takes the newest subject, so the Clients row and the pane header show it and the reply goes out as "Re: <it>".
-- Replies (matched by In-Reply-To / References) and "Re: / Fwd:" of the same subject change nothing.
-- Replaced whole: private.workspace_client_email_in (only 20261019500000 defines it). New: private.workspace_client_email_topic.
-- Safe to run twice (create or replace only; no data change).

-- The subject without "Re:" / "Fwd:" prefixes, lower case, for comparing.
create or replace function private.workspace_client_email_topic(s text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(regexp_replace(coalesce(s,''),'^(\s*(re|fwd?|aw|sv|wg)\s*(\[\d+\])?\s*:\s*)+','','i'))),'')
$$;
revoke all on function private.workspace_client_email_topic(text) from public,anon,authenticated,service_role;

create or replace function private.workspace_client_email_in(eid text,sender text,sname text,subj text,body text,at timestamptz,mid text,irt text,refs text[],input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare th private.workspace_client_email_threads;ids text[]:=array_remove(array[irt]||refs,null);msg uuid;ev bigint;fresh boolean:=false;by_address boolean:=false;new_topic boolean:=false;topic text:=nullif(btrim(coalesce(subj,'')),'');begin
 if cardinality(ids)>0 then
  select t.* into th from private.workspace_client_email_messages m join private.workspace_client_email_threads t on t.id=m.thread_id
   where lower(m.rfc_message_id)=any(ids) and t.status<>'assigned' order by t.last_message_at desc limit 1;
 end if;
 if th.id is null then
  select * into th from private.workspace_client_email_threads t where t.address=sender and t.status<>'assigned' order by t.last_message_at desc limit 1;
  by_address:=th.id is not null;
 end if;
 if th.id is null then
  insert into private.workspace_client_email_threads(address,name,subject,last_message_at) values(sender,sname,topic,at) returning * into th;
  fresh:=true;
 end if;
 -- One conversation per person. A new email (not a reply) on another subject joins it, starts with its subject as written, and becomes
 -- the conversation's subject: the row and header show it and the team's reply is "Re: <it>". An older one arriving late shows its line
 -- but leaves the conversation's subject alone.
 new_topic:=by_address and topic is not null and private.workspace_client_email_topic(topic) is distinct from private.workspace_client_email_topic(th.subject);
 if (fresh or new_topic) and topic is not null and body not like 'Subject: %' then body:='Subject: '||topic||E'\n\n'||body;end if;
 insert into private.workspace_client_email_messages(thread_id,direction,email_id,body,sent_at,rfc_message_id,in_reply_to,refs)
  values(th.id,'in',eid,left(body,5000),at,mid,irt,refs) on conflict do nothing returning id into msg;
 if msg is null then return th.id;end if;
 update private.workspace_client_email_threads set status='open',closed_at=null,closed_by=null,last_message_at=greatest(last_message_at,at),
  name=coalesce(name,sname),subject=case when new_topic and at>=th.last_message_at then topic else coalesce(subject,topic) end where id=th.id;
 if jsonb_typeof(input->'attachments')='array' then
  insert into private.workspace_email_attachments(client_email_message_id,path,filename,mime,bytes)
   select msg,a->>'path',left(coalesce(nullif(a->>'filename',''),'attachment'),200),a->>'mime',(a->>'bytes')::integer from jsonb_array_elements(input->'attachments') a limit 10
   on conflict(path) do nothing;
 end if;
 begin
  insert into public.workspace_activity(actor_id,property_id,event_type) values(null,null,'client.email') returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id) select u,ev from private.workspace_client_email_team() u on conflict do nothing;
 exception when others then raise warning 'Client email notices skipped: %',sqlerrm;
 end;
 return th.id;
end $$;

revoke all on function private.workspace_client_email_in(text,text,text,text,text,timestamptz,text,text,text[],jsonb) from public,anon,authenticated,service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('20261019510000','client_email_new_subject');

-- ===== 20261019520000_estimate_email_link =====
-- The estimate, emailed with a private link (Lee, 14 October: "Email + secure link").
--  * When the team publishes (or republishes) an estimate on a journey with no owner account, the server
--    makes a private link (only its hash is kept here) and emails it from ownerrelations@ to the enquiry's
--    email address, replies going to ownerrelations@ (and so into Messages, Clients). "Resend" emails a new
--    link; "Copy link" makes one to send by hand (also when email is not set up).
--  * The client opens the link without an account, sees the estimate, and chooses Proceed, Review later
--    (with a follow-up date) or Decline, with optional feedback: the same decision the team records for
--    them (decideEstimate), so the journey moves on and "Owner decides on the estimate" ticks.
--  * The team sees "Estimate sent" only once the email for the current estimate has gone; otherwise
--    "Estimate ready" (published, not emailed, or the email failed).
-- New: table private.workspace_estimate_links; functions workspace_estimate_recipient, workspace_estimate_delivery,
-- workspace_estimate_link_action (+ public wrapper), workspace_estimate_public (+ public wrapper, service role only).
-- Anchor patches (one anchor each, with a sentinel): private.workspace_journey_view(private.workspace_journeys) and
-- private.workspace_client_enquiry_view(private.workspace_client_enquiries) gain the delivery state.
-- Safe to run twice.

create table if not exists private.workspace_estimate_links (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
 request_id uuid not null unique,
 delivery text not null check(delivery in ('email','link')),
 email_status text not null default 'pending' check(email_status in ('pending','sent','failed','manual')),
 recipient_email text check(recipient_email is null or length(recipient_email) between 3 and 320),
 -- The estimate this link was made for: a later publish needs its own email before it counts as sent.
 estimate jsonb not null,
 issued_by uuid not null references public.workspace_profiles(user_id),
 issued_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 days',
 opened_at timestamptz,
 decided_at timestamptz,
 decision text check(decision in ('proceed','review','decline')),
 check((delivery='link')=(email_status='manual'))
);
create index if not exists workspace_estimate_links_property_idx on private.workspace_estimate_links(property_id,issued_at desc);
create index if not exists workspace_estimate_links_issuer_idx on private.workspace_estimate_links(issued_by);
alter table private.workspace_estimate_links enable row level security;
revoke all on private.workspace_estimate_links from public,anon,authenticated;

-- Who the estimate goes to: the contact on the journey (an enquiry added by hand), else the enquiry form's recipient.
create or replace function private.workspace_estimate_recipient(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object(
  'email',coalesce(nullif(j.enquiry->>'email',''),(select e.recipient_email from private.workspace_client_enquiries e where e.property_id=target order by e.sent_at desc limit 1)),
  'name',coalesce(nullif(j.enquiry->>'contactName',''),(select e.recipient_name from private.workspace_client_enquiries e where e.property_id=target order by e.sent_at desc limit 1),''))
 from private.workspace_journeys j where j.property_id=target
$fn$;

-- The team's view of how the current estimate reached the client. Null with an owner account (they see it in the
-- app) or before an estimate. status: sent (the email for this estimate went), sending (going out now), ready.
create or replace function private.workspace_estimate_delivery(j private.workspace_journeys) returns jsonb language sql stable security definer set search_path='' as $fn$
 select case when j.client_id is null and j.estimate is not null then jsonb_build_object(
  'status',case when exists(select 1 from private.workspace_estimate_links l where l.property_id=j.property_id and l.estimate=j.estimate and l.email_status='sent') then 'sent'
   when exists(select 1 from private.workspace_estimate_links l where l.property_id=j.property_id and l.estimate=j.estimate and l.email_status='pending' and l.issued_at>now()-interval '2 minutes') then 'sending'
   else 'ready' end,
  'emailFailed',coalesce((select l.email_status='failed' from private.workspace_estimate_links l where l.property_id=j.property_id and l.estimate=j.estimate and l.delivery='email' order by l.issued_at desc limit 1),false),
  'sentAt',(select max(l.issued_at) from private.workspace_estimate_links l where l.property_id=j.property_id and l.estimate=j.estimate and l.email_status='sent'),
  'openedAt',(select max(l.opened_at) from private.workspace_estimate_links l where l.property_id=j.property_id),
  'decidedAt',(select max(l.decided_at) from private.workspace_estimate_links l where l.property_id=j.property_id),
  'to',private.workspace_estimate_recipient(j.property_id)->>'email') end
$fn$;

-- ---------------------------------------------------------------- the team: a link, emailed or copied
-- issue: once per request id (a retry returns the same link and says whether to send). The server makes the token
-- from the request, emails it when asked, then reports back with markEmail.
create or replace function private.workspace_estimate_link_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a text:=input->>'action';me uuid:=auth.uid();role text:=private.workspace_actor_role();req uuid;target uuid;j private.workspace_journeys;l private.workspace_estimate_links;who jsonb;begin
 if role is null or role not in ('stays','admin','super_admin') then raise exception 'Onboarding access denied' using errcode='42501';end if;
 begin req:=(input->>'requestId')::uuid;exception when others then req:=null;end;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a='issue' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','tokenHash','delivery']);
  begin target:=(input->>'propertyId')::uuid;exception when others then target:=null;end;
  if target is null or not private.workspace_can_property(target,'property-onboarding') then raise exception 'Onboarding access denied' using errcode='42501';end if;
  select * into l from private.workspace_estimate_links where request_id=req;
  if l.id is not null then
   if l.issued_by<>me or l.property_id<>target then raise exception 'Request identifier reused' using errcode='23505';end if;
  else
   if coalesce(input->>'delivery','') not in ('email','link') or coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid estimate link' using errcode='22023';end if;
   select * into j from private.workspace_journeys where property_id=target;
   if j.property_id is null or j.client_id is not null or j.estimate is null or j.stage not in ('estimate','reviewing') then raise exception 'Only a published estimate without an owner account is sent this way' using errcode='22023';end if;
   who:=private.workspace_estimate_recipient(target);
   if input->>'delivery'='email' and coalesce(who->>'email','')!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'There is no email address for this enquiry. Use Copy link instead.' using errcode='22023';end if;
   insert into private.workspace_estimate_links(property_id,token_hash,request_id,delivery,email_status,recipient_email,estimate,issued_by)
    values(target,input->>'tokenHash',req,input->>'delivery',case when input->>'delivery'='email' then 'pending' else 'manual' end,
     case when input->>'delivery'='email' then lower(who->>'email') end,j.estimate,me) returning * into l;
  end if;
  select * into j from private.workspace_journeys where property_id=l.property_id;
  who:=private.workspace_estimate_recipient(l.property_id);
  return jsonb_build_object('id',l.id,'send',l.delivery='email' and l.email_status in ('pending','failed'),'delivery',l.delivery,'emailStatus',l.email_status,
   'to',l.recipient_email,'name',coalesce(who->>'name',''),'propertyName',(select p.name from public.workspace_properties p where p.id=l.property_id),
   'estimate',l.estimate,'expiresAt',l.expires_at,'estimateDelivery',private.workspace_estimate_delivery(j));
 elsif a='markEmail' then
  perform private.workspace_json_keys(input,array['action','requestId','emailStatus']);
  if coalesce(input->>'emailStatus','') not in ('sent','failed') then raise exception 'Invalid email status' using errcode='22023';end if;
  update private.workspace_estimate_links set email_status=input->>'emailStatus' where request_id=req and issued_by=me and delivery='email' and email_status<>'sent' returning * into l;
  select * into j from private.workspace_journeys where property_id=coalesce(l.property_id,(select x.property_id from private.workspace_estimate_links x where x.request_id=req and x.issued_by=me));
  return jsonb_build_object('estimateDelivery',private.workspace_estimate_delivery(j));
 end if;
 raise exception 'Unknown estimate link action' using errcode='22023';
end $fn$;

-- ---------------------------------------------------------------- the client: open and decide (no account; the server holds the service key)
create or replace function private.workspace_estimate_public(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a text:=input->>'action';l private.workspace_estimate_links;j private.workspace_journeys;state text;d text;follow date;begin
 if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
 select * into l from private.workspace_estimate_links where token_hash=input->>'tokenHash' for update;
 if l.id is null then raise exception 'This link is not valid' using errcode='P0002';end if;
 select * into j from private.workspace_journeys where property_id=l.property_id for update;
 if j.property_id is null or j.client_id is not null or j.estimate is null then raise exception 'This link is not valid' using errcode='P0002';end if;
 state:=case when j.stage in ('estimate','reviewing') then case when l.expires_at<now() then 'expired' else 'open' end
  when j.stage='archived' then 'declined' when j.stage='enquiry' then 'withdrawn' else 'proceeding' end;
 if a='open' then
  perform private.workspace_json_keys(input,array['action','tokenHash']);
  update private.workspace_estimate_links set opened_at=coalesce(opened_at,now()) where id=l.id;
 elsif a='decide' then
  perform private.workspace_json_keys(input,array['action','tokenHash','decision','feedback','followUpOn']);
  if state<>'open' then raise exception 'This estimate can no longer be answered here. Reply to the email from Recharge.' using errcode='22023';end if;
  d:=coalesce(input->>'decision','');
  if d not in ('proceed','review','decline') then raise exception 'Choose Proceed, Review later or Decline' using errcode='22023';end if;
  if length(coalesce(input->>'feedback',''))>5000 then raise exception 'Feedback can be up to 5,000 characters' using errcode='22023';end if;
  begin follow:=nullif(input->>'followUpOn','')::date;exception when others then raise exception 'Choose a valid follow-up date' using errcode='22023';end;
  if d='review' and (follow is null or follow<current_date or follow>current_date+366) then raise exception 'Choose a follow-up date from today, within a year' using errcode='22023';end if;
  -- The same as decideEstimate (20261010150000), recorded by the client from their link.
  update private.workspace_journeys set stage=case d when 'proceed' then 'agreement' when 'review' then 'reviewing' else 'archived' end,
   follow_up_on=case when d='review' then follow end,feedback=btrim(coalesce(input->>'feedback','')),version=version+1,updated_at=now() where property_id=j.property_id;
  if d='decline' then
   update public.workspace_properties set status='archived',version=version+1 where id=j.property_id;
   update public.workspace_work_items set status='declined',version=version+1 where id=j.work_id;
  end if;
  update private.workspace_estimate_links set decided_at=now(),decision=d,opened_at=coalesce(opened_at,now()) where id=l.id;
  perform private.workspace_journey_event(j.property_id,'journey.decideEstimate');
  select * into j from private.workspace_journeys where property_id=l.property_id;
  state:=case when j.stage='reviewing' then 'open' when j.stage='archived' then 'declined' else 'proceeding' end;
 else raise exception 'Unknown action' using errcode='22023';
 end if;
 return jsonb_build_object('state',state,'propertyName',(select p.name from public.workspace_properties p where p.id=j.property_id),
  'name',coalesce(private.workspace_estimate_recipient(j.property_id)->>'name',''),'estimate',j.estimate,'stage',j.stage,'followUpOn',j.follow_up_on,'feedback',j.feedback);
end $fn$;

create or replace function public.workspace_estimate_link_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_estimate_link_action(input);$$;
create or replace function public.workspace_estimate_public(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_estimate_public(input);$$;
revoke all on function private.workspace_estimate_recipient(uuid),private.workspace_estimate_delivery(private.workspace_journeys) from public,anon,authenticated,service_role;
revoke all on function private.workspace_estimate_link_action(jsonb),public.workspace_estimate_link_action(jsonb),
 private.workspace_estimate_public(jsonb),public.workspace_estimate_public(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_estimate_link_action(jsonb),public.workspace_estimate_link_action(jsonb) to authenticated;
grant execute on function private.workspace_estimate_public(jsonb),public.workspace_estimate_public(jsonb) to service_role;

-- The team sees the delivery state on the journey and on the enquiry.
do $$
declare
 fixes text[][] := array[
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'invoiceOutsideNote',j.invoice_outside_note,$q$,
   $q$'invoiceOutsideNote',j.invoice_outside_note,'estimateDelivery',private.workspace_estimate_delivery(j),$q$,
   $q$'estimateDelivery'$q$],
  ['private.workspace_client_enquiry_view(private.workspace_client_enquiries)',
   $q$'duplicateOfName',(select x.name from public.workspace_properties x where x.id=e.duplicate_of))$q$,
   $q$'duplicateOfName',(select x.name from public.workspace_properties x where x.id=e.duplicate_of))||jsonb_build_object('estimateDelivery',(select private.workspace_estimate_delivery(j) from private.workspace_journeys j where j.property_id=e.property_id))$q$,
   $q$'estimateDelivery'$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261019520000','estimate_email_link');

-- ===== 20261020210000_delete_enquiry_through_agreement =====
-- Lee: "WE SHOULD BE ABLE TO DELETE ENQUIRIES". Round 6 (20261016210000) allowed it only at the enquiry stage; his test
-- enquiry was at "Estimate sent" and could not go. Now:
--   * Admins and super admins only, as before.
--   * Any stage up to and including the agreement, while it is not signed and the property is not live: enquiry,
--     estimate, reviewing, agreement, or closed (archived) before anything was signed. A signed agreement, an
--     invoice or a live property is refused ("Archive it instead"); live properties keep the archive path.
--   * Everything that came from the enquiry goes, in this one transaction: the enquiry and its answers, the
--     property it made, the journey and its questions, the estimate model, every work item on the property with
--     its updates, details and notices, the activity, management flags and to-dos about it, listing links, local
--     events, access logins, default cleaners and the team's access. The enquiry's photos and videos are queued in
--     private.workspace_storage_removals and removed by the site's server straight away, as before.
--   * Anything that means real business stops it with a plain message naming it (an invoice, bookings, costs,
--     owner statements, payout details, guest messages, photos on a work item, messages, routine visits...). This
--     is read from the foreign keys, so a table added later (an estimate link or email record, for example) stops
--     a delete rather than being left behind, until it is added to the list below.
--   * The access history keeps a "client_enquiry.deleted" entry: who, when, which enquiry (name and company) and
--     the property's address and stage. No email or phone.
-- Run-twice safe: replaced functions only. The route patch from 20261016210000 already sends deleteEnquiry here.
-- Replaces whole: private.workspace_client_enquiry_delete(jsonb). Adds private.workspace_enquiry_blocker(uuid,uuid[],uuid).
-- Drops private.workspace_enquiry_moved_on(uuid,uuid), which only the old delete used.

-- What stops a delete, in plain words, or null. Every foreign key that would refuse the delete (no action or
-- restrict) into the property, its work items or the enquiry is checked, except the tables the delete itself
-- clears. Cascades and "set null" need nothing.
create or replace function private.workspace_enquiry_blocker(prop uuid, tasks uuid[], enquiry uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare r record; found boolean;
 cleared constant regclass[] := array['private.workspace_client_enquiries','private.workspace_journeys','private.workspace_journey_questions','public.workspace_activity',
  'public.workspace_work_items','public.workspace_property_assignments','private.workspace_estimate_models','private.workspace_management_flags','private.workspace_hub_items',
  'private.workspace_listing_links','private.workspace_local_events','private.workspace_property_secrets','private.workspace_default_cleaners',
  'private.workspace_notification_outbox','public.workspace_work_updates','private.workspace_domain_details','private.workspace_upload_intents']::regclass[];
begin
 for r in select c.conrelid, c.conrelid::regclass::text as tbl, a.attname, c.confrelid from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confdeltype in ('a','r')
   and c.confrelid in ('public.workspace_properties'::regclass,'public.workspace_work_items'::regclass,'private.workspace_client_enquiries'::regclass) loop
  continue when r.conrelid=any(cleared);
  if r.confrelid='public.workspace_properties'::regclass then
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using prop;
  elsif r.confrelid='public.workspace_work_items'::regclass then
   continue when cardinality(tasks)=0;
   execute format('select exists(select 1 from %s where %I=any($1))',r.tbl,r.attname) into found using tasks;
  else
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using enquiry;
  end if;
  if found then
   return case r.conrelid
    when 'public.workspace_invoices'::regclass then 'an invoice'
    when 'private.workspace_reservations'::regclass then 'bookings'
    when 'private.workspace_owner_statements'::regclass then 'owner statements'
    when 'private.workspace_bank_details'::regclass then 'payout details'
    when 'private.workspace_property_financials'::regclass then 'financial settings'
    when 'private.workspace_guest_messages'::regclass then 'guest messages'
    when 'private.workspace_media_evidence'::regclass then 'photos'
    when 'public.workspace_threads'::regclass then 'messages'
    when 'private.workspace_routine_plans'::regclass then 'routine visits'
    when 'private.workspace_routine_visits'::regclass then 'routine visits'
    when 'private.workspace_cleaning_reviews'::regclass then 'clean reviews'
    else case when r.tbl ~ '(expense|cost|invoice_lines)' then 'costs' else 'other records' end end;
  end if;
 end loop;
 return null;
end $fn$;

-- { action: 'deleteEnquiry', requestId, enquiryId, version }. Returns { deleted, enquiryId, propertyDeleted, paths }.
create or replace function private.workspace_client_enquiry_delete(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;p public.workspace_properties;prop uuid;tasks uuid[]:='{}';paths text[];events bigint[];blocker text;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only management can delete an enquiry' using errcode='42501';end if;
 if input->>'action' is distinct from 'deleteEnquiry' then raise exception 'Unknown team action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
 if e.id is null then raise exception 'Enquiry not found' using errcode='P0002';end if;
 if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 prop:=e.property_id;
 if prop is not null then
  select * into p from public.workspace_properties x where x.id=prop for update;
  select * into j from private.workspace_journeys x where x.property_id=prop for update;
  -- Up to and including the agreement, unsigned, never live.
  if p.status not in ('onboarding','archived')
   or (j.property_id is not null and (j.stage not in ('enquiry','estimate','reviewing','agreement','archived') or j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null)) then
   raise exception 'The agreement is signed or the property is live, so this enquiry can no longer be deleted. Archive it instead.' using errcode='22023';
  end if;
  tasks:=array(select w.id from public.workspace_work_items w where w.property_id=prop);
  if j.work_id is not null and not j.work_id=any(tasks) then tasks:=tasks||j.work_id;end if;
 end if;
 blocker:=private.workspace_enquiry_blocker(prop,tasks,e.id);
 if blocker is not null then
  raise exception 'This property has % recorded, so this enquiry can no longer be deleted. Archive it instead.',blocker using errcode='22023';
 end if;

 -- The photos and videos: queued, and handed back for the server to remove now.
 paths:=array(select f->>'path' from jsonb_array_elements(e.files) f where coalesce(f->>'path','')<>'');
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by) select 'enquiry-files',x,'client_enquiry.deleted',auth.uid() from unnest(paths) x;

 -- The access history keeps who deleted which enquiry and where, since its own history goes with it.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),'client_enquiry.deleted',jsonb_strip_nulls(jsonb_build_object('enquiryId',e.id,
   'name',left(coalesce(nullif(btrim(e.answers->>'fullName'),''),e.recipient_name),200),'company',nullif(left(btrim(coalesce(e.answers->>'companyName','')),200),''),
   'address',nullif(left(btrim(coalesce(p.address,e.answers->>'propertyAddress','')),300),''),'property',nullif(left(btrim(coalesce(p.name,'')),200),''),
   'status',e.status,'stage',j.stage,'propertyDeleted',prop is not null)),null);

 update private.workspace_client_enquiries set duplicate_of=null where duplicate_of=prop and prop is not null;
 delete from private.workspace_client_enquiries where id=e.id;
 if prop is not null then
  -- To-dos and flags about it (their updates go with them).
  delete from private.workspace_management_flags f where f.property_id=prop or f.work_id=any(tasks)
   or f.hub_item_id in (select h.id from private.workspace_hub_items h where h.property_id=prop);
  delete from private.workspace_hub_items h where h.property_id=prop;
  -- Activity and notices on the property and its work.
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop or a.work_id=any(tasks));
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events) or o.work_id=any(tasks));
  delete from private.workspace_notification_outbox o where o.event_id=any(events) or o.work_id=any(tasks);
  delete from public.workspace_activity a where a.id=any(events);
  -- The journey, its questions and estimate, and the property's set-up.
  delete from private.workspace_journey_questions q where q.property_id=prop;
  delete from private.workspace_journeys x where x.property_id=prop;
  delete from private.workspace_estimate_models m where m.property_id=prop;
  delete from private.workspace_listing_links l where l.property_id=prop;
  delete from private.workspace_local_events l where l.property_id=prop;
  delete from private.workspace_property_secrets s where s.property_id=prop;
  delete from private.workspace_default_cleaners c where c.property_id=prop;
  -- The work items.
  delete from public.workspace_work_updates u where u.work_id=any(tasks);
  delete from private.workspace_domain_details d where d.work_id=any(tasks);
  delete from private.workspace_upload_intents u where u.work_id=any(tasks);
  delete from public.workspace_work_items w where w.id=any(tasks);
  delete from public.workspace_property_assignments x where x.property_id=prop;
  -- Rows the property itself just wrote while the deletes ran.
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop);
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events));
  delete from private.workspace_notification_outbox o where o.event_id=any(events);
  delete from public.workspace_activity a where a.id=any(events);
  delete from public.workspace_properties x where x.id=prop;
 end if;

 result:=jsonb_build_object('deleted',true,'enquiryId',e.id,'propertyDeleted',prop is not null,'paths',to_jsonb(paths));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

drop function if exists private.workspace_enquiry_moved_on(uuid,uuid);
revoke all on function private.workspace_enquiry_blocker(uuid,uuid[],uuid),private.workspace_client_enquiry_delete(jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('20261020210000','delete_enquiry_through_agreement');

-- ===== 20261020300000_inbox_message_reports =====
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261020300000','inbox_message_reports');

commit;
