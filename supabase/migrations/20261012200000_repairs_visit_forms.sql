-- Repairs and visit forms (client asks B5 and B6).
--
-- B5: a repair that sits in triage (a 0 or low estimate puts it there) can now be closed as "resolved by
-- troubleshooting": Stays or management write what fixed it, the repair becomes resolved and completed, and
-- the people who reported or look after it are told. Any other phase, or any other role, is refused.
--
-- B6: a routine (preventative) visit cannot move to in review or completed until a visit form has been
-- recorded. The form answers every checklist item of the visit once, in order, as done or not done, with an
-- optional note per item, a general note and optional photos of the property. It also stamps when the visit
-- was last done and when the next one falls due.
--
-- Safe to run twice: functions are replaced, the trigger is dropped and recreated, and every patch to an
-- existing function carries a sentinel, requires its anchor exactly once, and keeps the anchor word for word.

-- 1. The two assumptions, each one immutable function (mirrored in lib/feedback-defaults.ts).
create or replace function private.workspace_visit_form_required() returns boolean
language sql immutable set search_path='' as $fn$ select true $fn$;

-- The checklist items a visit starts from when its plan gave none. The visit type is routine, garden or bins.
create or replace function private.workspace_visit_checklist(visit_type text) returns text[]
language sql immutable set search_path='' as $fn$
 select case visit_type
  when 'garden' then array['Lawn and hedges tidy','Paths, patio and steps clear','Gutters and drains clear','Outdoor furniture and lights working']
  when 'bins' then array['Bins out for collection','Bins back in after collection','Bin store clean and tidy','Recycling sorted']
  else array['Smoke and carbon monoxide alarms tested','Heating and hot water working','Taps, toilets and drains free of leaks','Windows and doors secure','No damp, mould or damage','Appliances working']
 end
$fn$;

-- Which of the three a visit is, from what it says about itself.
create or replace function private.workspace_visit_type(title text, data jsonb) returns text
language sql immutable set search_path='' as $fn$
 select case
  when data->>'visitType' in ('routine','garden','bins') then data->>'visitType'
  when lower(coalesce(title,'')) like '%garden%' then 'garden'
  when lower(coalesce(title,'')) like '%bin%' then 'bins'
  else 'routine'
 end
$fn$;

revoke all on function private.workspace_visit_form_required(),private.workspace_visit_checklist(text),private.workspace_visit_type(text,jsonb) from public,anon,authenticated;

-- 2. The guard: a routine visit goes to review or completed only with its form. Cancelling is never gated, and
-- neither is a visit that is already there.
create or replace function private.workspace_visit_form_guard() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.status in ('in_review','completed') and new.status is distinct from old.status and private.workspace_visit_form_required()
  and exists(select 1 from private.workspace_domain_details d where d.work_id=new.id and d.kind='routine_visit' and coalesce(jsonb_typeof(d.data->'visitForm'),'')<>'object') then
  raise exception 'Record the visit form before this visit goes for review or is completed' using errcode='22023';
 end if;
 return new;
end $fn$;
revoke all on function private.workspace_visit_form_guard() from public,anon,authenticated;
drop trigger if exists visit_form_guard on public.workspace_work_items;
create trigger visit_form_guard before update of status on public.workspace_work_items for each row execute function private.workspace_visit_form_guard();

-- 3. The action: recordVisitForm {workId, version, answers[{item, done, note?}], note, photoIds?}.
create or replace function private.workspace_visit_form_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;
 w public.workspace_work_items;d private.workspace_domain_details;plan private.workspace_routine_plans;
 items text[];vtype text;answers jsonb;e jsonb;kept jsonb:='[]'::jsonb;photos jsonb;general text;form jsonb;next_on date;done_count integer:=0;i integer;result jsonb;
