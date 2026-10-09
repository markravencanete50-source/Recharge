-- Owner Home figures by period, statement style, and the facts the inbox filter chips need.
--
-- 1. private.workspace_owner_periods: for each of the owner's properties and each month asked for,
--    the statement figures (booking income, cleaning, repairs and expenses, management fee, payout).
--    A month with an issued or paid statement returns that statement's figures exactly; any other
--    month is worked out the way Accounts prepare a statement (stays starting in the month, accepted
--    cleans at the agreed cleaning cost, approved expenses, the agreed fee) and marked as an estimate.
-- 2. Conversations say whether they are the reader's ("mine"), which properties they are about, and
--    whether the last message came from the owner, so the inbox can filter without new writes.
-- 3. Guest conversations say whether they are the reader's: they replied or logged a message in it,
--    or they look after the property.

-- One property and one month, statement style. Server only: the caller checks access first.
create or replace function private.workspace_owner_period_cell(prop uuid, month_start date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare month_end date:=(month_start+interval '1 month')::date;s private.workspace_owner_statements;f private.workspace_property_financials;
 booked bigint;revenue bigint;missing bigint;bookings bigint;stay_nights bigint;cleans bigint;costs bigint;cleaning bigint;fee bigint;
begin
 -- Nights booked inside the month, from every confirmed stay touching it (for occupancy).
 booked:=(select coalesce(sum(greatest(0,least(r.check_out,month_end)-greatest(r.check_in,month_start))),0) from private.workspace_reservations r
  where r.property_id=prop and r.status='confirmed' and r.check_in<month_end and r.check_out>month_start);
 s:=(select x from private.workspace_owner_statements x where x.property_id=prop and x.period_start=month_start and x.status in ('issued','paid') order by x.issued_at desc nulls last,x.id limit 1);
 if s.id is not null then
  return jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'propertyId',prop,'source','statement','status',s.status,'preparing',false,
   'revenueMinor',s.revenue_minor,'bookings',jsonb_array_length(coalesce(s.detail->'stays','[]'::jsonb)),
   'stayNights',(select coalesce(sum((x->>'checkOut')::date-(x->>'checkIn')::date),0) from jsonb_array_elements(coalesce(s.detail->'stays','[]'::jsonb)) x),
   'bookedNights',booked,'cleaningCount',s.cleaning_count,'cleaningMinor',s.cleaning_minor,'expensesMinor',s.expenses_minor,
   'feeBps',s.fee_bps,'feeMinor',s.fee_minor,'payoutMinor',s.payout_minor,'missingAmounts',0);
 end if;
 f:=(select x from private.workspace_property_financials x where x.property_id=prop);
 -- As prepareStatement: stays starting in the month, at the settled platform payout where there is
 -- one; until it settles, the expected payout recorded on the stay.
 revenue:=(select coalesce(sum(case when r.channel in ('airbnb','booking_com') then coalesce((private.workspace_payout_row(r)->>'settledMinor')::bigint,r.payout_minor) else r.payout_minor end),0)
  from private.workspace_reservations r where r.property_id=prop and r.status='confirmed' and r.check_in>=month_start and r.check_in<month_end);
 missing:=(select count(*) from private.workspace_reservations r where r.property_id=prop and r.status='confirmed' and r.check_in>=month_start and r.check_in<month_end
  and (case when r.channel in ('airbnb','booking_com') then coalesce((private.workspace_payout_row(r)->>'settledMinor')::bigint,r.payout_minor) else r.payout_minor end) is null);
 bookings:=(select count(*) from private.workspace_reservations r where r.property_id=prop and r.status='confirmed' and r.check_in>=month_start and r.check_in<month_end);
 stay_nights:=(select coalesce(sum(r.check_out-r.check_in),0) from private.workspace_reservations r where r.property_id=prop and r.status='confirmed' and r.check_in>=month_start and r.check_in<month_end);
 cleans:=(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where w.property_id=prop and d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' and w.due_on>=month_start and w.due_on<month_end);
 costs:=(select coalesce(sum(e.amount_minor),0) from private.workspace_expenses e where e.property_id=prop and e.status='approved' and e.received_on>=month_start and e.received_on<month_end);
 -- Without the agreed fee and cleaning cost there is no honest payout to show.
 cleaning:=case when f.cleaning_cost_minor is null then null else cleans*f.cleaning_cost_minor end;
 fee:=case when f.management_fee_bps is null then null else round(revenue*f.management_fee_bps/10000.0)::bigint end;
 return jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'propertyId',prop,'source','estimate','status',null,
  'preparing',exists(select 1 from private.workspace_owner_statements x where x.property_id=prop and x.period_start=month_start and x.status='draft'),
  'revenueMinor',revenue,'bookings',bookings,'stayNights',stay_nights,'bookedNights',booked,'cleaningCount',cleans,'cleaningMinor',cleaning,'expensesMinor',costs,
  'feeBps',f.management_fee_bps,'feeMinor',fee,'payoutMinor',case when cleaning is null or fee is null then null else revenue-cleaning-costs-fee end,'missingAmounts',missing);
