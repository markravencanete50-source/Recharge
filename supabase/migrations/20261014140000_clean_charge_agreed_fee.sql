-- The clean charge on owner statements is always the agreed fee (client answer 4, 13 October 2026; Lee's decision).
-- Alex: "the actual cost won't be displayed on the statement itself but used as an understanding of profitability."
--
-- 1. Statements: every changeover is charged the property's agreed cleaning value. The per-property clean_charge_mode
--    column stays (nothing that reads it breaks) but the statement no longer uses it, and neither does a clean-cost
--    review's decision. Patches on private.workspace_statement_compute: the mode is always 'agreed_fee' and the basis of
--    each clean is always 'agreed_fee'.
-- 2. The actual cost of a clean is the cleaner's invoice line only (private.workspace_clean_cost; it used to fall back to
--    the cleaner's rate). Alex: "There will always be an invoice."
-- 3. The clean-cost review (D6) still flags a clean whose invoice is above the agreed fee, for staff only
--    (clean_over_agreed and the cleansToReview list), but a statement no longer waits for it:
--    private.workspace_statement_waits_for_clean_review() is now false.
-- 4. The Performance report (staff only) adds profit per clean: for the cleans on issued or paid statements that have
--    an invoice, invoicedCleanCount, invoicedChargedMinor (what owners were charged for them), invoicedCostMinor (the
--    invoices), cleanProfitMinor (charged less invoices) and profitPerCleanMinor (that over the count, rounded half away
--    from zero; null with none). private.workspace_report_performance is replaced as a whole (only 20261012130000
--    defines it); the rest of the report is unchanged.
-- The same rules are in lib/statement-maths.ts (the statement) and lib/performance.ts (the report's shape).
--
-- Issued and paid statements are never recomputed (the stored-copy rule), so this only affects statements prepared or
-- issued from now on. The patches read the LATEST definition, need their anchor exactly once and are skipped once
-- applied, so the migration is safe to run twice.

create or replace function private.workspace_statement_waits_for_clean_review() returns boolean language sql immutable set search_path='' as $$ select false $$;

create or replace function private.workspace_clean_cost(work uuid) returns bigint language sql stable security definer set search_path='' as $$
 select l.amount_minor from private.workspace_cleaner_invoice_lines l where l.work_id=work and l.live;
$$;

do $patch$
declare
 fixes constant text[][]:=array[
  [$q$mode:=coalesce(f.clean_charge_mode,'agreed_fee');$q$,$q$mode:='agreed_fee';$q$],
  [$q$basis:=case when reviewed then st->>'decision' else mode end;$q$,$q$basis:='agreed_fee';$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure);
  if position(fixes[i][2] in definition)=0 then
   found_count:=(length(definition)-length(replace(definition,fixes[i][1],'')))/length(fixes[i][1]);
   if found_count<>1 then raise exception 'Patch anchor % found % times in private.workspace_statement_compute, expected once',i,found_count;end if;
   execute replace(definition,fixes[i][1],fixes[i][2]);
   if position(fixes[i][2] in pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure))=0 then raise exception 'Patch % did not take in private.workspace_statement_compute',i;end if;
  end if;
 end loop;
end $patch$;

-- Profit per clean for the Performance report.
create or replace function private.workspace_performance_clean_profit(invoiced numeric,charged numeric,cost numeric) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('invoicedCleanCount',coalesce(invoiced,0)::bigint,'invoicedChargedMinor',coalesce(charged,0)::bigint,'invoicedCostMinor',coalesce(cost,0)::bigint,
  'cleanProfitMinor',(coalesce(charged,0)-coalesce(cost,0))::bigint,
  'profitPerCleanMinor',private.workspace_performance_round(coalesce(charged,0)-coalesce(cost,0),coalesce(invoiced,0)));
$$;

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
  select s.property_id,s.period,x.work_id,x.charged,private.workspace_clean_cost(x.work_id) cost from stmts s
  cross join lateral (
   select (l->>'refId')::uuid work_id,(l->>'amountMinor')::bigint charged from jsonb_array_elements(case when jsonb_typeof(s.detail->'lines')='array' then s.detail->'lines' else '[]'::jsonb end) l
   where l->>'kind'='changeover' and coalesce(l->>'refId','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   union
   select w.id,null::bigint from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where jsonb_typeof(s.detail->'lines') is distinct from 'array' and w.property_id=s.property_id and d.kind='cleaning' and d.data->>'phase'='accepted'
    and w.status='completed' and w.due_on>=s.period_start and w.due_on<s.period_end
  ) x
 ), money as (
  select property_id,period,sum(fee_minor) fee,sum(vat_minor) vat,sum(cleaning_minor) charged,count(*) statements from stmts group by property_id,period
 ), costs as (
  select property_id,period,sum(coalesce(cost,0)) cost,count(*) filter(where cost is null) no_cost,count(*) clean_count,
   count(*) filter(where cost is not null and charged is not null) invoiced,sum(charged) filter(where cost is not null and charged is not null) invoiced_charged,
   sum(cost) filter(where cost is not null and charged is not null) invoiced_cost
  from stmt_cleans group by property_id,period
 ), nights as (
  select property_id,period,sum(nights_in) booked,sum(share) gross,
   sum(nights_in) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct')) sold,
   sum(share) filter(where share is not null and channel in ('airbnb','booking_com','vrbo','direct')) sold_gross
  from stay_months group by property_id,period
 ), cells as (
  select p.id property_id,p.name,p.region,mo.period,mo.m_from,mo.m_to,mo.m_to-mo.m_from available,
   m.fee,m.vat,m.charged,m.statements,c.cost,c.no_cost,c.clean_count,c.invoiced,c.invoiced_charged,c.invoiced_cost,n.booked,n.gross,n.sold,n.sold_gross
  from props p cross join months mo
  left join money m on m.property_id=p.id and m.period=mo.period
  left join costs c on c.property_id=p.id and c.period=mo.period
  left join nights n on n.property_id=p.id and n.period=mo.period
 )
 select jsonb_build_object('section','performance','from',from_on,'to',to_on,'days',days,
  'filters',jsonb_build_object('propertyId',f_prop,'region',f_region,'channel',f_channel),
  'totals',(select private.workspace_performance_figures(sum(fee),sum(vat),sum(charged),sum(cost),sum(clean_count),sum(no_cost),sum(statements),
    sum(gross),sum(booked),coalesce(sum(available),0),sum(sold),sum(sold_gross))
    ||private.workspace_performance_clean_profit(sum(invoiced),sum(invoiced_charged),sum(invoiced_cost)) from cells),
  'byProperty',coalesce((select jsonb_agg(x.j order by x.name,x.property_id) from (
    select property_id,name,jsonb_build_object('propertyId',property_id,'propertyName',name,'region',nullif(btrim(region),''))
     ||private.workspace_performance_figures(sum(fee),sum(vat),sum(charged),sum(cost),sum(clean_count),sum(no_cost),sum(statements),
      sum(gross),sum(booked),sum(available),sum(sold),sum(sold_gross))
     ||private.workspace_performance_clean_profit(sum(invoiced),sum(invoiced_charged),sum(invoiced_cost)) j
    from cells group by property_id,name,region) x),'[]'::jsonb),
  'byMonth',coalesce((select jsonb_agg(x.j order by x.period) from (
    select mo.period,jsonb_build_object('period',mo.period,'from',mo.m_from,'to',mo.m_to)
     ||private.workspace_performance_figures(sum(c.fee),sum(c.vat),sum(c.charged),sum(c.cost),sum(c.clean_count),sum(c.no_cost),sum(c.statements),
      sum(c.gross),sum(c.booked),coalesce(sum(c.available),0),sum(c.sold),sum(c.sold_gross))
     ||private.workspace_performance_clean_profit(sum(c.invoiced),sum(c.invoiced_charged),sum(c.invoiced_cost)) j
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

revoke all on function private.workspace_statement_waits_for_clean_review(),private.workspace_clean_cost(uuid),
 private.workspace_performance_clean_profit(numeric,numeric,numeric),private.workspace_report_performance(uuid,uuid,date,date,jsonb) from public,anon,authenticated;
