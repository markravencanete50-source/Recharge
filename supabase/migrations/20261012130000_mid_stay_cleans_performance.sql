-- Mid-stay cleans and the Performance report (WP-I).
--
-- 1. Mid-stay cleans. Client brief: "Any stay longer than 14 nights should have a mid-stay clean."
--    MID_STAY_NIGHTS is private.workspace_mid_stay_nights() (14). A confirmed stay of MORE than 14 nights whose
--    check-out is still ahead gets ONE clean on check-in plus half its nights, rounded down (15 nights: the 7th
--    day after check-in; 29 nights: the 14th). It is an ordinary clean on the cleaning schedule, made through the
--    same handover as the Hostaway checkout clean (so the property's usual cleaner gets it when one is set), with
--    data cleanType 'mid_stay', midStayOf = the stay and source 'mid_stay'. It never carries reservationId: the
--    sync finds a stay's checkout clean by reservationId, and would move a mid-stay clean holding one to the
--    check-out day or cancel it as if it were the checkout clean.
--    * Owner stays are cleaned like any other stay (the sync gives them a checkout clean), so a long owner stay
--      gets a mid-stay clean too. One switch: private.workspace_mid_stay_cleans_owner_stays().
--    * Cancelled and enquiry stays get none. A stay whose middle day has already passed gets none (the clean
--      would be overdue the moment it was made).
--    * Safe to run again: a stay with a mid-stay clean (open, done, or cancelled by hand) gets no other, and
--      nothing already made is ever moved to another day.
--    * When a stay is cancelled, shortened to 14 nights or fewer, moved to another property, or moved so the
--      clean's day is no longer inside it, its auto-made clean is cancelled if nobody has started it (waiting or
--      in progress, nothing submitted). A started, submitted or completed clean is left alone. A stay that moved
--      but still needs one gets a new clean on its new middle day.
--    * Charged to the owner like any changeover: owner statements count every accepted, completed clean in the
--      period at the property's agreed cleaning value (or its actual cost where the terms say so).
--    It runs every 15 minutes from the backend (public.workspace_mid_stay_cleans, service role only), so stays
--    entered in Recharge are covered while the Hostaway sync is paused, and at the end of every Hostaway sync, so
--    a stay changed in Hostaway updates its mid-stay clean in the same run.
--
-- 2. The Performance report (finance report section 'performance', finance roles and admins only; owners and
--    every other role are refused by public.workspace_finance_report and again here). For from_on (included) to
--    to_on (not included), at most 366 days, and filters {propertyId, region, channel}:
--    * management fee income: the management fee on ISSUED or PAID statements whose period STARTS inside the
--      window, each statement whole (no pro-rating; a statement belongs to the month it starts in). Draft and
--      void statements are left out. VAT on the fee is shown separately and is never counted as income.
--    * cleaning charged: the changeover lines on those statements (their cleaning total). Cleaning cost: the
--      actual cost of the same cleans (private.workspace_clean_cost: the cleaner's invoice line, else the
--      cleaner's rate); a clean with neither costs 0 and is counted in cleansWithoutCost. Margin = charged - cost.
--    * occupancy: nights booked / nights available. Nights booked: confirmed stays, each counted for its nights
--      inside the window (owner stays count as booked). Nights available: the window's nights for each property
--      in scope. A property is in scope when it is active, has a confirmed stay or a counted statement in the
--      window, or is the property asked for.
--    * gross revenue: confirmed stays that are not owner stays and whose amount is known (a platform stay once its
--      payout is settled: the settled amount plus its OTA fees; any other stay its payout), shared by nights
--      inside the window with the statements' floor rule (private.workspace_prorate), so the months add up to the
--      total exactly.
--    * average nightly rate: gross revenue of platform (Airbnb, Booking.com, Vrbo) and direct stays with a known
--      amount / their nights inside the window (nightsSold), rounded half away from zero; null with no nights.
--    * the channel filter applies to stays (occupancy, gross, rate) only; fees and cleaning come from statements.
--    Integer pence throughout, no floating point. Totals, byProperty, byMonth (each calendar month the window
--    touches) and byChannel.
--
-- Safe to run more than once.

-- 1. Mid-stay cleans ---------------------------------------------------------------------------------------------
-- Assumption (g): MID_STAY_NIGHTS. A stay of more than this many nights gets a mid-stay clean.
create or replace function private.workspace_mid_stay_nights() returns integer language sql immutable set search_path='' as $$ select 14 $$;
-- Owner stays get a mid-stay clean like any other stay (they are cleaned at check-out today). One switch.
create or replace function private.workspace_mid_stay_cleans_owner_stays() returns boolean language sql immutable set search_path='' as $$ select true $$;
-- The day of a stay's mid-stay clean: check-in plus half its nights, rounded down.
create or replace function private.workspace_mid_stay_day(check_in date,check_out date) returns date language sql immutable set search_path='' as $$
 select check_in+((check_out-check_in)/2);
$$;
-- Whether a stay needs a mid-stay clean, dates aside.
create or replace function private.workspace_mid_stay_wanted(r private.workspace_reservations) returns boolean language sql stable set search_path='' as $$
 select r.status='confirmed' and r.check_out-r.check_in>private.workspace_mid_stay_nights()
  and (private.workspace_mid_stay_cleans_owner_stays() or not private.workspace_is_owner_stay(r));
$$;

create or replace function private.workspace_mid_stay_cleans(at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 today date:=(coalesce($1,now()) at time zone 'Europe/London')::date;
 c record;r private.workspace_reservations;work uuid;clean_day date;created integer:=0;cancelled integer:=0;remaining integer:=0;left_alone integer:=0;
 checklist constant jsonb:='["Change the bed linen and the towels","Clean the kitchen and the bathrooms","Vacuum and mop every floor","Empty every bin","Restock guest essentials","Report anything damaged or not working"]';
begin
 -- One run at a time, so "no mid-stay clean yet" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_mid_stay_cleans',0));

 -- Open mid-stay cleans this function made whose stay no longer needs them on that day.
 for c in select w.id,w.status,d.data,
   case when s.id is null or s.status<>'confirmed' then 'The stay was cancelled'
    when s.check_out-s.check_in<=private.workspace_mid_stay_nights() then format('The stay is now %s nights or fewer',private.workspace_mid_stay_nights())
    else 'The stay changed, so this clean is no longer needed on this day' end reason
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  left join private.workspace_reservations s on s.id::text=d.data->>'midStayOf'
  where d.kind='cleaning' and d.data->>'cleanType'='mid_stay' and d.data->>'source'='mid_stay' and w.status not in ('completed','cancelled','declined')
   and (s.id is null or not private.workspace_mid_stay_wanted(s) or s.property_id<>w.property_id or w.due_on is null or w.due_on<=s.check_in or w.due_on>=s.check_out)
  order by w.due_on,w.id for update of w
 loop
  -- Only a clean nobody has started is cancelled; a started, submitted or completed one is left alone.
  if c.status in ('waiting','in_progress') and not (c.data ? 'submittedBy') then
   update private.workspace_domain_details set data=data||jsonb_build_object('workStatus','cancelled','cancelledBecause',c.reason,'midStayCancelled',true),updated_at=now() where work_id=c.id;
   update public.workspace_work_items set status='cancelled',version=version+1,updated_at=now() where id=c.id;
   cancelled:=cancelled+1;
  else
   left_alone:=left_alone+1;
  end if;
 end loop;

 -- Long stays still ahead with no mid-stay clean. One cancelled by this function (the stay changed) does not
 -- count; one cancelled by hand does, so it is never brought back.
 for r in select s.* from private.workspace_reservations s join public.workspace_properties p on p.id=s.property_id
  where private.workspace_mid_stay_wanted(s) and p.status<>'archived' and s.check_out>today
   and private.workspace_mid_stay_day(s.check_in,s.check_out)>=today
   and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and d.data->>'midStayOf'=s.id::text and (w.status<>'cancelled' or not coalesce((d.data->>'midStayCancelled')::boolean,false)))
  order by s.check_in,s.id
 loop
  if created>=200 then remaining:=remaining+1;continue;end if;
  clean_day:=private.workspace_mid_stay_day(r.check_in,r.check_out);
  work:=private.workspace_handover(r.property_id,'cleaning-schedule','Mid-stay clean','cleaning',
   jsonb_build_object('dueOn',clean_day,'checklist',coalesce(private.clean_template_labels(r.property_id),checklist),'phase','assigned','workStatus','waiting',
    'cleanType','mid_stay','midStayOf',r.id,'source','mid_stay'));
  update public.workspace_work_items set due_on=clean_day where id=work;
  created:=created+1;
 end loop;
 return jsonb_build_object('created',created,'cancelled',cancelled,'leftAlone',left_alone,'remaining',remaining);
end $$;

-- The backend's 15-minute run (service role only).
create or replace function public.workspace_mid_stay_cleans() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_mid_stay_cleans(now());$$;

revoke all on function private.workspace_mid_stay_nights(),private.workspace_mid_stay_cleans_owner_stays(),private.workspace_mid_stay_day(date,date),
 private.workspace_mid_stay_wanted(private.workspace_reservations),private.workspace_mid_stay_cleans(timestamptz) from public,anon,authenticated;
revoke all on function public.workspace_mid_stay_cleans() from public,anon,authenticated;
grant execute on function private.workspace_mid_stay_cleans(timestamptz),public.workspace_mid_stay_cleans() to service_role;

-- 2. The Performance report -------------------------------------------------------------------------------------
-- numerator / denominator, halves rounded away from zero, exact; null when the denominator is not positive.
create or replace function private.workspace_performance_round(numerator numeric,denominator numeric) returns bigint language sql immutable set search_path='' as $$
 select case when numerator is null or denominator is null or denominator<=0 then null
  else (sign(numerator)*div(abs(numerator)*2+denominator,denominator*2))::bigint end;
$$;

-- One set of figures (totals, a property or a month), from its sums.
create or replace function private.workspace_performance_figures(fee numeric,vat numeric,charged numeric,cost numeric,clean_count numeric,no_cost numeric,statements numeric,
 gross numeric,booked numeric,available numeric,sold numeric,sold_gross numeric) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('managementFeeMinor',coalesce(fee,0)::bigint,'vatMinor',coalesce(vat,0)::bigint,
  'cleaningChargedMinor',coalesce(charged,0)::bigint,'cleaningCostMinor',coalesce(cost,0)::bigint,'cleaningMarginMinor',(coalesce(charged,0)-coalesce(cost,0))::bigint,
  'cleanCount',coalesce(clean_count,0)::bigint,'cleansWithoutCost',coalesce(no_cost,0)::bigint,'statementCount',coalesce(statements,0)::bigint,
  'grossRevenueMinor',coalesce(gross,0)::bigint,'nightsBooked',coalesce(booked,0)::bigint,'nightsAvailable',coalesce(available,0)::bigint,
  'occupancyBps',private.workspace_performance_round(coalesce(booked,0)*10000,coalesce(available,0)),
  'nightsSold',coalesce(sold,0)::bigint,'averageNightlyRateMinor',private.workspace_performance_round(coalesce(sold_gross,0),coalesce(sold,0)));
$$;

-- 'performance' (through public.workspace_finance_report). See the definitions at the top of this file.
create or replace function private.workspace_report_performance(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f_prop uuid:=target_property;f_region text;f_channel text;days integer;result jsonb;
begin
 if not private.workspace_finance_role() or not private.has_workspace_module('owner-statements') then raise exception 'Accounts access required' using errcode='42501';end if;
 if target_id is not null then raise exception 'Invalid report filters' using errcode='22023';end if;
 if from_on is null or to_on is null or to_on<=from_on then raise exception 'Choose the dates: the end must be after the start' using errcode='22023';end if;
 if to_on-from_on>366 then raise exception 'Choose a period of up to a year' using errcode='22023';end if;
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('propertyId','region','channel')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  if coalesce(jsonb_typeof(filters->'propertyId'),'null')<>'null' then
   if jsonb_typeof(filters->'propertyId')<>'string' or filters->>'propertyId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid report filters' using errcode='22023';end if;
   if f_prop is not null and f_prop<>(filters->>'propertyId')::uuid then raise exception 'Invalid report filters' using errcode='22023';end if;
   f_prop:=(filters->>'propertyId')::uuid;
  end if;
  if coalesce(jsonb_typeof(filters->'region'),'null')<>'null' then
   if jsonb_typeof(filters->'region')<>'string' or length(btrim(filters->>'region')) not between 1 and 200 then raise exception 'Invalid report filters' using errcode='22023';end if;
   f_region:=btrim(filters->>'region');
  end if;
  if coalesce(jsonb_typeof(filters->'channel'),'null')<>'null' then
   if jsonb_typeof(filters->'channel')<>'string' or filters->>'channel' not in ('airbnb','booking_com','vrbo','direct','other') then raise exception 'Invalid report filters' using errcode='22023';end if;
   f_channel:=filters->>'channel';
  end if;
 elsif filters is not null and jsonb_typeof(filters)<>'null' then raise exception 'Invalid report filters' using errcode='22023';
 end if;
 if f_prop is not null and not private.workspace_can_property(f_prop,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
 days:=to_on-from_on;

 with props as (
  select p.id,p.name,p.region from public.workspace_properties p
  where (f_prop is null or p.id=f_prop) and (f_region is null or lower(btrim(p.region))=lower(f_region))
   and private.workspace_can_property(p.id,'owner-statements')
   and (f_prop is not null or p.status='active'
    or exists(select 1 from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.check_in<to_on and r.check_out>from_on)
    or exists(select 1 from private.workspace_owner_statements s where s.property_id=p.id and s.status in ('issued','paid') and s.period_start>=from_on and s.period_start<to_on))
 ), months as (
  select to_char(m,'YYYY-MM') period,greatest(m::date,from_on) m_from,least((m+interval '1 month')::date,to_on) m_to
  from generate_series(date_trunc('month',from_on::timestamp),(to_on-1)::timestamp,interval '1 month') m
 ), stays as (
  -- gross: null for owner stays and while a stay's amount is unknown (a platform stay not settled yet).
  select r.id,r.property_id,r.channel,r.check_in,r.check_out,r.check_out-r.check_in n,
   case when private.workspace_is_owner_stay(r) then null
    when r.channel in ('airbnb','booking_com','vrbo') then (private.workspace_payout_row(r)->>'grossMinor')::bigint
    else r.payout_minor end gross
  from private.workspace_reservations r join props p on p.id=r.property_id
  where r.status='confirmed' and r.check_out>r.check_in and r.check_in<to_on and r.check_out>from_on and (f_channel is null or r.channel=f_channel)
 ), stay_months as (
  -- Each stay's nights and money inside each month of the window: share(x) = floor(x*through/n) - floor(x*before/n).
  select s.property_id,s.channel,mo.period,least(s.check_out,mo.m_to)-greatest(s.check_in,mo.m_from) nights_in,
   case when s.gross is not null then private.workspace_prorate(s.gross,least(greatest(mo.m_from-s.check_in,0),s.n),least(greatest(mo.m_to-s.check_in,0),s.n),s.n) end share
  from stays s join months mo on s.check_in<mo.m_to and s.check_out>mo.m_from
 ), stmts as (
  select s.id,s.property_id,to_char(s.period_start,'YYYY-MM') period,s.period_start,s.period_end,s.fee_minor,s.vat_minor,s.cleaning_minor,s.detail
  from private.workspace_owner_statements s join props p on p.id=s.property_id
  where s.status in ('issued','paid') and s.period_start>=from_on and s.period_start<to_on
 ), stmt_cleans as (
  -- The cleans each statement charged: its changeover lines, or (a statement from before itemised lines) the
  -- billable cleans in its period, as it counted them.
  select s.property_id,s.period,x.work_id,private.workspace_clean_cost(x.work_id) cost from stmts s
  cross join lateral (
   select (l->>'refId')::uuid work_id from jsonb_array_elements(case when jsonb_typeof(s.detail->'lines')='array' then s.detail->'lines' else '[]'::jsonb end) l
   where l->>'kind'='changeover' and coalesce(l->>'refId','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   union
   select w.id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where jsonb_typeof(s.detail->'lines') is distinct from 'array' and w.property_id=s.property_id and d.kind='cleaning' and d.data->>'phase'='accepted'
    and w.status='completed' and w.due_on>=s.period_start and w.due_on<s.period_end
  ) x
 ), money as (
  select property_id,period,sum(fee_minor) fee,sum(vat_minor) vat,sum(cleaning_minor) charged,count(*) statements from stmts group by property_id,period
 ), costs as (
  select property_id,period,sum(coalesce(cost,0)) cost,count(*) filter(where cost is null) no_cost,count(*) clean_count from stmt_cleans group by property_id,period
 ), nights as (
  select property_id,period,sum(nights_in) booked,sum(share) gross,
   sum(nights_in) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct')) sold,
   sum(share) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct')) sold_gross
  from stay_months group by property_id,period
 ), cells as (
  select p.id property_id,p.name,p.region,mo.period,mo.m_from,mo.m_to,mo.m_to-mo.m_from available,
   m.fee,m.vat,m.charged,m.statements,c.cost,c.no_cost,c.clean_count,n.booked,n.gross,n.sold,n.sold_gross
  from props p cross join months mo
  left join money m on m.property_id=p.id and m.period=mo.period
  left join costs c on c.property_id=p.id and c.period=mo.period
  left join nights n on n.property_id=p.id and n.period=mo.period
 )
 select jsonb_build_object('section','performance','from',from_on,'to',to_on,'days',days,
  'filters',jsonb_build_object('propertyId',f_prop,'region',f_region,'channel',f_channel),
  'totals',(select private.workspace_performance_figures(sum(fee),sum(vat),sum(charged),sum(cost),sum(clean_count),sum(no_cost),sum(statements),
    sum(gross),sum(booked),coalesce(sum(available),0),sum(sold),sum(sold_gross)) from cells),
  'byProperty',coalesce((select jsonb_agg(x.j order by x.name,x.property_id) from (
    select property_id,name,jsonb_build_object('propertyId',property_id,'propertyName',name,'region',nullif(btrim(region),''))
     ||private.workspace_performance_figures(sum(fee),sum(vat),sum(charged),sum(cost),sum(clean_count),sum(no_cost),sum(statements),
      sum(gross),sum(booked),sum(available),sum(sold),sum(sold_gross)) j
    from cells group by property_id,name,region) x),'[]'::jsonb),
  'byMonth',coalesce((select jsonb_agg(x.j order by x.period) from (
    select mo.period,jsonb_build_object('period',mo.period,'from',mo.m_from,'to',mo.m_to)
     ||private.workspace_performance_figures(sum(c.fee),sum(c.vat),sum(c.charged),sum(c.cost),sum(c.clean_count),sum(c.no_cost),sum(c.statements),
      sum(c.gross),sum(c.booked),coalesce(sum(c.available),0),sum(c.sold),sum(c.sold_gross)) j
    from months mo left join cells c on c.period=mo.period group by mo.period,mo.m_from,mo.m_to) x),'[]'::jsonb),
  'byChannel',coalesce((select jsonb_agg(jsonb_build_object('channel',channel,'nightsBooked',booked,
     'occupancyBps',private.workspace_performance_round(booked*10000,(select count(*) from props)*days),
     'grossRevenueMinor',coalesce(gross,0),'nightsSold',coalesce(sold,0),'averageNightlyRateMinor',private.workspace_performance_round(coalesce(sold_gross,0),coalesce(sold,0)))
    order by array_position(array['airbnb','booking_com','vrbo','direct','other'],channel),channel)
   from (select channel,sum(nights_in)::bigint booked,sum(share)::bigint gross,
     sum(nights_in) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct'))::bigint sold,
     sum(share) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct')) sold_gross
    from stay_months group by channel) ch),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function private.workspace_performance_round(numeric,numeric),
 private.workspace_performance_figures(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric),
 private.workspace_report_performance(uuid,uuid,date,date,jsonb) from public,anon,authenticated;

-- 3. The Hostaway sync makes and cancels mid-stay cleans at the end of every run. The anchor must occur exactly
-- once; the marker says the patch is already in place. A missing or repeated anchor stops the migration.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_hostaway_sync(jsonb)',
   $q$ update private.workspace_hostaway_sync_state$q$ || $q$ set last_run_at=now(),last_success_at=now(),$q$,
   $q$ -- Mid-stay cleans (20261012130000): long stays get theirs, and a stay that no longer needs one loses it.
 summary:=summary||(select jsonb_build_object('newMidStayCleans',coalesce((x.m->>'created')::integer,0),'cancelledMidStayCleans',coalesce((x.m->>'cancelled')::integer,0))
  from (select private.workspace_mid_stay_cleans(now()) m) x);
 update private.workspace_hostaway_sync_state$q$ || $q$ set last_run_at=now(),last_success_at=now(),$q$,
   $q$private.workspace_mid_stay_cleans(now())$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
