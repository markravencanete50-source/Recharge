-- Management bonus, round 6 (Alex: "Managers bonus will be based off of how guest relations and client relations perform").
-- The KPI tracker (20261015100000) seeded the management bonus KPI on the manager's own performance score. From here a
-- new measure, teams_combined, measures the two teams together over the same period:
--   Guest relations   team-wide share of guest messages answered within the green minutes of
--                     private.workspace_performance_targets (5 on the live database), out of the waits settled for those
--                     minutes: every guest message, whoever was on shift (the same sums as the guest reply KPIs).
--   Client relations  team-wide daily work: the average daily-work percentage of the client relations team (the people
--                     whose KPI area is client_relations), as the team value of daily_work_done already works it out.
--   Combined          the average of the two, equal weight for now (Alex to confirm). When one team has nothing to measure
--                     the other is used alone; when neither has, there is no value ("Nothing to measure yet"). Rounded
--                     down, like every "higher is better" KPI.
-- The result also carries the two parts, so the bar can show "Guest relations 86% · Client relations 74%".
--
-- Who gets it: the figures are worked out only for admins and super admins, and for people whose KPI area is management
-- (their rota department). The KPI read already keeps a KPI's values to people in its area, and to admins; the measure
-- checks again itself, so nobody else (owners, cleaners, Ready, guest or client relations) gets a team figure through it.
-- The parts are team totals: no names and no per-person figures.
--
-- 1. private.workspace_kpi_measures() is replaced whole (only 20261015100000 defines it) with the new measure at the end;
--    it fits the management area only.
-- 2. private.workspace_kpi_teams_combined(start_on,end_on): the measure itself.
-- 3. Anchor-and-append patches (the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
--    raises): a branch in private.workspace_kpi_person_value and in private.workspace_kpi_team_value, and
--    private.workspace_kpi_result passes the parts through.
-- 4. The seeded management bonus KPI ("Performance score", seed_key management_score) moves to the new measure and is
--    named "Guest relations and Client relations, combined", if it is still on the performance score. Its target, tiers
--    and placeholder flag stay as they are (80, 90, 95, placeholder, unless an admin has changed them). The change is
--    logged like any other. A second run finds it already moved and does nothing.

create or replace function private.workspace_kpi_measures() returns jsonb language sql immutable set search_path='' as $fn$
 select '[
  {"key":"guest_reply_within","label":"Guest messages answered within the minutes set","needsMinutes":true,"direction":"higher","areas":["guest_relations"]},
  {"key":"guest_reply_over","label":"Guest messages waiting longer than the minutes set","needsMinutes":true,"direction":"lower","areas":["guest_relations"]},
  {"key":"daily_work_done","label":"Daily work done against its targets","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations"]},
  {"key":"performance_score","label":"Performance score","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations","cleaning","ready","accounts","management"]},
  {"key":"clean_forms_on_time","label":"Cleaning forms in by 18:00 on the day","needsMinutes":false,"direction":"higher","areas":["cleaning"]},
  {"key":"teams_combined","label":"Guest relations and Client relations, combined","needsMinutes":false,"direction":"higher","areas":["management"]}
 ]'::jsonb;
$fn$;

create or replace function private.workspace_kpi_teams_combined(start_on date,end_on date) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();my_area text;t private.workspace_performance_targets;replies jsonb;guest jsonb;client jsonb;g integer;c integer;
begin
 my_area:=(select private.workspace_kpi_area(p.role,r.department) from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=auth.uid());
 if actor is null or actor='client' or not coalesce(actor in ('admin','super_admin') or my_area='management',false) then return jsonb_build_object('value',null,'measured',0);end if;
 t:=(select x from private.workspace_performance_targets x where singleton);
 replies:=coalesce((select jsonb_agg(jsonb_build_object('m',x.minutes,'a',x.answered))
  from private.workspace_kpi_reply_rows(start_on::timestamp at time zone 'Europe/London',(end_on+1)::timestamp at time zone 'Europe/London') x),'[]'::jsonb);
 guest:=private.workspace_kpi_reply_value('guest_reply_within',t.green_minutes,replies);
 client:=(select jsonb_build_object('value',floor(avg((w->>'workPercent')::numeric))::int,'measured',count(*) filter(where w->>'workPercent' is not null))
  from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id
  cross join lateral (select private.workspace_daily_work(p.user_id,start_on,end_on) w) d
  where p.status='active' and p.role<>'client' and private.workspace_kpi_area(p.role,r.department)='client_relations');
 g:=(guest->>'value')::int;c:=(client->>'value')::int;
 return jsonb_build_object(
  'value',case when g is not null and c is not null then floor((g+c)/2.0)::int else coalesce(g,c) end,
  'measured',coalesce((guest->>'measured')::int,0)+coalesce((client->>'measured')::int,0),
  'parts',jsonb_build_array(
   jsonb_build_object('area','guest_relations','value',g,'measured',coalesce((guest->>'measured')::int,0)),
   jsonb_build_object('area','client_relations','value',c,'measured',coalesce((client->>'measured')::int,0))));
end $fn$;

revoke all on function private.workspace_kpi_measures(),private.workspace_kpi_teams_combined(date,date) from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_kpi_person_value(text,integer,uuid,date,date,jsonb)',
   $q$return private.workspace_kpi_clean_forms(array[target],start_on,end_on);$q$,
   $q$return private.workspace_kpi_clean_forms(array[target],start_on,end_on);
 elsif measure='teams_combined' then
  return private.workspace_kpi_teams_combined(start_on,end_on);$q$,
   $q$return private.workspace_kpi_teams_combined(start_on,end_on);$q$],
  ['private.workspace_kpi_team_value(text,integer,uuid[],date,date,jsonb)',
   $q$return private.workspace_kpi_clean_forms(members,start_on,end_on);$q$,
   $q$return private.workspace_kpi_clean_forms(members,start_on,end_on);
 elsif measure='teams_combined' then
  return private.workspace_kpi_teams_combined(start_on,end_on);$q$,
   $q$return private.workspace_kpi_teams_combined(start_on,end_on);$q$],
  ['private.workspace_kpi_result(private.workspace_kpis,jsonb)',
   $q$||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(v->>'value')::int)$q$,
   $q$||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(v->>'value')::int)
  ||case when v ? 'parts' then jsonb_build_object('parts',v->'parts') else '{}'::jsonb end$q$,
   $q$jsonb_build_object('parts',v->'parts')$q$]
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

-- 4. The seeded management bonus KPI moves to the new measure, logged as an edit by nobody (like the seed).
with old as (select * from private.workspace_kpis where seed_key='management_score' and measure='performance_score' for update),
moved as (
 update private.workspace_kpis k set measure='teams_combined',direction='higher',minutes=null,
  name=case when k.name='Performance score' then 'Guest relations and Client relations, combined' else k.name end,
  version=k.version+1,updated_at=now()
 from old where k.id=old.id
 returning k.id,to_jsonb(old) before,to_jsonb(k) after)
insert into private.workspace_kpi_changes(kpi_id,change,before,after) select moved.id,'edited',moved.before,moved.after from moved;
