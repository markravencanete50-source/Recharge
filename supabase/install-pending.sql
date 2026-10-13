-- Round 4 (14 October 2026): the twelve migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version, as in round 3. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261014%') then raise exception 'Round 4 is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261014100000_clean_form_reminders =====
-- Clean form reminders (client answer 8, 13 October 2026). Alex: "if not done by 6pm, prompt the cleaner with reminder
-- notifications and change the status of their clean to unsubmitted. No clean invoice will be settled without a clean
-- form. If it has been marked unsuccessful or is still not filled out the next day, auto flag this ticket to the
-- management approval section."
--
-- 1. The sweep (private.workspace_clean_form_sweep, replaced as a whole; it is only defined in 20261012170000) now
--    works in two steps instead of flagging management at 18:00 on the day:
--      a. Reminder: an assigned, open clean with no form after 18:00 London on its day (or any time later, until step b
--         is due) is marked unsubmitted (data.unsubmittedAt), logged as cleaning.form_reminder (no actor) and the
--         assigned cleaner is notified. Management is not told yet.
--      b. Management: from 09:00 London the day after the clean (private.workspace_clean_form_escalate_time), a clean
--         still without a form is tagged as before (data.warning = 'no_form', data.formWarningAt), logged as
--         cleaning.form_missing and flagged for management unless it already has an open flag. Admins and the
--         assigned cleaner are notified. A clean that was never reminded (the sweep was down) gets unsubmittedAt too.
--    Each step runs at most once per clean, at most private.workspace_clean_form_sweep_limit() cleans per step per
--    run, oldest day first, inside the existing 14-day look-back. It answers { reminded, warned, skipped }.
--    Nothing here changes pay or blocks the clean: the cleaner can still send the form late.
-- 2. private.workspace_clean_form_in(data) is the one rule for "the form is in": the clean moved to review or was
--    accepted, or it carries the cleaner's submission (a clean sent back after a review keeps it).
-- 3. Accounts payable: a cleaner invoice cannot be approved while any clean on it has no form (patch on
--    private.workspace_decide_cleaner_invoice), and each invoice line now says whether its clean's form is in
--    (formIn, patch on private.workspace_cleaner_invoice_view). Recording and rejecting an invoice are unchanged.
-- 4. Owners never read cleaning.form_reminder through the activity table, like cleaning.form_missing (the
--    activity_scoped policy from 20261013090000, dropped and created again with one more event name).
--
-- The patches read the LATEST definition, need their anchor exactly once, and are skipped once their sentinel is
-- present, so the migration is safe to run twice. Depends on 20261012090000, 20261012140000, 20261012170000 and
-- 20261013090000.

create or replace function private.workspace_clean_form_escalate_time() returns text language sql immutable set search_path='' as $fn$select '09:00'::text$fn$;

-- Whether management should hear about a clean on this day at this moment: from the escalation time on the next day.
create or replace function private.workspace_clean_form_escalate_due(clean_day date,at timestamptz) returns boolean language sql stable set search_path='' as $fn$
 select clean_day is not null and at is not null
  and (at at time zone private.workspace_clean_form_zone())>=((clean_day+1)::timestamp+private.workspace_clean_form_escalate_time()::time);
$fn$;

-- The form is in: the clean moved to review or was accepted, or the cleaner's submission is on it.
create or replace function private.workspace_clean_form_in(item jsonb) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(item->>'phase','assigned') in ('review','accepted') or coalesce(item ? 'submittedBy',false);
$fn$;

