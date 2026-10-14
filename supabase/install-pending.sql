-- Payouts and Home figures: Hostaway fee breakdown, payouts overdue, guest replies on time, bookings as booked: the 2 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261020900000%' or version like '20261020910000%') then raise exception 'Payouts and Home figures: Hostaway fee breakdown, payouts overdue, guest replies on time, bookings as booked is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261020900000_hostaway_payout_fees =====
-- Payouts (Lee and Alex, decisions table: "Vrbo and Booking.com statements"):
--
-- 1. The expected payout from Hostaway's itemised finance lines. The sync (lib/hostaway-sync-policy.ts) now works the
--    expected payout out from the lines where Hostaway gives them: the channel's commission, a guest fee the channel
--    keeps, payment charges and VAT on the commission. It sends what it used as payoutBreakdown, which is kept on the
--    stay (private.workspace_reservations.payout_breakdown, pence) along with the cleaning fee and city tax. Airbnb
--    keeps Airbnb's own expected payout. With no lines the sum is exactly as before.
--    private.workspace_payout_breakdown(jsonb) keeps only the known keys and whole, non-negative pence.
--    Settled money is never recalculated: a sync leaves the expected payout (the amount and the breakdown) of a stay
--    alone once its payout is matched or agreed, or while an issued or paid owner statement covers it
--    (private.workspace_payout_stay_locked: a statement for the stay's property whose period overlaps its nights, the
--    rule statements already use to lock a stay). See private.workspace_payout_kept. Only stays still missing,
--    different or not yet reconciled get the new sum.
-- 2. A stay's payout row (private.workspace_payout_row) also returns expectedBreakdown, for the Approve the payout sheet.
--    Staff only, as before: owners never read payout rows.
-- 3. Management's Home: "Payouts to reconcile this month" counted every Airbnb, Booking.com and Vrbo stay checking in
--    this month without a settled payout, including stays not yet due to be paid. It now counts stays whose payout is
--    overdue and still missing or different: the expected payout date (private.workspace_payout_due_on) is before today
--    and on or after the first day of last month, so the first days of a month still show last month's backlog.
--    Expected payout dates: Airbnb 2 days after check-in (Airbnb pays about a day after check-in, plus a day for the
--    bank), Vrbo 2 days after check-in (the same), Booking.com 5 days after check-out (it pays after the stay).
--    The key stays payoutsToReconcile, so the app reads it unchanged; the app calls it "Payouts overdue to reconcile".
--
-- Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present):
--   private.workspace_hostaway_sync(jsonb), private.workspace_payout_row(private.workspace_reservations),
--   private.workspace_management_overview().
-- New: private.workspace_payout_breakdown(jsonb), private.workspace_payout_due_on(text,date,date),
--   private.workspace_payout_kept(private.workspace_reservations).
-- Safe to run twice.

alter table private.workspace_reservations add column if not exists payout_breakdown jsonb;
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_reservations'::regclass and conname='workspace_reservations_payout_breakdown_object') then
  alter table private.workspace_reservations add constraint workspace_reservations_payout_breakdown_object check(payout_breakdown is null or jsonb_typeof(payout_breakdown)='object');
 end if;
end $$;

-- The breakdown as the sync sent it, keeping only what is known: the source and whole pence from 0 to £1,000,000.
create or replace function private.workspace_payout_breakdown(input jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(input)='object' and input->>'source' in ('airbnb','itemised','totals') then
  jsonb_build_object('source',input->>'source')||coalesce((select jsonb_object_agg(k,(input->>k)::bigint)
   from unnest(array['grossMinor','commissionMinor','guestFeeMinor','paymentChargeMinor','commissionVatMinor','cleaningFeeMinor','cityTaxMinor']) k
   where jsonb_typeof(input->k)='number' and (input->>k)::numeric between 0 and 100000000 and (input->>k)::numeric=trunc((input->>k)::numeric)),'{}'::jsonb)
 end;
$$;

-- A stay whose expected payout the sync must leave alone: its payout is matched or agreed, or an issued or paid
-- owner statement covers it.
create or replace function private.workspace_payout_kept(target private.workspace_reservations) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if target.id is null then return false;end if;
 return private.workspace_payout_stay_locked(target) or coalesce(private.workspace_payout_row(target)->>'state','') in ('matched','agreed');
end $$;

-- When a platform's payout for a stay is expected (null for direct and other stays, which have no platform payout).
create or replace function private.workspace_payout_due_on(channel text, check_in date, check_out date) returns date language sql immutable set search_path='' as $$
 select case channel when 'airbnb' then check_in+2 when 'vrbo' then check_in+2 when 'booking_com' then check_out+5 end;
$$;

do $patch$
declare
 fixes constant text[][] := array[
  -- 1. The sync never changes the expected payout of a stay that is settled or on an issued statement.
  ['private.workspace_hostaway_sync(jsonb)',
   $a$found_prev:=found;$a$,
   $r$found_prev:=found;if found_prev and v_payout is distinct from prev.payout_minor and private.workspace_payout_kept(prev) then v_payout:=prev.payout_minor;end if;$r$,
   $s$private.workspace_payout_kept(prev) then v_payout:=prev.payout_minor$s$],
  -- 2. The sync keeps the breakdown it was sent, on the same terms (a breakdown alone never changes the stay's version).
  ['private.workspace_hostaway_sync(jsonb)',
   $a$touched:=touched||res.property_id;$a$,
   $r$if r ? 'payoutBreakdown' and res.payout_breakdown is distinct from private.workspace_payout_breakdown(r->'payoutBreakdown') and not (found_prev and private.workspace_payout_kept(prev)) then update private.workspace_reservations set payout_breakdown=private.workspace_payout_breakdown(r->'payoutBreakdown') where id=res.id;end if;touched:=touched||res.property_id;$r$,
   $s$set payout_breakdown=private.workspace_payout_breakdown(r->'payoutBreakdown')$s$],
  -- 3. The payout row shows it.
  ['private.workspace_payout_row(private.workspace_reservations)',
   $a$'repeatedAmount',repeated,'otaFeesMinor',fees,$a$,
   $r$'repeatedAmount',repeated,'otaFeesMinor',fees,'expectedBreakdown',target.payout_breakdown,$r$,
   $s$'expectedBreakdown',target.payout_breakdown$s$],
  -- 4. Home counts overdue payouts only (the line after the anchor, "and settledMinor is null", still applies).
  ['private.workspace_management_overview()',
   $a$'payoutsToReconcile',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com','vrbo') and r.check_in>=month_start and r.check_in<month_end$a$,
   $r$'payoutsToReconcile',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com','vrbo') and private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)<today and private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)>=(month_start-interval '1 month')::date and private.workspace_payout_row(r)->>'state' in ('missing','different')$r$,
   $s$private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)<today$s$]
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

revoke all on function private.workspace_payout_breakdown(jsonb),private.workspace_payout_due_on(text,date,date),private.workspace_payout_kept(private.workspace_reservations) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('20261020900000','hostaway_payout_fees');

-- ===== 20261020910000_home_figures =====
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261020910000','home_figures');

commit;
