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
-- 4. workspace_owner_expenses_read: staff with finance access (accounts, admin) can read them.

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

-- Finance staff read: every owner expense, optionally for one property and a span of months.
create or replace function private.workspace_owner_expenses_read(target_property uuid default null, from_month date default null, to_month date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.workspace_finance_role(),false) then raise exception 'Finance access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(private.workspace_owner_expense_view(e)||jsonb_build_object('propertyName',p.name,'ownerName',o.full_name) order by e.month desc,p.name,e.created_at,e.id)
  from (select * from private.workspace_owner_expenses x where (target_property is null or x.property_id=target_property)
    and (from_month is null or x.month>=date_trunc('month',from_month)::date) and (to_month is null or x.month<=date_trunc('month',to_month)::date)
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
