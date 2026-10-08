-- Management oversight: the business at a glance for admins, owners chased when an approval stalls
-- (a reminder after 48 hours, then client relations after 96), yesterday's unfinished Stays checks
-- rolled over for management, unusual owner payouts, and a history of every change and decision.

-- When a repair starts waiting for the owner's approval, wherever that happens (a new request
-- above the owner's limit, or a quote revised above it), so waits are measured from then.
create function private.workspace_stamp_owner_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='maintenance' and new.data->>'phase'='owner_approval' and (tg_op='INSERT' or old.data->>'phase' is distinct from 'owner_approval') then
  new.data:=new.data||jsonb_build_object('ownerApprovalSince',now());
 end if;
 return new;
end $$;
create trigger owner_approval_stamped before insert or update of data on private.workspace_domain_details for each row execute function private.workspace_stamp_owner_approval();

-- Everything waiting on an owner: repairs at owner approval, and published estimates awaiting the
-- owner's decision. Older repairs without the stamp fall back to the revised quote or creation time.
create function private.workspace_owner_waits() returns table(kind text,work_id uuid,property_id uuid,title text,waiting_since timestamptz,estimated_cost_minor bigint)
language sql stable security definer set search_path='' as $$
 select 'repair'::text,w.id,w.property_id,w.title,
  coalesce((d.data->>'ownerApprovalSince')::timestamptz,case when d.data->>'resumePhase' is not null then (d.data->>'quoteRevisedAt')::timestamptz end,w.created_at),
  (d.data->>'estimatedCostMinor')::bigint
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.status not in ('completed','cancelled','declined')
 union all
 select 'estimate'::text,j.work_id,j.property_id,'Estimate waiting for the owner’s decision',
  coalesce((select max(a.created_at) from public.workspace_activity a where a.property_id=j.property_id and a.event_type='journey.publishEstimate'),j.updated_at),null::bigint
 from private.workspace_journeys j join public.workspace_properties p on p.id=j.property_id where j.stage='estimate' and p.status<>'archived';
$$;

-- One row per wait (a repair that goes back to the owner later starts a new one), so each
-- reminder and escalation goes out once.
create table private.workspace_owner_chases (
 work_id uuid not null references public.workspace_work_items(id) on delete cascade,
 waiting_since timestamptz not null,
 kind text not null check(kind in ('repair','estimate')),
 reminded_at timestamptz,
 escalated_at timestamptz,
 escalated_to uuid[] not null default '{}',
 manual_at timestamptz,
 manual_by uuid references public.workspace_profiles(user_id),
 manual_count integer not null default 0,
 created_at timestamptz not null default now(),
 primary key(work_id,waiting_since)
);
alter table private.workspace_owner_chases enable row level security;
revoke all on private.workspace_owner_chases from public,anon,authenticated;

-- A notice to the property's owners that something is waiting for them.
create function private.workspace_remind_owner(target uuid,waiting_kind text,prop uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare ev bigint;sent integer;begin
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type,created_at)
  values(auth.uid(),prop,target,case waiting_kind when 'repair' then 'repairs.owner_reminder' else 'journey.estimate_reminder' end,at_time) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
  select a.user_id,target,ev from public.workspace_property_assignments a join public.workspace_profiles u on u.user_id=a.user_id
  where a.property_id=prop and a.assignment='client' and u.status='active' on conflict do nothing;
 get diagnostics sent=row_count;
 return sent;
end $$;

