-- Notifications fix: the 1 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261020500000%') then raise exception 'Notifications fix is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261020500000_notifications_fix =====
-- Notifications that work (Lee, 14 October: "fix the notification of the app, it's not working").
--  * The bell: opening Updates marked only 20 notices read per visit, one request each, so a long backlog kept the
--    badge at "99+" for good. One call now marks everything up to the newest notice shown as read.
--  * Pop-ups: a notice was recorded as sent the moment it was picked up, before the push service answered, so a
--    refused push looked the same as a delivered one. The real answer (and the push service's status code) is now
--    kept for each one, so the office and the lead can see whether pop-ups reach each device.
-- New: private.workspace_notifications_read_all(bigint) with a public wrapper for authenticated;
--      private.integration_web_push_result(bigint,uuid,text,integer) with a public wrapper for service_role only;
--      private.workspace_web_push_status() with a public wrapper for authenticated (this person's own devices).
-- Table change: workspace_web_push_sent gains result, http_status and checked_at. Safe to run twice.

alter table private.workspace_web_push_sent add column if not exists result text check(result is null or result in ('sent','failed','gone'));
alter table private.workspace_web_push_sent add column if not exists http_status integer check(http_status is null or http_status between 0 and 999);
alter table private.workspace_web_push_sent add column if not exists checked_at timestamptz;

create or replace function private.workspace_notifications_read_all(up_to bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 -- Up to the newest notice the person has seen (its event id), so one that arrives meanwhile stays unread.
 update private.workspace_notification_outbox set read_at=now()
  where user_id=auth.uid() and read_at is null and (up_to is null or event_id<=up_to);
 get diagnostics n=row_count;
 return jsonb_build_object('read',n);
end $$;

create or replace function private.integration_web_push_result(outbox bigint,subscription uuid,outcome text,status_code integer) returns void language sql security definer set search_path='' as $$
 update private.workspace_web_push_sent set result=case when outcome in ('sent','failed','gone') then outcome else 'failed' end,
  http_status=case when status_code between 0 and 999 then status_code end,checked_at=now()
 where outbox_id=outbox and subscription_id=subscription;
$$;

-- This person's own devices: when each was switched on and how its last pop-ups went.
create or replace function private.workspace_web_push_status() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('endpointHost',substring(s.endpoint from '^https://([^/]+)'),'since',s.created_at,
   'sent',(select count(*) from private.workspace_web_push_sent x where x.subscription_id=s.id and x.result='sent'),
   'failed',(select count(*) from private.workspace_web_push_sent x where x.subscription_id=s.id and x.result in ('failed','gone')),
   'lastStatus',(select x.http_status from private.workspace_web_push_sent x where x.subscription_id=s.id and x.checked_at is not null order by x.checked_at desc limit 1),
   'lastAt',(select max(x.checked_at) from private.workspace_web_push_sent x where x.subscription_id=s.id)) order by s.created_at desc)
  from private.workspace_web_push s where s.user_id=auth.uid()),'[]'::jsonb);
end $$;

create or replace function public.workspace_notifications_read_all(up_to bigint) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_notifications_read_all(up_to);$$;
create or replace function public.integration_web_push_result(outbox bigint,subscription uuid,outcome text,status_code integer) returns void language sql security invoker set search_path='' as $$select private.integration_web_push_result(outbox,subscription,outcome,status_code);$$;
create or replace function public.workspace_web_push_status() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_web_push_status();$$;

revoke all on function private.workspace_notifications_read_all(bigint),private.integration_web_push_result(bigint,uuid,text,integer),private.workspace_web_push_status(),
 public.workspace_notifications_read_all(bigint),public.integration_web_push_result(bigint,uuid,text,integer),public.workspace_web_push_status() from public,anon,authenticated,service_role;
grant execute on function private.workspace_notifications_read_all(bigint),public.workspace_notifications_read_all(bigint),private.workspace_web_push_status(),public.workspace_web_push_status() to authenticated;
grant execute on function private.integration_web_push_result(bigint,uuid,text,integer),public.integration_web_push_result(bigint,uuid,text,integer) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('20261020500000','notifications_fix');

commit;
