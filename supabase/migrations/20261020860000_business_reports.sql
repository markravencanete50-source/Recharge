-- Business reports (Alex, client meeting): one read for admins and super admins with five reports for the dates chosen
-- (up to 366 days, Europe/London days, both included). Owners, clients and the rest of the team are refused. No report
-- returns a guest's or an enquirer's name, email or phone.
--  * enquiries: enquiries received (from the enquiry form, or added in the app as an onboarding), how many of each
--    "When would you like to get started?" answer (the first answer, "As soon as possible", is Priority), and how many
--    reached an estimate, a signed agreement and going live, with the first reply time. Nothing new is recorded: the
--    first reply is the earlier of the estimate being sent (journey.publishEstimate in the activity log, or an estimate
--    link) and the first email from Client emails to the enquirer's address. Phone calls are not recorded anywhere.
--  * repairs: repairs raised by stage and by property, the quoted cost, the final cost recorded, and maintenance
--    expenses received in the dates (approved, waiting, rejected).
--  * todos: to-dos due in the dates (or added in them, when they have no due date): done, done late and overdue,
--    by department and by person.
--  * messages: messages received and sent per channel per week and per month (guest messages by platform, the
--    owner app chat and Client emails), and reply times. Guest and owner chat reply times reuse
--    private.workspace_response_rows and private.workspace_client_response_rows; Client emails are timed the same way.
--  * time: hours worked per person and per department, with unpaid pauses taken off exactly as the Productivity Tool
--    does (private.workspace_shift_unpaid_minutes), plus overtime.
-- New functions only (private.workspace_business_report and its public wrapper); nothing existing is changed.
-- Safe to run twice.

