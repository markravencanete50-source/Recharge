-- Launch Preparation: broadband set up by Recharge (Business Plan v1.0, 17/10/26, Broadband ii. Broadband Set Up).
--  * When the owner asked Recharge to set up the broadband, the owner (or the team) gives the install date, the property
--    operations coordinator (the team) assigns the technician, and once installed the technician (or the team) resets the
--    Wi-Fi name to Recharge and the property's address and the password (ChargeTheInternet123!, both editable), confirms the
--    Wi-Fi portal is collecting data, and saves them. The Wi-Fi name and password go into the property's details (the
--    guidebook's Wi-Fi), which ticks the part and completes its mirrored ticket. The owner is told in the property chat
--    and the team in the follow-up notes.
--  * The technician sees the properties on Home and can open their checklist.
--  * The part is no longer ticked by hand, or completed on its board; parts ticked before stay done.
-- Replaces private.workspace_launch_plan (20261029800000), private.workspace_launch_view (20261029900000),
-- private.workspace_launch_read (20261029500000) and the public workspace_launch_action wrapper. Safe to run twice.

-- 1. The set-up.
create table if not exists private.workspace_launch_broadband (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 install_on date,
 install_set_by uuid references auth.users(id) on delete set null,
 install_set_at timestamptz,
 technician_id uuid references public.workspace_profiles(user_id) on delete set null,
 assigned_by uuid references auth.users(id) on delete set null,
 assigned_at timestamptz,
 wifi_name text not null default '' check (char_length(wifi_name)<=120),
 portal boolean not null default false,
 installed_by uuid references auth.users(id) on delete set null,
 installed_at timestamptz
);
create index if not exists workspace_launch_broadband_technician on private.workspace_launch_broadband(technician_id) where installed_at is null;
alter table private.workspace_launch_broadband enable row level security;
revoke all on private.workspace_launch_broadband from public,anon,authenticated,service_role;

-- 2. What each person sees: the date, the technician, the Wi-Fi (the team, the technician and the owner), the suggested
-- Wi-Fi name and password, and what they can do.
create or replace function private.workspace_launch_broadband_view(prop uuid,plan jsonb,team boolean,owner boolean,tech boolean,address text) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare s jsonb;b private.workspace_launch_broadband;todo boolean;begin
 s:=(select z from jsonb_array_elements(plan) z where z->>'key'='broadband.setUp');
 if s is null or s->>'kind'<>'broadband' or not (team or owner or tech) then return null;end if;
 select * into b from private.workspace_launch_broadband where property_id=prop;
 todo:=s->>'state'='todo';
 return jsonb_build_object('installOn',b.install_on,'installSetByName',private.workspace_launch_person(b.install_set_by),
  'technician',case when b.technician_id is null then null else jsonb_build_object('id',b.technician_id,'name',coalesce(private.workspace_launch_person(b.technician_id),'Technician')) end,
  'assignedByName',private.workspace_launch_person(b.assigned_by),'wifiName',nullif(b.wifi_name,''),
  'wifiPassword',(select nullif(g.wifi_password,'') from private.workspace_launch_guidebooks g where g.property_id=prop and b.installed_at is not null),
  'portal',coalesce(b.portal,false),'installedAt',b.installed_at,'installedByName',private.workspace_launch_person(b.installed_by),
  'suggestedWifiName',left('Recharge '||btrim(split_part(coalesce(address,''),E'\n',1)),120),'suggestedWifiPassword','ChargeTheInternet123!',
  'canSetDate',(team or owner) and todo,'canAssign',team and todo,'canComplete',(team or tech) and todo and b.technician_id is not null);
end $fn$;

