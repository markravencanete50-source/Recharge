-- Launch Preparation, round four: the inventory (Business Plan v1.0, 17/10/26, Property Set-Up (R/C) Inventory).
--  * Whoever sets the property up (Recharge or the owner) enters the property details, the same ones the Furnishing Studio
--    uses, and the presets calculate how many of each item the property needs. Each catalogue item is marked Required,
--    Additional or Not on the inventory (an admin setting on the item, in the Furnishing Studio catalogue).
--  * Additional items can be removed. When Recharge sets the property up, the owner accepts or rejects each additional
--    item and approves the inventory; when the owner sets it up, their own list needs no approval.
--  * Each item is then ticked as in the property (by the team, the furniture installer, or the owner on their own set-up).
--    Once the approved inventory is 100% ticked, the step is done.
--  * The housekeeper sees the list at the readiness inspection, to mark anything missing.
-- The quantity rules are the Furnishing Studio's (lib/furnishing-studio.ts), here in SQL; a test keeps the two the same.
-- The Launch Preparation functions from 20261029300000 and the Furnishing Studio's catalogue save are replaced. Safe to run twice.

-- 1. The catalogue: whether each item goes on a property's inventory. Labour never does; a few comfort items start as
--    additional. Set once, when the column first arrives; admins change it from then on.
do $do$ begin
 if not exists(select 1 from information_schema.columns where table_schema='private' and table_name='workspace_furnishing_items' and column_name='inventory') then
  alter table private.workspace_furnishing_items add column inventory text not null default 'required' check (inventory in ('required','additional','none'));
  update private.workspace_furnishing_items set inventory='none' where category='labour';
  update private.workspace_furnishing_items set inventory='additional'
   where code in ('cushions','throw','rug','floor-lamp','luggage-rack','wine-glasses','cafetiere','clothes-airer','garden-furniture');
 end if;
end $do$;

-- 2. The quantity rules: "per x of something", rounded up, only when something applies (see lib/furnishing-studio.ts).
create or replace function private.workspace_furnishing_basis(i jsonb,basis text) returns integer language sql immutable set search_path='' as $fn$
 with v as (select coalesce((i->>'bedrooms')::int,0) bedrooms,coalesce((i->>'bathrooms')::int,0) bathrooms,coalesce((i->>'guests')::int,0) guests,
  coalesce((i->>'livingRooms')::int,0) living,coalesce((i->>'exitDoors')::int,0) doors,coalesce((i->>'windows')::int,0) windows,coalesce((i->>'exposedBulbs')::int,0) bulbs,
  coalesce((i->>'bedsideTables')::int,0) bedsides,coalesce((i->>'mirrors')::int,0) mirrors,coalesce((i->>'clothesRails')::int,0) rails,coalesce((i->>'drawers')::int,0) drawers,
  coalesce((i->>'wardrobes')::int,0) wardrobes,coalesce((i->>'singleBeds')::int,0) singles,coalesce((i->>'doubleBeds')::int,0) doubles,coalesce((i->>'sofaBeds')::int,0) sofas,
  coalesce((i->>'zipLinkBeds')::int,0) zips,
  -- Linen for zip & link beds: three rotations for each bed's primary setup and one for the other.
  coalesce((select sum(case when s='double' then 3 else 1 end) from jsonb_array_elements_text(coalesce(i->'zipLinkSetups','[]')) s),0)::int zip_double,
  coalesce((select sum(case when s='twin' then 3 else 1 end) from jsonb_array_elements_text(coalesce(i->'zipLinkSetups','[]')) s),0)::int zip_twin)
 select case basis when 'fixed' then 1 when 'bedroom' then bedrooms when 'bathroom' then bathrooms when 'guest' then guests when 'livingRoom' then living
  when 'exitDoor' then doors when 'window' then windows when 'exposedBulb' then bulbs when 'bedsideTable' then bedsides when 'mirror' then mirrors
  when 'clothesRail' then rails when 'drawers' then drawers when 'wardrobe' then wardrobes when 'bed' then singles+doubles+zips+sofas when 'singleBed' then singles
  when 'doubleBed' then doubles when 'sofaBed' then sofas when 'zipLink' then zips when 'singleSize' then singles+2*zips when 'doubleSize' then doubles+sofas
  when 'pillow' then 2*(singles+sofas)+4*(doubles+zips) when 'singleSets' then 3*singles+2*zip_twin when 'doubleSets' then 3*(doubles+sofas) when 'kingSets' then zip_double
  else 0 end from v
