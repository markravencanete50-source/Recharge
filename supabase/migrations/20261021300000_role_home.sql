-- Each role's Home (Lee, 15 October 2026): what management's Home does for the business, every other role gets for its
-- own work. One read, private.workspace_role_home(view_role) and its public wrapper, answers the counts and figures for
-- the caller's role, worked out only from what that role may already open:
--  * Work items through private.workspace_operation_access (the rule every work read uses), so a contractor only counts
--    the repairs they can open, a cleaner only their own cleans, and so on.
--  * Properties through the person's own assignments (staff, cleaning manager) or private.workspace_can_property.
--  * Guest conversations through private.guest_inbox_can, client enquiries through private.workspace_can_enquiries, and
--    money only for the finance roles (private.workspace_finance_role()).
-- Nothing here carries a guest's or an enquirer's name or contact, an owner's limits or any money outside Accounts:
-- every value is a count, a share, or (Accounts only) a total in pence.
--
-- view_role: admins and super admins may name a role (View as, previewing a role nobody has yet); they then get that
-- role's Home over their own access. Everyone else may leave it out or name their own role; any other role is refused.
-- Admins' own Home keeps management's overview, so for them (and owners, whose Home uses their own reads) this answers
-- only the role and the day.
--
-- New: private.workspace_role_home(text), public.workspace_role_home(text). Nothing is deleted or dropped; safe to run twice.

