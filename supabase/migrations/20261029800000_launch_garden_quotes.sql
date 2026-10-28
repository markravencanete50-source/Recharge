-- Launch Preparation: the garden maintenance quote (Business Plan v1.0, 17/10/26, Garden Maintenance).
--  * When the owner asked Recharge for a regular garden maintenance quote, the property operations coordinator (the team)
--    adds the contractor's quote: who, the price a month or a visit, how often, and what it covers. The owner is told in
--    the property chat and accepts it, or rejects it and says why. A rejected quote leaves room for a new one; a new quote
--    replaces one still waiting.
--  * Accepting ticks "Garden maintenance quote accepted" and completes the garden maintenance set-up ticket. The team are
--    told either way in the property's follow-up notes.
--  * Parts ticked by hand before this stay done.
-- Replaces private.workspace_launch_plan and private.workspace_launch_view (20261029500000) and the public
-- workspace_launch_action wrapper, which sends the garden actions to private.workspace_launch_garden_action. Safe to run twice.

-- 1. The quotes.
create table if not exists private.workspace_launch_garden_quotes (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 contractor text not null check (char_length(contractor) between 1 and 200),
 price_pence integer not null check (price_pence between 1 and 10000000),
 basis text not null check (basis in ('month','visit')),
 frequency text not null check (frequency in ('weekly','fortnightly','monthly')),
 details text not null default '' check (char_length(details)<=2000),
 status text not null default 'sent' check (status in ('sent','accepted','rejected','withdrawn')),
 reason text not null default '' check (char_length(reason)<=1000),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz
);
create index if not exists workspace_launch_garden_quotes_property on private.workspace_launch_garden_quotes(property_id,created_at desc);
create unique index if not exists workspace_launch_garden_quotes_open on private.workspace_launch_garden_quotes(property_id) where status in ('sent','accepted');
alter table private.workspace_launch_garden_quotes enable row level security;
revoke all on private.workspace_launch_garden_quotes from public,anon,authenticated,service_role;

-- How a quote reads: "£120.00 a month, weekly visits".
create or replace function private.workspace_launch_garden_price(g private.workspace_launch_garden_quotes) returns text language sql immutable set search_path='' as $fn$
 select '£'||to_char(g.price_pence/100.0,'FM999,999,990.00')||case when g.basis='month' then ' a month' else ' a visit' end||', '||g.frequency||' visits'
$fn$;

-- 2. What the team and the owner see: every quote, newest first, and what each can do.
create or replace function private.workspace_launch_garden_view(prop uuid,plan jsonb,team boolean,owner boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare s jsonb;begin
 s:=(select z from jsonb_array_elements(plan) z where z->>'key'='garden.quote');
 if s is null or s->>'kind'<>'gardenQuote' or not (team or owner) then return null;end if;
 return jsonb_build_object('quotes',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'contractor',g.contractor,'pricePence',g.price_pence,'basis',g.basis,'frequency',g.frequency,
   'details',g.details,'status',g.status,'reason',g.reason,'sentAt',g.created_at,'sentByName',private.workspace_launch_person(g.created_by),
   'decidedAt',g.decided_at,'decidedByName',private.workspace_launch_person(g.decided_by)) order by g.created_at desc,g.id)
  from private.workspace_launch_garden_quotes g where g.property_id=prop and (team or g.status<>'withdrawn')),'[]'),
  'canQuote',team and s->>'state'='todo',
  'canDecide',owner and s->>'state'='todo' and exists(select 1 from private.workspace_launch_garden_quotes g where g.property_id=prop and g.status='sent'));
end $fn$;

-- 3. The checklist: the garden quote is its own kind of part.
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

-- 4. The view carries the garden quotes.
create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;fitter boolean;buyer boolean;writer boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
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
 if j.property_id is null or not (team or owner or keeper or fitter or buyer or writer) then raise exception 'Property not found' using errcode='42501';end if;
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
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper or fitter or buyer or writer then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper or fitter or writer then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isOwner',owner,'isHousekeeper',keeper,'isInstaller',fitter,'isAccounts',buyer,'isTechnician',writer,
  'furnishing',private.workspace_launch_furnishing_view(prop,team,owner,fitter,buyer),
  'inventory',private.workspace_launch_inventory_view(prop,team,owner,keeper,fitter),
  'guidebook',private.workspace_launch_guidebook_view(prop,team,owner,keeper,writer),
  'garden',private.workspace_launch_garden_view(prop,plan,team,owner),
  'canAllocate',team and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live'),
  'canBookReadiness',team and pre and hk is not null and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked'),
  'canSubmitReadiness',(team or keeper) and r.property_id is not null and r.submitted_at is null and r.booked_on<=today and j.stage='inspection_booked');
end $fn$;

