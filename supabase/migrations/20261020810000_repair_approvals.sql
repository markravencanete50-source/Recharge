-- Repair approvals (Lee, Round 2): one company limit, £100 unless management change it.
--
--  * Under the limit: the quote is approved automatically. The repair carries on (Stays refer it to Ready, who book it)
--    and records autoApprovedAt, autoApprovedMinor and autoApprovalLimitMinor, so the app can show
--    "Approved automatically (under £100)". The owner sees it on the repair and in their updates.
--  * At or over the limit: management approve first, then the owner is asked. The owner's approval books the work.
--    Before this, the owner was asked first and management second; the order is swapped. An owner who pre-authorised
--    repairs on their set-up form (any amount, or up to their own amount) is not asked again, as before.
--  * Contractor estimates: always need management approval, whatever the amount. A quote now says where it came from
--    (quoteSource: 'team' for the Ready team, 'contractor' for an outside contractor's estimate). A quote that does not
--    say is a Ready team quote, so older apps keep working. Under the limit, management are the only approval.
--  * After the owner says no, a new quote always goes back to them (through management first when it needs it).
--  * The limit is private.workspace_finance_policy.management_repair_limit_minor (from 20261009160000). It is null on live,
--    so it is set to 10000 (£100) here, only while it is still null. Null at any time also reads as £100.
--    Admins and super admins change it in Management, as before (finance action setRepairApprovalLimit).
--  * Owners no longer receive management's approval note or decline reason (they now act after management).
--
-- Repairs already waiting when this goes live keep working:
--  * Waiting for the owner: unchanged for the owner. Once they approve, a repair at or over the limit goes to management
--    (the old order, for these only, because the owner has already been asked).
--  * Waiting for management: once approved, the owner is asked only if they have not approved it already and it is not
--    within their own pre-authorised amount.
--
-- Functions replaced whole (each defined by one migration only, 20261009160000, or 20261014160000 for the owner filter):
--   private.workspace_repair_needs_management(bigint,jsonb), private.workspace_repair_requote(uuid,bigint,jsonb,jsonb),
--   private.workspace_management_repairs(), private.workspace_owner_work_data(jsonb).
-- New: private.workspace_repair_limit(), private.workspace_repair_quote_source(jsonb),
--   private.workspace_repair_needs_owner(uuid,bigint,jsonb), private.workspace_repair_route(uuid,bigint,jsonb,text).
-- Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present):
--   private.workspace_operations_action(jsonb): repair create (accepts quoteSource; routes the new repair) and reviseQuote
--   (accepts quoteSource and keeps it on the repair).
--   private.workspace_repair_decision(text,uuid,jsonb,jsonb): approveManagement sends the repair to the owner when needed.
-- Safe to run twice.

update private.workspace_finance_policy set management_repair_limit_minor=10000,version=version+1,updated_at=now()
 where singleton and management_repair_limit_minor is null;

-- The repair limit in pence: the policy's amount, or £100 when none is set.
create or replace function private.workspace_repair_limit() returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select f.management_repair_limit_minor from private.workspace_finance_policy f where f.singleton),10000);
$$;