-- Who chases an owner: client relations on the property, else anyone in client relations, else admins.
create function private.workspace_owner_chasers(prop uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(
  nullif(array(select r.user_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id
    join public.workspace_property_assignments a on a.user_id=r.user_id and a.property_id=prop and a.assignment='staff'
    where r.department='client_relations' and p.status='active' and p.role<>'client' order by r.user_id),'{}'),
  nullif(array(select r.user_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id
    where r.department='client_relations' and p.status='active' and p.role<>'client' order by r.user_id),'{}'),
  array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' order by p.user_id));
$$;

-- Run by the backend every 15 minutes: owners get one reminder once something has waited 48 hours,
-- and client relations are told once it has waited 96. Bounded per run; the next run carries on.
create function private.workspace_chase_owner_approvals(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;ev bigint;who uuid[];reminded integer:=0;escalated integer:=0;begin
 perform pg_advisory_xact_lock(hashtext('workspace_chase_owner_approvals'));
 for r in select o.kind wait_kind,o.work_id,o.property_id,o.waiting_since,x.reminded_at,x.escalated_at from private.workspace_owner_waits() o
   left join private.workspace_owner_chases x on x.work_id=o.work_id and x.waiting_since=o.waiting_since
   where o.waiting_since<=at_time-interval '48 hours' and (x.reminded_at is null or (x.escalated_at is null and o.waiting_since<=at_time-interval '96 hours'))
   order by o.waiting_since,o.work_id limit 50 loop
  insert into private.workspace_owner_chases(work_id,waiting_since,kind) values(r.work_id,r.waiting_since,r.wait_kind) on conflict do nothing;
  if r.reminded_at is null then
   perform private.workspace_remind_owner(r.work_id,r.wait_kind,r.property_id,at_time);
   update private.workspace_owner_chases set reminded_at=at_time where work_id=r.work_id and waiting_since=r.waiting_since;
   reminded:=reminded+1;
  end if;
  if r.escalated_at is null and r.waiting_since<=at_time-interval '96 hours' then
   who:=private.workspace_owner_chasers(r.property_id);
   -- Tied to the property, not the item, so client relations see it even without the repair tool.
   insert into public.workspace_activity(property_id,event_type,created_at)
    values(r.property_id,case r.wait_kind when 'repair' then 'repairs.owner_escalated' else 'journey.estimate_escalated' end,at_time) returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(who) u on conflict do nothing;
   update private.workspace_owner_chases set escalated_at=at_time,escalated_to=who where work_id=r.work_id and waiting_since=r.waiting_since;
   escalated:=escalated+1;
  end if;
 end loop;
 return jsonb_build_object('reminded',reminded,'escalated',escalated);
end $$;
create function public.workspace_chase_owner_approvals() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_chase_owner_approvals() $$;

-- The management queue's owner approvals: how long each has waited and when the owner was last reminded.
create function private.workspace_stalled_owner_approvals() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',o.work_id,'kind',o.kind,'title',o.title,'propertyId',o.property_id,'propertyName',p.name,
   'estimatedCostMinor',o.estimated_cost_minor,'waitingSince',o.waiting_since,'remindedAt',greatest(x.reminded_at,x.manual_at),'escalatedAt',x.escalated_at,
   'canRemindAt',greatest(x.reminded_at,x.manual_at)+interval '24 hours') order by o.waiting_since,o.work_id),'[]')
 from private.workspace_owner_waits() o join public.workspace_properties p on p.id=o.property_id
 left join private.workspace_owner_chases x on x.work_id=o.work_id and x.waiting_since=o.waiting_since
 where o.waiting_since<now()-interval '48 hours';
$$;

-- Unusual owner payouts: statements not yet paid whose payout is negative, or more than 50% below
-- or above the property's average over its previous three statements. Hidden once management
-- approves that payout.
create table private.workspace_payout_approvals (
 statement_id uuid not null references private.workspace_owner_statements(id) on delete cascade,
 payout_minor bigint not null,
 approved_by uuid not null references public.workspace_profiles(user_id),
 approved_at timestamptz not null default now(),
 note text not null default '' check(length(note)<=2000),
 primary key(statement_id,payout_minor)
);
alter table private.workspace_payout_approvals enable row level security;
revoke all on private.workspace_payout_approvals from public,anon,authenticated;

create function private.workspace_unusual_payouts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(private.workspace_statement_view(x.s)||jsonb_build_object('averageMinor',x.average_minor,'previousStatements',x.previous,'reason',x.reason)
   order by (x.s).period_start,(x.s).id),'[]')
 from (
  select s,prev.average_minor,prev.previous,
   case when s.payout_minor<0 then 'negative'
    when prev.average_minor>0 and s.payout_minor<prev.average_minor*0.5 then 'low'
    when prev.average_minor>0 and s.payout_minor>prev.average_minor*1.5 then 'high' end reason
  from private.workspace_owner_statements s
  cross join lateral (select round(avg(t.payout_minor))::bigint average_minor,count(*)::integer previous from (
    select q.payout_minor from private.workspace_owner_statements q where q.property_id=s.property_id and q.status<>'void' and q.period_start<s.period_start
    order by q.period_start desc limit 3) t) prev
  where s.status in ('draft','issued') and not exists(select 1 from private.workspace_payout_approvals a where a.statement_id=s.id and a.payout_minor=s.payout_minor)
 ) x where x.reason is not null;
