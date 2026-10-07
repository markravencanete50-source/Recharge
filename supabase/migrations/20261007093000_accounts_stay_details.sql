-- Accounts: list the month's stays that still need a platform code or payout amount.
-- New reservations default to the direct channel with no payout, so they were not
-- shown in reconciliation yet still blocked the owner statement. The overview and
-- statement rows now count them too. Same signature, so existing grants are kept.
create or replace function private.workspace_finance_read(section text,target_property uuid default null,period text default null,target_id uuid default null,status_filter text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();start_on date;end_on date;result jsonb;e private.workspace_expenses;policy private.workspace_finance_policy;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='statements' and actor='client' then
  -- Owners see issued and paid statements for their own properties only.
  select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start desc,s.id),'[]') into result from
   (select * from private.workspace_owner_statements s where s.status in ('issued','paid') and (target_property is null or s.property_id=target_property)
    and private.workspace_can_property(s.property_id,'owner-statements') order by s.period_start desc limit 60) s;
  return result;
 end if;
 if not private.workspace_finance_role() then raise exception 'Accounts access required' using errcode='42501';end if;
 if target_property is not null and not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
 if section in ('overview','reconciliation','statements') then start_on:=private.workspace_period(period);end_on:=(start_on+interval '1 month')::date;end if;
 if section='overview' then
  if not private.has_workspace_module('owner-statements') then raise exception 'Accounts access required' using errcode='42501';end if;
  select jsonb_build_object(
   'toApproveCount',count(*) filter(where status='to_approve'),'toApproveMinor',coalesce(sum(amount_minor) filter(where status='to_approve'),0),
   'queriedCount',count(*) filter(where status='queried'),'queuedForXero',count(*) filter(where xero_status='queued'),
   'overLimitCount',(select count(*) from private.workspace_expenses x,private.workspace_finance_policy f where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'statements',(select jsonb_build_object('draft',count(*) filter(where status='draft'),'issued',count(*) filter(where status='issued'),'paid',count(*) filter(where status='paid')) from private.workspace_owner_statements where period_start=start_on),
   'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and private.workspace_payout_row(r)->>'settledMinor' is null),
   'missingDetails',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel not in ('airbnb','booking_com') and r.payout_minor is null and r.check_in>=start_on and r.check_in<end_on and private.workspace_can_property(r.property_id,'owner-statements')))
   into result from private.workspace_expenses where private.workspace_can_property(property_id,'maintenance-reconciliation');
 elsif section='expenses' then
  if status_filter is not null and status_filter not in ('to_approve','queried','approved','rejected') then raise exception 'Invalid status' using errcode='22023';end if;
  select coalesce(jsonb_agg(private.workspace_expense_view(x,false) order by x.received_on desc,x.created_at desc,x.id),'[]') into result from
   (select * from private.workspace_expenses x where (target_property is null or x.property_id=target_property) and (status_filter is null or x.status=status_filter)
    and private.workspace_can_property(x.property_id,'maintenance-reconciliation') order by x.received_on desc,x.created_at desc limit 200) x;
 elsif section='expense' then
  select * into e from private.workspace_expenses where id=target_id;
  if not found or not private.workspace_can_property(e.property_id,'maintenance-reconciliation') then raise exception 'Expense not found' using errcode='P0002';end if;
  result:=private.workspace_expense_view(e,true);
 elsif section='reconciliation' then
  select jsonb_build_object(
   'period',period,
   'rows',(select coalesce(jsonb_agg(private.workspace_payout_row(r) order by r.check_in,r.id),'[]') from private.workspace_reservations r
     where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and (target_property is null or r.property_id=target_property)
     and private.workspace_can_property(r.property_id,'owner-statements')),
   -- Stays recorded without a platform or payout amount: they block the owner statement until set.
   'needsDetails',(select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'propertyId',r.property_id,'propertyName',p.name,'reference',r.reference,
     'channel',r.channel,'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'version',r.version) order by r.check_in,r.id),'[]')
     from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
     where r.status='confirmed' and r.channel not in ('airbnb','booking_com') and r.payout_minor is null and r.check_in>=start_on and r.check_in<end_on
     and (target_property is null or r.property_id=target_property) and private.workspace_can_property(r.property_id,'owner-statements')),
   'unexpected',(select coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'channel',rp.channel,'reference',l.reference,'amountMinor',l.amount_minor,'fileName',rp.file_name,'uploadedAt',rp.created_at) order by rp.created_at,l.reference),'[]')
     from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id where l.set_aside_at is null and target_property is null
     and not exists(select 1 from private.workspace_reservations r where r.channel=rp.channel and upper(r.channel_reference)=upper(l.reference))),
   'reports',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'fileName',file_name,'lineCount',line_count,'totalMinor',total_minor,'uploadedAt',created_at) order by created_at desc),'[]')
     from (select * from private.workspace_payout_reports order by created_at desc limit 24) rp)) into result;
 elsif section='statements' then
  select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,
    'terms',(select jsonb_build_object('managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor) from private.workspace_property_financials f where f.property_id=p.id),
    'statement',(select private.workspace_statement_view(s) from private.workspace_owner_statements s where s.property_id=p.id and s.period_start=start_on and s.status<>'void'),
    'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and private.workspace_payout_row(r)->>'settledMinor' is null),
    'missingDetails',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel not in ('airbnb','booking_com') and r.payout_minor is null and r.check_in>=start_on and r.check_in<end_on and r.property_id=p.id))
   order by p.name,p.id),'[]') into result
  from public.workspace_properties p where p.status<>'archived' and (target_property is null or p.id=target_property) and private.workspace_can_property(p.id,'owner-statements');
 elsif section='policy' then
  select * into policy from private.workspace_finance_policy where singleton;
  result:=jsonb_build_object('expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'version',policy.version,'updatedAt',policy.updated_at);
 else raise exception 'Unknown finance section' using errcode='22023';end if;
 return result;
end $$;
