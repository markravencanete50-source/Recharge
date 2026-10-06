-- Team operations: management decisions on cleaning complaints, the cleaner's own
-- statement, monthly cleaner performance, one shared schedule, routine visit plans
-- and the training centre. Uploaded training media waits for the storage provider.

alter table private.workspace_cleaning_reviews add column overturned_at timestamptz,
  add column overturned_by uuid references public.workspace_profiles(user_id), add column overturn_note text check(length(overturn_note)<=2000);

create table private.workspace_routine_plans (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
  module_id text not null references public.workspace_features(module_id) check(module_id in ('routine-bin-garden-board','safety-maintenance','ready-schedule')),
  title text not null check(length(trim(title)) between 2 and 200), checklist jsonb not null check(jsonb_typeof(checklist)='array'),
  frequency text not null check(frequency in ('monthly','quarterly')), day_of_month integer not null check(day_of_month between 1 and 28),
  assignee_id uuid references public.workspace_profiles(user_id), active boolean not null default true, starts_on date not null,
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_id)
);
create index workspace_routine_plans_property_idx on private.workspace_routine_plans(property_id,active);
create table private.workspace_routine_visits (
  plan_id uuid not null references private.workspace_routine_plans(id), period_start date not null,
  work_id uuid not null unique references public.workspace_work_items(id), created_at timestamptz not null default now(), primary key(plan_id,period_start)
);
create table private.workspace_training_courses (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 2 and 200),
  audience text[] not null check(cardinality(audience) between 1 and 9 and audience <@ array['all','super_admin','admin','stays','cleans','cleaning_manager','ready','accounts','client']),
  summary text not null default '' check(length(summary)<=1000), body text not null check(length(trim(body)) between 10 and 50000),
  video_url text check(video_url ~ '^https://[^\s@/]+(/[^\s]*)?$' and length(video_url)<=1000), minutes integer not null check(minutes between 1 and 600),
  published boolean not null default false, created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_id)
);
create table private.workspace_training_progress (
  course_id uuid not null references private.workspace_training_courses(id), user_id uuid not null references public.workspace_profiles(user_id),
  completed_at timestamptz not null default now(), primary key(course_id,user_id)
);
create index workspace_training_progress_user_idx on private.workspace_training_progress(user_id);
do $$ declare t text; begin
 foreach t in array array['workspace_routine_plans','workspace_routine_visits','workspace_training_courses','workspace_training_progress'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Upheld rejections in a calendar month. Two or more is a warning.
create function private.workspace_cleaner_month(cleaner uuid,start_on date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cleanerId',p.user_id,'fullName',p.full_name,
  'accepted',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and r.accepted and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'rejected',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'overturned',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is not null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'warning',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month'))>=2,
  'openComplaints',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'propertyId',w.property_id,'sourceWorkId',d.data->>'sourceWorkId','cleanerStatement',d.data->>'cleanerStatement','createdAt',w.created_at) order by w.created_at),'[]')
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'cleanerId'=cleaner::text and w.status not in ('completed','cancelled')))
 from public.workspace_profiles p where p.user_id=cleaner;
$$;