$$;

-- Yesterday's Stays checks: each morning after 08:00 (London), anyone on the Stays team who worked a
-- guest or client relations shift yesterday but didn't sign off, or whose listing checks weren't
-- done, rolls over to management until an admin marks it as seen.
create table private.workspace_missed_days (
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 day date not null,
 signed_off boolean not null,
 listings_due integer not null default 0,
 missed_listings jsonb not null default '[]',
 created_at timestamptz not null default now(),
 seen_at timestamptz,
 seen_by uuid references public.workspace_profiles(user_id),
 primary key(user_id,day)
);
create table private.workspace_rollover_runs (
 day date primary key,
 missed integer not null,
 ran_at timestamptz not null default now()
);
alter table private.workspace_missed_days enable row level security;
alter table private.workspace_rollover_runs enable row level security;
revoke all on private.workspace_missed_days,private.workspace_rollover_runs from public,anon,authenticated;

create function private.workspace_roll_over_signoffs(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=(at_time at time zone 'Europe/London')::date;yesterday date:=today-1;person record;missed jsonb;due integer;signed boolean;n integer:=0;ev bigint;begin
 if extract(hour from at_time at time zone 'Europe/London')<8 then return jsonb_build_object('day',yesterday,'ran',false);end if;
 perform pg_advisory_xact_lock(hashtext('workspace_roll_over_signoffs'));
 if exists(select 1 from private.workspace_rollover_runs where day=yesterday) then return jsonb_build_object('day',yesterday,'ran',false);end if;
 for person in select p.user_id from public.workspace_profiles p where p.role='stays' and p.status='active'
   and exists(select 1 from private.workspace_shifts s where s.user_id=p.user_id and s.department in ('guest_relations','client_relations') and (s.clocked_in_at at time zone 'Europe/London')::date=yesterday)
   order by p.user_id limit 500 loop
  signed:=exists(select 1 from private.workspace_daily_signoffs o where o.user_id=person.user_id and o.day=yesterday);
  -- Their live properties (with the listing health tool), and those with no listing check dated yesterday.
  due:=(select count(*) from public.workspace_properties pr where pr.status='active'
    and exists(select 1 from public.workspace_property_assignments a where a.property_id=pr.id and a.user_id=person.user_id and a.assignment='staff')
    and exists(select 1 from public.workspace_module_grants g where g.user_id=person.user_id and g.module_id='listing-health'));
  missed:=coalesce((select jsonb_agg(jsonb_build_object('propertyId',pr.id,'propertyName',pr.name) order by pr.name,pr.id) from public.workspace_properties pr where pr.status='active'
    and exists(select 1 from public.workspace_property_assignments a where a.property_id=pr.id and a.user_id=person.user_id and a.assignment='staff')
    and exists(select 1 from public.workspace_module_grants g where g.user_id=person.user_id and g.module_id='listing-health')
    and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where w.property_id=pr.id and d.kind='listing_health' and d.data->>'checkedOn'=to_char(yesterday,'YYYY-MM-DD'))),'[]');
  if not signed or jsonb_array_length(missed)>0 then
   insert into private.workspace_missed_days(user_id,day,signed_off,listings_due,missed_listings) values(person.user_id,yesterday,signed,due,missed) on conflict do nothing;
   n:=n+1;
  end if;
 end loop;
 insert into private.workspace_rollover_runs(day,missed) values(yesterday,n);
 if n>0 then
  insert into public.workspace_activity(event_type,created_at) values('stays.missed_yesterday',at_time) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id) select p.user_id,ev from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' on conflict do nothing;
 end if;
 return jsonb_build_object('day',yesterday,'ran',true,'missed',n);
end $$;
create function public.workspace_roll_over_signoffs() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_roll_over_signoffs() $$;

create function private.workspace_missed_days_json() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'fullName',p.full_name,'day',m.day,'signedOff',m.signed_off,'listingsDue',m.listings_due,
   'missedListings',m.missed_listings,'createdAt',m.created_at) order by m.day desc,p.full_name,m.user_id),'[]')
 from private.workspace_missed_days m join public.workspace_profiles p on p.user_id=m.user_id
 where m.seen_at is null and m.day>=(now() at time zone 'Europe/London')::date-14;
$$;

