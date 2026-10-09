-- The hub's own records, kept like rows in a sheet: to-dos for a person or a department, approval
-- tickets the team raises for management with an amount, AirCover claims and invoices to send.
-- Everything else in the hub (purchases, preventative maintenance, reviews and pricing, onboarding)
-- is read from the work the app already holds.
create table if not exists private.workspace_hub_items (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('todo','approval','aircover','invoice')),
 title text not null check(length(trim(title)) between 2 and 200),
 details text not null default '' check(length(details)<=3000),
 property_id uuid references public.workspace_properties(id),
 assignee_id uuid references public.workspace_profiles(user_id),
 department text check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 due_on date,
 amount_minor bigint check(amount_minor is null or amount_minor between 0 and 100000000),
 settled_minor bigint check(settled_minor is null or settled_minor between 0 and 100000000),
 link text check(link is null or (link ~ '^https://[^\s@/]+(/\S*)?$' and length(link)<=1000)),
 reference text not null default '' check(length(reference)<=120),
 status text not null,
 outcome_note text not null default '' check(length(outcome_note)<=2000),
 decided_by uuid references public.workspace_profiles(user_id),
 decided_at timestamptz,
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 check((kind='todo' and status in ('open','done')) or (kind='approval' and status in ('pending','approved','declined'))
  or (kind='aircover' and status in ('to_claim','claimed','paid','declined')) or (kind='invoice' and status in ('to_send','sent','paid'))),
 check(kind<>'todo' or assignee_id is not null or department is not null)
);
create index if not exists workspace_hub_items_kind_idx on private.workspace_hub_items(kind,status,created_at desc);
create index if not exists workspace_hub_items_assignee_idx on private.workspace_hub_items(assignee_id);
create index if not exists workspace_hub_items_creator_idx on private.workspace_hub_items(created_by);
create index if not exists workspace_hub_items_property_idx on private.workspace_hub_items(property_id);
create index if not exists workspace_hub_items_decider_idx on private.workspace_hub_items(decided_by);
alter table private.workspace_hub_items enable row level security;
revoke all on private.workspace_hub_items from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_hub_items;
create trigger business_write_limit before insert or update on private.workspace_hub_items for each row execute function private.workspace_enforce_write_limit();

-- The department a person works in, from the rota.
create or replace function private.workspace_my_department() returns text language sql stable security definer set search_path='' as $fn$
 select r.department from private.workspace_staff_rota r where r.user_id=auth.uid()
$fn$;

-- Who works with each kind: everyone on the team keeps to-dos and raises approvals; Stays, Accounts and
-- admins keep AirCover claims; Accounts and admins keep invoices to send.
create or replace function private.workspace_hub_keeps(kind text) returns boolean language sql stable security definer set search_path='' as $fn$
 select case kind when 'todo' then private.workspace_actor_role() in ('super_admin','admin','stays','cleans','cleaning_manager','ready','accounts')
  when 'approval' then private.workspace_actor_role() in ('super_admin','admin','stays','cleans','cleaning_manager','ready','accounts')
  when 'aircover' then private.workspace_actor_role() in ('super_admin','admin','stays','accounts')
  when 'invoice' then private.workspace_actor_role() in ('super_admin','admin','accounts') else false end
$fn$;

-- Admins see every row. Otherwise: your own to-dos and your department's, the approvals you raised,
-- and the AirCover claims or invoices of the team you work in.
create or replace function private.workspace_hub_can_see(item private.workspace_hub_items) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_actor_role() in ('admin','super_admin') or case item.kind
  when 'todo' then item.assignee_id=auth.uid() or item.created_by=auth.uid() or (item.department is not null and item.department=private.workspace_my_department())
  when 'approval' then item.created_by=auth.uid()
  else private.workspace_hub_keeps(item.kind) end
$fn$;

