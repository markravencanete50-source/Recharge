-- Launch Preparation: the set-up condition check sends what cannot be ticked to property maintenance (Business Plan v1.0,
-- 17/10/26, Property Set-Up: "If Recharge setting up, anything that would stop something from being ticked gets noted in
-- the property maintenance board"; "any mentions of repairs required ... ticketed under property maintenance").
--  * When Recharge set the property up, the team report a condition statement that cannot be ticked, with what is wrong.
--    It becomes a property maintenance job (the repair flow: quote, approvals, visit, invoice), visible to the owner, and
--    the team are told in the follow-up notes. The same statement is not reported twice while its job is open.
--  * The checklist shows each statement's reports and where their jobs are up to.
-- Replaces private.workspace_launch_view (20261029800000) and the public workspace_launch_action wrapper. Safe to run twice.

-- 1. Each statement's reports, newest first.
create or replace function private.workspace_launch_condition_reports(prop uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('key',d.data->>'setUpCondition','workId',w.id,'issue',d.data->>'issue','status',w.status,'reportedAt',w.created_at)
  order by w.created_at desc,w.id),'[]')
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 where w.property_id=prop and d.kind='maintenance' and d.data ? 'setUpCondition'
$fn$;

-- 2. The view carries them.
create or replace function private.workspace_launch_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;r private.workspace_launch_readiness;plan jsonb;
 team boolean;owner boolean;keeper boolean;fitter boolean;buyer boolean;writer boolean;hk uuid;steps jsonb;today date:=private.workspace_launch_today();pre boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 select * into r from private.workspace_launch_readiness where property_id=prop;
 team:=coalesce(actor is not null and private.workspace_can_enquiries(),false);
 owner:=coalesce(j.client_id=auth.uid(),false);
 keeper:=coalesce(actor='cleans' and r.housekeeper_id=auth.uid(),false);
 -- The furnishing installer, and accounts once there is furnishing to order.
 fitter:=coalesce((select x.installer_id=auth.uid() from private.workspace_launch_furnishing x where x.property_id=prop),false);
 buyer:=coalesce(actor='accounts' and exists(select 1 from private.workspace_launch_furnishing x where x.property_id=prop and x.settled_at is not null),false);
 -- The technician booked for the guidebook.
 writer:=coalesce((select x.technician_id=auth.uid() from private.workspace_launch_guidebooks x where x.property_id=prop),false);
 if j.property_id is null or not (team or owner or keeper or fitter or buyer or writer) then raise exception 'Property not found' using errcode='42501';end if;
 select * into p from public.workspace_properties where id=prop;
 plan:=private.workspace_launch_plan(prop);
 if plan is null then return jsonb_build_object('propertyId',prop,'steps',null);end if;
 hk:=(select d.cleaner_id from private.workspace_default_cleaners d join public.workspace_profiles x on x.user_id=d.cleaner_id where d.property_id=prop and x.status='active' and x.role='cleans');
 pre:=coalesce((select s->>'state' from jsonb_array_elements(plan) s where s->>'key'='readiness.inspection') in ('todo','done'),false);
 -- What each person can tick: the team, any part ticked by hand; the owner, their own parts.
 steps:=(select jsonb_agg(s||jsonb_build_object('canTick',(s->>'manual')::boolean and (s->>'state'='todo' or (s->>'kind'='expiry' and s->>'state'='done')) and (team or (owner and s->>'who'='client')),
   'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'uploadedAt',f.created_at) order by f.created_at desc,f.id)
    from private.workspace_launch_files f where f.property_id=prop and f.step=s->>'key' and f.line_id is null),'[]'),
   'ticketId',(select t.work_id from private.workspace_launch_tickets t where t.property_id=prop and t.step=s->>'key'),
   'canReopen',team and (s->>'manual')::boolean and s->>'state'='done' and (r.submitted_at is null or s->>'section' not in ('setUp','broadband','utilities','compliance','licensing','housekeeper'))))
  from jsonb_array_elements(plan) s);
 return jsonb_build_object('propertyId',prop,'name',coalesce(p.name,''),'address',case when team or keeper or fitter or buyer or writer then p.address end,'stage',j.stage,'steps',steps,
  'housekeeper',case when hk is null then null else jsonb_build_object('id',hk,'name',coalesce(private.workspace_launch_person(hk),'Housekeeper')) end,
  'readiness',case when r.property_id is null then null else jsonb_build_object('bookedOn',r.booked_on,'housekeeperName',private.workspace_launch_person(r.housekeeper_id),
   'bookedByName',private.workspace_launch_person(r.booked_by),'submittedAt',r.submitted_at,'submittedByName',private.workspace_launch_person(r.submitted_by),
   'inventory',r.inventory,'condition',r.condition,'evidence',case when team or keeper then r.evidence end,'issues',r.issues) end,
  'access',case when team or keeper or fitter or writer then (select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop) end,
  'isTeam',team,'isOwner',owner,'isHousekeeper',keeper,'isInstaller',fitter,'isAccounts',buyer,'isTechnician',writer,
  'furnishing',private.workspace_launch_furnishing_view(prop,team,owner,fitter,buyer),
  'inventory',private.workspace_launch_inventory_view(prop,team,owner,keeper,fitter),
  'guidebook',private.workspace_launch_guidebook_view(prop,team,owner,keeper,writer),
  'garden',private.workspace_launch_garden_view(prop,plan,team,owner),
  'conditionReports',case when team or owner then private.workspace_launch_condition_reports(prop) else '[]' end,
  'canAllocate',team and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked','inspection_complete','live'),
  'canBookReadiness',team and pre and hk is not null and r.submitted_at is null and j.stage in ('inspection_to_book','inspection_booked'),
  'canSubmitReadiness',(team or keeper) and r.property_id is not null and r.submitted_at is null and r.booked_on<=today and j.stage='inspection_booked');