-- People's own writes count towards the usual per-minute limit.
do $$
declare t text;begin
 foreach t in array array['workspace_owner_chases','workspace_payout_approvals','workspace_missed_days'] loop
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Across the business, for admins' Home: Stays, Cleans, Ready and Accounts at a glance.
create function private.workspace_management_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();today date:=(now() at time zone 'Europe/London')::date;month_start date;month_end date;begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 month_start:=date_trunc('month',today)::date;month_end:=(month_start+interval '1 month')::date;
 return jsonb_build_object('today',today,
  'stays',jsonb_build_object(
   'listingsToCheck',(select count(*) from public.workspace_properties p where p.status='active' and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where w.property_id=p.id and d.kind='listing_health' and d.data->>'checkedOn'=to_char(today,'YYYY-MM-DD'))),
   'relistingsOpen',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='relisting' and w.status not in ('completed','cancelled')),
   'emptyNights',(select count(*) from public.workspace_properties p cross join generate_series(today::timestamp,(today+6)::timestamp,interval '1 day') n where p.status='active'
     and not exists(select 1 from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.check_in<=n::date and r.check_out>n::date)
     and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='daily_pricing' and d.data->>'night'=to_char(n,'YYYY-MM-DD'))),
   'guestsWaiting',case when private.has_workspace_module('guest-communication') then (select count(*) from private.workspace_guest_threads t where t.status='open' and (private.guest_thread_json(t)->>'waitingSince') is not null) end),
  'cleans',(select jsonb_build_object(
   'today',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status not in ('cancelled','declined')),
   'doneToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status='completed'),
   'unassignedToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.assignee_id is null and w.status not in ('completed','cancelled','declined')),
   'toReview',count(*) filter(where d.kind='cleaning' and d.data->>'phase'='review' and w.status not in ('completed','cancelled')),
   'disputes',count(*) filter(where d.kind='cleaning_complaint' and w.status not in ('completed','cancelled')))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind in ('cleaning','cleaning_complaint')),
  'ready',(select jsonb_build_object(
   'ownerApproval',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='owner_approval'),
   'toRefer',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='triage'),
   'referred',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='referred'),
   'booked',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='booked'),
   'visitsDue',count(*) filter(where d.kind='routine_visit' and w.due_on>=month_start and w.due_on<month_end))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind in ('maintenance','routine_visit') and w.status not in ('completed','cancelled','declined')),
  'accounts',jsonb_build_object(
   'expensesToApprove',(select count(*) from private.workspace_expenses x where x.status='to_approve'),
   'overLimit',(select count(*) from private.workspace_expenses x,private.workspace_finance_policy f where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'payoutsToReconcile',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=month_start and r.check_in<month_end
     and private.workspace_payout_row(r)->>'settledMinor' is null),
   'statementsToIssue',(select count(*) from private.workspace_owner_statements s where s.status='draft')));
end $$;

