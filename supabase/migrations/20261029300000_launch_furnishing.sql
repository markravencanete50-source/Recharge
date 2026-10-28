-- Launch Preparation, round three: the furnishing order and install (Business Plan v1.0, 17/10/26, Property Set-Up (R) Order
-- and (R) Install), when Recharge sets the property up. It builds on the Furnishing Studio (20261023200000):
--  * Quote: the team send one or more quotes from the Furnishing Studio for the property (for example a standard and an
--    enhanced package). The owner sees each in Launch Preparation and approves one (any other is declined) or declines it
--    with a note, and the team revise and send again.
--  * Invoice: approving opens the invoice in Accounts > Receivable for the approved amount. When accounts send it the owner
--    is told; when it is paid the furnishing is settled and the quote moves to purchasing.
--  * Order: the team assign the installer (any active team member, the Furniture Install Technician) and the delivery
--    address. Accounts (or the team) order each item with its expected delivery date; the Furnishing Studio's shopping list
--    is ticked at the same time. Once everything is ordered the owner is told the last delivery date.
--  * Received: the installer (or the team) ticks off each item as it arrives, with a photo of it (an admin setting).
--  * Install: the installer proposes the install date and the team approve it (a date set by the team needs no approval);
--    the owner is told. The installer finishes with photos of the completed work, which completes the quote.
-- The order, delivery and install are mirrored on the furnishing board (Recharge Purchase Orders by default; an admin
-- setting). The Launch Preparation functions from 20261029200000 are replaced. Safe to run twice.

-- 1. Settings: the furnishing board and whether each received item needs a photo (stored settings keep theirs).
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
   "guidebook":"new-property-inspection-board","pricing":"daily-pricing","social":"listing-health","photography":"listing-health","waste":"routine-bin-garden-board","furnishing":"purchase-order"},
  "requireReceivedPhotos":true
 }$json$::jsonb
$fn$;

-- 2. The approved quote and each item's order and delivery.
create table if not exists private.workspace_launch_furnishing (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 project_id uuid not null references private.workspace_furnishing_projects(id),
 invoice_item_id uuid unique references private.workspace_hub_items(id) on delete set null,
 accepted_at timestamptz not null default now(),
 accepted_by uuid references auth.users(id) on delete set null,
 invoice_sent_at timestamptz,
 settled_at timestamptz,
 installer_id uuid references public.workspace_profiles(user_id) on delete set null,
 delivery_address text check (delivery_address is null or char_length(delivery_address) between 5 and 500),
 install_on date,
 install_proposed_by uuid references auth.users(id) on delete set null, install_proposed_at timestamptz,
 install_approved_by uuid references auth.users(id) on delete set null, install_approved_at timestamptz,
 installed_by uuid references auth.users(id) on delete set null, installed_at timestamptz
);
create index if not exists workspace_launch_furnishing_installer on private.workspace_launch_furnishing(installer_id) where installed_at is null;
create table if not exists private.workspace_launch_furnishing_lines (
 line_id uuid primary key references private.workspace_furnishing_lines(id) on delete cascade,
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 ordered_at timestamptz not null default now(),
 ordered_by uuid references auth.users(id) on delete set null,
 eta date not null,
 received_at timestamptz,
 received_by uuid references auth.users(id) on delete set null
);
create index if not exists workspace_launch_furnishing_lines_property on private.workspace_launch_furnishing_lines(property_id);
alter table private.workspace_launch_furnishing enable row level security;
alter table private.workspace_launch_furnishing_lines enable row level security;
revoke all on private.workspace_launch_furnishing,private.workspace_launch_furnishing_lines from public,anon,authenticated,service_role;
-- Photos of furnishing as it arrives (one item each) and of the finished install go with the certificates.
alter table private.workspace_launch_files add column if not exists line_id uuid references private.workspace_furnishing_lines(id) on delete cascade;
alter table private.workspace_launch_files drop constraint if exists workspace_launch_files_step_check;
alter table private.workspace_launch_files add constraint workspace_launch_files_step_check check (step~'^(compliance:[a-z0-9-]{1,40}|setUp\.(received|install))$');
create index if not exists workspace_launch_files_line on private.workspace_launch_files(line_id) where line_id is not null;

-- What is bought for the property: the approved quote's lines, less what the property already has.
create or replace function private.workspace_launch_buy(prop uuid) returns setof private.workspace_furnishing_lines language sql stable security definer set search_path='' as $$
 select l.* from private.workspace_launch_furnishing f join private.workspace_furnishing_projects q on q.id=f.project_id
  join private.workspace_furnishing_lines l on l.project_id=q.id and l.revision=q.line_revision
 where f.property_id=prop and l.packs>0
