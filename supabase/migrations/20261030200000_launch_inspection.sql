-- Launch Preparation: the set-up inspection when Recharge sets the property up (Business Plan v1.0, 17/10/26, Property
-- Set-Up i. Inspection, and Tasks 1. Property Set-Up: "schedule & assign inspection", "the furnishing inspection itself",
-- "the property operations coordinator then reviews the completed form and submits the required items to the owner, after
-- receiving management approval").
--  * The owner (or the team) gives the first date the property can be got into and how to get in.
--  * The property operations coordinator (the team) books the inspector (any active team member, or a contractor's user)
--    and the date. The owner is told in the property chat; booking again moves the date.
--  * The inspector (or the team) does the furnishing inspection: they calculate the inventory from the property's details
--    (the Furnishing Studio presets, as before) and submit the form with any repairs found, each of which becomes a property
--    maintenance job (the repair flow).
--  * Management (an admin) approves the report, which sends the inventory to the owner to accept or reject the additional
--    items, or sends it back to the inspector with what to change. Until then the owner does not see the list.
--  * The inspector sees their inspections on Home and can open the checklist.
--  * When the owner sets the property up, nothing changes; set-up inspections ticked before this keep their tick.
-- Replaces private.workspace_launch_plan (20261029950000), private.workspace_launch_inventory_view (20261029400000),
-- private.workspace_launch_view (20261029950000), private.workspace_launch_read (20261030100000),
-- private.workspace_launch_action (20261029500000; the owner hears about the inventory once management approve it) and the
-- public workspace_launch_action wrapper. Safe to run twice.

-- 1. The inspection.
create table if not exists private.workspace_launch_inspections (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 access_on date,
 access text not null default '' check (char_length(access)<=2000),
 access_by uuid references auth.users(id) on delete set null,
 access_at timestamptz,
 inspector_id uuid references public.workspace_profiles(user_id) on delete set null,
 inspect_on date,
 booked_by uuid references auth.users(id) on delete set null,
 booked_at timestamptz,
 notes text not null default '' check (char_length(notes)<=4000),
 repairs integer not null default 0,
 submitted_by uuid references auth.users(id) on delete set null,
 submitted_at timestamptz,
 returned_note text not null default '' check (char_length(returned_note)<=1000),
 approved_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz
);
create index if not exists workspace_launch_inspections_inspector on private.workspace_launch_inspections(inspector_id) where approved_at is null;
alter table private.workspace_launch_inspections enable row level security;
revoke all on private.workspace_launch_inspections from public,anon,authenticated,service_role;

-- 2. Whether the owner sees the inventory yet: always on their own set-up; on Recharge's once management approve the
-- inspection (or the inspection was ticked, or the inventory approved, before this).
create or replace function private.workspace_launch_inventory_released(prop uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select not coalesce((select x.answers->>'setUp'='recharge' from private.workspace_onboarding_packages x where x.property_id=prop and x.submitted_at is not null),false)
  or exists(select 1 from private.workspace_launch_inspections i where i.property_id=prop and i.approved_at is not null)
  or exists(select 1 from private.workspace_launch_steps t where t.property_id=prop and t.step='setUp.inspection')
  or exists(select 1 from private.workspace_launch_inventory v where v.property_id=prop and v.approved_at is not null)
$fn$;

-- 3. What each person sees of the inspection, and what they can do.
create or replace function private.workspace_launch_inspection_view(prop uuid,plan jsonb,team boolean,owner boolean,inspector boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare s jsonb;i private.workspace_launch_inspections;admin boolean;open boolean;begin
 s:=(select z from jsonb_array_elements(plan) z where z->>'key'='setUp.inspection');
 if s is null or s->>'kind'<>'inspection' or not (team or owner or inspector) then return null;end if;
 select * into i from private.workspace_launch_inspections where property_id=prop;
 admin:=coalesce(private.workspace_actor_role() in ('admin','super_admin'),false);
 open:=s->>'state'<>'locked' and i.approved_at is null and not exists(select 1 from private.workspace_launch_steps t where t.property_id=prop and t.step='setUp.inspection');
 return jsonb_build_object('accessOn',i.access_on,'access',case when team or owner or inspector then nullif(i.access,'') end,'accessByName',private.workspace_launch_person(i.access_by),
  'inspector',case when i.inspector_id is null then null else jsonb_build_object('id',i.inspector_id,'name',coalesce(private.workspace_launch_person(i.inspector_id),'Inspector')) end,
  'inspectOn',i.inspect_on,'bookedByName',private.workspace_launch_person(i.booked_by),
  'notes',case when team or inspector then nullif(i.notes,'') end,'repairs',coalesce(i.repairs,0),
  'submittedAt',i.submitted_at,'submittedByName',private.workspace_launch_person(i.submitted_by),
  'returnedNote',case when team or inspector then nullif(i.returned_note,'') end,
  'approvedAt',i.approved_at,'approvedByName',private.workspace_launch_person(i.approved_by),
  'canSetAccess',(team or owner) and open and i.submitted_at is null,
  'canBook',team and open and i.submitted_at is null,
  'canSubmit',(team or inspector) and open and i.inspector_id is not null and i.submitted_at is null,
  'canApprove',admin and open and i.submitted_at is not null);
end $fn$;

-- 4. The checklist: Recharge's set-up inspection is its own kind of part, followed by the inspection report.
create or replace function private.workspace_launch_plan(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare j private.workspace_journeys;a jsonb;ps jsonb;steps jsonb:='[]';started boolean;rs boolean;r private.workspace_launch_readiness;
 ph private.workspace_listing_photography;fee text:='Opens once the onboarding fee is settled.';pre boolean;ready boolean;received boolean;listed boolean;doc text;
 hk boolean;fu private.workspace_launch_furnishing;quoted boolean;fordered boolean;freceived boolean;inv boolean;gb private.workspace_launch_guidebooks;
 ins private.workspace_launch_inspections;legacy boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 a:=(select x.answers from private.workspace_onboarding_packages x where x.property_id=prop and x.submitted_at is not null);
 if j.property_id is null or a is null then return null;end if;
 ps:=private.workspace_package_settings();
 select * into r from private.workspace_launch_readiness where property_id=prop;
 select * into ph from private.workspace_listing_photography where property_id=prop;
 started:=j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live');
 rs:=a->>'setUp'='recharge';
 -- a. Property set-up. The inventory is done once it is approved and every item on it is ticked as in the property.
 inv:=exists(select 1 from private.workspace_launch_inventory v where v.property_id=prop and v.approved_at is not null)
  and not exists(select 1 from private.workspace_launch_inventory_items i where i.property_id=prop and i.kept is not false and i.checked_at is null);
 -- Recharge's set-up inspection (20261030200000): the access and the inspector booked, then the report approved by
 -- management, which sends the inventory to the owner. A set-up inspection ticked before this stays done.
 if rs then
  select * into ins from private.workspace_launch_inspections x where x.property_id=prop;
  legacy:=exists(select 1 from private.workspace_launch_steps t where t.property_id=prop and t.step='setUp.inspection');
  steps:=steps||private.workspace_launch_step(prop,'setUp.inspection','setUp','Set-up inspection booked, with the date and access','recharge','inspection',
    case when legacy or (ins.inspector_id is not null and ins.inspect_on is not null) then 'done' else 'todo' end,started,fee)
   ||private.workspace_launch_step(prop,'setUp.report','setUp','Furnishing inspection done and approved by management','recharge','inspectionReport',
    case when private.workspace_launch_inventory_released(prop) then 'done' else 'todo' end,started and (legacy or ins.inspector_id is not null),
    case when not started then fee else 'Opens once the inspection is booked.' end);
 else
  steps:=steps||private.workspace_launch_step(prop,'setUp.inspection','setUp','Set-up inspection booked, with the date and access','client','date',null,started,fee);
 end if;
 steps:=steps||private.workspace_launch_step(prop,'setUp.inventory','setUp','Inventory calculated, agreed and complete',case when rs then 'recharge' else 'client' end,'inventory',case when inv then 'done' else 'todo' end,started,fee)
  ||private.workspace_launch_step(prop,'setUp.condition','setUp','Condition checked',case when rs then 'recharge' else 'client' end,'condition',null,started,fee);
 if rs then
  -- The furnishing: the owner approves a quote from the Furnishing Studio, accounts invoice it, then it is ordered (each item
  -- with its delivery date), received (each item photographed) and installed (an approved date, then photos).
  select * into fu from private.workspace_launch_furnishing x where x.property_id=prop;
  quoted:=exists(select 1 from private.workspace_furnishing_projects q where q.property_id=prop and q.status='sent' and not q.archived);
  fordered:=fu.settled_at is not null and fu.installer_id is not null
   and not exists(select 1 from private.workspace_launch_buy(prop) b left join private.workspace_launch_furnishing_lines o on o.line_id=b.id where o.ordered_at is null);
  freceived:=fordered and not exists(select 1 from private.workspace_launch_buy(prop) b left join private.workspace_launch_furnishing_lines o on o.line_id=b.id where o.received_at is null);
  steps:=steps||private.workspace_launch_step(prop,'setUp.quote','setUp','Furnishing quote approved','client','furnishingQuote',case when fu.property_id is not null then 'done' else 'todo' end,
    started and (quoted or fu.property_id is not null),case when not started then fee else 'Opens once Recharge sends the furnishing quote.' end)
   ||private.workspace_launch_step(prop,'setUp.invoice','setUp','Furnishing invoice settled','client','auto',case when fu.settled_at is not null then 'done' else 'todo' end,
    fu.property_id is not null,'Opens once the furnishing quote is approved.')
   ||private.workspace_launch_step(prop,'setUp.order','setUp','Furnishing ordered, with delivery dates','recharge','furnishingOrder',case when fordered then 'done' else 'todo' end,
    fu.settled_at is not null,'Opens once the furnishing invoice is settled.')
   ||private.workspace_launch_step(prop,'setUp.received','setUp','Furnishing received and photographed','recharge','furnishingReceived',case when freceived then 'done' else 'todo' end,
    fordered,'Opens once everything is ordered.')
   ||private.workspace_launch_step(prop,'setUp.install','setUp','Furnishing installed, with photos','recharge','furnishingInstall',case when fu.installed_at is not null then 'done' else 'todo' end,
    freceived,'Opens once everything is received.');
 end if;
 -- b. Broadband: already installed ticks both.
 steps:=steps||private.workspace_launch_step(prop,'broadband.signUp','broadband','Signed up to broadband','client','tick',case when a->>'broadbandInstalled'='true' then 'done' end,started,fee)
  ||private.workspace_launch_step(prop,'broadband.setUp','broadband','Broadband installed, Wi-Fi name and password recorded',case when a->>'broadbandRecharge'='true' then 'recharge' else 'client' end,
   -- Recharge's set-up (20261029950000): the install date, the technician, then the Wi-Fi reset with the portal.
   case when a->>'broadbandRecharge'='true' and a->>'broadbandInstalled' is distinct from 'true' then 'broadband' else 'tick' end,
   case when a->>'broadbandInstalled'='true' then 'done' when a->>'broadbandRecharge'='true' then
    case when exists(select 1 from private.workspace_launch_broadband b where b.property_id=prop and b.installed_at is not null)
     or exists(select 1 from private.workspace_launch_steps t where t.property_id=prop and t.step='broadband.setUp') then 'done' else 'todo' end end,started,fee);
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
 -- i and j. Garden maintenance and waste collection, as the package says. A garden quote is done once the owner accepts
 -- one (or it was ticked before quotes, 20261029800000).
 steps:=steps||private.workspace_launch_step(prop,'garden.quote','garden',case when a->>'gardenQuote'='true' then 'Garden maintenance quote accepted' else 'The owner looks after the garden' end,
  case when a->>'gardenQuote'='true' then 'recharge' else 'client' end,case when a->>'gardenQuote'='true' then 'gardenQuote' else 'tick' end,
  case when a->>'garden' is distinct from 'true' then 'na' when a->>'gardenQuote' is distinct from 'true' then 'done'
   when exists(select 1 from private.workspace_launch_garden_quotes g where g.property_id=prop and g.status='accepted')
    or exists(select 1 from private.workspace_launch_steps t where t.property_id=prop and t.step='garden.quote') then 'done' else 'todo' end,started,fee)
  ||private.workspace_launch_step(prop,'waste.collection','waste','Weekly waste collection set up','recharge','tick',
   case when a->>'waste' is distinct from 'private' or a->>'wasteRecharge' is distinct from 'true' then 'na' end,started,fee);
 -- k to n. Guidebook, listing, pricing and social media.
 listed:=exists(select 1 from private.workspace_listing_drafts d where d.property_id=prop and d.published_at is not null);
 -- The guidebook: the technician booked, then the guidebook filled in and submitted.
 select * into gb from private.workspace_launch_guidebooks x where x.property_id=prop;
 steps:=steps||private.workspace_launch_step(prop,'guidebook.book','guidebook','Technician booked to create the guidebook','recharge','guidebookBook',
   case when gb.technician_id is not null or gb.submitted_at is not null then 'done' else 'todo' end,ready,'Opens once the property is guest ready.')
  ||private.workspace_launch_step(prop,'guidebook.done','guidebook','Guest guidebook completed','recharge','guidebook',case when gb.submitted_at is not null then 'done' else 'todo' end,
   ready and gb.technician_id is not null,case when ready then 'Opens once the technician is booked.' else 'Opens once the property is guest ready.' end)
  ||private.workspace_launch_step(prop,'listing.published','listing','Listing approved and in Hostaway','recharge','auto',case when listed then 'done' else 'todo' end,received,'Opens once the photos are in.')
  ||private.workspace_launch_step(prop,'pricing.minimum','pricing','Synced to PriceLabs: minimum stay and minimum price set','recharge','tick',null,listed,'Opens once the listing is in Hostaway.')
  ||private.workspace_launch_step(prop,'pricing.base','pricing','Base price set','recharge','tick',null,listed,'Opens once the listing is in Hostaway.')
  ||private.workspace_launch_step(prop,'social.comingSoon','social','Coming soon video posted','recharge','tick',null,received,'Opens once the photos are in.')
  ||private.workspace_launch_step(prop,'social.live','social','Live post','recharge','tick',null,j.stage='live','Opens once the property is live.');
 return steps;
end $fn$;

-- 5. The inventory: the inspector prepares it, and the owner sees it once management approve the inspection.
create or replace function private.workspace_launch_inventory_view(prop uuid,team boolean,owner boolean,keeper boolean,fitter boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare v private.workspace_launch_inventory;rs boolean;editor boolean;checker boolean;total integer;checked integer;undecided integer;suggest jsonb;
 inspector boolean;released boolean;begin
 rs:=coalesce((select x.answers->>'setUp'='recharge' from private.workspace_onboarding_packages x where x.property_id=prop and x.submitted_at is not null),false);
 select * into v from private.workspace_launch_inventory where property_id=prop;
 released:=private.workspace_launch_inventory_released(prop);
 -- The inspector booked for Recharge's set-up prepares the inventory until management approve the inspection.
 inspector:=coalesce((select i.inspector_id=auth.uid() and i.approved_at is null from private.workspace_launch_inspections i where i.property_id=prop),false) and rs and not released;
 editor:=team or inspector or (owner and not rs);
 checker:=team or fitter or (owner and not rs);
 select count(*) filter (where i.kept)::int,count(*) filter (where i.kept and i.checked_at is not null)::int,count(*) filter (where i.kept is null)::int
  into total,checked,undecided from private.workspace_launch_inventory_items i where i.property_id=prop;
 -- The details to start from: the inventory's own, else the property's Furnishing Studio quote (the approved one first).
 suggest:=coalesce(v.inputs,(select q.inputs from private.workspace_furnishing_projects q where q.property_id=prop and not q.archived and q.inputs<>'{}'::jsonb
  order by (q.status in ('accepted','purchasing','complete')) desc,q.updated_at desc limit 1));
 return jsonb_build_object('rechargeSetsUp',rs,'released',released,'inputs',case when team or inspector or owner then suggest end,'calculatedAt',v.calculated_at,
  'calculatedByName',private.workspace_launch_person(v.calculated_by),'approvedAt',v.approved_at,'approvedByName',private.workspace_launch_person(v.approved_by),
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemId',i.item_id,'name',i.name,'category',i.category,'unit',i.unit,'kind',i.kind,'quantity',i.quantity,'kept',i.kept,
    'decidedByName',private.workspace_launch_person(i.decided_by),'checkedAt',i.checked_at,'checkedByName',private.workspace_launch_person(i.checked_by)) order by i.position)
   from private.workspace_launch_inventory_items i where i.property_id=prop and (team or inspector or (owner and released) or (not owner and i.kept))),'[]'),
  'counts',jsonb_build_object('total',total,'checked',checked,'undecided',undecided),
  'canCalculate',editor,
  'canDecide',v.property_id is not null and case when rs then owner and released and v.approved_at is null else editor end,
  'canApprove',rs and owner and released and v.property_id is not null and v.approved_at is null and undecided=0,
  'canCheck',checker and v.property_id is not null and v.approved_at is not null);
end $fn$;

-- 6. The view: the inspector can open the property's checklist, and it carries the inspection.
create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;fitter boolean;buyer boolean;writer boolean;tech boolean;inspector boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 select * into r from private.workspace_launch_readiness where property_id=prop;
 team:=coalesce(actor is not null and private.workspace_can_enquiries(),false);
 owner:=coalesce(j.client_id=auth.uid(),false);
 keeper:=coalesce(actor='cleans' and r.housekeeper_id=auth.uid(),false);
 -- The furnishing installer, and accounts once there is furnishing to order.
 fitter:=coalesce((select x.installer_id=auth.uid() from private.workspace_launch_furnishing x where x.property_id=prop),false);
 buyer:=coalesce(actor='accounts' and exists(select 1 from private.workspace_launch_furnishing x where x.property_id=prop and x.settled_at is not null),false);
 -- The technician booked for the guidebook.
 writer:=coalesce((select x.technician_id=auth.uid() from private.workspace_launch_guidebooks x where x.property_id=prop),false);
 -- The technician setting up the broadband.
 tech:=coalesce((select x.technician_id=auth.uid() from private.workspace_launch_broadband x where x.property_id=prop),false);
 -- The inspector booked for the set-up inspection, until management approve it.
 inspector:=coalesce((select x.inspector_id=auth.uid() and x.approved_at is null from private.workspace_launch_inspections x where x.property_id=prop),false);
 if j.property_id is null or not (team or owner or keeper or fitter or buyer or writer or tech or inspector) then raise exception 'Property not found' using errcode='42501';end if;
 select * into p from public.workspace_properties where id=prop;
 plan:=private.workspace_launch_plan(prop);
 if plan is null then return jsonb_build_object('propertyId',prop,'steps',null);end if;
 hk:=(select d.cleaner_id from private.workspace_default_cleaners d join public.workspace_profiles x on x.user_id=d.cleaner_id where d.property_id=prop and x.status='active' and x.role='cleans');
 pre:=coalesce((select s->>'state' from jsonb_array_elements(plan) s where s->>'key'='readiness.inspection') in ('todo','done'),false);
 -- What each person can tick: the team, any part ticked by hand; the owner, their own parts.
 steps:=(select jsonb_agg(s||jsonb_build_object('canTick',(s->>'manual')::boolean and (s->>'state'='todo' or (s->>'kind'='expiry' and s->>'state'='done')) and (team or (owner and s->>'who'='client')),
   'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'uploadedAt',f.created_at) order by f.created_at desc,f.id)
    from private.workspace_launch_files f where f.property_id=prop and f.step=s->>'key' and f.line_id is null),'[]'),
   'ticketId',(select t.work_id from private.workspace_launch_tickets t where t.property_id=prop and t.step=s->>'key'),
   'canReopen',team and (s->>'manual')::boolean and s->>'state'='done' and (r.submitted_at is null or s->>'section' not in ('setUp','broadband','utilities','compliance','licensing','housekeeper'))))
  from jsonb_array_elements(plan) s);
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper or fitter or buyer or writer or tech or inspector then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper or fitter or writer or tech or inspector then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isBroadbandTech',tech,'isOwner',owner,'isHousekeeper',keeper,'isInstaller',fitter,'isAccounts',buyer,'isTechnician',writer,'isInspector',inspector,
  'inspection',private.workspace_launch_inspection_view(prop,plan,team,owner,inspector),
  'furnishing',private.workspace_launch_furnishing_view(prop,team,owner,fitter,buyer),
  'inventory',private.workspace_launch_inventory_view(prop,team,owner,keeper,fitter),
  'guidebook',private.workspace_launch_guidebook_view(prop,team,owner,keeper,writer),
  'garden',private.workspace_launch_garden_view(prop,plan,team,owner),
  'broadband',private.workspace_launch_broadband_view(prop,plan,team,owner,tech,p.address),
  'conditionReports',case when team or owner then private.workspace_launch_condition_reports(prop) else '[]' end,
  'canAllocate',team and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live'),
  'canBookReadiness',team and pre and hk is not null and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked'),
  'canSubmitReadiness',(team or keeper) and r.property_id is not null and r.submitted_at is null and r.booked_on<=today and j.stage='inspection_booked');
