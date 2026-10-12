-- Owner-entered monthly expenses (assumption h). An owner can record what they spent on a property in
-- a month (maintenance, utilities, insurance, supplies, other). It changes ONLY the net figure the
-- owner sees: net = what Recharge pays them (the statement payout) minus their own expenses. It is
-- never an input to a statement, a payout, a fee or a reconciliation.
--
-- 1. private.workspace_owner_expenses: private table, RLS on, no direct access for anyone.
-- 2. workspace_owner_save_expense / workspace_owner_remove_expense: the owner of the property only
--    (the client role with the property assigned and the owner statements tool; staff, admins and
--    other owners are refused). Saving is idempotent by requestId. Removing is for the owner's own row.
--    LOCK RULE: a month is locked once an issued or paid statement for that property covers any part
--    of it (the monthly statement for that month, or, where statements carry an end date, any issued
--    period overlapping the month). A locked month refuses new expenses and removals, because the
--    net figure shown for an issued statement must not move after the owner has been sent it.
--    A replay of a save the database already holds is answered from the stored row even if the month
--    has been issued since. Only this month and earlier months can be entered.
-- 3. workspace_owner_periods: each month cell now carries ownerExpensesMinor, ownerExpenses (the owner's
--    own rows only, no staff names or internal flags), netMinor (payout minus the owner's expenses;
--    null when the owner has recorded none that month or the payout is not known yet) and
--    ownerExpensesLocked. The existing expensesMinor (repairs and expenses on the statement) is unchanged.
-- 4. workspace_owner_expenses_read: staff with finance access (accounts, admin) and the owner statements tool can
--    read them, for the properties they may finance.
-- 5. The owner's months (private.workspace_owner_period_cell, patched below) for statements of any dates:
--    * a month that is exactly one issued or paid statement shows that statement, as before;
--    * a month any other issued or paid statement covers (a custom period, or one spanning months) is never
--      estimated. It shows as a statement month ('statement' source, covered true), and each covering statement's
--      figures count once, in the month its period starts; the other months it covers show it without figures, so
--      a period summed across months never counts a payout twice. coveringStatements lists each one with only its
--      dates, status and (in the month it starts) its payout; uncoveredNights says how much of the month is on no
--      issued statement yet. Nothing staff-only (no detail, flags or costs) is added;
--    * the estimate for every other month adds VAT on the fee where the property charges it (vatMinor) and takes it
--      off the payout estimate. Statement months carry their statement's VAT too.

create table if not exists private.workspace_owner_expenses (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.workspace_properties(id),
 owner_id uuid not null references public.workspace_profiles(user_id),
 month date not null check(month=date_trunc('month',month)::date),
 category text not null check(category in ('maintenance','utilities','insurance','supplies','other')),
 amount_minor bigint not null check(amount_minor between 1 and 100000000),
 note text not null default '' check(length(note)<=300),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 unique(owner_id,request_id)
);
create index if not exists workspace_owner_expenses_property_month_idx on private.workspace_owner_expenses(property_id,month);
create index if not exists workspace_owner_expenses_owner_month_idx on private.workspace_owner_expenses(owner_id,month);
alter table private.workspace_owner_expenses enable row level security;
revoke all on private.workspace_owner_expenses from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_owner_expenses;
create trigger business_write_limit before insert or update or delete on private.workspace_owner_expenses for each row execute function private.workspace_enforce_write_limit();

-- True once an issued or paid statement covers any part of the month (see the lock rule above).
create or replace function private.workspace_owner_month_locked(prop uuid, month_start date) returns boolean language plpgsql stable security definer set search_path='' as $$
declare locked boolean;next_month date:=(month_start+interval '1 month')::date;
begin
 locked:=exists(select 1 from private.workspace_owner_statements s where s.property_id=prop and s.status in ('issued','paid') and s.period_start>=month_start and s.period_start<next_month);
 if not locked and exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='private.workspace_owner_statements'::regclass and a.attname='period_end' and not a.attisdropped) then
  execute 'select exists(select 1 from private.workspace_owner_statements s where s.property_id=$1 and s.status in (''issued'',''paid'') and s.period_end is not null and daterange(s.period_start,s.period_end) && daterange($2,$3))'
   into locked using prop,month_start,next_month;
 end if;
 return coalesce(locked,false);
