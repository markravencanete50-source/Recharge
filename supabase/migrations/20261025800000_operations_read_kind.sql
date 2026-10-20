-- Faster repair screens (Lee: Reactive Jobs took 10 to 15 seconds to open). The repair screens read every work item in the
-- business (about 900, mostly cleans) through public.workspace_operations_read and kept only the repairs; that read builds
-- each item's view one by one and averaged 2.4 seconds on live, up to 8. This adds the same read limited to one kind of work,
-- so a screen that needs only repairs asks for only repairs. Same access rules: the same row filter
-- (private.workspace_operation_access) and the same view (private.workspace_operation_view); the original read is unchanged.
-- Safe to run twice.

create or replace function private.workspace_operations_read_kind(target_property uuid, only_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if only_kind is null or only_kind !~ '^[a-z_]{1,40}$' then raise exception 'Choose a kind of work' using errcode='22023';end if;
 select coalesce(jsonb_agg(private.workspace_operation_view(w.id) order by w.updated_at desc),'[]') into items from (
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind=only_kind and (target_property is null or w.property_id=target_property) and w.status not in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 5000)
  union all
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind=only_kind and (target_property is null or w.property_id=target_property) and w.status in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 200)
 ) w;
 return items;
end $$;

create or replace function public.workspace_operations_read_kind(target_property uuid default null, only_kind text default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_operations_read_kind(target_property,only_kind);$$;

-- The kind is looked up before the access checks run on each row.
create index if not exists workspace_domain_details_kind_idx on private.workspace_domain_details(kind);

revoke all on function private.workspace_operations_read_kind(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.workspace_operations_read_kind(uuid,text) to authenticated;
revoke all on function public.workspace_operations_read_kind(uuid,text) from public,anon;
grant execute on function public.workspace_operations_read_kind(uuid,text) to authenticated;