-- One work item's history: status changes with their notes, each step taken (with what was
-- recorded for it), clean reviews, expense decisions and owner chases. Same access as the item.
create function private.workspace_work_history(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();d private.workspace_domain_details;staff boolean;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if target is null or not private.workspace_operation_access(target) then raise exception 'Work not found' using errcode='P0002';end if;
 d:=(select x from private.workspace_domain_details x where x.work_id=target);
 staff:=actor not in ('client','cleans');
 return jsonb_build_object('kind',d.kind,'entries',coalesce((select jsonb_agg(h.e order by h.happened,h.n) from (
  select u.created_at happened,1 n,jsonb_build_object('type','status','at',u.created_at,'by',p.full_name,'from',u.previous_status,'to',u.next_status,'note',nullif(u.note,'')) e
   from public.workspace_work_updates u left join public.workspace_profiles p on p.user_id=u.actor_id where u.work_id=target
  union all
  select a.created_at,2,jsonb_build_object('type','event','at',a.created_at,'by',p.full_name,'event',a.event_type,
    'note',nullif(case a.event_type
     when 'operations.createOperation' then coalesce(d.data->>'issue',d.data->>'evidence',d.data->>'reason',d.data->>'requirements',d.data->>'summary')
     when 'operations.updateOperation.referReady' then case when staff then d.data->>'troubleshooting' else d.data->>'guestUpdate' end
     when 'operations.updateOperation.bookRepair' then concat_ws(' · ',d.data->>'contractor',d.data->>'repairOn')
     when 'operations.updateOperation.completeRepair' then d.data->>'report'
     when 'operations.updateOperation.reviseQuote' then d.data->>'quoteReason'
     when 'operations.updateOperation.startRelisting' then d.data->>'note'
     when 'operations.updateOperation.recordApplied' then d.data->>'evidence'
     when 'operations.updateOperation.completeHandover' then d.data->>'evidence'
     when 'operations.updateOperation.recordGuestDecline' then d.data->>'reason'
     when 'operations.updateOperation.recordGuestAcceptance' then case when staff then d.data->>'guestEvidence' end
     when 'operations.updateOperation.approvePurchase' then d.data->>'approvalNote'
     when 'operations.updateOperation.recordOrder' then concat_ws(' · ',d.data->>'supplier',d.data->>'orderReference')
     when 'operations.updateOperation.recordDelivery' then d.data->>'evidence'
     when 'operations.updateOperation.reconcilePurchase' then d.data->>'reconciliation'
     when 'operations.updateOperation.submitApplication' then concat_ws(' · ',d.data->>'authority',d.data->>'applicationReference')
     when 'operations.updateOperation.recordSafetyChecks' then d.data->>'evidence'
     when 'operations.updateOperation.recordGranted' then d.data->>'evidence'
     when 'operations.updateOperation.submitCleaning' then d.data->>'report'
     when 'cleaning.cleaner_responded' then d.data->>'cleanerStatement'
    end,''),
    'evidence',case a.event_type
     when 'operations.updateOperation.submitCleaning' then jsonb_array_length(coalesce(d.data->'photoIds','[]'))||' photos'
     when 'operations.updateOperation.recordDelivery' then jsonb_array_length(coalesce(d.data->'photoIds','[]'))||' delivery photos'
     when 'operations.updateOperation.approveBudget' then 'Owner’s consent recorded'
     when 'operations.updateOperation.recordSafetyChecks' then 'Safety checklist complete'
     when 'operations.updateOperation.recordGranted' then 'Licence '||coalesce(d.data->>'reference','')
     when 'operations.updateOperation.reconcilePurchase' then 'Paid invoice matched'
     when 'operations.updateOperation.confirmBooking' then 'Paid booking invoice matched'
     when 'operations.updateOperation.referReady' then case when staff and d.data->>'warrantyContactEvidence' is not null then 'Warranty contacted' end
    end)
   from public.workspace_activity a left join public.workspace_profiles p on p.user_id=a.actor_id
   where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning')
  union all
  select r.created_at,3,jsonb_build_object('type','review','at',r.created_at,'by',p.full_name,'accepted',r.accepted,'note',r.review_note,'guestFeedback',r.guest_feedback)
   from private.workspace_cleaning_reviews r left join public.workspace_profiles p on p.user_id=r.reviewer_id where r.work_id=target and actor<>'client'
  union all
  select r.overturned_at,4,jsonb_build_object('type','overturned','at',r.overturned_at,'by',p.full_name,'note',r.overturn_note)
   from private.workspace_cleaning_reviews r left join public.workspace_profiles p on p.user_id=r.overturned_by where r.work_id=target and r.overturned_at is not null and actor<>'client'
  union all
  select x.decided_at,5,jsonb_build_object('type','expense','at',x.decided_at,'by',p.full_name,'status',x.status,'note',x.decision_note,'amountMinor',x.amount_minor,'supplier',x.supplier)
   from private.workspace_expenses x left join public.workspace_profiles p on p.user_id=x.decided_by where x.work_id=target and x.decided_at is not null and actor in ('admin','super_admin','accounts')
  union all
  select c.escalated_at,6,jsonb_build_object('type','escalated','at',c.escalated_at,'to',(select string_agg(p.full_name,', ' order by p.full_name) from public.workspace_profiles p where p.user_id=any(c.escalated_to)))
   from private.workspace_owner_chases c where c.work_id=target and c.escalated_at is not null and staff
  order by 1,2 limit 300) h),'[]'));
end $$;

-- Management decisions over the last 90 days, newest first: repairs the owner approved, work
-- approved or declined, expenses decided, clean disputes, cleaner reviews and payouts approved.
create function private.workspace_decisions_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz:=now()-interval '90 days';begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(r.e order by r.happened desc) from (
  select (d.data->>'ownerApprovedAt')::timestamptz happened,jsonb_build_object('at',d.data->>'ownerApprovedAt','area','repairs','decision','Repair approved by the owner','outcome','approved',
    'title',w.title,'propertyName',pr.name,'amountMinor',(d.data->>'estimatedCostMinor')::bigint,'by',p.full_name,'note',null) e
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id::text=d.data->>'ownerApprovedBy'
   where d.kind='maintenance' and (d.data->>'ownerApprovedAt')::timestamptz>=since
  union all
  select u.created_at,jsonb_build_object('at',u.created_at,'area','work','decision',case u.next_status when 'approved' then 'Work approved' else 'Work declined' end,'outcome',u.next_status,
    'title',w.title,'propertyName',pr.name,'amountMinor',null,'by',p.full_name,'note',nullif(u.note,''))
   from public.workspace_work_updates u join public.workspace_work_items w on w.id=u.work_id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id=u.actor_id
   where u.next_status in ('approved','declined') and u.created_at>=since
  union all
  select x.decided_at,jsonb_build_object('at',x.decided_at,'area','accounts','decision',case x.status when 'approved' then 'Expense approved' else 'Expense rejected' end,'outcome',x.status,
    'title',x.supplier||' · '||x.reference,'propertyName',pr.name,'amountMinor',x.amount_minor,'by',p.full_name,'note',x.decision_note)
   from private.workspace_expenses x join public.workspace_properties pr on pr.id=x.property_id left join public.workspace_profiles p on p.user_id=x.decided_by
   where x.status in ('approved','rejected') and x.decided_at>=since
  union all
  select (d.data->>'decidedAt')::timestamptz,jsonb_build_object('at',d.data->>'decidedAt','area','cleans',
    'decision',case d.kind when 'cleaning_complaint' then 'Clean dispute' else 'Cleaner review' end,'outcome',d.data->>'decision',
    'title',coalesce(c.full_name,'Cleaner'),'propertyName',pr.name,'amountMinor',null,'by',p.full_name,'note',d.data->>'decisionNote')
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id::text=d.data->>'decidedBy' left join public.workspace_profiles c on c.user_id::text=d.data->>'cleanerId'
   where d.kind in ('cleaning_complaint','cleaner_management_review') and (d.data->>'decidedAt')::timestamptz>=since
  union all
  select a.approved_at,jsonb_build_object('at',a.approved_at,'area','accounts','decision','Owner payout approved','outcome','approved',
    'title',to_char(s.period_start,'YYYY-MM')||' statement','propertyName',pr.name,'amountMinor',a.payout_minor,'by',p.full_name,'note',nullif(a.note,''))
   from private.workspace_payout_approvals a join private.workspace_owner_statements s on s.id=a.statement_id join public.workspace_properties pr on pr.id=s.property_id
   left join public.workspace_profiles p on p.user_id=a.approved_by where a.approved_at>=since
  order by 1 desc limit 1000) r),'[]');