-- Where a quote came from: 'team' (the Ready team, the default) or 'contractor' (an outside contractor's estimate).
create or replace function private.workspace_repair_quote_source(input jsonb) returns text language plpgsql immutable set search_path='' as $$
begin
 if input ? 'quoteSource' and (jsonb_typeof(input->'quoteSource') is distinct from 'string' or input->>'quoteSource' not in ('team','contractor')) then
  raise exception 'Say whether the quote is from the Ready team or a contractor' using errcode='22023';
 end if;
 return coalesce(input->>'quoteSource','team');
end $$;

-- Management approve a contractor estimate (any amount) and any quote at or over the limit, unless they have already
-- approved this amount or more.
create or replace function private.workspace_repair_needs_management(amount bigint, repair jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select (coalesce(repair->>'quoteSource','')='contractor' or (amount>0 and amount>=private.workspace_repair_limit()))
  and amount>coalesce((repair->>'managementApprovedMinor')::bigint,-1);
$$;

-- The owner approves a quote at or over the limit, unless their set-up form pre-authorised it or they have already
-- approved this amount or more. When the owner's last word on the repair was no, they are always asked again.
create or replace function private.workspace_repair_needs_owner(prop uuid, amount bigint, repair jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select (repair->>'ownerDeclinedAt' is not null and (repair->>'ownerApprovedAt' is null or (repair->>'ownerApprovedAt')::timestamptz<(repair->>'ownerDeclinedAt')::timestamptz))
  or (amount>0 and amount>=private.workspace_repair_limit()
   and not coalesce((select coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0) from private.workspace_journeys j where j.property_id=prop),false)
   and amount>coalesce((repair->>'ownerApprovedMinor')::bigint,-1));
$$;

-- Where a repair with this quote goes next: management, then the owner, else back to work (resume), recording an
-- automatic approval when the quote is under the limit and is not a contractor estimate.
create or replace function private.workspace_repair_route(prop uuid, amount bigint, repair jsonb, resume text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim bigint:=private.workspace_repair_limit();begin
 if private.workspace_repair_needs_management(amount,repair) then return jsonb_build_object('phase','management_approval','resumePhase',resume);end if;
 if private.workspace_repair_needs_owner(prop,amount,repair) then return jsonb_build_object('phase','owner_approval','resumePhase',resume);end if;
 return jsonb_build_object('phase',resume,'resumePhase',null)
  ||case when amount>0 and amount<lim and coalesce(repair->>'quoteSource','')<>'contractor'
    then jsonb_build_object('autoApprovedMinor',amount,'autoApprovalLimitMinor',lim,'autoApprovedAt',now()) else '{}'::jsonb end;
end $$;

-- A new quote on an open or declined repair. After a decline, or when the quote goes up or is a contractor estimate, it
-- goes through the approvals again; a lower Ready team quote carries on where the repair was.
create or replace function private.workspace_repair_requote(prop uuid, amount bigint, repair jsonb, change jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare resume text;begin
 resume:=case when repair->>'phase' in ('owner_approval','management_approval','owner_declined','management_declined') then coalesce(repair->>'resumePhase','triage') else coalesce(repair->>'phase','triage') end;
 if repair->>'phase' in ('owner_declined','management_declined') or amount>coalesce((repair->>'estimatedCostMinor')::bigint,0) or coalesce(change->>'quoteSource','')='contractor' then
  return private.workspace_repair_route(prop,amount,repair||change,resume);
 end if;
 return '{}'::jsonb;
end $$;

-- Management → Waiting on you: repairs waiting for management, with where the quote came from, the limit in force and
-- whether the owner is asked after management.
create or replace function private.workspace_management_repairs() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,
   'issue',d.data->>'issue','repairType',d.data->>'repairType','urgent',coalesce((d.data->>'urgent')::boolean,false),'hazard',coalesce((d.data->>'hazard')::boolean,false),
   'estimatedCostMinor',(d.data->>'estimatedCostMinor')::bigint,'previousEstimateMinor',(d.data->>'previousEstimateMinor')::bigint,'quoteReason',d.data->>'quoteReason',
   'ownerApprovedAt',d.data->>'ownerApprovedAt','limitMinor',private.workspace_repair_limit(),'waitingSince',w.updated_at,
   'quoteSource',coalesce(d.data->>'quoteSource','team'),
   'ownerNext',private.workspace_repair_needs_owner(w.property_id,(d.data->>'estimatedCostMinor')::bigint,d.data)) order by w.updated_at,w.id),'[]')
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
 where d.kind='maintenance' and d.data->>'phase'='management_approval' and w.status not in ('completed','cancelled');
$$;

-- The owner filter (20261014160000), now also without management's note and decline reason.
create or replace function private.workspace_owner_work_data(item jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(item)='object' then
  coalesce((select jsonb_object_agg(e.k,e.v) from jsonb_each(item-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'-'resolvedBy'-'managementNote'-'managementDeclinedReason') e(k,v) where e.k !~ 'By$'),'{}'::jsonb)
  else item end;
$$;

do $patch$
declare
 fixes constant text[][] := array[
  -- 1. A new repair may say where its estimate came from.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['issue','reservationId','estimatedCostMinor','hazard','repairType','urgent']);$a$,
   $r$perform private.workspace_json_keys(data,array['issue','reservationId','estimatedCostMinor','hazard','repairType','urgent','quoteSource']);perform private.workspace_repair_quote_source(data);$r$,
   $s$'repairType','urgent','quoteSource']);perform private.workspace_repair_quote_source(data);$s$],
  -- 2. A new repair goes to management, then the owner, or straight to work (approved automatically under the limit).
  ['private.workspace_operations_action(jsonb)',
   $a$if data->>'phase'='triage' and private.workspace_repair_needs_management(amount,'{}'::jsonb) then data:=data||jsonb_build_object('phase','management_approval');notify_users:=private.workspace_repair_managers();end if;$a$,
   $r$data:=data||private.workspace_repair_route(prop,amount,data,'triage');if data->>'phase'='management_approval' then notify_users:=private.workspace_repair_managers();end if;$r$,
   $s$data:=data||private.workspace_repair_route(prop,amount,data,'triage');$s$],
  -- 3. A new quote may say where it came from.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['quoteMinor','reason']);$a$,
   $r$perform private.workspace_json_keys(data,array['quoteMinor','reason','quoteSource']);entry:=jsonb_build_object('quoteSource',private.workspace_repair_quote_source(data));$r$,
   $s$entry:=jsonb_build_object('quoteSource',private.workspace_repair_quote_source(data));$s$],
  -- 4. ...and the repair keeps it, so the approvals see it.
  ['private.workspace_operations_action(jsonb)',
   $a$data:=data||private.workspace_repair_requote(prop,amount,d.data,data);$a$,
   $r$data:=data||entry;data:=data||private.workspace_repair_requote(prop,amount,d.data,data);$r$,
   $s$data:=data||entry;data:=data||private.workspace_repair_requote($s$],
  -- 5. Once management approve, the owner is asked when they need to be; otherwise the repair carries on.
  ['private.workspace_repair_decision(text,uuid,jsonb,jsonb)',
   $a$return jsonb_build_object('data',jsonb_build_object('phase',coalesce(repair->>'resumePhase','triage'),'resumePhase',null,'managementApprovedBy'$a$,
   $r$return jsonb_build_object('data',jsonb_build_object('phase',case when private.workspace_repair_needs_owner(prop,(repair->>'estimatedCostMinor')::bigint,repair) then 'owner_approval' else coalesce(repair->>'resumePhase','triage') end,'resumePhase',case when private.workspace_repair_needs_owner(prop,(repair->>'estimatedCostMinor')::bigint,repair) then coalesce(repair->>'resumePhase','triage') end,'managementApprovedBy'$r$,
   $s$then 'owner_approval' else coalesce(repair->>'resumePhase','triage') end$s$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_repair_limit(),private.workspace_repair_quote_source(jsonb),private.workspace_repair_needs_owner(uuid,bigint,jsonb),
 private.workspace_repair_route(uuid,bigint,jsonb,text),private.workspace_repair_needs_management(bigint,jsonb),private.workspace_repair_requote(uuid,bigint,jsonb,jsonb),
 private.workspace_management_repairs(),private.workspace_owner_work_data(jsonb) from public,anon,authenticated;
