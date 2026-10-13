-- Every new enquiry is in Properties straight away (approved by Lee, docs/notes-session-B.md section 5).
-- When a landlord submits the New Property Enquiry Form (workspace_enquiry_public, action submit), the
-- same transaction now creates:
--   * the property: status onboarding, named from the first line of the address (the same rule as
--     valuationDraft in lib/client-enquiry.ts), region left blank so the region trigger fills it from the
--     address, created_by = the team member who sent the link;
--   * its onboarding journey at stage enquiry, with no owner (client_id null) and only the property's facts
--     (WCs, parking, garden, photo link, existing client). Contact details stay on the enquiry;
--   * the "Property onboarding" work item, created_by = the link sender.
-- The journey's insert trigger gives the onboarding team (Guest relations with property onboarding) their
-- usual staff assignment; it now falls back to the work item's creator for granted_by, as nobody is signed
-- in on a public submit.
-- Duplicates are flagged, never merged: duplicate_of names an existing property at the same address (case,
-- spacing, punctuation and the postcode's space ignored), and duplicate_reason says why ('same_address', or
-- 'existing_client' when the landlord said they already work with us).
-- Start valuing reuses that property: the team's corrections (name, address, region, type, rooms, enquiry
-- details) are saved onto it instead of creating a second one. Closing the enquiry archives the property,
-- cancels its work item and archives the journey, while the journey is still at stage enquiry.
-- Privacy: owners, cleaners and Ready have no assignment, so never see it. Accounts read every property
-- (table policy and workspace_can_property); both now leave out a property whose journey is still at stage
-- enquiry, whoever created it.
-- No backfill: enquiries already answered keep today's flow (docs/notes-session-B.md lists them).
-- Shared functions are patched by anchor and append (the anchor stays word for word at the start of its
-- replacement, each patch has its own sentinel, a missing or repeated anchor raises). Safe to run twice.

alter table private.workspace_client_enquiries add column if not exists duplicate_of uuid references public.workspace_properties(id);
alter table private.workspace_client_enquiries add column if not exists duplicate_reason text not null default '';
create index if not exists workspace_client_enquiries_duplicate_idx on private.workspace_client_enquiries(duplicate_of);
do $$
declare c record;
begin
 -- "valuing exactly when a property is linked" no longer holds: an answered enquiry has its property, and a
 -- closed one keeps its archived property. Valuing still needs one.
 for c in select conname from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%property_id IS NOT NULL%' and conname<>'workspace_client_enquiries_valuing_property' loop
  execute format('alter table private.workspace_client_enquiries drop constraint %I', c.conname);
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_valuing_property') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_valuing_property check(status<>'valuing' or property_id is not null);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_duplicate_reason check(duplicate_reason in ('','same_address','existing_client'));
 end if;
end $$;

-- The property's name from its address: the first line, or "17 Warrender Park Road (3F2)" when the first
-- line is only a flat's position. Mirrors valuationDraft in lib/client-enquiry.ts (tests check they agree).
create or replace function private.workspace_enquiry_property_name(address text) returns text language plpgsql immutable set search_path='' as $fn$
declare parts text[]; name text;
begin
 select coalesce(array_agg(btrim(x.part) order by x.n),'{}') into parts
  from regexp_split_to_table(coalesce(address,''),'[\n,]') with ordinality as x(part,n) where btrim(x.part)<>'';
 if cardinality(parts)>1 and char_length(parts[1])<=10 and parts[1]~'[0-9]' and parts[2]~*'[a-z]{3}' then name:=parts[2]||' ('||parts[1]||')';
 else name:=coalesce(parts[1],btrim(coalesce(address,'')));
 end if;
 name:=left(name,200);
 return case when char_length(btrim(name))>=2 then name else 'New enquiry' end;
end $fn$;

-- An address reduced for comparing: lower case, the postcode's space removed, punctuation and spacing
-- collapsed, and a trailing UK, United Kingdom or Scotland dropped.
create or replace function private.workspace_address_key(address text) returns text language sql immutable set search_path='' as $fn$
 select regexp_replace(btrim(regexp_replace(regexp_replace(lower(coalesce(address,'')),'([a-z]{1,2}[0-9][a-z0-9]?)\s*([0-9][a-z]{2})','\1\2','g'),'[^a-z0-9]+',' ','g')),'(\s+(uk|united kingdom|scotland))+$','')
$fn$;

-- True while a property's onboarding journey is at stage enquiry (nobody has valued it yet).
create or replace function private.workspace_property_unvalued(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_journeys j where j.property_id=target and j.stage='enquiry')
$fn$;

