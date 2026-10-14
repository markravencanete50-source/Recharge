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
