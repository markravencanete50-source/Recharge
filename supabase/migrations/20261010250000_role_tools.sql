-- A role change brings that role's usual tools. Moving someone from Admin to Stays (or any role to
-- another) now gives them exactly the tools every Stays has, set by the database rather than trusted
-- from the app; admins and super admins have every tool by role. Tools can be fine-tuned afterwards
-- with the role unchanged. The lists match DEFAULT_ROLE_MODULES in lib/modules.ts (a test checks).
create or replace function private.workspace_role_tools(target_role text) returns text[] language sql immutable set search_path='' as $fn$
 select case target_role
  when 'client' then array['client-dashboard','client-property-maintenance','property-onboarding','client-furnishing','client-mailbox','client-purchase-order-quotes','owner-statements']
  when 'cleans' then array['cleaning-schedule','cleaner-performance','cleans-invoices']
  when 'cleaning_manager' then array['clean-client-database','cleaner-database','cleaning-schedule','cleaner-performance','clean-property-onboarding','cleans-invoices','clean-reporting']
  when 'ready' then array['ready-schedule','safety-maintenance','purchase-order','maintenance-reporting','property-furnishing-board','new-property-inspection-board','routine-bin-garden-board']
  when 'accounts' then array['cleans-invoices','maintenance-reconciliation','onboarding-invoices','purchase-order-invoices','purchase-order-accounts','owner-statements','property-database']
  when 'stays' then array['clean-client-database','cleaner-database','cleaning-schedule','cleaner-performance','clean-property-onboarding','cleans-invoices',
   'ready-schedule','safety-maintenance','purchase-order','maintenance-reporting','property-furnishing-board','new-property-inspection-board','routine-bin-garden-board',
   'property-database','property-onboarding','listing-health','daily-pricing','weekly-performance','licensing','aircover-reporting','direct-bookings','ota-logins',
   'stays-maintenance-reporting','clean-reporting','guest-communication','purchase-order-requests']
  else array[]::text[] end
$fn$;
revoke all on function private.workspace_role_tools(text) from public,anon,authenticated;

do $$
declare
 fixes text[][] := array[
  ['private.workspace_save_access(text,text,text,text,text[],text)',
   $q$select role into previous_role from public.workspace_profiles where user_id = target_id;$q$,
   $q$select role into previous_role from public.workspace_profiles where user_id = target_id;
  -- A new role brings its usual tools; admins have every tool by role, so they keep no grants.
  if previous_role is distinct from next_role then
    next_modules := case when next_role in ('super_admin', 'admin') then array[]::text[] else private.workspace_role_tools(next_role) end;
  end if;$q$,
   $q$A new role brings its usual tools$q$]
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
