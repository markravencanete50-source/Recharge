-- Owner contact details on the property page. A property's owners are the people assigned to it as
-- its client (plus the onboarding client). Only the team who deal with owners can read them: admins,
-- Stays with the property database for that property, and Accounts with owner statements for it.
do $$
declare definition text;
 anchor constant text:=$q$ elsif section='finance' then$q$;
 addition constant text:=$q$ elsif section='owner' then
  if not (actor in ('admin','super_admin') or (actor='stays' and private.workspace_can_property(target_property,'property-database')) or (actor='accounts' and private.workspace_can_property(target_property,'owner-statements'))) then raise exception 'Owner details access denied' using errcode='42501';end if;
  return jsonb_build_object('owners',coalesce((select jsonb_agg(jsonb_build_object('name',pr.full_name,'email',u.email) order by pr.full_name) from public.workspace_profiles pr join auth.users u on u.id=pr.user_id
   where pr.user_id in (select a.user_id from public.workspace_property_assignments a where a.property_id=target_property and a.assignment='client' union select j.client_id from private.workspace_journeys j where j.property_id=target_property)),'[]'));
$q$;
begin
 definition:=pg_get_functiondef('private.workspace_property_details(uuid,text)'::regprocedure);
 if position($q$section='owner'$q$ in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'Patch anchor missing: property details finance section'; end if;
 execute replace(definition,anchor,addition||anchor);
end $$;