-- 5. The team add a quote; the owner accepts it or rejects it with a reason.
create or replace function private.workspace_launch_garden_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;
 g private.workspace_launch_garden_quotes;price integer;words text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','contractor','pricePence','basis','frequency','details','quoteId','decision','reason'],20000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 begin prop:=(input->>'propertyId')::uuid; exception when others then raise exception 'Property not found' using errcode='42501'; end;
 if prop is null then raise exception 'Property not found' using errcode='42501';end if;
 perform 1 from private.workspace_journeys where property_id=prop for update;
 view:=private.workspace_launch_view(prop);
 part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'='garden.quote');
 if part is null or part->>'kind'<>'gardenQuote' then raise exception 'The owner has not asked for a garden maintenance quote' using errcode='22023';end if;
 if part->>'state'='locked' then raise exception '%',coalesce(part->>'lockedBecause','Not open yet') using errcode='22023';end if;
 if part->>'state'<>'todo' then raise exception 'The garden maintenance quote is already accepted' using errcode='22023';end if;
 if input->>'action'='addGardenQuote' then
  if not coalesce((view->>'isTeam')::boolean,false) then raise exception 'Only the team can add the garden maintenance quote' using errcode='42501';end if;
  if jsonb_typeof(input->'contractor') is distinct from 'string' or char_length(btrim(input->>'contractor')) not between 1 and 200 then raise exception 'Enter the contractor' using errcode='22023';end if;
  if jsonb_typeof(input->'pricePence') is distinct from 'number' or (input->>'pricePence')::numeric<>trunc((input->>'pricePence')::numeric)
   or (input->>'pricePence')::numeric not between 1 and 10000000 then raise exception 'Enter the price' using errcode='22023';end if;
  price:=(input->>'pricePence')::integer;
  if coalesce(input->>'basis','') not in ('month','visit') or jsonb_typeof(input->'basis')<>'string' then raise exception 'Choose a month or a visit' using errcode='22023';end if;
  if coalesce(input->>'frequency','') not in ('weekly','fortnightly','monthly') or jsonb_typeof(input->'frequency')<>'string' then raise exception 'Choose how often' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'details','""'))<>'string' or char_length(coalesce(input->>'details',''))>2000 then raise exception 'Up to 2,000 characters on what it covers' using errcode='22023';end if;
  -- A new quote replaces one still waiting.
  update private.workspace_launch_garden_quotes set status='withdrawn' where property_id=prop and status='sent';
  insert into private.workspace_launch_garden_quotes(property_id,contractor,price_pence,basis,frequency,details,created_by)
   values(prop,btrim(input->>'contractor'),price,input->>'basis',input->>'frequency',btrim(coalesce(input->>'details','')),me) returning * into g;
  perform private.workspace_property_chat_post(prop,'Your garden maintenance quote is ready: '||private.workspace_launch_garden_price(g)
   ||'. Accept it, or tell us why not, in Launch Preparation.',null,'event',now());
  perform private.workspace_followup_note(prop,'Garden maintenance quote sent to the owner: '||g.contractor||', '||private.workspace_launch_garden_price(g)||'.',me);
 elsif input->>'action'='decideGardenQuote' then
  if not coalesce((view->>'isOwner')::boolean,false) then raise exception 'Only the owner can accept or reject the garden maintenance quote' using errcode='42501';end if;
  select * into g from private.workspace_launch_garden_quotes where id::text=input->>'quoteId' and property_id=prop for update;
  if g.id is null then raise exception 'Quote not found' using errcode='22023';end if;
  if g.status<>'sent' then raise exception 'This quote has been replaced or already decided' using errcode='22023';end if;
  if coalesce(input->>'decision','') not in ('accept','reject') then raise exception 'Accept or reject the quote' using errcode='22023';end if;
  words:=btrim(coalesce(input->>'reason',''));
  if jsonb_typeof(coalesce(input->'reason','""'))<>'string' or char_length(words)>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  if input->>'decision'='reject' and char_length(words)<3 then raise exception 'Say why you are rejecting the quote' using errcode='22023';end if;
  if input->>'decision'='accept' then
   update private.workspace_launch_garden_quotes set status='accepted',reason=words,decided_by=me,decided_at=now() where id=g.id;
   -- The garden maintenance set-up ticket is done.
   update public.workspace_work_items w set status='completed',completed_at=now(),version=w.version+1,updated_at=now() where w.property_id=prop and w.status not in ('completed','cancelled','declined')
    and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and d.kind='garden_setup');
   perform private.workspace_followup_note(prop,'The owner accepted the garden maintenance quote: '||g.contractor||', '||private.workspace_launch_garden_price(g)||'.'
    ||case when words<>'' then ' Their note: '||words else '' end,me);
  else
   update private.workspace_launch_garden_quotes set status='rejected',reason=words,decided_by=me,decided_at=now() where id=g.id;
   perform private.workspace_followup_note(prop,'The owner rejected the garden maintenance quote from '||g.contractor||': '||words||' Add a new quote in Launch Preparation.',me);
  end if;
 else
  raise exception 'Unknown Launch Preparation action' using errcode='22023';
 end if;
 result:=private.workspace_launch_read(prop);
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 6. One way in: the garden actions go to their own function.
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select case when input->>'action' in ('addGardenQuote','decideGardenQuote') then private.workspace_launch_garden_action(input) else private.workspace_launch_action(input) end;
$$;

revoke all on function private.workspace_launch_garden_price(private.workspace_launch_garden_quotes),private.workspace_launch_garden_view(uuid,jsonb,boolean,boolean),
 private.workspace_launch_garden_action(jsonb),private.workspace_launch_plan(uuid),private.workspace_launch_view(uuid),public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_garden_action(jsonb),public.workspace_launch_action(jsonb) to authenticated;