create or replace function private.workspace_hub_view(item private.workspace_hub_items) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',item.id,'kind',item.kind,'title',item.title,'details',item.details,'propertyId',item.property_id,
  'propertyName',(select p.name from public.workspace_properties p where p.id=item.property_id),
  'assigneeId',item.assignee_id,'assigneeName',(select a.full_name from public.workspace_profiles a where a.user_id=item.assignee_id),
  'department',item.department,'dueOn',item.due_on,'amountMinor',item.amount_minor,'settledMinor',item.settled_minor,'link',item.link,'reference',item.reference,
  'status',item.status,'outcomeNote',item.outcome_note,'decidedBy',(select a.full_name from public.workspace_profiles a where a.user_id=item.decided_by),'decidedAt',item.decided_at,
  'createdBy',item.created_by,'createdByName',(select a.full_name from public.workspace_profiles a where a.user_id=item.created_by),'createdAt',item.created_at,'updatedAt',item.updated_at,'version',item.version)
$fn$;

create or replace function private.workspace_hub_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 return jsonb_build_object(
  'department',private.workspace_my_department(),
  'canDecide',actor in ('admin','super_admin'),
  'keeps',(select coalesce(jsonb_agg(k),'[]') from unnest(array['todo','approval','aircover','invoice']) k where private.workspace_hub_keeps(k)),
  'items',(select coalesce(jsonb_agg(private.workspace_hub_view(i) order by i.created_at desc,i.id),'[]') from (
    select * from private.workspace_hub_items i where private.workspace_hub_can_see(i)
     and (i.status in ('open','pending','to_claim','claimed','to_send','sent') or i.updated_at>now()-interval '90 days')
    order by i.created_at desc limit 1000) i),
  -- The team, to give a to-do to, with their department.
  'people',(select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'department',r.department) order by p.full_name,p.user_id),'[]')
   from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.status='active' and p.role<>'client'));
end $fn$;

