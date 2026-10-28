-- Launch Preparation, round two (Business Plan v1.0, 17/10/26):
--  * Safety compliance: each document's certificate is uploaded with its expiry date (an admin setting can make the upload
--    optional). A document can be renewed at any time by ticking it again with the new certificate and expiry date.
--    Some months before it expires (an admin setting, 3 by default) the owner is reminded in the property's chat and a
--    renewal ticket goes on the safety board; renewing the document completes that ticket.
--  * Board tickets: each of Recharge's parts opens a mirrored ticket on its task board when the part opens. Ticking either
--    one completes both, and reopening the part reopens the ticket. Which board each section uses is an admin setting
--    (blank for none). Parts that already raise their own onboarding tickets (set-up and furnishing, garden, the
--    housekeeper and licensing) and the listing (its own approval queue) get none.
-- New tables, triggers and functions; the Launch Preparation functions from 20261029100000 are replaced. Safe to run twice.

-- 1. Settings: the new defaults (stored settings keep theirs).
create or replace function private.workspace_launch_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select $json${
  "condition":[
   {"key":"keyboxes","title":"Keyboxes","text":"Both keyboxes open and close with ease and have keys inside."},
   {"key":"walls","title":"Walls, ceilings and paintwork","text":"Walls and ceilings are free from noticeable scuffs, stains, cracks, peeling paint, damp and mould. Any decorating or touch-ups have been completed neatly."},
   {"key":"floors","title":"Floors and carpets","text":"Floors and carpets are clean and free from stains, damage, loose flooring, lifting edges and trip hazards."},
   {"key":"doors","title":"Doors, windows and locks","text":"Doors and windows open, close and lock correctly. Handles are secure, glass is undamaged, seals are in good condition, and all keys have been tested."},
   {"key":"furniture","title":"Furniture","text":"Furniture is clean, stable and in good condition, with no loose legs, broken drawers, torn upholstery, sharp edges or visible damage."},
   {"key":"beds","title":"Beds and mattresses","text":"Bed frames are secure, with no broken slats or excessive creaking. Mattresses are clean and free from stains, odours and excessive sagging. Sofa beds open and close correctly."},
   {"key":"linen","title":"Linen and soft furnishings","text":"Bedding, towels, cushions and curtains are clean and free from stains, tears and excessive wear. Blinds, curtain rails and fittings are secure and work correctly."},
   {"key":"kitchen","title":"Kitchen surfaces and fittings","text":"Worktops, cupboards, handles and splashbacks are clean and undamaged. Doors and drawers work correctly, and sealant and grout are in good condition."},
   {"key":"appliances","title":"Appliances","text":"The fridge, freezer, oven, hob, extractor, microwave, kettle, toaster and laundry appliances have been tested where provided. All are clean and working, with no leaks, unusual noises, mould or unpleasant smells."},
   {"key":"bathrooms","title":"Bathrooms and plumbing","text":"Toilets flush and refill correctly. Taps and showers work properly, and sinks, baths and showers drain freely. There are no leaks, loose fittings, damaged seals, mould or excessive limescale."},
   {"key":"heating","title":"Heating, hot water and ventilation","text":"Heating and controls work correctly, hot water reaches all relevant outlets and extractor fans operate. There are no visible leaks or signs of persistent condensation."},
   {"key":"lighting","title":"Lighting and visible electrics","text":"Lights and switches work correctly. Lampshades and light fittings are secure. There is no visible damage to sockets, plugs or cables."},
   {"key":"wifi","title":"Wi-Fi, TV and guest controls","text":"Wi-Fi and TV functions have been tested. Remotes work, batteries have sufficient power and guest instructions match the equipment provided."},
   {"key":"safety","title":"Safety and access","text":"Alarm checks have been completed according to manufacturer instructions. Safety equipment is undamaged and accessible, exit routes are clear, and entrances, stairs and handrails are secure."},
   {"key":"exterior","title":"Exterior and communal approach","text":"The entrance and communal approach are tidy, paths are clear, outdoor furniture is stable, the garden is presentable and bins are clean and not overflowing."},
   {"key":"presentation","title":"Final presentation","text":"The property is free from dust, hair, rubbish, unpleasant odours and belongings left by previous guests. Furniture is arranged neatly, and all repair or installation work has been fully cleaned up."}
  ],
  "notes":{
   "setUp":"The property has all the right inventory and is in a rentable condition.",
   "housekeeper":"The housekeeper looks after the property between stays and carries out the readiness inspection.",
   "readiness":"The first changeover: the housekeeper checks the inventory and every condition statement and records a video.",
   "photography":"Booked once the property is guest ready. The photos go on the listing.",
   "guidebook":"The guest guidebook, created once the property is guest ready.",
   "pricing":"Once the listing is in Hostaway: synced to PriceLabs with the minimum stay, minimum price and base price set.",
   "social":"A coming soon post once the photos are in, and a second post once the property is live."
  },
  "requireVideo":true,
  "requireComplianceFile":true,
  "reminderMonths":3,
  "boards":{"compliance":"safety-maintenance","broadband":"new-property-inspection-board","readiness":"new-property-inspection-board",
   "guidebook":"new-property-inspection-board","pricing":"daily-pricing","social":"listing-health","photography":"listing-health","waste":"routine-bin-garden-board"}
 }$json$::jsonb
