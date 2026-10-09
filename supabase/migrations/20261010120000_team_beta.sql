-- Team beta (10 October 2026): while only the team uses the app, no account can be made active as an
-- owner ("client"), by invite, by approval or by changing someone's role. A pending request is
-- harmless, so sign-up itself is unchanged. The switch lives in one row: set team_only to false
-- when owners are let in. It ships off so a fresh database behaves as before; the beta database
-- turns it on with: update private.workspace_beta_mode set team_only = true;
create table if not exists private.workspace_beta_mode (
 singleton boolean primary key default true check (singleton),
 team_only boolean not null default false
);
alter table private.workspace_beta_mode enable row level security;
revoke all on private.workspace_beta_mode from public, anon, authenticated;
insert into private.workspace_beta_mode(singleton, team_only) values (true, false) on conflict (singleton) do nothing;

create or replace function private.workspace_team_beta_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.role = 'client' and new.status = 'active'
    and coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton), false) then
  raise exception 'Owner accounts are switched off while the team beta runs' using errcode = '22023';
 end if;
 return new;
end $$;
revoke all on function private.workspace_team_beta_guard() from public, anon, authenticated;

drop trigger if exists workspace_team_beta_guard on public.workspace_profiles;
create trigger workspace_team_beta_guard before insert or update of role, status on public.workspace_profiles
 for each row execute function private.workspace_team_beta_guard();
