-- Guest message notices (20261015310000): a Stays person still mid-onboarding cannot open the guest inbox yet (has_workspace_module
-- refuses until private.workspace_onboarded() is true: every required contract signed and every required course done), so they are no
-- longer told about guest messages either. Admins and super admins are never asked to onboard, so they are unchanged. The check is
-- the same one the guest inbox uses, private.workspace_onboarding_status(person)->>'complete', for the person being told. Once
-- they finish onboarding they are told about the next guest message as usual (earlier ones are not sent again).
-- Replaced whole (only 20261015310000 defines it; nothing patches it).
create or replace function private.workspace_guest_message_recipients(prop uuid) returns setof uuid language sql stable security definer set search_path='' as $fn$
 select p.user_id from public.workspace_profiles p
 where p.status='active' and (
  p.role in ('admin','super_admin')
  or (p.role='stays' and private.workspace_guest_messaging_role(p.role)
   and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='guest-communication')
   and (prop is null or exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=p.user_id and a.assignment='staff'))
   and coalesce((private.workspace_onboarding_status(p.user_id)->>'complete')::boolean,false)))
$fn$;
revoke all on function private.workspace_guest_message_recipients(uuid) from public,anon,authenticated;
