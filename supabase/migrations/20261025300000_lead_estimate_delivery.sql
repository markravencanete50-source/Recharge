-- Leads and Estimate Delivery (Alex's property onboarding framework, the staff side).
--  * "Client enquiries" is called Leads in the app. A lead is a client enquiry (private.workspace_client_enquiries); its ticket
--    shows what the landlord has told us, the onboarding checklist and an activity thread the team can write in.
--  * Comments: private.workspace_lead_activity keeps the team's comments on a lead (kind 'comment') and what was done on its
--    estimate steps (kind 'event', "approved Internal Analysis"). A comment tells whoever sent or valued the lead and everyone
--    who has commented on it ('enquiry.lead_comment', so it opens Leads like the other enquiry notices).
--  * Estimate Delivery is five tasks, in order, each ticked on its own (private.workspace_lead_steps, one row per lead and
--    step, with what the consultant saved):
--      internal  Internal Analysis: our properties within 30 miles with their occupancy, nightly rate and performance.
--                The app lists them (lib/lead-estimate.ts works out the distance); the consultant edits or removes rows and
--                approves. A lead with no position is approved with notes instead.
--      external  External Analysis: the PriceLabs report (a link, or a file kept in the private 'lead-files' bucket), up to 3
--                comparables chosen by hand and the average nightly rate.
--      local     Local Area Analysis: saved local events and repair work within 30 miles over the next 12 months, reviewed.
--      revenue   Estimated Revenue: the low, medium and high nightly rates, with the estimate's other fields.
--      submit    Submit Estimate: ticked by the existing publish (publishEstimate) once the four before it are ticked, so
--                the client is emailed and told in the app exactly as before.
--    A step is ticked only after the steps before it; reopening a step reopens the steps after it. Nothing can change once
--    the owner has gone past the estimate (agreement onwards).
--  * New estimates take up to 3 comparables (MAX_COMPARABLES in lib/journey-policy.ts). Estimates already saved with more
--    are kept and still read.
--  * Who: the people who work with enquiries (private.workspace_can_enquiries: admins, super admins and Stays with property
--    onboarding). Every action has a requestId receipt. No direct table access for anyone.
-- New: tables private.workspace_lead_steps, private.workspace_lead_activity, private.workspace_lead_files; functions
--   private.workspace_lead_property_stats, private.workspace_lead_state, private.workspace_lead_read (and public wrapper),
--   private.workspace_lead_step_data, private.workspace_lead_action, private.workspace_lead_estimate_published,
--   private.workspace_lead_file_action and private.workspace_lead_file (and public wrappers for the server's file route).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (3 comparables for a new
--   estimate; publishing ticks Submit Estimate) and private.workspace_teams_action (the lead actions).
-- No DROP, no DELETE. Safe to run twice.

create table if not exists private.workspace_lead_steps (
 enquiry_id uuid not null references private.workspace_client_enquiries(id) on delete cascade,
 lead_step text not null check(lead_step in ('internal','external','local','revenue','submit')),
 step_data jsonb not null default '{}' check(jsonb_typeof(step_data)='object'),
 saved_by uuid references public.workspace_profiles(user_id),
 saved_at timestamptz not null default now(),
 ticked_by uuid references public.workspace_profiles(user_id),
 ticked_at timestamptz,
 primary key(enquiry_id,lead_step)
);
create index if not exists workspace_lead_steps_saver_idx on private.workspace_lead_steps(saved_by);
create index if not exists workspace_lead_steps_ticker_idx on private.workspace_lead_steps(ticked_by);

create table if not exists private.workspace_lead_activity (
 id bigint generated always as identity primary key,
 enquiry_id uuid not null references private.workspace_client_enquiries(id) on delete cascade,
 kind text not null check(kind in ('comment','event')),
 body text not null check(length(body) between 1 and 2000),
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);
create index if not exists workspace_lead_activity_lead_idx on private.workspace_lead_activity(enquiry_id,id desc);
create index if not exists workspace_lead_activity_creator_idx on private.workspace_lead_activity(created_by);

-- A PriceLabs report kept with the lead. Removing one marks it removed (the server then deletes the stored copy).
create table if not exists private.workspace_lead_files (
 id uuid primary key,
 enquiry_id uuid not null references private.workspace_client_enquiries(id) on delete cascade,
 path text not null unique check(path~'^leads/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{3,4}$'),
 name text not null check(length(btrim(name)) between 1 and 200),
 mime text not null check(mime in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp')),
 bytes bigint not null check(bytes between 1 and 26214400),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 removed_at timestamptz
);
create index if not exists workspace_lead_files_lead_idx on private.workspace_lead_files(enquiry_id);
create index if not exists workspace_lead_files_creator_idx on private.workspace_lead_files(created_by);

alter table private.workspace_lead_steps enable row level security;
alter table private.workspace_lead_activity enable row level security;
alter table private.workspace_lead_files enable row level security;
revoke all on private.workspace_lead_steps,private.workspace_lead_activity,private.workspace_lead_files from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_lead_activity for each row execute function private.workspace_enforce_write_limit();

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('lead-files','lead-files',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- One of our properties over the last 12 months to the London day: confirmed guest stays (owner stays left out), nights,
-- occupancy, the average nightly payout and the payouts, and the occupancy of each of the last six months (the current one
-- to date).
create or replace function private.workspace_lead_property_stats(prop uuid,today_on date) returns jsonb language sql stable security definer set search_path='' as $fn$
 with stays as (
  select r.check_in,r.check_out,r.payout_minor from private.workspace_reservations r
  where r.property_id=prop and r.status='confirmed' and not private.workspace_is_owner_stay(r) and r.check_out>today_on-365 and r.check_in<today_on
 ), months as (
  select g::date as m from generate_series(date_trunc('month',today_on)-interval '5 months',date_trunc('month',today_on),interval '1 month') g
 )
 select jsonb_build_object(
  'stays',(select count(*) from stays),
  'nights',coalesce((select sum(least(s.check_out,today_on)-greatest(s.check_in,today_on-365)) from stays s),0),
  'occupancyBps',round(10000.0*coalesce((select sum(least(s.check_out,today_on)-greatest(s.check_in,today_on-365)) from stays s),0)/365)::int,
  'adrMinor',(select round(sum(s.payout_minor)::numeric/nullif(sum(s.check_out-s.check_in),0))::bigint from stays s where s.payout_minor is not null),
  'revenueMinor',(select sum(s.payout_minor) from stays s where s.payout_minor is not null),
  'trend',(select jsonb_agg(jsonb_build_object('month',to_char(m.m,'YYYY-MM'),'occupancyBps',
    round(10000.0*coalesce((select sum(greatest(0,least(s.check_out,(m.m+interval '1 month')::date,today_on)-greatest(s.check_in,m.m))) from stays s),0)
     /greatest(1,least((m.m+interval '1 month')::date,today_on)-m.m))::int) order by m.m) from months m))
$fn$;

-- What changes as the team works a lead: its steps, its files and its activity (comments and events), newest first.
create or replace function private.workspace_lead_state(target_enquiry uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('enquiryId',target_enquiry,
  'steps',(select coalesce(jsonb_agg(jsonb_build_object('step',s.lead_step,'data',s.step_data,'savedAt',s.saved_at,'savedByName',a.full_name,
     'tickedAt',s.ticked_at,'tickedByName',b.full_name) order by array_position(array['internal','external','local','revenue','submit'],s.lead_step)),'[]')
   from private.workspace_lead_steps s left join public.workspace_profiles a on a.user_id=s.saved_by left join public.workspace_profiles b on b.user_id=s.ticked_by
   where s.enquiry_id=target_enquiry),
  'files',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'bytes',f.bytes,'at',f.created_at) order by f.created_at,f.id),'[]')
   from private.workspace_lead_files f where f.enquiry_id=target_enquiry and f.removed_at is null),
  'activity',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'text',x.body,'byId',x.created_by,'byName',p.full_name,'at',x.created_at) order by x.id desc),'[]')
   from (select * from private.workspace_lead_activity y where y.enquiry_id=target_enquiry order by y.id desc limit 200) x left join public.workspace_profiles p on p.user_id=x.created_by))
