-- Leads: Internal Analysis is approved by the Property Performance Manager (Business Plan, updated 17/10/26, Property
-- Onboarding 2a: "The property performance consultant reviews the information, edits where necessary and approves. Once
-- approved, it is then sent to the property performance manager under property performance approvals").
--  * The consultant's Approve on Internal Analysis sends it to the Property Performance Manager (admins, and the people
--    admins name on Listings: private.workspace_listing_can_approve) instead of ticking it, and tells them
--    ('enquiry.lead_approval'). The manager approves it (it is ticked, and the consultant is told, 'enquiry.lead_approved')
--    or returns it with a note ('enquiry.lead_returned'). A manager approving their own Internal Analysis ticks it at once.
--    While it waits, the step cannot be changed; reopening it takes it back. Steps ticked before this stay ticked.
--  * Which steps need the manager: private.workspace_lead_needs_manager (Internal Analysis).
--  * The manager's list: public.workspace_lead_approvals() (the leads waiting for them).
--  * Recruitment: the Property Onboarding Consultant is now the Property Performance Consultant (the same job key, so
--    vacancies already asked for keep their job). Saved job lists that still have the old title are renamed.
-- New: columns sent_by, sent_at, returned_by, returned_at, returned_note on private.workspace_lead_steps; functions
--   private.workspace_lead_needs_manager, private.workspace_lead_tell, private.workspace_lead_approvals (and public wrapper).
-- Replaces private.workspace_lead_action and private.workspace_lead_state (20261025300000) and
--   private.workspace_recruitment_settings_default (20261029600000). Patched by anchor: private.workspace_teams_action
--   (the two new lead actions).
-- No DROP, no DELETE. Safe to run twice.

alter table private.workspace_lead_steps add column if not exists sent_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_lead_steps add column if not exists sent_at timestamptz;
alter table private.workspace_lead_steps add column if not exists returned_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_lead_steps add column if not exists returned_at timestamptz;
alter table private.workspace_lead_steps add column if not exists returned_note text check(returned_note is null or length(returned_note) between 1 and 1000);
create index if not exists workspace_lead_steps_sender_idx on private.workspace_lead_steps(sent_by);
create index if not exists workspace_lead_steps_returner_idx on private.workspace_lead_steps(returned_by);
create index if not exists workspace_lead_steps_waiting_idx on private.workspace_lead_steps(sent_at) where sent_at is not null and ticked_at is null;

create or replace function private.workspace_lead_needs_manager(step text) returns boolean language sql immutable set search_path='' as $$select step='internal'$$;

-- Tells people about a lead (never the person doing it; only the active team who work with enquiries).
create or replace function private.workspace_lead_tell(e private.workspace_client_enquiries,event text,who uuid[]) returns void language plpgsql security definer set search_path='' as $fn$
declare ev bigint;begin
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),e.property_id,event) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id)
  select distinct u,ev from unnest(who) u join public.workspace_profiles p on p.user_id=u
  where u is distinct from auth.uid() and p.status='active' and p.role in ('admin','super_admin','stays') on conflict do nothing;
end $fn$;

create or replace function private.workspace_lead_state(target_enquiry uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('enquiryId',target_enquiry,'canApprove',private.workspace_listing_can_approve(),
  'steps',(select coalesce(jsonb_agg(jsonb_build_object('step',s.lead_step,'data',s.step_data,'savedAt',s.saved_at,'savedByName',a.full_name,
     'tickedAt',s.ticked_at,'tickedByName',b.full_name,
     'sentAt',s.sent_at,'sentByName',c.full_name,'returnedAt',s.returned_at,'returnedByName',d.full_name,'returnedNote',s.returned_note) order by array_position(array['internal','external','local','revenue','submit'],s.lead_step)),'[]')
   from private.workspace_lead_steps s left join public.workspace_profiles a on a.user_id=s.saved_by left join public.workspace_profiles b on b.user_id=s.ticked_by
    left join public.workspace_profiles c on c.user_id=s.sent_by left join public.workspace_profiles d on d.user_id=s.returned_by
   where s.enquiry_id=target_enquiry),
  'files',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'bytes',f.bytes,'at',f.created_at) order by f.created_at,f.id),'[]')
   from private.workspace_lead_files f where f.enquiry_id=target_enquiry and f.removed_at is null),
  'activity',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'text',x.body,'byId',x.created_by,'byName',p.full_name,'at',x.created_at) order by x.id desc),'[]')
   from (select * from private.workspace_lead_activity y where y.enquiry_id=target_enquiry order by y.id desc limit 200) x left join public.workspace_profiles p on p.user_id=x.created_by))
