-- Launch Preparation (Business Plan v1.0, 17/10/26): the whole process of getting a property live, as one checklist.
--  * It follows the owner's onboarding package (migration 20261028100000): each part shows whether Recharge does it or the
--    owner does, and a part the package left out (no garden, communal bins) is greyed out. Nothing opens until the
--    onboarding fee is settled. The team ticks Recharge's parts on the lead; the owner ticks their own in the app.
--  * Property set-up (inspection, inventory, the condition checklist and, when Recharge sets up, the furnishing order and
--    install), broadband, utilities, safety compliance (each document's expiry date), licensing and the housekeeper
--    (the property's default cleaner) come first. Once those are done the readiness inspection opens: the team books it
--    with the housekeeper, who fills in the form (inventory, each condition statement ticked or crossed with a reason,
--    and the changeover video). Each cross, and any missing inventory, raises a property maintenance ticket. Submitting
--    it makes the property guest ready (the inspection stage), which opens photography and the listing (20261028200000).
--  * Then the guidebook, pricing (minimum and base price, once the listing is in Hostaway) and social media (a coming
--    soon post once the photos are in, and a live post once the property is live).
--  * Admins edit the condition statements, the note shown under each part and whether the video is required.
--  * A property with a submitted package books and completes its inspection through this checklist only.
-- New tables and functions, and one guard on the journey's stage; no existing function or data is changed. Safe to run twice.

-- 1. Settings, ticks and the readiness inspection.
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
  "requireVideo":true
 }$json$::jsonb
$fn$;
create table if not exists private.workspace_launch_settings (
 singleton boolean primary key default true check (singleton),
 content jsonb not null default private.workspace_launch_settings_default() check (jsonb_typeof(content)='object' and pg_column_size(content)<65536),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
insert into private.workspace_launch_settings(singleton) values(true) on conflict do nothing;
-- A part ticked by hand, with what was entered (a date, the condition ticks, an expiry date, the licence).
create table if not exists private.workspace_launch_steps (
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 step text not null check (step~'^[a-z][a-zA-Z]*(\.[a-zA-Z]+|:[a-z0-9-]{1,40})$'),
 data jsonb not null default '{}' check (jsonb_typeof(data)='object' and pg_column_size(data)<16384),
 done_by uuid references auth.users(id) on delete set null,
 done_at timestamptz not null default now(),
 primary key (property_id,step)
);
create table if not exists private.workspace_launch_readiness (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 booked_on date not null,
 housekeeper_id uuid references public.workspace_profiles(user_id) on delete set null,
 booked_by uuid references auth.users(id) on delete set null, booked_at timestamptz not null default now(),
 submitted_at timestamptz, submitted_by uuid references auth.users(id) on delete set null,
 inventory jsonb, condition jsonb, evidence jsonb, issues integer not null default 0
);
create index if not exists workspace_launch_readiness_housekeeper on private.workspace_launch_readiness(housekeeper_id) where submitted_at is null;
alter table private.workspace_launch_settings enable row level security;
alter table private.workspace_launch_steps enable row level security;
alter table private.workspace_launch_readiness enable row level security;
revoke all on private.workspace_launch_settings,private.workspace_launch_steps,private.workspace_launch_readiness from public,anon,authenticated,service_role;

create or replace function private.workspace_launch_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select private.workspace_launch_settings_default()||coalesce((select s.content from private.workspace_launch_settings s where s.singleton),'{}')
$$;
create or replace function private.workspace_launch_person(who uuid) returns text language sql stable security definer set search_path='' as $$
 select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=who
$$;
create or replace function private.workspace_launch_today() returns date language sql stable set search_path='' as $$
 select (now() at time zone 'Europe/London')::date
$$;
-- A safety document's key: "Gas Safety" is compliance:gas-safety.
create or replace function private.workspace_launch_slug(t text) returns text language sql immutable set search_path='' as $$
 select left(btrim(regexp_replace(lower(t),'[^a-z0-9]+','-','g'),'-'),40)
$$;

-- One part of the checklist. auto: 'done', 'na' or 'todo' when the app works it out; null when it is ticked by hand.
create or replace function private.workspace_launch_step(prop uuid,k text,section text,title text,who text,kind text,auto text,available boolean,lock text)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_launch_steps;state text;begin
 select * into r from private.workspace_launch_steps s where s.property_id=prop and s.step=k;
 state:=case when auto='na' then 'na' when auto='done' then 'done' when auto is null and r.property_id is not null then 'done' when not available then 'locked' else 'todo' end;
 return jsonb_build_object('key',k,'section',section,'title',title,'who',who,'kind',kind,'manual',auto is null,'state',state,
  'lockedBecause',case when state='locked' then lock end,'data',coalesce(r.data,'{}'),'doneAt',r.done_at,'doneByName',private.workspace_launch_person(r.done_by));
end $fn$;

-- 2. The checklist, worked out from the package, what has been ticked and where the property is up to. Null without a
-- submitted package (properties onboarded before it carry on as they were).
create or replace function private.workspace_launch_plan(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare j private.workspace_journeys;a jsonb;ps jsonb;steps jsonb:='[]';started boolean;rs boolean;r private.workspace_launch_readiness;
 ph private.workspace_listing_photography;fee text:='Opens once the onboarding fee is settled.';pre boolean;ready boolean;received boolean;listed boolean;doc text;
 hk boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 a:=(select x.answers from private.workspace_onboarding_packages x where x.property_id=prop and x.submitted_at is not null);
 if j.property_id is null or a is null then return null;end if;
 ps:=private.workspace_package_settings();
 select * into r from private.workspace_launch_readiness where property_id=prop;
 select * into ph from private.workspace_listing_photography where property_id=prop;
 started:=j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live');
 rs:=a->>'setUp'='recharge';
 -- a. Property set-up.
 steps:=steps||private.workspace_launch_step(prop,'setUp.inspection','setUp','Set-up inspection booked, with the date and access',case when rs then 'recharge' else 'client' end,'date',null,started,fee)
  ||private.workspace_launch_step(prop,'setUp.inventory','setUp','Inventory agreed',case when rs then 'recharge' else 'client' end,'tick',null,started,fee)
  ||private.workspace_launch_step(prop,'setUp.condition','setUp','Condition checked',case when rs then 'recharge' else 'client' end,'condition',null,started,fee);
 if rs then
  steps:=steps||private.workspace_launch_step(prop,'setUp.order','setUp','Furnishing ordered and received','recharge','tick',null,started,fee)
   ||private.workspace_launch_step(prop,'setUp.install','setUp','Furnishing installed, with photos','recharge','tick',null,started,fee);
 end if;
 -- b. Broadband: already installed ticks both.
 steps:=steps||private.workspace_launch_step(prop,'broadband.signUp','broadband','Signed up to broadband','client','tick',case when a->>'broadbandInstalled'='true' then 'done' end,started,fee)
  ||private.workspace_launch_step(prop,'broadband.setUp','broadband','Broadband installed, Wi-Fi name and password recorded',case when a->>'broadbandRecharge'='true' then 'recharge' else 'client' end,'tick',
   case when a->>'broadbandInstalled'='true' then 'done' end,started,fee);
 -- c. Utilities.
 steps:=steps||private.workspace_launch_step(prop,'utilities.signUp','utilities','Signed up to the utilities','client','tick',case when a->>'utilitiesConnected'='true' then 'done' end,started,fee)
  ||private.workspace_launch_step(prop,'utilities.meter','utilities','On a credit meter','client','tick',case when a->>'prepaymentMeters'='false' then 'done' end,started,fee);
 -- d. Safety compliance: each document, with its expiry date.
 if coalesce((ps#>>'{compliance,on}')::boolean,false) then
  for doc in select jsonb_array_elements_text(ps#>'{compliance,documents}') loop
   steps:=steps||private.workspace_launch_step(prop,'compliance:'||private.workspace_launch_slug(doc),'compliance',doc,
    case when coalesce(a->'complianceRecharge','[]') ? doc then 'recharge' else 'client' end,'expiry',null,started,fee);
  end loop;
 end if;
 -- e. Licensing.
 steps:=steps||private.workspace_launch_step(prop,'licensing.licence','licensing','Licence number, or no licence needed','client','licence',null,started,fee);
 -- f. Housekeeper: the property's default cleaner.
 hk:=exists(select 1 from private.workspace_default_cleaners d join public.workspace_profiles p on p.user_id=d.cleaner_id where d.property_id=prop and p.status='active' and p.role='cleans');
 steps:=steps||private.workspace_launch_step(prop,'housekeeper.allocate','housekeeper','Housekeeper allocated','recharge','housekeeper',case when hk then 'done' when not started then null else 'todo' end,started,fee);
 pre:=not exists(select 1 from jsonb_array_elements(steps) s where s->>'state' not in ('done','na'));
 -- g. Readiness inspection (properties inspected before this checklist count as done).
 steps:=steps||private.workspace_launch_step(prop,'readiness.inspection','readiness','Readiness inspection','recharge','readiness',
  case when r.submitted_at is not null or j.stage in ('inspection_complete','live') then 'done' when started and pre then 'todo' end,started and pre,
  case when not started then fee else 'Opens once everything above is done.' end);
 ready:=j.stage in ('inspection_complete','live');
 received:=ph.received_at is not null;
 -- h. Photography (on the listing panel).
 steps:=steps||private.workspace_launch_step(prop,'photography.booked','photography','Photography booked','recharge','auto',case when ph.property_id is not null then 'done' else 'todo' end,ready,'Opens once the property is guest ready.')
  ||private.workspace_launch_step(prop,'photography.received','photography','Photos received','recharge','auto',case when received then 'done' else 'todo' end,ready,'Opens once the property is guest ready.');
 -- i and j. Garden maintenance and waste collection, as the package says.
 steps:=steps||private.workspace_launch_step(prop,'garden.quote','garden',case when a->>'gardenQuote'='true' then 'Garden maintenance quote accepted' else 'The owner looks after the garden' end,
  case when a->>'gardenQuote'='true' then 'recharge' else 'client' end,'tick',case when a->>'garden' is distinct from 'true' then 'na' when a->>'gardenQuote' is distinct from 'true' then 'done' end,started,fee)
  ||private.workspace_launch_step(prop,'waste.collection','waste','Weekly waste collection set up','recharge','tick',
   case when a->>'waste' is distinct from 'private' or a->>'wasteRecharge' is distinct from 'true' then 'na' end,started,fee);
 -- k to n. Guidebook, listing, pricing and social media.
 listed:=exists(select 1 from private.workspace_listing_drafts d where d.property_id=prop and d.published_at is not null);
 steps:=steps||private.workspace_launch_step(prop,'guidebook.done','guidebook','Guest guidebook created','recharge','tick',null,ready,'Opens once the property is guest ready.')
  ||private.workspace_launch_step(prop,'listing.published','listing','Listing approved and in Hostaway','recharge','auto',case when listed then 'done' else 'todo' end,received,'Opens once the photos are in.')
  ||private.workspace_launch_step(prop,'pricing.minimum','pricing','Synced to PriceLabs: minimum stay and minimum price set','recharge','tick',null,listed,'Opens once the listing is in Hostaway.')
  ||private.workspace_launch_step(prop,'pricing.base','pricing','Base price set','recharge','tick',null,listed,'Opens once the listing is in Hostaway.')
  ||private.workspace_launch_step(prop,'social.comingSoon','social','Coming soon video posted','recharge','tick',null,received,'Opens once the photos are in.')
  ||private.workspace_launch_step(prop,'social.live','social','Live post','recharge','tick',null,j.stage='live','Opens once the property is live.');
 return steps;
end $fn$;

-- 3. Reading: the team who see enquiries, the owner, and the housekeeper booked for its readiness inspection.
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
 steps:=(select jsonb_agg(s||jsonb_build_object('canTick',(s->>'manual')::boolean and s->>'state'='todo' and (team or (owner and s->>'who'='client')),
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
  'settingsUpdatedAt',st.updated_at,'settingsUpdatedByName',private.workspace_launch_person(st.updated_by),
  -- Who can be the housekeeper: active housekeeping users.
  'housekeepers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Housekeeper')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role='cleans'),'[]') else '[]' end,
  -- A housekeeper's readiness inspections still to do.
  'inspections',coalesce((select jsonb_agg(jsonb_build_object('propertyId',r.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookedOn',r.booked_on) order by r.booked_on,r.property_id)
   from private.workspace_launch_readiness r join public.workspace_properties p on p.id=r.property_id join private.workspace_journeys j on j.property_id=r.property_id
   where r.housekeeper_id=auth.uid() and actor='cleans' and r.submitted_at is null and j.stage='inspection_booked'),'[]'),
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;

-- 4. What was entered for a part ticked by hand.
create or replace function private.workspace_launch_check(kind text,d jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
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

-- A repair from the readiness inspection, on the property maintenance board (as a cleaner's reported problem is).
create or replace function private.workspace_launch_repair(prop uuid,issue text) returns uuid language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;repair uuid;begin
 select * into j from private.workspace_journeys where property_id=prop;
 repair:=private.workspace_handover(prop,'stays-maintenance-reporting','Property repair request','maintenance',jsonb_build_object('issue',left(issue,3000),'estimatedCostMinor',0,'hazard',false,
  'phase','triage','warrantyRequired',coalesce(j.form->>'warrantyDetails','')<>'','workStatus','waiting','repairType','other','urgent',false,
  'contactFirst',nullif(j.form->>'preferredRepairContact',''),'warrantyDetails',nullif(j.form->>'warrantyDetails',''),'reportedBy',auth.uid(),'fromReadiness',true));
 update public.workspace_work_items set client_visible=true where id=repair;
 return repair;
end $fn$;

-- 5. Actions.
create or replace function private.workspace_launch_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;j private.workspace_journeys;
 r private.workspace_launch_readiness;s jsonb;x jsonb;keys text[];hk uuid;day date;n integer:=0;crosses text[]:='{}';missing text[]:='{}';ev bigint;video text;c text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data','housekeeperId','date','inventory','condition','evidence','settings'],60000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings'],60000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change Launch Preparation' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['condition','notes','requireVideo'],60000);
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
  if jsonb_typeof(s->'requireVideo') is distinct from 'boolean' then raise exception 'Invalid settings' using errcode='22023';end if;
  s:=jsonb_build_object('condition',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'text',btrim(z->>'text'))) from jsonb_array_elements(s->'condition') z),
   'notes',(select coalesce(jsonb_object_agg(n.key,btrim(n.value#>>'{}')),'{}') from jsonb_each(s->'notes') n),'requireVideo',s->'requireVideo');
  update private.workspace_launch_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_launch_read(null);
 elsif input->>'action' in ('tick','reopen','allocate','bookReadiness','submitReadiness') then
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
    insert into private.workspace_launch_steps(property_id,step,data,done_by,done_at) values(prop,part->>'key',private.workspace_launch_check(part->>'kind',input->'data'),me,now())
     on conflict(property_id,step) do nothing;
    -- The owner hears when Recharge ticks one of the owner's parts for them, or Recharge's set-up inspection is booked.
    if part->>'key'='setUp.inspection' then
     perform private.workspace_property_chat_post(prop,'Your set-up inspection is booked for '||to_char(((input->'data')->>'on')::date,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
    end if;
   else
    if not (part->>'canReopen')::boolean then raise exception 'This part cannot be reopened' using errcode='22023';end if;
    delete from private.workspace_launch_steps where property_id=prop and private.workspace_launch_steps.step=part->>'key';
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
  result:=private.workspace_launch_read(prop);
 else
  raise exception 'Unknown Launch Preparation action' using errcode='22023';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 6. With a package, the inspection is booked and completed through Launch Preparation only.
create or replace function private.workspace_launch_stage_guard() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.stage is distinct from old.stage and new.stage in ('inspection_booked','inspection_complete') and coalesce(current_setting('recharge.launch',true),'')<>'on'
  and exists(select 1 from private.workspace_onboarding_packages x where x.property_id=new.property_id and x.submitted_at is not null) then
  raise exception 'Book and complete the readiness inspection in Launch Preparation' using errcode='42501';
 end if;
 return new;
end $fn$;
drop trigger if exists workspace_launch_stage_guard on private.workspace_journeys;
create trigger workspace_launch_stage_guard before update of stage on private.workspace_journeys for each row execute function private.workspace_launch_stage_guard();

create or replace function public.workspace_launch_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_launch_read(target);$$;
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_launch_action(input);$$;
revoke all on function private.workspace_launch_settings_default(),private.workspace_launch_settings(),private.workspace_launch_person(uuid),private.workspace_launch_today(),
 private.workspace_launch_slug(text),private.workspace_launch_step(uuid,text,text,text,text,text,text,boolean,text),private.workspace_launch_plan(uuid),private.workspace_launch_view(uuid),
 private.workspace_launch_read(uuid),private.workspace_launch_check(text,jsonb),private.workspace_launch_repair(uuid,text),private.workspace_launch_action(jsonb),
 private.workspace_launch_stage_guard(),public.workspace_launch_read(uuid),public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_read(uuid),public.workspace_launch_read(uuid),private.workspace_launch_action(jsonb),public.workspace_launch_action(jsonb) to authenticated;