create or replace function private.workspace_role_home(view_role text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare
 actor text:=private.workspace_actor_role();
 me uuid:=auth.uid();
 who text;
 preview boolean;
 today date:=(now() at time zone 'Europe/London')::date;
 week_start date;
 month_start date;
 month_end date;
 month_from timestamptz;
 props uuid[];
 policy_limit bigint;
 result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if view_role is not null and view_role not in ('admin','super_admin','stays','cleaning_manager','cleans','ready','accounts','client') then
  raise exception 'Choose a role' using errcode='22023';
 end if;
 preview:=actor in ('admin','super_admin');
 if preview then who:=coalesce(view_role,actor);
 elsif view_role is null or view_role=actor then who:=actor;
 else raise exception 'Only your own Home can be read' using errcode='42501';
 end if;
 week_start:=date_trunc('week',today)::date;
 month_start:=date_trunc('month',today)::date;
 month_end:=(month_start+interval '1 month')::date;
 month_from:=month_start::timestamp at time zone 'Europe/London';
 result:=jsonb_build_object('role',who,'today',today,'weekStart',week_start,'month',to_char(month_start,'YYYY-MM'));

 -- The properties a person looks after: every live one for management, else their own staff assignments.
 props:=array(select p.id from public.workspace_properties p where p.status<>'archived' and (preview
  or exists(select 1 from public.workspace_property_assignments a where a.property_id=p.id and a.user_id=me
   and a.assignment=case who when 'cleaning_manager' then 'cleaning_manager' when 'cleans' then 'cleaner' when 'client' then 'client' else 'staff' end)));

 if who='stays' then
  return result||jsonb_build_object(
   -- Needs.
   'guestsWaiting',case when private.guest_inbox_can(null) then (select count(*) from private.workspace_guest_threads t
     where t.status='open' and private.guest_inbox_can(t.property_id) and (private.guest_thread_json(t)->>'waitingSince') is not null) end,
   'enquiriesToValue',case when private.workspace_can_enquiries() then (select count(*) from private.workspace_client_enquiries e
     where e.status='received' and coalesce((select j.stage from private.workspace_journeys j where j.property_id=e.property_id),'enquiry')='enquiry') end,
   'cleansToReview',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='cleaning' and d.data->>'phase'='review' and w.status not in ('completed','cancelled','declined') and private.workspace_operation_access(w.id)),
   'repairsToRefer',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='maintenance' and d.data->>'phase'='triage' and w.status not in ('completed','cancelled','declined') and private.workspace_operation_access(w.id)),
   'listingsToCheck',case when private.has_workspace_module('listing-health') then (select count(*) from public.workspace_properties p
     where p.status='active' and private.workspace_can_property(p.id,'listing-health') and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
      where w.property_id=p.id and d.kind='listing_health' and d.data->>'checkedOn'=to_char(today,'YYYY-MM-DD'))) end,
   'relistingsOpen',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='relisting' and w.status not in ('completed','cancelled','declined') and private.workspace_operation_access(w.id)),
   'emptyNights',case when private.has_workspace_module('daily-pricing') then (select count(*) from public.workspace_properties p
     cross join generate_series(today::timestamp,(today+6)::timestamp,interval '1 day') n
     where p.status='active' and private.workspace_can_property(p.id,'daily-pricing')
      and not exists(select 1 from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.check_in<=n::date and r.check_out>n::date)
      and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
       where w.property_id=p.id and d.kind='daily_pricing' and d.data->>'night'=to_char(n,'YYYY-MM-DD'))) end,
   -- Figures: today's arrivals and departures and cleans at their properties, and the repairs still open.
   'checkInsToday',(select count(*) from private.workspace_reservations r where r.property_id=any(props) and r.status='confirmed' and r.check_in=today),
   'checkInsTomorrow',(select count(*) from private.workspace_reservations r where r.property_id=any(props) and r.status='confirmed' and r.check_in=today+1),
   'checkOutsToday',(select count(*) from private.workspace_reservations r where r.property_id=any(props) and r.status='confirmed' and r.check_out=today),
   'cleansToday',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='cleaning' and w.due_on=today and w.status not in ('cancelled','declined') and private.workspace_operation_access(w.id)),
   'cleansDoneToday',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='cleaning' and w.due_on=today and w.status in ('in_review','approved','completed') and private.workspace_operation_access(w.id)),
   'openRepairs',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='maintenance' and w.status not in ('completed','cancelled','declined') and coalesce(d.data->>'phase','triage') not in ('completed','resolved','closed')
      and private.workspace_operation_access(w.id)));
 end if;

 if who in ('cleaning_manager','cleans') then
  -- Cleans whose first review was this month, and how many passed it (a rejection later overturned counts as passed).
  result:=result||(select jsonb_build_object('reviewedFirst',count(*),'acceptedFirst',count(*) filter(where f.accepted or f.overturned_at is not null))
   from (select distinct on (r.work_id) r.work_id,r.cleaner_id,r.accepted,r.overturned_at,r.created_at from private.workspace_cleaning_reviews r order by r.work_id,r.created_at,r.id) f
   where f.created_at>=month_from and case when who='cleans' then f.cleaner_id=me else private.workspace_operation_access(f.work_id) end);
 end if;

 if who='cleaning_manager' then
  return result||(select jsonb_build_object(
   'unassignedToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.assignee_id is null and w.status not in ('completed','cancelled','declined')),
   'unassignedTomorrow',count(*) filter(where d.kind='cleaning' and w.due_on=today+1 and w.assignee_id is null and w.status not in ('completed','cancelled','declined')),
   'toReview',count(*) filter(where d.kind='cleaning' and d.data->>'phase'='review' and w.status not in ('completed','cancelled','declined')),
   'disputes',count(*) filter(where d.kind='cleaning_complaint' and w.status not in ('completed','cancelled','declined')),
   'complaintsThisMonth',count(*) filter(where d.kind='cleaning_complaint' and w.created_at>=month_from),
   'cleansToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status not in ('cancelled','declined')),
   'cleansDoneToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status in ('in_review','approved','completed')),
   'cleansThisWeek',count(*) filter(where d.kind='cleaning' and w.due_on>=week_start and w.due_on<week_start+7 and w.status not in ('cancelled','declined')))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind in ('cleaning','cleaning_complaint') and (w.due_on>=week_start or w.due_on is null or w.status not in ('completed','cancelled','declined') or w.created_at>=month_from)
    and private.workspace_operation_access(w.id))
   ||jsonb_build_object('restockOpen',case when private.has_workspace_module('replenishment-requests') then (select count(*) from public.workspace_work_items w
     where w.module_id='replenishment-requests' and w.status not in ('completed','cancelled','declined') and private.workspace_can_work(w.id)) end);
 end if;

 if who='cleans' then
  -- A cleaner's own cleans only (assigned to them), whoever previews.
  return result||(select jsonb_build_object(
   'cleansToday',count(*) filter(where w.due_on=today and not redo and w.status not in ('in_review','approved','completed')),
   'overdue',count(*) filter(where w.due_on<today and not redo and w.status not in ('in_review','approved','completed')),
   'redo',count(*) filter(where redo and w.status not in ('in_review','approved','completed')),
   'cleansThisWeek',count(*) filter(where w.due_on>=week_start and w.due_on<week_start+7),
   'doneThisMonth',count(*) filter(where w.due_on>=month_start and w.due_on<month_end and w.status in ('in_review','approved','completed')))
   from (select w.*,coalesce(d.data->>'phase'='assigned' and d.data->'accepted'='false'::jsonb,false) redo
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and w.assignee_id=me and w.status not in ('cancelled','declined')) w)
   ||jsonb_build_object('toRespond',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='cleaning_complaint' and d.data->>'cleanerId'=me::text and w.status not in ('completed','cancelled','declined')
      and coalesce(d.data->>'cleanerStatement','')='' and coalesce(d.data->>'decision','')=''));
 end if;

 if who='ready' then
  -- Repairs a contractor can open (once referred to Ready, and only their own once a job names its contractor), and
  -- routine visits that are theirs or nobody's yet. bookingApprovedAt and team_review come with contractor estimates;
  -- without them every referred repair is a new job.
  return result||(select jsonb_build_object(
   'newJobs',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='referred' and d.data->>'bookingApprovedAt' is null),
   'approvedToBook',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='referred' and d.data->>'bookingApprovedAt' is not null),
   'repairsToday',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='booked' and d.data->>'repairOn'=to_char(today,'YYYY-MM-DD')),
   'toMarkDone',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='booked' and d.data->>'repairOn'<to_char(today,'YYYY-MM-DD')),
   'openJobs',count(*) filter(where d.kind='maintenance' and d.data->>'phase' in ('referred','booked','team_review')),
   'repairsThisWeek',count(*) filter(where d.kind='maintenance' and d.data->>'phase' in ('booked','completed')
     and d.data->>'repairOn'>=to_char(week_start,'YYYY-MM-DD') and d.data->>'repairOn'<to_char(week_start+7,'YYYY-MM-DD')),
   'repairsDoneThisMonth',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='completed' and coalesce(w.completed_at,w.updated_at)>=month_from))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='maintenance' and w.status not in ('cancelled','declined') and (w.status<>'completed' or coalesce(w.completed_at,w.updated_at)>=month_from)
    and private.workspace_operation_access(w.id))
   ||(select jsonb_build_object(
   'visitsToday',count(*) filter(where w.due_on=today and w.status in ('waiting','in_progress')),
   'visitsOverdue',count(*) filter(where w.due_on<today and w.status in ('waiting','in_progress')),
   'visitsThisWeek',count(*) filter(where w.due_on>=week_start and w.due_on<week_start+7),
   'visitsDoneThisMonth',count(*) filter(where w.due_on>=month_start and w.due_on<month_end and w.status in ('in_review','approved','completed')))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='routine_visit' and w.status not in ('cancelled','declined') and (w.assignee_id=me or w.assignee_id is null)
    and private.workspace_operation_access(w.id));
 end if;

 if who='accounts' then
  if not private.workspace_finance_role() then raise exception 'Accounts access required' using errcode='42501';end if;
  select f.expense_approval_limit_minor into policy_limit from private.workspace_finance_policy f where f.singleton;
  return result||jsonb_build_object(
   -- Needs. Accounts approve expenses up to the approval limit; above it management decide.
   'expensesToApprove',(select count(*) from private.workspace_expenses x where x.status='to_approve' and (policy_limit is null or x.amount_minor<=policy_limit)),
   'payoutsOverdue',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com','vrbo')
     and private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)<today and private.workspace_payout_due_on(r.channel,r.check_in,r.check_out)>=(month_start-interval '1 month')::date
     and private.workspace_payout_row(r)->>'state' in ('missing','different')),
   'statementsToIssue',case when private.has_workspace_module('owner-statements') then (select count(*) from private.workspace_owner_statements s where s.status='draft') end,
   'cleanerInvoicesToApprove',(select count(*) from private.workspace_cleaner_invoices i where i.status='to_approve'),
   'purchasesToApprove',case when private.has_workspace_module('purchase-order-accounts') then (select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='purchase' and d.data->>'phase'='requested' and w.status not in ('completed','cancelled','declined')) end,
   'purchaseInvoicesToRecord',case when private.has_workspace_module('purchase-order-accounts') then (select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where d.kind='purchase' and d.data->>'phase'='delivered' and w.status not in ('completed','cancelled','declined')) end,
   -- Figures for this month, in pence.
   'payoutsReceivedMinor',(select coalesce(sum(l.amount_minor),0) from private.workspace_payout_lines l where l.set_aside_at is null and l.paid_on>=month_start and l.paid_on<month_end),
   'expensesMinor',(select coalesce(sum(x.amount_minor),0) from private.workspace_expenses x where x.status<>'rejected' and x.received_on>=month_start and x.received_on<month_end),
   'expensesCount',(select count(*) from private.workspace_expenses x where x.status<>'rejected' and x.received_on>=month_start and x.received_on<month_end),
   'statementsIssued',case when private.has_workspace_module('owner-statements') then (select count(*) from private.workspace_owner_statements s where s.status in ('issued','paid') and s.issued_at>=month_from) end,
   'ownerPayoutsMinor',case when private.has_workspace_module('owner-statements') then (select coalesce(sum(s.payout_minor),0) from private.workspace_owner_statements s where s.status='paid' and s.paid_at>=month_from) end);
 end if;

 -- Management (their Home reads the overview) and owners (their Home reads their own figures and approvals).
 return result;
end $fn$;

create or replace function public.workspace_role_home(view_role text default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_role_home(view_role);$$;

revoke all on function private.workspace_role_home(text),public.workspace_role_home(text) from public,anon;
grant execute on function private.workspace_role_home(text),public.workspace_role_home(text) to authenticated;
