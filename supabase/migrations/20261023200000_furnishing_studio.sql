-- Furnishing Studio (Alex: "we need a product catalogue for anything we're going to purchase, as well as provide quotes to
-- clients for the furnished items"; Lee: build the prototype into Recharge, improved, for the Stays team and management only,
-- with analytics). The prototype kept its projects in one browser; here everything is shared and kept in the database.
--
--  * private.workspace_furnishing_items: the shared product catalogue. Name, room (category), what one retail unit is (unit)
--    and how many pieces it holds (pack_size), the cost cap (the most Recharge pays for one retail unit, integer pence), an
--    optional retail price for client quotes (pence; the cost cap is used when it is empty), supplier, product link, and a
--    quantity rule worked out from the property details: rule_per (up to two decimals) per rule_basis (per bedroom, per
--    guest, per window, per zip & link bed, fixed per property...), rounded up, only when rule_when applies (a garden, a
--    dishwasher, curtains...). step_pence adds an amount for each bedroom after the first (the labour line: the one-bedroom
--    cap plus GBP 250 per additional bedroom). Items are never deleted: active=false takes one out of new quotes. Every edit
--    is in private.workspace_furnishing_item_history (who, when, the values before). Seeded below with a default UK short-let
--    catalogue (stable codes, inserted once, so a second run and later edits are never overwritten).
--  * private.workspace_furnishing_projects: a quote per client and property (a property in the app, or a prospective
--    address or project name typed in), numbered RC-FQ-YYYY-NNNN. Status draft -> sent -> accepted or declined; accepted ->
--    purchasing -> complete; a sent or declined quote can be reopened as a draft. archived hides a project (never deleted).
--    The property details (inputs) are checked here (private.workspace_furnishing_inputs, the same ranges as the app's
--    lib/furnishing-studio.ts). Optional markup percent, fixed fee and VAT (20%) for the client quote.
--  * private.workspace_furnishing_lines: the quote's lines, one revision per save (earlier revisions stay; nothing is
--    deleted). Each line copies the catalogue values at the time it is written (name, unit, pack size, supplier, link, cost
--    and price). Sending a quote writes a fresh revision from the catalogue as it is then and freezes it, so later catalogue
--    edits never change a sent quote. Once accepted, the team tick lines off while buying and record the actual spend.
--  * private.workspace_furnishing_events: every change to a project (created, saved, moved, archived, restored, purchased).
--
-- Who: the Stays team (stays) and management (admin, super_admin), decided in ONE place, private.workspace_furnishing_actor.
-- Owners (client), cleaners, the cleaning manager, Ready and Accounts are refused every read and action. Tables have RLS on
-- and no grants; everything goes through the private security-definer functions below and their public security-invoker
-- wrappers (workspace_furnishing_read, workspace_furnishing_analytics, workspace_furnishing_action), executable by signed-in
-- people only. Money is integer pence. No existing function is changed. No DROP, no DELETE. Safe to run twice.

