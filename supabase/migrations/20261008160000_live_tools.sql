-- Every tool in the live app (8 October 2026).
-- 1. Accounts confirm invoice payments for the invoices their tools cover (previously admins only).
-- 2. An onboarding invoice links itself to the owner's onboarding as soon as it is recorded,
--    so Accounts can raise it from their task without the onboarding board.
-- 3. Mailbox: the cleaner records what they did with the post (following the owner's mailbox
--    permission) with a short note, and owners read it in the app.

create or replace function private.workspace_set_invoice_status(target_invoice uuid,expected_version integer,next_status text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.workspace_invoices;actor text:=coalesce(private.workspace_actor_role(),'');
begin
  select * into previous from public.workspace_invoices where id=target_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
  if not (actor in ('admin','super_admin') or (actor='accounts' and private.workspace_can_property(previous.property_id,previous.module_id))) then raise exception 'Admin or Accounts payment confirmation required' using errcode='42501'; end if;
  if previous.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if previous.status<>'issued' or next_status is null or next_status not in ('paid','void') then raise exception 'Invalid invoice transition' using errcode='22023'; end if;
  update public.workspace_invoices set status=next_status,paid_at=case when next_status='paid' then now() else null end,version=version+1 where id=target_invoice;
end $$;

create function private.workspace_link_onboarding_invoice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.module_id='onboarding-invoices' and new.status<>'void' then
  -- No version change: the admin's own "link the invoice" step may already be on its way.
  update private.workspace_journeys set invoice_id=new.id,updated_at=now()
   where property_id=new.property_id and client_id=new.recipient_id and invoice_id is null and signed_at is not null;
 end if;
 return new;
end $$;
create trigger journey_invoice_linked after insert on public.workspace_invoices for each row execute function private.workspace_link_onboarding_invoice();
-- Linking the invoice that is already linked is accepted rather than refused.
do $$
declare definition text;
 anchor constant text:=$q$ or j.invoice_id is not null or invoice.property_id$q$;
 fixed constant text:=$q$ or (j.invoice_id is not null and j.invoice_id<>invoice.id) or invoice.property_id$q$;
begin
 definition:=pg_get_functiondef('private.workspace_journey_action(jsonb)'::regprocedure);
 if position('j.invoice_id<>invoice.id' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_journey_action'; end if;
  execute replace(definition,anchor,fixed);
 end if;
end $$;
revoke all on function private.workspace_link_onboarding_invoice() from public,anon,authenticated;

-- The cleaner's mailbox note travels with their clean report.
do $$
declare definition text;begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position($q$array['checks','report','photoIds','mailAction','mailNote']$q$ in definition)=0 then
  if position($q$array['checks','report','photoIds','mailAction']$q$ in definition)=0 then raise exception 'Patch anchor missing in workspace_operations_action'; end if;
  execute replace(definition,$q$array['checks','report','photoIds','mailAction']$q$,$q$array['checks','report','photoIds','mailAction','mailNote']$q$);
 end if;
end $$;

-- Mail handled at the owner's properties in the last 90 days.
create function private.workspace_mailbox_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();begin
 if actor is null or actor not in ('client','admin','super_admin','stays') then raise exception 'Mailbox access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'on',coalesce(w.due_on,(w.updated_at at time zone 'Europe/London')::date),
   'action',d.data->>'mailAction','note',left(coalesce(d.data->>'mailNote',''),500)) order by w.updated_at desc)
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
  where d.kind='cleaning' and coalesce(d.data->>'mailAction','none')<>'none' and w.updated_at>now()-interval '90 days'
   and private.workspace_can_property(w.property_id,case when actor='client' then 'client-mailbox' else 'clean-reporting' end)),'[]');
end $$;
revoke all on function private.workspace_mailbox_read() from public,anon,authenticated;