end $$;

-- The owner's months, from the first month to the last (up to 25), for every property whose
-- statements they can read.
create or replace function private.workspace_owner_periods(start_month date, end_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare first_month date;last_month date;begin
 if private.workspace_actor_role() is distinct from 'client' then raise exception 'Owner statements access required' using errcode='42501';end if;
 if start_month is null or end_month is null then raise exception 'Choose the months' using errcode='22023';end if;
 first_month:=date_trunc('month',start_month)::date;last_month:=date_trunc('month',end_month)::date;
 if last_month<first_month or last_month>(first_month+interval '24 months')::date then raise exception 'Choose up to 25 months' using errcode='22023';end if;
 return jsonb_build_object('from',to_char(first_month,'YYYY-MM'),'to',to_char(last_month,'YYYY-MM'),
  'properties',coalesce((select jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name) order by p.name,p.id) from public.workspace_properties p
    where p.status<>'archived' and private.workspace_can_property(p.id,'owner-statements')),'[]'::jsonb),
  'months',coalesce((select jsonb_agg(private.workspace_owner_period_cell(p.id,m::date) order by m,p.name,p.id)
    from public.workspace_properties p cross join generate_series(first_month,last_month,interval '1 month') m
    where p.status<>'archived' and private.workspace_can_property(p.id,'owner-statements')),'[]'::jsonb));
end $$;
create or replace function public.workspace_owner_periods(start_month date, end_month date) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_periods(start_month,end_month);$$;
revoke all on function private.workspace_owner_period_cell(uuid,date) from public,anon,authenticated;
revoke all on function private.workspace_owner_periods(date,date),public.workspace_owner_periods(date,date) from public,anon;
grant execute on function private.workspace_owner_periods(date,date),public.workspace_owner_periods(date,date) to authenticated;

-- Conversations and guest conversations: what the inbox chips filter on. Each anchor is kept and
-- the new keys follow it.
do $$
declare
 fixes constant text[][] := array[
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'propertyName',(select name from public.workspace_properties where id=c.property_id),$q$,
   $q$'propertyName',(select name from public.workspace_properties where id=c.property_id),
  -- Mine: the reader is in it (their own conversation, a member, or has written in it), or looks after the owner's property.
  'mine',(c.owner_id=me or (c.kind<>'owner' and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me))
   or exists(select 1 from private.chat_messages x where x.conversation_id=c.id and x.author_id=me)
   or (c.kind='owner' and exists(select 1 from public.workspace_property_assignments a join public.workspace_property_assignments o on o.property_id=a.property_id
    where a.user_id=me and a.assignment='staff' and o.user_id=c.owner_id and o.assignment='client'))),
  -- The properties it is about: the owner's properties the reader can see, or the conversation's property.
  'propertyIds',coalesce(case when c.kind='owner' then (select jsonb_agg(a.property_id order by a.property_id) from public.workspace_property_assignments a join public.workspace_properties wp on wp.id=a.property_id
    where a.user_id=c.owner_id and a.assignment='client' and wp.status<>'archived' and (c.owner_id=me or (select role from public.workspace_profiles where user_id=me) in ('admin','super_admin')
     or exists(select 1 from public.workspace_property_assignments s where s.property_id=a.property_id and s.user_id=me)))
   when c.property_id is not null then jsonb_build_array(c.property_id) end,'[]'::jsonb),$q$,
   $q$'propertyIds',coalesce(case when c.kind='owner'$q$],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'last',(select jsonb_build_object('body',left(x.body,140),$q$,
   $q$'last',(select jsonb_build_object('body',left(x.body,140),'fromOwner',coalesce(x.author_id=c.owner_id,false),$q$,
   $q$'fromOwner',coalesce(x.author_id=c.owner_id,false)$q$],
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$'lastFrom',(select last.direction from last),$q$,
   $q$'lastFrom',(select last.direction from last),
  -- Mine: the reader started (logged) this conversation or replied in it, or looks after the property.
  'mine',coalesce(exists(select 1 from private.workspace_guest_messages m where m.source=t.source and m.thread_ref=t.thread_ref and m.author_user_id=auth.uid())
   or t.created_by=auth.uid()
   or exists(select 1 from public.workspace_property_assignments a where a.property_id=t.property_id and a.user_id=auth.uid() and a.assignment='staff'),false),$q$,
   $q$'mine',coalesce(exists(select 1 from private.workspace_guest_messages m where m.source=t.source$q$]
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
