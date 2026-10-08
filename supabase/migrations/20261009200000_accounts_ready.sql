-- Accounts and the Ready team, from the client's feedback:
--  * Expense paperwork: Accounts attach photos or scans of the supplier invoice (and before and
--    after photos) to an expense through the existing private photo store, link an expense to the
--    finished repair or purchase it pays for, and see the repair's own photos once linked.
--  * A completed repair becomes a draft expense for Accounts straight away (contractor, actual
--    cost, the completion report and the repair's photos). The "Reconcile completed property
--    repair" task is still created as before; other screens and the owner invoice depend on it.
--  * A repair is marked paid when its expense is approved, its invoice is paid or its invoice task
--    is closed, so Ready can follow a repair from the Stays report to payment.
--  * Purchases: Accounts record the supplier's invoice against a delivered purchase and mark it
--    paid, so "Reconcile the delivered purchase" can close it.
--  * Stays working a direct booking can see (and pick) that booking's invoice, without gaining
--    owner statements.
--  * Ready can read the owner's access instructions for the properties they look after.
--  * Ready Home: repairs by stage and this month's routine visits per property.
--  * Routine visits are created automatically for this month and next, and the person doing a
--    visit is reminded three days before it is due (once).
-- Safe to run more than once.

-- 1. New values in existing checks, added to whatever the checks hold now.
do $$
declare
 adds constant text[][] := array[
  ['private.workspace_expenses','workspace_expenses_status_check','draft'],
  ['private.workspace_expenses','workspace_expenses_source_check','repair'],
  ['private.workspace_media_evidence','workspace_media_evidence_purpose_check','expense'],
  ['private.workspace_upload_intents','workspace_upload_intents_purpose_check','expense']
 ];
 def text;
begin
 for i in 1..array_length(adds,1) loop
  def:=(select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=adds[i][1]::regclass and c.conname=adds[i][2]);
  if def is null or position('ARRAY[' in def)=0 then raise exception 'Check % is missing', adds[i][2]; end if;
  if position(quote_literal(adds[i][3]) in def)=0 then
   execute format('alter table %s drop constraint %I',adds[i][1],adds[i][2]);
   execute format('alter table %s add constraint %I %s',adds[i][1],adds[i][2],replace(def,'ARRAY[','ARRAY['||quote_literal(adds[i][3])||'::text, '));
  end if;
 end loop;
end $$;

-- 2. Photos can belong to an expense instead of a work item (an invoice for utilities has no job).
alter table private.workspace_media_evidence alter column work_id drop not null;
alter table private.workspace_media_evidence add column if not exists expense_id uuid references private.workspace_expenses(id);
alter table private.workspace_upload_intents alter column work_id drop not null;
alter table private.workspace_upload_intents add column if not exists expense_id uuid references private.workspace_expenses(id);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_media_evidence_target_check') then
  alter table private.workspace_media_evidence add constraint workspace_media_evidence_target_check check(work_id is not null or expense_id is not null);
 end if;
 if not exists(select 1 from pg_constraint where conname='workspace_upload_intents_target_check') then
  alter table private.workspace_upload_intents add constraint workspace_upload_intents_target_check check((work_id is null)<>(expense_id is null));
 end if;
end $$;
create index if not exists workspace_media_evidence_expense_idx on private.workspace_media_evidence(expense_id);
create index if not exists workspace_upload_intents_expense_idx on private.workspace_upload_intents(expense_id);

-- 3. Expense paperwork uploads. Accounts and management add them: to an expense still being
-- decided, or to a delivered purchase waiting for its supplier invoice. Returns the property, or
-- null when not allowed. The subject is passed in, because the upload is committed by the server.
create or replace function private.workspace_expense_upload_property(subject uuid, target_expense uuid, target_work uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select x.property_id from private.workspace_expenses x join public.workspace_profiles p on p.user_id=subject and p.status='active'
    where target_work is null and x.id=target_expense and x.status in ('draft','to_approve','queried')
    and (p.role in ('admin','super_admin') or (p.role='accounts' and exists(select 1 from public.workspace_module_grants g where g.user_id=subject and g.module_id='maintenance-reconciliation')))),
  (select w.property_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_profiles p on p.user_id=subject and p.status='active'
    where target_expense is null and w.id=target_work and d.kind='purchase' and d.data->>'phase'='delivered' and w.status not in ('completed','cancelled')
    and (p.role in ('admin','super_admin') or (p.role='accounts' and exists(select 1 from public.workspace_module_grants g where g.user_id=subject and g.module_id='purchase-order-accounts')))));