create or replace function private.workspace_clean_form_sweep(at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 stamp timestamptz:=coalesce(at,now());
 stamp_text text:=to_char(coalesce(at,now()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 local_day date:=(coalesce(at,now()) at time zone private.workspace_clean_form_zone())::date;
 c record;event_id bigint;flag_id uuid;reminded integer:=0;warned integer:=0;skipped integer:=0;admins uuid[];place text;
begin
 -- One run at a time, so "not already reminded" and "not already warned" are exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_clean_form_sweep',0));
 admins:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');

 -- a. Reminder to the cleaner: past 18:00 on the day, not yet the next morning.
 for c in select w.id work_id,w.property_id,w.assignee_id
  from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id
  join public.workspace_properties p on p.id=w.property_id
  where d.kind='cleaning' and w.assignee_id is not null and w.status in ('waiting','in_progress') and p.status<>'archived'
   and not private.workspace_clean_form_in(d.data)
   and not (d.data ? 'unsubmittedAt') and not (d.data ? 'formWarningAt') and coalesce(d.data->>'warning','')<>'no_form'
   and private.workspace_clean_form_day(w.due_on,d.data)>=local_day-private.workspace_clean_form_lookback_days()
   and private.workspace_clean_form_is_due(private.workspace_clean_form_day(w.due_on,d.data),stamp)
   and not private.workspace_clean_form_escalate_due(private.workspace_clean_form_day(w.due_on,d.data),stamp)
  order by private.workspace_clean_form_day(w.due_on,d.data),w.id
  limit private.workspace_clean_form_sweep_limit()
  for update of w,d skip locked
 loop
  update private.workspace_domain_details set data=data||jsonb_build_object('unsubmittedAt',stamp_text),updated_at=now() where work_id=c.work_id;
  update public.workspace_work_items set version=version+1,updated_at=now() where id=c.work_id;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(null,c.property_id,c.work_id,'cleaning.form_reminder') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(c.assignee_id,c.work_id,event_id) on conflict do nothing;
  reminded:=reminded+1;
 end loop;

 -- b. Management: from the escalation time on the next day, the clean is warned and flagged.
 for c in select w.id work_id,w.property_id,w.assignee_id,p.name property_name,p.address property_address,private.workspace_clean_form_day(w.due_on,d.data) clean_day
  from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id
  join public.workspace_properties p on p.id=w.property_id
  where d.kind='cleaning' and w.assignee_id is not null and w.status in ('waiting','in_progress') and p.status<>'archived'
   and not private.workspace_clean_form_in(d.data)
   and not (d.data ? 'formWarningAt') and coalesce(d.data->>'warning','')<>'no_form'
   and private.workspace_clean_form_day(w.due_on,d.data)>=local_day-private.workspace_clean_form_lookback_days()
   and private.workspace_clean_form_escalate_due(private.workspace_clean_form_day(w.due_on,d.data),stamp)
  order by private.workspace_clean_form_day(w.due_on,d.data),w.id
  limit private.workspace_clean_form_sweep_limit()
  for update of w,d skip locked
 loop
  update private.workspace_domain_details
   set data=jsonb_build_object('unsubmittedAt',stamp_text)||data||jsonb_build_object('warning','no_form','formWarningAt',stamp_text),updated_at=now()
   where work_id=c.work_id;
  update public.workspace_work_items set version=version+1,updated_at=now() where id=c.work_id;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(null,c.property_id,c.work_id,'cleaning.form_missing') returning id into event_id;
  warned:=warned+1;
  -- The cleaner hears about it whether or not management already holds a flag.
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(c.assignee_id,c.work_id,event_id) on conflict do nothing;
  -- One open flag per piece of work: a person may have flagged this clean already.
  if private.workspace_flag_open_for_work(c.work_id) then skipped:=skipped+1;continue;end if;
  place:=coalesce(nullif(trim(c.property_name),''),'the property')||case when nullif(trim(c.property_address),'') is not null then ' ('||trim(c.property_address)||')' else '' end;
  flag_id:=null;
  insert into private.workspace_management_flags(source,work_id,property_id,title,reason,raised_by)
   values('clean_form',c.work_id,c.property_id,'Cleaning form missing',
    left(format('No cleaning form was submitted for the clean at %s on %s, and the cleaner was reminded at 18:00 that day. The cleaner can still send it late. Their invoice for this clean cannot be approved until it is in.',place,to_char(c.clean_day,'FMDD FMMonth YYYY')),2000),null)
   on conflict do nothing returning id into flag_id;
  if flag_id is null then skipped:=skipped+1;continue;end if;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id)
   select a,c.work_id,event_id from unnest(admins) a on conflict do nothing;
 end loop;
 return jsonb_build_object('reminded',reminded,'warned',warned,'skipped',skipped);
end $fn$;

-- 3. Accounts payable patches.
do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$if input ? 'version' and inv.version is distinct from (input->>'version')::integer then raise exception 'Invoice changed' using errcode='40001';end if;$q$;
 gate constant text:=$q$ if target='approved' and exists(select 1 from private.workspace_cleaner_invoice_lines l join private.workspace_domain_details d on d.work_id=l.work_id where l.invoice_id=inv.id and l.live and d.kind='cleaning' and not private.workspace_clean_form_in(d.data)) then raise exception 'Every clean on this invoice needs its clean form before the invoice can be approved' using errcode='22023';end if;$q$;
 sentinel constant text:=$q$not private.workspace_clean_form_in(d.data)) then raise exception 'Every clean on this invoice$q$;
begin
 definition:=pg_get_functiondef('private.workspace_decide_cleaner_invoice(jsonb)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_decide_cleaner_invoice(jsonb), expected once',found_count;end if;
  execute replace(definition,anchor,anchor||gate);
  if position(sentinel in pg_get_functiondef('private.workspace_decide_cleaner_invoice(jsonb)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_decide_cleaner_invoice(jsonb)';end if;
 end if;
end $patch$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$'amountMinor',l.amount_minor,'live',l.live,$q$;
 replacement constant text:=$q$'amountMinor',l.amount_minor,'live',l.live,'formIn',(select private.workspace_clean_form_in(fd.data) from private.workspace_domain_details fd where fd.work_id=l.work_id),$q$;
 sentinel constant text:=$q$'formIn',(select private.workspace_clean_form_in(fd.data)$q$;
begin
 definition:=pg_get_functiondef('private.workspace_cleaner_invoice_view(private.workspace_cleaner_invoices)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_cleaner_invoice_view, expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_cleaner_invoice_view(private.workspace_cleaner_invoices)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_cleaner_invoice_view';end if;
 end if;
end $patch$;

-- 4. Owners: the reminder is an internal event, hidden like the missing-form one.
drop policy if exists activity_scoped on public.workspace_activity;
create policy activity_scoped on public.workspace_activity for select to authenticated using (
  (select private.workspace_actor_role()) in ('admin','super_admin') or (
    (select private.workspace_actor_role()) is not null and (
      actor_id=(select auth.uid()) or (work_id is not null and private.workspace_can_work(work_id) and (
        (select private.workspace_actor_role())<>'client'
        or event_type !~ $re$^(management\.|aircover\.|reflection\.|routine\.|stays\.|cleaning\.form_(missing|reminder)$|operations\.updateOperation\.resolveRepair$)$re$
      ))
    )
  )
);

revoke all on function private.workspace_clean_form_escalate_time(),private.workspace_clean_form_escalate_due(date,timestamptz),private.workspace_clean_form_in(jsonb),
 private.workspace_clean_form_sweep(timestamptz) from public,anon,authenticated;
grant execute on function private.workspace_clean_form_sweep(timestamptz) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values('20261014100000','clean_form_reminders');

-- ===== 20261014110000_mid_stay_switch =====
-- Mid-stay cleans get one on/off switch, OFF (client answer 5, 13 October 2026: "Forget this for now"; Lee's decision).
--
-- private.workspace_mid_stay_cleans_enabled() is the switch, mirrored by MID_STAY_CLEANS_ENABLED in
-- lib/feedback-defaults.ts. While it is OFF, private.workspace_mid_stay_cleans does nothing at all: it creates no new
-- mid-stay clean, by the 15-minute run in worker/index.ts or at the end of a Hostaway sync, and it leaves every
-- mid-stay clean that already exists exactly as it is (none is cancelled, moved or changed). Its answer keeps the same
-- keys, all zero, plus switchedOff true. Turning it back ON is a one-line migration (`select true`): the run then
-- behaves as before, including cancelling an unstarted automatic clean whose stay no longer needs it.
--
-- The worker keeps calling the run: the switch lives in the database so the cron and the Hostaway sync obey it alike.
--
-- The patch reads the LATEST definition of private.workspace_mid_stay_cleans, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select false $$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$perform pg_advisory_xact_lock(hashtextextended('workspace_mid_stay_cleans',0));$q$;
 replacement constant text:=$q$perform pg_advisory_xact_lock(hashtextextended('workspace_mid_stay_cleans',0)); if not private.workspace_mid_stay_cleans_enabled() then return jsonb_build_object('created',0,'cancelled',0,'leftAlone',0,'remaining',0,'switchedOff',true);end if;$q$;
 sentinel constant text:=$q$if not private.workspace_mid_stay_cleans_enabled() then return$q$;
begin
 definition:=pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_mid_stay_cleans(timestamptz), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_mid_stay_cleans(timestamptz)';end if;
 end if;
end $patch$;

revoke all on function private.workspace_mid_stay_cleans_enabled() from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014110000','mid_stay_switch');

-- ===== 20261014120000_fee_base_after_changeovers =====
-- The management fee is charged on the payout after platform fees AND the period's changeover charges (client answer
-- 1, 13 October 2026: "Management fee is charged after Airbnb fees and the cleaning fees"; Lee's decision: this is
-- the one base, no switch and no second option).
--
-- * private.workspace_statement_compute: base = gross less OTA fees less the statement's changeover charges. VAT stays
--   20% of the rounded fee. The base is plain subtraction, so a period with changeovers and little revenue can have a
--   negative fee, as gross less OTA fees could before.
-- * private.workspace_statement_fee_base() is no longer a switch: it only names the base, and statements carry that
--   name in terms.feeBase ('payout_after_ota_fees_and_changeovers') so the screen can say what the fee was charged on.
-- * Issued and paid statements are never recomputed (the stored-copy rule), so this only affects statements prepared
--   or issued from now on. An issued statement keeps the feeBase it was issued with.
-- The same rule is in lib/statement-maths.ts (feeBaseMinor), kept in step by the 200-scenario test.
--
-- The patch reads the LATEST definition of private.workspace_statement_compute, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

create or replace function private.workspace_statement_fee_base() returns text language sql immutable set search_path='' as $$ select 'payout_after_ota_fees_and_changeovers'::text $$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$base:=case private.workspace_statement_fee_base() when 'gross' then gross_total else gross_total-ota_total end;$q$;
 replacement constant text:=$q$base:=gross_total-ota_total-clean_total;$q$;
begin
 definition:=pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure);
 if position(replacement in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_statement_compute, expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(replacement in pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_statement_compute';end if;
 end if;
end $patch$;

insert into supabase_migrations.schema_migrations(version,name) values('20261014120000','fee_base_after_changeovers');

-- ===== 20261014130000_owner_history_internal_events =====
-- Owner privacy, the remaining place: a work item's history (private.workspace_work_history) reads the activity table
-- with the function's own rights, so 20261013090000's activity_scoped policy did not reach it. An owner reading the
-- timeline of their own work still received internal events by name: a management flag, an AirCover flag, a
-- reflection, a routine visit form, a direct-booking follow-up and the clean form reminder and warning.
--
-- For the client role the history now leaves those entries out. Everything else is unchanged:
--   * a repair resolved without a visit stays on the owner's timeline (Lee's decision: owners read how a repair was
--     resolved; who resolved it is already stripped by 20261013090000);
--   * staff and admins see every entry as before.
-- The internal event names are the same list the activity_scoped policy hides from owners, less the repair one.
--
-- The patch reads the LATEST definition, needs its anchor exactly once and is skipped once its sentinel is present,
-- so the migration is safe to run twice.

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning')$q$;
 replacement constant text:=$q$where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning') and (actor<>'client' or a.event_type !~ '^(management\.|aircover\.|reflection\.|routine\.|stays\.|cleaning\.form_(missing|reminder)$)')$q$;
 sentinel constant text:=$q$and (actor<>'client' or a.event_type !~ '^(management\.|aircover\.$q$;
begin
 definition:=pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_work_history(uuid), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_work_history(uuid)';end if;
 end if;
end $patch$;

insert into supabase_migrations.schema_migrations(version,name) values('20261014130000','owner_history_internal_events');

-- ===== 20261014140000_clean_charge_agreed_fee =====
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

insert into supabase_migrations.schema_migrations(version,name) values('20261014140000','clean_charge_agreed_fee');

-- ===== 20261014150000_visitor_levy =====
-- Visitor levy on owner statements (Alex, 13 October 2026: "a toggle for visitor levy too at 5%... only accounted for
-- in certain council areas, so it will be a property specific thing"). Councils differ: Edinburgh charges 5% on the
-- first 5 consecutive nights of stays from 24 July 2026, and other councils plan other rates and dates, so nothing
-- about a council is fixed here. Every value is a per-property setting.
--
-- 1. Per-property settings on private.workspace_property_financials:
--      levy_enabled    on or off (default off)
--      levy_rate_bps   the rate in basis points (default 500, 5%)
--      levy_night_cap  the most nights of one stay that are levied (null: every night)
--      levy_from       only stays checking in on or after this day are levied (null: every stay)
--    Set with setStatementTerms {visitorLevy: {enabled, rateBps?, nightCap?, from?}} (admins, as the other terms).
-- 2. The levy of a stay, worked out once, when a statement first counts it:
--      accommodation = the stay's gross less the guest's cleaning fee (the cleaning fee lines on its payout report;
--                      a platform stay whose report has none is levied on its gross and flagged
--                      levy_cleaning_fee_unknown, for staff)
--      levied nights = the stay's nights, at most the night cap
--      levy          = accommodation x levied nights / nights x rate, rounded to whole pence half away from zero
--                      (the management fee's rule)
--    Owner stays are never levied. The levy is shared across statement periods by its levied nights (the first
--    nights of the stay) with the statements' floor rule (private.workspace_prorate), so the parts add up exactly;
--    a statement by check-in takes it whole.
-- 3. The statement gets one "Visitor levy" line per levied stay, straight after the OTA fees: OTA fees, visitor levy,
--    changeovers, management fee, VAT, other payables. The payout is gross less all of them.
-- 4. Whether the management fee is charged after the levy is ONE switch, private.workspace_statement_fee_after_levy(),
--    default true: fee base = gross less OTA fees less the levy less changeovers. A question for Alex.
-- 5. The stored-copy rule: an issued or paid statement stores each stay's levy and levied nights with its other money
--    (stayLevyMinor, stayLevyNights), and later statements take their share from that copy, never from the settings as
--    they are now. A stay first issued before this migration has no stored levy and is never levied afterwards.
--    Issuing still recomputes and refuses if anything changed, the levy lines and stored levy included.
-- 6. Owners see the levy line on their statement (detail.lines) and the total (detail.visitorLevyMinor).
-- The same rules are in lib/statement-maths.ts, kept in step by the 200-scenario test.
--
-- The patches read the LATEST definitions, need each anchor exactly once and are skipped once their sentinel is
-- present, so the migration is safe to run twice.

alter table private.workspace_property_financials
 add column if not exists levy_enabled boolean not null default false,
 add column if not exists levy_rate_bps integer not null default 500 check(levy_rate_bps between 0 and 10000),
 add column if not exists levy_night_cap integer check(levy_night_cap between 1 and 366),
 add column if not exists levy_from date;

-- FEE_AFTER_LEVY: the management fee is charged on the payout after the levy. One switch.
create or replace function private.workspace_statement_fee_after_levy() returns boolean language sql immutable set search_path='' as $$ select true $$;

-- The levy on an amount for some of its nights: amount x levied / nights x bps / 10000, half pence away from zero.
create or replace function private.workspace_levy_minor(amount bigint,levied integer,nights integer,bps integer) returns bigint language sql immutable set search_path='' as $$
 select case when amount is null or levied is null or nights is null or bps is null or nights<=0 or levied<=0 or bps<=0 then 0::bigint
  else (sign(x)*div(abs(x)*2+d,d*2))::bigint end
 from (select amount::numeric*least(levied,nights)*bps x,nights::numeric*10000 d) q;
$$;

-- The guest's cleaning fee on a platform stay: the cleaning fee lines on its payout report (the same lines as
-- private.workspace_payout_row), or null when none says.
create or replace function private.workspace_stay_cleaning_fee(target private.workspace_reservations) returns bigint language sql stable security definer set search_path='' as $$
 select case when target.channel in ('airbnb','booking_com','vrbo') and target.channel_reference is not null then
  (select sum(l.cleaning_fee_minor) from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id
    where r.channel=target.channel and upper(l.reference)=upper(target.channel_reference) and l.set_aside_at is null and l.cleaning_fee_minor is not null) end;
$$;

-- The property's levy settings, as statements and the terms sheet show them.
create or replace function private.workspace_visitor_levy_terms(f private.workspace_property_financials) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(f.levy_enabled,false),'rateBps',coalesce(f.levy_rate_bps,500),'nightCap',f.levy_night_cap,'from',f.levy_from,
  'feeAfterLevy',private.workspace_statement_fee_after_levy());
$$;

-- {enabled, rateBps?, nightCap?, from?}: the property's levy settings. Leaves out keys keep their value.
create or replace function private.workspace_set_visitor_levy(prop uuid,v jsonb) returns private.workspace_property_financials language plpgsql security definer set search_path='' as $$
declare f private.workspace_property_financials;cap integer;start_on date;bps integer;
begin
 if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('enabled','rateBps','nightCap','from')) then raise exception 'Invalid visitor levy' using errcode='22023';end if;
 if jsonb_typeof(v->'enabled') is distinct from 'boolean' then raise exception 'Choose whether the visitor levy is charged' using errcode='22023';end if;
 select * into f from private.workspace_property_financials where property_id=prop;
 bps:=f.levy_rate_bps;cap:=f.levy_night_cap;start_on:=f.levy_from;
 if v ? 'rateBps' then
  if jsonb_typeof(v->'rateBps') is distinct from 'number' or v->>'rateBps'!~'^\d{1,5}$' or (v->>'rateBps')::integer>10000 then raise exception 'Enter the visitor levy rate' using errcode='22023';end if;
  bps:=(v->>'rateBps')::integer;
 end if;
 if v ? 'nightCap' then
  if jsonb_typeof(v->'nightCap')='null' then cap:=null;
  elsif jsonb_typeof(v->'nightCap') is distinct from 'number' or v->>'nightCap'!~'^\d{1,3}$' or (v->>'nightCap')::integer not between 1 and 366 then raise exception 'Enter the most nights levied, from 1 to 366' using errcode='22023';
  else cap:=(v->>'nightCap')::integer;
  end if;
 end if;
 if v ? 'from' then
  if jsonb_typeof(v->'from')='null' then start_on:=null;
  else start_on:=private.workspace_statement_date(v,'from');
  end if;
 end if;
 update private.workspace_property_financials set levy_enabled=(v->>'enabled')::boolean,levy_rate_bps=bps,levy_night_cap=cap,levy_from=start_on,updated_at=now()
  where property_id=prop returning * into f;
 return f;
end $$;

do $patch$
declare
 -- {function, anchor, replacement, sentinel}; applied in order on the latest definition.
 fixes constant text[][]:=array[
  -- Terms: the levy settings.
  ['private.workspace_set_statement_terms(jsonb)',
   $q$array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor','vatOnFee','cleanChargeMode']$q$,
   $q$array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor','vatOnFee','cleanChargeMode','visitorLevy']$q$,
   $q$'cleanChargeMode','visitorLevy']$q$],
  ['private.workspace_set_statement_terms(jsonb)',
   $q$returning * into f;$q$,
   $q$returning * into f; if input ? 'visitorLevy' then f:=private.workspace_set_visitor_levy(prop,input->'visitorLevy');end if;$q$,
   $q$f:=private.workspace_set_visitor_levy(prop,input->'visitorLevy')$q$],
  ['private.workspace_set_statement_terms(jsonb)',
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');$q$,
   $q$if input ? 'visitorLevy' then result:=result||jsonb_build_object('visitorLevy',private.workspace_visitor_levy_terms(f));end if; insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');$q$,
   $q$result:=result||jsonb_build_object('visitorLevy',private.workspace_visitor_levy_terms(f))$q$],
  -- The statements list shows the levy settings with the other terms.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps())$q$,
   $q$'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps(),'visitorLevy',private.workspace_visitor_levy_terms(f))$q$,
   $q$'visitorLevy',private.workspace_visitor_levy_terms(f))$q$],
  -- The stored copy carries the stay's levy.
  ['private.workspace_statement_entry(jsonb)',
   $q$'checkIn',e->>'stayCheckIn','checkOut',e->>'stayCheckOut')$q$,
   $q$'checkIn',e->>'stayCheckIn','checkOut',e->>'stayCheckOut','levyMinor',e->'stayLevyMinor','levyNights',e->'stayLevyNights')$q$,
   $q$'levyMinor',e->'stayLevyMinor'$q$],
  -- Issuing compares the levy too.
  ['private.workspace_statement_money(jsonb)',
   $q$e->>'stayCheckIn',e->>'stayCheckOut',e->'wholeStay')$q$,
   $q$e->>'stayCheckIn',e->>'stayCheckOut',e->'wholeStay',e->'levyMinor',e->'stayLevyMinor',e->'stayLevyNights')$q$,
   $q$e->'wholeStay',e->'levyMinor'$q$],
  -- The statement keeps the total for the screens.
  ['private.workspace_prepare_statement_v2(jsonb)',
   $q$'feeBaseMinor',c->'feeBaseMinor','feeBase',c->'terms'->'feeBase',$q$,
   $q$'feeBaseMinor',c->'feeBaseMinor','feeBase',c->'terms'->'feeBase','visitorLevyMinor',c->'visitorLevyMinor','visitorLevy',c->'terms'->'visitorLevy',$q$,
   $q$'visitorLevyMinor',c->'visitorLevyMinor'$q$],
  -- The statement compute.
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$base bigint;fee_minor bigint;vat_minor bigint;$q$,
   $q$base bigint;fee_minor bigint;vat_minor bigint; levy_on boolean;levy_bps integer;levy_cap integer;levy_from date;levy_total bigint:=0;levy_lines jsonb:='[]';stay_levy bigint;stay_levy_nights integer;share_levy bigint;cfee bigint;$q$,
   $q$levy_on boolean;levy_bps integer;$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$available:=to_on-from_on;whole:=statement_method='check_in_month';$q$,
   $q$available:=to_on-from_on;whole:=statement_method='check_in_month'; levy_on:=coalesce(f.levy_enabled,false);levy_bps:=coalesce(f.levy_rate_bps,500);levy_cap:=f.levy_night_cap;levy_from:=f.levy_from;$q$,
   $q$levy_on:=coalesce(f.levy_enabled,false)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$share_gross:=0;share_fee:=0;took:=false;stay_gross:=null;stay_fee:=null;stay_settled:=null;$q$,
   $q$share_gross:=0;share_fee:=0;took:=false;stay_gross:=null;stay_fee:=null;stay_settled:=null;share_levy:=0;stay_levy:=0;stay_levy_nights:=0;$q$,
   $q$share_levy:=0;stay_levy:=0;stay_levy_nights:=0;$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$stay_gross:=(b->>'grossMinor')::bigint;stay_fee:=(b->>'otaFeeMinor')::bigint;stay_settled:=(b->>'settledMinor')::bigint;$q$,
   $q$stay_gross:=(b->>'grossMinor')::bigint;stay_fee:=(b->>'otaFeeMinor')::bigint;stay_settled:=(b->>'settledMinor')::bigint;stay_levy:=coalesce((b->>'levyMinor')::bigint,0);stay_levy_nights:=coalesce((b->>'levyNights')::integer,0);$q$,
   $q$stay_levy:=coalesce((b->>'levyMinor')::bigint,0)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$stay_gross:=gross;stay_fee:=fee;stay_settled:=settled;$q$,
   $q$stay_gross:=gross;stay_fee:=fee;stay_settled:=settled; if levy_on and w_n>0 and (levy_from is null or r.check_in>=levy_from) then cfee:=private.workspace_stay_cleaning_fee(r); if cfee is null and r.channel in ('airbnb','booking_com','vrbo') then flags:=flags||to_jsonb('levy_cleaning_fee_unknown:'||r.id);end if; stay_levy_nights:=least(w_n,coalesce(levy_cap,w_n)); stay_levy:=private.workspace_levy_minor(gross-coalesce(cfee,0),stay_levy_nights,w_n,levy_bps); end if;$q$,
   $q$cfee:=private.workspace_stay_cleaning_fee(r)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$gross_total:=gross_total+share_gross;$q$,
   $q$if took and stay_levy<>0 and stay_levy_nights>0 then share_levy:=case when full_share then stay_levy else private.workspace_prorate(stay_levy,least(bef,stay_levy_nights),least(thr,stay_levy_nights),stay_levy_nights) end;end if; if share_levy<>0 then levy_lines:=levy_lines||jsonb_build_array(jsonb_build_object('kind','visitor_levy','date',r.check_in,'label','Visitor levy','amountMinor',share_levy,'refId',r.id));levy_total:=levy_total+share_levy;end if; gross_total:=gross_total+share_gross;$q$,
   $q$levy_lines:=levy_lines||jsonb_build_array$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee);$q$,
   $q$'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee,'levyMinor',share_levy);$q$,
   $q$'amountMinor',share_gross-share_fee,'levyMinor',share_levy)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'stayCheckIn',w_in,'stayCheckOut',w_out,'wholeStay',full_share);$q$,
   $q$'stayCheckIn',w_in,'stayCheckOut',w_out,'wholeStay',full_share,'stayLevyMinor',stay_levy,'stayLevyNights',stay_levy_nights);$q$,
   $q$'stayLevyMinor',stay_levy$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$base:=gross_total-ota_total-clean_total;$q$,
   $q$base:=gross_total-ota_total-clean_total-case when private.workspace_statement_fee_after_levy() then levy_total else 0 end;$q$,
   $q$case when private.workspace_statement_fee_after_levy() then levy_total else 0 end$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'cleanChargeMode',mode,'feeBase',private.workspace_statement_fee_base()),$q$,
   $q$'cleanChargeMode',mode,'feeBase',private.workspace_statement_fee_base(),'visitorLevy',private.workspace_visitor_levy_terms(f)),$q$,
   $q$'visitorLevy',private.workspace_visitor_levy_terms(f)),$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'lines',ota_lines||clean_lines||fee_lines||vat_lines||payable_lines,$q$,
   $q$'lines',ota_lines||levy_lines||clean_lines||fee_lines||vat_lines||payable_lines,$q$,
   $q$ota_lines||levy_lines||clean_lines$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'payoutMinor',gross_total-ota_total-clean_total-fee_minor-vat_minor-pay_total,$q$,
   $q$'visitorLevyMinor',levy_total,'payoutMinor',gross_total-ota_total-levy_total-clean_total-fee_minor-vat_minor-pay_total,$q$,
   $q$'visitorLevyMinor',levy_total,$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   found_count:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if found_count<>1 then raise exception 'Patch anchor % found % times in %, expected once',i,found_count,fixes[i][1];end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch % did not take in %',i,fixes[i][1];end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_statement_fee_after_levy(),private.workspace_levy_minor(bigint,integer,integer,integer),
 private.workspace_stay_cleaning_fee(private.workspace_reservations),private.workspace_visitor_levy_terms(private.workspace_property_financials),
 private.workspace_set_visitor_levy(uuid,jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014150000','visitor_levy');

-- ===== 20261014160000_owner_work_staff_fields =====
-- Owner privacy: no staff identities in a work item's data (lead developer's task 3, 13 October 2026).
--
-- An owner reading their own work (private.workspace_operation_view, through workspace_operations_read) received the
-- item's data with internal fields that name the staff member who did each step: reportedBy, referredBy,
-- submittedBy, reviewedBy, quoteRevisedBy, decidedBy, verifiedBy and so on, each holding a staff user id. Earlier
-- rounds removed resolvedBy, the troubleshooting notes and the guest evidence; this removes every field whose name
-- ends in "By" for the client role, so no staff identity reaches an owner, whatever field a later step adds.
-- What the owner is meant to read (the issue, the guest update, the quote, the resolution note, dates) is unchanged.
-- Staff and admins are unchanged.
--
-- private.workspace_owner_work_data(data) is the one owner filter. The patch on private.workspace_operation_view reads
-- the LATEST definition, needs its anchors exactly once and is skipped once applied, so the migration is safe to run
-- twice.

