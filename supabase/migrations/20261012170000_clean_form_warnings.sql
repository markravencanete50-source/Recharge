-- Clean form warnings (B2): a clean that has a cleaner but no submitted form by the end of its day is tagged,
-- flagged for management, and logged. It never changes what a cleaner is paid, never blocks the clean, and the
-- cleaner can still send the form late.
--
-- 1. The assumptions, each one immutable function (mirrored in lib/feedback-defaults.ts):
--      private.workspace_clean_form_due_time()      '18:00'          local time on the clean day after which a form is overdue
--      private.workspace_clean_form_zone()          'Europe/London'  the zone the clean day and that time are read in
--      private.workspace_clean_form_sweep_limit()   200              cleans warned per run
--      private.workspace_clean_form_lookback_days() 14               older cleans are left alone, so switching this on never floods
--                                                                    management with forgotten history
-- 2. private.workspace_clean_form_sweep(at) finds clean work items that
--      - have a cleaner (assignee_id not null) and are still waiting or in progress (not completed, cancelled or declined),
--      - have no submitted form: the cleaner's submission sets data.submittedBy and moves the clean to phase 'review',
--        so a clean still in phase 'assigned' with no submittedBy has none. A clean sent back after a review keeps its
--        submittedBy, so it is never warned,
--      - are overdue at `at`: the clean day (the item's due date, else data.dueOn) is before the local day of `at`, or is that
--        day and the local time of `at` is after the due time,
--      - are not already warned (data.formWarningAt or data.warning = 'no_form').
--    For each one (oldest day first, at most the limit per run, one run at a time) it
--      - merges data.warning = 'no_form' and data.formWarningAt (UTC ISO time of `at`) into the clean's data,
--      - bumps the work item's version and updated_at, like the mid-stay clean sweep does when it changes an item,
--      - writes the activity event cleaning.form_missing (no actor, carries the work id so the tracker row shows it),
--      - raises an open management flag (source 'clean_form', raised_by null) unless the clean already has an open flag,
--        for example one a person raised, and tells the active admins through the notification outbox.
--    It answers { warned, skipped }: warned is the number of cleans tagged in this run, skipped is how many of them
--    already had an open flag so no second one was raised. A form sent later leaves the tag in place as history and
--    leaves the open flag for management to decide: nothing here resolves a flag.
-- 3. public.workspace_clean_form_sweep() is the backend's cron entry (service role only). There is no trigger.
--
-- Depends on 20261012140000_management_flags (private.workspace_management_flags, private.workspace_flag_open_for_work).
-- Safe to run more than once: every function is created or replaced as a whole and nothing else is touched.

create or replace function private.workspace_clean_form_due_time() returns text language sql immutable set search_path='' as $fn$select '18:00'::text$fn$;
create or replace function private.workspace_clean_form_zone() returns text language sql immutable set search_path='' as $fn$select 'Europe/London'::text$fn$;
create or replace function private.workspace_clean_form_sweep_limit() returns integer language sql immutable set search_path='' as $fn$select 200$fn$;
create or replace function private.workspace_clean_form_lookback_days() returns integer language sql immutable set search_path='' as $fn$select 14$fn$;

-- The day of a clean: its due date, else the date held in its data. Null when neither is a real date.
create or replace function private.workspace_clean_form_day(due_on date,item jsonb) returns date language plpgsql stable set search_path='' as $fn$
begin
 return coalesce(due_on,case when jsonb_typeof(item->'dueOn')='string' then (item->>'dueOn')::date end);
exception when others then
 return coalesce(due_on,null);
end $fn$;

-- Whether a form for a clean on this day is overdue at this moment (the day has passed, or it is that day after the due time).
create or replace function private.workspace_clean_form_is_due(clean_day date,at timestamptz) returns boolean language sql stable set search_path='' as $fn$
 select clean_day is not null and at is not null and (
  clean_day<(at at time zone private.workspace_clean_form_zone())::date
  or (clean_day=(at at time zone private.workspace_clean_form_zone())::date
   and (at at time zone private.workspace_clean_form_zone())::time>private.workspace_clean_form_due_time()::time));
$fn$;

create or replace function private.workspace_clean_form_sweep(at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 stamp timestamptz:=coalesce(at,now());
 local_day date:=(coalesce(at,now()) at time zone private.workspace_clean_form_zone())::date;
 c record;event_id bigint;flag_id uuid;warned integer:=0;skipped integer:=0;admins uuid[];place text;
begin
 -- One run at a time, so "not already warned" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_clean_form_sweep',0));
 admins:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');
 for c in select w.id work_id,w.property_id,p.name property_name,p.address property_address,private.workspace_clean_form_day(w.due_on,d.data) clean_day
  from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id
  join public.workspace_properties p on p.id=w.property_id
  where d.kind='cleaning' and w.assignee_id is not null and w.status in ('waiting','in_progress') and p.status<>'archived'
   and coalesce(d.data->>'phase','assigned')='assigned' and not (d.data ? 'submittedBy')
   and not (d.data ? 'formWarningAt') and coalesce(d.data->>'warning','')<>'no_form'
   and private.workspace_clean_form_day(w.due_on,d.data)>=local_day-private.workspace_clean_form_lookback_days()
   and private.workspace_clean_form_is_due(private.workspace_clean_form_day(w.due_on,d.data),stamp)
  order by private.workspace_clean_form_day(w.due_on,d.data),w.id
  limit private.workspace_clean_form_sweep_limit()
  for update of w,d skip locked
 loop
  update private.workspace_domain_details set data=data||jsonb_build_object('warning','no_form','formWarningAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),updated_at=now() where work_id=c.work_id;
  update public.workspace_work_items set version=version+1,updated_at=now() where id=c.work_id;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(null,c.property_id,c.work_id,'cleaning.form_missing') returning id into event_id;
  warned:=warned+1;
  -- One open flag per piece of work: a person may have flagged this clean already.
  if private.workspace_flag_open_for_work(c.work_id) then skipped:=skipped+1;continue;end if;
  place:=coalesce(nullif(trim(c.property_name),''),'the property')||case when nullif(trim(c.property_address),'') is not null then ' ('||trim(c.property_address)||')' else '' end;
  flag_id:=null;
  insert into private.workspace_management_flags(source,work_id,property_id,title,reason,raised_by)
   values('clean_form',c.work_id,c.property_id,'Cleaning form missing',
    left(format('No cleaning form was submitted for the clean at %s on %s. The cleaner can still send it late.',place,to_char(c.clean_day,'FMDD FMMonth YYYY')),2000),null)
   on conflict do nothing returning id into flag_id;
  if flag_id is null then skipped:=skipped+1;continue;end if;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id)
   select a,c.work_id,event_id from unnest(admins) a on conflict do nothing;
 end loop;
 return jsonb_build_object('warned',warned,'skipped',skipped);
end $fn$;

-- The backend's cron entry (service role only).
create or replace function public.workspace_clean_form_sweep() returns jsonb language sql security invoker set search_path='' as $fn$select private.workspace_clean_form_sweep(now());$fn$;

revoke all on function private.workspace_clean_form_due_time(),private.workspace_clean_form_zone(),private.workspace_clean_form_sweep_limit(),private.workspace_clean_form_lookback_days(),
 private.workspace_clean_form_day(date,jsonb),private.workspace_clean_form_is_due(date,timestamptz),private.workspace_clean_form_sweep(timestamptz) from public,anon,authenticated;
revoke all on function public.workspace_clean_form_sweep() from public,anon,authenticated;
grant execute on function private.workspace_clean_form_sweep(timestamptz),public.workspace_clean_form_sweep() to service_role;