$fn$;
create or replace function private.workspace_furnishing_applies(i jsonb,rule_when text) returns boolean language sql immutable set search_path='' as $fn$
 select case when rule_when is null then true when rule_when='noDishwasher' then not coalesce((i->>'dishwasher')::boolean,false)
  when rule_when='tvBracket' then i->>'tv'='bracket' when rule_when='tvStand' then i->>'tv'='stand' when rule_when='tvAny' then coalesce(i->>'tv','none')<>'none'
  when rule_when='curtains' then i->>'windowCovering'='curtains' when rule_when='blinds' then i->>'windowCovering'='blinds'
  when rule_when='cookerElectric' then i->>'cooker'='electric' when rule_when='cookerGas' then i->>'cooker'='gas' when rule_when='cookerInduction' then i->>'cooker'='induction'
  when rule_when='cookerNotInduction' then coalesce(i->>'cooker','')<>'induction'
  else coalesce((i->>rule_when)::boolean,false) end
$fn$;
create or replace function private.workspace_furnishing_quantity(i jsonb,basis text,per numeric,rule_when text) returns integer language sql immutable set search_path='' as $fn$
 select case when not private.workspace_furnishing_applies(i,rule_when) then 0
  else floor((greatest(0,round(per*100))*private.workspace_furnishing_basis(i,basis)+99)/100)::int end
$fn$;

-- 3. Each property's inventory: the details it was calculated from, and each item with its decision and tick.
create table if not exists private.workspace_launch_inventory (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 inputs jsonb not null,
 calculated_at timestamptz not null default now(),
 calculated_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz,
 approved_by uuid references auth.users(id) on delete set null
);
create table if not exists private.workspace_launch_inventory_items (
 property_id uuid not null references private.workspace_launch_inventory(property_id) on delete cascade,
 item_id uuid not null references private.workspace_furnishing_items(id) on delete cascade,
 name text not null,
 category text not null,
 unit text not null,
 kind text not null check (kind in ('required','additional')),
 quantity integer not null check (quantity between 1 and 10000),
 position integer not null,
 -- Required items are always kept. Additional ones: kept, removed (false), or waiting for the owner's decision (null).
 kept boolean,
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 checked_by uuid references auth.users(id) on delete set null,
 checked_at timestamptz,
 primary key (property_id,item_id)
);
alter table private.workspace_launch_inventory enable row level security;
alter table private.workspace_launch_inventory_items enable row level security;
revoke all on private.workspace_launch_inventory,private.workspace_launch_inventory_items from public,anon,authenticated,service_role;

