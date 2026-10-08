-- Accounts, purchases and cleaners, as the client described them:
-- * Accounts work purchase requests: they are told about each new request, approve it against a
--   budget chart (the most an item should cost), record the order and reconcile the invoice.
-- * Accepted cleans carry the cleaner's name and date, so Accounts can put several on one invoice.
-- * "Remove from the rota" takes the cleaner off every property and unassigns their open cleans.

create table private.workspace_purchase_budget (
 id uuid primary key default gen_random_uuid(),
 item text not null check(length(trim(item)) between 2 and 120),
 max_unit_minor bigint not null check(max_unit_minor between 1 and 10000000),
 note text not null default '' check(length(note)<=500),
 active boolean not null default true,
 version integer not null default 1,
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create unique index workspace_purchase_budget_item on private.workspace_purchase_budget(lower(trim(item))) where active;
alter table private.workspace_purchase_budget enable row level security;
revoke all on private.workspace_purchase_budget from public,anon,authenticated;

create function private.workspace_budget_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(private.workspace_actor_role(),'client') in ('client','cleans') then raise exception 'Team access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'item',b.item,'maxUnitMinor',b.max_unit_minor,'note',b.note,'version',b.version) order by lower(b.item)) from private.workspace_purchase_budget b where b.active),'[]');
end $$;

create function private.workspace_budget_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;b private.workspace_purchase_budget;result jsonb;begin
 if not (actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('purchase-order-accounts'))) then raise exception 'Accounts access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveBudgetItem' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','item','maxUnitMinor','note']);
  if coalesce(input->>'maxUnitMinor','')!~'^\d+$' or (input->>'maxUnitMinor')::bigint not between 1 and 10000000 or length(coalesce(input->>'note',''))>500 then raise exception 'Enter the most this item should cost' using errcode='22023';end if;
  perform private.workspace_required_text(input,'item',2,120);
  if exists(select 1 from private.workspace_purchase_budget x where x.active and lower(trim(x.item))=lower(trim(input->>'item')) and x.id is distinct from (input->>'id')::uuid) then raise exception 'That item is already in the budget chart' using errcode='23505';end if;
  if input->>'id' is null then
   insert into private.workspace_purchase_budget(item,max_unit_minor,note,updated_by) values(trim(input->>'item'),(input->>'maxUnitMinor')::bigint,coalesce(input->>'note',''),auth.uid()) returning * into b;
  else
   update private.workspace_purchase_budget set item=trim(input->>'item'),max_unit_minor=(input->>'maxUnitMinor')::bigint,note=coalesce(input->>'note',''),version=version+1,updated_by=auth.uid(),updated_at=now()
    where id=(input->>'id')::uuid and active and version=(input->>'version')::int returning * into b;
   if not found then raise exception 'Budget item changed' using errcode='40001';end if;
  end if;
 elsif a='removeBudgetItem' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version']);
  update private.workspace_purchase_budget set active=false,version=version+1,updated_by=auth.uid(),updated_at=now() where id=(input->>'id')::uuid and active and version=(input->>'version')::int returning * into b;
  if not found then raise exception 'Budget item changed' using errcode='40001';end if;
 else raise exception 'Unknown budget action' using errcode='22023';end if;
 result:=jsonb_build_object('id',b.id,'version',b.version);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
revoke all on function private.workspace_budget_read(),private.workspace_budget_action(jsonb) from public,anon,authenticated;

-- Accounts see purchase requests.
create or replace function private.workspace_operation_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_can_work(target) or exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 where w.id=target and (
  private.workspace_actor_role()='ready' and (d.kind='maintenance' and d.data->>'referredAt' is not null and private.workspace_can_property(w.property_id,'maintenance-reporting') or d.kind='purchase' and d.data->>'phase' in ('ordered','delivered','reconciled') and private.workspace_can_property(w.property_id,'purchase-order'))
  or private.workspace_actor_role()='accounts' and d.kind='purchase' and private.has_workspace_module('purchase-order-accounts')));
$$;

