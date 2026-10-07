-- Hostaway sync. Hostaway listings become Recharge properties, reservations arrive with their
-- platform, confirmation code, guest count and expected payout (what the platform pays out),
-- and every confirmed checkout gets an unassigned clean for the cleaning manager.
-- Only the backend's service role can run it: every 15 minutes, on a Hostaway webhook, or when
-- an admin presses "Sync now". Hostaway is the source of truth for the reservations it owns.

-- Rows the sync creates have no signed-in author. created_by is only used to de-duplicate a
-- person's own repeated requests, so system rows simply leave it empty.
alter table public.workspace_properties alter column created_by drop not null;
alter table public.workspace_work_items alter column created_by drop not null;
alter table private.workspace_reservations alter column created_by drop not null;
alter table private.workspace_reservations add column synced_at timestamptz;
create unique index workspace_reservations_hostaway_reference on private.workspace_reservations(reference) where source='hostaway';

create table private.workspace_hostaway_sync_state (
 singleton boolean primary key default true check(singleton),
 last_run_at timestamptz, last_success_at timestamptz,
 last_trigger text check(last_trigger in ('schedule','webhook','manual')),
 last_error text check(length(last_error)<=500),
 problems jsonb not null default '[]' check(jsonb_typeof(problems)='array'),
 last_summary jsonb not null default '{}'
);
insert into private.workspace_hostaway_sync_state(singleton) values(true);
alter table private.workspace_hostaway_sync_state enable row level security;
revoke all on private.workspace_hostaway_sync_state from public,anon,authenticated;