do $$
declare definition text;begin
 definition:=pg_get_functiondef('private.workspace_teams_read(text,date,date,uuid,uuid)'::regprocedure);
 if position('workspace_mailbox_read' in definition)=0 then
  if position($q$ else raise exception 'Unknown team section' using errcode='22023';end if;$q$ in definition)=0 then raise exception 'Patch anchor missing in workspace_teams_read'; end if;
  execute replace(definition,$q$ else raise exception 'Unknown team section' using errcode='22023';end if;$q$,$q$ elsif section='mailbox' then result:=private.workspace_mailbox_read();
 else raise exception 'Unknown team section' using errcode='22023';end if;$q$);
 end if;
end $$;

-- Issuing an invoice from a task picks its recipient when none is given: the cleaner for a clean,
-- otherwise the property's owner (Accounts cannot see the people list).
do $$
declare definition text;
 anchor constant text:=$q$'recipientId',(input->>'recipientId')::uuid,'reference'$q$;
 fixed constant text:=$q$'recipientId',coalesce((input->>'recipientId')::uuid,case when d.kind='cleaning' then w.assignee_id else (select a.user_id from public.workspace_property_assignments a join public.workspace_profiles op on op.user_id=a.user_id where a.property_id=prop and a.assignment='client' and op.status='active' order by a.created_at limit 1) end),'reference'$q$;
begin
 definition:=pg_get_functiondef('private.workspace_controls_action(jsonb)'::regprocedure);
 if position('order by a.created_at limit 1) end),''reference''' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_controls_action'; end if;
  execute replace(definition,anchor,fixed);
 end if;
end $$;

-- Accounts reach a finished clean, repair or direct booking through the invoice task created from
-- it (they are not on the original task), and that task does not carry the original's version.
do $$
declare definition text;
 access_anchor constant text:=$q$if actor in ('client','cleans') or not private.workspace_can_work((input->>'workId')::uuid) then raise exception 'Invoice work access required'$q$;
 access_fixed constant text:=$q$if actor in ('client','cleans') or not (private.workspace_can_work((input->>'workId')::uuid) or exists(select 1 from private.workspace_domain_details hd where hd.kind in ('cleaning_invoice','maintenance_invoice','direct_booking_invoice') and hd.data->>'sourceWorkId'=input->>'workId' and private.workspace_can_work(hd.work_id))) then raise exception 'Invoice work access required'$q$;
 version_anchor constant text:=$q$select * into w from public.workspace_work_items where id=w.id for update;
  if w.version is distinct from (input->>'version')::integer then$q$;
 version_fixed constant text:=$q$select * into w from public.workspace_work_items where id=w.id for update;
  if input->>'version' is not null and w.version is distinct from (input->>'version')::integer then$q$;
begin
 definition:=pg_get_functiondef('private.workspace_controls_action(jsonb)'::regprocedure);
 if position('hd.data->>''sourceWorkId''' in definition)=0 then
  if position(access_anchor in definition)=0 then raise exception 'Patch anchor missing (invoice access)'; end if;
  definition:=replace(definition,access_anchor,access_fixed);
 end if;
 if position('input->>''version'' is not null and w.version' in definition)=0 then
  -- Live definitions may use CRLF line endings: match either.
  if position(version_anchor in definition)>0 then definition:=replace(definition,version_anchor,version_fixed);
  elsif position(replace(version_anchor,E'\n',E'\r\n') in definition)>0 then definition:=replace(definition,replace(version_anchor,E'\n',E'\r\n'),replace(version_fixed,E'\n',E'\r\n'));
  else raise exception 'Patch anchor missing (invoice version)'; end if;
 end if;
 execute definition;
end $$;

-- The invoice guard repeats the work-access check; accept the same invoice-task route.
do $$
declare definition text;
 anchor constant text:=$q$new.amount_minor<=0 or not private.workspace_can_work(w.id) or$q$;
 fixed constant text:=$q$new.amount_minor<=0 or not (private.workspace_can_work(w.id) or exists(select 1 from private.workspace_domain_details hd where hd.kind in ('cleaning_invoice','maintenance_invoice','direct_booking_invoice') and hd.data->>'sourceWorkId'=w.id::text and private.workspace_can_work(hd.work_id))) or$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operation_invoice_guard()'::regprocedure);
 if position('hd.data->>''sourceWorkId''=w.id::text' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_operation_invoice_guard'; end if;
  execute replace(definition,anchor,fixed);
 end if;
end $$;