$$;

-- The furnishing part of a property's checklist. Prices and suppliers stay with the team and accounts; the owner sees the
-- quotes, what was ordered and when it is due, and the photos.
create or replace function private.workspace_launch_furnishing_view(prop uuid,team boolean,owner boolean,fitter boolean,buyer boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare f private.workspace_launch_furnishing;q private.workspace_furnishing_projects;h private.workspace_hub_items;inside boolean:=team or fitter or buyer;
 total integer;ordered integer;received integer;photos jsonb;begin
 select * into f from private.workspace_launch_furnishing where property_id=prop;
 select * into q from private.workspace_furnishing_projects where id=f.project_id;
 select * into h from private.workspace_hub_items where id=f.invoice_item_id;
 select count(*)::int,count(o.ordered_at)::int,count(o.received_at)::int into total,ordered,received
  from private.workspace_launch_buy(prop) b left join private.workspace_launch_furnishing_lines o on o.line_id=b.id;
 photos:=coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'mime',x.mime,'uploadedAt',x.created_at) order by x.created_at,x.id)
  from private.workspace_launch_files x where x.property_id=prop and x.step='setUp.install'),'[]');
 return jsonb_build_object(
  'quotes',case when team or owner then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'number',x.number,'status',x.status,'quotePence',x.quote_pence,
    'subtotalPence',x.subtotal_pence,'vatPence',x.vat_pence,'notes',x.notes,'sentAt',x.sent_at,
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('name',l.name,'category',l.category,'units',l.units-l.existing_units,'pricePence',l.price_pence) order by l.position),'[]')
     from private.workspace_furnishing_lines l where l.project_id=x.id and l.revision=x.line_revision and l.packs>0)) order by x.sent_at desc nulls last,x.number)
   from private.workspace_furnishing_projects x where x.property_id=prop and not x.archived and x.status in ('sent','accepted','purchasing','complete')),'[]') else '[]' end,
  'projectId',f.project_id,'number',q.number,'quotePence',q.quote_pence,'acceptedAt',f.accepted_at,'acceptedByName',private.workspace_launch_person(f.accepted_by),
  'invoiceStatus',h.status,'settledAt',f.settled_at,
  'installer',case when f.installer_id is null then null else jsonb_build_object('id',f.installer_id,'name',coalesce(private.workspace_launch_person(f.installer_id),'Installer')) end,
  'deliveryAddress',case when inside then f.delivery_address end,
  'lines',case when f.property_id is null then '[]' else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'units',b.units-b.existing_units,
    'packs',b.packs,'unit',b.unit,'supplier',case when inside then b.supplier end,'productUrl',case when team or buyer then b.product_url end,
    'orderedAt',o.ordered_at,'eta',o.eta,'receivedAt',o.received_at,'receivedByName',private.workspace_launch_person(o.received_by),
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'mime',x.mime,'uploadedAt',x.created_at) order by x.created_at,x.id)
     from private.workspace_launch_files x where x.property_id=prop and x.line_id=b.id),'[]')) order by b.position)
   from private.workspace_launch_buy(prop) b left join private.workspace_launch_furnishing_lines o on o.line_id=b.id),'[]') end,
  'counts',jsonb_build_object('total',total,'ordered',ordered,'received',received),
  'installOn',f.install_on,'installProposedByName',private.workspace_launch_person(f.install_proposed_by),'installApprovedAt',f.install_approved_at,
  'installedAt',f.installed_at,'installedByName',private.workspace_launch_person(f.installed_by),'installPhotos',photos,
  'canDecide',(team or owner) and f.property_id is null
   and exists(select 1 from private.workspace_furnishing_projects x where x.property_id=prop and x.status='sent' and not x.archived),
  'canAssign',team and f.settled_at is not null and f.installed_at is null,
  'canOrder',(team or buyer) and f.settled_at is not null and f.installer_id is not null and f.delivery_address is not null and f.installed_at is null and received<total,
  'canReceive',(team or fitter) and ordered>received,
  'canProposeInstall',(team or fitter) and f.settled_at is not null and f.installer_id is not null and received=total and ordered=total and f.installed_at is null,
  'canApproveInstall',team and f.install_on is not null and f.install_approved_at is null and f.installed_at is null,
  'canCompleteInstall',(team or fitter) and f.install_approved_at is not null and f.installed_at is null);