$$;

create or replace function private.workspace_prepare_expense_upload(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent private.workspace_upload_intents;target_expense uuid;target_work uuid;nonce uuid;
begin
 perform private.workspace_json_keys(input,array['requestId','workId','expenseId','purpose','contentHash']);
 target_expense:=(input->>'expenseId')::uuid;target_work:=(input->>'workId')::uuid;
 if private.workspace_actor_role() is null or input->>'purpose' is distinct from 'expense' or (target_expense is null)=(target_work is null) then raise exception 'Upload access denied' using errcode='42501';end if;
 if private.workspace_expense_upload_property(auth.uid(),target_expense,target_work) is null then raise exception 'Upload purpose or work stage denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),9));
 intent:=(select i from private.workspace_upload_intents i where i.owner_id=auth.uid() and i.request_id=(input->>'requestId')::uuid);
 if intent.id is not null then
  if intent.work_id is distinct from target_work or intent.expense_id is distinct from target_expense or intent.purpose<>'expense' or intent.content_hash<>input->>'contentHash' then raise exception 'Request identifier already used' using errcode='22023';end if;
  if intent.evidence_id is null and intent.expires_at<now() then raise exception 'Upload request expired' using errcode='22023';end if;
 else
  nonce:=gen_random_uuid();
  insert into private.workspace_upload_intents(id,owner_id,request_id,work_id,expense_id,purpose,content_hash,public_id)
   values(nonce,auth.uid(),(input->>'requestId')::uuid,target_work,target_expense,'expense',input->>'contentHash','recharge/'||nonce::text) returning * into intent;
 end if;
 return jsonb_build_object('id',intent.id,'publicId',intent.public_id,'evidenceId',intent.evidence_id);
end $$;

-- Committed by the server once the photo is stored; permission is checked again for its owner.
create or replace function private.integration_commit_expense_upload(target_intent uuid, asset jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare i private.workspace_upload_intents;prop uuid;e uuid;
begin
 i:=(select x from private.workspace_upload_intents x where x.id=target_intent);
 if i.id is null then raise exception 'Upload not found' using errcode='P0002';end if;
 if not exists(select 1 from public.workspace_profiles p where p.user_id=i.owner_id and p.status='active' and p.role in ('accounts','admin','super_admin')) then raise exception 'Upload access revoked' using errcode='42501';end if;
 if i.evidence_id is not null then return i.evidence_id;end if;
 if i.expires_at<now() then raise exception 'Upload expired' using errcode='22023';end if;
 prop:=private.workspace_expense_upload_property(i.owner_id,i.expense_id,i.work_id);
 if prop is null then raise exception 'Upload permission changed' using errcode='42501';end if;
 perform private.workspace_json_keys(asset,array['assetId','publicId','version','format','bytes']);
 if asset->>'publicId' is distinct from i.public_id or coalesce(asset->>'assetId','')='' or coalesce(asset->>'format','') not in ('jpg','png','webp') or jsonb_typeof(asset->'bytes') is distinct from 'number' or jsonb_typeof(asset->'version') is distinct from 'number' or (asset->>'bytes')::integer not between 12 and 8388608 or (asset->>'version')::bigint<1 then raise exception 'Invalid verified asset' using errcode='22023';end if;
 insert into private.workspace_media_evidence(property_id,work_id,expense_id,owner_id,purpose,provider_id,verified_at,asset_version,asset_format,asset_bytes,provider_asset_id)
  values(prop,i.work_id,i.expense_id,i.owner_id,'expense',i.public_id,now(),(asset->>'version')::bigint,asset->>'format',(asset->>'bytes')::integer,asset->>'assetId') returning id into e;
 update private.workspace_upload_intents set evidence_id=e where id=i.id;
 return e;
end $$;

-- Who sees expense paperwork: Accounts and management for that property's expenses, including
-- the repair's own photos once they are evidence on an expense.
create or replace function private.workspace_expense_media_visible(e private.workspace_media_evidence) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('accounts','admin','super_admin'),false) and (
  exists(select 1 from private.workspace_expenses x where x.id=e.expense_id and private.workspace_can_property(x.property_id,'maintenance-reconciliation'))
  or exists(select 1 from private.workspace_expense_evidence v join private.workspace_expenses x on x.id=v.expense_id where v.media_id=e.id and private.workspace_can_property(x.property_id,'maintenance-reconciliation')))
$$;
revoke all on function private.workspace_expense_upload_property(uuid,uuid,uuid),private.workspace_prepare_expense_upload(jsonb),
 private.integration_commit_expense_upload(uuid,jsonb),private.workspace_expense_media_visible(private.workspace_media_evidence) from public,anon,authenticated;

-- 4. A repair's after photos, sent with "Record the completed repair" (photos saved on this repair).
create or replace function private.workspace_check_repair_photos(repair uuid, ids jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if ids is null then return;end if;
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>30 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string')
  or (select count(distinct m.id) from private.workspace_media_evidence m where m.work_id=repair and m.purpose='maintenance' and m.id::text in (select value#>>'{}' from jsonb_array_elements(ids)))<>jsonb_array_length(ids)
 then raise exception 'After photos must be photos saved on this repair' using errcode='22023';end if;
end $$;

-- 5. The draft expense for a completed repair: the contractor, the actual cost, the completion
-- report and the repair's photos. Accounts add the supplier's invoice and send it for approval.
create or replace function private.workspace_repair_draft_expense(repair uuid, amount bigint, report jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.workspace_work_items;d private.workspace_domain_details;e private.workspace_expenses;after_ids jsonb:=coalesce(report->'photoIds','[]'::jsonb);
begin
 if amount is null or amount<1 then return null;end if;
 if exists(select 1 from private.workspace_expenses x where x.work_id=repair and x.source='repair') then return null;end if;
 w:=(select x from public.workspace_work_items x where x.id=repair);
 d:=(select x from private.workspace_domain_details x where x.work_id=repair);
 insert into private.workspace_expenses(property_id,work_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
  values(w.property_id,repair,left(coalesce(nullif(trim(d.data->>'contractor'),''),'Repair contractor'),200),'REPAIR-'||upper(left(replace(repair::text,'-',''),10)),'maintenance',
   left('Repair: '||coalesce(nullif(trim(d.data->>'issue'),''),w.title),3000),amount,current_date,'repair','draft',auth.uid(),gen_random_uuid()) returning * into e;
 insert into private.workspace_expense_evidence(expense_id,kind,label,work_id,note,added_by)
  values(e.id,'report','Repair completion report',repair,left(coalesce(nullif(trim(report->>'report'),''),'Repair completed'),2000),auth.uid());
 insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,added_by)
  select e.id,'photo',case when after_ids ? m.id::text then 'After photo' else 'Before photo' end,m.id,auth.uid()
  from (select x.id from private.workspace_media_evidence x where x.work_id=repair and x.purpose='maintenance' order by after_ids ? x.id::text desc,x.verified_at,x.id limit 12) m;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,repair,'finance.expense_drafted');
 return e.id;
end $$;

-- 6. Paid: a repair's expense approved, its invoice paid, or its invoice task closed.
create or replace function private.workspace_mark_repair_paid(repair uuid, via text) returns void
language sql security definer set search_path='' as $$
 update private.workspace_domain_details set data=data||jsonb_build_object('paidAt',now(),'paidVia',via),updated_at=now()
  where work_id=repair and kind='maintenance' and data->>'phase'='completed' and not (data ? 'paidAt');
$$;
create or replace function private.workspace_repair_paid_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='workspace_expenses' then
  if new.status='approved' and new.work_id is not null then perform private.workspace_mark_repair_paid(new.work_id,'expense');end if;
 elsif tg_table_name='workspace_invoices' then
  if new.status='paid' and new.work_id is not null then perform private.workspace_mark_repair_paid(new.work_id,'invoice');end if;
 elsif new.status='completed' then
  perform private.workspace_mark_repair_paid((d.data->>'sourceWorkId')::uuid,'invoice_task') from private.workspace_domain_details d
   where d.work_id=new.id and d.kind='maintenance_invoice' and d.data->>'sourceWorkId' is not null;
 end if;
 return new;
end $$;
revoke all on function private.workspace_check_repair_photos(uuid,jsonb),private.workspace_repair_draft_expense(uuid,bigint,jsonb),
 private.workspace_mark_repair_paid(uuid,text),private.workspace_repair_paid_trigger() from public,anon,authenticated;
drop trigger if exists repair_paid_expense on private.workspace_expenses;
create trigger repair_paid_expense after update of status on private.workspace_expenses for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
drop trigger if exists repair_paid_invoice on public.workspace_invoices;
create trigger repair_paid_invoice after update of status on public.workspace_invoices for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
drop trigger if exists repair_paid_task on public.workspace_work_items;
create trigger repair_paid_task after update of status on public.workspace_work_items for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
-- Repairs already paid before this change.
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','expense')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from private.workspace_expenses x where x.work_id=d.work_id and x.status='approved');
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','invoice')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from public.workspace_invoices i where i.work_id=d.work_id and i.status='paid');
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','invoice_task')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from private.workspace_domain_details t join public.workspace_work_items tw on tw.id=t.work_id
  where t.kind='maintenance_invoice' and t.data->>'sourceWorkId'=d.work_id::text and tw.status='completed');

-- 7. Accounts actions: attach saved photos to an expense, link it to its job, send a draft for
-- approval, and record a purchase's supplier invoice (optionally already paid).
create or replace function private.workspace_accounts_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_expenses;w public.workspace_work_items;d private.workspace_domain_details;inv public.workspace_invoices;amount bigint;job uuid;ref text;label text;note text;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('attachExpensePhotos','linkExpenseJob','submitDraftExpense') then
  prop:=(select x.property_id from private.workspace_expenses x where x.id=(input->>'expenseId')::uuid);
  if prop is null or not private.workspace_finance_role() or not private.workspace_can_property(prop,'maintenance-reconciliation') then raise exception 'Accounts approval access required' using errcode='42501';end if;
 elsif a='recordPurchaseInvoice' then
  prop:=(select x.property_id from public.workspace_work_items x where x.id=(input->>'purchaseId')::uuid);
  if prop is null or not (actor in ('admin','super_admin') or (actor='accounts' and private.workspace_can_property(prop,'purchase-order-accounts'))) then raise exception 'Accounts purchase access required' using errcode='42501';end if;
 else raise exception 'Unknown Accounts action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.request_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('attachExpensePhotos','linkExpenseJob','submitDraftExpense') then
  perform 1 from private.workspace_expenses where id=(input->>'expenseId')::uuid for update;
  e:=(select x from private.workspace_expenses x where x.id=(input->>'expenseId')::uuid);
  if e.status not in ('draft','to_approve','queried') then raise exception 'This expense has already been decided' using errcode='42501';end if;
 end if;

 if a='attachExpensePhotos' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','kind','label','mediaIds','note']);
  if coalesce(input->>'kind','') not in ('invoice','photo','quote','report') then raise exception 'Choose an evidence type' using errcode='22023';end if;
  label:=private.workspace_required_text(input,'label',2,180);
  if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>2000) then raise exception 'Note is too long' using errcode='22023';end if;
  note:=nullif(trim(coalesce(input->>'note','')),'');
  if jsonb_typeof(input->'mediaIds') is distinct from 'array' or jsonb_array_length(input->'mediaIds') not between 1 and 20 or exists(select 1 from jsonb_array_elements(input->'mediaIds') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[0-9a-fA-F-]{36}$')
   or (select count(distinct m.id) from private.workspace_media_evidence m where m.id::text in (select lower(value#>>'{}') from jsonb_array_elements(input->'mediaIds'))
       and (m.expense_id=e.id or (m.work_id is not null and m.work_id=e.work_id and m.property_id=e.property_id)))<>jsonb_array_length(input->'mediaIds')
  then raise exception 'Add photos saved on this expense or on its linked job' using errcode='22023';end if;
  insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,note,added_by)
   select e.id,input->>'kind',case when x.n=1 then label else label||' ('||x.n||')' end,x.id,note,auth.uid()
   from (select (value#>>'{}')::uuid id,ordinality n from jsonb_array_elements(input->'mediaIds') with ordinality) x
   where not exists(select 1 from private.workspace_expense_evidence v where v.expense_id=e.id and v.media_id=x.id);
  update private.workspace_expenses set version=version+1,updated_at=now() where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);

 elsif a='linkExpenseJob' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','version','workId']);
  if e.version is distinct from (input->>'version')::integer then raise exception 'Expense changed' using errcode='40001';end if;
  job:=(input->>'workId')::uuid;
  if job is not null and not exists(select 1 from public.workspace_work_items jw join private.workspace_domain_details jd on jd.work_id=jw.id
    where jw.id=job and jw.property_id=e.property_id and jw.status in ('approved','completed')
    and ((jd.kind='maintenance' and jd.data->>'phase'='completed') or (jd.kind='purchase' and jd.data->>'phase' in ('delivered','reconciled')))) then raise exception 'Choose a finished repair or delivered purchase at this property' using errcode='22023';end if;
  update private.workspace_expenses set work_id=job,version=version+1,updated_at=now() where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),e.property_id,job,'finance.expense_linked');

 elsif a='submitDraftExpense' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','version','supplier','reference','amountMinor','receivedOn','description']);
  if e.version is distinct from (input->>'version')::integer then raise exception 'Expense changed' using errcode='40001';end if;
  if e.status<>'draft' then raise exception 'Only a draft is sent for approval' using errcode='42501';end if;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<1 or (input->>'receivedOn') is null or (input->>'receivedOn')!~'^\d{4}-\d{2}-\d{2}$' or (input->>'receivedOn')::date>current_date then raise exception 'Add the amount and the date the invoice was received' using errcode='22023';end if;
  if exists(select 1 from private.workspace_expenses x where x.id<>e.id and x.status<>'rejected' and lower(x.supplier)=lower(trim(input->>'supplier')) and lower(x.reference)=lower(trim(input->>'reference'))) then raise exception 'This supplier invoice is already recorded' using errcode='22023';end if;
  update private.workspace_expenses set supplier=private.workspace_required_text(input,'supplier',2,200),reference=private.workspace_required_text(input,'reference',1,120),
   description=private.workspace_required_text(input,'description',5,3000),amount_minor=amount,received_on=(input->>'receivedOn')::date,status='to_approve',version=version+1,updated_at=now()
   where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),e.property_id,e.work_id,'finance.expense_received');

 elsif a='recordPurchaseInvoice' then
  perform private.workspace_json_keys(input,array['action','requestId','purchaseId','reference','amountMinor','paid']);
  perform 1 from public.workspace_work_items where id=(input->>'purchaseId')::uuid for update;
  w:=(select x from public.workspace_work_items x where x.id=(input->>'purchaseId')::uuid);
  d:=(select x from private.workspace_domain_details x where x.work_id=w.id);
  if d.kind is distinct from 'purchase' or d.data->>'phase' is distinct from 'delivered' or w.status<>'approved' then raise exception 'Record the invoice once the purchase has been delivered' using errcode='22023';end if;
  if jsonb_typeof(input->'paid') is distinct from 'boolean' then raise exception 'Say whether the supplier has been paid' using errcode='22023';end if;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<1 or amount>coalesce((d.data->>'approvedAmountMinor')::bigint,0) then raise exception 'The invoice is more than the approved amount' using errcode='22023';end if;
  ref:=private.workspace_required_text(input,'reference',1,100);
  inv:=(select x from public.workspace_invoices x where x.work_id=w.id and x.status<>'void' order by x.created_at desc limit 1);
  if inv.id is not null then
   if inv.reference<>ref or inv.amount_minor<>amount then raise exception 'Another invoice is already recorded for this purchase' using errcode='22023';end if;
  else
   if exists(select 1 from public.workspace_invoices x where x.reference=ref) then raise exception 'That invoice reference is already recorded. Add the supplier name to it' using errcode='22023';end if;
   insert into public.workspace_invoices(request_id,property_id,work_id,module_id,recipient_id,reference,amount_minor,currency,created_by)
    values(req,w.property_id,w.id,'purchase-order-accounts',auth.uid(),ref,amount,'GBP',auth.uid()) returning * into inv;
  end if;
  if (input->>'paid')::boolean and inv.status='issued' then
   update public.workspace_invoices set status='paid',paid_at=now(),version=version+1 where id=inv.id returning * into inv;
  end if;
  result:=jsonb_build_object('invoiceId',inv.id,'workId',w.id,'reference',inv.reference,'amountMinor',inv.amount_minor,'status',inv.status);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'finance.purchase_invoice_recorded');
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Jobs an expense can be linked to: finished repairs and delivered purchases at the property.
create or replace function private.workspace_accounts_read(section text, target_property uuid default null, target_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='jobs' then
  if target_property is null or not private.workspace_finance_role() or not private.workspace_can_property(target_property,'maintenance-reconciliation') then raise exception 'Accounts approval access required' using errcode='42501';end if;
  return (select coalesce(jsonb_agg(j.v order by j.done desc,j.id),'[]') from (
   select w.id,coalesce(w.completed_at,w.updated_at) done,jsonb_build_object('workId',w.id,'kind',d.kind,'title',w.title,
    'detail',left(coalesce(d.data->>'issue',d.data->>'requirements',w.title),200),'phase',d.data->>'phase',
    'supplier',coalesce(d.data->>'contractor',d.data->>'supplier'),'costMinor',coalesce((d.data->>'actualCostMinor')::bigint,(d.data->>'approvedAmountMinor')::bigint),
    'doneOn',(coalesce(w.completed_at,w.updated_at) at time zone 'Europe/London')::date,
    'photoCount',(select count(*) from private.workspace_media_evidence m where m.work_id=w.id and m.purpose in ('maintenance','delivery'))) v
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where w.property_id=target_property and w.status in ('approved','completed') and w.updated_at>now()-interval '400 days'
    and ((d.kind='maintenance' and d.data->>'phase'='completed') or (d.kind='purchase' and d.data->>'phase' in ('delivered','reconciled')))
   order by coalesce(w.completed_at,w.updated_at) desc limit 40) j);
 end if;
 raise exception 'Unknown Accounts section' using errcode='22023';
end $$;

-- 8. Ready Home: repairs at each stage, from the Stays report to payment, and this month's
-- routine visits for each property the person looks after.
create or replace function private.workspace_ready_home() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();today date:=(now() at time zone 'Europe/London')::date;month_start date;props uuid[];
begin
 if actor is null or actor not in ('ready','stays','admin','super_admin') then raise exception 'Ready access required' using errcode='42501';end if;
 month_start:=date_trunc('month',today)::date;
 props:=array(select p.id from public.workspace_properties p where p.status<>'archived' and (actor in ('admin','super_admin')
  or exists(select 1 from public.workspace_property_assignments s where s.property_id=p.id and s.user_id=auth.uid() and s.assignment='staff')));
 return jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'today',today,
  'stages',(select coalesce(jsonb_object_agg(x.stage,x.n),'{}') from (
    select case when d.data->>'phase'='completed' and d.data ? 'paidAt' then 'paid' else coalesce(d.data->>'phase','triage') end stage,count(*) n
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='maintenance' and w.property_id=any(props) and w.status not in ('cancelled','declined')
     and (private.workspace_can_property(w.property_id,'maintenance-reporting') or private.workspace_can_property(w.property_id,'stays-maintenance-reporting'))
     and (coalesce(d.data->>'phase','')<>'completed'
      or (not (d.data ? 'paidAt') and coalesce(w.completed_at,w.updated_at)>=now()-interval '90 days')
      or (d.data ? 'paidAt' and (d.data->>'paidAt')::timestamptz>=month_start::timestamp at time zone 'Europe/London'))
    group by 1) x),
  'visits',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,'items',v.items) order by p.name,p.id),'[]')
    from public.workspace_properties p cross join lateral (
     select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'title',w.title,'dueOn',w.due_on,'status',w.status,'assigneeName',a.full_name,'mine',w.assignee_id=auth.uid()) order by w.due_on,w.id),'[]') items,count(*) n
     from private.workspace_routine_visits rv join public.workspace_work_items w on w.id=rv.work_id left join public.workspace_profiles a on a.user_id=w.assignee_id
     where rv.period_start=month_start and w.property_id=p.id and w.status not in ('cancelled','declined') and private.workspace_can_work(w.id)) v
    where p.id=any(props) and (v.n>0 or exists(select 1 from private.workspace_routine_plans r where r.property_id=p.id and r.active and private.workspace_can_property(p.id,r.module_id)))));