do $$
declare
 definition text;
 accounts constant text:=$q$(actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('purchase-order-accounts')))$q$;
 fixes constant text[][]:=array[
  -- Accounts are told about each new purchase request.
  [$q$perform private.workspace_required_text(data,'requirements',5,3000);perform private.workspace_money(data,'budgetMinor');data:=data||jsonb_build_object('phase','requested','workStatus','waiting');$q$,
   $q$perform private.workspace_required_text(data,'requirements',5,3000);perform private.workspace_money(data,'budgetMinor');data:=data||jsonb_build_object('phase','requested','workStatus','waiting');
    notify_users:=array(select p.user_id from public.workspace_profiles p join public.workspace_module_grants g on g.user_id=p.user_id and g.module_id='purchase-order-accounts' where p.role='accounts' and p.status='active');$q$],
  -- Approval against the budget chart, by Accounts or an admin.
  [$q$perform private.workspace_json_keys(data,array['approvedAmountMinor','approvalNote']);
    if actor not in ('admin','super_admin') or d.data->>'phase'<>'requested' then$q$,
   $q$perform private.workspace_json_keys(data,array['approvedAmountMinor','approvalNote','budgetItemId','quantity']);
    if data ? 'budgetItemId' and (coalesce(data->>'quantity','')!~'^\d+$' or (data->>'quantity')::int not between 1 and 100 or not exists(select 1 from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid and b.active)) then raise exception 'Choose a budget chart item and how many' using errcode='22023';end if;
    if data ? 'budgetItemId' then
     if private.workspace_money(data,'approvedAmountMinor')>(select b.max_unit_minor*(data->>'quantity')::int from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid) then raise exception 'Over the budget chart for this item' using errcode='22023';end if;
     data:=data||(select jsonb_build_object('budgetItem',b.item,'budgetMaxMinor',b.max_unit_minor*(data->>'quantity')::int) from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid);
    end if;
    if not ACCOUNTS or d.data->>'phase'<>'requested' then$q$],
  [$q$if actor not in ('admin','super_admin') or d.data->>'phase'<>'approved' then raise exception 'Approved Accounts order required'$q$,
   $q$if not ACCOUNTS or d.data->>'phase'<>'approved' then raise exception 'Approved Accounts order required'$q$],
  [$q$if actor not in ('admin','super_admin') or d.data->>'phase'<>'delivered' or invoice.id is null$q$,
   $q$if not ACCOUNTS or d.data->>'phase'<>'delivered' or invoice.id is null$q$],
  -- The cleaner's name and the clean's date travel with the invoice task.
  [$q$jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id));end if;$q$,
   $q$jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'cleanerName',(select p.full_name from public.workspace_profiles p where p.user_id=w.assignee_id),'cleanedOn',w.due_on));end if;$q$]
 ];
begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position('budgetItemId' in definition)>0 then return; end if;
 for i in 1..array_length(fixes,1) loop
  if position(fixes[i][1] in definition)=0 then raise exception 'Patch anchor missing: operations fix %',i; end if;
  definition:=replace(definition,fixes[i][1],replace(fixes[i][2],'ACCOUNTS',accounts));
 end loop;
 execute definition;
end $$;

-- Existing open invoice tasks get the cleaner's name and date.
update private.workspace_domain_details d set data=d.data||jsonb_build_object('cleanerName',p.full_name,'cleanedOn',src.due_on),updated_at=now()
 from public.workspace_profiles p, public.workspace_work_items src
 where d.kind='cleaning_invoice' and p.user_id::text=d.data->>'cleanerId' and src.id::text=d.data->>'sourceWorkId' and not d.data ? 'cleanerName';

-- Budget chart through the team endpoints; "remove from the rota" takes effect.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$ elsif section='signoff' then$q$,
   $q$ elsif section='budgetChart' then result:=private.workspace_budget_read();
 elsif section='signoff' then$q$, 'workspace_budget_read'],
  ['private.workspace_teams_action(jsonb)', $q$ if input->>'action'='signOffDay' then return private.workspace_signoff_action(input);end if;$q$,
   $q$ if input->>'action'='signOffDay' then return private.workspace_signoff_action(input);end if;
 if input->>'action' in ('saveBudgetItem','removeBudgetItem') then return private.workspace_budget_action(input);end if;$q$, 'workspace_budget_action'],
  ['private.workspace_teams_action(jsonb)', $q$  update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;$q$,
   $q$  update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
  if a='decideCleanerReview' and input->>'outcome'='removed_from_rota' then
   -- Off every property, and their open cleans go back to the cleaning manager to reassign.
   delete from public.workspace_property_assignments where user_id::text=d.data->>'cleanerId' and assignment='cleaner';
   update public.workspace_work_items cw set assignee_id=null,version=cw.version+1,updated_at=now()
    from private.workspace_domain_details cd where cd.work_id=cw.id and cd.kind='cleaning' and cw.assignee_id::text=d.data->>'cleanerId' and cw.status not in ('completed','cancelled');
  end if;$q$, 'removed_from_rota'' then']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in %', fixes[i][1]; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;

-- The invoice guard uses the same access as the operations themselves, so Accounts can record the
-- invoice for a purchase they approved.
do $$
declare definition text;
 anchor constant text:=$q$not (private.workspace_can_work(w.id) or$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operation_invoice_guard()'::regprocedure);
 if position('workspace_operation_access(w.id)' in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'Patch anchor missing: invoice guard access'; end if;
 execute replace(definition,anchor,$q$not (private.workspace_operation_access(w.id) or$q$);
end $$;
