-- Management bonus weighting, round 8 (Lee: Alex sets the KPIs and their numbers in the app, and the system follows).
-- The combined measure (teams_combined, 20261016310000) weighed Guest relations and Client relations 50/50. Admins now set
-- the Guest relations share on the KPI, from 0 to 100%; Client relations gets the rest. Left unset, it is 50.
--   private.workspace_kpis.guest_share   nullable whole percentage, used only by teams_combined (null reads as 50).
--   The value: both teams measured, floor((guest x share + client x (100 - share)) / 100); one team with nothing to
--   measure, the other counts alone; neither, no value. Each part carries its share, for "Guest relations 86% (60%)".
--   Saving: saveKpi takes guestShare (a whole number from 0 to 100, or null) for the combined measure only, and keeps the
--   stored share when an edit leaves it out. Admins only, as every KPI change; the change history records it with the row.
--   Reading: the KPI view returns guestShare (50 when unset) for the combined measure, null for any other.
-- private.workspace_kpi_result is replaced whole (only 20261015100000 defines it; only 20261016310000 patched it, and its
-- patch is carried over). The save action and the view are patched by anchor and append (the anchor stays first, a
-- sentinel stops a second run, a missing or repeated anchor raises). Safe to run twice.

alter table private.workspace_kpis add column if not exists guest_share integer check(guest_share is null or guest_share between 0 and 100);

-- The combined value at a share, from the two parts the measure returns, and each part's share.
create or replace function private.workspace_kpi_weighted(v jsonb,share integer) returns jsonb language sql immutable set search_path='' as $fn$
 with p as (select (select (e->>'value')::int from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) e where e->>'area'='guest_relations' limit 1) g,
   (select (e->>'value')::int from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) e where e->>'area'='client_relations' limit 1) c)
 select v||jsonb_build_object(
  'value',case when p.g is not null and p.c is not null then floor((p.g*share+p.c*(100-share))/100.0)::int else coalesce(p.g,p.c) end,
  'parts',coalesce((select jsonb_agg(e||jsonb_build_object('share',case when e->>'area'='guest_relations' then share else 100-share end) order by o)
   from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) with ordinality x(e,o)),'[]'::jsonb))
 from p;
$fn$;

create or replace function private.workspace_kpi_result(k private.workspace_kpis,v jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 select jsonb_build_object('kpiId',k.id,'value',coalesce(w.r->'value','null'::jsonb),'measured',coalesce((w.r->>'measured')::int,0),'count',coalesce(w.r->'count','null'::jsonb))
  ||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(w.r->>'value')::int)
  ||case when w.r ? 'parts' then jsonb_build_object('parts',w.r->'parts') else '{}'::jsonb end
 from (select case when k.measure='teams_combined' then private.workspace_kpi_weighted(v,coalesce(k.guest_share,50)) else v end r) w;
$fn$;

revoke all on function private.workspace_kpi_weighted(jsonb,integer),private.workspace_kpi_result(private.workspace_kpis,jsonb) from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  -- The share, a variable of the save action.
  ['private.workspace_kpi_action(jsonb)',
   $q$mins integer;target integer;change text;bonus boolean;$q$,
   $q$mins integer;target integer;change text;bonus boolean;share integer;$q$,
   $q$bonus boolean;share integer;$q$],
  -- saveKpi accepts guestShare.
  ['private.workspace_kpi_action(jsonb)',
   $q$'targetPercent','bonusTiers','countsForBonus','placeholder'$q$,
   $q$'targetPercent','bonusTiers','countsForBonus','placeholder','guestShare'$q$,
   $q$'placeholder','guestShare'$q$],
  -- Checked and worked out with the other fields: a whole number from 0 to 100, for the combined measure only; an edit
  -- that leaves it out keeps the stored share.
  ['private.workspace_kpi_action(jsonb)',
   $q$bonus:=coalesce((input->>'countsForBonus')::boolean,false);$q$,
   $q$bonus:=coalesce((input->>'countsForBonus')::boolean,false);
  if input ? 'guestShare' and jsonb_typeof(input->'guestShare')<>'null' and (jsonb_typeof(input->'guestShare')<>'number'
   or case when input->>'guestShare'~'^\d{1,3}$' then (input->>'guestShare')::int>100 else true end) then
   raise exception 'The Guest relations share is a whole percentage from 0 to 100' using errcode='22023';
  end if;
  if input->>'measure'<>'teams_combined' and input ? 'guestShare' and jsonb_typeof(input->'guestShare')<>'null' then
   raise exception 'Only the combined measure takes a Guest relations share' using errcode='22023';
  end if;
  share:=case when input->>'measure'<>'teams_combined' then null when input ? 'guestShare' then (input->>'guestShare')::int
   when old.measure='teams_combined' then old.guest_share end;$q$,
   $q$share:=case when input->>'measure'<>'teams_combined' then null$q$],
  -- Stored with the new KPI and with an edit, before the change history row is written from k.
  ['private.workspace_kpi_action(jsonb)',
   $q$change:='created';$q$,
   $q$change:='created';
   update private.workspace_kpis set guest_share=share where id=k.id returning * into k;$q$,
   $q$change:='created';
   update private.workspace_kpis set guest_share=share$q$],
  ['private.workspace_kpi_action(jsonb)',
   $q$change:='edited';$q$,
   $q$change:='edited';
   update private.workspace_kpis set guest_share=share where id=k.id returning * into k;$q$,
   $q$change:='edited';
   update private.workspace_kpis set guest_share=share$q$],
  -- The view: the share for the combined measure (50 when unset), null for any other.
  ['private.workspace_kpi_view(private.workspace_kpis,boolean)',
   $q$'version',k.version,'updatedAt',k.updated_at)$q$,
   $q$'version',k.version,'updatedAt',k.updated_at)||jsonb_build_object('guestShare',case when k.measure='teams_combined' then coalesce(k.guest_share,50) end)$q$,
   $q$jsonb_build_object('guestShare'$q$]
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