$fn$;

-- A lead's ticket: the enquiry, its property and journey, its estimate steps and activity, and what the analysis steps list
-- from: our active properties with their figures, local events and repair work in the next 12 months (the app keeps those
-- within 30 miles of the lead).
create or replace function private.workspace_lead_read(target_enquiry uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries;j private.workspace_journeys;p public.workspace_properties;today_on date:=(now() at time zone 'Europe/London')::date;
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 select * into e from private.workspace_client_enquiries x where x.id=target_enquiry;
 if e.id is null then raise exception 'Lead not found' using errcode='P0002';end if;
 select * into j from private.workspace_journeys x where x.property_id=e.property_id;
 select * into p from public.workspace_properties x where x.id=e.property_id;
 return private.workspace_lead_state(e.id)||jsonb_build_object(
  'enquiry',private.workspace_client_enquiry_view(e),
  'journey',case when j.property_id is null then null else jsonb_build_object('propertyId',j.property_id,'workId',j.work_id,'stage',j.stage,'version',j.version,
   'estimate',j.estimate,'enquiry',j.enquiry,'propertyType',j.property_type,'bathrooms',j.bathrooms,'clientId',j.client_id) end,
  'property',case when p.id is null then null else jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'bedrooms',p.bedrooms,'latitude',p.latitude,'longitude',p.longitude) end,
  'today',today_on,
  'ownCostCategories',(select s.own_cost_categories from private.workspace_onboarding_settings s where s.singleton),
  'ours',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'address',x.address,'bedrooms',x.bedrooms,'latitude',x.latitude,'longitude',x.longitude,
     'stats',private.workspace_lead_property_stats(x.id,today_on)) order by x.name,x.id),'[]')
   from (select * from public.workspace_properties y where y.status='active' and y.id is distinct from e.property_id order by y.updated_at desc,y.id limit 400) x),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'on',x.event_on,'sourceUrl',x.source_url,'opportunity',x.opportunity,
     'propertyId',x.pid,'propertyName',x.pname,'address',x.paddress,'latitude',x.lat,'longitude',x.lon) order by x.event_on,x.id),'[]')
   from (select le.id,le.name,le.event_on,le.source_url,le.opportunity,y.id pid,y.name pname,y.address paddress,y.latitude lat,y.longitude lon
    from private.workspace_local_events le join public.workspace_properties y on y.id=le.property_id
    where le.archived_at is null and y.status<>'archived' and le.event_on between today_on and today_on+365 order by le.event_on,le.id limit 300) x),
  'repairs',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'status',x.status,'dueOn',x.due_on,'visitFrom',x.visit_from,'contractor',x.contractor,
     'propertyId',x.pid,'propertyName',x.pname,'address',x.paddress,'latitude',x.lat,'longitude',x.lon) order by coalesce(x.due_on,today_on),x.id),'[]')
   from (select w.id,w.title,w.status,w.due_on,d.data->>'visitFrom' visit_from,nullif(btrim(coalesce(d.data->>'assignedReadyName','')),'') contractor,
     y.id pid,y.name pname,y.address paddress,y.latitude lat,y.longitude lon
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id and d.kind='maintenance' join public.workspace_properties y on y.id=w.property_id
    where y.status<>'archived' and coalesce(w.due_on,today_on) between today_on-30 and today_on+365 and (w.status not in ('completed','cancelled','declined') or w.due_on>=today_on)
    order by coalesce(w.due_on,today_on),w.id limit 300) x));