-- The property, journey and work item for an answered enquiry, once. Called from the public submit only.
create or replace function private.workspace_enquiry_create_property(enquiry_id uuid) returns uuid language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries; ans jsonb; prop uuid; task uuid; key text; dup uuid; details jsonb:='{}';
begin
 select * into e from private.workspace_client_enquiries x where x.id=enquiry_id for update;
 if e.id is null or e.answers is null then raise exception 'Enquiry not answered' using errcode='22023';end if;
 if e.property_id is not null then return e.property_id;end if;
 ans:=e.answers;
 insert into public.workspace_properties(name,address,region,bedrooms,created_by,request_id)
  values(private.workspace_enquiry_property_name(ans->>'propertyAddress'),left(btrim(ans->>'propertyAddress'),1000),'',
   coalesce((ans->>'bedrooms')::int,0),e.sent_by,md5(e.id::text||':enquiry-property')::uuid) returning id into prop;
 insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible)
  values(md5(e.id::text||':enquiry-work')::uuid,prop,'property-onboarding','Property onboarding',e.sent_by,true) returning id into task;
 -- Only the property's facts; the landlord's name, email, phone and notes stay on the enquiry.
 if jsonb_typeof(ans->'wcs')='number' then details:=details||jsonb_build_object('wcs',ans->'wcs');end if;
 if btrim(coalesce(ans->>'parking',''))<>'' then details:=details||jsonb_build_object('parking',left(btrim(ans->>'parking'),300));end if;
 if btrim(coalesce(ans->>'garden',''))<>'' then details:=details||jsonb_build_object('garden',left(btrim(ans->>'garden'),300));end if;
 if coalesce(ans->>'mediaLink','')<>'' then details:=details||jsonb_build_object('photoLink',left(ans->>'mediaLink',300));end if;
 if ans->>'existingClient' in ('yes','no') then details:=details||jsonb_build_object('existingClient',ans->>'existingClient'='yes');end if;
 insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,enquiry)
  values(prop,null,task,left(btrim(ans->>'propertyType'),120),coalesce((ans->>'bathrooms')::int,0),private.workspace_enquiry_details(details,false));
 -- A possible duplicate: the same address as another property still in use.
 key:=private.workspace_address_key(ans->>'propertyAddress');
 if key<>'' then
  select p.id into dup from public.workspace_properties p where p.id<>prop and p.status<>'archived' and private.workspace_address_key(p.address)=key order by p.created_at,p.id limit 1;
 end if;
 update private.workspace_client_enquiries set property_id=prop,duplicate_of=dup,
  duplicate_reason=case when dup is not null then 'same_address' when ans->>'existingClient'='yes' then 'existing_client' else '' end
  where id=e.id;
 return prop;
end $fn$;

-- Start valuing on an enquiry that already has its property: the team's corrections go onto it.
create or replace function private.workspace_enquiry_value_property(e private.workspace_client_enquiries, input jsonb) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;
begin
 select * into j from private.workspace_journeys x where x.property_id=e.property_id for update;
 if j.property_id is null then raise exception 'Journey not found' using errcode='P0002';end if;
 -- Once the onboarding has moved on (an estimate was sent from the property), its details are left alone.
 if j.stage='enquiry' then
  update public.workspace_properties set name=private.workspace_required_text(input,'name',2,200),address=private.workspace_required_text(input,'address',5,1000),
   region=coalesce(input->>'region',''),bedrooms=coalesce((input->>'bedrooms')::int,0),version=version+1,updated_at=now() where id=e.property_id;
  update private.workspace_journeys set property_type=private.workspace_required_text(input,'propertyType',2,120),bathrooms=coalesce((input->>'bathrooms')::int,0),
   enquiry=private.workspace_enquiry_details(coalesce(input->'enquiry','{}'),j.client_id is null),version=version+1,updated_at=now() where property_id=e.property_id;
 end if;
 if private.workspace_actor_role()='stays' then
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(e.property_id,auth.uid(),'staff',auth.uid()) on conflict(property_id,user_id) do nothing;
 end if;
end $fn$;

