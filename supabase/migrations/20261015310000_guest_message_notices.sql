-- Guest message notices (Lee, round 5): every guest message that arrives tells the Stays (Guest relations) team who can open it and
-- the admins, at any hour, night included (no quiet hours). Until now a guest message told nobody; the team saw it only through the
-- Guests badge and the "guests waiting" to-do.
-- Who is told about a message on a property:
--  * every active admin and super admin;
--  * every active person with the stays role who holds the guest communication tool and is assigned to that property as staff
--    (for a conversation not yet matched to a property: every such Stays person, as the guest inbox shares those with everyone);
--  * never the person who logged the message by hand, never an owner, cleaner or Ready (workspace_guest_messaging_role).
-- Each guest message adds one 'guest.message' activity row carrying the property (no work item, so the activity_scoped policy keeps it
-- from anyone who cannot already see everything, and the workflow notice routes, which fire only for rows with a work item, are not
-- involved) and one notice per person. Email and push go only for notices under 24 hours old, as for every notice.
-- Where: an AFTER INSERT trigger on private.workspace_guest_messages, once per statement, over the rows actually inserted. That covers
-- the Hostaway import (workspace_hostaway_messages_ingest, through workspace_guest_messages_ingest), any other channel feed through
-- workspace_guest_messages_ingest, and a message logged by hand (logMessage), without patching any of the three; a message that was
-- already stored (on conflict do nothing) is not inserted again and tells nobody again. Only guest messages sent in the last 24 hours
-- notify, so a first import that brings in up to 14 days of history does not flood anyone. Team replies notify nobody.
-- The trigger swallows its own errors (a warning), so a notice can never stop a guest message being stored.

-- The people told about a guest message on a property (null: not yet matched to a property).
create or replace function private.workspace_guest_message_recipients(prop uuid) returns setof uuid language sql stable security definer set search_path='' as $fn$
 select p.user_id from public.workspace_profiles p
 where p.status='active' and (
  p.role in ('admin','super_admin')
  or (p.role='stays' and private.workspace_guest_messaging_role(p.role)
   and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='guest-communication')
   and (prop is null or exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=p.user_id and a.assignment='staff'))))
$fn$;

create or replace function private.workspace_guest_message_notices() returns trigger language plpgsql security definer set search_path='' as $fn$
declare m record;ev bigint;me uuid:=auth.uid();
begin
 begin
  for m in select a.property_id from added a where a.direction='guest' and a.sent_at>now()-interval '24 hours' order by a.sent_at,a.id loop
   insert into public.workspace_activity(actor_id,property_id,event_type) values(me,m.property_id,'guest.message') returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select u,ev from private.workspace_guest_message_recipients(m.property_id) u where u is distinct from me
   on conflict do nothing;
  end loop;
 exception when others then
  -- A notice is never worth losing the guest's message.
  raise warning 'Guest message notices skipped: %',sqlerrm;
 end;
 return null;
end $fn$;

drop trigger if exists workspace_guest_message_notices on private.workspace_guest_messages;
create trigger workspace_guest_message_notices after insert on private.workspace_guest_messages
 referencing new table as added for each statement execute function private.workspace_guest_message_notices();

revoke all on function private.workspace_guest_message_recipients(uuid),private.workspace_guest_message_notices() from public,anon,authenticated;