create or replace function private.workspace_owner_work_data(item jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(item)='object' then
  coalesce((select jsonb_object_agg(e.k,e.v) from jsonb_each(item-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'-'resolvedBy') e(k,v) where e.k !~ 'By$'),'{}'::jsonb)
  else item end;
$$;

-- The owner's branch is wrapped whole, so the earlier owner list inside it (and 20261012220000's patch of it, whichever
-- runs first) is left as it is.
do $patch$
declare
 definition text;n1 integer;n2 integer;
 head constant text:=$q$'data',case when private.workspace_actor_role()='client' then $q$;
 tail constant text:=$q$ else d.data end)$q$;
 sentinel constant text:=$q$then private.workspace_owner_work_data($q$;
begin
 definition:=pg_get_functiondef('private.workspace_operation_view(uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  n1:=(length(definition)-length(replace(definition,head,'')))/length(head);
  n2:=(length(definition)-length(replace(definition,tail,'')))/length(tail);
  if n1<>1 or n2<>1 then raise exception 'Patch anchors found % and % times in private.workspace_operation_view(uuid), expected once each',n1,n2;end if;
  execute replace(replace(definition,head,head||'private.workspace_owner_work_data('),tail,')'||tail);
  if position(sentinel in pg_get_functiondef('private.workspace_operation_view(uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_operation_view(uuid)';end if;
 end if;
end $patch$;

revoke all on function private.workspace_owner_work_data(jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014160000','owner_work_staff_fields');

-- ===== 20261014200000_region_whole_words =====
-- Region from address, made sturdier (the same rule as lib/regions.ts, which holds the name lists).
-- Before this the first rule to match anywhere won, and names matched inside words: "dunbar" (East Lothian)
-- matched inside Dunbartonshire, so an address in West or East Dunbartonshire was filed as East Lothian;
-- "leith" matched inside Innerleithen; and a street named after a town beat the real town ("Huntly Terrace,
-- Paisley" was Aberdeenshire and Moray). Now:
--   * every name matches as whole words only (\y is a word boundary in PostgreSQL);
--   * council and county names (kind 1) win over towns and other places (kind 2);
--   * within a kind, the name furthest to the right wins (street, then town, then council); at the same
--     spot the longer name, then the earlier area.
-- Only the function changes. The trigger still fills a blank region and never replaces a set one, and no
-- stored region is touched here: properties already filed wrongly are listed in docs/notes-session-B.md for a
-- person to decide. Safe to run more than once.
create or replace function private.workspace_infer_region(address text) returns text
language sql immutable set search_path = '' as $$
 select coalesce((
  select r.area
  from (values
  (1, 1, 'Edinburgh', 'city of edinburgh'),
  (1, 2, 'Glasgow', 'glasgow city'),
  (1, 3, 'Aberdeenshire and Moray', 'aberdeenshire|morayshire|banffshire|kincardineshire'),
  (1, 4, 'Aberdeen', 'aberdeen city|city of aberdeen'),
  (1, 5, 'Dundee', 'dundee city|city of dundee'),
  (1, 6, 'Inverness and Highlands', 'highland council|inverness-shire|ross-shire|nairnshire'),
  (1, 7, 'Fife', 'fife council|kingdom of fife'),
  (1, 8, 'Perth and Kinross', 'perth and kinross|perthshire|kinross-shire'),
  (1, 9, 'Stirling and Falkirk', 'stirlingshire|clackmannanshire'),
  (1, 10, 'East Lothian', 'east lothian'),
  (1, 11, 'Midlothian', 'midlothian|mid lothian'),
  (1, 12, 'West Lothian', 'west lothian'),
  (1, 13, 'Scottish Borders', 'scottish borders|berwickshire|roxburghshire|peeblesshire|selkirkshire'),
  (1, 14, 'Ayrshire', 'ayrshire'),
  (1, 15, 'Dumfries and Galloway', 'dumfries and galloway|dumfriesshire|kirkcudbrightshire|wigtownshire'),
  (1, 16, 'Argyll and Bute', 'argyll and bute|argyllshire|buteshire'),
  (1, 17, 'Angus', 'angus council|forfarshire'),
  (1, 18, 'Lanarkshire', 'lanarkshire'),
  (1, 19, 'Renfrewshire and Inverclyde', 'renfrewshire|inverclyde'),
  (1, 20, 'Dunbartonshire', 'dunbartonshire|dumbartonshire'),
  (1, 21, 'Scottish islands', 'orkney islands|shetland islands|na h-eileanan siar|western isles'),
  (2, 1, 'Edinburgh', 'edinburgh|leith|portobello|musselburgh|balerno|kirkliston'),
  (2, 2, 'Glasgow', 'glasgow'),
  (2, 3, 'Aberdeenshire and Moray', 'moray|elgin|huntly|alford|peterhead|buckie|portgordon|cruden bay|ellon|inverurie|stonehaven|banchory|fraserburgh|forres|turriff'),
  (2, 4, 'Aberdeen', 'aberdeen'),
  (2, 5, 'Dundee', 'dundee'),
  (2, 6, 'Inverness and Highlands', 'inverness|highland|highlands|skye|fort william|aviemore|portree|ullapool|nairn|dingwall|thurso'),
  (2, 7, 'Fife', 'fife|st andrews|kirkcaldy|dunfermline'),
  (2, 8, 'Perth and Kinross', 'perth|kinross|pitlochry'),
  (2, 9, 'Stirling and Falkirk', 'stirling|falkirk|alloa'),
  (2, 10, 'East Lothian', 'north berwick|dunbar|haddington|prestonpans|port seton|tranent'),
  (2, 11, 'Midlothian', 'dalkeith|polton|lasswade|bonnyrigg|penicuik|loanhead'),
  (2, 12, 'West Lothian', 'livingston|linlithgow|bathgate|armadale|blackridge|whitburn|broxburn'),
  (2, 13, 'Scottish Borders', 'borders|peebles|melrose|kelso|hawick|galashiels|selkirk|jedburgh|innerleithen'),
  (2, 14, 'Ayrshire', 'ayr|prestwick|kilmarnock|irvine|troon|largs|saltcoats|ardrossan'),
  (2, 15, 'Dumfries and Galloway', 'dumfries|galloway'),
  (2, 16, 'Argyll and Bute', 'argyll|oban|bute'),
  (2, 17, 'Angus', 'angus|arbroath|montrose'),
  (2, 18, 'Lanarkshire', 'lanark|hamilton|motherwell|rutherglen|east kilbride|cambuslang|airdrie|coatbridge|wishaw|bellshill'),
  (2, 19, 'Renfrewshire and Inverclyde', 'renfrew|paisley|greenock'),
  (2, 20, 'Dunbartonshire', 'dunbarton|dumbarton|clydebank|alexandria|helensburgh|bearsden|milngavie|kirkintilloch|balloch'),
  (2, 21, 'Scottish islands', 'island|islands|orkney|shetland|lewis|harris|mull|islay|arran|hebrides|stornoway')
  ) as r(kind, ord, area, names)
  cross join lateral (select regexp_match(coalesce(address, ''), '^(.*)\y(' || r.names || ')\y', 'i') as m) as x
  where x.m is not null
  order by r.kind, length(x.m[1]) desc, length(x.m[2]) desc, r.ord
  limit 1), '')
$$;
revoke all on function private.workspace_infer_region(text) from public, anon, authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014200000','region_whole_words');

-- ===== 20261014300000_team_calendar_anyone_edits =====
-- Team calendar, who may edit (Lee, 13 October 2026): anyone on the team (cleaners and the cleaning manager too) can add, change
-- and cancel absences, meetings, time away, training and other entries for anyone on the team. Owners never can, and never read them.
-- Every entry records who last edited it and when (updated_by, updated_at), and the read returns both so the calendar can show them.
-- The person an entry is for is still told when someone else adds, changes or cancels it (team.event_set, team.event_cancelled);
-- those notices carry no work or property, so the activity_scoped policy already keeps them from owners.
-- The read and the action are replaced whole (only 20261012210000 defines them; nothing patches them). The routes are unchanged.

-- ---------------------------------------------------------------- assumption, one function
-- Who may change someone else's entry (client decision, confirmed by Lee): everyone on the team. Return false to go back to
-- "your own; admins anyone's".
create or replace function private.workspace_team_events_anyone_edits() returns boolean language sql immutable set search_path='' as $fn$ select true $fn$;

-- ---------------------------------------------------------------- who last edited
alter table private.workspace_team_events add column if not exists updated_by uuid references public.workspace_profiles(user_id);
create index if not exists workspace_team_events_editor_idx on private.workspace_team_events(updated_by);
-- Rows saved before this migration: the last edit is the cancel if there was one, else whoever added it.
update private.workspace_team_events set updated_by=coalesce(cancelled_by,created_by) where updated_by is null;

-- ---------------------------------------------------------------- read
-- Every team role (cleaners too), never owners. canEditAll says whether this person may change other people's entries.
-- editedBy is the name of whoever last added, changed or cancelled the entry; editedAt is when.
create or replace function private.workspace_team_events_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>private.workspace_team_events_max_window() then raise exception 'Choose up to 62 days' using errcode='22023';end if;
 return jsonb_build_object('from',start_on,'to',end_on,'canEditAll',actor in ('admin','super_admin') or private.workspace_team_events_anyone_edits(),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'fullName',x.full_name,'role',x.role,'kind',x.kind,'title',x.title,
     'startsOn',x.starts_on,'endsOn',x.ends_on,'startTime',to_char(x.start_time,'HH24:MI'),'endTime',to_char(x.end_time,'HH24:MI'),'location',x.location,
     'mine',x.user_id=auth.uid(),'version',x.version,
     'editedById',x.editor_id,'editedBy',x.editor_name,'editedAt',x.updated_at,'added',x.version=1) order by x.starts_on,x.start_time nulls first,x.full_name,x.id),'[]')
   from (select e.*,p.full_name,p.role,coalesce(e.updated_by,e.created_by) editor_id,ed.full_name editor_name
     from private.workspace_team_events e join public.workspace_profiles p on p.user_id=e.user_id
     left join public.workspace_profiles ed on ed.user_id=coalesce(e.updated_by,e.created_by)
     where e.cancelled_at is null and e.starts_on<=end_on and e.ends_on>=start_on and p.status='active' and p.role<>'client'
     order by e.starts_on,e.id limit 500) x));
end $fn$;

-- ---------------------------------------------------------------- actions
-- saveTeamEvent {id?, version?, userId?, kind, title, startsOn, endsOn, startTime?, endTime?, location?} and cancelTeamEvent {id, version?}.
-- Anyone on the team adds one for anyone on the team (userId) and changes or cancels anyone's; each write records who made it.
create or replace function private.workspace_team_events_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;e private.workspace_team_events;
 for_others boolean;target uuid;sd date;ed date;st time;et time;loc text;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a is null or a not in ('saveTeamEvent','cancelTeamEvent') then raise exception 'Unknown team action' using errcode='22023';end if;
 for_others:=actor in ('admin','super_admin') or private.workspace_team_events_anyone_edits();
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveTeamEvent' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','userId','kind','title','startsOn','endsOn','startTime','endTime','location']);
  if coalesce(input->>'kind','') not in ('absence','meeting','away','training','other') then raise exception 'Choose what this is' using errcode='22023';end if;
  perform private.workspace_required_text(input,'title',2,200);
  if jsonb_typeof(input->'startsOn') is distinct from 'string' or jsonb_typeof(input->'endsOn') is distinct from 'string'
   or input->>'startsOn'!~'^\d{4}-\d{2}-\d{2}$' or input->>'endsOn'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the dates' using errcode='22023';end if;
  begin sd:=(input->>'startsOn')::date;ed:=(input->>'endsOn')::date;
  exception when others then raise exception 'Choose the dates' using errcode='22023';end;
  if ed<sd then raise exception 'The end date must be on or after the start date' using errcode='22023';end if;
  if ed-sd>private.workspace_team_event_max_days() then raise exception 'Choose up to a year' using errcode='22023';end if;
  if sd<current_date-366 or ed>current_date+731 then raise exception 'Choose dates within the last year and the next two' using errcode='22023';end if;
  if (input ? 'startTime' and jsonb_typeof(input->'startTime') not in ('string','null')) or (input ? 'endTime' and jsonb_typeof(input->'endTime') not in ('string','null'))
   or coalesce(input->>'startTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(input->>'endTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Choose the times' using errcode='22023';end if;
  st:=(input->>'startTime')::time;et:=(input->>'endTime')::time;
  if et is not null and st is null then raise exception 'Add the start time too' using errcode='22023';end if;
  if et is not null and ed=sd and et<=st then raise exception 'The end time must be after the start time' using errcode='22023';end if;
  if input ? 'location' and (jsonb_typeof(input->'location') not in ('string','null') or length(coalesce(input->>'location',''))>200) then raise exception 'The place is too long' using errcode='22023';end if;
  loc:=btrim(coalesce(input->>'location',''));
  if input ? 'id' then
   select * into e from private.workspace_team_events x where x.id=(input->>'id')::uuid for update;
   if e.id is null then raise exception 'Event not found' using errcode='P0002';end if;
   if e.user_id<>auth.uid() and not for_others then raise exception 'You can only change your own events' using errcode='42501';end if;
   if e.user_id<>auth.uid() and not private.workspace_team_member(e.user_id) then raise exception 'This person is no longer on the team' using errcode='22023';end if;
   if e.cancelled_at is not null then raise exception 'This event was cancelled' using errcode='22023';end if;
   if input ? 'userId' and (input->>'userId')::uuid is distinct from e.user_id then raise exception 'An event stays with the person it is for' using errcode='22023';end if;
   if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
   update private.workspace_team_events set kind=input->>'kind',title=btrim(input->>'title'),starts_on=sd,ends_on=ed,start_time=st,end_time=et,location=loc,
    version=version+1,updated_at=now(),updated_by=auth.uid() where id=e.id returning * into e;
  else
   target:=coalesce((input->>'userId')::uuid,auth.uid());
   if target<>auth.uid() and not for_others then raise exception 'You can only add your own events' using errcode='42501';end if;
   if not private.workspace_team_member(target) then raise exception 'Choose someone on the team' using errcode='22023';end if;
   insert into private.workspace_team_events(user_id,kind,title,starts_on,ends_on,start_time,end_time,location,created_by,updated_by)
    values(target,input->>'kind',btrim(input->>'title'),sd,ed,st,et,loc,auth.uid(),auth.uid()) returning * into e;
  end if;
  result:=jsonb_build_object('id',e.id,'version',e.version,'userId',e.user_id);
  -- Someone else's calendar changed: tell them. Your own changes need no notice.
  if e.user_id<>auth.uid() then
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.event_set') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) values(e.user_id,event_id) on conflict do nothing;
  end if;
 else
  perform private.workspace_json_keys(input,array['action','requestId','id','version']);
  select * into e from private.workspace_team_events x where x.id=(input->>'id')::uuid for update;
  if e.id is null then raise exception 'Event not found' using errcode='P0002';end if;
  if e.user_id<>auth.uid() and not for_others then raise exception 'You can only cancel your own events' using errcode='42501';end if;
  if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if e.cancelled_at is null then
   update private.workspace_team_events set cancelled_at=now(),cancelled_by=auth.uid(),version=version+1,updated_at=now(),updated_by=auth.uid() where id=e.id returning * into e;
   if e.user_id<>auth.uid() then
    insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.event_cancelled') returning id into event_id;
    insert into private.workspace_notification_outbox(user_id,event_id) values(e.user_id,event_id) on conflict do nothing;
   end if;
  end if;
  result:=jsonb_build_object('id',e.id,'version',e.version,'cancelled',true);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_team_events_anyone_edits(),private.workspace_team_events_read(date,date),private.workspace_team_events_action(jsonb)
 from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014300000','team_calendar_anyone_edits');

-- ===== 20261014310000_guest_messaging_roles =====
-- Guest messaging, who may use it (client answer 12): "landlords, cleaners and maintenance don't get access to guest messaging."
-- Until now the guest inbox refused owners (client) and cleaners (cleans) only; Ready (maintenance) could read and reply to guest
-- conversations once given the guest communication tool. From here the three roles are refused whatever tools they hold:
-- reading the list or a conversation, logging a message, replying, sending through Hostaway, closing and editing a conversation,
-- and the saved replies used to answer guests.
-- Everyone else still needs the guest communication tool, and the property, exactly as before.
-- guest_inbox_can is replaced whole (only 20261009140000 defines it; nothing patches it). The read and the action keep their own
-- gate and gain a second one right after it, by anchor and append (the anchor stays first, a sentinel stops a second run,
-- a missing or repeated anchor raises).

-- ---------------------------------------------------------------- assumption, one function
-- The roles that never use guest messaging. Mirrored by GUEST_MESSAGING_BLOCKED_ROLES in lib/workspace-chat-policy.ts.
create or replace function private.workspace_guest_messaging_role(actor_role text) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(actor_role not in ('client','cleans','ready'),false)
$fn$;

-- Which conversations a person may see: their role may use guest messaging, they hold the tool, and the conversation is for one
-- of their properties (or not yet matched to one).
create or replace function private.guest_inbox_can(prop uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_guest_messaging_role(private.workspace_actor_role()) and private.has_workspace_module('guest-communication')
  and (prop is null or private.workspace_can_property(prop,'guest-communication'));
$fn$;

-- Saved replies go with the guest inbox: admins, and anyone else whose role may use guest messaging and who holds the tool.
-- Replaced whole (only 20261009170000 defines it).
create or replace function private.saved_replies_can_read() returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_guest_messaging_role(private.workspace_actor_role()) and private.has_workspace_module('guest-communication')),false);
$fn$;

revoke all on function private.workspace_guest_messaging_role(text),private.guest_inbox_can(uuid),private.saved_replies_can_read() from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;
 if not private.workspace_guest_messaging_role(private.workspace_actor_role()) then raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$if not private.workspace_guest_messaging_role(private.workspace_actor_role())$q$],
  ['private.workspace_guest_inbox_action(jsonb)',
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;
 if not private.workspace_guest_messaging_role(private.workspace_actor_role()) then raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$if not private.workspace_guest_messaging_role(private.workspace_actor_role())$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values('20261014310000','guest_messaging_roles');

-- ===== 20261014320000_chat_notices =====
-- Message notices (client answer 12): "notifications for any message that's related to that person's department; any chat
-- I'm in, I want a notification for; any chat a cleaner is in, they get a notification for; same for landlords."
-- How it works: sending a chat message adds one 'chat.message' (or 'chat.owner_message') activity row and a notice for each
-- person in private.chat_audience (the members; for an owner's conversation the owner and the team that answers owners; for a team
-- channel everyone in that department, admins only in Management and Everyone), except the sender and anyone who blocked them.
-- Who is in the audience is unchanged here. What changes is the "once per conversation until read" rule: a person was told only
-- if they had read the conversation since the message before, so someone who had never opened it (no read row: a new starter, a
-- person newly added to a channel or group) was told about the first message only and never again. Now the time each person was
-- last told is kept in private.chat_notified, and they are told again once they have read since then.
-- The workflow notice routes (workspace_notice_routes) are not touched. workspace_chat_action is patched by anchor and append:
-- the anchor stays first, a sentinel stops a second run, and a missing or repeated anchor raises.

create table if not exists private.chat_notified (
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 notified_at timestamptz not null,
 primary key(conversation_id,user_id)
);
create index if not exists chat_notified_user_idx on private.chat_notified(user_id);
alter table private.chat_notified enable row level security;
revoke all on private.chat_notified from public,anon,authenticated;

-- Is this person due a notice for this conversation: never told, or told before they last read it.
create or replace function private.chat_notice_due(target uuid,subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce((select n.notified_at from private.chat_notified n where n.conversation_id=target and n.user_id=subject),'-infinity'::timestamptz)
  <=coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=subject),'-infinity'::timestamptz)
$fn$;

revoke all on function private.chat_notice_due(uuid,uuid) from public,anon,authenticated;

-- The send branch keeps its own notice (people who had read since the message before) and then adds one for everyone due by the
-- new rule, recording when each was told. Everyone the old rule tells is also due by the new one, so the record covers them all.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_chat_action(jsonb)',
   $q$and coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=u),'-infinity')>=coalesce(previous,'-infinity')$q$,
   $q$and coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=u),'-infinity')>=coalesce(previous,'-infinity')
   on conflict do nothing;
  -- Once per conversation until read (20261014320000): everyone due a notice is told and the time is recorded.
  with due as (select u from private.chat_audience(target) u where u<>me and not private.chat_blocked(u,me) and private.chat_notice_due(target,u)),
  noted as (insert into private.chat_notified(conversation_id,user_id,notified_at) select target,u,now() from due
   on conflict(conversation_id,user_id) do update set notified_at=excluded.notified_at returning user_id)
  insert into private.workspace_notification_outbox(user_id,event_id) select n.user_id,ev from noted n$q$,
   $q$private.chat_notice_due(target,u)$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values('20261014320000','chat_notices');

