-- Faster work list for everyone (Lee: the app is slow to react). public.workspace_operations_read, which the workspace reads on
-- opening and every minute, and the Cleans and Accounts screens read too, built each work item one at a time: for every one
-- of about 900 items it ran the access check (private.workspace_operation_access, itself several role, module and property
-- lookups) and the view (private.workspace_operation_view). It averaged 2.4 seconds on live and reached 8.
-- private.workspace_operations_list does the same in one pass: who is reading, their modules and their properties are looked
-- up once, and every item is checked and shaped against them. The rules are the same ones, written out in the same order:
--  * access = private.workspace_can_work(item) or the Ready and Accounts extras of private.workspace_operation_access;
--  * private.workspace_can_property(property, feature) = the feature is one of the person's modules
--    (private.has_workspace_module) and they are an admin, or Accounts on a finance feature at a valued property, or assigned
--    to the property in their role's way;
--  * the view is private.workspace_operation_view's object, field for field.
-- The full read and the read of one kind (20261025800000) now both use it. Safe to run twice.

create or replace function private.workspace_operations_list(target_property uuid, only_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role(); me uuid:=auth.uid(); mods text[]; places uuid[]; items jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 -- The person's modules, among every module a work item or its owner view can name.
 select coalesce(array_agg(m.module_id),'{}') into mods from (
  select f.module_id from public.workspace_features f union select f.client_module from public.workspace_features f where f.client_module is not null
  union select x from unnest(array['maintenance-reporting','purchase-order','purchase-order-accounts']) x) m(module_id)
 where private.has_workspace_module(m.module_id);
 -- The properties they are assigned to, in their role's way.
 select coalesce(array_agg(a.property_id),'{}') into places from public.workspace_property_assignments a
 where a.user_id=me and a.assignment=case actor when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end;
 with item as (
  select w.*, d.kind as item_kind, d.data as item_data, f.module_id as feature_module, f.client_module,
   coalesce(case when d.kind='maintenance' then d.data->>'assignedReadyId'=me::text or (d.data->>'assignedReadyId' is null and d.data->>'referredAt' is not null) end,true) as ready_sees
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  left join public.workspace_features f on f.module_id=w.module_id
  where (only_kind is null or d.kind=only_kind) and (target_property is null or w.property_id=target_property)
 ), allowed as (
  select i.*, (
   -- private.workspace_can_property(i.property_id, feature), for each feature asked about below.
   ((actor is distinct from 'ready' or i.ready_sees) and i.feature_module is not null and (
    (actor='client' and i.client_visible and i.client_module is not null and i.client_module=any(mods) and (actor in ('admin','super_admin') or (actor='accounts' and i.property_id is not null and private.workspace_finance_feature(i.client_module) and not private.workspace_property_unvalued(i.property_id)) or i.property_id=any(places))) or
    (actor='cleans' and i.assignee_id=me and i.module_id=any(mods) and (actor in ('admin','super_admin') or (actor='accounts' and i.property_id is not null and private.workspace_finance_feature(i.module_id) and not private.workspace_property_unvalued(i.property_id)) or i.property_id=any(places))) or
    (actor not in ('client','cleans') and i.module_id=any(mods) and (actor in ('admin','super_admin') or (actor='accounts' and i.property_id is not null and private.workspace_finance_feature(i.module_id) and not private.workspace_property_unvalued(i.property_id)) or i.property_id=any(places))) or
    (actor='ready' and (
     i.item_kind='maintenance' and i.item_data->>'referredAt' is not null and 'maintenance-reporting'=any(mods) and (actor in ('admin','super_admin') or i.property_id=any(places)) or
     i.item_kind='purchase' and i.item_data->>'phase' in ('ordered','delivered','reconciled') and 'purchase-order'=any(mods) and (actor in ('admin','super_admin') or i.property_id=any(places))))))
   or (actor='ready' and (i.item_kind='maintenance' and i.item_data->>'referredAt' is not null and 'maintenance-reporting'=any(mods) and i.property_id=any(places) and i.ready_sees
     or i.item_kind='purchase' and i.item_data->>'phase' in ('ordered','delivered','reconciled') and 'purchase-order'=any(mods) and i.property_id=any(places)))
   or (actor='accounts' and i.item_kind='purchase' and 'purchase-order-accounts'=any(mods))
  ) as may_see from item i
 ), chosen as (
  (select * from allowed where may_see and status not in ('completed','cancelled') order by updated_at desc limit 5000)
  union all
  (select * from allowed where may_see and status in ('completed','cancelled') order by updated_at desc limit 200)
 )
 select coalesce(jsonb_agg(jsonb_build_object('workId',c.id,'propertyId',c.property_id,'moduleId',c.module_id,'title',c.title,'status',c.status,'version',c.version,'assigneeId',c.assignee_id,'dueOn',c.due_on,'dueTime',to_char(c.due_time,'HH24:MI'),'endTime',to_char(c.due_end_time,'HH24:MI'),'kind',c.item_kind,'createdAt',c.created_at,'updatedAt',c.updated_at,
  'updatedBy',case when actor='client' then null else nullif(trim(p.full_name),'') end,
  'updatedEvent',case when actor='client' then null else a.event_type end,'lastActivityAt',a.created_at,
  'data',case when actor='client' then private.workspace_owner_work_data(c.item_data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'-'resolvedBy') when actor='ready' and c.item_kind='maintenance' then c.item_data-'ownerLimitMinor'-'ownerFullPermission'-'ownerLimitSource'-'autoApprovalLimitMinor'-'autoApprovalSource'-'raisedBy' else c.item_data end)
  order by c.updated_at desc),'[]') into items
 from chosen c
 left join lateral (select x.actor_id,x.event_type,x.created_at from public.workspace_activity x where x.work_id=c.id
  order by x.created_at desc,(x.event_type like 'workspace\_%'),x.id desc limit 1) a on true
 left join public.workspace_profiles p on p.user_id=a.actor_id;
 return items;
end $$;

create or replace function private.workspace_operations_read(target_property uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 return private.workspace_operations_list(target_property,null);
end $$;

create or replace function private.workspace_operations_read_kind(target_property uuid, only_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if only_kind is null or only_kind !~ '^[a-z_]{1,40}$' then raise exception 'Choose a kind of work' using errcode='22023';end if;
 return private.workspace_operations_list(target_property,only_kind);
end $$;

revoke all on function private.workspace_operations_list(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.workspace_operations_list(uuid,text) to authenticated;