$fn$;

-- 2. Certificates, reminders and the mirrored tickets.
create table if not exists private.workspace_launch_files (
 id uuid primary key,
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 step text not null check (step~'^compliance:[a-z0-9-]{1,40}$'),
 path text not null unique check (char_length(path) between 10 and 300),
 name text not null check (char_length(name) between 1 and 200),
 mime text not null check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
 bytes bigint not null check (bytes>=0),
 uploaded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists workspace_launch_files_step on private.workspace_launch_files(property_id,step);
create table if not exists private.workspace_launch_reminders (
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 step text not null,
 expires_on date not null,
 work_id uuid references public.workspace_work_items(id) on delete set null,
 sent_at timestamptz not null default now(),
 primary key (property_id,step,expires_on)
);
create table if not exists private.workspace_launch_tickets (
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 step text not null,
 work_id uuid not null unique references public.workspace_work_items(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (property_id,step)
);
alter table private.workspace_launch_files enable row level security;
alter table private.workspace_launch_reminders enable row level security;
alter table private.workspace_launch_tickets enable row level security;
revoke all on private.workspace_launch_files,private.workspace_launch_reminders,private.workspace_launch_tickets from public,anon,authenticated,service_role;
-- A removed certificate leaves storage too.
create or replace function private.workspace_launch_file_gone() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by)
  select 'lead-files',old.path,'launch_file.deleted',(select p.user_id from public.workspace_profiles p where p.user_id=auth.uid());
 return old;
end $fn$;
drop trigger if exists workspace_launch_file_gone on private.workspace_launch_files;
create trigger workspace_launch_file_gone after delete on private.workspace_launch_files for each row execute function private.workspace_launch_file_gone();

-- 3. Reading, checking and the actions (replacing 20261029100000's).
create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 select * into r from private.workspace_launch_readiness where property_id=prop;
 team:=coalesce(actor is not null and private.workspace_can_enquiries(),false);
 owner:=coalesce(j.client_id=auth.uid(),false);
 keeper:=coalesce(actor='cleans' and r.housekeeper_id=auth.uid(),false);
 if j.property_id is null or not (team or owner or keeper) then raise exception 'Property not found' using errcode='42501';end if;
 select * into p from public.workspace_properties where id=prop;
 plan:=private.workspace_launch_plan(prop);
 if plan is null then return jsonb_build_object('propertyId',prop,'steps',null);end if;
 hk:=(select d.cleaner_id from private.workspace_default_cleaners d join public.workspace_profiles x on x.user_id=d.cleaner_id where d.property_id=prop and x.status='active' and x.role='cleans');
 pre:=coalesce((select s->>'state' from jsonb_array_elements(plan) s where s->>'key'='readiness.inspection') in ('todo','done'),false);
 -- What each person can tick: the team, any part ticked by hand; the owner, their own parts.
 steps:=(select jsonb_agg(s||jsonb_build_object('canTick',(s->>'manual')::boolean and (s->>'state'='todo' or (s->>'kind'='expiry' and s->>'state'='done')) and (team or (owner and s->>'who'='client')),
   'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'uploadedAt',f.created_at) order by f.created_at desc,f.id)
    from private.workspace_launch_files f where f.property_id=prop and f.step=s->>'key'),'[]'),
   'ticketId',(select t.work_id from private.workspace_launch_tickets t where t.property_id=prop and t.step=s->>'key'),
   'canReopen',team and (s->>'manual')::boolean and s->>'state'='done' and (r.submitted_at is null or s->>'section' not in ('setUp','broadband','utilities','compliance','licensing','housekeeper'))))
  from jsonb_array_elements(plan) s);
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isOwner',owner,'isHousekeeper',keeper,
  'canAllocate',team and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live'),
  'canBookReadiness',team and pre and hk is not null and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked'),
  'canSubmitReadiness',(team or keeper) and r.property_id is not null and r.submitted_at is null and r.booked_on<=today and j.stage='inspection_booked');
end $fn$;