-- Closing an enquiry whose property nobody has valued yet archives the property: the journey, the property
-- and its onboarding work item. Nothing is deleted. A property that has moved on is left as it is.
create or replace function private.workspace_enquiry_archive_property(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;
begin
 if prop is null then return;end if;
 select * into j from private.workspace_journeys x where x.property_id=prop for update;
 if j.property_id is null or j.stage<>'enquiry' then return;end if;
 update private.workspace_journeys set stage='archived',version=version+1,updated_at=now() where property_id=prop;
 update public.workspace_properties set status='archived',version=version+1,updated_at=now() where id=prop;
 update public.workspace_work_items set status='cancelled',version=version+1,updated_at=now() where id=j.work_id and status not in ('completed','cancelled','declined');
end $fn$;

revoke all on function private.workspace_enquiry_property_name(text),private.workspace_address_key(text),private.workspace_enquiry_create_property(uuid),
 private.workspace_enquiry_value_property(private.workspace_client_enquiries,jsonb),private.workspace_enquiry_archive_property(uuid) from public,anon,authenticated,service_role;
revoke all on function private.workspace_property_unvalued(uuid) from public,anon;
grant execute on function private.workspace_property_unvalued(uuid) to authenticated;

-- Accounts see every property except one still at the enquiry stage.
create or replace function private.workspace_can_property(target uuid, feature text) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_workspace_module(feature) and (
    private.workspace_actor_role() in ('admin','super_admin') or
    (private.workspace_actor_role()='accounts' and private.workspace_finance_feature(feature) and exists(select 1 from public.workspace_properties p where p.id=target) and not private.workspace_property_unvalued(target)) or
    exists (
      select 1 from public.workspace_property_assignments a where a.property_id=target and a.user_id=auth.uid()
        and a.assignment=case private.workspace_actor_role() when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
    )
  );
$$;
alter policy properties_assigned on public.workspace_properties using (
 (select private.workspace_actor_role()) is not null and (select private.workspace_onboarded()) and
 ((select private.workspace_actor_role()) in ('admin','super_admin') or ((select private.workspace_actor_role())='accounts' and not private.workspace_property_unvalued(id))
  or exists(select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())))
);

do $$
declare
 fixes constant text[][] := array[
  -- The public submit creates the property in the same transaction. (The enquiry.received notice is
  -- unchanged: giving it a property would change who reads it under activity_scoped.)
  ['private.workspace_enquiry_public(jsonb)',
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;$q$,
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;
  perform private.workspace_enquiry_create_property(e.id);
  select * into e from private.workspace_client_enquiries x where x.id=e.id;$q$,
   $q$perform private.workspace_enquiry_create_property(e.id);$q$],
  -- Start valuing: reuse the property the submit made, and finish there (the same receipt and answer as the
  -- rest of the action). Enquiries answered before this migration have no property and keep the old path.
  -- One-line anchor (the comment just after startValuing's version check), so the patch matches whatever line
  -- endings the function was created with.
  ['private.workspace_client_enquiry_action(jsonb)',
   $q$-- The property and its onboarding journey, made exactly as an enquiry added by hand.$q$,
   $q$-- The property and its onboarding journey, made exactly as an enquiry added by hand.
  if e.property_id is not null then
   perform private.workspace_enquiry_value_property(e,input);
   update private.workspace_client_enquiries set status='valuing',valued_by=auth.uid(),valued_at=now(),version=version+1 where id=e.id returning * into e;
   result:=private.workspace_client_enquiry_view(e);
   insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
   return result;
  end if;$q$,
   $q$perform private.workspace_enquiry_value_property(e,input);$q$],
  -- Closing archives the property while nobody has valued it.
  ['private.workspace_client_enquiry_action(jsonb)',
   $q$update private.workspace_client_enquiries set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=private.workspace_required_text(input,'note',3,500),version=version+1 where id=e.id returning * into e;$q$,
   $q$update private.workspace_client_enquiries set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=private.workspace_required_text(input,'note',3,500),version=version+1 where id=e.id returning * into e;
  perform private.workspace_enquiry_archive_property(e.property_id);$q$,
   $q$perform private.workspace_enquiry_archive_property(e.property_id);$q$],
  -- The team sees a possible duplicate on the enquiry.
  ['private.workspace_client_enquiry_view(private.workspace_client_enquiries)',
   $q$'closeNote',e.close_note,'version',e.version)$q$,
   $q$'closeNote',e.close_note,'version',e.version)||jsonb_build_object('duplicateOf',e.duplicate_of,'duplicateReason',nullif(e.duplicate_reason,''),
  'duplicateOfName',(select x.name from public.workspace_properties x where x.id=e.duplicate_of))$q$,
   $q$'duplicateOfName'$q$],
  -- Nobody is signed in on a public submit, and the journey has no owner: the work item's creator grants.
  ['private.workspace_assign_onboarding_team()',
   $q$coalesce(auth.uid(),new.client_id)$q$,
   $q$coalesce(auth.uid(),new.client_id,(select w.created_by from public.workspace_work_items w where w.id=new.work_id))$q$,
   $q$coalesce(auth.uid(),new.client_id,(select w.created_by$q$]
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