end $$;

-- One expense as the owner sees it: no owner id, no request id, nobody else's name.
create or replace function private.workspace_owner_expense_view(e private.workspace_owner_expenses) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',e.id,'propertyId',e.property_id,'month',to_char(e.month,'YYYY-MM'),'category',e.category,'amountMinor',e.amount_minor,'note',e.note,'createdAt',e.created_at);
$$;

create or replace function private.workspace_owner_save_expense(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 prop uuid;m date;amount bigint;cat text;memo text;req uuid;e private.workspace_owner_expenses;
 this_month date:=date_trunc('month',(now() at time zone 'Europe/London'))::date;
begin
 if private.workspace_actor_role() is distinct from 'client' then raise exception 'Owner access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','month','amountMinor','category','note']);
 if jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid field requestId' using errcode='22023';end if;
 if jsonb_typeof(input->'propertyId') is distinct from 'string' or input->>'propertyId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid field propertyId' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if jsonb_typeof(input->'month') is distinct from 'string' or input->>'month'!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a month' using errcode='22023';end if;
 m:=((input->>'month')||'-01')::date;
 if jsonb_typeof(input->'amountMinor') is distinct from 'number' or input->>'amountMinor'!~'^\d{1,9}$' then raise exception 'Enter the amount in pounds and pence' using errcode='22023';end if;
 amount:=(input->>'amountMinor')::bigint;
 if amount<1 or amount>10000000 then raise exception 'Enter an amount between 1p and £100,000' using errcode='22023';end if;
 cat:=input->>'category';
 if jsonb_typeof(input->'category') is distinct from 'string' or cat not in ('maintenance','utilities','insurance','supplies','other') then raise exception 'Choose a category' using errcode='22023';end if;
 if input ? 'note' and jsonb_typeof(input->'note')<>'null' and jsonb_typeof(input->'note')<>'string' then raise exception 'Invalid field note' using errcode='22023';end if;
 memo:=trim(coalesce(input->>'note',''));
 if length(memo)>300 then raise exception 'Keep the note to 300 characters' using errcode='22023';end if;
 -- Their property, and the owner statements tool; staff and other owners are refused here.
 if not private.workspace_can_property(prop,'owner-statements') or not exists(select 1 from public.workspace_properties p where p.id=prop and p.status<>'archived') then
  raise exception 'Property access required' using errcode='42501';
 end if;
 -- A repeat of a save already made returns that row, whatever has happened to the month since.
 select * into e from private.workspace_owner_expenses x where x.owner_id=auth.uid() and x.request_id=req;
 if found then
  if e.property_id<>prop or e.month<>m or e.amount_minor<>amount or e.category<>cat or e.note<>memo then raise exception 'This request was already used for a different expense' using errcode='22023';end if;
  return private.workspace_owner_expense_view(e);
 end if;
 if m>this_month then raise exception 'Choose this month or an earlier one' using errcode='22023';end if;
 if private.workspace_owner_month_locked(prop,m) then raise exception 'This month''s statement has been issued, so its expenses can no longer be changed' using errcode='42501';end if;
 if (select count(*) from private.workspace_owner_expenses x where x.owner_id=auth.uid() and x.property_id=prop and x.month=m)>=50 then raise exception 'That month already has 50 expenses' using errcode='22023';end if;
 insert into private.workspace_owner_expenses(property_id,owner_id,month,category,amount_minor,note,request_id)
  values(prop,auth.uid(),m,cat,amount,memo,req) on conflict(owner_id,request_id) do nothing returning * into e;
 if e.id is null then
  select * into e from private.workspace_owner_expenses x where x.owner_id=auth.uid() and x.request_id=req;
  if e.property_id<>prop or e.month<>m or e.amount_minor<>amount or e.category<>cat or e.note<>memo then raise exception 'This request was already used for a different expense' using errcode='22023';end if;
  return private.workspace_owner_expense_view(e);
 end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'owner.expense_saved');
 return private.workspace_owner_expense_view(e);