create or replace function private.workspace_launch_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();st private.workspace_launch_settings;team boolean;begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 team:=coalesce(private.workspace_can_enquiries(),false);
 select * into st from private.workspace_launch_settings where singleton;
 return jsonb_build_object('settings',private.workspace_launch_settings(),'canEditSettings',actor in ('admin','super_admin'),
  'settingsUpdatedAt',st.updated_at,
  'boardIds',case when actor in ('admin','super_admin') then coalesce((select jsonb_agg(f.module_id order by f.module_id) from public.workspace_features f),'[]') else '[]' end,'settingsUpdatedByName',private.workspace_launch_person(st.updated_by),
  -- Who can be the housekeeper: active housekeeping users.
  'housekeepers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Housekeeper')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role='cleans'),'[]') else '[]' end,
  -- A housekeeper's readiness inspections still to do.
  'inspections',coalesce((select jsonb_agg(jsonb_build_object('propertyId',r.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookedOn',r.booked_on) order by r.booked_on,r.property_id)
   from private.workspace_launch_readiness r join public.workspace_properties p on p.id=r.property_id join private.workspace_journeys j on j.property_id=r.property_id
   where r.housekeeper_id=auth.uid() and actor='cleans' and r.submitted_at is null and j.stage='inspection_booked'),'[]'),
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;


create or replace function private.workspace_launch_check(kind text,d jsonb,prop uuid,part_key text) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare st jsonb:=private.workspace_launch_settings();keys text[];begin
 if d is null then d:='{}';end if;
 if jsonb_typeof(d)<>'object' then raise exception 'Invalid details' using errcode='22023';end if;
 if kind='tick' then
  perform private.workspace_json_keys(d,array['note']);
  if jsonb_typeof(coalesce(d->'note','""')) <>'string' or char_length(coalesce(d->>'note',''))>1000 then raise exception 'Up to 1,000 characters in the note' using errcode='22023';end if;
  return jsonb_strip_nulls(jsonb_build_object('note',nullif(btrim(coalesce(d->>'note','')),'')));
 elsif kind='date' then
  perform private.workspace_json_keys(d,array['on','access']);
  if coalesce(d->>'on','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the inspection date' using errcode='22023';end if;
  perform (d->>'on')::date;
  if jsonb_typeof(d->'access') is distinct from 'string' or char_length(btrim(d->>'access'))<3 or char_length(d->>'access')>2000 then raise exception 'Say how to get into the property' using errcode='22023';end if;
  return jsonb_build_object('on',d->>'on','access',btrim(d->>'access'));
 elsif kind='condition' then
  perform private.workspace_json_keys(d,array['ticks']);
  keys:=array(select x->>'key' from jsonb_array_elements(st->'condition') x);
  if jsonb_typeof(d->'ticks') is distinct from 'array' or exists(select 1 from unnest(keys) k where not (d->'ticks') ? k) then
   raise exception 'Tick every condition statement. Anything that cannot be ticked goes to property maintenance first.' using errcode='22023';end if;
  return jsonb_build_object('ticks',to_jsonb(keys));
 elsif kind='expiry' then
  perform private.workspace_json_keys(d,array['expiresOn']);
  if coalesce(d->>'expiresOn','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the expiry date' using errcode='22023';end if;
  if (d->>'expiresOn')::date<=private.workspace_launch_today() then raise exception 'This document has expired. Renew it first.' using errcode='22023';end if;
  if coalesce((st->>'requireComplianceFile')::boolean,true) and not exists(select 1 from private.workspace_launch_files f where f.property_id=prop and f.step=part_key) then
   raise exception 'Upload the certificate first' using errcode='22023';end if;
  return jsonb_build_object('expiresOn',d->>'expiresOn');
 elsif kind='licence' then
  perform private.workspace_json_keys(d,array['required','number']);
  if jsonb_typeof(d->'required') is distinct from 'boolean' then raise exception 'Say whether the property needs a licence' using errcode='22023';end if;
  if (d->>'required')::boolean and (jsonb_typeof(d->'number') is distinct from 'string' or char_length(btrim(d->>'number')) not between 2 and 120) then raise exception 'Enter the licence number' using errcode='22023';end if;
  return jsonb_build_object('required',(d->>'required')::boolean,'number',case when (d->>'required')::boolean then btrim(d->>'number') end);
 end if;
 raise exception 'This part is ticked by the app' using errcode='22023';
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Choose a real date' using errcode='22023';
end $fn$;


create or replace function private.workspace_launch_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;j private.workspace_journeys;
 r private.workspace_launch_readiness;s jsonb;x jsonb;keys text[];hk uuid;day date;n integer:=0;crosses text[]:='{}';missing text[]:='{}';ev bigint;video text;c text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data','housekeeperId','date','inventory','condition','evidence','settings','fileId','name','mime','bytes','path'],60000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings'],60000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change Launch Preparation' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['condition','notes','requireVideo','requireComplianceFile','reminderMonths','boards'],60000);
  if jsonb_typeof(s->'condition') is distinct from 'array' or jsonb_array_length(s->'condition') not between 1 and 30 then raise exception 'Keep between 1 and 30 condition statements' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(s->'condition') loop
   perform private.workspace_json_keys(x,array['key','title','text']);
   if coalesce(x->>'key','')!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 120
    or jsonb_typeof(x->'text') is distinct from 'string' or char_length(btrim(x->>'text')) not between 1 and 1000 then raise exception 'Give every condition statement a title and its wording' using errcode='22023';end if;
  end loop;
  if (select count(distinct z->>'key') from jsonb_array_elements(s->'condition') z)<>jsonb_array_length(s->'condition') then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(s->'notes') is distinct from 'object' or exists(select 1 from jsonb_each(s->'notes') n where n.key not in
   ('setUp','broadband','utilities','compliance','licensing','housekeeper','readiness','photography','garden','waste','guidebook','listing','pricing','social')
   or jsonb_typeof(n.value)<>'string' or char_length(n.value#>>'{}')>1000) then raise exception 'Up to 1,000 characters in each note' using errcode='22023';end if;
  if jsonb_typeof(s->'requireVideo') is distinct from 'boolean' or jsonb_typeof(s->'requireComplianceFile') is distinct from 'boolean'
   or jsonb_typeof(s->'reminderMonths') is distinct from 'number' or (s->>'reminderMonths')::numeric not in (1,2,3,4,5,6) then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(s->'boards') is distinct from 'object' or exists(select 1 from jsonb_each(s->'boards') b where b.key not in
   ('setUp','broadband','utilities','compliance','licensing','housekeeper','readiness','photography','garden','waste','guidebook','listing','pricing','social')
   or jsonb_typeof(b.value)<>'string' or (b.value#>>'{}'<>'' and not exists(select 1 from public.workspace_features f where f.module_id=b.value#>>'{}'))) then raise exception 'Choose a board for each part' using errcode='22023';end if;
  s:=jsonb_build_object('condition',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'text',btrim(z->>'text'))) from jsonb_array_elements(s->'condition') z),
   'notes',(select coalesce(jsonb_object_agg(n.key,btrim(n.value#>>'{}')),'{}') from jsonb_each(s->'notes') n),'requireVideo',s->'requireVideo',
   'requireComplianceFile',s->'requireComplianceFile','reminderMonths',(s->>'reminderMonths')::integer,'boards',s->'boards');
  update private.workspace_launch_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_launch_read(null);
 elsif input->>'action' in ('tick','reopen','allocate','bookReadiness','submitReadiness','addFile','removeFile') then
  begin prop:=(input->>'propertyId')::uuid; exception when others then raise exception 'Property not found' using errcode='42501'; end;
  select * into j from private.workspace_journeys where property_id=prop for update;
  view:=private.workspace_launch_view(prop);
  if view->'steps' is null or jsonb_typeof(view->'steps')<>'array' then raise exception 'Launch Preparation follows the onboarding package' using errcode='22023';end if;
  select * into r from private.workspace_launch_readiness where property_id=prop;
  if input->>'action' in ('tick','reopen') then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data'],60000);
   part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'=input->>'step');
   if part is null then raise exception 'Unknown part of the checklist' using errcode='22023';end if;
   if input->>'action'='tick' then
    if not (part->>'canTick')::boolean then
     raise exception '%',case when not (part->>'manual')::boolean then 'This part is ticked by the app' when part->>'state'='locked' then part->>'lockedBecause'
      when part->>'state'='done' then 'Already ticked' when (view->>'isOwner')::boolean then 'Recharge ticks this part' else 'Not yours to tick' end using errcode='22023';end if;
    -- A safety document is renewed by ticking it again with the new certificate and expiry date.
    insert into private.workspace_launch_steps(property_id,step,data,done_by,done_at) values(prop,part->>'key',private.workspace_launch_check(part->>'kind',input->'data',prop,part->>'key'),me,now())
     on conflict(property_id,step) do update set data=excluded.data,done_by=excluded.done_by,done_at=excluded.done_at;
    -- The owner hears when Recharge ticks one of the owner's parts for them, or Recharge's set-up inspection is booked.
    if part->>'key'='setUp.inspection' then
     perform private.workspace_property_chat_post(prop,'Your set-up inspection is booked for '||to_char(((input->'data')->>'on')::date,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
    end if;
   else
    if not (part->>'canReopen')::boolean then raise exception 'This part cannot be reopened' using errcode='22023';end if;
    delete from private.workspace_launch_steps where property_id=prop and private.workspace_launch_steps.step=part->>'key';
    update public.workspace_work_items w set status='waiting',completed_at=null,version=w.version+1,updated_at=now()
     from private.workspace_launch_tickets t where t.property_id=prop and t.step=part->>'key' and w.id=t.work_id and w.status='completed';
   end if;
  elsif input->>'action' in ('addFile','removeFile') then
   -- A certificate for a safety document: stored by the server (private "lead-files" bucket, under launch/), then recorded.
   part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'=input->>'step');
   if part is null or part->>'kind'<>'expiry' then raise exception 'Certificates go with a safety document' using errcode='22023';end if;
   if not (part->>'canTick')::boolean and not (part->>'canReopen')::boolean then
    raise exception '%',coalesce(part->>'lockedBecause','Recharge looks after this document') using errcode='22023';end if;
   if input->>'action'='addFile' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','fileId','name','mime','bytes','path']);
    if (select count(*) from private.workspace_launch_files f where f.property_id=prop and f.step=part->>'key')>=10 then raise exception 'Up to 10 files for each document' using errcode='22023';end if;
    if coalesce(input->>'mime','') not in ('application/pdf','image/jpeg','image/png','image/webp') or coalesce(input->>'fileId','')!~'^[0-9a-fA-F-]{36}$'
     or coalesce(input->>'path','')<>'launch/'||prop||'/'||(input->>'fileId')||'.'||(case input->>'mime' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end)
     or coalesce(input->>'bytes','')!~'^\d{1,9}$' then raise exception 'Invalid file' using errcode='22023';end if;
    insert into private.workspace_launch_files(id,property_id,step,path,name,mime,bytes,uploaded_by)
     values((input->>'fileId')::uuid,prop,part->>'key',input->>'path',left(coalesce(nullif(btrim(input->>'name'),''),'Certificate'),200),input->>'mime',(input->>'bytes')::bigint,me);
   else
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','fileId']);
    begin delete from private.workspace_launch_files f where f.id=(input->>'fileId')::uuid and f.property_id=prop and f.step=part->>'key' returning f.path into video;
    exception when invalid_text_representation then video:=null; end;
    if video is null then raise exception 'File not found' using errcode='22023';end if;
   end if;
  elsif input->>'action'='allocate' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','housekeeperId']);
   if not (view->>'canAllocate')::boolean then raise exception 'The housekeeper is allocated once the onboarding fee is settled' using errcode='22023';end if;
   begin hk:=(input->>'housekeeperId')::uuid; exception when others then hk:=null; end;
   if hk is null or not exists(select 1 from public.workspace_profiles p where p.user_id=hk and p.status='active' and p.role='cleans') then raise exception 'Choose an active housekeeper' using errcode='22023';end if;
   insert into private.workspace_default_cleaners(property_id,cleaner_id,updated_by,updated_at) values(prop,hk,me,now())
    on conflict(property_id) do update set cleaner_id=excluded.cleaner_id,updated_by=me,updated_at=now();
   update private.workspace_launch_readiness set housekeeper_id=hk where property_id=prop and submitted_at is null;
  elsif input->>'action'='bookReadiness' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','date']);
   if not (view->>'canBookReadiness')::boolean then
    raise exception '%',case when view->'housekeeper' is null or jsonb_typeof(view->'housekeeper')='null' then 'Allocate the housekeeper first' else 'The readiness inspection opens once everything above it is done' end using errcode='22023';end if;
   begin day:=(input->>'date')::date; exception when others then raise exception 'Choose the inspection date' using errcode='22023'; end;
   if day is null or day not between private.workspace_launch_today() and private.workspace_launch_today()+365 then raise exception 'Choose a date from today, within the next year' using errcode='22023';end if;
   hk:=(view#>>'{housekeeper,id}')::uuid;
   insert into private.workspace_launch_readiness(property_id,booked_on,housekeeper_id,booked_by,booked_at) values(prop,day,hk,me,now())
    on conflict(property_id) do update set booked_on=day,housekeeper_id=hk,booked_by=me,booked_at=now();
   perform set_config('recharge.launch','on',true);
   update private.workspace_journeys set inspection_on=day,stage='inspection_booked',version=version+1,updated_at=now() where property_id=prop;
   perform set_config('recharge.launch','',true);
   -- A new day for an inspection already booked: the owner hears (a first booking is announced by the stage change).
   if j.stage='inspection_booked' then
    perform private.workspace_property_chat_post(prop,'Your readiness inspection has moved to '||to_char(day,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
   end if;
   insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(me,prop,'launch.readiness_booked',now()) returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id) values(hk,ev) on conflict do nothing;
  else
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','inventory','condition','evidence'],60000);
   if not (view->>'canSubmitReadiness')::boolean then
    raise exception '%',case when r.property_id is null then 'Book the readiness inspection first' when r.submitted_at is not null then 'Already submitted'
     when r.booked_on>private.workspace_launch_today() then 'The form opens on the inspection day' else 'Only the housekeeper or the team can submit this' end using errcode='42501';end if;
   s:=private.workspace_launch_settings();
   -- Inventory: everything present, or what is missing.
   x:=input->'inventory';
   if jsonb_typeof(x) is distinct from 'object' then raise exception 'Confirm the inventory' using errcode='22023';end if;
   perform private.workspace_json_keys(x,array['allPresent','missing']);
   if jsonb_typeof(x->'allPresent') is distinct from 'boolean' or jsonb_typeof(coalesce(x->'missing','[]')) <>'array' or jsonb_array_length(coalesce(x->'missing','[]'))>50
    or exists(select 1 from jsonb_array_elements(coalesce(x->'missing','[]')) m where jsonb_typeof(m)<>'string' or char_length(btrim(m#>>'{}')) not between 1 and 200) then raise exception 'Confirm the inventory' using errcode='22023';end if;
   missing:=array(select btrim(m) from jsonb_array_elements_text(coalesce(x->'missing','[]')) m);
   if not (x->>'allPresent')::boolean and cardinality(missing)=0 then raise exception 'List what is missing from the inventory' using errcode='22023';end if;
   if (x->>'allPresent')::boolean then missing:='{}';end if;
   -- Condition: every statement ticked, or crossed with what is wrong.
   keys:=array(select z->>'key' from jsonb_array_elements(s->'condition') z);
   if jsonb_typeof(input->'condition') is distinct from 'array' or jsonb_array_length(input->'condition')<>cardinality(keys) then raise exception 'Tick or cross every condition statement' using errcode='22023';end if;
   for x in select * from jsonb_array_elements(input->'condition') loop
    perform private.workspace_json_keys(x,array['key','ok','note']);
    if not (x->>'key'=any(keys)) or jsonb_typeof(x->'ok') is distinct from 'boolean' or jsonb_typeof(coalesce(x->'note','""'))<>'string' or char_length(coalesce(x->>'note',''))>1000 then
     raise exception 'Tick or cross every condition statement' using errcode='22023';end if;
    if not (x->>'ok')::boolean then
     if char_length(btrim(coalesce(x->>'note','')))<3 then raise exception 'Say what is wrong for each crossed statement' using errcode='22023';end if;
     crosses:=crosses||((select z->>'title' from jsonb_array_elements(s->'condition') z where z->>'key'=x->>'key')||': '||btrim(x->>'note'));
    end if;
   end loop;
   if (select count(distinct z->>'key') from jsonb_array_elements(input->'condition') z)<>cardinality(keys) then raise exception 'Tick or cross every condition statement' using errcode='22023';end if;
   -- Evidence: the changeover video and anything else to say.
   x:=input->'evidence';
   if jsonb_typeof(x) is distinct from 'object' then raise exception 'Add the changeover video' using errcode='22023';end if;
   perform private.workspace_json_keys(x,array['video','note']);
   video:=btrim(coalesce(x->>'video',''));
   if jsonb_typeof(coalesce(x->'video','""'))<>'string' or jsonb_typeof(coalesce(x->'note','""'))<>'string' or char_length(coalesce(x->>'note',''))>2000
    or (video<>'' and (video!~'^https://[^\s@/]+(/\S*)?$' or char_length(video)>1000)) then raise exception 'The video link must start with https://' using errcode='22023';end if;
   if video='' and coalesce((s->>'requireVideo')::boolean,true) then raise exception 'Add the link to the changeover video' using errcode='22023';end if;
   for c in select unnest(crosses) loop
    perform private.workspace_launch_repair(prop,'Readiness inspection: '||c);n:=n+1;
   end loop;
   if cardinality(missing)>0 then perform private.workspace_launch_repair(prop,'Readiness inspection, missing from the inventory: '||array_to_string(missing,', '));n:=n+1;end if;
   update private.workspace_launch_readiness set submitted_at=now(),submitted_by=me,inventory=jsonb_build_object('allPresent',cardinality(missing)=0,'missing',to_jsonb(missing)),
    condition=input->'condition',evidence=jsonb_build_object('video',nullif(btrim(coalesce(input#>>'{evidence,video}','')),''),'note',btrim(coalesce(input#>>'{evidence,note}',''))),issues=n where property_id=prop;
   perform set_config('recharge.launch','on',true);
   update private.workspace_journeys set stage='inspection_complete',inspection_completed_at=now(),
    inspection_report='Readiness inspection by '||coalesce(private.workspace_launch_person(me),'the housekeeper')||case when n=0 then ': guest ready, no issues.' else ': '||n||' issue'||case when n=1 then '' else 's' end||' sent to property maintenance.' end,
    inspection_checks=jsonb_build_object('readiness',true,'issues',n),version=version+1,updated_at=now() where property_id=prop;
   perform set_config('recharge.launch','',true);
   update public.workspace_work_items w set status='completed',completed_at=now(),version=version+1 where w.property_id=prop and w.status<>'completed'
    and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and d.kind='inspection');
   perform private.workspace_followup_note(prop,'Readiness inspection submitted'||case when n=0 then ', no issues' else ', '||n||' sent to property maintenance' end||'. The property is guest ready: photography is next.',me);
   perform private.workspace_followup_tell(prop,'launch.guest_ready',now());
  end if;
  perform private.workspace_launch_sync(prop);
  result:=private.workspace_launch_read(prop);
 else
  raise exception 'Unknown Launch Preparation action' using errcode='22023';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- A certificate to open (the server signs a short link): anyone who can see the checklist.
create or replace function private.workspace_launch_file(prop uuid,file uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare f private.workspace_launch_files;begin
 perform private.workspace_launch_view(prop);
 select * into f from private.workspace_launch_files x where x.id=file and x.property_id=prop;
 if f.id is null then raise exception 'File not found' using errcode='22023';end if;
 return jsonb_build_object('path',f.path,'name',f.name,'mime',f.mime);
end $fn$;
create or replace function public.workspace_launch_file(prop uuid,file uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_launch_file(prop,file);$$;

-- 4. The mirrored tickets. Each of Recharge's open parts gets one ticket on its section's board; a done part completes it.
create or replace function private.workspace_launch_sync(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare plan jsonb;s jsonb;boards jsonb;board text;place text;w uuid;begin
 plan:=private.workspace_launch_plan(prop);
 if plan is null then return;end if;
 perform pg_advisory_xact_lock(hashtext('workspace_launch_sync:'||prop));
 boards:=coalesce(private.workspace_launch_settings()->'boards','{}');
 place:=coalesce((select nullif(btrim(p.name),'') from public.workspace_properties p where p.id=prop),'Property');
 for s in select * from jsonb_array_elements(plan) loop
  w:=(select t.work_id from private.workspace_launch_tickets t where t.property_id=prop and t.step=s->>'key');
  if s->>'state'='done' then
   if w is not null then
    update public.workspace_work_items x set status='completed',completed_at=now(),version=x.version+1,updated_at=now() where x.id=w and x.status not in ('completed','cancelled','declined');
   end if;
   -- A renewed safety document completes its renewal tickets.
   if s->>'section'='compliance' then
    update public.workspace_work_items x set status='completed',completed_at=now(),version=x.version+1,updated_at=now()
     from private.workspace_launch_reminders m where m.property_id=prop and m.step=s->>'key' and m.expires_on<(s#>>'{data,expiresOn}')::date and x.id=m.work_id
      and x.status not in ('completed','cancelled','declined');
   end if;
  elsif s->>'state'='todo' and w is null and s->>'who'='recharge' and s->>'section' not in ('setUp','garden','housekeeper','licensing','listing') then
   board:=nullif(boards->>(s->>'section'),'');
   if board is not null and exists(select 1 from public.workspace_features f where f.module_id=board) then
    w:=private.workspace_handover_now(prop,board,left(place||': '||(s->>'title'),200),'launch_step',jsonb_build_object('step',s->>'key','section',s->>'section','kind',s->>'kind'));
    insert into private.workspace_launch_tickets(property_id,step,work_id) values(prop,s->>'key',w);
   end if;
  end if;
 end loop;
end $fn$;
-- Kept in step whenever something the checklist reads changes. A failure never blocks the change itself.
create or replace function private.workspace_launch_sync_trigger() returns trigger language plpgsql security definer set search_path='' as $fn$
declare prop uuid;begin
 prop:=case when tg_op='DELETE' then old.property_id else new.property_id end;
 begin perform private.workspace_launch_sync(prop);
 exception when others then raise warning 'Launch Preparation tickets for % not updated: %',prop,sqlerrm; end;
 return null;
end $fn$;
drop trigger if exists workspace_launch_sync on private.workspace_launch_steps;
create trigger workspace_launch_sync after insert or update or delete on private.workspace_launch_steps for each row execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_launch_readiness;
create trigger workspace_launch_sync after insert or update on private.workspace_launch_readiness for each row execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_default_cleaners;
create trigger workspace_launch_sync after insert or update on private.workspace_default_cleaners for each row execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_journeys;
create trigger workspace_launch_sync after update of stage on private.workspace_journeys for each row when (new.stage is distinct from old.stage) execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_listing_photography;
create trigger workspace_launch_sync after insert or update on private.workspace_listing_photography for each row execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_listing_drafts;
create trigger workspace_launch_sync after insert or update of published_at on private.workspace_listing_drafts for each row execute function private.workspace_launch_sync_trigger();

-- Completing a ticket on its board ticks the part. Parts with something to enter (a certificate, the readiness form) are
-- finished in Launch Preparation, which then completes the ticket.
create or replace function private.workspace_launch_ticket_done() returns trigger language plpgsql security definer set search_path='' as $fn$
declare t private.workspace_launch_tickets;s jsonb;begin
 select * into t from private.workspace_launch_tickets where work_id=new.id;
 if t.work_id is null then return null;end if;
 s:=(select z from jsonb_array_elements(private.workspace_launch_plan(t.property_id)) z where z->>'key'=t.step);
 if s is null or s->>'state'<>'todo' then return null;end if;
 if s->>'kind'<>'tick' then raise exception 'Finish "%" in Launch Preparation on the property',s->>'title' using errcode='22023';end if;
 insert into private.workspace_launch_steps(property_id,step,data,done_by,done_at)
  values(t.property_id,t.step,'{}',(select p.user_id from public.workspace_profiles p where p.user_id=auth.uid()),now()) on conflict do nothing;
 return null;
end $fn$;
drop trigger if exists workspace_launch_ticket_done on public.workspace_work_items;
create trigger workspace_launch_ticket_done after update of status on public.workspace_work_items for each row
 when (new.status='completed' and old.status is distinct from 'completed') execute function private.workspace_launch_ticket_done();

-- 5. Expiry reminders: once per document and expiry date, the owner in the property's chat and a renewal ticket on the
-- compliance board. Run by the scheduled worker; at most 100 a run.
create or replace function private.workspace_launch_compliance_sweep(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare st jsonb:=private.workspace_launch_settings();months integer;board text;today date;x record;doc text;w uuid;n integer:=0;begin
 perform pg_advisory_xact_lock(hashtext('workspace_launch_compliance_sweep'));
 months:=coalesce((st->>'reminderMonths')::integer,3);
 board:=nullif(st#>>'{boards,compliance}','');
 if board is not null and not exists(select 1 from public.workspace_features f where f.module_id=board) then board:=null;end if;
 today:=(at_time at time zone 'Europe/London')::date;
 for x in select s.property_id,s.step,(s.data->>'expiresOn')::date expires_on from private.workspace_launch_steps s
   join private.workspace_onboarding_packages k on k.property_id=s.property_id and k.submitted_at is not null
   join private.workspace_journeys j on j.property_id=s.property_id and j.stage<>'archived'
  where s.step like 'compliance:%' and s.data->>'expiresOn' ~ '^\d{4}-\d{2}-\d{2}$' and ((s.data->>'expiresOn')::date-make_interval(months=>months))::date<=today
   and not exists(select 1 from private.workspace_launch_reminders m where m.property_id=s.property_id and m.step=s.step and m.expires_on=(s.data->>'expiresOn')::date)
  order by 3,1 limit 100 loop
  doc:=coalesce((select z->>'title' from jsonb_array_elements(private.workspace_launch_plan(x.property_id)) z where z->>'key'=x.step),initcap(replace(split_part(x.step,':',2),'-',' ')));
  w:=null;
  if board is not null then
   w:=private.workspace_handover_now(x.property_id,board,left('Renew '||doc||' (expires '||to_char(x.expires_on,'FMDD FMMonth YYYY')||')',200),'compliance_renewal',
    jsonb_build_object('step',x.step,'expiresOn',x.expires_on));
  end if;
  insert into private.workspace_launch_reminders(property_id,step,expires_on,work_id,sent_at) values(x.property_id,x.step,x.expires_on,w,at_time);
  perform private.workspace_property_chat_post(x.property_id,'The '||doc||' certificate '||case when x.expires_on<=today then 'expired on ' else 'expires on ' end
   ||to_char(x.expires_on,'FMDay FMDD FMMonth YYYY')||'. Please arrange the renewal and upload the new certificate in Launch Preparation.',null,'event',at_time);
  n:=n+1;
 end loop;
 return jsonb_build_object('reminded',n);
end $fn$;
create or replace function public.workspace_launch_compliance_sweep() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_launch_compliance_sweep() $$;

-- The two-argument check is replaced by one that knows the property and part.
drop function if exists private.workspace_launch_check(text,jsonb);
revoke all on function private.workspace_launch_settings_default(),private.workspace_launch_view(uuid),private.workspace_launch_read(uuid),private.workspace_launch_check(text,jsonb,uuid,text),
 private.workspace_launch_action(jsonb),private.workspace_launch_file_gone(),private.workspace_launch_sync(uuid),private.workspace_launch_sync_trigger(),private.workspace_launch_ticket_done(),
 private.workspace_launch_compliance_sweep(timestamptz),public.workspace_launch_compliance_sweep(),private.workspace_launch_file(uuid,uuid),public.workspace_launch_file(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_read(uuid),private.workspace_launch_action(jsonb),private.workspace_launch_file(uuid,uuid),public.workspace_launch_file(uuid,uuid) to authenticated;
grant execute on function private.workspace_launch_compliance_sweep(timestamptz),public.workspace_launch_compliance_sweep() to service_role;

-- Properties already in Launch Preparation get their tickets now.
do $$declare x uuid;begin
 for x in select k.property_id from private.workspace_onboarding_packages k where k.submitted_at is not null loop perform private.workspace_launch_sync(x);end loop;
end $$;