create or replace function private.workspace_hub_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 item private.workspace_hub_items;k text;st text;event text;notify uuid[]:='{}';event_id bigint;amount bigint;txt text;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveHubItem' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','kind','title','details','propertyId','assigneeId','department','dueOn','amountMinor','link','reference']);
  k:=input->>'kind';
  if k is null or not private.workspace_hub_keeps(k) then raise exception 'You cannot keep this kind of record' using errcode='42501';end if;
  if input ? 'id' then
   select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
   if item.id is null or not private.workspace_hub_can_see(item) then raise exception 'Record not found' using errcode='P0002';end if;
   if item.kind<>k then raise exception 'A record keeps its kind' using errcode='22023';end if;
   if not (actor in ('admin','super_admin') or item.created_by=auth.uid() or k in ('aircover','invoice')) then raise exception 'Only whoever added it, or an admin, can change it' using errcode='42501';end if;
   if k='approval' and item.status<>'pending' then raise exception 'A decided approval cannot be changed' using errcode='42501';end if;
   if item.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  end if;
  txt:=private.workspace_required_text(input,'title',2,200);
  if input ? 'details' and (jsonb_typeof(input->'details')<>'string' or length(input->>'details')>3000) then raise exception 'The details are too long' using errcode='22023';end if;
  if input ? 'propertyId' and input->>'propertyId' is not null and not exists(select 1 from public.workspace_properties p where p.id=(input->>'propertyId')::uuid) then raise exception 'Property not found' using errcode='P0002';end if;
  if input ? 'dueOn' and input->>'dueOn' is not null and (input->>'dueOn')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid date' using errcode='22023';end if;
  if input ? 'link' and input->>'link' is not null and ((input->>'link')!~'^https://[^\s@/]+(/\S*)?$' or length(input->>'link')>1000) then raise exception 'Use a secure https link' using errcode='22023';end if;
  if input ? 'reference' and (jsonb_typeof(input->'reference')<>'string' or length(input->>'reference')>120) then raise exception 'The reference is too long' using errcode='22023';end if;
  amount:=case when input ? 'amountMinor' and input->>'amountMinor' is not null then private.workspace_money(input,'amountMinor') end;
  if k='approval' and amount is null then raise exception 'Add the amount to approve' using errcode='22023';end if;
  if k='todo' then
   if input ? 'department' and input->>'department' is not null and input->>'department' not in ('guest_relations','client_relations','cleaning','ready','accounts','management') then raise exception 'Choose a department' using errcode='22023';end if;
   if input ? 'assigneeId' and input->>'assigneeId' is not null and not exists(select 1 from public.workspace_profiles p where p.user_id=(input->>'assigneeId')::uuid and p.status='active' and p.role<>'client') then raise exception 'Choose someone on the team' using errcode='22023';end if;
  end if;
  if item.id is null then
   insert into private.workspace_hub_items(kind,title,details,property_id,assignee_id,department,due_on,amount_minor,link,reference,status,created_by)
   values(k,txt,coalesce(input->>'details',''),(input->>'propertyId')::uuid,
    case when k='todo' then coalesce((input->>'assigneeId')::uuid,case when input->>'department' is null then auth.uid() end) end,
    case when k='todo' then input->>'department' end,(input->>'dueOn')::date,amount,input->>'link',coalesce(input->>'reference',''),
    case k when 'todo' then 'open' when 'approval' then 'pending' when 'aircover' then 'to_claim' else 'to_send' end,auth.uid())
   returning * into item;
   event:='hub.'||k||'_added';
   if k='todo' then notify:=array(select item.assignee_id union select r.user_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id and p.status='active' where r.department=item.department);
   elsif k='approval' then notify:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');end if;
  else
   update private.workspace_hub_items set title=txt,details=coalesce(input->>'details',details),property_id=(input->>'propertyId')::uuid,
    assignee_id=case when k='todo' then coalesce((input->>'assigneeId')::uuid,case when input->>'department' is null then coalesce(assignee_id,auth.uid()) end) end,
    department=case when k='todo' then input->>'department' end,due_on=(input->>'dueOn')::date,amount_minor=amount,link=input->>'link',reference=coalesce(input->>'reference',reference),
    version=version+1,updated_at=now() where id=item.id returning * into item;
   event:='hub.'||k||'_changed';
   if k='todo' then notify:=array(select item.assignee_id);end if;
  end if;

 elsif a='moveHubItem' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','status','note','settledMinor']);
  select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
  if item.id is null or not private.workspace_hub_can_see(item) then raise exception 'Record not found' using errcode='P0002';end if;
  if item.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  st:=input->>'status';
  if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>2000) then raise exception 'The note is too long' using errcode='22023';end if;
  if item.kind='todo' then
   if st not in ('open','done') then raise exception 'Choose open or done' using errcode='22023';end if;
  elsif item.kind='approval' then
   if actor not in ('admin','super_admin') then raise exception 'Only management decides approvals' using errcode='42501';end if;
   if item.status<>'pending' or st not in ('approved','declined') then raise exception 'Approve or decline a pending ticket' using errcode='22023';end if;
   if st='declined' and length(trim(coalesce(input->>'note','')))<5 then raise exception 'Say why it is declined' using errcode='22023';end if;
   notify:=array[item.created_by];
  elsif item.kind='aircover' then
   if not private.workspace_hub_keeps('aircover') or st not in ('to_claim','claimed','paid','declined') then raise exception 'Choose a claim status' using errcode='22023';end if;
  else
   if not private.workspace_hub_keeps('invoice') or st not in ('to_send','sent','paid') then raise exception 'Choose an invoice status' using errcode='22023';end if;
  end if;
  update private.workspace_hub_items set status=st,outcome_note=coalesce(input->>'note',outcome_note),
   settled_minor=case when item.kind='aircover' and input ? 'settledMinor' then private.workspace_money(input,'settledMinor') else settled_minor end,
   decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now() where id=item.id returning * into item;
  event:='hub.'||item.kind||'_'||st;
  if item.kind='todo' and st='done' and item.created_by<>auth.uid() then notify:=array[item.created_by];end if;
 else raise exception 'Unknown hub action' using errcode='22023';
 end if;

 result:=private.workspace_hub_view(item);
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,event) returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(notify) u where u is not null and u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;
revoke all on function private.workspace_my_department(),private.workspace_hub_keeps(text),private.workspace_hub_can_see(private.workspace_hub_items),
 private.workspace_hub_view(private.workspace_hub_items),private.workspace_hub_read(),private.workspace_hub_action(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.workspace_teams_read(section text, start_on date DEFAULT NULL::date, end_on date DEFAULT NULL::date, target_property uuid DEFAULT NULL::uuid, target_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.workspace_actor_role();result jsonb;month_start date;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='schedule' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>62 then raise exception 'Choose up to 62 days' using errcode='22023';end if;
  if target_user is not null and actor in ('client','cleans') and target_user<>auth.uid() then raise exception 'Schedule access denied' using errcode='42501';end if;
  select jsonb_build_object('from',start_on,'to',end_on,'payments',private.workspace_schedule_payments(start_on,end_on,target_property),
   'work',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'moduleId',w.module_id,'title',w.title,'status',w.status,
     'dueOn',w.due_on,'assigneeId',w.assignee_id,'assigneeName',a.full_name,'kind',d.kind,'version',w.version) order by w.due_on,w.id),'[]')
     from (select * from public.workspace_work_items w where w.due_on between start_on and end_on and w.status not in ('cancelled','declined')
       and (target_property is null or w.property_id=target_property) and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) w
     join public.workspace_properties p on p.id=w.property_id left join public.workspace_profiles a on a.user_id=w.assignee_id left join private.workspace_domain_details d on d.work_id=w.id),
   'cleanGuests',private.workspace_clean_guests(start_on,end_on,target_property,target_user),'stays',case when actor='cleans' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'propertyId',r.property_id,'propertyName',p.name,
     'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'channel',case when actor='client' then null else r.channel end) order by r.check_in,r.id),'[]')
     from (select * from private.workspace_reservations r where r.status='confirmed' and r.check_in<=end_on and r.check_out>=start_on and (target_property is null or r.property_id=target_property)
       and (case actor when 'client' then private.workspace_can_property(r.property_id,'client-dashboard') when 'accounts' then private.workspace_can_property(r.property_id,'owner-statements')
         else private.workspace_can_property(r.property_id,'cleaning-schedule') or private.workspace_can_property(r.property_id,'direct-bookings') or private.workspace_can_property(r.property_id,'ready-schedule') end)
       order by r.check_in,r.id limit 500) r join public.workspace_properties p on p.id=r.property_id) end) into result;
 elsif section='cleanerRates' then result:=private.workspace_cleaner_rates_read();
 elsif section='defaultCleaners' then result:=private.workspace_default_cleaners_read();
 elsif section='hub' then result:=private.workspace_hub_read();
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
   'repairApprovals',private.workspace_management_repairs(),
   'cleanerWarnings',(select coalesce(jsonb_agg(m.v order by m.v->>'fullName'),'[]') from (select private.workspace_cleaner_month(c.user_id,month_start) v from public.workspace_profiles c where c.role='cleans' and c.status='active') m where (m.v->>'warning')::boolean),
   'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0),
   'stalledOwnerApprovals',private.workspace_stalled_owner_approvals(),'unusualPayouts',private.workspace_unusual_payouts(),'missedYesterday',private.workspace_missed_days_json()
  ) into result;
 elsif section='routines' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'propertyId',r.property_id,'propertyName',p.name,'moduleId',r.module_id,'title',r.title,'checklist',r.checklist,'frequency',r.frequency,
   'dayOfMonth',r.day_of_month,'assigneeId',r.assignee_id,'active',r.active,'startsOn',r.starts_on,'version',r.version,
   'lastVisit',(select jsonb_build_object('period',to_char(v.period_start,'YYYY-MM'),'workId',v.work_id) from private.workspace_routine_visits v where v.plan_id=r.id order by v.period_start desc limit 1)) order by p.name,r.title,r.id),'[]') into result
   from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id where (target_property is null or r.property_id=target_property) and private.workspace_can_property(r.property_id,r.module_id);
 elsif section='training' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'summary',c.summary,'body',c.body,'videoUrl',c.video_url,'minutes',c.minutes,'published',c.published,'required',c.required,'version',c.version,'files',private.workspace_course_files_json(c.id),
   'completedAt',(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=auth.uid()),
   'completions',case when actor in ('admin','super_admin') then (select count(*) from private.workspace_training_progress t where t.course_id=c.id) end) order by c.title,c.id),'[]') into result
   from private.workspace_training_courses c where (actor in ('admin','super_admin') or (c.published and ('all'=any(c.audience) or actor=any(c.audience))));
 elsif section in ('onboarding','contracts','myContracts') then result:=private.workspace_onboarding_read(section);
 elsif section='rota' then result:=private.workspace_rota_read();
 elsif section='budgetChart' then result:=private.workspace_budget_read();
 elsif section='signoff' then result:=private.workspace_signoff_read();
 elsif section in ('shift','teamPerformance') then result:=private.workspace_shift_read(section,start_on,end_on);
 elsif section='mailbox' then result:=private.workspace_mailbox_read();
 else raise exception 'Unknown team section' using errcode='22023';end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.workspace_teams_action(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;
 plan private.workspace_routine_plans;course private.workspace_training_courses;start_on date;target uuid;created jsonb:='[]';remaining integer:=0;n integer:=0;assignee uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input->>'action' in ('saveContract','setCourseRequired','signContract') then return private.workspace_onboarding_action(input);end if;
 if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;
 if input->>'action'='signOffDay' then return private.workspace_signoff_action(input);end if;
 if input->>'action' in ('saveBudgetItem','removeBudgetItem') then return private.workspace_budget_action(input);end if;
 if input->>'action'='saveRota' then return private.workspace_rota_action(input);end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a='decideComplaint' then return private.workspace_decide_clean_dispute(input);end if;
 if a='setCleanerRate' then return private.workspace_cleaner_rate_action(input);end if;
 if a='setDefaultCleaner' then return private.workspace_default_cleaner_action(input);end if;
 if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
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
  if a='decideCleanerReview' and input->>'outcome'='removed_from_rota' then
   -- Off every property, and their open cleans go back to the cleaning manager to reassign.
   delete from public.workspace_property_assignments where user_id::text=d.data->>'cleanerId' and assignment='cleaner';
   update public.workspace_work_items cw set assignee_id=null,version=cw.version+1,updated_at=now()
    from private.workspace_domain_details cd where cd.work_id=cw.id and cd.kind='cleaning' and cw.assignee_id::text=d.data->>'cleanerId' and cw.status not in ('completed','cancelled');
  end if;
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
  perform private.workspace_json_keys(input,array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published','redoRequired']);perform private.workspace_onboarding_refresh();
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
    published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;if coalesce((input->>'redoRequired')::boolean,false) then delete from private.workspace_training_progress where course_id=course.id;end if;
  end if;
  result:=jsonb_build_object('id',course.id,'version',course.version,'published',course.published);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.course_saved');perform private.workspace_onboarding_refresh();

 elsif a='completeCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId']);
  insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;perform private.workspace_onboarding_progress(auth.uid());
  select jsonb_build_object('courseId',course_id,'completedAt',completed_at) into result from private.workspace_training_progress where course_id=(input->>'courseId')::uuid and user_id=auth.uid();
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $function$;

-- When each piece of work was raised and last changed, for the hub's day-by-day totals.
CREATE OR REPLACE FUNCTION private.workspace_operation_view(target uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('workId',w.id,'propertyId',w.property_id,'moduleId',w.module_id,'title',w.title,'status',w.status,'version',w.version,'assigneeId',w.assignee_id,'dueOn',w.due_on,'kind',d.kind,'createdAt',w.created_at,'updatedAt',w.updated_at,
 'data',case when private.workspace_actor_role()='client' then d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence' else d.data end)
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=target;
$function$;