end $$;

-- 9. Routine visits for this month and next, created on a schedule (bounded per run), and one
-- reminder to whoever does a visit three days before it is due: the assignee, otherwise Ready on
-- the property, otherwise management. Run by the server every 15 minutes.
create or replace function private.workspace_routine_auto(at_time timestamptz default now()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(at_time at time zone 'Europe/London')::date;start_on date;plan private.workspace_routine_plans;target uuid;visit record;ev bigint;who uuid[];
 created integer:=0;remaining integer:=0;reminded integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('workspace_routine_auto',0));
 foreach start_on in array array[date_trunc('month',today)::date,(date_trunc('month',today)+interval '1 month')::date] loop
  for plan in select r.* from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id
    where r.active and p.status<>'archived' and r.starts_on<=start_on
    and (r.frequency='monthly' or ((extract(year from start_on)-extract(year from r.starts_on))*12+extract(month from start_on)-extract(month from r.starts_on))::int%3=0)
    and not exists(select 1 from private.workspace_routine_visits v where v.plan_id=r.id and v.period_start=start_on) order by start_on,r.property_id,r.id loop
   if created>=40 then remaining:=remaining+1;continue;end if;
   target:=private.workspace_handover(plan.property_id,plan.module_id,plan.title,'routine_visit',jsonb_build_object('planId',plan.id,'period',to_char(start_on,'YYYY-MM'),'checklist',plan.checklist,'scheduled',true));
   update public.workspace_work_items set due_on=start_on+plan.day_of_month-1,assignee_id=case when exists(select 1 from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
     where s.property_id=plan.property_id and s.user_id=plan.assignee_id and s.assignment='staff' and p.status='active') then plan.assignee_id end where id=target;
   insert into private.workspace_routine_visits(plan_id,period_start,work_id) values(plan.id,start_on,target);
   created:=created+1;
  end loop;
 end loop;
 for visit in select w.id,w.property_id,w.module_id,w.assignee_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='routine_visit' and w.status in ('waiting','in_progress') and w.due_on between today and today+3 and not (d.data ? 'reminderSentAt') order by w.due_on,w.id limit 200 loop
  who:=array(select p.user_id from public.workspace_profiles p where p.user_id=visit.assignee_id and p.status='active');
  if cardinality(who)=0 then who:=array(select s.user_id from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
   join public.workspace_module_grants g on g.user_id=s.user_id and g.module_id=visit.module_id where s.property_id=visit.property_id and s.assignment='staff' and p.role='ready' and p.status='active');end if;
  if cardinality(who)=0 then who:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');end if;
  insert into public.workspace_activity(property_id,work_id,event_type,created_at) values(visit.property_id,visit.id,'routine.visit_due',at_time) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) select distinct u,visit.id,ev from unnest(who) u on conflict do nothing;
  update private.workspace_domain_details set data=data||jsonb_build_object('reminderSentAt',at_time),updated_at=now() where work_id=visit.id;
  reminded:=reminded+1;
 end loop;
 return jsonb_build_object('created',created,'remaining',remaining,'reminded',reminded);