-- The inventory part of a property's checklist. The team (and the owner, on their own set-up) calculate it; the owner
-- decides the additional items and approves it when Recharge sets up; the team, the installer and the self-setting-up
-- owner tick items as in the property. The housekeeper sees the list for the readiness inspection.
create or replace function private.workspace_launch_inventory_view(prop uuid,team boolean,owner boolean,keeper boolean,fitter boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare v private.workspace_launch_inventory;rs boolean;editor boolean;checker boolean;total integer;checked integer;undecided integer;suggest jsonb;begin
 rs:=coalesce((select x.answers->>'setUp'='recharge' from private.workspace_onboarding_packages x where x.property_id=prop and x.submitted_at is not null),false);
 select * into v from private.workspace_launch_inventory where property_id=prop;
 editor:=team or (owner and not rs);
 checker:=team or fitter or (owner and not rs);
 select count(*) filter (where i.kept)::int,count(*) filter (where i.kept and i.checked_at is not null)::int,count(*) filter (where i.kept is null)::int
  into total,checked,undecided from private.workspace_launch_inventory_items i where i.property_id=prop;
 -- The details to start from: the inventory's own, else the property's Furnishing Studio quote (the approved one first).
 suggest:=coalesce(v.inputs,(select q.inputs from private.workspace_furnishing_projects q where q.property_id=prop and not q.archived and q.inputs<>'{}'::jsonb
  order by (q.status in ('accepted','purchasing','complete')) desc,q.updated_at desc limit 1));
 return jsonb_build_object('rechargeSetsUp',rs,'inputs',case when team or owner then suggest end,'calculatedAt',v.calculated_at,
  'calculatedByName',private.workspace_launch_person(v.calculated_by),'approvedAt',v.approved_at,'approvedByName',private.workspace_launch_person(v.approved_by),
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemId',i.item_id,'name',i.name,'category',i.category,'unit',i.unit,'kind',i.kind,'quantity',i.quantity,'kept',i.kept,
    'decidedByName',private.workspace_launch_person(i.decided_by),'checkedAt',i.checked_at,'checkedByName',private.workspace_launch_person(i.checked_by)) order by i.position)
   from private.workspace_launch_inventory_items i where i.property_id=prop and (team or owner or i.kept)),'[]'),
  'counts',jsonb_build_object('total',total,'checked',checked,'undecided',undecided),
  'canCalculate',editor,
  'canDecide',v.property_id is not null and case when rs then owner and v.approved_at is null else editor end,
  'canApprove',rs and owner and v.property_id is not null and v.approved_at is null and undecided=0,
  'canCheck',checker and v.property_id is not null and v.approved_at is not null);
end $fn$;

-- 4. The checklist, reading, and the actions (replacing 20261029300000's plan, view and actions).
create or replace function private.workspace_launch_plan(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare j private.workspace_journeys;a jsonb;ps jsonb;steps jsonb:='[]';started boolean;rs boolean;r private.workspace_launch_readiness;
 ph private.workspace_listing_photography;fee text:='Opens once the onboarding fee is settled.';pre boolean;ready boolean;received boolean;listed boolean;doc text;
 hk boolean;fu private.workspace_launch_furnishing;quoted boolean;fordered boolean;freceived boolean;inv boolean;begin
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
  'inventory',private.workspace_launch_inventory_view(prop,team,owner,keeper,fitter),
  'canAllocate',team and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live'),
  'canBookReadiness',team and pre and hk is not null and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked'),
  'canSubmitReadiness',(team or keeper) and r.property_id is not null and r.submitted_at is null and r.booked_on<=today and j.stage='inspection_booked');
end $fn$;

create or replace function private.workspace_launch_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;j private.workspace_journeys;
 r private.workspace_launch_readiness;s jsonb;x jsonb;keys text[];hk uuid;day date;n integer:=0;crosses text[]:='{}';missing text[]:='{}';ev bigint;video text;c text;fu private.workspace_launch_furnishing;fv jsonb;q private.workspace_furnishing_projects;item uuid;who uuid;other record;was boolean;iv jsonb;waiting integer;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','step','data','housekeeperId','date','inventory','condition','evidence','settings','fileId','name','mime','bytes','path','lineId','projectId','decision','note','installerId','deliveryAddress','lines','inputs','itemId','keep','present'],60000);
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
 elsif input->>'action' in ('tick','reopen','allocate','bookReadiness','submitReadiness','addFile','removeFile','decideQuote','assignInstaller','orderLines','receiveLine','proposeInstall','approveInstall','completeInstall',
  'calculateInventory','decideInventory','approveInventory','checkInventory') then
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
    if was then
     waiting:=(select count(*) from private.workspace_launch_inventory_items li where li.property_id=prop and li.kept is null);
     perform private.workspace_property_chat_post(prop,'Your inventory is ready in Launch Preparation: '||n||' items'
      ||case when waiting>0 then ', '||waiting||' of them additional, for you to accept or reject' else '' end||'. Once you approve it, we make sure everything is in the property.',null,'event',now());
    end if;
   elsif input->>'action'='decideInventory' then
    perform private.workspace_json_keys(input,array['action','requestId','propertyId','itemId','keep']);
    if not coalesce((iv->>'canDecide')::boolean,false) then raise exception '%',case when (iv->>'rechargeSetsUp')::boolean and not (view->>'isOwner')::boolean
     then 'The owner accepts or rejects the additional items' else 'The inventory is already approved' end using errcode='42501';end if;
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

-- 5. The catalogue save, now with whether the item goes on the inventory (an older screen that leaves it out keeps it).
create or replace function private.workspace_furnishing_item_json(i private.workspace_furnishing_items) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'category',i.category,'unit',i.unit,'packSize',i.pack_size,'costCapPence',i.cost_cap_pence,
  'retailPricePence',i.retail_price_pence,'supplier',i.supplier,'productUrl',i.product_url,
  'rule',jsonb_build_object('basis',i.rule_basis,'per',i.rule_per,'when',i.rule_when),'stepPence',i.step_pence,'active',i.active,'inventory',i.inventory,'sortOrder',i.sort_order,
  'version',i.version,'updatedAt',i.updated_at,'updatedBy',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=i.updated_by))