-- Tables -------------------------------------------------------------------------------------------------------------
create table if not exists private.workspace_furnishing_items (
 id uuid primary key default gen_random_uuid(),
 code text unique check(code is null or code ~ '^[a-z0-9-]{2,60}$'),
 name text not null check(length(btrim(name)) between 2 and 200),
 category text not null check(category in ('bedroom','linen','bathroom','kitchen','living','windows','appliances','cleaning','safety','outdoor','labour')),
 unit text not null default 'each' check(length(btrim(unit)) between 1 and 60),
 pack_size integer not null default 1 check(pack_size between 1 and 1000),
 cost_cap_pence bigint not null check(cost_cap_pence between 0 and 10000000),
 retail_price_pence bigint check(retail_price_pence is null or retail_price_pence between 0 and 10000000),
 supplier text not null default '' check(length(supplier)<=120),
 product_url text check(product_url is null or (length(product_url)<=1000 and product_url ~ '^https://[^[:space:]]+$')),
 rule_basis text not null default 'fixed' check(rule_basis in ('fixed','bedroom','bathroom','guest','livingRoom','exitDoor','window','exposedBulb','bedsideTable','mirror',
  'clothesRail','drawers','wardrobe','bed','singleBed','doubleBed','sofaBed','zipLink','singleSize','doubleSize','pillow','singleSets','doubleSets','kingSets')),
 rule_per numeric(6,2) not null default 1 check(rule_per between 0 and 100),
 rule_when text check(rule_when is null or rule_when in ('garden','dishwasher','noDishwasher','tumbleDryer','noiseMonitor','securityCamera','longKeybox','tvBracket',
  'tvStand','tvAny','curtains','blinds','cookerElectric','cookerGas','cookerInduction','cookerNotInduction')),
 step_pence bigint not null default 0 check(step_pence between 0 and 10000000),
 active boolean not null default true,
 sort_order integer not null default 0,
 version integer not null default 1 check(version>0),
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_furnishing_items_category_idx on private.workspace_furnishing_items(category,sort_order);
alter table private.workspace_furnishing_items enable row level security;
revoke all on private.workspace_furnishing_items from public,anon,authenticated;

create table if not exists private.workspace_furnishing_item_history (
 id bigint generated always as identity primary key,
 item_id uuid not null references private.workspace_furnishing_items(id),
 actor_id uuid references public.workspace_profiles(user_id),
 action text not null check(action in ('created','saved')),
 version integer not null check(version>0),
 before jsonb not null default '{}'::jsonb,
 at timestamptz not null default now()
);
create index if not exists workspace_furnishing_item_history_item_idx on private.workspace_furnishing_item_history(item_id,id);
alter table private.workspace_furnishing_item_history enable row level security;
revoke all on private.workspace_furnishing_item_history from public,anon,authenticated;

create table if not exists private.workspace_furnishing_numbers (
 year integer primary key check(year between 2000 and 2999),
 last_number integer not null default 0 check(last_number>=0)
);
alter table private.workspace_furnishing_numbers enable row level security;
revoke all on private.workspace_furnishing_numbers from public,anon,authenticated;

create table if not exists private.workspace_furnishing_projects (
 id uuid primary key default gen_random_uuid(),
 number text not null unique check(number ~ '^RC-FQ-\d{4}-\d{4,}$'),
 status text not null default 'draft' check(status in ('draft','sent','accepted','declined','purchasing','complete')),
 archived boolean not null default false,
 client_name text not null check(length(btrim(client_name)) between 2 and 200),
 client_email text check(client_email is null or (length(client_email)<=320 and client_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
 property_id uuid references public.workspace_properties(id),
 address text not null default '' check(length(address)<=500),
 estimate_on date not null,
 inputs jsonb not null default '{}'::jsonb,
 bedrooms integer not null default 0 check(bedrooms between 0 and 12),
 markup_percent numeric(5,2) not null default 0 check(markup_percent between 0 and 200),
 fee_pence bigint not null default 0 check(fee_pence between 0 and 10000000),
 vat boolean not null default false,
 notes text not null default '' check(length(notes)<=2000),
 line_revision integer not null default 0 check(line_revision>=0),
 estimate_pence bigint not null default 0 check(estimate_pence>=0),
 subtotal_pence bigint not null default 0 check(subtotal_pence>=0),
 vat_pence bigint not null default 0 check(vat_pence>=0),
 quote_pence bigint not null default 0 check(quote_pence>=0),
 sent_at timestamptz,
 sent_by uuid references public.workspace_profiles(user_id),
 decided_at timestamptz,
 decided_by uuid references public.workspace_profiles(user_id),
 completed_at timestamptz,
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.workspace_profiles(user_id),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 unique(created_by,request_id),
 constraint workspace_furnishing_projects_where check(property_id is not null or length(btrim(address))>=3)
);
create index if not exists workspace_furnishing_projects_updated_idx on private.workspace_furnishing_projects(updated_at desc);
create index if not exists workspace_furnishing_projects_estimate_idx on private.workspace_furnishing_projects(estimate_on);
create index if not exists workspace_furnishing_projects_property_idx on private.workspace_furnishing_projects(property_id) where property_id is not null;
alter table private.workspace_furnishing_projects enable row level security;
revoke all on private.workspace_furnishing_projects from public,anon,authenticated;

create table if not exists private.workspace_furnishing_lines (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references private.workspace_furnishing_projects(id),
 revision integer not null check(revision>0),
 position integer not null check(position between 1 and 400),
 item_id uuid not null references private.workspace_furnishing_items(id),
 name text not null,
 category text not null,
 unit text not null,
 pack_size integer not null check(pack_size>=1),
 supplier text not null default '',
 product_url text,
 unit_cost_pence bigint not null check(unit_cost_pence>=0),
 unit_price_pence bigint not null check(unit_price_pence>=0),
 suggested_units integer not null check(suggested_units between 0 and 10000),
 units integer not null check(units between 0 and 10000),
 existing_units integer not null check(existing_units between 0 and 10000),
 packs integer not null check(packs>=0),
 cost_pence bigint not null check(cost_pence>=0),
 price_pence bigint not null check(price_pence>=0),
 purchased boolean not null default false,
 purchased_at timestamptz,
 purchased_by uuid references public.workspace_profiles(user_id),
 actual_pence bigint check(actual_pence is null or actual_pence between 0 and 10000000),
 unique(project_id,revision,position),
 unique(project_id,revision,item_id),
 check(existing_units<=units)
);
create index if not exists workspace_furnishing_lines_item_idx on private.workspace_furnishing_lines(item_id);
alter table private.workspace_furnishing_lines enable row level security;
revoke all on private.workspace_furnishing_lines from public,anon,authenticated;

create table if not exists private.workspace_furnishing_events (
 id bigint generated always as identity primary key,
 project_id uuid not null references private.workspace_furnishing_projects(id),
 actor_id uuid references public.workspace_profiles(user_id),
 action text not null check(action in ('created','saved','moved','archived','restored','purchased','unpurchased')),
 from_status text,
 to_status text,
 version integer not null,
 detail jsonb not null default '{}'::jsonb,
 at timestamptz not null default now()
);
create index if not exists workspace_furnishing_events_project_idx on private.workspace_furnishing_events(project_id,id);
alter table private.workspace_furnishing_events enable row level security;
revoke all on private.workspace_furnishing_events from public,anon,authenticated;

-- The default catalogue -----------------------------------------------------------------------------------------------
-- A plausible UK short-let starting point (October 2026 high-street prices, rounded up as caps), to be edited in the app.
-- Inserted once by code; a second run, or a code someone has since edited, is left as it is. No links yet: the team add the
-- exact product pages they buy from.
insert into private.workspace_furnishing_items(code,name,category,unit,pack_size,cost_cap_pence,supplier,rule_basis,rule_per,rule_when,step_pence,sort_order)
select v.code,v.name,v.category,v.unit,v.pack,v.cap,v.supplier,v.basis,v.per,v.rule_when,v.step,v.sort from (values
 ('double-bed-frame','Double bed frame','bedroom','each',1,25000,'IKEA','doubleBed',1,null,0,10),
 ('double-mattress','Double mattress (medium firm)','bedroom','each',1,30000,'Dunelm','doubleBed',1,null,0,20),
 ('zip-link-frame','Zip & link bed frame (super king)','bedroom','each',1,45000,'Dunelm','zipLink',1,null,0,30),
 ('zip-link-mattress','Zip & link mattress pair','bedroom','pair',1,60000,'Dunelm','zipLink',1,null,0,40),
 ('single-bed-frame','Single bed frame','bedroom','each',1,12000,'IKEA','singleBed',1,null,0,50),
 ('single-mattress','Single mattress','bedroom','each',1,15000,'IKEA','singleBed',1,null,0,60),
 ('mattress-protector-single','Mattress protector (single)','bedroom','each',1,1200,'Dunelm','singleSize',1,null,0,70),
 ('mattress-protector-double','Mattress protector (double)','bedroom','each',1,1500,'Dunelm','doubleSize',1,null,0,80),
 ('mattress-protector-super-king','Mattress protector (super king)','bedroom','each',1,2000,'Dunelm','zipLink',1,null,0,90),
 ('duvet-single','Duvet 10.5 tog (single)','bedroom','each',1,1500,'Dunelm','singleSize',1,null,0,100),
 ('duvet-double','Duvet 10.5 tog (double)','bedroom','each',1,2000,'Dunelm','doubleSize',1,null,0,110),
 ('duvet-super-king','Duvet 10.5 tog (super king)','bedroom','each',1,3000,'Dunelm','zipLink',1,null,0,120),
 ('pillows','Pillows','bedroom','pack of 2',2,1200,'Dunelm','pillow',1,null,0,130),
 ('pillow-protectors','Pillow protectors','bedroom','pack of 2',2,800,'Dunelm','pillow',1,null,0,140),
 ('bedside-table','Bedside table','bedroom','each',1,4500,'IKEA','bedsideTable',1,null,0,150),
 ('bedside-lamp','Bedside lamp with bulb','bedroom','each',1,2000,'IKEA','bedsideTable',1,null,0,160),
 ('wardrobe','Wardrobe','bedroom','each',1,15000,'IKEA','wardrobe',1,null,0,170),
 ('chest-of-drawers','Chest of drawers','bedroom','each',1,12000,'IKEA','drawers',1,null,0,180),
 ('clothes-rail','Clothes rail','bedroom','each',1,3000,'IKEA','clothesRail',1,null,0,190),
 ('full-length-mirror','Full-length mirror','bedroom','each',1,4000,'Dunelm','mirror',1,null,0,200),
 ('coat-hangers','Coat hangers','bedroom','pack of 10',10,800,'IKEA','bedroom',10,null,0,210),
 ('luggage-rack','Luggage rack','bedroom','each',1,2500,'Amazon','bedroom',1,null,0,220),
 ('bedroom-bin','Bedroom bin','bedroom','each',1,600,'Dunelm','bedroom',1,null,0,230),
 ('linen-single','Single linen set (sheet, duvet cover, pillowcase)','linen','set',1,2500,'Hotel linen supplier','singleSets',1,null,0,10),
 ('linen-double','Double linen set (sheet, duvet cover, pillowcases)','linen','set',1,3000,'Hotel linen supplier','doubleSets',1,null,0,20),
 ('linen-super-king','Super king linen set (sheet, duvet cover, pillowcases)','linen','set',1,4000,'Hotel linen supplier','kingSets',1,null,0,30),
 ('bath-towel','Bath towel','linen','each',1,800,'Hotel linen supplier','guest',3,null,0,40),
 ('hand-towel','Hand towel','linen','each',1,400,'Hotel linen supplier','guest',3,null,0,50),
 ('bath-mat','Bath mat','linen','each',1,600,'Hotel linen supplier','bathroom',3,null,0,60),
 ('tea-towels','Tea towels','linen','pack of 4',4,600,'Dunelm','fixed',6,null,0,70),
 ('toilet-brush','Toilet brush and holder','bathroom','each',1,800,'Dunelm','bathroom',1,null,0,10),
 ('toilet-roll-holder','Toilet roll holder','bathroom','each',1,1200,'Dunelm','bathroom',1,null,0,20),
 ('pedal-bin','Bathroom pedal bin','bathroom','each',1,1000,'Dunelm','bathroom',1,null,0,30),
 ('shower-curtain','Shower curtain or screen squeegee','bathroom','each',1,1200,'Dunelm','bathroom',1,null,0,40),
 ('soap-dispensers','Refillable soap and shampoo dispensers','bathroom','each',1,600,'Amazon','bathroom',2,null,0,50),
 ('hairdryer','Hairdryer','bathroom','each',1,2500,'Argos','fixed',1,null,0,60),
 ('cutlery','Cutlery (one place setting)','kitchen','set of 4 settings',4,1600,'IKEA','guest',2,null,0,10),
 ('dinner-plates','Dinner plates','kitchen','pack of 6',6,1500,'IKEA','guest',2,null,0,20),
 ('side-plates','Side plates','kitchen','pack of 6',6,1200,'IKEA','guest',2,null,0,30),
 ('bowls','Bowls','kitchen','pack of 6',6,1200,'IKEA','guest',2,null,0,40),
 ('mugs','Mugs','kitchen','pack of 6',6,1200,'IKEA','guest',2,null,0,50),
 ('tumblers','Tumblers','kitchen','pack of 6',6,800,'IKEA','guest',2,null,0,60),
 ('wine-glasses','Wine glasses','kitchen','pack of 4',4,1000,'IKEA','guest',2,null,0,70),
 ('saucepans','Saucepan set (3 pans)','kitchen','set',1,4000,'Argos','fixed',1,'cookerNotInduction',0,80),
 ('saucepans-induction','Induction saucepan set (3 pans)','kitchen','set',1,5500,'Argos','fixed',1,'cookerInduction',0,90),
 ('frying-pans','Frying pans','kitchen','set of 2',1,2500,'Argos','fixed',1,null,0,100),
 ('baking-trays','Baking tray','kitchen','each',1,800,'Dunelm','fixed',2,null,0,110),
 ('casserole-dish','Casserole dish','kitchen','each',1,2000,'Dunelm','fixed',1,null,0,120),
 ('knife-block','Knife block','kitchen','set',1,3500,'Argos','fixed',1,null,0,130),
 ('chopping-boards','Chopping boards','kitchen','set of 3',1,1200,'Dunelm','fixed',1,null,0,140),
 ('utensil-set','Kitchen utensil set','kitchen','set',1,1500,'Dunelm','fixed',1,null,0,150),
 ('prep-set','Colander, measuring jug and mixing bowls','kitchen','set',1,2000,'Dunelm','fixed',1,null,0,160),
 ('cafetiere','Cafetiere','kitchen','each',1,1500,'Dunelm','fixed',1,null,0,170),
 ('kitchen-bin','Kitchen bin','kitchen','each',1,3500,'Argos','fixed',1,null,0,180),
 ('recycling-bins','Recycling bin','kitchen','each',1,1500,'Argos','fixed',2,null,0,190),
 ('washing-up','Washing-up bowl and drying rack','kitchen','set',1,1500,'Dunelm','fixed',1,'noDishwasher',0,200),
 ('dining-table','Dining table','kitchen','each',1,20000,'IKEA','fixed',1,null,0,210),
 ('dining-chairs','Dining chair','kitchen','each',1,5000,'IKEA','guest',1,null,0,220),
 ('sofa','Sofa','living','each',1,60000,'Dunelm','livingRoom',1,null,0,10),
 ('sofa-bed','Sofa bed','living','each',1,55000,'Dunelm','sofaBed',1,null,0,20),
 ('coffee-table','Coffee table','living','each',1,8000,'IKEA','livingRoom',1,null,0,30),
 ('rug','Rug','living','each',1,6000,'Dunelm','livingRoom',1,null,0,40),
 ('floor-lamp','Floor lamp with bulb','living','each',1,4000,'IKEA','livingRoom',1,null,0,50),
 ('cushions','Cushions','living','pack of 2',2,1500,'Dunelm','livingRoom',2,null,0,60),
 ('throw','Throw','living','each',1,2000,'Dunelm','livingRoom',1,null,0,70),
 ('smart-tv','Smart TV (43 inch)','living','each',1,30000,'Currys','livingRoom',1,'tvAny',0,80),
 ('tv-bracket','TV wall bracket','living','each',1,3000,'Screwfix','livingRoom',1,'tvBracket',0,90),
 ('tv-stand','TV stand','living','each',1,8000,'IKEA','livingRoom',1,'tvStand',0,100),
 ('curtains','Lined curtains (pair)','windows','pair',1,3500,'Dunelm','window',1,'curtains',0,10),
 ('curtain-pole','Curtain pole','windows','each',1,2000,'Dunelm','window',1,'curtains',0,20),
 ('roller-blind','Blackout roller blind','windows','each',1,3000,'Dunelm','window',1,'blinds',0,30),
 ('lamp-shade','Lamp shade','windows','each',1,1500,'Dunelm','exposedBulb',1,null,0,40),
 ('spare-bulbs','Spare LED bulbs','windows','pack of 4',4,800,'Screwfix','fixed',4,null,0,50),
 ('kettle','Kettle','appliances','each',1,3000,'Argos','fixed',1,null,0,10),
 ('toaster','Toaster','appliances','each',1,3000,'Argos','fixed',1,null,0,20),
 ('microwave','Microwave','appliances','each',1,8000,'Currys','fixed',1,null,0,30),
 ('dishwasher','Integrated dishwasher','appliances','each',1,35000,'Currys','fixed',1,'dishwasher',0,40),
 ('tumble-dryer','Tumble dryer','appliances','each',1,30000,'Currys','fixed',1,'tumbleDryer',0,50),
 ('vacuum','Cordless vacuum cleaner','cleaning','each',1,15000,'Argos','fixed',1,null,0,10),
 ('mop-bucket','Mop and bucket','cleaning','set',1,2000,'Dunelm','fixed',1,null,0,20),
 ('iron','Iron','cleaning','each',1,2500,'Argos','fixed',1,null,0,30),
 ('ironing-board','Ironing board','cleaning','each',1,2500,'Argos','fixed',1,null,0,40),
 ('clothes-airer','Clothes airer','cleaning','each',1,2000,'Dunelm','fixed',1,null,0,50),
 ('cleaning-caddy','Cleaning caddy starter kit','cleaning','set',1,3000,'Amazon','fixed',1,null,0,60),
 ('key-safe','Key safe','safety','each',1,3500,'Screwfix','fixed',1,null,0,10),
 ('long-keybox','Extra-long keybox','safety','each',1,6000,'Screwfix','fixed',1,'longKeybox',0,20),
 ('noise-monitor','Noise monitor','safety','each',1,15000,'Amazon','fixed',1,'noiseMonitor',0,30),
 ('security-camera','External security camera','safety','each',1,12000,'Currys','fixed',1,'securityCamera',0,40),
 ('fire-blanket','Fire blanket','safety','each',1,1200,'Screwfix','fixed',1,null,0,50),
 ('fire-extinguisher','Fire extinguisher','safety','each',1,3000,'Screwfix','fixed',1,null,0,60),
 ('first-aid-kit','First-aid kit','safety','each',1,1500,'Amazon','fixed',1,null,0,70),
 ('co-alarm','Carbon monoxide alarm','safety','each',1,2500,'Screwfix','fixed',1,'cookerGas',0,80),
 ('door-mats','Door mat','safety','each',1,1500,'Dunelm','exitDoor',2,null,0,90),
 ('storage-padlock','Storage cupboard padlock','safety','each',1,1000,'Screwfix','fixed',1,null,0,100),
 ('garden-furniture','Garden table and chairs','outdoor','set',1,15000,'B&Q','fixed',1,'garden',0,10),
 ('rotary-airer','Rotary washing line','outdoor','each',1,3000,'B&Q','fixed',1,'garden',0,20),
 ('labour','Set-up and installation labour','labour','job',1,45000,'Recharge team','fixed',1,null,25000,10)
) as v(code,name,category,unit,pack,cap,supplier,basis,per,rule_when,step,sort)
on conflict (code) do nothing;

-- Who may use it ------------------------------------------------------------------------------------------------------
-- The one place that decides: the Stays team and management (admins and super admins). Everyone else is refused.
create or replace function private.workspace_furnishing_actor() returns text language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if actor not in ('stays','admin','super_admin') then raise exception 'Furnishing Studio is for the Stays team and management' using errcode='42501';end if;
 return actor;
end $fn$;

-- The property details, checked and returned clean: counts in their ranges (the same as lib/furnishing-studio.ts
-- COUNT_INPUTS), one primary setup per zip & link bed, and the known choices.
create or replace function private.workspace_furnishing_inputs(input jsonb) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare
 counts constant text[][]:=array[['bedrooms','0','12'],['guests','1','24'],['bathrooms','0','8'],['livingRooms','0','4'],['exitDoors','1','6'],['zipLinkBeds','0','12'],
  ['doubleBeds','0','12'],['singleBeds','0','16'],['sofaBeds','0','4'],['windows','0','40'],['exposedBulbs','0','30'],['bedsideTables','0','30'],['mirrors','0','12'],
  ['clothesRails','0','12'],['drawers','0','12'],['wardrobes','0','12']];
 flags constant text[]:=array['garden','dishwasher','tumbleDryer','noiseMonitor','securityCamera','longKeybox'];
 result jsonb:='{}'::jsonb;i integer;v integer;f text;setup jsonb;
begin
 if input is null or jsonb_typeof(input)<>'object' or octet_length(input::text)>4000 or exists(select 1 from jsonb_object_keys(input) k where k not in
   ('propertyType','zipLinkSetups','tv','windowCovering','cooker','bedrooms','guests','bathrooms','livingRooms','exitDoors','zipLinkBeds','doubleBeds','singleBeds','sofaBeds',
    'windows','exposedBulbs','bedsideTables','mirrors','clothesRails','drawers','wardrobes','garden','dishwasher','tumbleDryer','noiseMonitor','securityCamera','longKeybox')) then
  raise exception 'Check the property details' using errcode='22023';
 end if;
 for i in 1..array_length(counts,1) loop
  if jsonb_typeof(input->counts[i][1]) is distinct from 'number' or (input->>counts[i][1])!~'^\d{1,3}$' then raise exception 'Enter the % as a whole number',counts[i][1] using errcode='22023';end if;
  v:=(input->>counts[i][1])::integer;
  if v<counts[i][2]::integer or v>counts[i][3]::integer then raise exception 'The % can be % to %',counts[i][1],counts[i][2],counts[i][3] using errcode='22023';end if;
  result:=result||jsonb_build_object(counts[i][1],v);
 end loop;
 foreach f in array flags loop
  if jsonb_typeof(input->f) is distinct from 'boolean' then raise exception 'Check the property details' using errcode='22023';end if;
  result:=result||jsonb_build_object(f,(input->>f)::boolean);
 end loop;
 if coalesce(input->>'propertyType','') not in ('flat','house','cottage','bungalow','maisonette','studio','other') then raise exception 'Choose the property type' using errcode='22023';end if;
 if coalesce(input->>'tv','') not in ('bracket','stand','none') then raise exception 'Choose the TV setup' using errcode='22023';end if;
 if coalesce(input->>'windowCovering','') not in ('curtains','blinds','none') then raise exception 'Choose the window coverings' using errcode='22023';end if;
 if coalesce(input->>'cooker','') not in ('electric','gas','induction') then raise exception 'Choose the cooker type' using errcode='22023';end if;
 if jsonb_typeof(input->'zipLinkSetups') is distinct from 'array' or jsonb_array_length(input->'zipLinkSetups')<>(result->>'zipLinkBeds')::integer then
  raise exception 'Choose Double or Twin for each zip & link bed' using errcode='22023';
 end if;
 for setup in select value from jsonb_array_elements(input->'zipLinkSetups') loop
  if setup is distinct from '"double"'::jsonb and setup is distinct from '"twin"'::jsonb then raise exception 'Choose Double or Twin for each zip & link bed' using errcode='22023';end if;
 end loop;
 return result||jsonb_build_object('propertyType',input->>'propertyType','tv',input->>'tv','windowCovering',input->>'windowCovering','cooker',input->>'cooker','zipLinkSetups',input->'zipLinkSetups');
end $fn$;

-- Shapes the screens read -------------------------------------------------------------------------------------------
create or replace function private.workspace_furnishing_item_json(i private.workspace_furnishing_items) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'category',i.category,'unit',i.unit,'packSize',i.pack_size,'costCapPence',i.cost_cap_pence,
  'retailPricePence',i.retail_price_pence,'supplier',i.supplier,'productUrl',i.product_url,
  'rule',jsonb_build_object('basis',i.rule_basis,'per',i.rule_per,'when',i.rule_when),'stepPence',i.step_pence,'active',i.active,'sortOrder',i.sort_order,
  'version',i.version,'updatedAt',i.updated_at,'updatedBy',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=i.updated_by))
$fn$;

create or replace function private.workspace_furnishing_line_json(l private.workspace_furnishing_lines) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',l.id,'itemId',l.item_id,'position',l.position,'name',l.name,'category',l.category,'unit',l.unit,'packSize',l.pack_size,'supplier',l.supplier,
  'productUrl',l.product_url,'unitCostPence',l.unit_cost_pence,'unitPricePence',l.unit_price_pence,'suggestedUnits',l.suggested_units,'units',l.units,
  'existingUnits',l.existing_units,'packs',l.packs,'costPence',l.cost_pence,'pricePence',l.price_pence,'purchased',l.purchased,'actualPence',l.actual_pence,
  'purchasedAt',l.purchased_at,'purchasedBy',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=l.purchased_by))