-- 3. The checklist: Recharge's broadband set-up is its own kind of part.
create or replace function private.workspace_launch_plan(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare j private.workspace_journeys;a jsonb;ps jsonb;steps jsonb:='[]';started boolean;rs boolean;r private.workspace_launch_readiness;
 ph private.workspace_listing_photography;fee text:='Opens once the onboarding fee is settled.';pre boolean;ready boolean;received boolean;listed boolean;doc text;
 hk boolean;fu private.workspace_launch_furnishing;quoted boolean;fordered boolean;freceived boolean;inv boolean;gb private.workspace_launch_guidebooks;begin
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
 steps:=steps||private.workspace_launch_step(prop,'setUp.inspection','setUp','Set-up inspection booked, with the date and access',case when rs then 'recharge' else 'client' end,'date',null,started,fee)
  ||private.workspace_launch_step(prop,'setUp.inventory','setUp','Inventory calculated, agreed and complete',case when rs then 'recharge' else 'client' end,'inventory',case when inv then 'done' else 'todo' end,started,fee)
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

-- 4. The view: the technician can open the property's checklist, and it carries the set-up.
create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;fitter boolean;buyer boolean;writer boolean;tech boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
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
 if j.property_id is null or not (team or owner or keeper or fitter or buyer or writer or tech) then raise exception 'Property not found' using errcode='42501';end if;
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
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper or fitter or buyer or writer or tech then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper or fitter or writer or tech then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isBroadbandTech',tech,'isOwner',owner,'isHousekeeper',keeper,'isInstaller',fitter,'isAccounts',buyer,'isTechnician',writer,
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

-- 5. The read: the technician's broadband set-ups.
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
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;

-- 6. The actions.
create or replace function private.workspace_launch_broadband_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;b private.workspace_launch_broadband;
 day date;who uuid;nm text;pw text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','date','technicianId','wifiName','wifiPassword','portal'],20000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 begin prop:=(input->>'propertyId')::uuid; exception when others then raise exception 'Property not found' using errcode='42501'; end;
 if prop is null then raise exception 'Property not found' using errcode='42501';end if;
 perform 1 from private.workspace_journeys where property_id=prop for update;
 view:=private.workspace_launch_view(prop);
 part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'='broadband.setUp');
 if part is null or part->>'kind'<>'broadband' then raise exception 'The owner has not asked Recharge to set up the broadband' using errcode='22023';end if;
 if part->>'state'='locked' then raise exception '%',coalesce(part->>'lockedBecause','Not open yet') using errcode='22023';end if;
 if part->>'state'<>'todo' then raise exception 'The broadband is already set up' using errcode='22023';end if;
 insert into private.workspace_launch_broadband(property_id) values(prop) on conflict do nothing;
 select * into b from private.workspace_launch_broadband where property_id=prop for update;
 if input->>'action'='setBroadbandDate' then
  if not coalesce((view#>>'{broadband,canSetDate}')::boolean,false) then raise exception 'Only the owner or the team give the install date' using errcode='42501';end if;
  begin day:=(input->>'date')::date; exception when others then raise exception 'Choose the install date' using errcode='22023'; end;
  if day is null or coalesce(input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the install date' using errcode='22023';end if;
  if day<private.workspace_launch_today() then raise exception 'Choose a date from today' using errcode='22023';end if;
  update private.workspace_launch_broadband set install_on=day,install_set_by=me,install_set_at=now() where property_id=prop;
  if coalesce((view->>'isOwner')::boolean,false) then
   perform private.workspace_followup_note(prop,'The owner says the broadband is being installed on '||to_char(day,'FMDay FMDD FMMonth YYYY')||'.',me);
  else
   perform private.workspace_property_chat_post(prop,'Your broadband install is booked for '||to_char(day,'FMDay FMDD FMMonth YYYY')||'.',null,'event',now());
  end if;
 elsif input->>'action'='assignBroadbandTech' then
  if not coalesce((view#>>'{broadband,canAssign}')::boolean,false) then raise exception 'Only the team assign the technician' using errcode='42501';end if;
  begin who:=(input->>'technicianId')::uuid; exception when others then raise exception 'Choose the technician' using errcode='22023'; end;
  if who is null or not exists(select 1 from public.workspace_profiles x where x.user_id=who and x.status='active' and x.role<>'client') then raise exception 'Choose the technician' using errcode='22023';end if;
  update private.workspace_launch_broadband set technician_id=who,assigned_by=me,assigned_at=now() where property_id=prop;
  perform private.workspace_followup_note(prop,coalesce(private.workspace_launch_person(who),'The technician')||' will set up the broadband and the Wi-Fi.',me);
 elsif input->>'action'='completeBroadband' then
  if not coalesce((view#>>'{broadband,canComplete}')::boolean,false) then
   raise exception '%',case when b.technician_id is null then 'Assign the technician first' else 'Only the technician or the team complete the broadband set-up' end using errcode='42501';end if;
  nm:=btrim(coalesce(input->>'wifiName',''));pw:=coalesce(input->>'wifiPassword','');
  if jsonb_typeof(input->'wifiName') is distinct from 'string' or char_length(nm) not between 1 and 120 then raise exception 'Enter the Wi-Fi name' using errcode='22023';end if;
  if jsonb_typeof(input->'wifiPassword') is distinct from 'string' or char_length(pw) not between 8 and 63 or pw<>btrim(pw) then
   raise exception 'The Wi-Fi password needs 8 to 63 characters' using errcode='22023';end if;
  if input->'portal' is distinct from 'true'::jsonb then raise exception 'Set up the Wi-Fi portal first' using errcode='22023';end if;
  update private.workspace_launch_broadband set wifi_name=nm,portal=true,installed_by=me,installed_at=now() where property_id=prop;
  -- The property's Wi-Fi, as the guidebook shows it.
  insert into private.workspace_launch_guidebooks(property_id,wifi_name,wifi_password) values(prop,nm,pw)
   on conflict(property_id) do update set wifi_name=excluded.wifi_name,wifi_password=excluded.wifi_password;
  perform private.workspace_launch_sync(prop);
  perform private.workspace_property_chat_post(prop,'Your broadband is installed and the Wi-Fi is set up.',null,'event',now());
  perform private.workspace_followup_note(prop,'Broadband installed. Wi-Fi '||nm||', with the portal collecting data.',me);
 else
  raise exception 'Unknown Launch Preparation action' using errcode='22023';
 end if;
 result:=private.workspace_launch_read(prop);
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 7. One way in.
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select case when input->>'action' in ('addGardenQuote','decideGardenQuote') then private.workspace_launch_garden_action(input)
  when input->>'action'='reportCondition' then private.workspace_launch_condition_action(input)
  when input->>'action' in ('setBroadbandDate','assignBroadbandTech','completeBroadband') then private.workspace_launch_broadband_action(input)
  else private.workspace_launch_action(input) end;
$$;

revoke all on function private.workspace_launch_broadband_view(uuid,jsonb,boolean,boolean,boolean,text),private.workspace_launch_broadband_action(jsonb),
 private.workspace_launch_plan(uuid),private.workspace_launch_view(uuid),private.workspace_launch_read(uuid),public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_broadband_action(jsonb),private.workspace_launch_read(uuid),public.workspace_launch_action(jsonb) to authenticated;
