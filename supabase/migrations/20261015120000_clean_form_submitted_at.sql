-- When a cleaning form was sent (lead developer, 13 October 2026). A clean recorded who sent its form (submittedBy) but not
-- when, so "cleaning forms in on time" (the KPI tracker, 20261015100000) could only rely on the sweep's reminder marker.
--
-- 1. private.workspace_operations_action: submitting the cleaning report now also stamps data.submittedAt (UTC, ISO),
--    set by the server. The app sends nothing new. A clean sent back after a review and sent again keeps its first
--    stamp, so a correction does not make a form that was on time late.
-- 2. private.workspace_kpi_clean_forms (replaced whole; only 20261015100000 defines it): a clean with submittedAt is on
--    time when that is at or before 18:00 London on its day (private.workspace_clean_form_due_time()). An older clean
--    without the stamp falls back to the reminder rule: on time when its form is in and the sweep never reminded the
--    cleaner (unsubmittedAt) or warned management (formWarningAt).
--
-- The patch reads the LATEST definition, needs its anchor exactly once and is skipped once applied, so the migration is
-- safe to run twice.

do $patch$
declare
 definition text;n integer;
 anchor constant text:=$q$data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid());next_status:='in_review';$q$;
 replacement constant text:=$q$data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid(),'submittedAt',coalesce(d.data->'submittedAt',to_jsonb(to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));next_status:='in_review';$q$;
 sentinel constant text:=$q$'submittedAt',coalesce(d.data->'submittedAt'$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position(sentinel in definition)=0 then
  n:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if n<>1 then raise exception 'Patch anchor found % times in private.workspace_operations_action(jsonb), expected once',n;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_operations_action(jsonb)';end if;
 end if;
end $patch$;

-- On time: sent by 18:00 London on the clean's day when the stamp is there; otherwise the reminder rule.
create or replace function private.workspace_clean_form_on_time(item jsonb,clean_day date) returns boolean language plpgsql stable set search_path='' as $fn$
begin
 if not private.workspace_clean_form_in(item) then return false;end if;
 if jsonb_typeof(item->'submittedAt')='string' then
  return clean_day is not null and ((item->>'submittedAt')::timestamptz at time zone private.workspace_clean_form_zone())<=(clean_day::timestamp+private.workspace_clean_form_due_time()::time);
 end if;
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
exception when others then
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
end $fn$;

create or replace function private.workspace_kpi_clean_forms(cleaners uuid[],start_on date,end_on date) returns jsonb language sql stable security definer set search_path='' as $fn$
 with c as (select private.workspace_clean_form_in(d.data) form_in,d.data,private.workspace_clean_form_day(w.due_on,d.data) clean_day
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where d.kind='cleaning' and w.assignee_id=any(cleaners) and w.status not in ('cancelled','declined')),
 s as (select count(*) filter(where c.form_in or private.workspace_clean_form_is_due(c.clean_day,now()) or c.data ? 'unsubmittedAt') settled,
   count(*) filter(where private.workspace_clean_form_on_time(c.data,c.clean_day)) on_time
  from c where c.clean_day between start_on and end_on)
 select jsonb_build_object('measured',s.settled,'count',s.on_time,'value',case when s.settled>0 then floor(s.on_time*100.0/s.settled)::int end) from s;
$fn$;

revoke all on function private.workspace_clean_form_on_time(jsonb,date),private.workspace_kpi_clean_forms(uuid[],date,date) from public,anon,authenticated;