end $$;

-- Reads for the oversight screens.
create function private.workspace_oversight_read(section text,target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='overview' then return private.workspace_management_overview();
 elsif section='history' then return private.workspace_work_history(target);
 elsif section='decisions' then return private.workspace_decisions_report();
 end if;
 raise exception 'Unknown oversight section' using errcode='22023';
end $$;

-- Management's own actions: remind an owner now (once a day per item), mark a missed day as seen,
-- and approve an unusual owner payout.
create function private.workspace_oversight_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;target uuid;
 wait_kind text;wait_since timestamptz;wait_property uuid;last_reminder timestamptz;sent integer;s private.workspace_owner_statements;begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,40);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.request_id is not null then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='remindOwner' then
  perform private.workspace_json_keys(input,array['action','requestId','workId']);
  target:=(input->>'workId')::uuid;
  wait_since:=(select o.waiting_since from private.workspace_owner_waits() o where o.work_id=target limit 1);
  if wait_since is null then raise exception 'Nothing on this item is waiting for the owner' using errcode='22023';end if;
  wait_kind:=(select o.kind from private.workspace_owner_waits() o where o.work_id=target limit 1);
  wait_property:=(select w.property_id from public.workspace_work_items w where w.id=target);
  last_reminder:=(select greatest(c.reminded_at,c.manual_at) from private.workspace_owner_chases c where c.work_id=target and c.waiting_since=wait_since);
  if last_reminder>now()-interval '24 hours' then raise exception 'The owner was reminded in the last 24 hours. You can remind them again tomorrow.' using errcode='22023';end if;
  if not exists(select 1 from public.workspace_property_assignments pa join public.workspace_profiles u on u.user_id=pa.user_id where pa.property_id=wait_property and pa.assignment='client' and u.status='active') then
   raise exception 'This property has no owner to remind' using errcode='22023';end if;
  -- A reminder sent by hand counts as the 48-hour one, so the owner isn't sent two.
  insert into private.workspace_owner_chases(work_id,waiting_since,kind,reminded_at,manual_at,manual_by,manual_count) values(target,wait_since,wait_kind,now(),now(),auth.uid(),1)
   on conflict(work_id,waiting_since) do update set reminded_at=coalesce(workspace_owner_chases.reminded_at,excluded.reminded_at),manual_at=excluded.manual_at,manual_by=excluded.manual_by,manual_count=workspace_owner_chases.manual_count+1;
  sent:=private.workspace_remind_owner(target,wait_kind,wait_property,now());
  result:=jsonb_build_object('workId',target,'remindedAt',now(),'owners',sent);
 elsif a='markMissedSeen' then
  perform private.workspace_json_keys(input,array['action','requestId','userId','day']);
  update private.workspace_missed_days set seen_at=now(),seen_by=auth.uid() where user_id=(input->>'userId')::uuid and day=(input->>'day')::date and seen_at is null;
  if not found then raise exception 'Already marked as seen' using errcode='P0002';end if;
  result:=jsonb_build_object('userId',input->>'userId','day',input->>'day','seen',true);
 elsif a='approvePayout' then
  perform private.workspace_json_keys(input,array['action','requestId','statementId','version','note']);
  if length(coalesce(input->>'note',''))>2000 then raise exception 'Note is too long' using errcode='22023';end if;
  s:=(select x from private.workspace_owner_statements x where x.id=(input->>'statementId')::uuid);
  if s.id is null then raise exception 'Statement not found' using errcode='P0002';end if;
  if s.version is distinct from (input->>'version')::integer then raise exception 'Statement changed' using errcode='40001';end if;
  if s.status not in ('draft','issued') then raise exception 'Only a statement not yet paid can be approved' using errcode='22023';end if;
  insert into private.workspace_payout_approvals(statement_id,payout_minor,approved_by,note) values(s.id,s.payout_minor,auth.uid(),trim(coalesce(input->>'note',''))) on conflict do nothing;
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),s.property_id,'finance.payout_approved');
  result:=jsonb_build_object('statementId',s.id,'payoutMinor',s.payout_minor,'approved',true);
 else raise exception 'Unknown oversight action' using errcode='22023';end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

