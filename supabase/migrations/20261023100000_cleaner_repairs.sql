-- Cleaners report repairs themselves (Alex: "cleaners add maintenance directly themselves rather than having relations
-- need to do it"). Until now a cleaner wrote "Repairs or replacements needed" on the clean form and the team then pressed
-- "Raise reactive maintenance" to make the repair. A cleaner could also press "Report a problem" on a clean they were
-- doing (step reportCleanProblem, 20261009180000), which made a repair with a fixed phase and no way for the cleaner to
-- follow it. The app now sends what is broken through reportCleanProblem from the clean form itself, and:
--  * Where and which properties: from a clean the cleaner is assigned to and that is still open (to do, or waiting for
--    review), as before. updateOperation lets a cleaner act only on their own clean at a property they are linked to as
--    a cleaner (private.workspace_operation_access), so a cleaner can never report a repair at a property that is not
--    theirs. The photos stay as before: up to 10, uploaded to the clean (purpose 'maintenance'), moved to the repair.
--  * Fields: what is wrong (5 to 3000 characters), the kind of problem, urgent, and now hazard (optional boolean, "This
--    is a safety hazard"). A hazard is always urgent, as on the team's own form.
--  * The same repair, the same flow: the repair is made exactly as before (module stays-maintenance-reporting, title
--    "Property repair request", client_visible, estimate 0) and its first phase now comes from
--    private.workspace_repair_route, the route createOperation uses for a repair the team reports. With no estimate that
--    is triage, so Stays refer it to a contractor, the contractor's estimate goes to management's review, then the
--    owner's limit (the 100 pound company limit, Limit Changer, the owner's choice at Proceed) decides whether the owner
--    is asked, exactly as for a repair the team reported. The handover tells Stays on the property (with the repairs
--    tool) and every admin and super admin; the clean's own notice routes are unchanged. Should the route ever send a
--    new repair to management first, management are told as for createOperation.
--  * Who and when: the repair keeps reportedBy and reportedFromClean, and now carries raisedBy {role 'cleans', userId,
--    name, at, cleanWorkId} so the team see who raised it and when. Owners never get raisedBy (the owner filter drops
--    every key ending in By) and contractors (Ready) never get it either (stripped in private.workspace_operation_view,
--    the read every repair list and detail goes through).
--  * The cleaner's list: workspace_cleaner_repairs() (cleaners only; everyone else is refused) gives the repairs this
--    cleaner raised, at properties they are still linked to as a cleaner: open ones, and closed ones from the last 60
--    days, at most 100. Each row has only what the cleaner already said (issue, kind, urgent, hazard), the property, when
--    it was reported, the clean it came from, a plain status (reported, approval, on_hold, contractor, booked, fixed,
--    closed) and the visit day while a visit is booked. Never a cost, an estimate or quote, an approval amount or note,
--    owner details or the contractor.
--  * Nothing changes for owners, contractors, guests or any other role. Repairs reported before this keep working.
-- New: private.workspace_cleaner_repair_entry(uuid,uuid,jsonb,jsonb) (internal, no grants),
--   private.workspace_cleaner_repairs() and its public wrapper public.workspace_cleaner_repairs() (authenticated only).
-- Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present):
--   private.workspace_operations_action(jsonb) (reportCleanProblem: hazard, raisedBy and the route; three patches),
--   private.workspace_operation_view(uuid) (Ready never get raisedBy).
-- The receipt (requestId), the per-user write limit and the activity row are the ones updateOperation already has.
-- No DROP, no DELETE. Safe to run twice.