end $fn$;

-- 3. The checklist, reading, and the actions (replacing 20261029100000's plan and 20261029200000's view, read and actions).
create or replace function private.workspace_launch_plan(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare j private.workspace_journeys;a jsonb;ps jsonb;steps jsonb:='[]';started boolean;rs boolean;r private.workspace_launch_readiness;
 ph private.workspace_listing_photography;fee text:='Opens once the onboarding fee is settled.';pre boolean;ready boolean;received boolean;listed boolean;doc text;
 hk boolean;fu private.workspace_launch_furnishing;quoted boolean;fordered boolean;freceived boolean;begin
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

create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;fitter boolean;buyer boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 select * into r from private.workspace_launch_readiness where property_id=prop;
 team:=coalesce(actor is not null and private.workspace_can_enquiries(),false);
 owner:=coalesce(j.client_id=auth.uid(),false);
 keeper:=coalesce(actor='cleans' and r.housekeeper_id=auth.uid(),false);
 -- The furnishing installer, and accounts once there is furnishing to order.
 fitter:=coalesce((select x.installer_id=auth.uid() from private.workspace_launch_furnishing x where x.property_id=prop),false);
 buyer:=coalesce(actor='accounts' and exists(select 1 from private.workspace_launch_furnishing x where x.property_id=prop and x.settled_at is not null),false);
 if j.property_id is null or not (team or owner or keeper or fitter or buyer) then raise exception 'Property not found' using errcode='42501';end if;
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
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper or fitter or buyer then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper or fitter then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isOwner',owner,'isHousekeeper',keeper,'isInstaller',fitter,'isAccounts',buyer,
  'furnishing',private.workspace_launch_furnishing_view(prop,team,owner,fitter,buyer),
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
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;

create or replace function private.workspace_launch_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;j private.workspace_journeys;
 r private.workspace_launch_readiness;s jsonb;x jsonb;keys text[];hk uuid;day date;n integer:=0;crosses text[]:='{}';missing text[]:='{}';ev bigint;video text;c text;fu private.workspace_launch_furnishing;fv jsonb;q private.workspace_furnishing_projects;item uuid;who uuid;other record;was boolean;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data','housekeeperId','date','inventory','condition','evidence','settings','fileId','name','mime','bytes','path','lineId','projectId','decision','note','installerId','deliveryAddress','lines'],60000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings'],60000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change Launch Preparation' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['condition','notes','requireVideo','requireComplianceFile','reminderMonths','boards','requireReceivedPhotos'],60000);
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
  if jsonb_typeof(s->'requireVideo') is distinct from 'boolean' or jsonb_typeof(s->'requireComplianceFile') is distinct from 'boolean' or jsonb_typeof(s->'requireReceivedPhotos') is distinct from 'boolean'
   or jsonb_typeof(s->'reminderMonths') is distinct from 'number' or (s->>'reminderMonths')::numeric not in (1,2,3,4,5,6) then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(s->'boards') is distinct from 'object' or exists(select 1 from jsonb_each(s->'boards') b where b.key not in
   ('setUp','broadband','utilities','compliance','licensing','housekeeper','readiness','photography','garden','waste','guidebook','listing','pricing','social','furnishing')
   or jsonb_typeof(b.value)<>'string' or (b.value#>>'{}'<>'' and not exists(select 1 from public.workspace_features f where f.module_id=b.value#>>'{}'))) then raise exception 'Choose a board for each part' using errcode='22023';end if;
  s:=jsonb_build_object('condition',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'text',btrim(z->>'text'))) from jsonb_array_elements(s->'condition') z),
   'notes',(select coalesce(jsonb_object_agg(n.key,btrim(n.value#>>'{}')),'{}') from jsonb_each(s->'notes') n),'requireVideo',s->'requireVideo',
   'requireComplianceFile',s->'requireComplianceFile','reminderMonths',(s->>'reminderMonths')::integer,'boards',s->'boards','requireReceivedPhotos',s->'requireReceivedPhotos');
  update private.workspace_launch_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_launch_read(null);
 elsif input->>'action' in ('tick','reopen','allocate','bookReadiness','submitReadiness','addFile','removeFile','decideQuote','assignInstaller','orderLines','receiveLine','proposeInstall','approveInstall','completeInstall') then
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
   if part->>'key'='setUp.received' then
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
    if input->>'mime'='application/pdf' and part->>'section'='setUp' then raise exception 'Upload a photo' using errcode='22023';end if;
    insert into private.workspace_launch_files(id,property_id,step,path,name,mime,bytes,uploaded_by,line_id)
     values((input->>'fileId')::uuid,prop,part->>'key',input->>'path',left(coalesce(nullif(btrim(input->>'name'),''),case when part->>'section'='setUp' then 'Photo' else 'Certificate' end),200),
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

-- 4. The furnishing invoice moving in Receivable: sent tells the owner; paid settles it and the quote moves to purchasing.
create or replace function private.workspace_launch_invoice_moved() returns trigger language plpgsql security definer set search_path='' as $fn$
declare f private.workspace_launch_furnishing;v integer;begin
 select * into f from private.workspace_launch_furnishing where invoice_item_id=new.id;
 if f.property_id is null or new.status is not distinct from old.status then return new;end if;
 if new.status='sent' and f.invoice_sent_at is null then
  update private.workspace_launch_furnishing set invoice_sent_at=now() where property_id=f.property_id;
  perform private.workspace_property_chat_post(f.property_id,'The furnishing invoice has been sent'||case when new.amount_minor is null then '' else ' for '||private.workspace_fee_money(new.amount_minor) end
   ||'. Once it is settled, we order everything.',null,'event',now());
 elsif new.status='paid' and f.settled_at is null then
  update private.workspace_launch_furnishing set settled_at=now(),invoice_sent_at=coalesce(invoice_sent_at,now()) where property_id=f.property_id;
  update private.workspace_furnishing_projects set status='purchasing',version=version+1,updated_at=now() where id=f.project_id and status='accepted' returning version into v;
  if v is not null then
   insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail)
    values(f.project_id,(select p.user_id from public.workspace_profiles p where p.user_id=auth.uid()),'moved','accepted','purchasing',v,'{"from":"receivable"}');
  end if;
  perform private.workspace_property_chat_post(f.property_id,'Thank you, the furnishing invoice is settled. We are ordering everything now and will share the delivery dates.',null,'event',now());
  perform private.workspace_followup_note(f.property_id,'Furnishing invoice settled. Assign the installer and the delivery address so accounts can order.',auth.uid());
  perform private.workspace_followup_tell(f.property_id,'launch.furnishing_settled',now());
 end if;
 return new;
end $fn$;
drop trigger if exists workspace_launch_invoice_moved on private.workspace_hub_items;
create trigger workspace_launch_invoice_moved after update of status on private.workspace_hub_items for each row execute function private.workspace_launch_invoice_moved();

-- 5. The mirrored tickets, now with the furnishing order, delivery and install.
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
  elsif s->>'state'='todo' and w is null and s->>'who'='recharge'
   and (s->>'section' not in ('setUp','garden','housekeeper','licensing','listing') or s->>'key' in ('setUp.order','setUp.received','setUp.install')) then
   -- The furnishing order, delivery and install go on the furnishing board (purchase orders by default).
   board:=nullif(boards->>(case when s->>'section'='setUp' then 'furnishing' else s->>'section' end),'');
   if board is not null and exists(select 1 from public.workspace_features f where f.module_id=board) then
    w:=private.workspace_handover_now(prop,board,left(place||': '||(s->>'title'),200),'launch_step',jsonb_build_object('step',s->>'key','section',s->>'section','kind',s->>'kind'));
    insert into private.workspace_launch_tickets(property_id,step,work_id) values(prop,s->>'key',w);
   end if;
  end if;
 end loop;
end $fn$;
drop trigger if exists workspace_launch_sync on private.workspace_launch_furnishing;
create trigger workspace_launch_sync after insert or update on private.workspace_launch_furnishing for each row execute function private.workspace_launch_sync_trigger();
drop trigger if exists workspace_launch_sync on private.workspace_launch_furnishing_lines;
create trigger workspace_launch_sync after insert or update on private.workspace_launch_furnishing_lines for each row execute function private.workspace_launch_sync_trigger();

revoke all on function private.workspace_launch_settings_default(),private.workspace_launch_buy(uuid),private.workspace_launch_furnishing_view(uuid,boolean,boolean,boolean,boolean),
 private.workspace_launch_plan(uuid),private.workspace_launch_view(uuid),private.workspace_launch_read(uuid),private.workspace_launch_action(jsonb),
 private.workspace_launch_invoice_moved(),private.workspace_launch_sync(uuid) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_read(uuid),private.workspace_launch_action(jsonb) to authenticated;
