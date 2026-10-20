-- Shift hours: clipped to the period, and a shift left open stops counting (owner Lee, 20 October 2026).
--
-- Erika clocked in on Thursday 15 October 2026 at 08:39 and never clocked out. Five days later the day view showed her
-- "08:39-now", 123h 50m and "On shift", and the day's HOURS card 147h 49m: a shift counted every minute up to now, all
-- on the day it started. The rule now, the same in every place hours are summed (lib/shift-hours.ts is its twin):
--  * A period counts only the part of a shift inside it, in UK time: a day 00:00 to 24:00, a week, a month, the
--    reporting window, the VA pay month. A shift that crosses midnight shows on both days with each day's part.
--  * A shift with no clock out counts up to now while it is under 16 hours old ("on shift"). Past 16 hours it "did not
--    clock out": it is no longer on shift, and it counts up to 16 hours after the clock in and never more, until a
--    manager corrects it. That is the safer rule for pay: hours past the limit, which may not have been worked, are
--    never paid, and the shift is not lost either. (private.workspace_shift_counted_end, workspace_shift_stale,
--    workspace_shift_counted_minutes, workspace_shift_days.)
--  * The first time a shift goes past the limit, the person and management (admins and super admins) are told once
--    in the app ('team.shift_not_clocked_out', kept in private.workspace_shift_stale_notices). The hourly worker run
--    (private.workspace_va_pay_run) sends these, so no new schedule is needed.
--  * Correcting, adding or ending a shift: each end has its own date and time. Clock out must be after clock in; a
--    shift over 16 hours needs "confirmLong": true ("This shift is over 16 hours. Is that right?"); over 24 hours is
--    refused.
--  * Clocking out of a shift left open past the limit ends it 16 hours after the clock in (where its hours stopped
--    counting), not days later; management has already been told, and corrects it if it was shorter.
--
-- Patched by anchor (latest definition, the anchor must occur exactly once, skipped once the sentinel is there):
--   private.workspace_timesheet_read, private.workspace_productivity_read, private.workspace_shift_read (team
--   performance), private.workspace_business_report (time), private.workspace_va_pay_issue, private.workspace_va_pay_run,
--   private.workspace_shift_change_check, private.workspace_shift_change_action, private.workspace_shift_action (clock out).
-- No DROP, no DELETE. Safe to run twice.