$fn$;

create or replace function private.workspace_furnishing_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_furnishing_actor();a text;req uuid;prior private.workspace_action_receipts;result jsonb;
 it private.workspace_furnishing_items;pr private.workspace_furnishing_projects;ln private.workspace_furnishing_lines;
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 v_name text;v_category text;v_unit text;v_pack integer;v_cap bigint;v_retail bigint;v_supplier text;v_url text;v_rule jsonb;v_basis text;v_per numeric;v_when text;v_step bigint;v_inventory text;
 v_client text;v_email text;v_property uuid;v_address text;v_on date;v_inputs jsonb;v_markup numeric;v_fee bigint;v_notes text;
 to_status text;from_status text;yr integer;num integer;rev_lines jsonb;
 today date:=(now() at time zone 'Europe/London')::date;
begin
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=coalesce(input->>'action','');
 if a='saveItem' then perform private.workspace_json_keys(input,array['action','requestId','id','version','name','category','unit','packSize','costCapPence','retailPricePence',
   'supplier','productUrl','rule','stepPence','active','inventory'],8000);
 elsif a='saveProject' then perform private.workspace_json_keys(input,array['action','requestId','id','version','clientName','clientEmail','propertyId','address','estimateOn',
   'inputs','markupPercent','feePence','vat','notes','lines'],200000);
 elsif a='moveProject' then perform private.workspace_json_keys(input,array['action','requestId','id','version','status'],2000);
 elsif a='archiveProject' then perform private.workspace_json_keys(input,array['action','requestId','id','version','archived'],2000);
 elsif a='tickLine' then perform private.workspace_json_keys(input,array['action','requestId','id','lineId','purchased','actualPence'],2000);
 else raise exception 'Unknown Furnishing Studio action' using errcode='22023';end if;
 if coalesce(input->>'requestId','')!~uuid_re then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if input ? 'id' and coalesce(input->>'id','')!~uuid_re then raise exception 'Not found' using errcode='P0002';end if;
 if a in ('moveProject','archiveProject','tickLine') and not (input ? 'id') then raise exception 'Project not found' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveItem' then
  if input ? 'id' then
   select * into it from private.workspace_furnishing_items where id=(input->>'id')::uuid for update;
   if it.id is null then raise exception 'Product not found' using errcode='P0002';end if;
   if jsonb_typeof(input->'version') is distinct from 'number' or it.version is distinct from (input->>'version')::integer then
    raise exception 'The product was changed by someone else. Refresh and try again' using errcode='40001';
   end if;
  end if;
  v_name:=btrim(coalesce(input->>'name',''));
  if length(v_name) not between 2 and 200 then raise exception 'Name the product (2 to 200 characters)' using errcode='22023';end if;
  v_category:=coalesce(input->>'category','');
  if v_category not in ('bedroom','linen','bathroom','kitchen','living','windows','appliances','cleaning','safety','outdoor','labour') then raise exception 'Choose the room' using errcode='22023';end if;
  v_unit:=btrim(coalesce(input->>'unit',''));
  if length(v_unit) not between 1 and 60 then raise exception 'Say what one unit is, for example each or pack of 4' using errcode='22023';end if;
  if jsonb_typeof(input->'packSize') is distinct from 'number' or (input->>'packSize')!~'^\d{1,4}$' or (input->>'packSize')::integer not between 1 and 1000 then
   raise exception 'The pack size can be 1 to 1,000' using errcode='22023';
  end if;
  v_pack:=(input->>'packSize')::integer;
  v_cap:=private.workspace_furnishing_pence(input,'costCapPence','cost cap',false);
  v_retail:=private.workspace_furnishing_pence(input,'retailPricePence','retail price',true);
  v_step:=private.workspace_furnishing_pence(input,'stepPence','amount per extra bedroom',false);
  v_supplier:=btrim(coalesce(input->>'supplier',''));
  if length(v_supplier)>120 then raise exception 'The supplier can be up to 120 characters' using errcode='22023';end if;
  v_url:=nullif(btrim(coalesce(input->>'productUrl','')),'');
  if v_url is not null and (length(v_url)>1000 or v_url!~'^https://[^[:space:]]+$') then raise exception 'Use a public https:// product link' using errcode='22023';end if;
  v_rule:=input->'rule';
  if jsonb_typeof(v_rule) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_rule) k where k not in ('basis','per','when')) then raise exception 'Check the quantity rule' using errcode='22023';end if;
  v_basis:=coalesce(v_rule->>'basis','');
  if v_basis not in ('fixed','bedroom','bathroom','guest','livingRoom','exitDoor','window','exposedBulb','bedsideTable','mirror','clothesRail','drawers','wardrobe','bed',
   'singleBed','doubleBed','sofaBed','zipLink','singleSize','doubleSize','pillow','singleSets','doubleSets','kingSets') then raise exception 'Choose what the quantity is per' using errcode='22023';end if;
  if jsonb_typeof(v_rule->'per') is distinct from 'number' or (v_rule->>'per')!~'^\d{1,3}(\.\d{1,2})?$' or (v_rule->>'per')::numeric>100 then
   raise exception 'The quantity per can be 0 to 100, up to two decimals' using errcode='22023';
  end if;
  v_per:=(v_rule->>'per')::numeric;
  v_when:=case when jsonb_typeof(v_rule->'when') is distinct from 'string' then null else v_rule->>'when' end;
  if jsonb_typeof(coalesce(v_rule->'when','null'::jsonb)) not in ('string','null') or (v_when is not null and v_when not in ('garden','dishwasher','noDishwasher','tumbleDryer',
   'noiseMonitor','securityCamera','longKeybox','tvBracket','tvStand','tvAny','curtains','blinds','cookerElectric','cookerGas','cookerInduction','cookerNotInduction')) then
   raise exception 'Choose when the product is needed' using errcode='22023';
  end if;
  if jsonb_typeof(input->'active') is distinct from 'boolean' then raise exception 'Say whether the product is in use' using errcode='22023';end if;
  v_inventory:=coalesce(input->>'inventory',it.inventory,'required');
  if v_inventory not in ('required','additional','none') or jsonb_typeof(coalesce(input->'inventory','""'::jsonb))<>'string' then
   raise exception 'Choose whether the product is required, additional or not on the inventory' using errcode='22023';end if;
  if it.id is null then
   insert into private.workspace_furnishing_items(name,category,unit,pack_size,cost_cap_pence,retail_price_pence,supplier,product_url,rule_basis,rule_per,rule_when,step_pence,active,
    sort_order,created_by,updated_by,inventory)
   values(v_name,v_category,v_unit,v_pack,v_cap,v_retail,v_supplier,v_url,v_basis,v_per,v_when,v_step,(input->>'active')::boolean,
    coalesce((select max(x.sort_order) from private.workspace_furnishing_items x where x.category=v_category),0)+10,auth.uid(),auth.uid(),v_inventory) returning * into it;
   insert into private.workspace_furnishing_item_history(item_id,actor_id,action,version) values(it.id,auth.uid(),'created',it.version);
  else
   insert into private.workspace_furnishing_item_history(item_id,actor_id,action,version,before) values(it.id,auth.uid(),'saved',it.version+1,private.workspace_furnishing_item_json(it)-'updatedBy'-'updatedAt');
   update private.workspace_furnishing_items set name=v_name,category=v_category,unit=v_unit,pack_size=v_pack,cost_cap_pence=v_cap,retail_price_pence=v_retail,supplier=v_supplier,
    product_url=v_url,rule_basis=v_basis,rule_per=v_per,rule_when=v_when,step_pence=v_step,active=(input->>'active')::boolean,inventory=v_inventory,version=version+1,updated_by=auth.uid(),updated_at=now()
   where id=it.id returning * into it;
  end if;
  result:=private.workspace_furnishing_item_json(it);
  insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
  return result;
 end if;

 if input ? 'id' then
  select * into pr from private.workspace_furnishing_projects where id=(input->>'id')::uuid for update;
  if pr.id is null then raise exception 'Project not found' using errcode='P0002';end if;
  if a<>'tickLine' and (jsonb_typeof(input->'version') is distinct from 'number' or pr.version is distinct from (input->>'version')::integer) then
   raise exception 'The project was changed by someone else. Refresh and try again' using errcode='40001';
  end if;
  if a<>'archiveProject' and pr.archived then raise exception 'This project is archived. Restore it first' using errcode='42501';end if;
 end if;

 if a='saveProject' then
  if pr.id is not null and pr.status<>'draft' then raise exception 'Only a draft can be changed. Reopen the quote to edit it' using errcode='42501';end if;
  v_client:=btrim(coalesce(input->>'clientName',''));
  if length(v_client) not between 2 and 200 then raise exception 'Enter the client name' using errcode='22023';end if;
  if coalesce(jsonb_typeof(input->'clientEmail'),'null') not in ('string','null') then raise exception 'Check the client email address' using errcode='22023';end if;
  v_email:=nullif(btrim(coalesce(input->>'clientEmail','')),'');
  if v_email is not null and (length(v_email)>320 or v_email!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Check the client email address' using errcode='22023';end if;
  if jsonb_typeof(input->'propertyId')='string' then
   if input->>'propertyId'!~uuid_re then raise exception 'Choose the property again' using errcode='22023';end if;
   select p.id into v_property from public.workspace_properties p where p.id=(input->>'propertyId')::uuid and p.status<>'archived';
   if v_property is null then raise exception 'Choose the property again' using errcode='22023';end if;
  elsif coalesce(jsonb_typeof(input->'propertyId'),'null')<>'null' then raise exception 'Choose the property again' using errcode='22023';
  end if;
  v_address:=btrim(coalesce(input->>'address',''));
  if length(v_address)>500 then raise exception 'The address can be up to 500 characters' using errcode='22023';end if;
  if v_property is null and length(v_address)<3 then raise exception 'Choose a property or type the address or project name' using errcode='22023';end if;
  v_on:=coalesce(private.workspace_document_day(input,'estimateOn','estimate date'),today);
  v_inputs:=private.workspace_furnishing_inputs(input->'inputs');
  if jsonb_typeof(input->'markupPercent') is distinct from 'number' or (input->>'markupPercent')!~'^\d{1,3}(\.\d{1,2})?$' or (input->>'markupPercent')::numeric>200 then
   raise exception 'The markup can be 0%% to 200%%, up to two decimals' using errcode='22023';
  end if;
  v_markup:=(input->>'markupPercent')::numeric;
  v_fee:=private.workspace_furnishing_pence(input,'feePence','fee',false);
  if jsonb_typeof(input->'vat') is distinct from 'boolean' then raise exception 'Say whether VAT is added' using errcode='22023';end if;
  v_notes:=btrim(coalesce(input->>'notes',''));
  if length(v_notes)>2000 then raise exception 'The notes can be up to 2,000 characters' using errcode='22023';end if;
  if jsonb_typeof(input->'lines') is distinct from 'array' then raise exception 'Check the quantities' using errcode='22023';end if;
  if pr.id is null then
   yr:=extract(year from v_on)::integer;
   insert into private.workspace_furnishing_numbers(year,last_number) values(yr,1)
    on conflict(year) do update set last_number=private.workspace_furnishing_numbers.last_number+1 returning last_number into num;
   insert into private.workspace_furnishing_projects(number,client_name,client_email,property_id,address,estimate_on,inputs,bedrooms,markup_percent,fee_pence,vat,notes,
    created_by,request_id,updated_by)
   values('RC-FQ-'||yr||'-'||lpad(num::text,4,'0'),v_client,v_email,v_property,v_address,v_on,v_inputs,(v_inputs->>'bedrooms')::integer,v_markup,v_fee,(input->>'vat')::boolean,v_notes,
    auth.uid(),req,auth.uid()) returning * into pr;
   insert into private.workspace_furnishing_events(project_id,actor_id,action,to_status,version) values(pr.id,auth.uid(),'created','draft',pr.version);
  else
   update private.workspace_furnishing_projects set client_name=v_client,client_email=v_email,property_id=v_property,address=v_address,estimate_on=v_on,inputs=v_inputs,
    bedrooms=(v_inputs->>'bedrooms')::integer,markup_percent=v_markup,fee_pence=v_fee,vat=(input->>'vat')::boolean,notes=v_notes,version=version+1,updated_by=auth.uid(),updated_at=now()
   where id=pr.id returning * into pr;
   insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version) values(pr.id,auth.uid(),'saved','draft','draft',pr.version);
  end if;
  perform private.workspace_furnishing_write_lines(pr.id,pr.line_revision+1,input->'lines');

 elsif a='moveProject' then
  to_status:=coalesce(input->>'status','');from_status:=pr.status;
  if not ((from_status='draft' and to_status='sent') or (from_status='sent' and to_status in ('accepted','declined','draft')) or (from_status='declined' and to_status='draft')
   or (from_status='accepted' and to_status='purchasing') or (from_status='purchasing' and to_status='complete')) then
   raise exception 'A % quote cannot be moved to %',from_status,to_status using errcode='22023';
  end if;
  if to_status='sent' then
   if not exists(select 1 from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision and l.packs>0) then
    raise exception 'Add something to buy before sending the quote' using errcode='22023';
   end if;
   -- Sent with the catalogue as it is now: a fresh revision, then frozen until the quote is reopened.
   select coalesce(jsonb_agg(jsonb_build_object('itemId',l.item_id,'suggestedUnits',l.suggested_units,'units',l.units,'existingUnits',l.existing_units) order by l.position),'[]'::jsonb)
    into rev_lines from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision;
   perform private.workspace_furnishing_write_lines(pr.id,pr.line_revision+1,rev_lines);
   update private.workspace_furnishing_projects set sent_at=now(),sent_by=auth.uid() where id=pr.id;
  elsif to_status in ('accepted','declined') then
   update private.workspace_furnishing_projects set decided_at=now(),decided_by=auth.uid() where id=pr.id;
  elsif to_status='complete' then
   update private.workspace_furnishing_projects set completed_at=now() where id=pr.id;
  end if;
  update private.workspace_furnishing_projects set status=to_status,version=version+1,updated_by=auth.uid(),updated_at=now() where id=pr.id returning * into pr;
  insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version) values(pr.id,auth.uid(),'moved',from_status,to_status,pr.version);

 elsif a='archiveProject' then
  if jsonb_typeof(input->'archived') is distinct from 'boolean' then raise exception 'Say whether to archive the project' using errcode='22023';end if;
  if pr.archived is distinct from (input->>'archived')::boolean then
   update private.workspace_furnishing_projects set archived=(input->>'archived')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now() where id=pr.id returning * into pr;
   insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version)
    values(pr.id,auth.uid(),case when pr.archived then 'archived' else 'restored' end,pr.status,pr.status,pr.version);
  end if;

 elsif a='tickLine' then
  if pr.status not in ('accepted','purchasing') then raise exception 'Tick purchases once the client has accepted the quote' using errcode='42501';end if;
  if coalesce(input->>'lineId','')!~uuid_re then raise exception 'Line not found' using errcode='P0002';end if;
  select * into ln from private.workspace_furnishing_lines l where l.id=(input->>'lineId')::uuid and l.project_id=pr.id and l.revision=pr.line_revision for update;
  if ln.id is null or ln.packs=0 then raise exception 'Line not found' using errcode='P0002';end if;
  if jsonb_typeof(input->'purchased') is distinct from 'boolean' then raise exception 'Say whether it was bought' using errcode='22023';end if;
  update private.workspace_furnishing_lines set purchased=(input->>'purchased')::boolean,
   purchased_at=case when (input->>'purchased')::boolean then coalesce(purchased_at,now()) end,
   purchased_by=case when (input->>'purchased')::boolean then coalesce(purchased_by,auth.uid()) end,
   actual_pence=private.workspace_furnishing_pence(input,'actualPence','actual spend',true)
  where id=ln.id;
  if pr.status='accepted' then
   update private.workspace_furnishing_projects set status='purchasing',version=version+1,updated_by=auth.uid(),updated_at=now() where id=pr.id returning * into pr;
   insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version) values(pr.id,auth.uid(),'moved','accepted','purchasing',pr.version);
  else
   update private.workspace_furnishing_projects set updated_by=auth.uid(),updated_at=now() where id=pr.id returning * into pr;
  end if;
  insert into private.workspace_furnishing_events(project_id,actor_id,action,from_status,to_status,version,detail)
   values(pr.id,auth.uid(),case when (input->>'purchased')::boolean then 'purchased' else 'unpurchased' end,pr.status,pr.status,pr.version,
    jsonb_build_object('lineId',ln.id,'name',ln.name,'actualPence',input->'actualPence'));
 end if;

 select * into pr from private.workspace_furnishing_projects where id=pr.id;
 result:=private.workspace_furnishing_project_json(pr,true);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

drop trigger if exists workspace_launch_sync on private.workspace_launch_inventory;
create trigger workspace_launch_sync after insert or update on private.workspace_launch_inventory for each row execute function private.workspace_launch_sync_trigger();

revoke all on function private.workspace_furnishing_basis(jsonb,text),private.workspace_furnishing_applies(jsonb,text),private.workspace_furnishing_quantity(jsonb,text,numeric,text),
 private.workspace_launch_inventory_view(uuid,boolean,boolean,boolean,boolean),private.workspace_launch_plan(uuid),private.workspace_launch_view(uuid),
 private.workspace_launch_action(jsonb),private.workspace_furnishing_item_json(private.workspace_furnishing_items),private.workspace_furnishing_action(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_action(jsonb),private.workspace_furnishing_action(jsonb) to authenticated;
