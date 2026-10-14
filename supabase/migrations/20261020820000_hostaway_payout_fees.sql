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
