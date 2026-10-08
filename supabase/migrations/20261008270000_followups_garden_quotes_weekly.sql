-- Follow-ups that need no outside service:
-- 1. An owner who says the property has a garden gets a monthly garden-and-bins routine for Ready,
--    alongside the one-off set-up task.
-- 2. Ready (or Stays) can update a repair's quote. A quote above the owner's approval limit goes
--    back to the owner, and once approved the repair carries on from where it was.
-- 3. Owners get an in-app notice each Monday that their weekly property report is ready.
-- 4. Notifications sent by email or push carry their update type, so each gets its own wording.

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$   if (fields->>'hasGarden')::boolean then perform private.workspace_handover(target,'routine-bin-garden-board','Arrange regular garden maintenance','garden_setup','{}'); end if;$q$,
   $q$   if (fields->>'hasGarden')::boolean then perform private.workspace_handover(target,'routine-bin-garden-board','Arrange regular garden maintenance','garden_setup','{}');
    if not exists(select 1 from private.workspace_routine_plans where property_id=target and module_id='routine-bin-garden-board' and active) then
     insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,assignee_id,active,starts_on,created_by,request_id)
      values(target,'routine-bin-garden-board','Garden and bins','["Cut the grass and tidy the edges","Weed beds and paths","Clear leaves and litter","Check the bins go out on collection day and come back in","Note anything that needs a repair"]'::jsonb,
       'monthly',1,null,true,date_trunc('month',current_date)::date,auth.uid(),gen_random_uuid());
    end if;
   end if;$q$,
   'Garden and bins'],
  ['private.workspace_operations_action(jsonb)',
   $q$   elsif kind='maintenance' and step='bookRepair' then$q$,
   $q$   elsif kind='maintenance' and step='reviseQuote' then
    perform private.workspace_json_keys(data,array['quoteMinor','reason']);
    if actor not in ('ready','stays','admin','super_admin') or coalesce(d.data->>'phase','') not in ('triage','referred','booked') then raise exception 'Only an open repair can be re-quoted' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reason',5,2000);amount:=private.workspace_money(data,'quoteMinor');
    select * into j from private.workspace_journeys where property_id=prop;
    data:=jsonb_build_object('estimatedCostMinor',amount,'previousEstimateMinor',(d.data->>'estimatedCostMinor')::bigint,'quoteReason',data->>'reason','quoteRevisedAt',now(),'quoteRevisedBy',auth.uid())
     ||case when amount>coalesce((d.data->>'estimatedCostMinor')::bigint,0) and not (coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0))
       then jsonb_build_object('phase','owner_approval','resumePhase',d.data->>'phase') else '{}'::jsonb end;
   elsif kind='maintenance' and step='bookRepair' then$q$,
   'reviseQuote'],
  ['private.workspace_operations_action(jsonb)',
   $q$    data:=data||jsonb_build_object('phase','triage','ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());$q$,
   $q$    data:=data||jsonb_build_object('phase',coalesce(d.data->>'resumePhase','triage'),'resumePhase',null,'ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());$q$,
   'resumePhase'',null'],
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$'createdAt',created_at)),'[]') into result from claimed;$q$,
   $q$'createdAt',created_at,'eventType',(select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.id=claimed.outbox_id))),'[]') into result from claimed;$q$,
   '''eventType''']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;

-- Each Monday from 8am (UK time), once per property per week, every owner of a live property is
-- told their weekly report is ready. Run by the backend on its schedule.
create function private.workspace_weekly_report_notices(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare uk_time timestamp:=at_time at time zone 'Europe/London';today date:=(at_time at time zone 'Europe/London')::date;
 week_start timestamptz;prop record;ev bigint;sent integer:=0;begin
 if extract(isodow from today)<>1 or extract(hour from uk_time)<8 then return jsonb_build_object('sent',0);end if;
 week_start:=today::timestamp at time zone 'Europe/London';
 for prop in select p.id from public.workspace_properties p where p.status='active'
   and exists(select 1 from public.workspace_property_assignments a join public.workspace_profiles u on u.user_id=a.user_id where a.property_id=p.id and a.assignment='client' and u.status='active')
   and not exists(select 1 from public.workspace_activity a where a.property_id=p.id and a.event_type='reports.weekly_ready' and a.created_at>=week_start) loop
  insert into public.workspace_activity(property_id,event_type,created_at) values(prop.id,'reports.weekly_ready',at_time) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select a.user_id,ev from public.workspace_property_assignments a join public.workspace_profiles u on u.user_id=a.user_id
   where a.property_id=prop.id and a.assignment='client' and u.status='active' on conflict do nothing;
  sent:=sent+1;
 end loop;
 return jsonb_build_object('sent',sent);
end $$;
create function public.workspace_weekly_report_notices() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_weekly_report_notices() $$;
revoke all on function private.workspace_weekly_report_notices(timestamptz),public.workspace_weekly_report_notices() from public,anon,authenticated;
grant execute on function private.workspace_weekly_report_notices(timestamptz),public.workspace_weekly_report_notices() to service_role;