end $$;

create or replace function private.workspace_owner_remove_expense(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.workspace_owner_expenses;
begin
 if private.workspace_actor_role() is distinct from 'client' then raise exception 'Owner access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','expenseId']);
 if jsonb_typeof(input->'expenseId') is distinct from 'string' or input->>'expenseId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid field expenseId' using errcode='22023';end if;
 -- Only the owner's own row. Someone else's row looks exactly like one that is gone.
 select * into e from private.workspace_owner_expenses x where x.id=(input->>'expenseId')::uuid and x.owner_id=auth.uid() for update;
 if not found then raise exception 'That expense is no longer there' using errcode='P0002';end if;
 if not private.workspace_can_property(e.property_id,'owner-statements') then raise exception 'Property access required' using errcode='42501';end if;
 if private.workspace_owner_month_locked(e.property_id,e.month) then raise exception 'This month''s statement has been issued, so its expenses can no longer be changed' using errcode='42501';end if;
 delete from private.workspace_owner_expenses where id=e.id;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),e.property_id,'owner.expense_removed');
 return jsonb_build_object('id',e.id,'removed',true);
end $$;

-- The owner's own expenses for a property and month, and the net figure, added to a month cell.
create or replace function private.workspace_owner_expense_keys(prop uuid, month_start date, payout bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total bigint;n integer;list jsonb;
begin
 select coalesce(sum(e.amount_minor),0)::bigint,count(*)::integer,coalesce(jsonb_agg(private.workspace_owner_expense_view(e) order by e.created_at,e.id),'[]'::jsonb)
  into total,n,list from private.workspace_owner_expenses e where e.property_id=prop and e.month=month_start and e.owner_id=auth.uid();
 return jsonb_build_object('ownerExpensesMinor',total,'ownerExpenses',list,
  'netMinor',case when n=0 or payout is null then null else payout-total end,
  'ownerExpensesLocked',private.workspace_owner_month_locked(prop,month_start));
end $$;
create or replace function private.workspace_owner_cell_with_expenses(prop uuid, month_start date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cell jsonb:=private.workspace_owner_period_cell(prop,month_start);
begin
 return cell||private.workspace_owner_expense_keys(prop,month_start,nullif(cell->>'payoutMinor','')::bigint);
end $$;

-- Finance staff read: owner expenses, optionally for one property and a span of months. Finance roles with the
-- owner statements tool only, and only for properties they may finance (each row is checked).
create or replace function private.workspace_owner_expenses_read(target_property uuid default null, from_month date default null, to_month date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.workspace_finance_role(),false) or not coalesce(private.has_workspace_module('owner-statements'),false) then raise exception 'Finance access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(private.workspace_owner_expense_view(e)||jsonb_build_object('propertyName',p.name,'ownerName',o.full_name) order by e.month desc,p.name,e.created_at,e.id)
  from (select * from private.workspace_owner_expenses x where (target_property is null or x.property_id=target_property)
    and (from_month is null or x.month>=date_trunc('month',from_month)::date) and (to_month is null or x.month<=date_trunc('month',to_month)::date)
    and private.workspace_can_property(x.property_id,'owner-statements')
    order by x.month desc,x.created_at desc limit 500) e
  join public.workspace_properties p on p.id=e.property_id join public.workspace_profiles o on o.user_id=e.owner_id),'[]'::jsonb);
end $$;

