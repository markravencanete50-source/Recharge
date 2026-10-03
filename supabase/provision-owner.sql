-- Run through trusted Supabase administration AFTER the account has verified
-- its email. Never put this operation in a browser-callable RPC.
begin;
lock table public.workspace_profiles in share row exclusive mode;
do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users
    where lower(email) = 'enquiries@rechargestays.co.uk' and email_confirmed_at is not null;
  if owner_id is null then raise exception 'Create and verify Alex''s sign-in account first'; end if;
  if exists (select 1 from public.workspace_profiles where role = 'super_admin' and status = 'active' and user_id <> owner_id) then
    raise exception 'An active super admin already exists. Use normal access management instead';
  end if;
  update public.workspace_profiles set role = 'super_admin', status = 'active', full_name = 'Alex Coghill' where user_id = owner_id;
  if not found then raise exception 'The owner workspace profile is missing'; end if;
end;
$$;
commit;
