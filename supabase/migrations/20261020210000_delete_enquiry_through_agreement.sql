-- Lee: "WE SHOULD BE ABLE TO DELETE ENQUIRIES". Round 6 (20261016210000) allowed it only at the enquiry stage; his test
-- enquiry was at "Estimate sent" and could not go. Now:
--   * Admins and super admins only, as before.
--   * Any stage up to and including the agreement, while it is not signed and the property is not live: enquiry,
--     estimate, reviewing, agreement, or closed (archived) before anything was signed. A signed agreement, an
--     invoice or a live property is refused ("Archive it instead"); live properties keep the archive path.
--   * Everything that came from the enquiry goes, in this one transaction: the enquiry and its answers, the
--     property it made, the journey and its questions, the estimate model, every work item on the property with
--     its updates, details and notices, the activity, management flags and to-dos about it, listing links, local
--     events, access logins, default cleaners and the team's access. The enquiry's photos and videos are queued in
--     private.workspace_storage_removals and removed by the site's server straight away, as before.
--   * Anything that means real business stops it with a plain message naming it (an invoice, bookings, costs,
--     owner statements, payout details, guest messages, photos on a work item, messages, routine visits...). This
--     is read from the foreign keys, so a table added later (an estimate link or email record, for example) stops
--     a delete rather than being left behind, until it is added to the list below.
--   * The access history keeps a "client_enquiry.deleted" entry: who, when, which enquiry (name and company) and
--     the property's address and stage. No email or phone.
-- Run-twice safe: replaced functions only. The route patch from 20261016210000 already sends deleteEnquiry here.
-- Replaces whole: private.workspace_client_enquiry_delete(jsonb). Adds private.workspace_enquiry_blocker(uuid,uuid[],uuid).
-- Drops private.workspace_enquiry_moved_on(uuid,uuid), which only the old delete used.