$fn$;

-- One project: the summary for the list, and with `full_view` the details, the current lines and the history.
create or replace function private.workspace_furnishing_project_json(pr private.workspace_furnishing_projects,full_view boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',pr.id,'number',pr.number,'status',pr.status,'archived',pr.archived,'clientName',pr.client_name,'clientEmail',pr.client_email,
  'propertyId',pr.property_id,'propertyName',(select p.name from public.workspace_properties p where p.id=pr.property_id),'address',pr.address,'estimateOn',pr.estimate_on,
  'bedrooms',pr.bedrooms,'estimatePence',pr.estimate_pence,'quotePence',pr.quote_pence,
  'toPurchase',(select coalesce(sum(l.packs),0) from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision),
  'purchasedLines',(select count(*) from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision and l.packs>0 and l.purchased),
  'shoppingLines',(select count(*) from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision and l.packs>0),
  'version',pr.version,'updatedAt',pr.updated_at)
 ||case when full_view then jsonb_build_object('inputs',pr.inputs,'markupPercent',pr.markup_percent,'feePence',pr.fee_pence,'vat',pr.vat,'notes',pr.notes,
   'subtotalPence',pr.subtotal_pence,'vatPence',pr.vat_pence,'sentAt',pr.sent_at,
   'actualPence',(select coalesce(sum(l.actual_pence),0) from private.workspace_furnishing_lines l where l.project_id=pr.id and l.revision=pr.line_revision and l.purchased),
   'lines',coalesce((select jsonb_agg(private.workspace_furnishing_line_json(l) order by l.position) from private.workspace_furnishing_lines l
    where l.project_id=pr.id and l.revision=pr.line_revision),'[]'::jsonb),
   'history',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'fromStatus',e.from_status,'toStatus',e.to_status,'at',e.at,
     'by',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=e.actor_id)) order by e.id)
    from private.workspace_furnishing_events e where e.project_id=pr.id),'[]'::jsonb)) else '{}'::jsonb end