begin
 if actor is null or actor not in ('ready','stays','admin','super_admin') then raise exception 'Only the team looking after the property can record a visit form' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if jsonb_typeof(input) is distinct from 'object' or octet_length(input::text)>40000 then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(input) k where k<>all(array['action','requestId','workId','version','answers','note','photoIds'])) then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 select * into w from public.workspace_work_items x where x.id=(input->>'workId')::uuid for update;
 if w.id is null or not private.workspace_can_work(w.id) then raise exception 'Work not found' using errcode='P0002';end if;
 select * into d from private.workspace_domain_details x where x.work_id=w.id for update;
 if d.kind is distinct from 'routine_visit' then raise exception 'Only a routine visit takes a visit form' using errcode='22023';end if;
 if w.status in ('completed','cancelled','declined') then raise exception 'This visit is already closed' using errcode='22023';end if;
 if jsonb_typeof(input->'version')<>'number' or w.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;

 -- The checklist is the visit's own (copied from its plan); a visit with none starts from its type's list.
 vtype:=private.workspace_visit_type(w.title,d.data);
 if jsonb_typeof(d.data->'checklist')='array' and jsonb_array_length(d.data->'checklist')>0 then
  items:=array(select trim(c.v) from jsonb_array_elements_text(d.data->'checklist') with ordinality c(v,n) order by c.n);
 else
  items:=private.workspace_visit_checklist(vtype);
 end if;

 answers:=input->'answers';
 if jsonb_typeof(answers)<>'array' or jsonb_array_length(answers)<>cardinality(items) then raise exception 'Answer every checklist item once, in order' using errcode='22023';end if;
 for i in 1..cardinality(items) loop
  e:=answers->(i-1);
  if jsonb_typeof(e) is distinct from 'object' then raise exception 'Answer every checklist item once, in order: item % is "%"',i,items[i] using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(e) k where k<>all(array['item','done','note']))
   or jsonb_typeof(e->'item') is distinct from 'string' or trim(e->>'item') is distinct from items[i]
   or jsonb_typeof(e->'done') is distinct from 'boolean'
   or (e ? 'note' and jsonb_typeof(e->'note') not in ('string','null'))
   or length(coalesce(trim(e->>'note'),''))>300 then
   raise exception 'Answer every checklist item once, in order: item % is "%"',i,items[i] using errcode='22023';
  end if;
  if (e->>'done')::boolean then done_count:=done_count+1;end if;
  kept:=kept||jsonb_build_array(jsonb_build_object('item',items[i],'done',(e->>'done')::boolean)||case when nullif(trim(e->>'note'),'') is not null then jsonb_build_object('note',trim(e->>'note')) else '{}'::jsonb end);
 end loop;

 if jsonb_typeof(input->'note') is distinct from 'string' or length(trim(input->>'note'))>2000 then raise exception 'Add a note of up to 2000 characters' using errcode='22023';end if;
 general:=trim(input->>'note');

 -- Photos are optional, and must be photos saved on this property.
 photos:=coalesce(input->'photoIds','[]'::jsonb);
 if jsonb_typeof(photos)<>'array' or jsonb_array_length(photos)>10 or exists(select 1 from jsonb_array_elements(photos) x where jsonb_typeof(x)<>'string') then raise exception 'Add up to 10 photos' using errcode='22023';end if;
 photos:=coalesce((select jsonb_agg(p.v order by p.v) from (select distinct value#>>'{}' v from jsonb_array_elements(photos)) p),'[]'::jsonb);
 if (select count(*) from private.workspace_media_evidence m where m.property_id=w.property_id and m.id::text in (select value#>>'{}' from jsonb_array_elements(photos)))<>jsonb_array_length(photos) then
  raise exception 'Photos must be photos saved on this property' using errcode='22023';
 end if;

 -- When the next visit falls due: the next period of the plan, on the plan's day of the month.
 if d.data->>'planId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then select * into plan from private.workspace_routine_plans p where p.id=(d.data->>'planId')::uuid;end if;
 if plan.id is not null and d.data->>'period' ~ '^\d{4}-\d{2}$' then
  next_on:=(to_date(d.data->>'period'||'-01','YYYY-MM-DD')+case plan.frequency when 'quarterly' then interval '3 months' else interval '1 month' end)::date+plan.day_of_month-1;
 end if;

 form:=jsonb_build_object('answers',kept,'note',general,'photoIds',photos,'doneCount',done_count,'totalCount',cardinality(items),'recordedBy',auth.uid(),'recordedAt',now());
 update private.workspace_domain_details set data=data||jsonb_build_object('visitForm',form,'visitType',vtype,'lastDoneAt',now(),'nextDueOn',next_on)
   ||case when jsonb_typeof(data->'checklist')='array' and jsonb_array_length(data->'checklist')>0 then '{}'::jsonb else jsonb_build_object('checklist',to_jsonb(items)) end,updated_at=now() where work_id=w.id;
 update public.workspace_work_items set version=version+1,updated_at=now() where id=w.id;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'routine.visit_form_recorded');
 result:=private.workspace_operation_view(w.id);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;
revoke all on function private.workspace_visit_form_action(jsonb) from public,anon,authenticated;

-- 4. Patches to existing functions, each from its latest definition: the anchor must occur exactly once, the
-- anchor text stays word for word in the result, and a second run finds the sentinel and does nothing.
do $$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  -- B5: resolveRepair goes in front of referReady.
  ['private.workspace_operations_action(jsonb)',
   $q$elsif kind='maintenance' and step='referReady' then$q$,
   $q$elsif kind='maintenance' and step='resolveRepair' then
    perform private.workspace_json_keys(data,array['resolution']);
    if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'stays-maintenance-reporting') then raise exception 'Stays or management access required to resolve a repair' using errcode='42501';end if;
    if d.data->>'phase' is distinct from 'triage' then raise exception 'Only a repair that is still in triage can be resolved here' using errcode='22023';end if;
    data:=jsonb_build_object('phase','resolved','resolution',private.workspace_required_text(data,'resolution',5,2000),'resolvedBy',auth.uid(),'resolvedAt',now());next_status:='completed';
    insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(target,auth.uid(),req,w.status,'completed',data->>'resolution',w.version);
    notify_users:=array(select (d.data->>'reportedBy')::uuid where d.data->>'reportedBy' is not null union select s.user_id from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id join public.workspace_module_grants g on g.user_id=s.user_id and g.module_id='stays-maintenance-reporting' where s.property_id=prop and p.role='stays' and p.status='active');
   elsif kind='maintenance' and step='referReady' then$q$,
   $q$step='resolveRepair'$q$],
  -- B6: the new action is routed after the hub actions (R6).
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a='recordVisitForm' then return private.workspace_visit_form_action(input);end if;$q$,
   $q$private.workspace_visit_form_action(input)$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
