-- OTA logins are for the Stays team and admins only, by role as well as by tool grant: a Ready
-- or Accounts account given the "ota-logins" tool by mistake still cannot read platform logins.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_property_details(uuid,text)',
   $q$if actor in ('client','cleans','cleaning_manager') or not private.workspace_can_property(target_property,'ota-logins') then raise exception 'OTA access denied' using errcode='42501';end if;$q$,
   $q$if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(target_property,'ota-logins') then raise exception 'OTA access denied' using errcode='42501';end if;$q$,
   $q$if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(target_property,'ota-logins')$q$]
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