$fn$;

-- Reads ----------------------------------------------------------------------------------------------------------------
create or replace function private.workspace_furnishing_read(section text,target_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_furnishing_actor();pr private.workspace_furnishing_projects;
begin
 if section='catalogue' then
  return coalesce((select jsonb_agg(private.workspace_furnishing_item_json(i) order by i.active desc,
    array_position(array['bedroom','linen','bathroom','kitchen','living','windows','appliances','cleaning','safety','outdoor','labour'],i.category),i.sort_order,i.name,i.id)
   from private.workspace_furnishing_items i),'[]'::jsonb);
 elsif section='projects' then
  return coalesce((select jsonb_agg(private.workspace_furnishing_project_json(x,false) order by x.updated_at desc,x.id)
   from (select * from private.workspace_furnishing_projects order by updated_at desc,id limit 500) x),'[]'::jsonb);
 elsif section='project' then
  select * into pr from private.workspace_furnishing_projects where id=target_id;
  if pr.id is null then raise exception 'Project not found' using errcode='P0002';end if;
  return private.workspace_furnishing_project_json(pr,true);
 elsif section='properties' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'bedrooms',least(p.bedrooms,12)) order by p.name,p.id)
   from public.workspace_properties p where p.status<>'archived'),'[]'::jsonb);
 end if;
 raise exception 'Unknown Furnishing Studio section' using errcode='22023';