create function private.workspace_teams_read(section text,start_on date default null,end_on date default null,target_property uuid default null,target_user uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();result jsonb;month_start date;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='schedule' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>62 then raise exception 'Choose up to 62 days' using errcode='22023';end if;
  if target_user is not null and actor in ('client','cleans') and target_user<>auth.uid() then raise exception 'Schedule access denied' using errcode='42501';end if;
  select jsonb_build_object('from',start_on,'to',end_on,
   'work',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'moduleId',w.module_id,'title',w.title,'status',w.status,
     'dueOn',w.due_on,'assigneeId',w.assignee_id,'assigneeName',a.full_name,'kind',d.kind,'version',w.version) order by w.due_on,w.id),'[]')
     from (select * from public.workspace_work_items w where w.due_on between start_on and end_on and w.status not in ('cancelled','declined')
       and (target_property is null or w.property_id=target_property) and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) w
     join public.workspace_properties p on p.id=w.property_id left join public.workspace_profiles a on a.user_id=w.assignee_id left join private.workspace_domain_details d on d.work_id=w.id),
   'stays',case when actor='cleans' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'propertyId',r.property_id,'propertyName',p.name,
     'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'channel',case when actor='client' then null else r.channel end) order by r.check_in,r.id),'[]')
     from (select * from private.workspace_reservations r where r.status='confirmed' and r.check_in<=end_on and r.check_out>=start_on and (target_property is null or r.property_id=target_property)
       and (case actor when 'client' then private.workspace_can_property(r.property_id,'client-dashboard') when 'accounts' then private.workspace_can_property(r.property_id,'owner-statements')
         else private.workspace_can_property(r.property_id,'cleaning-schedule') or private.workspace_can_property(r.property_id,'direct-bookings') or private.workspace_can_property(r.property_id,'ready-schedule') end)
       order by r.check_in,r.id limit 500) r join public.workspace_properties p on p.id=r.property_id) end) into result;
 elsif section='performance' then
  month_start:=date_trunc('month',coalesce(start_on,current_date))::date;
  if actor='cleans' then return jsonb_build_array(private.workspace_cleaner_month(auth.uid(),month_start));end if;
  if actor not in ('cleaning_manager','stays','admin','super_admin') or not private.has_workspace_module('cleaner-performance') then raise exception 'Cleaner performance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(private.workspace_cleaner_month(c.user_id,month_start) order by c.full_name,c.user_id),'[]') into result from public.workspace_profiles c
   where c.role='cleans' and c.status='active' and (target_user is null or c.user_id=target_user) and (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments a
    where a.user_id=c.user_id and a.assignment='cleaner' and private.workspace_can_property(a.property_id,'cleaner-performance')));
 elsif section='management' then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
  month_start:=date_trunc('month',current_date)::date;
  select jsonb_build_object(
   'cleaningDecisions',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'kind',d.kind,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,
     'cleanerId',d.data->>'cleanerId','cleanerName',c.full_name,'cleanerStatement',d.data->>'cleanerStatement','sourceWorkId',d.data->>'sourceWorkId','createdAt',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     left join public.workspace_profiles c on c.user_id::text=d.data->>'cleanerId' where d.kind in ('cleaning_complaint','cleaner_management_review') and w.status not in ('completed','cancelled')),
   'expensesOverLimit',(select coalesce(jsonb_agg(private.workspace_expense_view(x,false) order by x.received_on),'[]') from private.workspace_expenses x,private.workspace_finance_policy f
     where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'stalledOwnerApprovals',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,'estimatedCostMinor',(d.data->>'estimatedCostMinor')::bigint,'waitingSince',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.status not in ('completed','cancelled') and w.created_at<now()-interval '48 hours'),
   'cleanerWarnings',(select coalesce(jsonb_agg(m.v order by m.v->>'fullName'),'[]') from (select private.workspace_cleaner_month(c.user_id,month_start) v from public.workspace_profiles c where c.role='cleans' and c.status='active') m where (m.v->>'warning')::boolean),
   'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0)
  ) into result;
 elsif section='routines' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'propertyId',r.property_id,'propertyName',p.name,'moduleId',r.module_id,'title',r.title,'checklist',r.checklist,'frequency',r.frequency,
   'dayOfMonth',r.day_of_month,'assigneeId',r.assignee_id,'active',r.active,'startsOn',r.starts_on,'version',r.version,
   'lastVisit',(select jsonb_build_object('period',to_char(v.period_start,'YYYY-MM'),'workId',v.work_id) from private.workspace_routine_visits v where v.plan_id=r.id order by v.period_start desc limit 1)) order by p.name,r.title,r.id),'[]') into result
   from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id where (target_property is null or r.property_id=target_property) and private.workspace_can_property(r.property_id,r.module_id);
 elsif section='training' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'summary',c.summary,'body',c.body,'videoUrl',c.video_url,'minutes',c.minutes,'published',c.published,'version',c.version,
   'completedAt',(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=auth.uid()),
   'completions',case when actor in ('admin','super_admin') then (select count(*) from private.workspace_training_progress t where t.course_id=c.id) end) order by c.title,c.id),'[]') into result
   from private.workspace_training_courses c where (actor in ('admin','super_admin') or (c.published and ('all'=any(c.audience) or actor=any(c.audience))));
 else raise exception 'Unknown team section' using errcode='22023';end if;
 return result;
