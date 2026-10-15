-- Guests & stays (Alex, via Lee: "analytics on each stay, average number of guests etc, as much data as we can get for each
-- stay"). Part 1: only what Hostaway already sends. No guest is contacted and nothing new is asked of anyone.
--
-- 1. More booking detail on each stay. The sync (lib/hostaway-sync-policy.ts syncStayDetails) now sends stayDetails with
--    each reservation: adults, children, infants and pets (head counts), the guest's country (a two-letter code in capitals,
--    or the country name as Hostaway gives it; never an address, phone or email) and when the guest booked (bookedAt, ISO
--    UTC). They are kept in new nullable columns on private.workspace_reservations. The planned check-in and checkout
--    times are not added here: the cleaner flow (20261021500000) already keeps them (check_in_time, check_out_time).
--    private.workspace_stay_details(jsonb) keeps only well-formed values: whole counts from 0 to 50, a country of letters
--    only, a booking time from 2000 to tomorrow. A field Hostaway did not
--    send stays null, and a blank never wipes a value already kept. A detail alone never changes the stay's version or
--    counts as a changed stay, and nothing here can fail the sync: a value that cannot be read is left out.
--    Owner stays send no details.
-- 2. private.workspace_stay_analytics(start_on, end_on, target_property, target_channel) and its public wrapper: for admins
--    and super admins only (everyone else is refused, as the business reports are). Confirmed stays whose nights overlap
--    the dates (up to 366 days), owner stays left out (private.workspace_is_owner_stay), optionally one property and one
--    channel. Aggregates only: no guest name, booking reference or stay id is returned. Every average says how many stays
--    it was worked out from ("known"), so the screen can say what share of stays a field is not known for.
--    Lead time is the days from the London day the guest booked to check-in (bookings made after check-in are not counted).
--    By month: each month in the dates, counting the stays whose nights overlap that month (a stay across two months is
--    counted in both). Repeat guests are not reported: nothing about a guest that could link two stays is kept.
--
-- Patched by anchor (the anchor must occur exactly once; skipped once its sentinel is present):
--   private.workspace_hostaway_sync(jsonb), on the same anchor as 20261020900000 and 20261021500000 (cleaner flow). Each
--   keeps the anchor exactly once in its replacement, so the patches chain in migration order.
-- New: private.workspace_stay_details(jsonb), private.workspace_store_stay_details(uuid,jsonb),
--   private.workspace_stay_analytics(date,date,uuid,text) and public.workspace_stay_analytics(date,date,uuid,text).
-- Safe to run twice.

alter table private.workspace_reservations
 add column if not exists adults smallint,
 add column if not exists children smallint,
 add column if not exists infants smallint,
 add column if not exists pets smallint,
 add column if not exists guest_country text,
 add column if not exists booked_at timestamptz;
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_reservations'::regclass and conname='workspace_reservations_stay_details_valid') then
  alter table private.workspace_reservations add constraint workspace_reservations_stay_details_valid check(
   (adults is null or adults between 0 and 50) and (children is null or children between 0 and 50)
   and (infants is null or infants between 0 and 50) and (pets is null or pets between 0 and 50)
   and (guest_country is null or length(guest_country) between 2 and 60));
 end if;
end $$;

