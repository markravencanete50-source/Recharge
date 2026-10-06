-- Portfolio/report read models and dated local evidence. No invented coordinates or events.
drop policy properties_assigned on public.workspace_properties;
create policy properties_assigned on public.workspace_properties for select to authenticated using (
 (select private.workspace_actor_role()) is not null and ((select private.workspace_actor_role()) in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())))
);
create table private.workspace_local_events (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.workspace_properties(id),
 name text not null check(length(name) between 2 and 200),event_on date not null,source_url text not null check(length(source_url)<=1000),
 opportunity text not null check(length(opportunity) between 5 and 2000),created_by uuid not null references public.workspace_profiles(user_id),created_at timestamptz not null default now()
);
create index workspace_local_events_property_date_idx on private.workspace_local_events(property_id,event_on);
alter table private.workspace_local_events enable row level security;
revoke all on private.workspace_local_events from public,anon,authenticated;
create trigger business_write_limit before insert or update or delete on private.workspace_local_events for each row execute function private.workspace_enforce_write_limit();

create or replace function private.workspace_handover(target_property uuid,feature text,title text,kind text,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;event_id bigint;begin
 insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),target_property,feature,title,auth.uid(),false) returning id into target;
 insert into private.workspace_domain_details(work_id,kind,data) values(target,kind,payload);
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),target_property,target,'handover.created') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
 select p.user_id,target,event_id from public.workspace_profiles p where p.status='active' and p.role not in ('client','cleans') and
 (p.role in ('admin','super_admin') or exists(select 1 from public.workspace_module_grants g join public.workspace_property_assignments a on a.user_id=g.user_id where g.user_id=p.user_id and g.module_id=feature and a.property_id=target_property)) on conflict do nothing;
 return target;
end $$;

create or replace function private.workspace_can_work(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_work_items w join public.workspace_features f using(module_id) where w.id=target and (
  (private.workspace_actor_role()='client' and w.client_visible and f.client_module is not null and private.workspace_can_property(w.property_id,f.client_module)) or
  (private.workspace_actor_role()='cleans' and w.assignee_id=auth.uid() and private.workspace_can_property(w.property_id,w.module_id)) or
  (private.workspace_actor_role() not in ('client','cleans') and private.workspace_can_property(w.property_id,w.module_id)) or
  (private.workspace_actor_role()='ready' and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and (
   d.kind='maintenance' and d.data->>'referredAt' is not null and private.workspace_can_property(w.property_id,'maintenance-reporting') or
   d.kind='purchase' and d.data->>'phase' in ('ordered','delivered','reconciled') and private.workspace_can_property(w.property_id,'purchase-order'))))
 ));
$$;

create function private.workspace_portfolio_read(section text,target_property uuid default null,start_on date default null,end_on date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role(); result jsonb;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='portfolio' then
  if actor not in ('admin','super_admin','client','stays') or not private.has_workspace_module(case when actor='client' then 'client-dashboard' else 'property-database' end) then raise exception 'Portfolio access denied' using errcode='42501';end if;
  with permitted as(select p.* from public.workspace_properties p where (target_property is null or p.id=target_property) and private.workspace_can_property(p.id,case when actor='client' then 'client-dashboard' else 'property-database' end)),
  rows as(select p.*,j.stage,j.client_id from permitted p left join private.workspace_journeys j on j.property_id=p.id order by p.updated_at desc limit 100)
  select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'region',p.region,'status',p.status,'bedrooms',p.bedrooms,'latitude',p.latitude,'longitude',p.longitude,'hostawayListingId',p.hostaway_listing_id,'version',p.version,'stage',p.stage,'clientId',p.client_id,'listingLinks',coalesce(l.links,'[]')) order by p.updated_at desc) from rows p left join private.workspace_listing_links l on l.property_id=p.id),'[]'),
   'count',(select count(*) from permitted),'more',(select count(*)>100 from permitted),
   'regions',coalesce((select jsonb_agg(r) from(select region,count(*) as properties from permitted group by region order by region) r),'[]'),
   'clients',coalesce((select jsonb_agg(c) from(select j.client_id,count(*) as properties from permitted p join private.workspace_journeys j on j.property_id=p.id group by j.client_id order by j.client_id) c),'[]')) into result;
 elsif section='bookingPolicy' then
  if actor not in ('stays','admin','super_admin') or not private.has_workspace_module('direct-bookings') then raise exception 'Booking policy access denied' using errcode='42501';end if;
  select to_jsonb(p)-'singleton' into result from private.workspace_booking_policy p;
 elsif section in ('reservations','vacancies') then
  if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(target_property,'daily-pricing') then raise exception 'Pricing calendar access denied' using errcode='42501';end if;
  if section='reservations' then select coalesce(jsonb_agg(r),'[]') into result from(select id,reference,check_in,check_out,status,source from private.workspace_reservations where property_id=target_property order by check_in desc limit 100) r;
  else select coalesce(jsonb_agg(jsonb_build_object('night',night::date,'occupied',exists(select 1 from private.workspace_reservations r where r.property_id=target_property and r.status='confirmed' and r.check_in<=night::date and r.check_out>night::date)) order by night),'[]') into result from generate_series(current_date::timestamp,(current_date+6)::timestamp,'1 day') night;end if;
 elsif section='weekly' then
  if actor not in ('client','stays','admin','super_admin') or not private.workspace_can_property(target_property,case when actor='client' then 'client-dashboard' else 'weekly-performance' end) then raise exception 'Property report access denied' using errcode='42501';end if;
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>30 then raise exception 'Choose up to 31 report days' using errcode='22023';end if;
  select jsonb_build_object('propertyId',p.id,'propertyName',p.name,'from',start_on,'to',end_on,'dateBasis','Europe/London',
   'listingChecks',coalesce((select jsonb_agg(jsonb_build_object('workId',w.id,'checkedOn',d.data->>'checkedOn','platform',d.data->>'platform','listingVisible',d.data->'listingVisible','reviewSentiment',d.data->>'reviewSentiment','reviewAcknowledged',d.data->'reviewAcknowledged','suspended',d.data->'suspended','evidence',d.data->>'evidence')) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='listing_health' and (d.data->>'checkedOn')::date between start_on and end_on),'[]'),
   'pricing',coalesce((select jsonb_agg(jsonb_build_object('workId',w.id,'night',d.data->>'night','decision',d.data->>'decision','currentRateMinor',d.data->'currentRateMinor','proposedRateMinor',d.data->'proposedRateMinor','reason',d.data->>'reason','phase',d.data->>'phase','appliedAt',d.data->>'appliedAt')) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='daily_pricing' and (w.created_at at time zone 'Europe/London')::date between start_on and end_on),'[]'),
   'events',coalesce((select jsonb_agg(jsonb_build_object('name',e.name,'eventOn',e.event_on,'sourceUrl',e.source_url,'opportunity',e.opportunity)) from private.workspace_local_events e where e.property_id=p.id and (e.created_at at time zone 'Europe/London')::date between start_on and end_on),'[]')) into result from public.workspace_properties p where p.id=target_property;
 elsif section='notifications' then
  select coalesce(jsonb_agg(n),'[]') into result from(select a.id,a.event_type,a.property_id,a.work_id,a.created_at,'available_in_app' as status from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=auth.uid() and (a.work_id is null or private.workspace_can_work(a.work_id)) order by a.created_at desc limit 50) n;
 elsif section='onboardingPayout' then
  if not (actor='client' and private.workspace_can_property(target_property,'client-dashboard') or actor in ('admin','super_admin') and private.workspace_can_property(target_property,'owner-statements')) then raise exception 'Payout details access denied' using errcode='42501';end if;
  select jsonb_build_object('bankAccountName',form->>'bankAccountName','bankAccountNumber',form->>'bankAccountNumber','bankSortCode',form->>'bankSortCode') into result from private.workspace_journeys where property_id=target_property;
  -- Deliberately excluded from portfolio, work, notifications and downloadable reports.
 else raise exception 'Unknown portfolio section' using errcode='22023';end if;
 return result;