create function public.workspace_oversight_read(section text,target uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_oversight_read(section,target);$$;
create function public.workspace_oversight_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_oversight_action(input);$$;

revoke all on function private.workspace_stamp_owner_approval(),private.workspace_owner_waits(),private.workspace_remind_owner(uuid,text,uuid,timestamptz),
 private.workspace_owner_chasers(uuid),private.workspace_stalled_owner_approvals(),private.workspace_unusual_payouts(),private.workspace_missed_days_json(),
 private.workspace_management_overview(),private.workspace_work_history(uuid),private.workspace_decisions_report() from public,anon,authenticated;
revoke all on function private.workspace_chase_owner_approvals(timestamptz),public.workspace_chase_owner_approvals(),
 private.workspace_roll_over_signoffs(timestamptz),public.workspace_roll_over_signoffs() from public,anon,authenticated;
grant execute on function private.workspace_chase_owner_approvals(timestamptz),public.workspace_chase_owner_approvals(),
 private.workspace_roll_over_signoffs(timestamptz),public.workspace_roll_over_signoffs() to service_role;
revoke all on function private.workspace_oversight_read(text,uuid),private.workspace_oversight_action(jsonb),
 public.workspace_oversight_read(text,uuid),public.workspace_oversight_action(jsonb) from public,anon;
grant execute on function private.workspace_oversight_read(text,uuid),private.workspace_oversight_action(jsonb),
 public.workspace_oversight_read(text,uuid),public.workspace_oversight_action(jsonb) to authenticated;

-- The management queue gains unusual payouts and missed days, and measures owner approvals from
-- when they started waiting (the later key replaces the earlier one in the object).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0)$q$,
   $q$'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0),
   'stalledOwnerApprovals',private.workspace_stalled_owner_approvals(),'unusualPayouts',private.workspace_unusual_payouts(),'missedYesterday',private.workspace_missed_days_json()$q$,
   $q$workspace_unusual_payouts$q$]
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