-- ===== 20261014330000_stay_guest_name_dates =====
-- Calendar fix (handover): an unrelated enquiry on exactly the same dates as a direct stay could put its guest's name on that stay.
-- The name came from the guest conversation about the stay: first the one carrying the stay's booking code, else one on the same
-- property and dates. Only the Hostaway import gives a conversation dates (one logged by hand has none), and it gives a conversation
-- the booking code whenever its reservation is a stay we hold. So a conversation matched by dates alone was always a Hostaway
-- conversation whose reservation is not one of our stays: an enquiry, or a request that did not go ahead. Nothing in the data tells
-- such a conversation apart from the booked guest's, so the date match is removed: a stay is named only by a conversation that
-- carries one of its codes (the platform booking code, its tidy form, or the stay's own reference). A stay entered by hand gets its
-- name once the conversation is matched to it in the guest inbox (Edit, booking reference: the stay's reference), and otherwise
-- shows as "Guest stay". Replaced whole (only 20261012210000 defines it; nothing patches it).
create or replace function private.workspace_stay_guest_name(reservation uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_reservations;codes text[];guest text;
begin
 select * into r from private.workspace_reservations x where x.id=reservation;
 if r.id is null or private.workspace_is_owner_stay(r) then return null;end if;
 codes:=private.workspace_stay_codes(r.channel_reference,r.reference);
 if cardinality(codes)=0 then return null;end if;
 -- The newest named conversation that carries this stay's code, on this property or not yet placed on one.
 select t.guest_name into guest from private.workspace_guest_threads t
  where t.guest_name is not null and t.reservation_ref is not null and upper(t.reservation_ref)=any(codes) and (t.property_id is null or t.property_id=r.property_id)
  order by (t.property_id is not null) desc,t.last_message_at desc nulls last,t.created_at desc limit 1;
 return guest;
end $fn$;

revoke all on function private.workspace_stay_guest_name(uuid) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261014330000','stay_guest_name_dates');

commit;

-- Afterwards this should list twelve rows:
-- select version,name from supabase_migrations.schema_migrations where version like '20261014%' order by 1;