-- 1. The repair a cleaner reports: hazard, who raised it and when, and the first phase from the team's own route.
create or replace function private.workspace_cleaner_repair_entry(prop uuid, clean uuid, entry jsonb, input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare hazard boolean;
begin
 if input ? 'hazard' and jsonb_typeof(input->'hazard') is distinct from 'boolean' then raise exception 'Say whether it is a safety hazard' using errcode='22023';end if;
 hazard:=coalesce((input->>'hazard')::boolean,false);
 entry:=entry||jsonb_build_object('hazard',hazard,'urgent',coalesce((entry->>'urgent')::boolean,false) or hazard,
  'raisedBy',jsonb_build_object('role','cleans','userId',auth.uid(),'name',coalesce((select nullif(trim(p.full_name),'') from public.workspace_profiles p where p.user_id=auth.uid()),'Cleaner'),
   'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cleanWorkId',clean));
 -- The route a repair the team reports takes (createOperation): with no estimate it starts in triage.
 return entry||private.workspace_repair_route(prop,coalesce((entry->>'estimatedCostMinor')::bigint,0),entry,'triage');
end $fn$;
revoke all on function private.workspace_cleaner_repair_entry(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

-- 2. The repairs a cleaner raised, with a plain status and nothing about money, the owner or the contractor.
create or replace function private.workspace_cleaner_repairs() returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is distinct from 'cleans' then raise exception 'Only cleaners have a list of the repairs they reported' using errcode='42501';end if;
 return coalesce((select jsonb_agg(x.item order by x.open desc,x.created_at desc,x.id) from (
  select w.id,w.created_at,w.status not in ('completed','cancelled') open,jsonb_build_object(
   'workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'issue',coalesce(d.data->>'issue',w.title),
   'repairType',coalesce(d.data->>'repairType','other'),'urgent',coalesce((d.data->>'urgent')::boolean,false),'hazard',coalesce((d.data->>'hazard')::boolean,false),
   'status',case when w.status='cancelled' or d.data->>'phase'='closed' then 'closed'
    when w.status='completed' or d.data->>'phase' in ('completed','resolved') then 'fixed'
    when d.data->>'phase' in ('team_review','owner_approval','management_approval') then 'approval'
    when d.data->>'phase' in ('owner_declined','management_declined') then 'on_hold'
    when d.data->>'phase'='referred' then 'contractor'
    when d.data->>'phase'='booked' then 'booked'
    else 'reported' end,
   'visitOn',case when d.data->>'phase'='booked' and w.status not in ('completed','cancelled') then w.due_on end,
   'reportedAt',coalesce(d.data->'raisedBy'->>'at',to_char(w.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
   'cleanWorkId',coalesce(d.data->'raisedBy'->>'cleanWorkId',d.data->>'reportedFromClean')) item
  from public.workspace_work_items w
  join private.workspace_domain_details d on d.work_id=w.id and d.kind='maintenance'
  join public.workspace_properties p on p.id=w.property_id
  where d.data->>'reportedBy'=auth.uid()::text and (d.data->'raisedBy'->>'role'='cleans' or d.data ? 'reportedFromClean')
   and private.workspace_can_property(w.property_id,'cleaning-schedule')
   and (w.status not in ('completed','cancelled') or w.updated_at>now()-interval '60 days')
  order by w.created_at desc,w.id limit 100) x),'[]'::jsonb);
end $fn$;
create or replace function public.workspace_cleaner_repairs() returns jsonb
language sql security invoker set search_path='' as $fn$
 select private.workspace_cleaner_repairs();
$fn$;
revoke all on function private.workspace_cleaner_repairs(),public.workspace_cleaner_repairs() from public,anon,authenticated,service_role;
grant execute on function private.workspace_cleaner_repairs(),public.workspace_cleaner_repairs() to authenticated;

-- 3. The patches.
do $patch$
declare
 fixes constant text[][] := array[
  -- reportCleanProblem takes hazard.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_json_keys(data,array['issue','urgent','repairType','photoIds']);$q$,
   $q$perform private.workspace_json_keys(data,array['issue','urgent','repairType','photoIds','hazard']);/* cleaner repairs keys: 20261023100000 */$q$,
   $q$/* cleaner repairs keys: 20261023100000 */$q$],
  -- The repair records who raised it and when, and starts where the team's route puts it.
  ['private.workspace_operations_action(jsonb)',
   $q$'reportedBy',auth.uid(),'reportedFromClean',target);$q$,
   $q$'reportedBy',auth.uid(),'reportedFromClean',target);
    /* cleaner repairs route: 20261023100000 */ entry:=private.workspace_cleaner_repair_entry(prop,target,entry,data);
    if entry->>'phase'='management_approval' then notify_users:=private.workspace_repair_managers();end if;$q$,
   $q$/* cleaner repairs route: 20261023100000 */$q$],
  -- The clean's list of problems says whether each was a safety hazard.
  ['private.workspace_operations_action(jsonb)',
   $q$'photos',coalesce(jsonb_array_length(data->'photoIds'),0),'reportedAt',now())));$q$,
   $q$'photos',coalesce(jsonb_array_length(data->'photoIds'),0),'reportedAt',now(),'hazard',coalesce((entry->>'hazard')::boolean,false)/* cleaner repairs problem: 20261023100000 */)));$q$,
   $q$/* cleaner repairs problem: 20261023100000 */$q$],
  -- Contractors never see who raised a repair.
  ['private.workspace_operation_view(uuid)',
   $q$-'autoApprovalLimitMinor'-'autoApprovalSource' else d.data end$q$,
   $q$-'autoApprovalLimitMinor'-'autoApprovalSource'-'raisedBy'/* cleaner repairs view: 20261023100000 */ else d.data end$q$,
   $q$/* cleaner repairs view: 20261023100000 */$q$]
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