create or replace function public.workspace_owner_save_expense(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_save_expense(input);$$;
create or replace function public.workspace_owner_remove_expense(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_remove_expense(input);$$;
create or replace function public.workspace_owner_expenses_read(target_property uuid default null, from_month date default null, to_month date default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_expenses_read(target_property,from_month,to_month);$$;

revoke all on function private.workspace_owner_month_locked(uuid,date),private.workspace_owner_expense_view(private.workspace_owner_expenses),
 private.workspace_owner_expense_keys(uuid,date,bigint),private.workspace_owner_cell_with_expenses(uuid,date) from public,anon,authenticated;
revoke all on function private.workspace_owner_save_expense(jsonb),private.workspace_owner_remove_expense(jsonb),private.workspace_owner_expenses_read(uuid,date,date),
 public.workspace_owner_save_expense(jsonb),public.workspace_owner_remove_expense(jsonb),public.workspace_owner_expenses_read(uuid,date,date) from public,anon;
grant execute on function private.workspace_owner_save_expense(jsonb),private.workspace_owner_remove_expense(jsonb),private.workspace_owner_expenses_read(uuid,date,date),
 public.workspace_owner_save_expense(jsonb),public.workspace_owner_remove_expense(jsonb),public.workspace_owner_expenses_read(uuid,date,date) to authenticated;

-- The owner's months now go through the wrapper that adds the expenses. The anchor must occur exactly
-- once in the latest definition; a definition that already has the wrapper is left alone.
do $$
declare
 target constant text := 'private.workspace_owner_periods(date,date)';
 anchor constant text := $q$private.workspace_owner_period_cell(p.id,m::date)$q$;
 sentinel constant text := $q$private.workspace_owner_cell_with_expenses(p.id,m::date)$q$;
 definition text;found_count integer;
begin
 definition := pg_get_functiondef(target::regprocedure);
 if position(sentinel in definition) = 0 then
  found_count := (length(definition) - length(replace(definition, anchor, ''))) / length(anchor);
  if found_count <> 1 then raise exception 'Patch anchor found % times in %, expected once', found_count, target; end if;
  execute replace(definition, anchor, sentinel);
  if position(sentinel in pg_get_functiondef(target::regprocedure)) = 0 then raise exception 'Patch did not take in %', target; end if;
 end if;
end $$;

-- 5. The owner's months for statements of any dates (see 5 at the top). A month covered by issued or paid
-- statements of other dates: no estimate, each covering statement's figures once, in the month its period starts.
-- booked: the month's booked nights (for occupancy), worked out by the caller as for every month.
create or replace function private.workspace_owner_covered_cell(prop uuid, month_start date, booked bigint) returns jsonb language sql stable security definer set search_path='' as $$
 with covering as (
  select x.* from private.workspace_owner_statements x where x.property_id=prop and x.status in ('issued','paid')
   and daterange(x.period_start,x.period_end) && daterange(month_start,(month_start+interval '1 month')::date)
 ), starting as (
  select * from covering c where c.period_start>=month_start and c.period_start<(month_start+interval '1 month')::date
 )
 select jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'propertyId',prop,'source','statement',
  'status',case when (select bool_and(c.status='paid') from covering c) then 'paid' else 'issued' end,
  'preparing',exists(select 1 from private.workspace_owner_statements x where x.property_id=prop and x.status='draft'
   and daterange(x.period_start,x.period_end) && daterange(month_start,(month_start+interval '1 month')::date)),
  'revenueMinor',(select coalesce(sum(s.revenue_minor),0) from starting s),
  'bookings',(select coalesce(sum(jsonb_array_length(case when jsonb_typeof(s.detail->'stays')='array' then s.detail->'stays' else '[]'::jsonb end)),0) from starting s),
  'stayNights',(select coalesce(sum((y->>'checkOut')::date-(y->>'checkIn')::date),0) from starting s
   cross join lateral jsonb_array_elements(case when jsonb_typeof(s.detail->'stays')='array' then s.detail->'stays' else '[]'::jsonb end) y),
  'bookedNights',booked,
  'cleaningCount',(select coalesce(sum(s.cleaning_count),0) from starting s),'cleaningMinor',(select coalesce(sum(s.cleaning_minor),0) from starting s),
  'expensesMinor',(select coalesce(sum(s.expenses_minor),0) from starting s),
  'feeBps',(select case when count(distinct s.fee_bps)=1 then min(s.fee_bps) end from starting s),
  'feeMinor',(select coalesce(sum(s.fee_minor),0) from starting s),'vatMinor',(select coalesce(sum(s.vat_minor),0) from starting s),
  'payoutMinor',(select coalesce(sum(s.payout_minor),0) from starting s),'missingAmounts',0,
  'covered',true,
  'coveringStatements',(select jsonb_agg(jsonb_build_object('periodStart',c.period_start,'periodLastDay',c.period_end-1,'status',c.status,
    'payoutMinor',case when c.period_start>=month_start and c.period_start<(month_start+interval '1 month')::date then c.payout_minor end) order by c.period_start,c.id) from covering c),
  'uncoveredNights',(select count(*) from generate_series(month_start::timestamp,((month_start+interval '1 month')::date-1)::timestamp,interval '1 day') d
   where not exists(select 1 from covering c where d::date>=c.period_start and d::date<c.period_end)));
$$;
revoke all on function private.workspace_owner_covered_cell(uuid,date,bigint) from public,anon,authenticated;

-- The month cell, patched from its latest definition. Each anchor must occur exactly once; the marker says the
-- patch is already in place. A missing or repeated anchor stops the migration.
do $$
declare
 fixes constant text[][] := array[
  -- A statement cell only for a statement that is exactly the month.
  ['private.workspace_owner_period_cell(uuid,date)',
   $q$x.property_id=prop and x.period_start=month_start and x.status in ('issued','paid') order by x.issued_at desc nulls last,x.id limit 1);$q$,
   $q$x.property_id=prop and x.period_start=month_start and x.period_end=month_end and x.status in ('issued','paid') order by x.issued_at desc nulls last,x.id limit 1);$q$,
   $q$x.period_end=month_end and x.status in ('issued','paid')$q$],
  ['private.workspace_owner_period_cell(uuid,date)',
   $q$'feeBps',s.fee_bps,'feeMinor',s.fee_minor,'payoutMinor',s.payout_minor,'missingAmounts',0);$q$,
   $q$'feeBps',s.fee_bps,'feeMinor',s.fee_minor,'vatMinor',s.vat_minor,'payoutMinor',s.payout_minor,'missingAmounts',0);$q$,
   $q$'vatMinor',s.vat_minor$q$],
  -- Covered by a statement of other dates: never an estimate.
  ['private.workspace_owner_period_cell(uuid,date)',
   $q$ f:=(select x from private.workspace_property_financials x where x.property_id=prop);$q$,
   $q$ -- A month an issued or paid statement of other dates covers is never estimated (20261012120000).
 if exists(select 1 from private.workspace_owner_statements x where x.property_id=prop and x.status in ('issued','paid')
   and daterange(x.period_start,x.period_end) && daterange(month_start,month_end)) then
  return private.workspace_owner_covered_cell(prop,month_start,booked);
 end if;
 f:=(select x from private.workspace_property_financials x where x.property_id=prop);$q$,
   $q$private.workspace_owner_covered_cell(prop,month_start,booked)$q$],
  -- "Being prepared": any draft touching the month, whatever its dates.
  ['private.workspace_owner_period_cell(uuid,date)',
   $q$x.period_start=month_start and x.status='draft')$q$,
   $q$daterange(x.period_start,x.period_end) && daterange(month_start,month_end) and x.status='draft')$q$,
   $q$daterange(month_start,month_end) and x.status='draft'$q$],
  -- The estimate takes VAT on the fee off the payout where the property charges it.
  ['private.workspace_owner_period_cell(uuid,date)',
   $q$'feeBps',f.management_fee_bps,'feeMinor',fee,'payoutMinor',case when cleaning is null or fee is null then null else revenue-cleaning-costs-fee end,'missingAmounts',missing);$q$,
   $q$'feeBps',f.management_fee_bps,'feeMinor',fee,
  'vatMinor',case when fee is null then null when coalesce(f.vat_on_fee,false) then private.workspace_percent_of_minor(fee,private.workspace_vat_bps()) else 0 end,
  'payoutMinor',case when cleaning is null or fee is null then null
   else revenue-cleaning-costs-fee-(case when coalesce(f.vat_on_fee,false) then private.workspace_percent_of_minor(fee,private.workspace_vat_bps()) else 0 end) end,'missingAmounts',missing);$q$,
   $q$'vatMinor',case when fee is null then null$q$]
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