create table if not exists private.workspace_shift_stale_notices (
 shift_id uuid primary key references private.workspace_shifts(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 noticed_at timestamptz not null default now()
);
create index if not exists workspace_shift_stale_notices_user_idx on private.workspace_shift_stale_notices(user_id);
alter table private.workspace_shift_stale_notices enable row level security;
revoke all on private.workspace_shift_stale_notices from public,anon,authenticated,service_role;

-- Where a shift's counted hours stop: its clock out, else now, but never more than 16 hours after the clock in.
create or replace function private.workspace_shift_counted_end(shift_in timestamptz,shift_out timestamptz) returns timestamptz
language sql stable security definer set search_path='' as $fn$
 select coalesce(shift_out,greatest(shift_in,least(now(),shift_in+interval '16 hours')))
$fn$;
-- Open for more than 16 hours: they did not clock out.
create or replace function private.workspace_shift_stale(shift_in timestamptz,shift_out timestamptz) returns boolean
language sql stable security definer set search_path='' as $fn$
 select shift_out is null and now()-shift_in>interval '16 hours'
$fn$;
-- Minutes a shift counts inside a window (null bounds: the whole shift), less its unpaid pauses inside it.
create or replace function private.workspace_shift_counted_minutes(shift uuid,shift_in timestamptz,shift_out timestamptz,lower_at timestamptz default null,upper_at timestamptz default null) returns numeric
language sql stable security definer set search_path='' as $fn$
 select case when w.b<=w.a then 0::numeric else greatest(0,extract(epoch from w.b-w.a)/60-private.workspace_shift_unpaid_minutes(shift,w.a,w.b)) end
 from (select greatest(shift_in,lower_at) a,least(private.workspace_shift_counted_end(shift_in,shift_out),upper_at) b) w
$fn$;
-- The UK days a shift's counted hours touch inside a window.
create or replace function private.workspace_shift_days(shift_in timestamptz,shift_out timestamptz,lower_at timestamptz,upper_at timestamptz) returns setof date
language sql stable security definer set search_path='' as $fn$
 select g::date from (select greatest(shift_in,lower_at) a,least(private.workspace_shift_counted_end(shift_in,shift_out),upper_at) b) w
  cross join lateral generate_series((w.a at time zone 'Europe/London')::date::timestamp,((w.b-interval '1 microsecond') at time zone 'Europe/London')::date::timestamp,interval '1 day') g
 where w.b>w.a
$fn$;

-- Tell the person and management, once per shift, when a shift goes past the limit without a clock out.
create or replace function private.workspace_shift_stale_notify() returns integer language plpgsql security definer set search_path='' as $fn$
declare r record;event_id bigint;told integer:=0;
begin
 for r in select s.id,s.user_id from private.workspace_shifts s
  where s.clocked_out_at is null and private.workspace_shift_stale(s.clocked_in_at,s.clocked_out_at)
   and not exists(select 1 from private.workspace_shift_stale_notices n where n.shift_id=s.id) order by s.clocked_in_at,s.id
 loop
  insert into private.workspace_shift_stale_notices(shift_id,user_id) values(r.id,r.user_id) on conflict do nothing;
  if found then
   insert into public.workspace_activity(actor_id,event_type) values(r.user_id,'team.shift_not_clocked_out') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.status='active' and (p.user_id=r.user_id or p.role in ('admin','super_admin')) on conflict do nothing;
   told:=told+1;
  end if;
 end loop;
 return told;
end $fn$;

revoke all on function private.workspace_shift_counted_end(timestamptz,timestamptz),private.workspace_shift_stale(timestamptz,timestamptz),
 private.workspace_shift_counted_minutes(uuid,timestamptz,timestamptz,timestamptz,timestamptz),private.workspace_shift_days(timestamptz,timestamptz,timestamptz,timestamptz),
 private.workspace_shift_stale_notify() from public,anon,authenticated,service_role;

do $$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  -- The timesheet (also the Productivity Tool's day view and clock-in log): each day a shift touches, with that day's part.
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$'minutes',round((extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id)))::int,$q$,
   $q$'minutes',round(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,x.day::timestamp at time zone 'Europe/London',(x.day+1)::timestamp at time zone 'Europe/London'))::int,
          'shiftMinutes',round(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at))::int,'stale',private.workspace_shift_stale(h.clocked_in_at,h.clocked_out_at),
          'countedUntil',private.workspace_shift_counted_end(h.clocked_in_at,h.clocked_out_at),$q$,
   $q$'shiftMinutes',round(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at))::int$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$(h.clocked_in_at at time zone 'Europe/London')::date=x.day),$q$,
   $q$h.clocked_in_at<(x.day+1)::timestamp at time zone 'Europe/London' and private.workspace_shift_counted_end(h.clocked_in_at,h.clocked_out_at)>x.day::timestamp at time zone 'Europe/London' /* day shifts */),$q$,
   $q$/* day shifts */$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$'minutes',(select coalesce(round(sum((extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id)))),0)::int$q$,
   $q$'minutes',(select coalesce(round(sum(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,x.day::timestamp at time zone 'Europe/London',(x.day+1)::timestamp at time zone 'Europe/London'))),0)::int /* day minutes */$q$,
   $q$/* day minutes */$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$(h.clocked_in_at at time zone 'Europe/London')::date=x.day)) order by x.day)$q$,
   $q$h.clocked_in_at<(x.day+1)::timestamp at time zone 'Europe/London' and private.workspace_shift_counted_end(h.clocked_in_at,h.clocked_out_at)>x.day::timestamp at time zone 'Europe/London' /* day total */)) order by x.day)$q$,
   $q$/* day total */$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$select (h.clocked_in_at at time zone 'Europe/London')::date as day from private.workspace_shifts h where h.user_id=p.user_id and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at$q$,
   $q$select g.d as day from private.workspace_shifts h cross join lateral private.workspace_shift_days(h.clocked_in_at,h.clocked_out_at,lower_at,upper_at) g(d) where h.user_id=p.user_id and h.clocked_in_at<upper_at /* days touched */$q$,
   $q$/* days touched */$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$'totalMinutes',(select coalesce(round(sum((extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id)))),0)::int$q$,
   $q$'totalMinutes',(select coalesce(round(sum(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,lower_at,upper_at))),0)::int$q$,
   $q$'totalMinutes',(select coalesce(round(sum(private.workspace_shift_counted_minutes($q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at)) person$q$,
   $q$h.clocked_in_at<upper_at and private.workspace_shift_counted_end(h.clocked_in_at,h.clocked_out_at)>lower_at /* period total */)) person$q$,
   $q$/* period total */$q$],
  -- The Productivity Tool: hours by person, week and month, each day's part of each shift.
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$select h.user_id,(h.clocked_in_at at time zone 'Europe/London')::date as day,extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id) as minutes,$q$,
   $q$select h.user_id,h.id as shift_ref,g.d as day,private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,greatest(lower_at,g.d::timestamp at time zone 'Europe/London'),least(upper_at,(g.d+1)::timestamp at time zone 'Europe/London')) as minutes,$q$,
   $q$h.id as shift_ref$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$coalesce(extract(epoch from coalesce(h.clocked_out_at,now())-h.overtime_from)/60,0) as overtime$q$,
   $q$case when h.overtime_from is null then 0 else greatest(0,extract(epoch from least(private.workspace_shift_counted_end(h.clocked_in_at,h.clocked_out_at),upper_at,(g.d+1)::timestamp at time zone 'Europe/London')
    -greatest(h.overtime_from,lower_at,g.d::timestamp at time zone 'Europe/London'))/60) end as overtime$q$,
   $q$case when h.overtime_from is null then 0 else greatest(0,$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$from private.workspace_shifts h where h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at and (admin$q$,
   $q$from private.workspace_shifts h cross join lateral private.workspace_shift_days(h.clocked_in_at,h.clocked_out_at,lower_at,upper_at) g(d) where h.clocked_in_at<upper_at and (admin$q$,
   $q$private.workspace_shift_days(h.clocked_in_at,h.clocked_out_at,lower_at,upper_at) g(d) where h.clocked_in_at<upper_at and (admin$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$'shifts',(select count(*)::int from hours h where h.user_id=f.user_id),$q$,
   $q$'shifts',(select count(distinct h.shift_ref)::int from hours h where h.user_id=f.user_id),$q$,
   $q$'shifts',(select count(distinct h.shift_ref)::int$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$count(*)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) w)$q$,
   $q$count(distinct h.shift_ref)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) w)$q$,
   $q$count(distinct h.shift_ref)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) w)$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$count(*)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) m)$q$,
   $q$count(distinct h.shift_ref)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) m)$q$,
   $q$count(distinct h.shift_ref)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) m)$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$'onShift',exists(select 1 from private.workspace_shifts h where h.user_id=f.user_id and h.clocked_out_at is null),$q$,
   $q$'onShift',exists(select 1 from private.workspace_shifts h where h.user_id=f.user_id and h.clocked_out_at is null and not private.workspace_shift_stale(h.clocked_in_at,h.clocked_out_at)),
   'notClockedOutSince',(select min(h.clocked_in_at) from private.workspace_shifts h where h.user_id=f.user_id and h.clocked_out_at is null and private.workspace_shift_stale(h.clocked_in_at,h.clocked_out_at)),$q$,
   $q$'notClockedOutSince'$q$],
  -- Team performance: the period's part of each shift, a shift left open counting up to the limit.
  ['private.workspace_shift_read(text,date,date)',
   $q$sum(extract(epoch from least(coalesce(s.clocked_out_at,now()),upper_at)-greatest(s.clocked_in_at,lower_at))/60-private.workspace_shift_unpaid_minutes(s.id,lower_at,upper_at))$q$,
   $q$sum(private.workspace_shift_counted_minutes(s.id,s.clocked_in_at,s.clocked_out_at,lower_at,upper_at))$q$,
   $q$sum(private.workspace_shift_counted_minutes(s.id,s.clocked_in_at,s.clocked_out_at,lower_at,upper_at))$q$],
  -- Reports > Time: the window's part of each shift.
  ['private.workspace_business_report(text,date,date)',
   $q$select s.user_id,s.department,(s.clocked_in_at at time zone 'Europe/London')::date d,$q$,
   $q$select s.user_id,s.department,(greatest(s.clocked_in_at,lower_at) at time zone 'Europe/London')::date d,$q$,
   $q$(greatest(s.clocked_in_at,lower_at) at time zone 'Europe/London')::date d,$q$],
  ['private.workspace_business_report(text,date,date)',
   $q$extract(epoch from coalesce(s.clocked_out_at,now())-s.clocked_in_at)/60 total,private.workspace_shift_unpaid_minutes(s.id) unpaid,$q$,
   $q$greatest(0,extract(epoch from least(private.workspace_shift_counted_end(s.clocked_in_at,s.clocked_out_at),upper_at)-greatest(s.clocked_in_at,lower_at))/60) total,
    private.workspace_shift_unpaid_minutes(s.id,greatest(s.clocked_in_at,lower_at),least(private.workspace_shift_counted_end(s.clocked_in_at,s.clocked_out_at),upper_at)) unpaid,$q$,
   $q$least(private.workspace_shift_counted_end(s.clocked_in_at,s.clocked_out_at),upper_at)) unpaid,$q$],
  ['private.workspace_business_report(text,date,date)',
   $q$coalesce(extract(epoch from coalesce(s.clocked_out_at,now())-s.overtime_from)/60,0) overtime,s.clocked_out_at is null running$q$,
   $q$case when s.overtime_from is null then 0 else greatest(0,extract(epoch from least(private.workspace_shift_counted_end(s.clocked_in_at,s.clocked_out_at),upper_at)-greatest(s.overtime_from,lower_at))/60) end overtime,
    s.clocked_out_at is null and not private.workspace_shift_stale(s.clocked_in_at,s.clocked_out_at) running$q$,
   $q$s.clocked_out_at is null and not private.workspace_shift_stale(s.clocked_in_at,s.clocked_out_at) running$q$],
  ['private.workspace_business_report(text,date,date)',
   $q$from private.workspace_shifts s where s.clocked_in_at>=lower_at and s.clocked_in_at<upper_at$q$,
   $q$from private.workspace_shifts s where s.clocked_in_at<upper_at and private.workspace_shift_counted_end(s.clocked_in_at,s.clocked_out_at)>lower_at$q$,
   $q$from private.workspace_shifts s where s.clocked_in_at<upper_at and private.workspace_shift_counted_end($q$],
  -- VA pay: the month's part of each shift, by UK day; a shift left open counts up to the limit (it used to be left out).
  ['private.workspace_va_pay_issue(uuid,date,date,timestamptz,jsonb,uuid)',
   $q$from (select (h.clocked_in_at at time zone 'Europe/London')::date as day,$q$,
   $q$from (select g.d as day,$q$,
   $q$from (select g.d as day,$q$],
  ['private.workspace_va_pay_issue(uuid,date,date,timestamptz,jsonb,uuid)',
   $q$round(sum(extract(epoch from h.clocked_out_at-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id)))::int minutes$q$,
   $q$round(sum(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,greatest(lower_at,g.d::timestamp at time zone 'Europe/London'),least(upper_at,(g.d+1)::timestamp at time zone 'Europe/London'))))::int minutes$q$,
   $q$round(sum(private.workspace_shift_counted_minutes(h.id,h.clocked_in_at,h.clocked_out_at,greatest(lower_at,g.d::timestamp$q$],
  ['private.workspace_va_pay_issue(uuid,date,date,timestamptz,jsonb,uuid)',
   $q$from private.workspace_shifts h where h.user_id=va and h.clocked_out_at is not null and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at$q$,
   $q$from private.workspace_shifts h cross join lateral private.workspace_shift_days(h.clocked_in_at,h.clocked_out_at,lower_at,upper_at) g(d) where h.user_id=va and h.clocked_in_at<upper_at$q$,
   $q$private.workspace_shift_days(h.clocked_in_at,h.clocked_out_at,lower_at,upper_at) g(d) where h.user_id=va$q$],
  -- The hourly run also tells people about shifts left open past the limit.
  ['private.workspace_va_pay_run(timestamptz)',
   $q$perform pg_advisory_xact_lock(hashtextextended('workspace_va_pay_run',0));$q$,
   $q$perform pg_advisory_xact_lock(hashtextextended('workspace_va_pay_run',0));
 perform private.workspace_shift_stale_notify();$q$,
   $q$perform private.workspace_shift_stale_notify();$q$],
  -- Correcting or adding a shift: clear reasons, and over 16 hours only with an explicit yes.
  ['private.workspace_shift_change_check(uuid,uuid,timestamptz,timestamptz,text)',
   $q$if starts>now() or ends>now() or ends<=starts or (coalesce(ends,now())-starts)>interval '24 hours' then raise exception 'A shift starts and ends in the past and lasts at most 24 hours' using errcode='22023';end if;$q$,
   $q$if ends<=starts then raise exception 'Clock out must be after clock in' using errcode='22023';end if;
 if starts>now() or ends>now() then raise exception 'A shift starts and ends in the past' using errcode='22023';end if;
 if (coalesce(ends,now())-starts)>interval '24 hours' then raise exception 'A shift lasts at most 24 hours' using errcode='22023';end if;$q$,
   $q$'Clock out must be after clock in'$q$],
  ['private.workspace_shift_change_action(jsonb)',
   $q$array['action','requestId','shiftId','clockedInAt','clockedOutAt','department','note']$q$,
   $q$array['action','requestId','shiftId','clockedInAt','clockedOutAt','department','note','confirmLong']$q$,
   $q$array['action','requestId','shiftId','clockedInAt','clockedOutAt','department','note','confirmLong']$q$],
  ['private.workspace_shift_change_action(jsonb)',
   $q$array['action','requestId','userId','clockedInAt','clockedOutAt','department','note']$q$,
   $q$array['action','requestId','userId','clockedInAt','clockedOutAt','department','note','confirmLong']$q$,
   $q$array['action','requestId','userId','clockedInAt','clockedOutAt','department','note','confirmLong']$q$],
  ['private.workspace_shift_change_action(jsonb)',
   $q$perform private.workspace_shift_change_check(who,s.id,starts,ends,dept);$q$,
   $q$if a in ('editShift','addShift','closeShift') and ends>starts and ends-starts>interval '16 hours' and ends-starts<=interval '24 hours'
   and (input->'confirmLong') is distinct from 'true'::jsonb then raise exception 'This shift is over 16 hours. Is that right?' using errcode='22023';end if;
  perform private.workspace_shift_change_check(who,s.id,starts,ends,dept);$q$,
   $q$'This shift is over 16 hours. Is that right?'$q$],
  ['private.workspace_shift_change_action(jsonb)',
   $q$array['action','requestId','shiftId','endedAt','note']$q$,
   $q$array['action','requestId','shiftId','endedAt','note','confirmLong']$q$,
   $q$array['action','requestId','shiftId','endedAt','note','confirmLong']$q$],
  -- Clocking out of a shift left open past the limit ends it where its hours stopped counting (16 hours after the
  -- clock in), never days later; management has been told and corrects it if it was shorter.
  ['private.workspace_shift_action(jsonb)',
   $q$update private.workspace_shifts set clocked_out_at=now() where user_id=auth.uid() and clocked_out_at is null returning * into s;$q$,
   $q$perform private.workspace_shift_stale_notify();
  update private.workspace_shifts set clocked_out_at=private.workspace_shift_counted_end(clocked_in_at,null) /* stale clock out */ where user_id=auth.uid() and clocked_out_at is null returning * into s;$q$,
   $q$/* stale clock out */$q$]
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
end $$;
