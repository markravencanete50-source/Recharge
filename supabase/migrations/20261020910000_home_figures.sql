-- Two figures for management's Home (Lee, 14 October 2026). Nothing is deleted or dropped.
--
-- 1. Guest replies on time: private.workspace_guest_reply_glance(on_day) and its public wrapper, for admins and super
--    admins only (private.workspace_actor_role()). For this month so far and the same days of last month (to the same
--    day of the month, or last month's last day), across every guest channel: the replies counted, how many were
--    within the green target (private.workspace_performance_targets.green_minutes), that share in basis points and the
--    median minutes. Built on private.workspace_response_rows, as the Messages report and Team performance are, so the
--    three agree: a guest message still waiting past the amber limit counts as a late reply there, and here too.
--    on_day is London's date (today when null).
-- 2. Bookings value as booked: the Performance report (private.workspace_report_performance, finance roles and
--    admins) adds bookedValueMinor, the value of every stay with nights in the dates, settled or not, shared by
--    nights exactly as grossRevenueMinor is (private.workspace_prorate). A stay whose payout has settled counts its
--    settled gross, as grossRevenueMinor does; a platform stay not settled yet counts its expected payout plus the
--    fees the channel keeps from it as the Hostaway sync recorded them (commission, payment charges and VAT on the
--    commission, from payout_breakdown, 20261020900000), so settled and as-booked are counted the same way. Direct and
--    other stays count their amount as before; owner stays count nothing. So a closed, fully settled month has the
--    two figures equal, and the gap is the stays still to settle.
--    In the same read rather than a new one: the same stays, properties, filters and sharing by nights, so the figure
--    cannot drift from the Performance page, and Home already reads this report for this month and last.
--    Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present).
--
-- New: private.workspace_guest_reply_window(date,date), private.workspace_guest_reply_glance(date),
--   public.workspace_guest_reply_glance(date), private.workspace_performance_expected_gross(private.workspace_reservations).
-- Safe to run twice.

-- One window of guest replies, [start_on, end_before) in London days.
create or replace function private.workspace_guest_reply_window(start_on date,end_before date) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('from',start_on,'to',end_before-1,
  'replies',count(*)::int,'onTime',(count(*) filter(where r.grade='green'))::int,
  'onTimeBps',case when count(*)>0 then round((count(*) filter(where r.grade='green'))*10000.0/count(*))::int end,
  'medianMinutes',round((percentile_cont(0.5) within group(order by r.minutes))::numeric,1))
 from private.workspace_response_rows(start_on::timestamp at time zone 'Europe/London',end_before::timestamp at time zone 'Europe/London') r;
$$;

create or replace function private.workspace_guest_reply_glance(on_day date) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();today date:=coalesce(on_day,(now() at time zone 'Europe/London')::date);
 month_start date;last_start date;last_end date;green integer;amber integer;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 month_start:=date_trunc('month',today)::date;
 last_start:=(month_start-interval '1 month')::date;
 -- The same days of last month: up to the same day of the month, stopping at its last day (31 March: all of February).
 last_end:=least(last_start+(today-month_start)+1,month_start);
 select t.green_minutes,t.amber_minutes into green,amber from private.workspace_performance_targets t where t.singleton;
 return jsonb_build_object('greenMinutes',green,'amberMinutes',amber,
  'thisMonth',private.workspace_guest_reply_window(month_start,today+1),
  'lastMonth',private.workspace_guest_reply_window(last_start,last_end));
end $fn$;

create or replace function public.workspace_guest_reply_glance(on_day date default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_guest_reply_glance(on_day);$$;

-- What a stay is worth as booked, before its payout settles (see 2 above). Null for owner stays and while unknown.
create or replace function private.workspace_performance_expected_gross(target private.workspace_reservations) returns bigint
language sql stable set search_path='' as $$
 select case when private.workspace_is_owner_stay(target) then null
  when target.channel in ('airbnb','booking_com','vrbo') then target.payout_minor
   +coalesce((target.payout_breakdown->>'commissionMinor')::bigint,0)
   +coalesce((target.payout_breakdown->>'paymentChargeMinor')::bigint,0)
   +coalesce((target.payout_breakdown->>'commissionVatMinor')::bigint,0)
  else target.payout_minor end;
$$;

do $patch$
declare
 fixes constant text[][] := array[
  -- 1. Each stay also carries what it is worth as booked.
  ['private.workspace_report_performance(uuid,uuid,date,date,jsonb)',
   $a$else r.payout_minor end gross$a$,
   $r$else r.payout_minor end gross,private.workspace_performance_expected_gross(r) expected$r$,
   $s$private.workspace_performance_expected_gross(r) expected$s$],
  -- 2. Shared by nights like the settled amount: the settled gross where there is one, else the expected one.
  ['private.workspace_report_performance(uuid,uuid,date,date,jsonb)',
   $a$s.n) end share$a$,
   $r$s.n) end share,case when coalesce(s.gross,s.expected) is not null then private.workspace_prorate(coalesce(s.gross,s.expected),least(greatest(mo.m_from-s.check_in,0),s.n),least(greatest(mo.m_to-s.check_in,0),s.n),s.n) end booked_share$r$,
   $s$end booked_share$s$],
  -- 3. The report returns the total for the dates.
  ['private.workspace_report_performance(uuid,uuid,date,date,jsonb)',
   $a$'filters',jsonb_build_object('propertyId',f_prop,'region',f_region,'channel',f_channel),$a$,
   $r$'filters',jsonb_build_object('propertyId',f_prop,'region',f_region,'channel',f_channel),'bookedValueMinor',(select coalesce(sum(booked_share),0)::bigint from stay_months),$r$,
   $s$'bookedValueMinor',(select coalesce(sum(booked_share),0)::bigint from stay_months)$s$]
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

revoke all on function private.workspace_guest_reply_window(date,date),private.workspace_performance_expected_gross(private.workspace_reservations) from public,anon,authenticated;
revoke all on function private.workspace_guest_reply_glance(date),public.workspace_guest_reply_glance(date) from public,anon;
grant execute on function private.workspace_guest_reply_glance(date),public.workspace_guest_reply_glance(date) to authenticated;