-- The details as the sync sent them, keeping only well-formed values (keys left out when unknown). Never raises.
create or replace function private.workspace_stay_details(input jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='{}';k text;v jsonb;t text;at timestamptz;
begin
 if jsonb_typeof(input) is distinct from 'object' then return null;end if;
 foreach k in array array['adults','children','infants','pets'] loop
  v:=input->k;
  if jsonb_typeof(v)='number' and (v#>>'{}')::numeric between 0 and 50 and (v#>>'{}')::numeric=trunc((v#>>'{}')::numeric) then
   result:=result||jsonb_build_object(k,(v#>>'{}')::integer);
  end if;
 end loop;
 if jsonb_typeof(input->'guestCountry')='string' then
  t:=regexp_replace(btrim(input->>'guestCountry'),'\s+',' ','g');
  if t ~ '^[A-Za-z]{2}$' then result:=result||jsonb_build_object('guestCountry',upper(t));
  elsif length(t) between 3 and 60 and t ~ '^[[:alpha:]][[:alpha:] .''()-]+$' then result:=result||jsonb_build_object('guestCountry',t);
  end if;
 end if;
 if jsonb_typeof(input->'bookedAt')='string' and input->>'bookedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
  begin at:=(input->>'bookedAt')::timestamptz;exception when others then at:=null;end;
  if at>=timestamptz '2000-01-01 00:00:00+00' and at<=now()+interval '1 day' then result:=result||jsonb_build_object('bookedAt',at);end if;
 end if;
 return result;
end $$;

-- Keep a stay's details: what is known replaces what was kept, a blank keeps it. Only writes when something changed.
create or replace function private.workspace_store_stay_details(target uuid,input jsonb) returns void language plpgsql set search_path='' as $$
declare d jsonb:=private.workspace_stay_details(input);
begin
 if target is null or d is null or d='{}'::jsonb then return;end if;
 update private.workspace_reservations w set
  adults=coalesce((d->>'adults')::smallint,w.adults),children=coalesce((d->>'children')::smallint,w.children),
  infants=coalesce((d->>'infants')::smallint,w.infants),pets=coalesce((d->>'pets')::smallint,w.pets),
  guest_country=coalesce(d->>'guestCountry',w.guest_country),booked_at=coalesce((d->>'bookedAt')::timestamptz,w.booked_at)
 where w.id=target and (w.adults,w.children,w.infants,w.pets,w.guest_country,w.booked_at) is distinct from
  (coalesce((d->>'adults')::smallint,w.adults),coalesce((d->>'children')::smallint,w.children),coalesce((d->>'infants')::smallint,w.infants),
   coalesce((d->>'pets')::smallint,w.pets),coalesce(d->>'guestCountry',w.guest_country),coalesce((d->>'bookedAt')::timestamptz,w.booked_at));
end $$;

do $patch$
declare
 fixes constant text[][] := array[
  -- The sync keeps each stay's details (after the stay is written; a detail alone never changes its version).
  ['private.workspace_hostaway_sync(jsonb)',
   $a$touched:=touched||res.property_id;$a$,
   $r$if r ? 'stayDetails' then perform private.workspace_store_stay_details(res.id,r->'stayDetails');end if;touched:=touched||res.property_id;$r$,
   $s$perform private.workspace_store_stay_details(res.id,r->'stayDetails')$s$]
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

create or replace function private.workspace_stay_analytics(start_on date,end_on date,target_property uuid default null,target_channel text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();result jsonb;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>365 then raise exception 'Choose up to 366 days' using errcode='22023';end if;
 if target_channel is not null and target_channel not in ('airbnb','booking_com','vrbo','direct','other') then raise exception 'Unknown channel' using errcode='22023';end if;

 with s as (
  select r.property_id,r.check_in,r.check_out,(r.check_out-r.check_in) nights,r.channel,r.guests,r.adults,r.children,r.infants,r.pets,r.guest_country,
   case when r.booked_at is not null and (r.booked_at at time zone 'Europe/London')::date<=r.check_in then r.check_in-(r.booked_at at time zone 'Europe/London')::date end lead_days
  from private.workspace_reservations r
  where r.status='confirmed' and not private.workspace_is_owner_stay(r) and r.check_in<=end_on and r.check_out>start_on
   and (target_property is null or r.property_id=target_property) and (target_channel is null or r.channel=target_channel)
 ), months as (
  select m::date month_start,greatest(m::date,start_on) lower_day,least((m+interval '1 month')::date-1,end_on) upper_day
  from generate_series(date_trunc('month',start_on::timestamp),date_trunc('month',end_on::timestamp),interval '1 month') m
 )
 select jsonb_build_object('from',start_on,'to',end_on,'propertyId',target_property,'channel',target_channel,
  'stays',count(*),'nights',coalesce(sum(nights),0),'averageNights',round(avg(nights),1),
  'guests',jsonb_build_object('known',count(guests),'total',coalesce(sum(guests),0),'average',round(avg(guests),1)),
  'mix',jsonb_build_object(
   'adults',jsonb_build_object('known',count(adults),'total',coalesce(sum(adults),0),'stays',count(*) filter(where adults>0)),
   'children',jsonb_build_object('known',count(children),'total',coalesce(sum(children),0),'stays',count(*) filter(where children>0)),
   'infants',jsonb_build_object('known',count(infants),'total',coalesce(sum(infants),0),'stays',count(*) filter(where infants>0)),
   'pets',jsonb_build_object('known',count(pets),'total',coalesce(sum(pets),0),'stays',count(*) filter(where pets>0))),
  'lengths',jsonb_build_array(
   jsonb_build_object('bucket','1','stays',count(*) filter(where nights=1)),
   jsonb_build_object('bucket','2-3','stays',count(*) filter(where nights between 2 and 3)),
   jsonb_build_object('bucket','4-6','stays',count(*) filter(where nights between 4 and 6)),
   jsonb_build_object('bucket','7-13','stays',count(*) filter(where nights between 7 and 13)),
   jsonb_build_object('bucket','14+','stays',count(*) filter(where nights>=14))),
  'arrivalDays',(select jsonb_agg(jsonb_build_object('day',d,'stays',(select count(*) from s where extract(isodow from s.check_in)=d)) order by d) from generate_series(1,7) d),
  'leadTime',jsonb_build_object('known',count(lead_days),'averageDays',round(avg(lead_days),0),
   'buckets',jsonb_build_array(
    jsonb_build_object('bucket','0-6','stays',count(*) filter(where lead_days between 0 and 6)),
    jsonb_build_object('bucket','7-29','stays',count(*) filter(where lead_days between 7 and 29)),
    jsonb_build_object('bucket','30-89','stays',count(*) filter(where lead_days between 30 and 89)),
    jsonb_build_object('bucket','90-179','stays',count(*) filter(where lead_days between 90 and 179)),
    jsonb_build_object('bucket','180+','stays',count(*) filter(where lead_days>=180)))),
  'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',x.channel,'stays',x.n) order by x.n desc,x.channel) from (
    select s.channel,count(*)::int n from s group by s.channel) x),'[]'),
  'countries',jsonb_build_object('known',count(guest_country),'others',coalesce((select sum(y.n) from (
    select count(*)::int n from s where s.guest_country is not null group by s.guest_country order by count(*) desc,s.guest_country offset 10) y),0),
   'top',coalesce((select jsonb_agg(jsonb_build_object('country',x.guest_country,'stays',x.n) order by x.n desc,x.guest_country) from (
    select s.guest_country,count(*)::int n from s where s.guest_country is not null group by s.guest_country order by count(*) desc,s.guest_country limit 10) x),'[]')),
  'byMonth',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'stays',x.n,'nights',x.nights,'averageNights',x.avg_nights,
    'guestsKnown',x.guests_known,'averageGuests',x.avg_guests,'leadKnown',x.lead_known,'averageLeadDays',x.avg_lead) order by m.month_start),'[]')
   from months m cross join lateral (select count(*)::int n,coalesce(sum(s.nights),0)::int nights,round(avg(s.nights),1) avg_nights,count(s.guests)::int guests_known,
    round(avg(s.guests),1) avg_guests,count(s.lead_days)::int lead_known,round(avg(s.lead_days),0) avg_lead
    from s where s.check_in<=m.upper_day and s.check_out>m.lower_day) x),
  'byProperty',coalesce((select jsonb_agg(jsonb_build_object('propertyId',x.property_id,'propertyName',p.name,'stays',x.n,'nights',x.nights,'averageNights',x.avg_nights,
    'guestsKnown',x.guests_known,'averageGuests',x.avg_guests,'leadKnown',x.lead_known,'averageLeadDays',x.avg_lead,
    'childrenKnown',x.children_known,'childrenStays',x.children_stays,'petsKnown',x.pets_known,'petsStays',x.pets_stays) order by x.n desc,p.name,x.property_id)
   from (select s.property_id,count(*)::int n,coalesce(sum(s.nights),0)::int nights,round(avg(s.nights),1) avg_nights,count(s.guests)::int guests_known,round(avg(s.guests),1) avg_guests,
     count(s.lead_days)::int lead_known,round(avg(s.lead_days),0) avg_lead,count(s.children)::int children_known,count(*) filter(where s.children>0)::int children_stays,
     count(s.pets)::int pets_known,count(*) filter(where s.pets>0)::int pets_stays
    from s group by s.property_id) x join public.workspace_properties p on p.id=x.property_id),'[]'))
 into result from s;
 return result;
end $fn$;

create or replace function public.workspace_stay_analytics(start_on date,end_on date,target_property uuid default null,target_channel text default null) returns jsonb
language sql security invoker set search_path='' as $$select private.workspace_stay_analytics(start_on,end_on,target_property,target_channel);$$;

revoke all on function private.workspace_stay_details(jsonb),private.workspace_store_stay_details(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.workspace_stay_analytics(date,date,uuid,text),public.workspace_stay_analytics(date,date,uuid,text) from public,anon;
grant execute on function private.workspace_stay_analytics(date,date,uuid,text),public.workspace_stay_analytics(date,date,uuid,text) to authenticated;