end $fn$;

-- Analytics for the projects with an estimate date in the dates (archived ones left out). "Sent" counts every quote that
-- reached the client (sent, accepted, declined, purchasing, complete); "accepted" those the client accepted (accepted,
-- purchasing, complete). The conversion rate is accepted / sent. Spend compares, for the lines ticked as bought with an
-- actual spend recorded, the cost-cap estimate with what was paid. Top items are across accepted quotes: retail units to
-- buy, and spend (the actual where recorded, else the estimate).
create or replace function private.workspace_furnishing_analytics(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_furnishing_actor();result jsonb;
begin
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>731 then raise exception 'Choose up to two years' using errcode='22023';end if;
 with p as (select * from private.workspace_furnishing_projects x where not x.archived and x.estimate_on between start_on and end_on),
 sent as (select * from p where p.status in ('sent','accepted','declined','purchasing','complete')),
 won as (select * from p where p.status in ('accepted','purchasing','complete')),
 wl as (select l.* from won w join private.workspace_furnishing_lines l on l.project_id=w.id and l.revision=w.line_revision where l.packs>0),
 items as (select wl.item_id,max(wl.name) item_name,max(wl.category) category,sum(wl.packs)::bigint packs,sum(coalesce(wl.actual_pence,wl.cost_pence))::bigint spend from wl group by wl.item_id),
 spend as (select count(*) filter(where wl.purchased) bought,count(*) filter(where wl.purchased and wl.actual_pence is not null) recorded,
   coalesce(sum(wl.cost_pence) filter(where wl.purchased and wl.actual_pence is not null),0)::bigint est,
   coalesce(sum(wl.actual_pence) filter(where wl.purchased and wl.actual_pence is not null),0)::bigint act from wl)
 select jsonb_build_object('from',start_on,'to',end_on,'projects',(select count(*) from p),
  'byStatus',(select jsonb_agg(jsonb_build_object('status',u.s,'projects',(select count(*) from p where p.status=u.s),
    'quotePence',(select coalesce(sum(p.quote_pence),0) from p where p.status=u.s)) order by u.ord)
   from unnest(array['draft','sent','accepted','declined','purchasing','complete']) with ordinality u(s,ord)),
  'sent',(select count(*) from sent),'accepted',(select count(*) from won),'declined',(select count(*) from p where p.status='declined'),
  'conversionPercent',case when (select count(*) from sent)>0 then round((select count(*) from won)*100.0/(select count(*) from sent),1) end,
  'quotedPence',(select coalesce(sum(sent.quote_pence),0) from sent),'acceptedPence',(select coalesce(sum(won.quote_pence),0) from won),
  'averagePerBedroomPence',case when exists(select 1 from sent) then round((select sum(sent.quote_pence) from sent)::numeric/(select sum(greatest(sent.bedrooms,1)) from sent))::bigint end,
  'averageQuotePence',case when exists(select 1 from sent) then round((select avg(sent.quote_pence) from sent))::bigint end,
  'spend',(select jsonb_build_object('purchasedLines',s.bought,'recordedLines',s.recorded,'estimatePence',s.est,'actualPence',s.act,'variancePence',s.act-s.est,
    'variancePercent',case when s.est>0 then round((s.act-s.est)*100.0/s.est,1) end) from spend s),
  'topByUnits',coalesce((select jsonb_agg(jsonb_build_object('itemId',x.item_id,'name',x.item_name,'category',x.category,'packs',x.packs,'spendPence',x.spend) order by x.packs desc,x.item_name)
   from (select * from items order by packs desc,item_name limit 10) x),'[]'::jsonb),
  'topBySpend',coalesce((select jsonb_agg(jsonb_build_object('itemId',x.item_id,'name',x.item_name,'category',x.category,'packs',x.packs,'spendPence',x.spend) order by x.spend desc,x.item_name)
   from (select * from items order by spend desc,item_name limit 10) x),'[]'::jsonb),
  'byMonth',(select jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),
    'projects',(select count(*) from p where date_trunc('month',p.estimate_on::timestamp)=m),
    'sent',(select count(*) from sent where date_trunc('month',sent.estimate_on::timestamp)=m),
    'accepted',(select count(*) from won where date_trunc('month',won.estimate_on::timestamp)=m),
    'quotedPence',(select coalesce(sum(sent.quote_pence),0) from sent where date_trunc('month',sent.estimate_on::timestamp)=m)) order by m)
   from generate_series(date_trunc('month',start_on::timestamp),date_trunc('month',end_on::timestamp),interval '1 month') m))
 into result;
 return result;
