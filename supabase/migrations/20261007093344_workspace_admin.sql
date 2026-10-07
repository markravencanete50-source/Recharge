-- People and property administration for the phone app. Admins see every account
-- with the properties it is assigned to, and every property (including archived)
-- with the people assigned to it. Saving access by account reuses the checked
-- workspace_save_access (role hierarchy, last super admin, cleaner tool limits).
create function private.workspace_admin_read(section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 if section='people' then
  select coalesce(jsonb_agg(private.workspace_account_json(p.user_id)||jsonb_build_object(
    'emailVerified',u.email_confirmed_at is not null,
    'assignments',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',a.property_id,'propertyName',w.name,'propertyStatus',w.status,'assignment',a.assignment) order by w.name,w.id),'[]')
      from public.workspace_property_assignments a join public.workspace_properties w on w.id=a.property_id where a.user_id=p.user_id))
   order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end,p.full_name,p.user_id),'[]') into result
  from public.workspace_profiles p join auth.users u on u.id=p.user_id;
 elsif section='properties' then
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'address',w.address,'region',w.region,'status',w.status,'bedrooms',w.bedrooms,'version',w.version,
    'people',(select coalesce(jsonb_agg(jsonb_build_object('userId',a.user_id,'fullName',p.full_name,'role',p.role,'status',p.status,'assignment',a.assignment) order by p.full_name,p.user_id),'[]')
      from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id where a.property_id=w.id))
   order by case w.status when 'archived' then 1 else 0 end,w.name,w.id),'[]') into result
  from public.workspace_properties w;
 else raise exception 'Unknown admin section' using errcode='22023';end if;
 return result;
end $$;

create function private.workspace_admin_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;target_email text;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 if coalesce(input->>'action','')<>'saveAccess' then raise exception 'Unknown admin action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','userId','fullName','role','status','modules','responsibilities']);
 if jsonb_typeof(input->'modules') is distinct from 'array' or jsonb_array_length(input->'modules')>60 then raise exception 'Choose the tools for this account' using errcode='22023';end if;
 target:=(input->>'userId')::uuid;
 select email into target_email from auth.users where id=target;
 if target_email is null then raise exception 'Account not found' using errcode='P0002';end if;
 perform private.workspace_save_access(target_email,coalesce(input->>'fullName',''),input->>'role',input->>'status',
  array(select jsonb_array_elements_text(input->'modules')),coalesce(input->>'responsibilities',''));
 return private.workspace_account_json(target);
end $$;

revoke all on function private.workspace_admin_read(text),private.workspace_admin_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_admin_read(text),private.workspace_admin_action(jsonb) to authenticated;
create function public.workspace_admin_read(section text) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_admin_read(section); $$;
create function public.workspace_admin_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_admin_action(input); $$;
revoke all on function public.workspace_admin_read(text),public.workspace_admin_action(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_admin_read(text),public.workspace_admin_action(jsonb) to authenticated;
