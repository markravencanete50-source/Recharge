-- Round 6, Lee: "we should be able to delete client enquiries." A test entry, or a form sent by mistake.
--   * Admins and super admins only. Owners, staff and everyone else are refused.
--   * Only while nothing has happened beyond the enquiry: the property it made is still at the enquiry stage
--     (or archived by closing the enquiry), with no signed agreement, no owner, no invoice, and nothing else
--     pointing at the property or its onboarding item (stays, money, other work, to-dos, photos, flags...).
--     Otherwise: "This enquiry has moved on. Close it instead." Close is unchanged.
--   * Deletes the enquiry with its answers, the property made on submit, its onboarding journey and work item,
--     their activity and notices, and the onboarding team's access to it. The uploaded photos and videos are
--     queued in private.workspace_storage_removals; the site's server removes the stored copies straight away
--     and marks them removed (lib/client-enquiry-server.ts).
--   * The access history keeps a "client_enquiry.deleted" entry: who, when, and the enquiry's name and company
--     (no email, phone or address).
-- Run-twice safe: "if not exists", replaced functions, and a sentinel on the one route patch.

create table if not exists private.workspace_storage_removals (
 id bigint generated always as identity primary key,
 bucket text not null check(bucket in ('enquiry-files')),
 path text not null check(length(path) between 1 and 500),
 reason text not null check(length(reason) between 1 and 80),
 queued_by uuid references public.workspace_profiles(user_id),
 queued_at timestamptz not null default now(),
 removed_at timestamptz
);
create index if not exists workspace_storage_removals_pending_idx on private.workspace_storage_removals(bucket,path) where removed_at is null;
create index if not exists workspace_storage_removals_queued_by_idx on private.workspace_storage_removals(queued_by);
alter table private.workspace_storage_removals enable row level security;
revoke all on private.workspace_storage_removals from public,anon,authenticated;

-- What stops a delete: anything still pointing at the property or its onboarding item, other than what the
-- enquiry itself made. Read from the foreign keys, so a table added later counts too.
create or replace function private.workspace_enquiry_moved_on(prop uuid, task uuid) returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare r record; found boolean;
begin
 for r in select c.conrelid, c.conrelid::regclass::text as tbl, a.attname, c.confrelid from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid in ('public.workspace_properties'::regclass,'public.workspace_work_items'::regclass) loop
  if r.confrelid='public.workspace_properties'::regclass then
   continue when r.conrelid in ('private.workspace_journeys'::regclass,'public.workspace_activity'::regclass,'private.workspace_client_enquiries'::regclass,
    'private.workspace_journey_questions'::regclass);
   if r.conrelid='public.workspace_work_items'::regclass then
    if exists(select 1 from public.workspace_work_items w where w.property_id=prop and w.id is distinct from task) then return true;end if;
    continue;
   end if;
   if r.conrelid='public.workspace_property_assignments'::regclass then
    if exists(select 1 from public.workspace_property_assignments x where x.property_id=prop and x.assignment<>'staff') then return true;end if;
    continue;
   end if;
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using prop;
  else
   continue when task is null or r.conrelid in ('private.workspace_journeys'::regclass,'public.workspace_activity'::regclass,'private.workspace_notification_outbox'::regclass,
    'public.workspace_work_updates'::regclass,'private.workspace_domain_details'::regclass,'private.workspace_upload_intents'::regclass);
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using task;
  end if;
  if found then return true;end if;
 end loop;
 return false;
end $fn$;

-- { action: 'deleteEnquiry', requestId, enquiryId, version }. Returns { deleted, enquiryId, paths }.
create or replace function private.workspace_client_enquiry_delete(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;prop uuid;task uuid;paths text[];events bigint[];
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
  select * into j from private.workspace_journeys x where x.property_id=prop for update;
  task:=j.work_id;
  if j.property_id is not null and (j.stage not in ('enquiry','archived') or j.client_id is not null or j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null)
   or exists(select 1 from public.workspace_properties p where p.id=prop and p.status not in ('onboarding','archived'))
   or private.workspace_enquiry_moved_on(prop,task) then
   raise exception 'This enquiry has moved on. Close it instead.' using errcode='22023';
  end if;
 end if;

 -- The photos and videos: queued, and handed back for the server to remove now.
 paths:=array(select f->>'path' from jsonb_array_elements(e.files) f where coalesce(f->>'path','')<>'');
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by) select 'enquiry-files',x,'client_enquiry.deleted',auth.uid() from unnest(paths) x;

 -- The access history keeps who deleted which enquiry, by name only.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),'client_enquiry.deleted',jsonb_strip_nulls(jsonb_build_object('enquiryId',e.id,
   'name',left(coalesce(nullif(btrim(e.answers->>'fullName'),''),e.recipient_name),200),'company',nullif(left(btrim(coalesce(e.answers->>'companyName','')),200),''),
   'status',e.status,'stage',j.stage,'propertyDeleted',prop is not null)),null);

 update private.workspace_client_enquiries set duplicate_of=null where duplicate_of=prop and prop is not null;
 delete from private.workspace_client_enquiries where id=e.id;
 if prop is not null then
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop or (task is not null and a.work_id=task));
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events) or (task is not null and o.work_id=task));
  delete from private.workspace_notification_outbox o where o.event_id=any(events) or (task is not null and o.work_id=task);
  delete from public.workspace_activity a where a.id=any(events);
  delete from private.workspace_journey_questions q where q.property_id=prop;
  delete from private.workspace_journeys x where x.property_id=prop;
  if task is not null then
   delete from public.workspace_work_updates u where u.work_id=task;
   delete from private.workspace_domain_details d where d.work_id=task;
   delete from private.workspace_upload_intents u where u.work_id=task;
   delete from public.workspace_work_items w where w.id=task;
  end if;
  delete from public.workspace_property_assignments x where x.property_id=prop;
  -- Rows the property itself just wrote while the deletes ran.
  delete from public.workspace_activity a where a.property_id=prop;
  delete from public.workspace_properties p where p.id=prop;
 end if;

 result:=jsonb_build_object('deleted',true,'enquiryId',e.id,'propertyDeleted',prop is not null,'paths',to_jsonb(paths));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- The server, after removing the stored copies, marks what it removed (only what this person queued).
create or replace function private.workspace_storage_removed(bucket_name text, removed text[]) returns integer language plpgsql security definer set search_path='' as $fn$
declare n integer;
begin
 if private.workspace_actor_role() not in ('admin','super_admin') then raise exception 'Only management can do this' using errcode='42501';end if;
 if cardinality(removed)>100 then raise exception 'Too many files' using errcode='22023';end if;
 update private.workspace_storage_removals s set removed_at=now() where s.bucket=bucket_name and s.path=any(removed) and s.removed_at is null and s.queued_by=auth.uid();
 get diagnostics n=row_count;
 return n;
end $fn$;
create or replace function public.workspace_storage_removed(bucket_name text, removed text[]) returns integer language sql security invoker set search_path='' as $$select private.workspace_storage_removed(bucket_name,removed);$$;

revoke all on function private.workspace_enquiry_moved_on(uuid,uuid),private.workspace_client_enquiry_delete(jsonb) from public,anon,authenticated;
revoke all on function private.workspace_storage_removed(text,text[]),public.workspace_storage_removed(text,text[]) from public,anon;
grant execute on function private.workspace_storage_removed(text,text[]),public.workspace_storage_removed(text,text[]) to authenticated;

do $$
declare
 -- function, anchor (single line, must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a='deleteEnquiry' then return private.workspace_client_enquiry_delete(input);end if;$q$,
   $q$private.workspace_client_enquiry_delete(input)$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
