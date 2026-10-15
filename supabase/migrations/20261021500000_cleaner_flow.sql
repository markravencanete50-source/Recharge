-- A clear cleaner process (owner Lee, from client Alex, 15 October 2026).
--
-- 1. Times. Each stay keeps its check-in and checkout times when Hostaway gives them (two new nullable columns on
--    private.workspace_reservations, filled by the sync). Each clean then knows the checkout time of the stay ending that
--    day and the next guests' arrival day and time (private.workspace_clean_times), and the cleaners' schedule read
--    (private.workspace_clean_guests) returns them as checkoutTime and nextArrivalTime. Times and counts only: no guest
--    names or contact details reach cleaners.
-- 2. Notices to the cleaner, each with a plain sentence for the pop-up (private.workspace_activity_details.preview):
--      cleaning.assigned    "New clean: 110 Hawk, Sat 18 Oct · checkout 10:00 · next guests 15:00"
--                           (from a booking through the usual cleaner, assigned by hand, or reassigned)
--      cleaning.unassigned  "Clean taken off your list: 110 Hawk, Sat 18 Oct" (to the cleaner who had it)
--      cleaning.moved       "Clean moved: 110 Hawk, now Sun 19 Oct"
--      cleaning.cancelled   "Clean cancelled: 110 Hawk, Sat 18 Oct. The stay was cancelled in Hostaway"
--      cleaning.redo        "Please redo: 110 Hawk by 15:00 — <reviewer's note>"
--      cleaning.morning     "Good morning — 2 cleans today: 110 Hawk (next guests 15:00), 12 Leith St (no guests today)"
--    The first four come from one trigger on the work item (work_clean_notices), so the Hostaway sync, the usual cleaner,
--    assignWork and setDefaultCleaner all send them. Nobody is told about their own change.
--    The generic "Update in Recharge" notice (workspace_work_items.update) no longer goes to the assignee of a clean:
--    the specific notices above cover what a cleaner needs (patch on private.workspace_record_activity). The activity
--    row is still written, and every other kind of work is unchanged.
--    The morning notice: private.workspace_clean_morning_notices(at) sends one notice per cleaner per day, from 07:00
--    to 10:59 London time (BST and GMT), only to cleaners with a clean that day. A sent-log keyed by cleaner and day
--    (private.workspace_clean_morning_sent) makes it run once, so the worker calls it every 15 minutes and a missed 07:00
--    run catches up, but never from 11:00.
-- 3. The clean form takes optional startedAt and finishedAt (HH:MM). A finish is after the start, the same day or
--    overnight, at most 12 hours later. A new submission replaces the times of an earlier one.
-- 4. Review: guest feedback is needed only to reject (the actors and the reviewer-is-not-the-cleaner rule are unchanged).
--    A rejection needs redoBy, a time in the next seven days; it is kept on the clean (data.redoBy) and the cleaner gets
--    cleaning.redo instead of the old cleaning.rejected notice (the cleaning.rejected activity row is still written for
--    the oversight views). Accepting clears redoBy.
-- 5. Rates: setCleanerRate is for admins, super admins and Accounts with the Clean invoices tool (cleaning managers can
--    still read their own cleaners' rates). Every rate change is recorded in private.workspace_cleaner_rate_history
--    (who, when, old, new) by a trigger on the rates table, whatever path made it.
--    New cleaners no longer get the Clean invoices tool (private.workspace_role_tools, matching lib/modules.ts). Cleaners
--    who have it keep it: nothing is removed here.
--
-- The patches read the LATEST definition, need their anchor exactly once and are skipped once their sentinel is present,
-- so the migration is safe to run twice. Nothing is dropped or deleted.

-- 1. Stay times ---------------------------------------------------------------------------------------------------
alter table private.workspace_reservations add column if not exists check_in_time time;
alter table private.workspace_reservations add column if not exists check_out_time time;

-- "15", 15, "15:00" or "15:30" as a time of day; null for anything else.
create or replace function private.workspace_clock(value text) returns time language sql immutable set search_path='' as $fn$
 select case
  when btrim(coalesce(value,'')) ~ '^\d{1,2}$' and btrim(value)::int between 0 and 23 then make_time(btrim(value)::int,0,0)
  when btrim(coalesce(value,'')) ~ '^\d{1,2}:\d{2}(:\d{2})?$' and split_part(btrim(value),':',1)::int between 0 and 23 and split_part(btrim(value),':',2)::int between 0 and 59
   then make_time(split_part(btrim(value),':',1)::int,split_part(btrim(value),':',2)::int,0)
 end
$fn$;
revoke all on function private.workspace_clock(text) from public,anon,authenticated;

-- The day of a clean: its due date, else the day in its details.
create or replace function private.workspace_clean_day(target uuid) returns date language sql stable security definer set search_path='' as $fn$
 select coalesce(w.due_on,case when d.data->>'dueOn' ~ '^\d{4}-\d{2}-\d{2}$' then (d.data->>'dueOn')::date end)
 from public.workspace_work_items w left join private.workspace_domain_details d on d.work_id=w.id where w.id=target
$fn$;

-- A clean's times: the checkout time of the stay ending that day, and the next guests' arrival day and time.
create or replace function private.workspace_clean_times(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object(
  'checkoutTime',(select to_char(r.check_out_time,'HH24:MI') from private.workspace_reservations r
    where r.property_id=w.property_id and r.status='confirmed' and r.check_out=c.day
    order by (r.id::text=d.data->>'reservationId') desc,r.id limit 1),
  'nextArrivalOn',n.check_in,
  'nextArrivalTime',to_char(n.check_in_time,'HH24:MI'))
 from public.workspace_work_items w
 join private.workspace_domain_details d on d.work_id=w.id
 cross join lateral (select private.workspace_clean_day(w.id) as day) c
 left join lateral (select r.check_in,r.check_in_time from private.workspace_reservations r
   where r.property_id=w.property_id and r.status='confirmed' and r.check_in>=c.day order by r.check_in,r.id limit 1) n on true
 where w.id=target
$fn$;

-- "110 Hawk, Sat 18 Oct".
create or replace function private.workspace_clean_place(target uuid) returns text language sql stable security definer set search_path='' as $fn$
 select coalesce(nullif(btrim(p.name),''),'A property')||coalesce(', '||to_char(private.workspace_clean_day(w.id),'Dy FMDD Mon'),'')
 from public.workspace_work_items w left join public.workspace_properties p on p.id=w.property_id where w.id=target
$fn$;

-- "110 Hawk, Sat 18 Oct · checkout 10:00 · next guests 15:00".
create or replace function private.workspace_clean_line(target uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare t jsonb:=private.workspace_clean_times(target);day date:=private.workspace_clean_day(target);parts text[];
begin
 parts:=array[private.workspace_clean_place(target)];
 if t->>'checkoutTime' is not null then parts:=parts||('checkout '||(t->>'checkoutTime'));end if;
 if t->>'nextArrivalOn' is not null and (t->>'nextArrivalOn')::date=day then parts:=parts||('next guests '||coalesce(t->>'nextArrivalTime','today'));
 elsif t->>'nextArrivalOn' is not null then parts:=parts||('next guests '||to_char((t->>'nextArrivalOn')::date,'Dy FMDD Mon'));
 end if;
 return array_to_string(parts,' · ');
end $fn$;

-- One notice to one person, with its sentence for the pop-up. Without the work item when the person may no longer open it.
create or replace function private.workspace_clean_notify(recipient uuid,target uuid,prop uuid,event text,line text,link_work boolean) returns void
language plpgsql security definer set search_path='' as $fn$
declare ev bigint;
begin
 if recipient is null then return;end if;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,case when link_work then target end,event) returning id into ev;
 insert into private.workspace_activity_details(event_id,preview,replied) values(ev,private.workspace_push_line(line,300),false) on conflict do nothing;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(recipient,case when link_work then target end,ev) on conflict do nothing;
end $fn$;

-- 2a. Notices when a clean is assigned, taken off someone, moved or cancelled.
create or replace function private.workspace_clean_change_notices() returns trigger language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();why text;
begin
 begin
  if not exists(select 1 from private.workspace_domain_details d where d.work_id=new.id and d.kind='cleaning') then return null;end if;
  if old.assignee_id is distinct from new.assignee_id then
   if old.assignee_id is not null and old.assignee_id is distinct from me and old.status not in ('completed','cancelled','declined') then
    perform private.workspace_clean_notify(old.assignee_id,new.id,new.property_id,'cleaning.unassigned','Clean taken off your list: '||private.workspace_clean_place(new.id),false);
   end if;
   if new.assignee_id is not null and new.assignee_id is distinct from me and new.status not in ('completed','cancelled','declined') then
    perform private.workspace_clean_notify(new.assignee_id,new.id,new.property_id,'cleaning.assigned','New clean: '||private.workspace_clean_line(new.id),true);
   end if;
  elsif new.assignee_id is not null and new.assignee_id is distinct from me then
   if new.status='cancelled' and old.status<>'cancelled' then
    why:=(select nullif(btrim(d.data->>'cancelledBecause'),'') from private.workspace_domain_details d where d.work_id=new.id);
    perform private.workspace_clean_notify(new.assignee_id,new.id,new.property_id,'cleaning.cancelled','Clean cancelled: '||private.workspace_clean_place(new.id)||coalesce('. '||why,''),true);
   elsif old.due_on is not null and new.due_on is not null and new.due_on<>old.due_on and new.status not in ('completed','cancelled','declined') then
    perform private.workspace_clean_notify(new.assignee_id,new.id,new.property_id,'cleaning.moved',
     'Clean moved: '||coalesce((select nullif(btrim(p.name),'') from public.workspace_properties p where p.id=new.property_id),'A property')||', now '||to_char(new.due_on,'Dy FMDD Mon'),true);
   end if;
  end if;
 exception when others then
  -- A notice is never worth losing the change it describes.
  raise warning 'Clean notice skipped for work %: %',new.id,sqlerrm;
 end;
 return null;
end $fn$;
create or replace trigger work_clean_notices after update of assignee_id,due_on,status on public.workspace_work_items
 for each row execute function private.workspace_clean_change_notices();

-- 2d. The morning notice.
create table if not exists private.workspace_clean_morning_sent (
 cleaner_id uuid not null references public.workspace_profiles(user_id),
 on_day date not null,
 event_id bigint references public.workspace_activity(id),
 sent_at timestamptz not null default now(),
 primary key (cleaner_id,on_day)
);
alter table private.workspace_clean_morning_sent enable row level security;
revoke all on private.workspace_clean_morning_sent from public,anon,authenticated;

-- "110 Hawk (next guests 15:00)", "12 Leith St (no guests today)".
create or replace function private.workspace_clean_morning_item(target uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare t jsonb:=private.workspace_clean_times(target);day date:=private.workspace_clean_day(target);place text;
begin
 place:=coalesce((select nullif(btrim(p.name),'') from public.workspace_work_items w join public.workspace_properties p on p.id=w.property_id where w.id=target),'A property');
 return place||case when t->>'nextArrivalOn' is not null and (t->>'nextArrivalOn')::date=day then ' (next guests '||coalesce(t->>'nextArrivalTime','today')||')' else ' (no guests today)' end;
end $fn$;

create or replace function private.workspace_clean_morning_notices(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare stamp timestamptz:=coalesce(at_time,now());local_time timestamp:=coalesce(at_time,now()) at time zone 'Europe/London';
 today date:=(coalesce(at_time,now()) at time zone 'Europe/London')::date;c record;ev bigint;items text[];line text;sent integer:=0;
begin
 -- From 07:00 London; a missed run catches up until 10:59, never later.
 if extract(hour from local_time)<7 or extract(hour from local_time)>=11 then return jsonb_build_object('sent',0);end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace_clean_morning_notices',0));
 for c in select w.assignee_id cleaner,array_agg(w.id order by p.name,w.id) cleans
  from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id and d.kind='cleaning'
  join public.workspace_profiles u on u.user_id=w.assignee_id and u.role='cleans' and u.status='active'
  join public.workspace_properties p on p.id=w.property_id
  where w.due_on=today and w.status not in ('completed','cancelled','declined')
  group by w.assignee_id
 loop
  insert into private.workspace_clean_morning_sent(cleaner_id,on_day,sent_at) values(c.cleaner,today,stamp) on conflict do nothing;
  if not found then continue;end if;
  items:=array(select private.workspace_clean_morning_item(x) from unnest(c.cleans[1:5]) x);
  line:='Good morning — '||cardinality(c.cleans)||case when cardinality(c.cleans)=1 then ' clean' else ' cleans' end||' today: '||array_to_string(items,', ')
   ||case when cardinality(c.cleans)>5 then ' and '||(cardinality(c.cleans)-5)||' more' else '' end;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type,created_at) values(null,null,null,'cleaning.morning',stamp) returning id into ev;
  insert into private.workspace_activity_details(event_id,preview,replied) values(ev,private.workspace_push_line(line,300),false) on conflict do nothing;
  insert into private.workspace_notification_outbox(user_id,event_id) values(c.cleaner,ev) on conflict do nothing;
  update private.workspace_clean_morning_sent set event_id=ev where cleaner_id=c.cleaner and on_day=today;
  sent:=sent+1;
 end loop;
 return jsonb_build_object('sent',sent);
end $fn$;
create or replace function public.workspace_clean_morning_notices() returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_clean_morning_notices() $fn$;

-- 3. Start and finish times on the clean form.
create or replace function private.workspace_clean_hours_check(started jsonb,finished jsonb) returns void language plpgsql immutable set search_path='' as $fn$
declare minutes integer;
begin
 if started is not null and jsonb_typeof(started)<>'null' and (jsonb_typeof(started)<>'string' or started#>>'{}'!~'^([01]\d|2[0-3]):[0-5]\d$') then raise exception 'Enter the start time as HH:MM' using errcode='22023';end if;
 if finished is not null and jsonb_typeof(finished)<>'null' and (jsonb_typeof(finished)<>'string' or finished#>>'{}'!~'^([01]\d|2[0-3]):[0-5]\d$') then raise exception 'Enter the finish time as HH:MM' using errcode='22023';end if;
 if jsonb_typeof(started)='string' and jsonb_typeof(finished)='string' then
  minutes:=((extract(epoch from (finished#>>'{}')::time)-extract(epoch from (started#>>'{}')::time))/60)::integer;
  if minutes<=0 then minutes:=minutes+1440;end if;
  if minutes=1440 or minutes>720 then raise exception 'The finish time must be after the start time, at most 12 hours later' using errcode='22023';end if;
 end if;
end $fn$;

-- 4. "Please redo: 110 Hawk by 15:00 — <note>".
create or replace function private.workspace_clean_redo_line(target uuid,redo_at timestamptz,note text) returns text language sql stable security definer set search_path='' as $fn$
 select 'Please redo: '||coalesce((select nullif(btrim(p.name),'') from public.workspace_work_items w join public.workspace_properties p on p.id=w.property_id where w.id=target),'A property')
  ||' by '||case when (redo_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date then to_char(redo_at at time zone 'Europe/London','HH24:MI')
   else to_char(redo_at at time zone 'Europe/London','Dy FMDD Mon HH24:MI') end
  ||coalesce(' — '||nullif(btrim(note),''),'')
$fn$;

-- 5. Rate history.
create table if not exists private.workspace_cleaner_rate_history (
 id bigint generated always as identity primary key,
 cleaner_id uuid not null references public.workspace_profiles(user_id),
 old_rate_minor integer,
 new_rate_minor integer not null,
 changed_by uuid not null references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now()
);
create index if not exists workspace_cleaner_rate_history_cleaner_idx on private.workspace_cleaner_rate_history(cleaner_id,changed_at desc);
alter table private.workspace_cleaner_rate_history enable row level security;
revoke all on private.workspace_cleaner_rate_history from public,anon,authenticated;
create or replace function private.workspace_cleaner_rate_logged() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='INSERT' or old.rate_minor is distinct from new.rate_minor then
  insert into private.workspace_cleaner_rate_history(cleaner_id,old_rate_minor,new_rate_minor,changed_by)
  values(new.cleaner_id,case when tg_op='UPDATE' then old.rate_minor end,new.rate_minor,new.updated_by);
 end if;
 return null;
end $fn$;
create or replace trigger cleaner_rate_history after insert or update on private.workspace_cleaner_rates
 for each row execute function private.workspace_cleaner_rate_logged();

-- Patches --------------------------------------------------------------------------------------------------------
do $patch$
declare
 fixes text[][] := array[
  -- 1. The sync keeps each stay's times (a blank in Hostaway never wipes a time already there).
  ['private.workspace_hostaway_sync(jsonb)',
   $q$touched:=touched||res.property_id;$q$,
   $q$touched:=touched||res.property_id;
   -- Cleaner flow (20261021500000): the stay's check-in and checkout times, for the clean's notices and schedule.
   if private.workspace_clock(r->>'checkInTime') is not null or private.workspace_clock(r->>'checkOutTime') is not null then
    update private.workspace_reservations set check_in_time=coalesce(private.workspace_clock(r->>'checkInTime'),check_in_time),check_out_time=coalesce(private.workspace_clock(r->>'checkOutTime'),check_out_time)
     where id=res.id and (check_in_time,check_out_time) is distinct from (coalesce(private.workspace_clock(r->>'checkInTime'),check_in_time),coalesce(private.workspace_clock(r->>'checkOutTime'),check_out_time));
   end if;$q$,
   $q$Cleaner flow (20261021500000): the stay's check-in and checkout times$q$],
  -- 1. The cleaners' schedule read returns the times.
  ['private.workspace_clean_guests(date,date,uuid,uuid)',
   $q$'nextArrivalOn',n.check_in,'nextArrivalGuests',n.guests)$q$,
   $q$'nextArrivalOn',n.check_in,'nextArrivalGuests',n.guests)||(private.workspace_clean_times(c.id)-'nextArrivalOn')$q$,
   $q$||(private.workspace_clean_times(c.id)-'nextArrivalOn')$q$],
  -- 2c. No generic "Update in Recharge" to the assignee of a clean.
  ['private.workspace_record_activity()',
   $q$if recipient is not null and recipient is distinct from auth.uid() then$q$,
   $q$if recipient is not null and recipient is distinct from auth.uid()
    -- Cleaner flow (20261021500000): a clean's assignee hears through cleaning.* notices instead.
    and not (tg_table_name='workspace_work_items' and exists(select 1 from private.workspace_domain_details x where x.work_id=target_work and x.kind='cleaning')) then$q$,
   $q$Cleaner flow (20261021500000): a clean's assignee hears$q$],
  -- 3. Start and finish times on the form.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote','mailPhotoIds','condition']);$q$,
   $q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote','mailPhotoIds','condition','startedAt','finishedAt']);
    perform private.workspace_clean_hours_check(data->'startedAt',data->'finishedAt');
    data:=jsonb_build_object('startedAt',null,'finishedAt',null)||data;$q$,
   $q$'condition','startedAt','finishedAt']$q$],
  -- 4. Review: redoBy allowed.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_json_keys(data,array['accepted','guestFeedback','reviewNote']);$q$,
   $q$perform private.workspace_json_keys(data,array['accepted','guestFeedback','reviewNote','redoBy']);$q$,
   $q$array['accepted','guestFeedback','reviewNote','redoBy']$q$],
  -- 4. Guest feedback only to reject; a rejection needs a redo time.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_required_text(data,'guestFeedback',5,2000);$q$,
   $q$-- Cleaner flow (20261021500000): guest feedback is needed to reject; a rejection says when to redo the clean.
    if not (data->>'accepted')::boolean or (data ? 'guestFeedback' and jsonb_typeof(data->'guestFeedback')<>'null') then perform private.workspace_required_text(data,'guestFeedback',5,2000);end if;
    declare redo_at timestamptz; begin
     if (data->>'accepted')::boolean then
      if data ? 'redoBy' and jsonb_typeof(data->'redoBy')<>'null' then raise exception 'A redo time is only for a clean that is not accepted' using errcode='22023';end if;
      data:=data||jsonb_build_object('redoBy',null);
     else
      if jsonb_typeof(data->'redoBy') is distinct from 'string' or data->>'redoBy'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then raise exception 'Choose when the clean must be redone by' using errcode='22023';end if;
      begin redo_at:=(data->>'redoBy')::timestamptz; exception when others then raise exception 'Choose when the clean must be redone by' using errcode='22023'; end;
      if redo_at<=now() or redo_at>now()+interval '7 days' then raise exception 'Choose a redo time in the next seven days' using errcode='22023';end if;
      data:=data||jsonb_build_object('redoBy',to_char(redo_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
     end if;
    end;$q$,
   $q$Cleaner flow (20261021500000): guest feedback is needed to reject$q$],
  ['private.workspace_operations_action(jsonb)',
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');$q$,
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,coalesce(data->>'guestFeedback',''),data->>'reviewNote');$q$,
   $q$(data->>'accepted')::boolean,coalesce(data->>'guestFeedback',''),data->>'reviewNote');$q$],
  -- 4. The cleaner hears "Please redo ... by ..." on a rejection.
  ['private.workspace_operations_action(jsonb)',
   $q$insert into private.workspace_notification_outbox(user_id,work_id,event_id) select w.assignee_id,target,event_id where w.assignee_id is not null and w.assignee_id is distinct from auth.uid() on conflict do nothing;$q$,
   $q$if (data->>'accepted')::boolean then
     insert into private.workspace_notification_outbox(user_id,work_id,event_id) select w.assignee_id,target,event_id where w.assignee_id is not null and w.assignee_id is distinct from auth.uid() on conflict do nothing;
    elsif w.assignee_id is not null and w.assignee_id is distinct from auth.uid() then
     -- Cleaner flow (20261021500000): the redo notice replaces the rejection notice to the cleaner.
     perform private.workspace_clean_notify(w.assignee_id,target,prop,'cleaning.redo',private.workspace_clean_redo_line(target,(data->>'redoBy')::timestamptz,data->>'reviewNote'),true);
    end if;$q$,
   $q$Cleaner flow (20261021500000): the redo notice replaces$q$],
  -- 5. Only admins and Accounts set a cleaner's rate.
  ['private.workspace_cleaner_rate_action(jsonb)',
   $q$if not private.workspace_manages_cleaner(cleaner) then raise exception 'Only admins and the cleaner''s cleaning manager can set their rate' using errcode='42501';end if;$q$,
   $q$-- Cleaner flow (20261021500000): rates are set by admins and Accounts only.
 if not (actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('cleans-invoices'))) then raise exception 'Only admins and Accounts can set a cleaner''s rate' using errcode='42501';end if;
 if not exists(select 1 from public.workspace_profiles c where c.user_id=cleaner and c.role='cleans') then raise exception 'Only cleaners have a rate per clean' using errcode='22023';end if;$q$,
   $q$Cleaner flow (20261021500000): rates are set by admins and Accounts only$q$],
  -- 5. New cleaners no longer get the Clean invoices tool.
  ['private.workspace_role_tools(text)',
   $q$when 'cleans' then array['cleaning-schedule','cleaner-performance','cleans-invoices']$q$,
   $q$when 'cleans' then array['cleaning-schedule','cleaner-performance']$q$,
   $q$when 'cleans' then array['cleaning-schedule','cleaner-performance']$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)>0 then continue;end if;
  found_count:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
  if found_count<>1 then raise exception 'Cleaner flow patch %: anchor found % times in %',i,found_count,fixes[i][1];end if;
  execute replace(definition,fixes[i][2],fixes[i][3]);
 end loop;
end $patch$;

-- Who may call what. The helpers and the morning notice are for the database and the backend only.
revoke all on function private.workspace_clean_day(uuid),private.workspace_clean_times(uuid),private.workspace_clean_place(uuid),private.workspace_clean_line(uuid),
 private.workspace_clean_notify(uuid,uuid,uuid,text,text,boolean),private.workspace_clean_change_notices(),private.workspace_clean_morning_item(uuid),
 private.workspace_clean_morning_notices(timestamptz),public.workspace_clean_morning_notices(),private.workspace_clean_hours_check(jsonb,jsonb),
 private.workspace_clean_redo_line(uuid,timestamptz,text),private.workspace_cleaner_rate_logged() from public,anon,authenticated;
grant execute on function private.workspace_clean_morning_notices(timestamptz),public.workspace_clean_morning_notices() to service_role;