end $$;

create function private.workspace_teams_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;
 plan private.workspace_routine_plans;course private.workspace_training_courses;start_on date;target uuid;created jsonb:='[]';remaining integer:=0;n integer:=0;assignee uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('decideComplaint','decideCleanerReview','saveCourse') then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 elsif a='addCleanerStatement' then
  if actor<>'cleans' or not exists(select 1 from private.workspace_domain_details x where x.work_id=(input->>'workId')::uuid and x.kind='cleaning_complaint' and x.data->>'cleanerId'=auth.uid()::text) then raise exception 'Only the cleaner concerned can respond' using errcode='42501';end if;
 elsif a='saveRoutinePlan' then
  if input->>'planId' is not null then select property_id into prop from private.workspace_routine_plans where id=(input->>'planId')::uuid;end if;
  if actor not in ('ready','stays','admin','super_admin') or prop is null or not private.workspace_can_property(prop,coalesce(input->>'moduleId','')) then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='generateRoutineVisits' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='completeCourse' then
  if not exists(select 1 from private.workspace_training_courses c where c.id=(input->>'courseId')::uuid and c.published and ('all'=any(c.audience) or actor=any(c.audience) or actor in ('admin','super_admin'))) then raise exception 'Course not available' using errcode='P0002';end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('decideComplaint','decideCleanerReview') then
  perform private.workspace_json_keys(input,array['action','requestId','workId','version','outcome','note']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if not found or d.kind<>(case a when 'decideComplaint' then 'cleaning_complaint' else 'cleaner_management_review' end) then raise exception 'Decision not found' using errcode='P0002';end if;
  if w.version is distinct from (input->>'version')::integer then raise exception 'Decision changed' using errcode='40001';end if;
  if w.status in ('completed','cancelled') then raise exception 'Already decided' using errcode='42501';end if;
  if coalesce(input->>'outcome','')<>all(case a when 'decideComplaint' then array['upheld','overturned'] else array['no_action','supervised','removed_from_rota'] end) then raise exception 'Choose an outcome' using errcode='22023';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('decision',input->>'outcome','decisionNote',private.workspace_required_text(input,'note',5,2000),'decidedBy',auth.uid(),'decidedAt',now(),'workStatus','completed'),updated_at=now() where work_id=w.id;
  insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(w.id,auth.uid(),req,w.status,'completed',input->>'note',w.version);
  update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
  if a='decideComplaint' and input->>'outcome'='overturned' then
   -- The rejection no longer counts against the cleaner.
   update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=auth.uid(),overturn_note=input->>'note'
    where id=(select r.id from private.workspace_cleaning_reviews r where r.work_id=(d.data->>'sourceWorkId')::uuid and r.cleaner_id::text=d.data->>'cleanerId' and not r.accepted and r.overturned_at is null order by r.created_at desc limit 1);
   -- If the clean has not been redone, it is accepted as originally submitted and can be invoiced.
   select * into src from public.workspace_work_items where id=(d.data->>'sourceWorkId')::uuid for update;
   select * into sd from private.workspace_domain_details where work_id=src.id for update;
   if src.id is not null and sd.kind='cleaning' and sd.data->>'phase'='assigned' and src.status='waiting' and src.assignee_id::text=d.data->>'cleanerId' and sd.data ? 'submittedBy' then
    update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','workStatus','completed','overturnedBy',auth.uid()),updated_at=now() where work_id=src.id;
    insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(src.id,auth.uid(),gen_random_uuid(),src.status,'completed','Rejection overturned by management',src.version);
    update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=src.id;
    perform private.workspace_handover(src.property_id,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',src.id,'cleanerId',src.assignee_id));
   end if;
  end if;
  result:=jsonb_build_object('workId',w.id,'version',w.version,'status',w.status,'outcome',input->>'outcome');
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.decision_'||(input->>'outcome'));

 elsif a='addCleanerStatement' then
  perform private.workspace_json_keys(input,array['action','requestId','workId','statement']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if w.status in ('completed','cancelled') then raise exception 'This complaint has been decided' using errcode='42501';end if;
  if d.data ? 'cleanerStatement' then raise exception 'You have already responded' using errcode='23505';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('cleanerStatement',private.workspace_required_text(input,'statement',10,2000),'cleanerStatementAt',now()),updated_at=now() where work_id=w.id;
  result:=jsonb_build_object('workId',w.id,'responded',true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.cleaner_responded');

 elsif a='saveRoutinePlan' then
  perform private.workspace_json_keys(input,array['action','requestId','planId','version','propertyId','moduleId','title','checklist','frequency','dayOfMonth','assigneeId','active']);
  if coalesce(input->>'frequency','') not in ('monthly','quarterly') or jsonb_typeof(input->'dayOfMonth') is distinct from 'number' or input->>'dayOfMonth'!~'^\d+$' or (input->>'dayOfMonth')::int not between 1 and 28
   or jsonb_typeof(input->'active') is distinct from 'boolean' or jsonb_typeof(input->'checklist') is distinct from 'array' or jsonb_array_length(input->'checklist') not between 1 and 30
   or exists(select 1 from jsonb_array_elements(input->'checklist') e where jsonb_typeof(e)<>'string' or length(trim(e#>>'{}')) not between 1 and 200) then raise exception 'Invalid routine plan' using errcode='22023';end if;
  assignee:=(input->>'assigneeId')::uuid;
  if assignee is not null and not exists(select 1 from public.workspace_profiles p join public.workspace_property_assignments s on s.user_id=p.user_id and s.property_id=prop and s.assignment='staff'
   where p.user_id=assignee and p.status='active' and p.role in ('ready','stays','admin','super_admin')) then raise exception 'Assign someone on this property team' using errcode='42501';end if;
  if input->>'planId' is null then
   insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,assignee_id,active,starts_on,created_by,request_id)
    values(prop,input->>'moduleId',private.workspace_required_text(input,'title',2,200),input->'checklist',input->>'frequency',(input->>'dayOfMonth')::int,assignee,(input->>'active')::boolean,date_trunc('month',current_date)::date,auth.uid(),req) returning * into plan;
  else
   select * into plan from private.workspace_routine_plans where id=(input->>'planId')::uuid for update;
   if plan.version is distinct from (input->>'version')::integer then raise exception 'Routine plan changed' using errcode='40001';end if;
   if plan.property_id<>prop or plan.module_id<>input->>'moduleId' then raise exception 'Create a new plan for another property or board' using errcode='22023';end if;
   update private.workspace_routine_plans set title=private.workspace_required_text(input,'title',2,200),checklist=input->'checklist',frequency=input->>'frequency',day_of_month=(input->>'dayOfMonth')::int,
    assignee_id=assignee,active=(input->>'active')::boolean,version=version+1,updated_at=now() where id=plan.id returning * into plan;
  end if;
  result:=jsonb_build_object('id',plan.id,'version',plan.version,'active',plan.active);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),plan.property_id,'routine.plan_saved');

 elsif a='generateRoutineVisits' then
  perform private.workspace_json_keys(input,array['action','requestId','period']);
  start_on:=private.workspace_period(input->>'period');
  if start_on<date_trunc('month',current_date)::date or start_on>(date_trunc('month',current_date)+interval '2 months')::date then raise exception 'Generate visits for this month or the next two' using errcode='22023';end if;
  -- Bounded per call to stay inside the write quota; call again while remaining is above zero.
  for plan in select r.* from private.workspace_routine_plans r where r.active and r.starts_on<=start_on and private.workspace_can_property(r.property_id,r.module_id)
    and (r.frequency='monthly' or ((extract(year from start_on)-extract(year from r.starts_on))*12+extract(month from start_on)-extract(month from r.starts_on))::int%3=0)
    and not exists(select 1 from private.workspace_routine_visits v where v.plan_id=r.id and v.period_start=start_on) order by r.property_id,r.id loop
   if n>=10 then remaining:=remaining+1;continue;end if;
   target:=private.workspace_handover(plan.property_id,plan.module_id,plan.title,'routine_visit',jsonb_build_object('planId',plan.id,'period',to_char(start_on,'YYYY-MM'),'checklist',plan.checklist));
   -- A previous assignee who has left the property team is not carried over.
   update public.workspace_work_items set due_on=start_on+plan.day_of_month-1,assignee_id=case when exists(select 1 from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
     where s.property_id=plan.property_id and s.user_id=plan.assignee_id and s.assignment='staff' and p.status='active') then plan.assignee_id end where id=target;
   insert into private.workspace_routine_visits(plan_id,period_start,work_id) values(plan.id,start_on,target);
   created:=created||jsonb_build_array(target);n:=n+1;
  end loop;
  result:=jsonb_build_object('period',to_char(start_on,'YYYY-MM'),'created',created,'remaining',remaining);

 elsif a='saveCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published']);
  if jsonb_typeof(input->'audience') is distinct from 'array' or jsonb_typeof(input->'published') is distinct from 'boolean' or jsonb_typeof(input->'minutes') is distinct from 'number' or input->>'minutes'!~'^\d+$'
   or exists(select 1 from jsonb_array_elements(input->'audience') e where jsonb_typeof(e)<>'string') or (input->'videoUrl' is not null and jsonb_typeof(input->'videoUrl')<>'string')
   or (input->'summary' is not null and jsonb_typeof(input->'summary')<>'string') then raise exception 'Invalid course' using errcode='22023';end if;
  if input->>'courseId' is null then
   insert into private.workspace_training_courses(title,audience,summary,body,video_url,minutes,published,created_by,request_id)
    values(private.workspace_required_text(input,'title',2,200),array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),coalesce(trim(input->>'summary'),''),
    private.workspace_required_text(input,'body',10,50000),nullif(trim(input->>'videoUrl'),''),(input->>'minutes')::int,(input->>'published')::boolean,auth.uid(),req) returning * into course;
  else
   select * into course from private.workspace_training_courses where id=(input->>'courseId')::uuid for update;
   if not found then raise exception 'Course not found' using errcode='P0002';end if;
   if course.version is distinct from (input->>'version')::integer then raise exception 'Course changed' using errcode='40001';end if;
   update private.workspace_training_courses set title=private.workspace_required_text(input,'title',2,200),audience=array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),
    summary=coalesce(trim(input->>'summary'),''),body=private.workspace_required_text(input,'body',10,50000),video_url=nullif(trim(input->>'videoUrl'),''),minutes=(input->>'minutes')::int,
    published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;
  end if;
  result:=jsonb_build_object('id',course.id,'version',course.version,'published',course.published);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.course_saved');

 elsif a='completeCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId']);
  insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;
  select jsonb_build_object('courseId',course_id,'completedAt',completed_at) into result from private.workspace_training_progress where course_id=(input->>'courseId')::uuid and user_id=auth.uid();
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

revoke all on function private.workspace_cleaner_month(uuid,date),private.workspace_teams_read(text,date,date,uuid,uuid),private.workspace_teams_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_teams_read(text,date,date,uuid,uuid),private.workspace_teams_action(jsonb) to authenticated;
create function public.workspace_teams_read(section text,start_on date default null,end_on date default null,target_property uuid default null,target_user uuid default null) returns jsonb
 language sql security invoker set search_path='' as $$ select private.workspace_teams_read(section,start_on,end_on,target_property,target_user); $$;
create function public.workspace_teams_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_teams_action(input); $$;
revoke all on function public.workspace_teams_read(text,date,date,uuid,uuid),public.workspace_teams_action(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_teams_read(text,date,date,uuid,uuid),public.workspace_teams_action(jsonb) to authenticated;
