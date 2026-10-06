-- First additive Supabase schema. The legacy D1 database stays unchanged.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.workspace_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 200),
  role text not null default 'client'
    check (role in ('super_admin', 'admin', 'stays', 'cleans', 'ready', 'client')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  responsibilities text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_module_grants (
  user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
  module_id text not null check (module_id in (
    'daily-pricing', 'listing-health', 'client-furnishing', 'safety-maintenance',
    'purchase-order', 'purchase-order-requests', 'client-purchase-order-quotes',
    'property-database', 'property-onboarding', 'client-dashboard',
    'client-property-maintenance', 'weekly-performance', 'maintenance-reporting',
    'stays-maintenance-reporting', 'clean-reporting', 'aircover-reporting',
    'cleaning-schedule', 'cleaner-performance', 'clean-client-database',
    'cleaner-database', 'cleans-invoices', 'client-mailbox', 'replenishment-requests',
    'ready-schedule', 'licensing', 'direct-bookings', 'ota-logins',
    'guest-communication', 'property-furnishing-board', 'new-property-inspection-board',
    'routine-bin-garden-board', 'clean-property-onboarding',
    'maintenance-reconciliation', 'onboarding-invoices', 'purchase-order-invoices',
    'purchase-order-accounts', 'owner-statements'
  )),
  granted_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table public.workspace_access_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  actor_id uuid,
  event_type text not null,
  old_access jsonb,
  new_access jsonb,
  occurred_at timestamptz not null default now()
);
create index workspace_access_events_user_id_idx on public.workspace_access_events(user_id);
create index workspace_access_events_actor_id_idx on public.workspace_access_events(actor_id);

alter table public.workspace_profiles enable row level security;
alter table public.workspace_module_grants enable row level security;
alter table public.workspace_access_events enable row level security;
revoke all on public.workspace_profiles, public.workspace_module_grants,
  public.workspace_access_events from public, anon, authenticated;
revoke all on sequence public.workspace_access_events_id_seq from public, anon, authenticated;
grant select on public.workspace_profiles, public.workspace_module_grants,
  public.workspace_access_events to authenticated;
grant all on public.workspace_profiles, public.workspace_module_grants,
  public.workspace_access_events to service_role;
grant usage, select on sequence public.workspace_access_events_id_seq to service_role;

-- Definer helpers avoid recursive policies; they only evaluate the caller's ID.
create function private.is_workspace_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_profiles
    where user_id = auth.uid() and status = 'active' and role = 'super_admin'
  );
$$;
create function private.has_workspace_module(requested_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_profiles p
    where p.user_id = auth.uid() and p.status = 'active'
      and (p.role in ('super_admin', 'admin') or exists (
        select 1 from public.workspace_module_grants g
        where g.user_id = p.user_id and g.module_id = requested_module
      ))
  );
$$;
revoke all on function private.is_workspace_super_admin() from public, anon, authenticated;
revoke all on function private.has_workspace_module(text) from public, anon, authenticated;
grant execute on function private.is_workspace_super_admin(),
  private.has_workspace_module(text) to authenticated;

create policy profiles_self_or_super_admin on public.workspace_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_workspace_super_admin()));
create policy grants_active_self_or_super_admin on public.workspace_module_grants
  for select to authenticated using (
    (select private.is_workspace_super_admin()) or (
      user_id = (select auth.uid()) and private.has_workspace_module(module_id)
    )
  );
create policy access_events_super_admin_only on public.workspace_access_events
  for select to authenticated using ((select private.is_workspace_super_admin()));

-- Auth owns this trigger. Metadata supplies display text only, never access.
create function private.create_workspace_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_profiles(user_id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200));
  return new;
end;
$$;
revoke all on function private.create_workspace_profile() from public, anon, authenticated;
create trigger recharge_auth_user_created after insert on auth.users
  for each row execute function private.create_workspace_profile();

create function private.record_workspace_access_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if old.role is not distinct from new.role and old.status is not distinct from new.status then
      return new;
    end if;
  end if;
  insert into public.workspace_access_events(user_id, actor_id, event_type, old_access, new_access)
  values (new.user_id, auth.uid(), lower(tg_op),
    case when tg_op = 'UPDATE' then jsonb_build_object('role', old.role, 'status', old.status) else null end,
    jsonb_build_object('role', new.role, 'status', new.status));
  return new;
end;
$$;
revoke all on function private.record_workspace_access_change() from public, anon, authenticated;
create trigger recharge_profile_access_changed before insert or update on public.workspace_profiles
  for each row execute function private.record_workspace_access_change();

-- Existing accounts also remain pending until a trusted operator approves them.
insert into public.workspace_profiles(user_id, full_name)
select id, left(coalesce(raw_user_meta_data ->> 'full_name', ''), 200) from auth.users
on conflict (user_id) do nothing;

comment on table public.workspace_profiles is
  'Database-owned access. Clients have SELECT only. Provision the first verified super admin through trusted server-side administration.';
comment on table public.workspace_module_grants is
  'Module access is not property ownership. Each business table requires its own tenant and assignment policies before exposure.';