$fn$;

create or replace function private.workspace_lead_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;s private.workspace_lead_steps;txt text;event_id bigint;hearers uuid[];idx integer;done boolean;d jsonb;send boolean;
 order_of constant text[]:=array['internal','external','local','revenue','submit'];
 label_of constant text[]:=array['Internal Analysis','External Analysis','Local Area Analysis','Estimated Revenue','Submit Estimate'];
 verb_of constant text[]:=array['approved','submitted','approved','submitted','submitted'];
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if a is null or a not in ('addLeadComment','saveLeadStep','reopenLeadStep','approveLeadStep','returnLeadStep') then raise exception 'Unknown lead action' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if coalesce(input->>'enquiryId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Lead not found' using errcode='P0002';end if;
 select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
 if e.id is null then raise exception 'Lead not found' using errcode='P0002';end if;

 if a='addLeadComment' then
  perform private.workspace_json_keys(input,array['action','requestId','enquiryId','text']);
  txt:=private.workspace_required_text(input,'text',1,2000);
  -- Who hears about it, worked out before the comment is added: who sent or valued the lead, and everyone who commented.
  hearers:=array(select e.sent_by union select e.valued_by union select x.created_by from private.workspace_lead_activity x where x.enquiry_id=e.id and x.kind='comment');
  insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'comment',txt,auth.uid());
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),e.property_id,'enquiry.lead_comment') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select distinct u,event_id from unnest(hearers) u join public.workspace_profiles p on p.user_id=u
   where u is distinct from auth.uid() and p.status='active' and p.role in ('admin','super_admin','stays') on conflict do nothing;
 else
  idx:=array_position(order_of,input->>'step');
  if idx is null then raise exception 'Choose an estimate step' using errcode='22023';end if;
  if e.property_id is null or e.status='closed' then raise exception 'The estimate steps open once the form is back and the property is in Properties' using errcode='22023';end if;
  select * into j from private.workspace_journeys x where x.property_id=e.property_id for update;
  if j.property_id is null or j.stage not in ('enquiry','estimate','reviewing') then raise exception 'The estimate is finished for this lead: the owner has moved on from it' using errcode='22023';end if;
  select * into s from private.workspace_lead_steps x where x.enquiry_id=e.id and x.lead_step=order_of[idx] for update;
  if a='saveLeadStep' then
   perform private.workspace_json_keys(input,array['action','requestId','enquiryId','step','data','done'],250000);
   if jsonb_typeof(input->'done') is distinct from 'boolean' then raise exception 'Say whether the step is done' using errcode='22023';end if;
   if idx=5 then raise exception 'Submit the estimate to finish this step' using errcode='22023';end if;
   if s.ticked_at is not null then raise exception 'This step is done. Reopen it to change it' using errcode='22023';end if;
   if s.sent_at is not null then raise exception 'This step is with the Property Performance Manager. Reopen it to change it' using errcode='22023';end if;
   done:=(input->>'done')::boolean;
   d:=private.workspace_lead_step_data(order_of[idx],input->'data',done,e.id);
   if done and exists(select 1 from unnest(order_of[1:idx-1]) k where not exists(select 1 from private.workspace_lead_steps x where x.enquiry_id=e.id and x.lead_step=k and x.ticked_at is not null)) then
    raise exception 'Finish the steps before this one first' using errcode='22023';end if;
   -- A step the Property Performance Manager approves is sent to them instead of ticked (they tick their own).
   send:=done and private.workspace_lead_needs_manager(order_of[idx]) and not private.workspace_listing_can_approve();
   insert into private.workspace_lead_steps as x(enquiry_id,lead_step,step_data,saved_by,saved_at,ticked_by,ticked_at,sent_by,sent_at,returned_by,returned_at,returned_note)
    values(e.id,order_of[idx],d,auth.uid(),now(),case when done and not send then auth.uid() end,case when done and not send then now() end,
     case when send then auth.uid() end,case when send then now() end,null,null,null)
    on conflict(enquiry_id,lead_step) do update set step_data=excluded.step_data,saved_by=excluded.saved_by,saved_at=excluded.saved_at,ticked_by=excluded.ticked_by,ticked_at=excluded.ticked_at,
     sent_by=excluded.sent_by,sent_at=excluded.sent_at,
     returned_by=case when done then null else x.returned_by end,returned_at=case when done then null else x.returned_at end,returned_note=case when done then null else x.returned_note end;
   if send then
    insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','sent '||label_of[idx]||' to the Property Performance Manager',auth.uid());
    perform private.workspace_lead_tell(e,'enquiry.lead_approval',array(select a.user_id from private.workspace_listing_approvers a
     union select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin')));
   elsif done then insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event',verb_of[idx]||' '||label_of[idx],auth.uid());end if;
  elsif a='reopenLeadStep' then
   perform private.workspace_json_keys(input,array['action','requestId','enquiryId','step']);
   if s.ticked_at is null and s.sent_at is null then raise exception 'This step is not done yet' using errcode='22023';end if;
   update private.workspace_lead_steps x set ticked_at=null,ticked_by=null,sent_at=null,sent_by=null
    where x.enquiry_id=e.id and (x.ticked_at is not null or x.sent_at is not null) and array_position(order_of,x.lead_step)>=idx;
   insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','reopened '||label_of[idx],auth.uid());
  else
   -- The Property Performance Manager approves a step sent to them (it is ticked), or returns it with a note.
   perform private.workspace_json_keys(input,array['action','requestId','enquiryId','step']||case when a='returnLeadStep' then array['note'] else array[]::text[] end);
   if not private.workspace_listing_can_approve() then raise exception 'Only the Property Performance Manager can approve this' using errcode='42501';end if;
   if s.sent_at is null or s.ticked_at is not null then raise exception 'Nothing on this step is waiting for approval' using errcode='22023';end if;
   if a='approveLeadStep' then
    update private.workspace_lead_steps x set ticked_at=now(),ticked_by=auth.uid() where x.enquiry_id=e.id and x.lead_step=order_of[idx];
    insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','approved '||label_of[idx],auth.uid());
    perform private.workspace_lead_tell(e,'enquiry.lead_approved',array[s.sent_by]);
   else
    txt:=private.workspace_required_text(input,'note',3,1000);
    update private.workspace_lead_steps x set sent_at=null,sent_by=null,returned_at=now(),returned_by=auth.uid(),returned_note=txt where x.enquiry_id=e.id and x.lead_step=order_of[idx];
    insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event',left('returned '||label_of[idx]||': '||txt,2000),auth.uid());
    perform private.workspace_lead_tell(e,'enquiry.lead_returned',array[s.sent_by]);
   end if;
  end if;
 end if;

 result:=private.workspace_lead_state(e.id);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

create or replace function private.workspace_recruitment_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select '{"jobs":[
  {"key":"housekeeper","title":"Housekeeper","role":"cleans","advert":"Recharge is looking for a Housekeeper. This is not a cleaner: you make sure each property is guest ready and report anything that would stop it being guest ready. You will need an eye for detail, your own transport and good communication."},
  {"key":"property_operations_technician","title":"Property Operations Technician","role":"ready","advert":"Recharge is looking for a Property Operations Technician with good general handy work experience and a general understanding of most trades, to keep our serviced accommodation in top condition."},
  {"key":"furniture_install_technician","title":"Furniture Install Technician","role":"ready","advert":"Recharge is looking for a Furniture Install Technician to receive, assemble and install furniture in our new properties. You must have a van and be able to assemble furniture."},
  {"key":"photographer","title":"Photographer","role":"ready","advert":"Recharge is looking for a Photographer to professionally photograph our serviced accommodation properties for their listings."},
  {"key":"property_onboarding_consultant","title":"Property Performance Consultant","role":"stays","advert":"Recharge is looking for a Property Performance Consultant, the frontline of our sales team: preparing property performance estimates for the Property Performance Manager and answering prospective clients'' questions, with a strong understanding of property performance and excellent communication skills."},
  {"key":"admin_assistant","title":"Admin Assistant","role":"stays","advert":"Recharge is looking for an Admin Assistant to respond to inbound calls and messages and create property listings."},
  {"key":"property_revenue_manager","title":"Property Revenue Manager","role":"stays","advert":"Recharge is looking for a Property Revenue Manager to make sure every property is priced correctly."},
  {"key":"licensing_coordinator","title":"Licensing Coordinator","role":"stays","advert":"Recharge is looking for a Licensing Coordinator to answer licensing questions, advise clients and take every licence application through to completion."},
  {"key":"accounting_administrator","title":"Accounting Administrator","role":"accounts","advert":"Recharge is looking for an Accounting Administrator to send and settle the invoices approved by the management team."},
  {"key":"housekeeping_coordinator","title":"Housekeeping Coordinator","role":"cleaning_manager","advert":"Recharge is looking for a Housekeeping Coordinator to allocate housekeepers to properties and keep every changeover on track."},
  {"key":"property_operations_manager","title":"Property Operations Manager","role":"admin","advert":"Recharge is looking for a Property Operations Manager to coordinate property set-up, reactive maintenance and housekeeping across the country. This is a 24/7 role with no set hours."},
  {"key":"property_performance_manager","title":"Property Performance Manager","role":"admin","advert":"Recharge is looking for a Property Performance Manager to own the performance of our portfolio, from listings to pricing."}
 ]}'::jsonb