end $fn$;

-- Writing a quote's lines ------------------------------------------------------------------------------------------------
-- Writes revision `rev` of a project's lines from [{itemId, suggestedUnits, units, existingUnits}], each copying the catalogue
-- item as it is now, and works out the totals. Retail units to buy are the units needed less the stock already there, in
-- whole packs. The cost is the cost cap; the client price the retail price (else the cost cap) with the markup, rounded to
-- the penny, halves up; both add the item's step for each bedroom after the first. The same sums as lib/furnishing-studio.ts.
create or replace function private.workspace_furnishing_write_lines(target uuid,rev integer,lines jsonb) returns void language plpgsql security definer set search_path='' as $fn$
declare pr private.workspace_furnishing_projects;it private.workspace_furnishing_items;l jsonb;pos integer:=0;u integer;ex integer;sg integer;n integer;
 extra integer;bps bigint;cost bigint;price bigint;marked bigint;net bigint;vat_amount bigint;
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 select * into pr from private.workspace_furnishing_projects where id=target;
 if pr.id is null then raise exception 'Project not found' using errcode='P0002';end if;
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines)>400 then raise exception 'A quote can have up to 400 lines' using errcode='22023';end if;
 extra:=greatest(pr.bedrooms,1)-1;bps:=round(pr.markup_percent*100)::bigint;
 for l in select value from jsonb_array_elements(lines) loop
  pos:=pos+1;
  if jsonb_typeof(l) is distinct from 'object' or exists(select 1 from jsonb_object_keys(l) k where k not in ('itemId','suggestedUnits','units','existingUnits'))
   or coalesce(l->>'itemId','')!~uuid_re
   or jsonb_typeof(l->'units') is distinct from 'number' or (l->>'units')!~'^\d{1,5}$'
   or jsonb_typeof(l->'existingUnits') is distinct from 'number' or (l->>'existingUnits')!~'^\d{1,5}$'
   or jsonb_typeof(l->'suggestedUnits') is distinct from 'number' or (l->>'suggestedUnits')!~'^\d{1,5}$' then
   raise exception 'Check the quantities' using errcode='22023';
  end if;
  u:=(l->>'units')::integer;ex:=(l->>'existingUnits')::integer;sg:=(l->>'suggestedUnits')::integer;
  if u>10000 or ex>10000 or sg>10000 then raise exception 'A quantity can be up to 10,000' using errcode='22023';end if;
  if ex>u then raise exception 'Existing stock cannot be more than the quantity needed' using errcode='22023';end if;
  select * into it from private.workspace_furnishing_items where id=(l->>'itemId')::uuid;
  if it.id is null or not it.active then raise exception 'A product is no longer in the catalogue. Refresh and try again' using errcode='22023';end if;
  if exists(select 1 from private.workspace_furnishing_lines x where x.project_id=target and x.revision=rev and x.item_id=it.id) then
   raise exception '% is listed twice',it.name using errcode='22023';
  end if;
  n:=(greatest(u-ex,0)+it.pack_size-1)/it.pack_size;
  cost:=it.cost_cap_pence+it.step_pence*extra;
  price:=coalesce(it.retail_price_pence,it.cost_cap_pence)+it.step_pence*extra;
  marked:=(price*(10000+bps)+5000)/10000;
  insert into private.workspace_furnishing_lines(project_id,revision,position,item_id,name,category,unit,pack_size,supplier,product_url,unit_cost_pence,unit_price_pence,
   suggested_units,units,existing_units,packs,cost_pence,price_pence)
  values(target,rev,pos,it.id,it.name,it.category,it.unit,it.pack_size,it.supplier,it.product_url,cost,price,sg,u,ex,n,n*cost,n*marked);
 end loop;
 select coalesce(sum(x.cost_pence),0),coalesce(sum(x.price_pence),0) into cost,price from private.workspace_furnishing_lines x where x.project_id=target and x.revision=rev;
 net:=price+pr.fee_pence;
 vat_amount:=case when pr.vat then (net*20+50)/100 else 0 end;
 update private.workspace_furnishing_projects set line_revision=rev,estimate_pence=cost,subtotal_pence=price,vat_pence=vat_amount,quote_pence=net+vat_amount where id=target;
