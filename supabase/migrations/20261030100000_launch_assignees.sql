-- Launch Preparation: each part's tickets are assigned to the person who does them (Business Plan v1.0, 17/10/26: "The
-- property onboarding coordinator is auto assigned to the task, and it's added to their to-do list"; pricing "auto
-- assigned to the revenue managers to-do-list"; photography "assigned to the property operations coordinator").
--  * Admins choose, for each part with a ticket (furnishing, broadband, safety compliance, readiness, photography, waste,
--    guidebook, pricing, social media), the team member its tickets go to, or nobody.
--  * A new ticket (and a safety renewal or safety job) is assigned to that person; choosing someone also assigns the
--    part's open tickets that have nobody yet. Assigned work shows on the person's to-do list.
-- Replaces private.workspace_launch_read (20261029950000) and the public workspace_launch_action wrapper. Safe to run twice.

-- 1. Who each part's tickets go to.
create table if not exists private.workspace_launch_assignees (
 section text primary key check (section in ('furnishing','broadband','compliance','readiness','photography','waste','guidebook','pricing','social')),
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
alter table private.workspace_launch_assignees enable row level security;
revoke all on private.workspace_launch_assignees from public,anon,authenticated,service_role;

-- The part a checklist step's ticket belongs to: the furnishing order, delivery and install are "furnishing".
create or replace function private.workspace_launch_section(step text) returns text language sql immutable set search_path='' as $fn$
 select case when step like 'compliance:%' then 'compliance' when step like 'setUp.%' then 'furnishing' else split_part(step,'.',1) end
$fn$;

-- 2. Assign a part's ticket, when it has nobody yet and the part has an active person.
create or replace function private.workspace_launch_assign(step text,work uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare who uuid;begin
 if work is null then return;end if;
 who:=(select x.user_id from private.workspace_launch_assignees x join public.workspace_profiles p on p.user_id=x.user_id
  where x.section=private.workspace_launch_section(step) and p.status='active' and p.role not in ('client','cleans'));
 if who is null then return;end if;
 update public.workspace_work_items w set assignee_id=who,version=w.version+1,updated_at=now() where w.id=work and w.assignee_id is null and w.status not in ('completed','cancelled','declined');
end $fn$;
create or replace function private.workspace_launch_assign_trigger() returns trigger language plpgsql security definer set search_path='' as $fn$
begin perform private.workspace_launch_assign(new.step,new.work_id);return null;end $fn$;
drop trigger if exists workspace_launch_assign on private.workspace_launch_tickets;
create trigger workspace_launch_assign after insert on private.workspace_launch_tickets for each row execute function private.workspace_launch_assign_trigger();
drop trigger if exists workspace_launch_assign on private.workspace_launch_reminders;
create trigger workspace_launch_assign after insert on private.workspace_launch_reminders for each row execute function private.workspace_launch_assign_trigger();

-- 3. The read carries the choices.
create or replace function private.workspace_launch_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();st private.workspace_launch_settings;team boolean;begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 team:=coalesce(private.workspace_can_enquiries(),false);
 select * into st from private.workspace_launch_settings where singleton;
 return jsonb_build_object('settings',private.workspace_launch_settings(),'canEditSettings',actor in ('admin','super_admin'),
  'settingsUpdatedAt',st.updated_at,
  'boardIds',case when actor in ('admin','super_admin') then coalesce((select jsonb_agg(f.module_id order by f.module_id) from public.workspace_features f),'[]') else '[]' end,'settingsUpdatedByName',private.workspace_launch_person(st.updated_by),
  -- Who can be the housekeeper: active housekeeping users.
  -- Who can install furniture: any active team member (the Furniture Install Technician, or whoever is covering).
  'installers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role<>'client'),'[]') else '[]' end,
  'housekeepers',case when team then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Housekeeper')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role='cleans'),'[]') else '[]' end,
  -- A housekeeper's readiness inspections still to do.
  'inspections',coalesce((select jsonb_agg(jsonb_build_object('propertyId',r.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookedOn',r.booked_on) order by r.booked_on,r.property_id)
   from private.workspace_launch_readiness r join public.workspace_properties p on p.id=r.property_id join private.workspace_journeys j on j.property_id=r.property_id
   where r.housekeeper_id=auth.uid() and actor='cleans' and r.submitted_at is null and j.stage='inspection_booked'),'[]'),
  -- Furnishing to order (accounts and the team) or to receive and install (the installer).
  'furnishingWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',f.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,
    'installer',coalesce(f.installer_id=auth.uid(),false),'total',c.total,'ordered',c.ordered,'received',c.received,'installOn',f.install_on,'installApproved',f.install_approved_at is not null)
    order by f.settled_at,f.property_id)
   from private.workspace_launch_furnishing f join public.workspace_properties p on p.id=f.property_id
   cross join lateral (select count(*)::int total,count(o.ordered_at)::int ordered,count(o.received_at)::int received from private.workspace_launch_buy(f.property_id) b
    left join private.workspace_launch_furnishing_lines o on o.line_id=b.id) c
   where f.settled_at is not null and f.installed_at is null and (f.installer_id=auth.uid() or ((actor='accounts' or team) and (f.installer_id is null or c.ordered<c.total)))),'[]'),
  -- Guidebooks the signed-in technician is booked to fill in.
  'guidebookWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',g.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'bookOn',g.book_on)
    order by g.book_on,g.property_id)
   from private.workspace_launch_guidebooks g join public.workspace_properties p on p.id=g.property_id where g.technician_id=auth.uid() and g.submitted_at is null),'[]'),
  -- Broadband the signed-in technician is assigned to set up (20261029950000).
  'broadbandWork',coalesce((select jsonb_agg(jsonb_build_object('propertyId',b.property_id,'name',coalesce(nullif(btrim(p.name),''),'Property'),'address',p.address,'installOn',b.install_on)
    order by b.install_on nulls last,b.property_id)
   from private.workspace_launch_broadband b join public.workspace_properties p on p.id=b.property_id where b.technician_id=auth.uid() and b.installed_at is null),'[]'),
  -- Who each part's tickets go to (20261030100000), for admins to change.
  'assignees',case when actor in ('admin','super_admin') then coalesce((select jsonb_object_agg(x.section,jsonb_build_object('id',x.user_id,'name',coalesce(private.workspace_launch_person(x.user_id),'Team member')))
   from private.workspace_launch_assignees x join public.workspace_profiles p on p.user_id=x.user_id where p.status='active'),'{}') else '{}' end,
  'launch',case when target is null then null else private.workspace_launch_view(target) end);