$fn$;

-- The Property Performance Manager's list: the leads with a step waiting for them, oldest first.
create or replace function private.workspace_lead_approvals() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 return jsonb_build_object('canApprove',private.workspace_listing_can_approve(),
  'items',case when private.workspace_listing_can_approve() then (select coalesce(jsonb_agg(jsonb_build_object('enquiryId',e.id,
    'name',coalesce(nullif(btrim(e.answers->>'fullName'),''),e.recipient_name),'propertyName',p.name,'step',s.lead_step,'sentAt',s.sent_at,'sentByName',b.full_name)
    order by s.sent_at,e.id),'[]')
   from private.workspace_lead_steps s join private.workspace_client_enquiries e on e.id=s.enquiry_id
   left join public.workspace_properties p on p.id=e.property_id left join public.workspace_profiles b on b.user_id=s.sent_by
   join private.workspace_journeys j on j.property_id=e.property_id
   where s.sent_at is not null and s.ticked_at is null and e.status<>'closed' and j.stage in ('enquiry','estimate','reviewing')) else '[]'::jsonb end);
end $fn$;
create or replace function public.workspace_lead_approvals() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_lead_approvals();$$;

revoke all on function private.workspace_lead_needs_manager(text),private.workspace_lead_tell(private.workspace_client_enquiries,text,uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.workspace_lead_approvals(),public.workspace_lead_approvals() from public,anon,authenticated,service_role;
grant execute on function private.workspace_lead_approvals(),public.workspace_lead_approvals() to authenticated;

-- Saved job lists that still call the job the Property Onboarding Consultant.
update private.workspace_recruitment_settings s set settings=jsonb_set(s.settings,'{jobs}',(select jsonb_agg(case when j->>'key'='property_onboarding_consultant' and j->>'title'='Property Onboarding Consultant'
  then j||jsonb_build_object('title','Property Performance Consultant') else j end order by n) from jsonb_array_elements(s.settings->'jobs') with ordinality x(j,n)))
 where jsonb_typeof(s.settings->'jobs')='array' and exists(select 1 from jsonb_array_elements(s.settings->'jobs') j where j->>'key'='property_onboarding_consultant' and j->>'title'='Property Onboarding Consultant');

do $patch$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('addLeadComment','saveLeadStep','reopenLeadStep')/* lead actions: 20261025300000 */ then$q$,
   $q$if a in ('addLeadComment','saveLeadStep','reopenLeadStep','approveLeadStep','returnLeadStep')/* lead manager approval: 20261031100000 */ or a in ('addLeadComment','saveLeadStep','reopenLeadStep')/* lead actions: 20261025300000 */ then$q$,
   $q$/* lead manager approval: 20261031100000 */$q$]
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