end $fn$;

-- 3. Report a statement that cannot be ticked.
create or replace function private.workspace_launch_condition_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prop uuid;prior jsonb;result jsonb;view jsonb;part jsonb;st jsonb;words text;issue text;job uuid;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','conditionKey','note'],20000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 begin prop:=(input->>'propertyId')::uuid; exception when others then raise exception 'Property not found' using errcode='42501'; end;
 if prop is null then raise exception 'Property not found' using errcode='42501';end if;
 perform 1 from private.workspace_journeys where property_id=prop for update;
 view:=private.workspace_launch_view(prop);
 if input->>'action'<>'reportCondition' then raise exception 'Unknown Launch Preparation action' using errcode='22023';end if;
 if not coalesce((view->>'isTeam')::boolean,false) then raise exception 'Only the team report the condition to property maintenance' using errcode='42501';end if;
 part:=(select z from jsonb_array_elements(view->'steps') z where z->>'key'='setUp.condition');
 if part is null then raise exception 'Launch Preparation follows the onboarding package' using errcode='22023';end if;
 if part->>'who'<>'recharge' then raise exception 'The owner is setting the property up' using errcode='22023';end if;
 if part->>'state'='locked' then raise exception '%',coalesce(part->>'lockedBecause','Not open yet') using errcode='22023';end if;
 if part->>'state'<>'todo' then raise exception 'The condition is already checked' using errcode='22023';end if;
 st:=(select z from jsonb_array_elements(private.workspace_launch_settings()->'condition') z where z->>'key'=input->>'conditionKey');
 if st is null then raise exception 'Choose a condition statement' using errcode='22023';end if;
 words:=btrim(coalesce(input->>'note',''));
 if jsonb_typeof(input->'note') is distinct from 'string' or char_length(words) not between 3 and 1000 then raise exception 'Say what is wrong' using errcode='22023';end if;
 if exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=prop and d.kind='maintenance'
   and d.data->>'setUpCondition'=st->>'key' and w.status not in ('completed','cancelled','declined')) then
  raise exception '"%" is already with property maintenance',st->>'title' using errcode='22023';end if;
 issue:='Set-up condition: '||(st->>'title')||': '||words;
 job:=private.workspace_launch_repair(prop,issue);
 update private.workspace_domain_details set data=data||jsonb_build_object('setUpCondition',st->>'key') where work_id=job;
 perform private.workspace_followup_note(prop,issue||' Sent to property maintenance.',me);
 result:=private.workspace_launch_read(prop);
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 4. One way in.
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select case when input->>'action' in ('addGardenQuote','decideGardenQuote') then private.workspace_launch_garden_action(input)
  when input->>'action'='reportCondition' then private.workspace_launch_condition_action(input) else private.workspace_launch_action(input) end;
$$;

revoke all on function private.workspace_launch_condition_reports(uuid),private.workspace_launch_condition_action(jsonb),private.workspace_launch_view(uuid),
 public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_condition_action(jsonb),public.workspace_launch_action(jsonb) to authenticated;