end $fn$;

-- 4. Admins choose who a part's tickets go to (or nobody); the part's open tickets with nobody are assigned.
create or replace function private.workspace_launch_assignee_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prior jsonb;result jsonb;sec text;who uuid;t record;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','section','userId'],4000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 if input->>'action'<>'saveLaunchAssignee' then raise exception 'Unknown Launch Preparation action' using errcode='22023';end if;
 if actor not in ('admin','super_admin') then raise exception 'Only admins can change Launch Preparation' using errcode='42501';end if;
 sec:=input->>'section';
 if coalesce(sec,'') not in ('furnishing','broadband','compliance','readiness','photography','waste','guidebook','pricing','social') then raise exception 'Choose a part' using errcode='22023';end if;
 if input->'userId' is null or input->'userId'='null'::jsonb then
  delete from private.workspace_launch_assignees where section=sec;
 else
  begin who:=(input->>'userId')::uuid; exception when others then raise exception 'Choose a team member' using errcode='22023'; end;
  if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and p.role not in ('client','cleans')) then
   raise exception 'Choose a team member' using errcode='22023';end if;
  insert into private.workspace_launch_assignees(section,user_id,updated_by,updated_at) values(sec,who,me,now())
   on conflict(section) do update set user_id=excluded.user_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  for t in select x.step,x.work_id from private.workspace_launch_tickets x where private.workspace_launch_section(x.step)=sec
   union all select m.step,m.work_id from private.workspace_launch_reminders m where m.work_id is not null and private.workspace_launch_section(m.step)=sec loop
   perform private.workspace_launch_assign(t.step,t.work_id);
  end loop;
 end if;
 result:=private.workspace_launch_read(null);
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 5. One way in.
create or replace function public.workspace_launch_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select case when input->>'action' in ('addGardenQuote','decideGardenQuote') then private.workspace_launch_garden_action(input)
  when input->>'action'='reportCondition' then private.workspace_launch_condition_action(input)
  when input->>'action' in ('setBroadbandDate','assignBroadbandTech','completeBroadband') then private.workspace_launch_broadband_action(input)
  when input->>'action'='saveLaunchAssignee' then private.workspace_launch_assignee_action(input)
  else private.workspace_launch_action(input) end;
$$;

revoke all on function private.workspace_launch_section(text),private.workspace_launch_assign(text,uuid),private.workspace_launch_assign_trigger(),
 private.workspace_launch_assignee_action(jsonb),private.workspace_launch_read(uuid),public.workspace_launch_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_assignee_action(jsonb),private.workspace_launch_read(uuid),public.workspace_launch_action(jsonb) to authenticated;