end $fn$;

-- 7. The read: the inspector's inspections, and the reports waiting for management.
create or replace function private.workspace_launch_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();st private.workspace_launch_settings;team boolean;begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 team:=coalesce(private.workspace_can_enquiries(),false);
 select * into st from private.workspace_launch_settings where singleton;
 return jsonb_build_object('settings',private.workspace_launch_settings(),'canEditSettings',actor in ('admin','super_admin'),
  'settingsUpdatedAt',st.updated_at,
  'boardIds',case when actor in ('admin','super_admin') then coalesce((select jsonb_agg(f.module_id order by f.module_id) from public.workspace_features f),'[]') else '[]' end,'settingsUpdatedByName',private.workspace_launch_person(st.updated_by),
  -- Who can be the housekeeper: active housekeeping users.
  -- Who can install furniture: any active team member (the Furniture Install Technician, or whoever is covering).
  'installers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role<>'client'),'[]') else '[]' end,
  'housekeepers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Housekeeper')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role='cleans'),'[]') else '[]' end,
  -- A housekeeper's readiness inspections still to do.
  'inspections',coalesce((select jsonb_agg(jsonb_build_object('propertyId',r.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookedOn',r.booked_on) order by r.booked_on,r.property_id)
   from private.workspace_launch_readiness r join public.workspace_properties p on p.id=r.property_id join private.workspace_journeys j on j.property_id=r.property_id
   where r.housekeeper_id=auth.uid() and actor='cleans' and r.submitted_at is null and j.stage='inspection_booked'),'[]'),
  -- Furnishing to order (accounts and the team) or to receive and install (the installer).
  'furnishingWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',f.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,
    'installer',coalesce(f.installer_id=auth.uid(),false),'total',c.total,'ordered',c.ordered,'received',c.received,'installOn',f.install_on,'installApproved',f.install_approved_at is not null)
    order by f.settled_at,f.property_id)
   from private.workspace_launch_furnishing f join public.workspace_properties p on p.id=f.property_id
   cross join lateral (select count(*)::int total,count(o.ordered_at)::int ordered,count(o.received_at)::int received from private.workspace_launch_buy(f.property_id) b
    left join private.workspace_launch_furnishing_lines o on o.line_id=b.id) c
   where f.settled_at is not null and f.installed_at is null and (f.installer_id=auth.uid() or ((actor='accounts' or team) and (f.installer_id is null or c.ordered<c.total)))),'[]'),
  -- Guidebooks the signed-in technician is booked to fill in.
  'guidebookWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',g.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookOn',g.book_on)
    order by g.book_on,g.property_id)
   from private.workspace_launch_guidebooks g join public.workspace_properties p on p.id=g.property_id where g.technician_id=auth.uid() and g.submitted_at is null),'[]'),
  -- Broadband the signed-in technician is assigned to set up (20261029950000).
  'broadbandWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',b.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'installOn',b.install_on)
    order by b.install_on nulls last,b.property_id)
   from private.workspace_launch_broadband b join public.workspace_properties p on p.id=b.property_id where b.technician_id=auth.uid() and b.installed_at is null),'[]'),
  -- Who each part's tickets go to (20261030100000), for admins to change.
  'assignees',case when actor in ('admin','super_admin') then coalesce((select jsonb_object_agg(x.section,jsonb_build_object('id',x.user_id,'name',coalesce(private.workspace_launch_person(x.user_id),'Team member')))
   from private.workspace_launch_assignees x join public.workspace_profiles p on p.user_id=x.user_id where p.status='active'),'{}') else '{}' end,
  -- Set-up inspections the signed-in inspector is booked for, until the report is in (20261030200000).
  'inspectionWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',i.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,
    'inspectOn',i.inspect_on,'returned',i.returned_note<>'') order by i.inspect_on nulls last,i.property_id)
   from private.workspace_launch_inspections i join public.workspace_properties p on p.id=i.property_id where i.inspector_id=auth.uid() and i.submitted_at is null and i.approved_at is null),'[]'),
  -- Inspection reports waiting for management (admins).
  'inspectionReviews',case when actor in ('admin','super_admin') then coalesce((select jsonb_agg(jsonb_build_object('propertyId',i.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),
    'address',p.address,'submittedAt',i.submitted_at,'submittedByName',private.workspace_launch_person(i.submitted_by)) order by i.submitted_at,i.property_id)
   from private.workspace_launch_inspections i join public.workspace_properties p on p.id=i.property_id where i.submitted_at is not null and i.approved_at is null),'[]') else '[]' end,
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;

