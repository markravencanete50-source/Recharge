-- Cleaners get their notices on their phone only, never by email (Lee).
-- A notice to someone whose role is cleans (assigned, taken off, moved, cancelled, redo, the 07:00 good morning, and every
-- other notice) gets a phone-app push and stays in their in-app history, but never an email delivery job:
--  * private.integration_claim_notifications no longer queues an email for a cleaner, and cancels any email already queued for
--    one (for example from before this change, or for someone who has since become a cleaner).
--  * private.integration_check_notification turns down an email to a cleaner that was claimed just before the change.
-- Everyone else is unchanged: an admin's notice is emailed exactly as before. Push and web push are unchanged.
-- Account emails (sign-in, password reset, invites) are sent by Supabase Auth, not through the notification outbox, and are
-- not touched.
-- Patched by anchor (sentinel, an anchor that must occur once). No DROP, no DELETE. CREATE OR REPLACE keeps the grants.
-- Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  -- New email jobs: never for a cleaner.
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$where p.status='active' and u.email_confirmed_at is not null$q$,
   $q$where p.status='active' and p.role<>'cleans' and u.email_confirmed_at is not null$q$,
   $q$p.role<>'cleans'$q$],
  -- Email jobs already queued for a cleaner are cancelled, not sent.
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null)));$q$,
   $q$or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null))
 -- Cleaners get notices on their phone only (20261021900000).
 or (d.channel='email' and p.role='cleans'));$q$,
   $q$(d.channel='email' and p.role='cleans')$q$],
  -- The last check before a send: no email to a cleaner.
  ['private.integration_check_notification(uuid,uuid)',
   $q$or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null)) then$q$,
   $q$or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null))
 -- Cleaners get notices on their phone only (20261021900000).
 or (d.channel='email' and exists(select 1 from public.workspace_profiles cp where cp.user_id=o.user_id and cp.role='cleans')) then$q$,
   $q$cp.role='cleans'$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