end $$;
create function private.workspace_portfolio_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;prop uuid;req uuid;prior private.workspace_action_receipts;result jsonb;target uuid;v integer;begin
 if actor is null or actor not in ('stays','admin','super_admin') then raise exception 'Property team permission required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);prop:=(input->>'propertyId')::uuid;req:=(input->>'requestId')::uuid;
 if req is null or prop is null or not private.workspace_can_property(prop,case when a='recordLocalEvent' then 'weekly-performance' else 'property-database' end) then raise exception 'Property access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req;
 if found then if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;return prior.result;end if;
 if a='saveLocation' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','latitude','longitude','hostawayListingId']);
  select version into v from public.workspace_properties where id=prop for update;
  if v is distinct from (input->>'version')::integer then raise exception 'Property changed' using errcode='40001';end if;
  if (input->>'latitude' is null)<>(input->>'longitude' is null) or jsonb_typeof(input->'latitude') not in ('null','number') or jsonb_typeof(input->'longitude') not in ('null','number') then raise exception 'Provide both coordinates or neither' using errcode='22023';end if;
  update public.workspace_properties set latitude=(input->>'latitude')::numeric,longitude=(input->>'longitude')::numeric,hostaway_listing_id=nullif(input->>'hostawayListingId',''),version=version+1,updated_at=now() where id=prop;
  result:=private.workspace_portfolio_read('portfolio',prop,null,null);
 elsif a='recordLocalEvent' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','name','eventOn','sourceUrl','opportunity']);
  if private.workspace_required_text(input,'sourceUrl',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' or (input->>'eventOn')::date is null then raise exception 'Real dated event source required' using errcode='22023';end if;
  insert into private.workspace_local_events(property_id,name,event_on,source_url,opportunity,created_by) values(prop,private.workspace_required_text(input,'name',2,200),(input->>'eventOn')::date,input->>'sourceUrl',private.workspace_required_text(input,'opportunity',5,2000),auth.uid()) returning id into target;
  result:=jsonb_build_object('eventId',target,'propertyId',prop);
 else raise exception 'Unknown portfolio action' using errcode='22023';end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'portfolio.'||a);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);return result;
end $$;
create function public.workspace_portfolio_read(section text,target_property uuid default null,start_on date default null,end_on date default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_portfolio_read(section,target_property,start_on,end_on);$$;
create function public.workspace_portfolio_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_portfolio_action(input);$$;
revoke all on function private.workspace_portfolio_read(text,uuid,date,date),private.workspace_portfolio_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_portfolio_read(text,uuid,date,date),private.workspace_portfolio_action(jsonb) to authenticated;
revoke all on function public.workspace_portfolio_read(text,uuid,date,date),public.workspace_portfolio_action(jsonb) from public,anon;
grant execute on function public.workspace_portfolio_read(text,uuid,date,date),public.workspace_portfolio_action(jsonb) to authenticated;