end $fn$;

-- A whole number of pence from the input (0 to GBP 100,000), or null when allowed and absent.
create or replace function private.workspace_furnishing_pence(input jsonb,k text,label text,optional boolean) returns bigint language plpgsql immutable set search_path='' as $fn$
begin
 if input->k is null or jsonb_typeof(input->k)='null' then
  if optional then return null;end if;
  raise exception 'Enter the %',label using errcode='22023';
 end if;
 if jsonb_typeof(input->k)<>'number' or (input->>k)!~'^\d{1,8}$' or (input->>k)::bigint>10000000 then raise exception 'Enter the % in pence, up to GBP 100,000',label using errcode='22023';end if;
 return (input->>k)::bigint;
end $fn$;

-- Actions ------------------------------------------------------------------------------------------------------------
--  saveItem        add a catalogue item, or change one (against its version); active=false takes it out of new quotes.
--  saveProject     create a draft quote or change one (against its version): the client, the property or address, the
--                  property details, the markup, fee and VAT, notes, and every line (a new revision).
--  moveProject     draft -> sent (a fresh revision from the catalogue as it is now, then frozen); sent -> accepted, declined
--                  or back to draft; declined -> draft; accepted -> purchasing; purchasing -> complete.
--  archiveProject  hide a project from the list, or bring it back (never deleted).
--  tickLine        once accepted: a line bought or not, with the actual spend. The first tick moves an accepted quote to
--                  purchasing.
create or replace function private.workspace_furnishing_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_furnishing_actor();a text;req uuid;prior private.workspace_action_receipts;result jsonb;
 it private.workspace_furnishing_items;pr private.workspace_furnishing_projects;ln private.workspace_furnishing_lines;
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 v_name text;v_category text;v_unit text;v_pack integer;v_cap bigint;v_retail bigint;v_supplier text;v_url text;v_rule jsonb;v_basis text;v_per numeric;v_when text;v_step bigint;
 v_client text;v_email text;v_property uuid;v_address text;v_on date;v_inputs jsonb;v_markup numeric;v_fee bigint;v_notes text;
 to_status text;from_status text;yr integer;num integer;rev_lines jsonb;
 today date:=(now() at time zone 'Europe/London')::date;
