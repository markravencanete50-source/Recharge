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