-- What stops a delete, in plain words, or null. Every foreign key that would refuse the delete (no action or
-- restrict) into the property, its work items or the enquiry is checked, except the tables the delete itself
-- clears. Cascades and "set null" need nothing.
create or replace function private.workspace_enquiry_blocker(prop uuid, tasks uuid[], enquiry uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare r record; found boolean;
 cleared constant regclass[] := array['private.workspace_client_enquiries','private.workspace_journeys','private.workspace_journey_questions','public.workspace_activity',
  'public.workspace_work_items','public.workspace_property_assignments','private.workspace_estimate_models','private.workspace_management_flags','private.workspace_hub_items',
  'private.workspace_listing_links','private.workspace_local_events','private.workspace_property_secrets','private.workspace_default_cleaners',
  'private.workspace_notification_outbox','public.workspace_work_updates','private.workspace_domain_details','private.workspace_upload_intents']::regclass[];
begin
 for r in select c.conrelid, c.conrelid::regclass::text as tbl, a.attname, c.confrelid from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confdeltype in ('a','r')
   and c.confrelid in ('public.workspace_properties'::regclass,'public.workspace_work_items'::regclass,'private.workspace_client_enquiries'::regclass) loop
  continue when r.conrelid=any(cleared);
  if r.confrelid='public.workspace_properties'::regclass then
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using prop;
  elsif r.confrelid='public.workspace_work_items'::regclass then
   continue when cardinality(tasks)=0;
   execute format('select exists(select 1 from %s where %I=any($1))',r.tbl,r.attname) into found using tasks;
  else
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using enquiry;
  end if;
  if found then
   return case r.conrelid
    when 'public.workspace_invoices'::regclass then 'an invoice'
    when 'private.workspace_reservations'::regclass then 'bookings'
    when 'private.workspace_owner_statements'::regclass then 'owner statements'
    when 'private.workspace_bank_details'::regclass then 'payout details'
    when 'private.workspace_property_financials'::regclass then 'financial settings'
    when 'private.workspace_guest_messages'::regclass then 'guest messages'
    when 'private.workspace_media_evidence'::regclass then 'photos'
    when 'public.workspace_threads'::regclass then 'messages'
    when 'private.workspace_routine_plans'::regclass then 'routine visits'
    when 'private.workspace_routine_visits'::regclass then 'routine visits'
    when 'private.workspace_cleaning_reviews'::regclass then 'clean reviews'
    else case when r.tbl ~ '(expense|cost|invoice_lines)' then 'costs' else 'other records' end end;
  end if;
 end loop;
 return null;
end $fn$;

-- { action: 'deleteEnquiry', requestId, enquiryId, version }. Returns { deleted, enquiryId, propertyDeleted, paths }.
create or replace function private.workspace_client_enquiry_delete(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;p public.workspace_properties;prop uuid;tasks uuid[]:='{}';paths text[];events bigint[];blocker text;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only management can delete an enquiry' using errcode='42501';end if;
 if input->>'action' is distinct from 'deleteEnquiry' then raise exception 'Unknown team action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
 if e.id is null then raise exception 'Enquiry not found' using errcode='P0002';end if;
 if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 prop:=e.property_id;
 if prop is not null then
  select * into p from public.workspace_properties x where x.id=prop for update;
  select * into j from private.workspace_journeys x where x.property_id=prop for update;
  -- Up to and including the agreement, unsigned, never live.
  if p.status not in ('onboarding','archived')
   or (j.property_id is not null and (j.stage not in ('enquiry','estimate','reviewing','agreement','archived') or j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null)) then
   raise exception 'The agreement is signed or the property is live, so this enquiry can no longer be deleted. Archive it instead.' using errcode='22023';
  end if;
  tasks:=array(select w.id from public.workspace_work_items w where w.property_id=prop);
  if j.work_id is not null and not j.work_id=any(tasks) then tasks:=tasks||j.work_id;end if;
 end if;
 blocker:=private.workspace_enquiry_blocker(prop,tasks,e.id);
 if blocker is not null then
  raise exception 'This property has % recorded, so this enquiry can no longer be deleted. Archive it instead.',blocker using errcode='22023';
 end if;

 -- The photos and videos: queued, and handed back for the server to remove now.
 paths:=array(select f->>'path' from jsonb_array_elements(e.files) f where coalesce(f->>'path','')<>'');
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by) select 'enquiry-files',x,'client_enquiry.deleted',auth.uid() from unnest(paths) x;

 -- The access history keeps who deleted which enquiry and where, since its own history goes with it.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),'client_enquiry.deleted',jsonb_strip_nulls(jsonb_build_object('enquiryId',e.id,
   'name',left(coalesce(nullif(btrim(e.answers->>'fullName'),''),e.recipient_name),200),'company',nullif(left(btrim(coalesce(e.answers->>'companyName','')),200),''),
   'address',nullif(left(btrim(coalesce(p.address,e.answers->>'propertyAddress','')),300),''),'property',nullif(left(btrim(coalesce(p.name,'')),200),''),
   'status',e.status,'stage',j.stage,'propertyDeleted',prop is not null)),null);

 update private.workspace_client_enquiries set duplicate_of=null where duplicate_of=prop and prop is not null;
 delete from private.workspace_client_enquiries where id=e.id;
 if prop is not null then
  -- To-dos and flags about it (their updates go with them).
  delete from private.workspace_management_flags f where f.property_id=prop or f.work_id=any(tasks)
   or f.hub_item_id in (select h.id from private.workspace_hub_items h where h.property_id=prop);
  delete from private.workspace_hub_items h where h.property_id=prop;
  -- Activity and notices on the property and its work.
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop or a.work_id=any(tasks));
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events) or o.work_id=any(tasks));
  delete from private.workspace_notification_outbox o where o.event_id=any(events) or o.work_id=any(tasks);
  delete from public.workspace_activity a where a.id=any(events);
  -- The journey, its questions and estimate, and the property's set-up.
  delete from private.workspace_journey_questions q where q.property_id=prop;
  delete from private.workspace_journeys x where x.property_id=prop;
  delete from private.workspace_estimate_models m where m.property_id=prop;
  delete from private.workspace_listing_links l where l.property_id=prop;
  delete from private.workspace_local_events l where l.property_id=prop;
  delete from private.workspace_property_secrets s where s.property_id=prop;
  delete from private.workspace_default_cleaners c where c.property_id=prop;
  -- The work items.
  delete from public.workspace_work_updates u where u.work_id=any(tasks);
  delete from private.workspace_domain_details d where d.work_id=any(tasks);
  delete from private.workspace_upload_intents u where u.work_id=any(tasks);
  delete from public.workspace_work_items w where w.id=any(tasks);
  delete from public.workspace_property_assignments x where x.property_id=prop;
  -- Rows the property itself just wrote while the deletes ran.
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop);
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events));
  delete from private.workspace_notification_outbox o where o.event_id=any(events);
  delete from public.workspace_activity a where a.id=any(events);
  delete from public.workspace_properties x where x.id=prop;
 end if;

 result:=jsonb_build_object('deleted',true,'enquiryId',e.id,'propertyDeleted',prop is not null,'paths',to_jsonb(paths));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

drop function if exists private.workspace_enquiry_moved_on(uuid,uuid);
revoke all on function private.workspace_enquiry_blocker(uuid,uuid[],uuid),private.workspace_client_enquiry_delete(jsonb) from public,anon,authenticated;