create or replace function private.workspace_business_report(section text,start_on date,end_on date) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();lower_at timestamptz;upper_at timestamptz;today date:=(now() at time zone 'Europe/London')::date;
 result jsonb;amber numeric;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>365 then raise exception 'Choose up to 366 days' using errcode='22023';end if;
 lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';

 if section='enquiries' then
  with units as (
   -- An enquiry form the landlord sent back in the dates.
   select e.submitted_at received_at,'form' source,e.property_id,coalesce(e.answers->>'startWhen','') start_when,
    nullif(lower(btrim(e.recipient_email)),'') address,e.status='closed' closed
   from private.workspace_client_enquiries e where e.submitted_at>=lower_at and e.submitted_at<upper_at
   union all
   -- An onboarding added in the app (by the team, or an owner adding a property) with no enquiry form behind it.
   select j.created_at,'app',j.property_id,'',nullif(lower(btrim(j.enquiry->>'email')),''),false
   from private.workspace_journeys j where j.created_at>=lower_at and j.created_at<upper_at
    and not exists(select 1 from private.workspace_client_enquiries e where e.property_id=j.property_id)
  ), facts as (
   select u.*,j.stage,j.signed_at,j.estimate is not null has_estimate,p.name property_name,
    (select min(x.at) from (select a.created_at at from public.workspace_activity a where a.property_id=u.property_id and a.event_type='journey.publishEstimate'
      union all select l.issued_at from private.workspace_estimate_links l where l.property_id=u.property_id) x where x.at>=u.received_at) estimate_at,
    (select min(m.sent_at) from private.workspace_client_email_messages m join private.workspace_client_email_threads t on t.id=m.thread_id
      where u.address is not null and t.address=u.address and m.direction='out' and m.status<>'failed' and m.sent_at>=u.received_at) email_at
   from units u left join private.workspace_journeys j on j.property_id=u.property_id left join public.workspace_properties p on p.id=u.property_id
  ), reached as (
   select f.*,
    coalesce(f.stage='live',false) live,
    coalesce(f.stage='live' or f.signed_at is not null or f.stage in ('form','invoice','inspection_to_book','inspection_booked','inspection_complete'),false) agreement,
    coalesce(f.stage in ('live','estimate','reviewing','agreement','form','invoice','inspection_to_book','inspection_booked','inspection_complete') or f.signed_at is not null
     or f.estimate_at is not null or f.has_estimate,false) estimate,
    coalesce(f.closed or f.stage='archived',false) declined,
    extract(epoch from least(f.estimate_at,f.email_at)-f.received_at)/60 reply_minutes,
    extract(epoch from f.estimate_at-f.received_at)/60 estimate_minutes
   from facts f
  )
  select jsonb_build_object('section','enquiries','from',start_on,'to',end_on,
   'received',count(*),'priority',count(*) filter(where r.start_when='As soon as possible'),
   'bySource',jsonb_build_object('form',count(*) filter(where r.source='form'),'app',count(*) filter(where r.source='app')),
   'byStart',coalesce((select jsonb_agg(jsonb_build_object('startWhen',s.start_when,'count',s.n) order by s.start_when) from (
     select x.start_when,count(*)::int n from reached x where x.source='form' group by x.start_when) s),'[]'),
   'funnel',jsonb_build_object('received',count(*),'estimate',count(*) filter(where r.estimate),'agreement',count(*) filter(where r.agreement),
     'live',count(*) filter(where r.live),'declined',count(*) filter(where r.declined and not r.live)),
   'reply',jsonb_build_object('replied',count(r.reply_minutes),'waiting',count(*) filter(where r.reply_minutes is null and not r.declined and not r.live),
     'medianMinutes',round((percentile_cont(0.5) within group(order by r.reply_minutes))::numeric,1),'slowestMinutes',round(max(r.reply_minutes)::numeric,1),
     'estimateSent',count(r.estimate_minutes),'estimateMedianMinutes',round((percentile_cont(0.5) within group(order by r.estimate_minutes))::numeric,1),
     'estimateSlowestMinutes',round(max(r.estimate_minutes)::numeric,1)),
   'rows',coalesce(jsonb_agg(jsonb_build_object('receivedAt',r.received_at,'source',r.source,'propertyName',r.property_name,'startWhen',r.start_when,
     'reached',case when r.live then 'live' when r.agreement then 'agreement' when r.estimate then 'estimate' else 'received' end,'declined',r.declined,
     'replyMinutes',round(r.reply_minutes::numeric,1),'estimateMinutes',round(r.estimate_minutes::numeric,1)) order by r.received_at) filter(where r.received_at is not null),'[]'))
  into result from reached r;
  return result;
 end if;

 if section='repairs' then
  with r as (
   select w.id,w.property_id,w.status,w.created_at,w.completed_at,
    case when w.status='cancelled' then 'cancelled' when d.data->>'phase'='completed' and d.data->>'paidAt' is not null then 'paid'
     else coalesce(nullif(d.data->>'phase',''),case when w.status='completed' then 'completed' else 'triage' end) end stage,
    case when jsonb_typeof(d.data->'estimatedCostMinor')='number' then (d.data->>'estimatedCostMinor')::numeric end quoted,
    case when jsonb_typeof(d.data->'actualCostMinor')='number' then (d.data->>'actualCostMinor')::numeric end actual
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id and d.kind='maintenance'
   where w.created_at>=lower_at and w.created_at<upper_at
  ), done as (
   select w.property_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id and d.kind='maintenance'
   where w.completed_at>=lower_at and w.completed_at<upper_at
  ), x as (
   select e.property_id,e.status,e.amount_minor from private.workspace_expenses e where e.category='maintenance' and e.received_on between start_on and end_on
  ), props as (select property_id from r union select property_id from done union select property_id from x)
  select jsonb_build_object('section','repairs','from',start_on,'to',end_on,
   'raised',(select count(*) from r),'completed',(select count(*) from done),
   'quotedMinor',(select coalesce(sum(quoted),0)::bigint from r),'quotedRepairs',(select count(quoted) from r),
   'finalMinor',(select coalesce(sum(actual),0)::bigint from r),'finalRepairs',(select count(actual) from r),
   'byStage',coalesce((select jsonb_agg(jsonb_build_object('stage',s.stage,'count',s.n) order by s.n desc,s.stage) from (select stage,count(*)::int n from r group by stage) s),'[]'),
   'spend',jsonb_build_object('approvedMinor',(select coalesce(sum(amount_minor),0)::bigint from x where status='approved'),
     'waitingMinor',(select coalesce(sum(amount_minor),0)::bigint from x where status in ('to_approve','queried')),
     'rejectedMinor',(select coalesce(sum(amount_minor),0)::bigint from x where status='rejected'),'expenses',(select count(*) from x)),
   'byProperty',coalesce((select jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,
     'raised',(select count(*) from r where r.property_id=p.id),'completed',(select count(*) from done where done.property_id=p.id),
     'quotedMinor',(select coalesce(sum(quoted),0)::bigint from r where r.property_id=p.id),
     'finalMinor',(select coalesce(sum(actual),0)::bigint from r where r.property_id=p.id),
     'approvedMinor',(select coalesce(sum(amount_minor),0)::bigint from x where x.property_id=p.id and x.status='approved'),
     'waitingMinor',(select coalesce(sum(amount_minor),0)::bigint from x where x.property_id=p.id and x.status in ('to_approve','queried'))) order by p.name,p.id)
    from public.workspace_properties p where p.id in (select property_id from props)),'[]'))
  into result;
  return result;
 end if;

 if section='todos' then
  with t as (
   select i.id,i.department,i.assignee_id,i.decided_by,i.status,i.due_on,(i.decided_at at time zone 'Europe/London')::date done_on
   from private.workspace_hub_items i
   where i.kind='todo' and (i.due_on between start_on and end_on or (i.due_on is null and i.created_at>=lower_at and i.created_at<upper_at))
  ), s as (
   select t.*,t.status='done' is_done,t.status='done' and t.due_on is not null and t.done_on>t.due_on done_late,
    t.status='open' and t.due_on is not null and t.due_on<today overdue from t
  ), people as (select assignee_id user_id from s where assignee_id is not null union select decided_by from s where is_done and decided_by is not null)
  select jsonb_build_object('section','todos','from',start_on,'to',end_on,
   'total',(select count(*) from s),'done',(select count(*) from s where is_done),'doneLate',(select count(*) from s where done_late),
   'overdue',(select count(*) from s where overdue),'open',(select count(*) from s where not is_done),
   'byDepartment',coalesce((select jsonb_agg(jsonb_build_object('department',g.department,'total',g.total,'done',g.done,'doneLate',g.late,'overdue',g.overdue) order by g.department) from (
     select coalesce(department,'') department,count(*)::int total,count(*) filter(where is_done)::int done,count(*) filter(where done_late)::int late,count(*) filter(where overdue)::int overdue
     from s group by 1) g),'[]'),
   'byPerson',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,
     'assigned',(select count(*) from s where s.assignee_id=p.user_id),'done',(select count(*) from s where s.is_done and s.decided_by=p.user_id),
     'doneLate',(select count(*) from s where s.done_late and s.decided_by=p.user_id),'overdue',(select count(*) from s where s.overdue and s.assignee_id=p.user_id))
     order by p.full_name,p.user_id) from public.workspace_profiles p where p.user_id in (select user_id from people)),'[]'))
  into result;
  return result;
 end if;

 if section='messages' then
  select t.amber_minutes into amber from private.workspace_performance_targets t where t.singleton;
  with msgs as (
   select g.channel,g.direction='guest' received,g.sent_at at_ from private.workspace_guest_messages g
   where g.sent_at>=lower_at and g.sent_at<upper_at and (g.direction='guest' or g.delivery is distinct from 'failed')
   union all
   select 'owner_chat',m.author_id=c.owner_id,m.created_at from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id and c.kind='owner'
   where m.kind='text' and m.created_at>=lower_at and m.created_at<upper_at
   union all
   select 'client_email',m.direction='in',m.sent_at from private.workspace_client_email_messages m
   where m.sent_at>=lower_at and m.sent_at<upper_at and (m.direction='in' or m.status<>'failed')
  ), dated as (select m.channel,m.received,(m.at_ at time zone 'Europe/London')::date d from msgs m),
  ce as (
   select m.id,m.thread_id,m.direction,m.sent_at,lag(m.direction) over(partition by m.thread_id order by m.sent_at,m.id) prev
   from private.workspace_client_email_messages m where m.sent_at<upper_at and m.sent_at>=lower_at-interval '1 day' and (m.direction='in' or m.status<>'failed')
  ), ce_asks as (
   select c.id,c.sent_at,e.at ended_at,e.kind ended_by from ce c
   left join lateral (select y.at,y.kind from (
     select o.sent_at at,'team' kind from private.workspace_client_email_messages o where o.thread_id=c.thread_id and o.direction='out' and o.status<>'failed' and o.sent_at>=c.sent_at
     union all select t.closed_at,'closed' from private.workspace_client_email_threads t where t.id=c.thread_id and t.closed_at>=c.sent_at) y
    order by y.at,y.kind desc limit 1) e on true
   where c.direction='in' and (c.prev is null or c.prev='out') and c.sent_at>=lower_at
  ), times as (
   select g.channel,r.minutes from private.workspace_response_rows(lower_at,upper_at) r join private.workspace_guest_messages g on g.id=r.message_id
   union all select 'owner_chat',r.minutes from private.workspace_client_response_rows(lower_at,upper_at) r
   union all select 'client_email',round((extract(epoch from coalesce(a.ended_at,now())-a.sent_at)/60)::numeric,1) from ce_asks a
    where a.ended_by='team' or (a.ended_by is null and extract(epoch from now()-a.sent_at)/60>amber)
  )
  select jsonb_build_object('section','messages','from',start_on,'to',end_on,
   'byChannel',coalesce((select jsonb_agg(jsonb_build_object('channel',c.channel,'received',c.received,'sent',c.sent) order by c.channel) from (
     select channel,count(*) filter(where received)::int received,count(*) filter(where not received)::int sent from dated group by channel) c),'[]'),
   'byWeek',coalesce((select jsonb_agg(jsonb_build_object('week',w.week,'channel',w.channel,'received',w.received,'sent',w.sent) order by w.week,w.channel) from (
     select date_trunc('week',d)::date as week,channel,count(*) filter(where received)::int received,count(*) filter(where not received)::int sent from dated group by 1,2) w),'[]'),
   'byMonth',coalesce((select jsonb_agg(jsonb_build_object('month',m.month,'channel',m.channel,'received',m.received,'sent',m.sent) order by m.month,m.channel) from (
     select to_char(d,'YYYY-MM') as month,channel,count(*) filter(where received)::int received,count(*) filter(where not received)::int sent from dated group by 1,2) m),'[]'),
   'replyTimes',coalesce((select jsonb_agg(jsonb_build_object('channel',x.channel,'count',x.n,'medianMinutes',x.median,'slowestMinutes',x.slowest) order by x.channel) from (
     select channel,count(*)::int n,round((percentile_cont(0.5) within group(order by minutes))::numeric,1) median,round(max(minutes)::numeric,1) slowest from times group by channel) x),'[]'),
   'amberMinutes',amber)
  into result;
  return result;
 end if;

 if section='time' then
  with h as (
   select s.user_id,s.department,(s.clocked_in_at at time zone 'Europe/London')::date d,
    extract(epoch from coalesce(s.clocked_out_at,now())-s.clocked_in_at)/60 total,private.workspace_shift_unpaid_minutes(s.id) unpaid,
    coalesce(extract(epoch from coalesce(s.clocked_out_at,now())-s.overtime_from)/60,0) overtime,s.clocked_out_at is null running
   from private.workspace_shifts s where s.clocked_in_at>=lower_at and s.clocked_in_at<upper_at
  )
  select jsonb_build_object('section','time','from',start_on,'to',end_on,
   'minutes',(select coalesce(round(sum(total-unpaid)),0)::int from h),'unpaidMinutes',(select coalesce(round(sum(unpaid)),0)::int from h),
   'overtimeMinutes',(select coalesce(round(sum(overtime)),0)::int from h),'shifts',(select count(*) from h),'running',(select count(*) from h where running),
   'byPerson',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,
     'department',coalesce(r.department,(select h2.department from h h2 where h2.user_id=x.user_id group by h2.department order by count(*) desc,h2.department limit 1)),
     'minutes',x.minutes,'unpaidMinutes',x.unpaid,'overtimeMinutes',x.overtime,'shifts',x.shifts,'days',x.days) order by p.full_name,p.user_id) from (
     select user_id,round(sum(total-unpaid))::int minutes,round(sum(unpaid))::int unpaid,round(sum(overtime))::int overtime,count(*)::int shifts,count(distinct d)::int days from h group by user_id) x
     join public.workspace_profiles p on p.user_id=x.user_id left join private.workspace_staff_rota r on r.user_id=x.user_id),'[]'),
   'byDepartment',coalesce((select jsonb_agg(jsonb_build_object('department',x.department,'minutes',x.minutes,'unpaidMinutes',x.unpaid,'overtimeMinutes',x.overtime,'shifts',x.shifts,'people',x.people) order by x.department) from (
     select department,round(sum(total-unpaid))::int minutes,round(sum(unpaid))::int unpaid,round(sum(overtime))::int overtime,count(*)::int shifts,count(distinct user_id)::int people from h group by department) x),'[]'))
  into result;
  return result;
 end if;

 raise exception 'Unknown report' using errcode='22023';
end $fn$;

create or replace function public.workspace_business_report(section text,start_on date,end_on date) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_business_report(section,start_on,end_on);$$;
revoke all on function private.workspace_business_report(text,date,date),public.workspace_business_report(text,date,date) from public,anon;
grant execute on function private.workspace_business_report(text,date,date),public.workspace_business_report(text,date,date) to authenticated;