end $fn$;
create or replace function public.workspace_lead_read(target_enquiry uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_lead_read(target_enquiry);$$;

-- A step's data, checked. Saved as a draft (done false) only the shape is checked; to tick it, what the step needs.
create or replace function private.workspace_lead_step_data(which text,d jsonb,done boolean,lead uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare x jsonb;n integer;
begin
 if jsonb_typeof(d) is distinct from 'object' then raise exception 'Check the step''s details' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(d) k where jsonb_typeof(k.value)='string' and length(k.value#>>'{}')>(case when k.key in ('notes','comments') then 5000 else 1000 end)) then
  raise exception 'Some of the text is too long' using errcode='22023';end if;
 if which='internal' then
  perform private.workspace_json_keys(d,array['rows','notes','noLocation'],200000);
  if d ? 'rows' and (jsonb_typeof(d->'rows')<>'array' or jsonb_array_length(d->'rows')>60) then raise exception 'Up to 60 properties in the internal analysis' using errcode='22023';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'rows','[]')) loop
   perform private.workspace_json_keys(x,array['propertyId','name','miles','occupancyBps','adrMinor','revenueMinor','trend','note'],4000);
   if coalesce(x->>'propertyId','')!~'^[0-9a-fA-F-]{36}$' or not exists(select 1 from public.workspace_properties p where p.id=(x->>'propertyId')::uuid) then raise exception 'One of the properties is not ours' using errcode='22023';end if;
   if jsonb_typeof(x->'miles') is distinct from 'number' or (x->>'miles')::numeric not between 0 and 30 then raise exception 'Only properties within 30 miles' using errcode='22023';end if;
   if exists(select 1 from unnest(array['occupancyBps','adrMinor','revenueMinor']) k where x ? k and jsonb_typeof(x->k) not in ('number','null')) then raise exception 'Check the figures' using errcode='22023';end if;
  end loop;
  if done and jsonb_array_length(coalesce(d->'rows','[]'))=0 and length(btrim(coalesce(d->>'notes','')))<3 then
   raise exception 'Add a note: with no properties listed, say what the analysis is based on' using errcode='22023';end if;
 elsif which='external' then
  perform private.workspace_json_keys(d,array['reportUrl','reportFileId','comparables','averageRateMinor','notes'],50000);
  if coalesce(d->>'reportUrl','')<>'' and d->>'reportUrl'!~'^https://[^/@[:space:]]+([/:?#]|$)' then raise exception 'The report link must start with https://' using errcode='22023';end if;
  if coalesce(d->>'reportFileId','')<>'' and not exists(select 1 from private.workspace_lead_files f where f.id::text=d->>'reportFileId' and f.enquiry_id=lead and f.removed_at is null) then
   raise exception 'Upload the report again' using errcode='22023';end if;
  if d ? 'comparables' and (jsonb_typeof(d->'comparables')<>'array' or jsonb_array_length(d->'comparables')>3) then raise exception 'Up to 3 comparables' using errcode='22023';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'comparables','[]')) loop
   perform private.workspace_json_keys(x,array['name','url','adrMinor']);
   perform private.workspace_required_text(x,'name',1,160);
   if private.workspace_required_text(x,'url',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' or coalesce(x->>'adrMinor','')!~'^\d{1,8}$' or (x->>'adrMinor')::bigint>10000000 then
    raise exception 'Check each comparable: a name, an https:// link and the nightly rate' using errcode='22023';end if;
  end loop;
  if d ? 'averageRateMinor' and jsonb_typeof(d->'averageRateMinor')<>'null' and (coalesce(d->>'averageRateMinor','')!~'^\d{1,8}$' or (d->>'averageRateMinor')::bigint not between 100 and 10000000) then
   raise exception 'Enter the average nightly rate, at least £1' using errcode='22023';end if;
  if done and coalesce(d->>'reportUrl','')='' and coalesce(d->>'reportFileId','')='' then raise exception 'Add the PriceLabs report: a link or the file' using errcode='22023';end if;
  if done and coalesce(d->>'averageRateMinor','')='' then raise exception 'Enter the average nightly rate' using errcode='22023';end if;
 elsif which='local' then
  perform private.workspace_json_keys(d,array['items','notes'],200000);
  if d ? 'items' and (jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items')>150) then raise exception 'Up to 150 items in the local area analysis' using errcode='22023';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'items','[]')) loop
   perform private.workspace_json_keys(x,array['kind','id','name','on','miles','place','note'],4000);
   if coalesce(x->>'kind','') not in ('event','repair','note') or length(btrim(coalesce(x->>'name','')))<1 then raise exception 'Check each item: what it is and its name' using errcode='22023';end if;
   if x ? 'miles' and jsonb_typeof(x->'miles')<>'null' and (jsonb_typeof(x->'miles')<>'number' or (x->>'miles')::numeric not between 0 and 30) then raise exception 'Only items within 30 miles' using errcode='22023';end if;
  end loop;
 elsif which='revenue' then
  perform private.workspace_json_keys(d,array['lowRateMinor','mediumRateMinor','highRateMinor','occupancyBps','directBookingBps','otaFeeBps','managementFeeBps','ownCosts','comments'],50000);
  if exists(select 1 from unnest(array['lowRateMinor','mediumRateMinor','highRateMinor']) k where d ? k and jsonb_typeof(d->k)<>'null' and (coalesce(d->>k,'')!~'^\d{1,8}$' or (d->>k)::bigint>10000000)) then
   raise exception 'Check the nightly rates' using errcode='22023';end if;
  if exists(select 1 from unnest(array['occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']) k where d ? k and jsonb_typeof(d->k)<>'null' and (coalesce(d->>k,'')!~'^\d{1,5}$' or (d->>k)::int>10000)) then
   raise exception 'Percentages are from 0 to 100' using errcode='22023';end if;
  if d ? 'ownCosts' and (jsonb_typeof(d->'ownCosts')<>'array' or jsonb_array_length(d->'ownCosts')>12) then raise exception 'Up to 12 of the owner''s own costs' using errcode='22023';end if;
  if done then
   if coalesce(d->>'lowRateMinor','')='' or coalesce(d->>'mediumRateMinor','')='' or coalesce(d->>'highRateMinor','')='' then raise exception 'Enter the low, medium and high nightly rates' using errcode='22023';end if;
   if (d->>'lowRateMinor')::bigint<100 then raise exception 'The low nightly rate must be at least £1' using errcode='22023';end if;
   if (d->>'mediumRateMinor')::bigint<(d->>'lowRateMinor')::bigint then raise exception 'The expected nightly rate must be at least the low nightly rate' using errcode='22023';end if;
   if (d->>'highRateMinor')::bigint<(d->>'mediumRateMinor')::bigint then raise exception 'The high nightly rate must be at least the expected nightly rate' using errcode='22023';end if;
  end if;
 else raise exception 'Choose an estimate step' using errcode='22023';
 end if;
 return d;
end $fn$;

-- The lead actions (through workspace_teams_action):
--   addLeadComment { requestId, enquiryId, text }                 a comment on the lead's thread
--   saveLeadStep   { requestId, enquiryId, step, data, done }     save a step (done ticks it, after the steps before it)
--   reopenLeadStep { requestId, enquiryId, step }                 untick a step and the steps after it
-- Each returns the lead's state (steps, files, activity).
create or replace function private.workspace_lead_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;s private.workspace_lead_steps;txt text;event_id bigint;hearers uuid[];idx integer;done boolean;d jsonb;
 order_of constant text[]:=array['internal','external','local','revenue','submit'];
 label_of constant text[]:=array['Internal Analysis','External Analysis','Local Area Analysis','Estimated Revenue','Submit Estimate'];
 verb_of constant text[]:=array['approved','submitted','approved','submitted','submitted'];
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if a is null or a not in ('addLeadComment','saveLeadStep','reopenLeadStep') then raise exception 'Unknown lead action' using errcode='22023';end if;
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
   done:=(input->>'done')::boolean;
   d:=private.workspace_lead_step_data(order_of[idx],input->'data',done,e.id);
   if done and exists(select 1 from unnest(order_of[1:idx-1]) k where not exists(select 1 from private.workspace_lead_steps x where x.enquiry_id=e.id and x.lead_step=k and x.ticked_at is not null)) then
    raise exception 'Finish the steps before this one first' using errcode='22023';end if;
   insert into private.workspace_lead_steps(enquiry_id,lead_step,step_data,saved_by,saved_at,ticked_by,ticked_at)
    values(e.id,order_of[idx],d,auth.uid(),now(),case when done then auth.uid() end,case when done then now() end)
    on conflict(enquiry_id,lead_step) do update set step_data=excluded.step_data,saved_by=excluded.saved_by,saved_at=excluded.saved_at,ticked_by=excluded.ticked_by,ticked_at=excluded.ticked_at;
   if done then insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event',verb_of[idx]||' '||label_of[idx],auth.uid());end if;
  else
   perform private.workspace_json_keys(input,array['action','requestId','enquiryId','step']);
   if s.ticked_at is null then raise exception 'This step is not done yet' using errcode='22023';end if;
   update private.workspace_lead_steps x set ticked_at=null,ticked_by=null where x.enquiry_id=e.id and x.ticked_at is not null and array_position(order_of,x.lead_step)>=idx;
   insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','reopened '||label_of[idx],auth.uid());
  end if;
 end if;

 result:=private.workspace_lead_state(e.id);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- Publishing an estimate (the existing publishEstimate, which emails the client and tells them in the app) ticks Submit
-- Estimate on the property's lead once its four steps before are ticked. Nothing else changes.
create or replace function private.workspace_lead_estimate_published(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries;
begin
 for e in select * from private.workspace_client_enquiries x where x.property_id=prop and x.status<>'closed' loop
  continue when (select count(*) from private.workspace_lead_steps s where s.enquiry_id=e.id and s.lead_step in ('internal','external','local','revenue') and s.ticked_at is not null)<4;
  insert into private.workspace_lead_steps(enquiry_id,lead_step,step_data,saved_by,saved_at,ticked_by,ticked_at)
   values(e.id,'submit',jsonb_build_object('estimate',(select j.estimate from private.workspace_journeys j where j.property_id=prop)),auth.uid(),now(),auth.uid(),now())
   on conflict(enquiry_id,lead_step) do update set step_data=excluded.step_data,saved_by=excluded.saved_by,saved_at=excluded.saved_at,ticked_by=excluded.ticked_by,ticked_at=excluded.ticked_at;
  insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','submitted the estimate to the client',auth.uid());
 end loop;
end $fn$;

-- The PriceLabs report as a file, for the server's file route (it stores the bytes; the database decides who may).
--   { action: 'addFile', enquiryId, fileId, path, name, mime, bytes }   returns the lead's state
--   { action: 'removeFile', enquiryId, fileId }                          returns { path } for the server to delete
create or replace function private.workspace_lead_file_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries;f private.workspace_lead_files;
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if coalesce(input->>'enquiryId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(input->>'fileId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'File not found' using errcode='P0002';end if;
 select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
 if e.id is null then raise exception 'Lead not found' using errcode='P0002';end if;
 if input->>'action'='addFile' then
  perform private.workspace_json_keys(input,array['action','enquiryId','fileId','path','name','mime','bytes']);
  if (select count(*) from private.workspace_lead_files x where x.enquiry_id=e.id and x.removed_at is null)>=10 then raise exception 'Up to 10 files on a lead' using errcode='22023';end if;
  if input->>'path' is distinct from 'leads/'||e.id::text||'/'||lower(input->>'fileId')||'.'||split_part(input->>'path','.',2) or jsonb_typeof(input->'bytes') is distinct from 'number' then raise exception 'Invalid file' using errcode='22023';end if;
  insert into private.workspace_lead_files(id,enquiry_id,path,name,mime,bytes,created_by)
   values((input->>'fileId')::uuid,e.id,input->>'path',left(coalesce(nullif(btrim(input->>'name'),''),'Report'),200),input->>'mime',(input->>'bytes')::bigint,auth.uid());
  insert into private.workspace_lead_activity(enquiry_id,kind,body,created_by) values(e.id,'event','added the file '||left(coalesce(nullif(btrim(input->>'name'),''),'Report'),200),auth.uid());
  return private.workspace_lead_state(e.id);
 elsif input->>'action'='removeFile' then
  perform private.workspace_json_keys(input,array['action','enquiryId','fileId']);
  update private.workspace_lead_files x set removed_at=now() where x.id=(input->>'fileId')::uuid and x.enquiry_id=e.id and x.removed_at is null returning * into f;
  if f.id is null then raise exception 'File not found' using errcode='P0002';end if;
  return jsonb_build_object('path',f.path);
 end if;
 raise exception 'Unknown file action' using errcode='22023';
end $fn$;
create or replace function private.workspace_lead_file(target_enquiry uuid,file uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare f private.workspace_lead_files;
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 select * into f from private.workspace_lead_files x where x.id=file and x.enquiry_id=target_enquiry and x.removed_at is null;
 if f.id is null then raise exception 'File not found' using errcode='P0002';end if;
 return jsonb_build_object('path',f.path,'name',f.name,'mime',f.mime);
end $fn$;
create or replace function public.workspace_lead_file_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_lead_file_action(input);$$;
create or replace function public.workspace_lead_file(target_enquiry uuid,file uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_lead_file(target_enquiry,file);$$;

revoke all on function private.workspace_lead_property_stats(uuid,date),private.workspace_lead_state(uuid),private.workspace_lead_step_data(text,jsonb,boolean,uuid),
 private.workspace_lead_action(jsonb),private.workspace_lead_estimate_published(uuid) from public,anon,authenticated,service_role;
-- The read and the file functions are what the signed-in team calls (each checks who is asking).
revoke all on function private.workspace_lead_read(uuid),public.workspace_lead_read(uuid),private.workspace_lead_file_action(jsonb),public.workspace_lead_file_action(jsonb),
 private.workspace_lead_file(uuid,uuid),public.workspace_lead_file(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.workspace_lead_read(uuid),public.workspace_lead_read(uuid),private.workspace_lead_file_action(jsonb),public.workspace_lead_file_action(jsonb),
 private.workspace_lead_file(uuid,uuid),public.workspace_lead_file(uuid,uuid) to authenticated;

do $patch$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  -- A new estimate takes up to 3 comparables (the ceiling of 20 from 20261020400000 stays in the text, so that patch still
  -- finds itself done). Estimates already saved with more are not touched.
  ['private.workspace_journey_action(jsonb)',
   $q$jsonb_array_length(input->'comparables')>20 then raise exception 'Invalid estimate'$q$,
   $q$jsonb_array_length(input->'comparables')>3/* estimate comparables three: 20261025300000 */ or jsonb_array_length(input->'comparables')>20 then raise exception 'Invalid estimate'$q$,
   $q$/* estimate comparables three: 20261025300000 */$q$],
  -- Publishing ticks Submit Estimate on the lead, once its four steps before are ticked.
  ['private.workspace_journey_action(jsonb)',
   $q$update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;$q$,
   $q$update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;
   perform private.workspace_lead_estimate_published(target);/* lead estimate delivery: 20261025300000 */$q$,
   $q$/* lead estimate delivery: 20261025300000 */$q$],
  -- The lead actions.
  ['private.workspace_teams_action(jsonb)',
   $q$if a='deleteEnquiry' then return private.workspace_client_enquiry_delete(input);end if;$q$,
   $q$if a in ('addLeadComment','saveLeadStep','reopenLeadStep')/* lead actions: 20261025300000 */ then return private.workspace_lead_action(input);end if; if a='deleteEnquiry' then return private.workspace_client_enquiry_delete(input);end if;$q$,
   $q$/* lead actions: 20261025300000 */$q$]
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