end $$;

-- 10. Stays working a direct booking see that booking's invoice (only invoices on direct-booking
-- work at properties where they hold direct bookings), so they can confirm it once paid.
create or replace function private.workspace_direct_booking_invoice_visible(target_work uuid, target_property uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select target_work is not null and coalesce(private.workspace_actor_role() in ('stays','admin','super_admin'),false)
  and private.workspace_can_property(target_property,'direct-bookings')
  and exists(select 1 from private.workspace_domain_details d join public.workspace_work_items w on w.id=d.work_id where d.work_id=target_work and d.kind='direct_booking' and w.property_id=target_property);
$$;
revoke all on function private.workspace_direct_booking_invoice_visible(uuid,uuid) from public,anon;
grant execute on function private.workspace_direct_booking_invoice_visible(uuid,uuid) to authenticated;
drop policy if exists invoices_direct_booking on public.workspace_invoices;
create policy invoices_direct_booking on public.workspace_invoices for select to authenticated using (private.workspace_direct_booking_invoice_visible(work_id,property_id));

-- 11. Ready read a property's access instructions (not logins or finance) when they look after it.
create or replace function private.workspace_ready_property(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role()='ready' and (private.workspace_can_property(target,'maintenance-reporting')
  or private.workspace_can_property(target,'new-property-inspection-board') or private.workspace_can_property(target,'ready-schedule'));
$$;
revoke all on function private.workspace_ready_property(uuid),private.workspace_accounts_action(jsonb),private.workspace_accounts_read(text,uuid,uuid),
 private.workspace_ready_home(),private.workspace_routine_auto(timestamptz) from public,anon,authenticated;

-- 12. Patches to existing functions, each inside its own feature's branch.
do $$
declare
 fixes constant text[][] := array[
  -- Uploads: expense paperwork goes to its own checks.
  ['private.workspace_prepare_upload(jsonb)',
   $q$perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);$q$,
   $q$if input->>'purpose'='expense' then return private.workspace_prepare_expense_upload(input);end if;
 perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);$q$,
   $q$workspace_prepare_expense_upload$q$],
  ['private.integration_commit_upload(uuid,jsonb)',
   $q$if not found then raise exception 'Upload not found' using errcode='P0002';end if;$q$,
   $q$if not found then raise exception 'Upload not found' using errcode='P0002';end if;
 if i.purpose='expense' then return private.integration_commit_expense_upload(i.id,asset);end if;$q$,
   $q$integration_commit_expense_upload$q$],
  ['private.workspace_media_visible(private.workspace_media_evidence)',
   $q$private.workspace_operation_access(e.work_id)$q$,
   $q$private.workspace_operation_access(e.work_id) or private.workspace_expense_media_visible(e)$q$,
   $q$workspace_expense_media_visible$q$],
  -- Completing a repair: optional after photos, then the draft expense for Accounts.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate']);$q$,
   $q$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate','photoIds']);perform private.workspace_check_repair_photos(target,data->'photoIds');$q$,
   $q$workspace_check_repair_photos$q$],
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));$q$,
   $q$perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));
    perform private.workspace_repair_draft_expense(target,amount,data);$q$,
   $q$workspace_repair_draft_expense$q$],
  -- Draft expenses: listed, counted, evidenced and rejectable like the others.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$if status_filter is not null and status_filter not in ('to_approve','queried','approved','rejected') then$q$,
   $q$if status_filter is not null and status_filter not in ('draft','to_approve','queried','approved','rejected') then$q$,
   $q$not in ('draft','to_approve','queried','approved','rejected')$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'queriedCount',count(*) filter(where status='queried'),$q$,
   $q$'queriedCount',count(*) filter(where status='queried'),'draftCount',count(*) filter(where status='draft'),$q$,
   $q$'draftCount'$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if e.status not in ('to_approve','queried') then raise exception 'Evidence can only be added before a decision'$q$,
   $q$if e.status not in ('draft','to_approve','queried') then raise exception 'Evidence can only be added before a decision'$q$,
   $q$not in ('draft','to_approve','queried') then raise exception 'Evidence$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if e.status not in ('to_approve','queried') then raise exception 'Expense already decided'$q$,
   $q$if e.status not in ('draft','to_approve','queried') then raise exception 'Expense already decided'$q$,
   $q$not in ('draft','to_approve','queried') then raise exception 'Expense already$q$],
  -- Ready: the access instructions for properties they look after.
  ['private.workspace_property_details(uuid,text)',
   $q$if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or$q$,
   $q$if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or private.workspace_ready_property(target_property) or$q$,
   $q$workspace_ready_property$q$]
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

-- 13. Public wrappers.
create or replace function public.workspace_accounts_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_accounts_action(input);$$;
create or replace function public.workspace_accounts_read(section text, target_property uuid default null, target_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_accounts_read(section,target_property,target_id);$$;
create or replace function public.workspace_ready_home() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_ready_home();$$;
create or replace function public.workspace_routine_auto() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_routine_auto();$$;
revoke all on function public.workspace_accounts_action(jsonb),public.workspace_accounts_read(text,uuid,uuid),public.workspace_ready_home() from public,anon;
grant execute on function private.workspace_accounts_action(jsonb),private.workspace_accounts_read(text,uuid,uuid),private.workspace_ready_home(),
 public.workspace_accounts_action(jsonb),public.workspace_accounts_read(text,uuid,uuid),public.workspace_ready_home() to authenticated;
revoke all on function public.workspace_routine_auto() from public,anon,authenticated;
grant execute on function private.workspace_routine_auto(timestamptz),public.workspace_routine_auto() to service_role;