begin
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=coalesce(input->>'action','');
 if a='saveItem' then perform private.workspace_json_keys(input,array['action','requestId','id','version','name','category','unit','packSize','costCapPence','retailPricePence',
   'supplier','productUrl','rule','stepPence','active'],8000);
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
  if it.id is null then
   insert into private.workspace_furnishing_items(name,category,unit,pack_size,cost_cap_pence,retail_price_pence,supplier,product_url,rule_basis,rule_per,rule_when,step_pence,active,
    sort_order,created_by,updated_by)
   values(v_name,v_category,v_unit,v_pack,v_cap,v_retail,v_supplier,v_url,v_basis,v_per,v_when,v_step,(input->>'active')::boolean,
    coalesce((select max(x.sort_order) from private.workspace_furnishing_items x where x.category=v_category),0)+10,auth.uid(),auth.uid()) returning * into it;
   insert into private.workspace_furnishing_item_history(item_id,actor_id,action,version) values(it.id,auth.uid(),'created',it.version);
  else
   insert into private.workspace_furnishing_item_history(item_id,actor_id,action,version,before) values(it.id,auth.uid(),'saved',it.version+1,private.workspace_furnishing_item_json(it)-'updatedBy'-'updatedAt');
   update private.workspace_furnishing_items set name=v_name,category=v_category,unit=v_unit,pack_size=v_pack,cost_cap_pence=v_cap,retail_price_pence=v_retail,supplier=v_supplier,
    product_url=v_url,rule_basis=v_basis,rule_per=v_per,rule_when=v_when,step_pence=v_step,active=(input->>'active')::boolean,version=version+1,updated_by=auth.uid(),updated_at=now()
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

-- Public wrappers (security invoker): signed-in people call these; the private functions decide who may do what.
create or replace function public.workspace_furnishing_read(section text,target_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_furnishing_read(section,target_id);$$;
create or replace function public.workspace_furnishing_analytics(start_on date,end_on date) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_furnishing_analytics(start_on,end_on);$$;
create or replace function public.workspace_furnishing_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_furnishing_action(input);$$;

-- The helpers are internal: nobody calls them directly.
revoke all on function private.workspace_furnishing_actor(),private.workspace_furnishing_inputs(jsonb),
 private.workspace_furnishing_item_json(private.workspace_furnishing_items),private.workspace_furnishing_line_json(private.workspace_furnishing_lines),
 private.workspace_furnishing_project_json(private.workspace_furnishing_projects,boolean),private.workspace_furnishing_write_lines(uuid,integer,jsonb),
 private.workspace_furnishing_pence(jsonb,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.workspace_furnishing_read(text,uuid),public.workspace_furnishing_read(text,uuid),
 private.workspace_furnishing_analytics(date,date),public.workspace_furnishing_analytics(date,date),
 private.workspace_furnishing_action(jsonb),public.workspace_furnishing_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_furnishing_read(text,uuid),public.workspace_furnishing_read(text,uuid),
 private.workspace_furnishing_analytics(date,date),public.workspace_furnishing_analytics(date,date),
 private.workspace_furnishing_action(jsonb),public.workspace_furnishing_action(jsonb) to authenticated;