-- 8. The checklist's actions (as 20261029500000): on Recharge's set-up the owner hears about the inventory once management
-- approve the inspection, not when the inspector calculates it.
create or replace function private.workspace_launch_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;j private.workspace_journeys;
 r private.workspace_launch_readiness;s jsonb;x jsonb;keys text[];hk uuid;day date;n integer:=0;crosses text[]:='{}';missing text[]:='{}';ev bigint;video text;c text;fu private.workspace_launch_furnishing;fv jsonb;q private.workspace_furnishing_projects;item uuid;who uuid;other record;was boolean;iv jsonb;waiting integer;gv jsonb;gb private.workspace_launch_guidebooks;words text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data','housekeeperId','date','inventory','condition','evidence','settings','fileId','name','mime','bytes','path','lineId','projectId','decision','note','installerId','deliveryAddress','lines','inputs','itemId','keep','present','technicianId','content','wifiName','wifiPassword','guestCode','teamCode'],70000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings'],60000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change Launch Preparation' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['condition','notes','requireVideo','requireComplianceFile','reminderMonths','boards','requireReceivedPhotos','guidebook'],60000);
  if jsonb_typeof(s->'condition') is distinct from 'array' or jsonb_array_length(s->'condition') not between 1 and 30 then raise exception 'Keep between 1 and 30 condition statements' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(s->'condition') loop
   perform private.workspace_json_keys(x,array['key','title','text']);
   if coalesce(x->>'key','')!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 120
    or jsonb_typeof(x->'text') is distinct from 'string' or char_length(btrim(x->>'text')) not between 1 and 1000 then raise exception 'Give every condition statement a title and its wording' using errcode='22023';end if;
  end loop;
  if (select count(distinct z->>'key') from jsonb_array_elements(s->'condition') z)<>jsonb_array_length(s->'condition') then raise exception 'Invalid settings' using errcode='22023';end if;
  -- The guidebook template: 1 to 20 sections, each with a title and what to write.
  if jsonb_typeof(s->'guidebook') is distinct from 'array' or jsonb_array_length(s->'guidebook') not between 1 and 20 then
   raise exception 'Keep between 1 and 20 guidebook sections' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(s->'guidebook') loop
   perform private.workspace_json_keys(x,array['key','title','prompt']);
   if coalesce(x->>'key','')!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 80
    or jsonb_typeof(x->'prompt') is distinct from 'string' or char_length(x->>'prompt')>1000 then raise exception 'Give every guidebook section a title' using errcode='22023';end if;
  end loop;
  if (select count(distinct z->>'key') from jsonb_array_elements(s->'guidebook') z)<>jsonb_array_length(s->'guidebook') then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(s->'notes') is distinct from 'object' or exists(select 1 from jsonb_each(s->'notes') n where n.key not in
   ('setUp','broadband','utilities','compliance','licensing','housekeeper','readiness','photography','garden','waste','guidebook','listing','pricing','social')
   or jsonb_typeof(n.value)<>'string' or char_length(n.value#>>'{}')>1000) then raise exception 'Up to 1,000 characters in each note' using errcode='22023';end if;
  if jsonb_typeof(s->'requireVideo') is distinct from 'boolean' or jsonb_typeof(s->'requireComplianceFile') is distinct from 'boolean' or jsonb_typeof(s->'requireReceivedPhotos') is distinct from 'boolean'
   or jsonb_typeof(s->'reminderMonths') is distinct from 'number' or (s->>'reminderMonths')::numeric not in (1,2,3,4,5,6) then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(s->'boards') is distinct from 'object' or exists(select 1 from jsonb_each(s->'boards') b where b.key not in
   ('setUp','broadband','utilities','compliance','licensing','housekeeper','readiness','photography','garden','waste','guidebook','listing','pricing','social','furnishing')
   or jsonb_typeof(b.value)<>'string' or (b.value#>>'{}'<>'' and not exists(select 1 from public.workspace_features f where f.module_id=b.value#>>'{}'))) then raise exception 'Choose a board for each part' using errcode='22023';end if;
  s:=jsonb_build_object('condition',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'text',btrim(z->>'text'))) from jsonb_array_elements(s->'condition') z),
   'notes',(select coalesce(jsonb_object_agg(n.key,btrim(n.value#>>'{}')),'{}') from jsonb_each(s->'notes') n),'requireVideo',s->'requireVideo',
   'requireComplianceFile',s->'requireComplianceFile','reminderMonths',(s->>'reminderMonths')::integer,'boards',s->'boards','requireReceivedPhotos',s->'requireReceivedPhotos',
   'guidebook',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'prompt',btrim(z->>'prompt'))) from jsonb_array_elements(s->'guidebook') z));
  update private.workspace_launch_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_launch_read(null);
 elsif input->>'action' in ('tick','reopen','allocate','bookReadiness','submitReadiness','addFile','removeFile','decideQuote','assignInstaller','orderLines','receiveLine','proposeInstall','approveInstall','completeInstall',
  'calculateInventory','decideInventory','approveInventory','checkInventory','bookGuidebook','saveGuidebook','submitGuidebook','reopenGuidebook','resetGuidebookLink') then
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
   if input->>'step' like 'guidebook:%' then
    -- A photo for a guidebook section: the technician or the team, while it is being filled in.
    if not coalesce((view#>>'{guidebook,canEdit}')::boolean,false) then raise exception 'Only the technician or the team add guidebook photos, before it is submitted' using errcode='42501';end if;
    if not exists(select 1 from jsonb_array_elements(private.workspace_launch_settings()->'guidebook') t where 'guidebook:'||(t->>'key')=input->>'step') then raise exception 'Choose a guidebook section' using errcode='22023';end if;
    part:=jsonb_build_object('key',input->>'step','section','guidebook');
   elsif part->>'key'='setUp.received' then
    -- A photo of a furnishing item as it arrives: the installer or the team, for an item ordered and not yet received.
    if not (coalesce((view->>'isTeam')::boolean,false) or coalesce((view->>'isInstaller')::boolean,false)) then raise exception 'Only the installer or the team add furnishing photos' using errcode='42501';end if;
    if not exists(select 1 from private.workspace_launch_buy(prop) bb join private.workspace_launch_furnishing_lines o on o.line_id=bb.id
     where bb.id::text=input->>'lineId' and o.ordered_at is not null and (input->>'action'='removeFile' or o.received_at is null)) then raise exception 'Choose an item that has been ordered' using errcode='22023';end if;
   elsif part->>'key'='setUp.install' then
    if not (coalesce((view->>'isTeam')::boolean,false) or coalesce((view->>'isInstaller')::boolean,false)) then raise exception 'Only the installer or the team add install photos' using errcode='42501';end if;
    if part->>'state'<>'todo' then raise exception '%',coalesce(part->>'lockedBecause','The install is complete') using errcode='22023';end if;
   elsif part is null or part->>'kind'<>'expiry' then raise exception 'Certificates go with a safety document' using errcode='22023';
   elsif not (part->>'canTick')::boolean and not (part->>'canReopen')::boolean then
    raise exception '%',coalesce(part->>'lockedBecause','Recharge looks after this document') using errcode='22023';end if;
   if input->>'action'='addFile' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','fileId','name','mime','bytes','path','lineId']);
    if (select count(*) from private.workspace_launch_files f where f.property_id=prop and f.step=part->>'key')>=10 then raise exception 'Up to 10 files for each document' using errcode='22023';end if;
    if coalesce(input->>'mime','') not in ('application/pdf','image/jpeg','image/png','image/webp') or coalesce(input->>'fileId','')!~'^[0-9a-fA-F-]{36}$'
     or coalesce(input->>'path','')<>'launch/'||prop||'/'||(input->>'fileId')||'.'||(case input->>'mime' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end)
     or coalesce(input->>'bytes','')!~'^\d{1,9}$' then raise exception 'Invalid file' using errcode='22023';end if;
    if input->>'mime'='application/pdf' and part->>'section' in ('setUp','guidebook') then raise exception 'Upload a photo' using errcode='22023';end if;
    insert into private.workspace_launch_files(id,property_id,step,path,name,mime,bytes,uploaded_by,line_id)
     values((input->>'fileId')::uuid,prop,part->>'key',input->>'path',left(coalesce(nullif(btrim(input->>'name'),''),case when part->>'section' in ('setUp','guidebook') then 'Photo' else 'Certificate' end),200),
      input->>'mime',(input->>'bytes')::bigint,me,case when part->>'key'='setUp.received' then (input->>'lineId')::uuid end);
   else
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','fileId','lineId']);
    begin delete from private.workspace_launch_files f where f.id=(input->>'fileId')::uuid and f.property_id=prop and f.step=part->>'key' returning f.path into video;
    exception when invalid_text_representation then video:=null; end;
    if video is null then raise exception 'File not found' using errcode='22023';end if;
   end if;
  elsif input->>'action' in ('decideQuote','assignInstaller','orderLines','receiveLine','proposeInstall','approveInstall','completeInstall') then
   -- The furnishing (Recharge sets up): the owner approves a quote, the team assign the installer and the delivery address,
   -- accounts order each item with its delivery date, the installer receives and photographs each item, then sets the
   -- install date (approved by the team before the owner hears) and finishes with photos.
   fv:=view->'furnishing';
   select * into fu from private.workspace_launch_furnishing where property_id=prop for update;
   if input->>'action'='decideQuote' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','projectId','decision','note']);
    if not coalesce((fv->>'canDecide')::boolean,false) then raise exception 'There is no furnishing quote waiting for a decision' using errcode='22023';end if;
    if coalesce(input->>'decision','') not in ('accept','decline') or jsonb_typeof(coalesce(input->'note','""'))<>'string' or char_length(coalesce(input->>'note',''))>1000 then
     raise exception 'Accept or decline the quote' using errcode='22023';end if;
    begin select * into q from private.workspace_furnishing_projects x where x.id=(input->>'projectId')::uuid and x.property_id=prop and x.status='sent' and not x.archived for update;
    exception when invalid_text_representation then q:=null; end;
    if q.id is null then raise exception 'Quote not found' using errcode='22023';end if;
    if input->>'decision'='accept' then
     update private.workspace_furnishing_projects set status='accepted',decided_at=now(),decided_by=me,version=version+1,updated_at=now(),updated_by=me where id=q.id;
     insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail) values(q.id,me,'moved','sent','accepted',q.version+1,'{"from":"launch"}');
     -- Any other quote sent for the property (another package) is declined.
     for other in select x.id,x.version from private.workspace_furnishing_projects x where x.property_id=prop and x.status='sent' and x.id<>q.id and not x.archived loop
      update private.workspace_furnishing_projects set status='declined',decided_at=now(),decided_by=me,version=version+1,updated_at=now(),updated_by=me where id=other.id;
      insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail) values(other.id,me,'moved','sent','declined',other.version+1,'{"from":"launch","reason":"another quote was approved"}');
     end loop;
     -- The invoice, in Accounts > Receivable, for the approved amount.
     insert into private.workspace_hub_items(kind,title,details,property_id,department,amount_minor,status,client_id,created_by)
      values('invoice',left('Furnishing: '||coalesce(nullif(btrim((select p.name from public.workspace_properties p where p.id=prop)),''),'new property'),200),
       'Opened when the owner approved furnishing quote '||q.number||'. Send the invoice; once it is settled, the furnishing is ordered.',
       prop,'accounts',q.quote_pence,'to_send',(select x.user_id from public.workspace_profiles x where x.user_id=j.client_id and x.role='client'),me) returning id into item;
     insert into private.workspace_launch_furnishing(property_id,project_id,invoice_item_id,accepted_at,accepted_by) values(prop,q.id,item,now(),me);
     perform private.workspace_property_chat_post(prop,'Furnishing quote '||q.number||' approved ('||private.workspace_fee_money(q.quote_pence)||'). Our accounts team will send the invoice next.',null,'event',now());
     perform private.workspace_followup_note(prop,'Furnishing quote '||q.number||' approved ('||private.workspace_fee_money(q.quote_pence)||'). The invoice is in Receivable for accounts.',me);
     perform private.workspace_fee_tell_accounts(prop,'hub.furnishing_invoice',now());
    else
     update private.workspace_furnishing_projects set status='declined',decided_at=now(),decided_by=me,version=version+1,updated_at=now(),updated_by=me where id=q.id;
     insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail)
      values(q.id,me,'moved','sent','declined',q.version+1,jsonb_build_object('from','launch','note',nullif(btrim(coalesce(input->>'note','')),'')));
     perform private.workspace_property_chat_post(prop,'Furnishing quote '||q.number||' declined.'||coalesce(' '||nullif(btrim(coalesce(input->>'note','')),''),''),null,'event',now());
     perform private.workspace_followup_note(prop,'Furnishing quote '||q.number||' declined'||coalesce(': '||nullif(btrim(coalesce(input->>'note','')),''),'.'),me);
     perform private.workspace_followup_tell(prop,'launch.quote_declined',now());
    end if;
   elsif input->>'action'='assignInstaller' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','installerId','deliveryAddress']);
    if not coalesce((fv->>'canAssign')::boolean,false) then raise exception 'The installer is assigned once the furnishing invoice is settled' using errcode='22023';end if;
    begin who:=(input->>'installerId')::uuid; exception when others then who:=null; end;
    if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and p.role<>'client') then raise exception 'Choose an active team member as the installer' using errcode='22023';end if;
    if jsonb_typeof(input->'deliveryAddress') is distinct from 'string' or char_length(btrim(input->>'deliveryAddress')) not between 5 and 500 then raise exception 'Enter the delivery address' using errcode='22023';end if;
    was:=fu.installer_id is distinct from who;
    update private.workspace_launch_furnishing set installer_id=who,delivery_address=btrim(input->>'deliveryAddress') where property_id=prop;
    if was then
     insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(me,prop,'launch.install_assigned',now()) returning id into ev;
     insert into private.workspace_notification_outbox(user_id,event_id) values(who,ev) on conflict do nothing;
    end if;
   elsif input->>'action'='orderLines' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','lines'],60000);
    if not coalesce((fv->>'canOrder')::boolean,false) then raise exception 'Assign the installer and the delivery address first' using errcode='22023';end if;
    if jsonb_typeof(input->'lines') is distinct from 'array' or jsonb_array_length(input->'lines') not between 1 and 400 then raise exception 'Choose what was ordered' using errcode='22023';end if;
    was:=coalesce(((fv#>>'{counts,ordered}')::int)>=((fv#>>'{counts,total}')::int),false);
    for x in select * from jsonb_array_elements(input->'lines') loop
     perform private.workspace_json_keys(x,array['lineId','eta']);
     if coalesce(x->>'eta','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Give each item its expected delivery date' using errcode='22023';end if;
     begin day:=(x->>'eta')::date; exception when others then raise exception 'Choose a real date' using errcode='22023'; end;
     if day<private.workspace_launch_today() then raise exception 'The delivery date cannot be in the past' using errcode='22023';end if;
     if not exists(select 1 from private.workspace_launch_buy(prop) bb where bb.id::text=x->>'lineId') then raise exception 'That item is not on the approved quote' using errcode='22023';end if;
     if exists(select 1 from private.workspace_launch_furnishing_lines o where o.line_id::text=x->>'lineId' and o.received_at is not null) then raise exception 'That item has already been received' using errcode='22023';end if;
     insert into private.workspace_launch_furnishing_lines(line_id,property_id,ordered_at,ordered_by,eta) values((x->>'lineId')::uuid,prop,now(),me,day)
      on conflict(line_id) do update set eta=excluded.eta;
     update private.workspace_furnishing_lines set purchased=true,purchased_at=coalesce(purchased_at,now()),purchased_by=coalesce(purchased_by,me) where id=(x->>'lineId')::uuid;
    end loop;
    if not was and not exists(select 1 from private.workspace_launch_buy(prop) bb left join private.workspace_launch_furnishing_lines o on o.line_id=bb.id where o.ordered_at is null) then
     day:=(select max(o.eta) from private.workspace_launch_furnishing_lines o where o.property_id=prop);
     perform private.workspace_property_chat_post(prop,'Your furnishing order has been placed. Everything is expected by '||to_char(day,'FMDay FMDD FMMonth YYYY')||'; we will let you know once it has all arrived.',null,'event',now());
     perform private.workspace_followup_note(prop,'Furnishing ordered: every item has a delivery date, the last by '||to_char(day,'FMDD FMMonth YYYY')||'.',me);
     perform private.workspace_followup_tell(prop,'launch.furnishing_ordered',now());
    end if;
   elsif input->>'action'='receiveLine' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','lineId']);
    if not coalesce((fv->>'canReceive')::boolean,false) then raise exception 'Only the installer or the team mark furnishing as received' using errcode='22023';end if;
    if not exists(select 1 from private.workspace_launch_furnishing_lines o where o.line_id::text=input->>'lineId' and o.property_id=prop and o.ordered_at is not null and o.received_at is null) then
     raise exception 'Choose an item that has been ordered' using errcode='22023';end if;
    if coalesce((private.workspace_launch_settings()->>'requireReceivedPhotos')::boolean,true)
     and not exists(select 1 from private.workspace_launch_files f where f.property_id=prop and f.line_id::text=input->>'lineId') then raise exception 'Take a photo of the item first' using errcode='22023';end if;
    update private.workspace_launch_furnishing_lines set received_at=now(),received_by=me where line_id=(input->>'lineId')::uuid;
    if not exists(select 1 from private.workspace_launch_buy(prop) bb left join private.workspace_launch_furnishing_lines o on o.line_id=bb.id where o.received_at is null) then
     perform private.workspace_property_chat_post(prop,'All of your furnishing has arrived and been checked. Next, we will confirm the install date.',null,'event',now());
     perform private.workspace_followup_note(prop,'Furnishing received: every item checked in and photographed.',me);
     perform private.workspace_followup_tell(prop,'launch.furnishing_received',now());
    end if;
   elsif input->>'action'='proposeInstall' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','date']);
    if not coalesce((fv->>'canProposeInstall')::boolean,false) then raise exception 'The install date is set once everything is received' using errcode='22023';end if;
    if coalesce(input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the install date' using errcode='22023';end if;
    begin day:=(input->>'date')::date; exception when others then raise exception 'Choose a real date' using errcode='22023'; end;
    if day<private.workspace_launch_today() then raise exception 'The install date cannot be in the past' using errcode='22023';end if;
    -- From the team it is approved straight away; from the installer it waits for the team.
    update private.workspace_launch_furnishing set install_on=day,install_proposed_by=me,install_proposed_at=now(),
     install_approved_at=case when (view->>'isTeam')::boolean then now() end,install_approved_by=case when (view->>'isTeam')::boolean then me end where property_id=prop;
    if (view->>'isTeam')::boolean then
     perform private.workspace_property_chat_post(prop,'Your furnishing install is booked to be completed by '||to_char(day,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
    else
     perform private.workspace_followup_note(prop,'The installer proposed '||to_char(day,'FMDD FMMonth YYYY')||' for the furnishing install. Approve it in Launch Preparation.',me);
     perform private.workspace_followup_tell(prop,'launch.install_proposed',now());
    end if;
   elsif input->>'action'='approveInstall' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
    if not coalesce((fv->>'canApproveInstall')::boolean,false) then raise exception 'There is no install date to approve' using errcode='22023';end if;
    update private.workspace_launch_furnishing set install_approved_at=now(),install_approved_by=me where property_id=prop;
    perform private.workspace_property_chat_post(prop,'Your furnishing install is booked to be completed by '||to_char(fu.install_on,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
    if fu.installer_id is not null and fu.installer_id<>me then
     insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(me,prop,'launch.install_approved',now()) returning id into ev;
     insert into private.workspace_notification_outbox(user_id,event_id) values(fu.installer_id,ev) on conflict do nothing;
    end if;
   else
    perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
    if not coalesce((fv->>'canCompleteInstall')::boolean,false) then raise exception 'The install is completed once its date is approved' using errcode='22023';end if;
    if not exists(select 1 from private.workspace_launch_files f where f.property_id=prop and f.step='setUp.install') then raise exception 'Upload photos of the finished install first' using errcode='22023';end if;
    update private.workspace_launch_furnishing set installed_at=now(),installed_by=me where property_id=prop;
    update private.workspace_furnishing_projects set status='complete',completed_at=now(),version=version+1,updated_at=now(),updated_by=me where id=fu.project_id and status in ('accepted','purchasing')
     returning version into n;
    if n is not null then
     insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail) values(fu.project_id,me,'moved','purchasing','complete',n,'{"from":"launch"}');
    end if;
    perform private.workspace_property_chat_post(prop,'Your furnishing is installed. The photos are in Launch Preparation.',null,'event',now());
    perform private.workspace_followup_note(prop,'Furnishing installed, with photos.',me);
    perform private.workspace_followup_tell(prop,'launch.furnished',now());
   end if;
  elsif input->>'action' in ('calculateInventory','decideInventory','approveInventory','checkInventory') then
   -- The inventory: the details in, the presets calculate each item (required or additional); additional items can be
   -- removed, and when Recharge sets up the owner decides them and approves the list; then each item is ticked as in the property.
   iv:=view->'inventory';
   part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'='setUp.inventory');
   if part is null or part->>'state'='locked' then raise exception '%',coalesce(part->>'lockedBecause','The inventory opens once the onboarding fee is settled') using errcode='22023';end if;
   if input->>'action'='calculateInventory' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','inputs'],8000);
    if not coalesce((iv->>'canCalculate')::boolean,false) then raise exception 'Recharge prepare this inventory' using errcode='42501';end if;
    x:=private.workspace_furnishing_inputs(input->'inputs');
    was:=coalesce((iv->>'rechargeSetsUp')::boolean,false);
    -- Recalculating asks the owner to approve again (Recharge's set-up); the owner's own list is agreed as they make it.
    insert into private.workspace_launch_inventory(property_id,inputs,calculated_at,calculated_by,approved_at,approved_by)
     values(prop,x,now(),me,case when not was then now() end,case when not was then me end)
     on conflict (property_id) do update set inputs=excluded.inputs,calculated_at=excluded.calculated_at,calculated_by=excluded.calculated_by,
      approved_at=excluded.approved_at,approved_by=excluded.approved_by;
    -- Items the details no longer need go; the rest keep their decision, and their tick unless more are now needed.
    delete from private.workspace_launch_inventory_items li where li.property_id=prop and not exists(select 1 from private.workspace_furnishing_items ci
     where ci.id=li.item_id and ci.active and ci.inventory in ('required','additional') and private.workspace_furnishing_quantity(x,ci.rule_basis,ci.rule_per,ci.rule_when)>0);
    insert into private.workspace_launch_inventory_items as cur(property_id,item_id,name,category,unit,kind,quantity,position,kept)
     select prop,ci.id,ci.name,ci.category,ci.unit,ci.inventory,qq.units,(row_number() over (order by array_position(array['bedroom','linen','bathroom','kitchen','living','windows',
       'appliances','cleaning','safety','outdoor','labour'],ci.category),ci.sort_order,ci.name))::int,case when ci.inventory='required' or not was then true end
     from private.workspace_furnishing_items ci cross join lateral (select private.workspace_furnishing_quantity(x,ci.rule_basis,ci.rule_per,ci.rule_when) units) qq
     where ci.active and ci.inventory in ('required','additional') and qq.units>0
    on conflict (property_id,item_id) do update set name=excluded.name,category=excluded.category,unit=excluded.unit,kind=excluded.kind,quantity=excluded.quantity,
     position=excluded.position,kept=case when excluded.kind='required' then true when cur.kind='required' then excluded.kept else coalesce(cur.kept,excluded.kept) end,
     checked_at=case when excluded.quantity>cur.quantity then null else cur.checked_at end,checked_by=case when excluded.quantity>cur.quantity then null else cur.checked_by end;
    get diagnostics n=row_count;
    if was and private.workspace_launch_inventory_released(prop) then
     waiting:=(select count(*) from private.workspace_launch_inventory_items li where li.property_id=prop and li.kept is null);
     perform private.workspace_property_chat_post(prop,'Your inventory is ready in Launch Preparation: '||n||' items'
      ||case when waiting>0 then ', '||waiting||' of them additional, for you to accept or reject' else '' end||'. Once you approve it, we make sure everything is in the property.',null,'event',now());
    end if;
   elsif input->>'action'='decideInventory' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','itemId','keep']);
    if not coalesce((iv->>'canDecide')::boolean,false) then raise exception '%',case when (iv->>'rechargeSetsUp')::boolean and not (view->>'isOwner')::boolean
     then 'The owner accepts or rejects the additional items'
     when not coalesce((iv->>'released')::boolean,true) then 'The inventory is with management, after the set-up inspection' else 'The inventory is already approved' end using errcode='42501';end if;
    if jsonb_typeof(input->'keep') is distinct from 'boolean' then raise exception 'Accept or reject the item' using errcode='22023';end if;
    begin item:=(input->>'itemId')::uuid; exception when others then item:=null; end;
    update private.workspace_launch_inventory_items li set kept=(input->>'keep')::boolean,decided_by=me,decided_at=now(),
     checked_at=case when (input->>'keep')::boolean then li.checked_at end,checked_by=case when (input->>'keep')::boolean then li.checked_by end
     where li.property_id=prop and li.item_id=item and li.kind='additional';
    if not found then raise exception 'Only additional items can be removed' using errcode='22023';end if;
   elsif input->>'action'='approveInventory' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
    if not coalesce((iv->>'canApprove')::boolean,false) then raise exception '%',case when coalesce((iv#>>'{counts,undecided}')::integer,0)>0
     then 'Accept or reject each additional item first' else 'There is no inventory waiting for your approval' end using errcode='22023';end if;
    update private.workspace_launch_inventory set approved_at=now(),approved_by=me where property_id=prop;
    perform private.workspace_property_chat_post(prop,'Inventory approved: '||(iv#>>'{counts,total}')||' items. We will make sure every one is in the property.',null,'event',now());
    perform private.workspace_followup_note(prop,'The owner approved the inventory ('||(iv#>>'{counts,total}')||' items). Tick each item as it is in the property.',me);
    perform private.workspace_followup_tell(prop,'launch.inventory_approved',now());
   else
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','itemId','present']);
    if not coalesce((iv->>'canCheck')::boolean,false) then raise exception '%',case when iv->>'approvedAt' is null and iv->>'calculatedAt' is not null
     then 'The inventory is waiting for the owner''s approval' else 'Only whoever sets the property up ticks the inventory' end using errcode='42501';end if;
    if jsonb_typeof(input->'present') is distinct from 'boolean' then raise exception 'Say whether the item is in the property' using errcode='22023';end if;
    begin item:=(input->>'itemId')::uuid; exception when others then item:=null; end;
    update private.workspace_launch_inventory_items li set checked_at=case when (input->>'present')::boolean then coalesce(li.checked_at,now()) end,
     checked_by=case when (input->>'present')::boolean then coalesce(li.checked_by,me) end where li.property_id=prop and li.item_id=item and li.kept;
    if not found then raise exception 'Item not found on the inventory' using errcode='22023';end if;
    if (input->>'present')::boolean and not exists(select 1 from private.workspace_launch_inventory_items li where li.property_id=prop and li.kept and li.checked_at is null) then
     perform private.workspace_property_chat_post(prop,'The inventory is complete: everything on it is in the property.',null,'event',now());
     perform private.workspace_followup_tell(prop,'launch.inventory_complete',now());
    end if;
   end if;
  elsif input->>'action' in ('bookGuidebook','saveGuidebook','submitGuidebook','reopenGuidebook','resetGuidebookLink') then
   -- The guidebook: the team book the technician; the technician (or the team) fills it in and submits it; the team can
   -- reopen it, and replace the guest link.
   gv:=view->'guidebook';
   select * into gb from private.workspace_launch_guidebooks where property_id=prop for update;
   if input->>'action'='bookGuidebook' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','technicianId','date']);
    if not coalesce((gv->>'canBook')::boolean,false) then raise exception 'The guidebook is booked once the property is guest ready' using errcode='22023';end if;
    begin who:=(input->>'technicianId')::uuid; exception when others then who:=null; end;
    if not exists(select 1 from public.workspace_profiles x where x.user_id=who and x.status='active' and x.role<>'client') then raise exception 'Choose the technician' using errcode='22023';end if;
    begin day:=(input->>'date')::date; exception when others then day:=null; end;
    if day is null or day<private.workspace_launch_today() then raise exception 'Choose a date from today' using errcode='22023';end if;
    was:=gb.technician_id is distinct from who;
    insert into private.workspace_launch_guidebooks(property_id,technician_id,book_on,booked_by,booked_at) values(prop,who,day,me,now())
     on conflict (property_id) do update set technician_id=excluded.technician_id,book_on=excluded.book_on,booked_by=excluded.booked_by,booked_at=excluded.booked_at;
    if was then
     insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(me,prop,'launch.guidebook_booked',now()) returning id into ev;
     insert into private.workspace_notification_outbox(user_id,event_id) values(who,ev) on conflict do nothing;
    end if;
    perform private.workspace_followup_note(prop,'Guidebook booked with '||coalesce(private.workspace_launch_person(who),'the technician')||' for '||to_char(day,'FMDay FMDD FMMonth')||'.',me);
   elsif input->>'action' in ('saveGuidebook','submitGuidebook') then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','content','wifiName','wifiPassword','guestCode','teamCode'],70000);
    if not coalesce((gv->>'canEdit')::boolean,false) then raise exception '%',case when gb.submitted_at is not null then 'The guidebook is submitted. Ask the team to reopen it'
     when gb.technician_id is null then 'Book the technician first' else 'Only the technician or the team fill in the guidebook' end using errcode='42501';end if;
    x:=input->'content';
    if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_each(x) e where e.key!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(e.value)<>'object'
     or exists(select 1 from jsonb_object_keys(e.value) k2 where k2 not in ('text','videoUrl'))
     or jsonb_typeof(coalesce(e.value->'text','""'))<>'string' or char_length(coalesce(e.value->>'text',''))>5000
     or jsonb_typeof(coalesce(e.value->'videoUrl','""'))<>'string' or (coalesce(e.value->>'videoUrl','')<>'' and (char_length(e.value->>'videoUrl')>1000 or (e.value->>'videoUrl')!~'^https://[^[:space:]]+$')))
     then raise exception 'Check the guidebook: up to 5,000 characters a section, and video links starting https://' using errcode='22023';end if;
    for c in select unnest(array['wifiName','wifiPassword','guestCode','teamCode']) loop
     if jsonb_typeof(coalesce(input->c,'""'))<>'string' or char_length(coalesce(input->>c,''))>(case when c like '%Code' then 60 else 120 end) then raise exception 'Check the Wi-Fi and key box codes' using errcode='22023';end if;
    end loop;
    -- Only the template's sections are kept, trimmed.
    x:=coalesce((select jsonb_object_agg(t->>'key',jsonb_build_object('text',btrim(coalesce(x#>>array[t->>'key','text'],'')),'videoUrl',btrim(coalesce(x#>>array[t->>'key','videoUrl'],''))))
     from jsonb_array_elements(private.workspace_launch_settings()->'guidebook') t),'{}');
    update private.workspace_launch_guidebooks set content=x,wifi_name=btrim(coalesce(input->>'wifiName','')),wifi_password=btrim(coalesce(input->>'wifiPassword','')),
     guest_code=btrim(coalesce(input->>'guestCode','')),team_code=btrim(coalesce(input->>'teamCode','')),saved_by=me,saved_at=now() where property_id=prop
     returning * into gb;
    if input->>'action'='submitGuidebook' then
     c:=(select string_agg(t->>'title',', ') from jsonb_array_elements(private.workspace_launch_settings()->'guidebook') t where coalesce(x#>>array[t->>'key','text'],'')='');
     if c is not null then raise exception 'Fill in every section first: %',c using errcode='22023';end if;
     update private.workspace_launch_guidebooks set submitted_at=now(),submitted_by=me where property_id=prop;
     -- The key box codes and how to get in go on the property's access details (what was there before is kept beneath).
     if gb.earlier_access is null then
      update private.workspace_launch_guidebooks set earlier_access=coalesce((select nullif(btrim(s2.access_instructions),'') from private.workspace_property_secrets s2 where s2.property_id=prop),'')
       where property_id=prop returning * into gb;
     end if;
     words:=concat_ws(E'\n',nullif(x#>>'{access,text}',''),case when gb.guest_code<>'' then 'Guest key box code: '||gb.guest_code end,
      case when gb.team_code<>'' then 'Team key box code: '||gb.team_code end,case when gb.earlier_access<>'' then E'\nEarlier notes:\n'||gb.earlier_access end);
     if words<>'' then
      insert into private.workspace_property_secrets(property_id,access_instructions) values(prop,left(words,10000))
       on conflict (property_id) do update set access_instructions=excluded.access_instructions,updated_at=now();
     end if;
     perform private.workspace_property_chat_post(prop,'Your guest guidebook is ready. You can open the guest version from Launch Preparation.',null,'event',now());
     perform private.workspace_followup_note(prop,'Guest guidebook completed. The key box codes are on the property''s access details.',me);
     perform private.workspace_followup_tell(prop,'launch.guidebook_done',now());
    end if;
   elsif input->>'action'='reopenGuidebook' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
    if not coalesce((gv->>'canReopen')::boolean,false) then raise exception '%',case when gb.submitted_at is null then 'The guidebook is not submitted' else 'Only the team reopen the guidebook' end using errcode='42501';end if;
    update private.workspace_launch_guidebooks set submitted_at=null,submitted_by=null where property_id=prop;
   else
    perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
    if not coalesce((gv->>'canResetLink')::boolean,false) then raise exception '%',case when gb.submitted_at is null then 'The guidebook is not submitted' else 'Only the team replace the guest link' end using errcode='42501';end if;
    update private.workspace_launch_guidebooks set token=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','') where property_id=prop;
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
   -- Inventory items marked missing are unticked on the inventory too.
   update private.workspace_launch_inventory_items li set checked_at=null,checked_by=null where li.property_id=prop and li.kept and li.quantity||' x '||li.name=any(missing);
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

-- 9. The inspection's actions.
create or replace function private.workspace_launch_inspection_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;iv jsonb;i private.workspace_launch_inspections;
 day date;who uuid;words text;fix text;n integer:=0;waiting integer;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','date','access','inspectorId','notes','repairs','note'],40000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 begin prop:=(input->>'propertyId')::uuid; exception when others then raise exception 'Property not found' using errcode='42501'; end;
 if prop is null then raise exception 'Property not found' using errcode='42501';end if;
 perform 1 from private.workspace_journeys where property_id=prop for update;
 view:=private.workspace_launch_view(prop);
 if view->'inspection' is null or jsonb_typeof(view->'inspection')<>'object' then raise exception 'The set-up inspection is for properties Recharge sets up' using errcode='22023';end if;
 if (select z->>'state' from jsonb_array_elements(view->'steps') z where z->>'key'='setUp.inspection')='locked' then raise exception 'Opens once the onboarding fee is settled.' using errcode='22023';end if;
 insert into private.workspace_launch_inspections(property_id) values(prop) on conflict do nothing;
 select * into i from private.workspace_launch_inspections where property_id=prop for update;
 if i.approved_at is not null then raise exception 'The inspection is already approved' using errcode='22023';end if;
 if input->>'action'='setInspectionAccess' then
  -- The first day the property can be got into, and how.
  if not coalesce((view#>>'{inspection,canSetAccess}')::boolean,false) then raise exception 'Only the owner or the team give the access' using errcode='42501';end if;
  begin day:=(input->>'date')::date; exception when others then raise exception 'Choose the date' using errcode='22023'; end;
  if day is null or coalesce(input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the date' using errcode='22023';end if;
  if day<private.workspace_launch_today() or day>private.workspace_launch_today()+365 then raise exception 'Choose a date from today, within the next year' using errcode='22023';end if;
  words:=btrim(coalesce(input->>'access',''));
  if jsonb_typeof(input->'access') is distinct from 'string' or char_length(words) not between 3 and 2000 then raise exception 'Say how to get into the property' using errcode='22023';end if;
  update private.workspace_launch_inspections set access_on=day,access=words,access_by=me,access_at=now() where property_id=prop;
  if coalesce((view->>'isOwner')::boolean,false) then
   perform private.workspace_followup_note(prop,'The owner can give access for the set-up inspection from '||to_char(day,'FMDay FMDD FMMonth YYYY')||'. Book the inspector.',me);
  end if;
 elsif input->>'action'='bookInspection' then
  -- The property operations coordinator books the inspector and the date; the owner is told.
  if not coalesce((view#>>'{inspection,canBook}')::boolean,false) then
   raise exception '%',case when i.submitted_at is not null then 'The inspection report is already in' else 'Only the team book the inspection' end using errcode='42501';end if;
  if i.access_on is null then raise exception 'Add the date and access from the owner first' using errcode='22023';end if;
  begin who:=(input->>'inspectorId')::uuid; exception when others then raise exception 'Choose the inspector' using errcode='22023'; end;
  if who is null or not exists(select 1 from public.workspace_profiles x where x.user_id=who and x.status='active' and x.role<>'client') then raise exception 'Choose the inspector' using errcode='22023';end if;
  begin day:=(input->>'date')::date; exception when others then raise exception 'Choose the inspection date' using errcode='22023'; end;
  if day is null or coalesce(input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the inspection date' using errcode='22023';end if;
  if day<greatest(private.workspace_launch_today(),i.access_on) or day>private.workspace_launch_today()+365 then
   raise exception 'Choose a date from %, within the next year',to_char(greatest(private.workspace_launch_today(),i.access_on),'FMDD FMMonth YYYY') using errcode='22023';end if;
  update private.workspace_launch_inspections set inspector_id=who,inspect_on=day,booked_by=me,booked_at=now() where property_id=prop;
  perform private.workspace_property_chat_post(prop,case when i.inspect_on is null then 'Your set-up inspection is booked for ' else 'Your set-up inspection has moved to ' end
   ||to_char(day,'FMDay FMDD FMMonth YYYY')||'. We will check the furnishing and the condition, then send you the inventory.',null,'event',now());
  perform private.workspace_followup_note(prop,coalesce(private.workspace_launch_person(who),'The inspector')||' will do the set-up inspection on '||to_char(day,'FMDay FMDD FMMonth YYYY')||'.',me);
 elsif input->>'action'='submitInspection' then
  -- The inspector's report: the inventory calculated from the property's details, notes, and the repairs found.
  if not coalesce((view#>>'{inspection,canSubmit}')::boolean,false) then
   raise exception '%',case when i.inspector_id is null then 'Book the inspector first' when i.submitted_at is not null then 'The inspection report is already in'
    else 'Only the inspector or the team submit the inspection' end using errcode='42501';end if;
  iv:=view->'inventory';
  if iv is null or iv->>'calculatedAt' is null then raise exception 'Calculate the inventory from the property''s details first' using errcode='22023';end if;
  words:=btrim(coalesce(input->>'notes',''));
  if jsonb_typeof(coalesce(input->'notes','""'))<>'string' or char_length(words)>4000 then raise exception 'Keep the notes under 4,000 characters' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'repairs','[]'))<>'array' or jsonb_array_length(coalesce(input->'repairs','[]'))>30
   or exists(select 1 from jsonb_array_elements(coalesce(input->'repairs','[]')) m where jsonb_typeof(m)<>'string' or char_length(btrim(m#>>'{}')) not between 3 and 300) then
   raise exception 'Describe each repair in 3 to 300 characters' using errcode='22023';end if;
  -- Each repair goes to property maintenance (the repair flow), as the condition check's do.
  for fix in select btrim(m) from jsonb_array_elements_text(coalesce(input->'repairs','[]')) m loop
   perform private.workspace_launch_repair(prop,'Set-up inspection: '||fix);n:=n+1;
  end loop;
  update private.workspace_launch_inspections set notes=words,repairs=repairs+n,submitted_by=me,submitted_at=now(),returned_note='' where property_id=prop;
  perform private.workspace_followup_note(prop,'Set-up inspection report in'||case when n>0 then ', with '||n||case when n=1 then ' repair' else ' repairs' end||' sent to property maintenance' else '' end
   ||'. It needs management approval before the owner sees the inventory.',me);
 elsif input->>'action'='approveInspection' then
  -- Management approve the report, which sends the inventory to the owner.
  if not coalesce((view#>>'{inspection,canApprove}')::boolean,false) then
   raise exception '%',case when actor not in ('admin','super_admin') then 'Management approve the inspection' else 'There is no inspection report waiting' end using errcode='42501';end if;
  update private.workspace_launch_inspections set approved_by=me,approved_at=now() where property_id=prop;
  waiting:=(select count(*) from private.workspace_launch_inventory_items li where li.property_id=prop and li.kept is null);
  perform private.workspace_property_chat_post(prop,'Your inventory is ready in Launch Preparation: '||(coalesce((view#>>'{inventory,counts,total}')::integer,0)+waiting)||' items'
   ||case when waiting>0 then ', '||waiting||' of them additional, for you to accept or reject' else '' end||'. Once you approve it, we make sure everything is in the property.',null,'event',now());
  perform private.workspace_followup_note(prop,'Management approved the set-up inspection. The owner has the inventory to approve.',me);
 elsif input->>'action'='returnInspection' then
  if not coalesce((view#>>'{inspection,canApprove}')::boolean,false) then
   raise exception '%',case when actor not in ('admin','super_admin') then 'Management review the inspection' else 'There is no inspection report waiting' end using errcode='42501';end if;
  words:=btrim(coalesce(input->>'note',''));
  if jsonb_typeof(input->'note') is distinct from 'string' or char_length(words) not between 3 and 1000 then raise exception 'Say what needs changing' using errcode='22023';end if;
  update private.workspace_launch_inspections set submitted_by=null,submitted_at=null,returned_note=words where property_id=prop;
  perform private.workspace_followup_note(prop,'Management sent the set-up inspection back: '||words,me);
 else
  raise exception 'Unknown Launch Preparation action' using errcode='22023';
 end if;
 result:=private.workspace_launch_read(prop);
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 10. One way in.
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select case when input->>'action' in ('addGardenQuote','decideGardenQuote') then private.workspace_launch_garden_action(input)
  when input->>'action'='reportCondition' then private.workspace_launch_condition_action(input)
  when input->>'action' in ('setBroadbandDate','assignBroadbandTech','completeBroadband') then private.workspace_launch_broadband_action(input)
  when input->>'action'='saveLaunchAssignee' then private.workspace_launch_assignee_action(input)
  when input->>'action' in ('setInspectionAccess','bookInspection','submitInspection','approveInspection','returnInspection') then private.workspace_launch_inspection_action(input)
  else private.workspace_launch_action(input) end;
$$;

revoke all on function private.workspace_launch_inventory_released(uuid),private.workspace_launch_inspection_view(uuid,jsonb,boolean,boolean,boolean),
 private.workspace_launch_inspection_action(jsonb),private.workspace_launch_plan(uuid),private.workspace_launch_inventory_view(uuid,boolean,boolean,boolean,boolean),
 private.workspace_launch_view(uuid),private.workspace_launch_read(uuid),private.workspace_launch_action(jsonb),public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_inspection_action(jsonb),private.workspace_launch_read(uuid),private.workspace_launch_action(jsonb),public.workspace_launch_action(jsonb) to authenticated;
