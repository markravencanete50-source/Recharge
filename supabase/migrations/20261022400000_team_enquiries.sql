-- Team enquiries (Lee): an enquiry the team adds by hand is in Client enquiries too.
--  * Admins, super admins and Guest relations add an enquiry by hand ("Add a new property enquiry", createEnquiry), for
--    example after a phone call. Until now that made the property, its onboarding and the "Property onboarding" work
--    item, but nothing in Client enquiries, so it was valued from the property alone. The same request now also records
--    it in private.workspace_client_enquiries, answered (status received, "To value"), marked as added by the team
--    (source team, allowed by 20261022300000) with who added it (sent_by), and linked to the property it made. The
--    contact's name, email and phone where given (else the owner account's name and sign-in email, when the team chose
--    one) and the property's details are the answers; "When would they like to get started?" (startWhen, optional, now on
--    the team's form too) gives the Priority tag exactly as on the public form.
--  * Possible duplicates the same way as the public form and an owner's enquiry: the same address as another property in
--    use first; else an open answer from the public form with the contact's email ('same_contact'). A possible duplicate
--    tells the admins ('enquiry.duplicate').
--  * The rest of the path is unchanged: the team values it (startValuing keeps the property it already has), publishes
--    the estimate, and the owner chooses Proceed, in the app when the property is on an owner account, else from the
--    private estimate page, where the owner account is made at Proceed (workspace_owner_account, 20261020880000) from
--    the contact's email.
--  * Valuing an older answered form that has no property yet makes one through createEnquiry, inside
--    private.workspace_client_enquiry_action; that is the form's own enquiry, so no second row is recorded for it.
-- New: function private.workspace_team_enquiry_record (internal, no grants).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (createEnquiry records
-- a team member's enquiry).
-- No DROP, no DELETE. Safe to run twice.

-- A team member's enquiry, recorded in Client enquiries. Called once, from createEnquiry, after the property and its
-- onboarding are made; the request's receipt makes a retry return the first result.
create or replace function private.workspace_team_enquiry_record(prop uuid, input jsonb) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid(); stack text; d jsonb; who public.workspace_profiles; mail text; ans jsonb;
 e private.workspace_client_enquiries; key text; dup uuid; reason text:=''; other private.workspace_client_enquiries; event_id bigint;
begin
 if private.workspace_actor_role() is distinct from 'admin' and private.workspace_actor_role() is distinct from 'super_admin'
  and private.workspace_actor_role() is distinct from 'stays' then raise exception 'Onboarding access denied' using errcode='42501'; end if;
 -- Valuing an answered form without a property makes it through createEnquiry: that form is already in Client enquiries.
 get diagnostics stack = pg_context;
 if position('private.workspace_client_enquiry_action(' in stack)>0 then return null; end if;
 if input ? 'startWhen' and (jsonb_typeof(input->'startWhen') is distinct from 'string'
   or input->>'startWhen' not in ('','As soon as possible','Within a month','In 1 to 3 months','In 3 months or more','Not sure yet')) then
  raise exception 'Choose when they would like to get started' using errcode='22023';
 end if;
 d:=private.workspace_enquiry_details(coalesce(input->'enquiry','{}'),false);
 -- The owner account the team chose, if any: their name and sign-in email stand in for contact details not given.
 select p.* into who from private.workspace_journeys j join public.workspace_profiles p on p.user_id=j.client_id where j.property_id=prop;
 mail:=lower(btrim(coalesce(d->>'email',(select u.email from auth.users u where u.id=who.user_id),'')));
 ans:=jsonb_strip_nulls(jsonb_build_object(
  'fullName',left(coalesce(nullif(d->>'contactName',''),nullif(btrim(who.full_name),''),'Owner'),200),
  'companyName',left(d->>'companyName',200),
  'email',left(mail,320),
  'phone',left(d->>'phone',30),
  'propertyAddress',left(btrim(input->>'address'),1000),
  'propertyType',left(btrim(input->>'propertyType'),120),
  'bedrooms',(input->>'bedrooms')::int,
  'bathrooms',(input->>'bathrooms')::int,
  'wcs',d->'wcs',
  'parking',left(d->>'parking',300),
  'garden',left(d->>'garden',300),
  'mediaLink',left(d->>'photoLink',1000),
  'notes',left(d->>'notes',3000),
  'startWhen',nullif(input->>'startWhen','')));
 -- A possible duplicate: the same address as another property still in use.
 key:=private.workspace_address_key(input->>'address');
 if key<>'' then
  select p.id into dup from public.workspace_properties p where p.id<>prop and p.status<>'archived' and private.workspace_address_key(p.address)=key order by p.created_at,p.id limit 1;
 end if;
 if dup is not null then reason:='same_address';
 elsif mail<>'' then
  -- Else an open answer to the public form with the contact's email: they may have asked both ways.
  select x.* into other from private.workspace_client_enquiries x where x.source='form' and x.status<>'closed' and x.answers is not null
   and (lower(btrim(coalesce(x.answers->>'email','')))=mail or lower(x.recipient_email)=mail) order by x.submitted_at,x.id limit 1;
  if other.id is not null then
   reason:='same_contact';
   dup:=(select x.id from public.workspace_properties x where x.id=other.property_id and x.status<>'archived');
  end if;
 end if;
 -- One write (each counts towards the team member's limit of changes a minute).
 insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,status,answers,
   sent_by,opened_at,submitted_at,property_id,source,duplicate_of,duplicate_reason)
  values(encode(sha256(convert_to('team-enquiry:'||prop::text||':'||gen_random_uuid()::text,'UTF8')),'hex'),ans->>'fullName',
   case when length(mail) between 3 and 320 then mail else 'no email' end,
   'Added by the team','Added by hand by the team in the Recharge app, for example after a phone call.','link','manual','received',ans,
   me,now(),now(),prop,'team',dup,reason)
  returning * into e;
 if e.duplicate_reason<>'' then
  insert into public.workspace_activity(actor_id,event_type) values(null,'enquiry.duplicate') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,event_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') on conflict do nothing;
 end if;
 return e.id;
end $fn$;
revoke all on function private.workspace_team_enquiry_record(uuid,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- A team member's enquiry is recorded in Client enquiries, in the same request (after the owner's, from 20261022300000).
  ['private.workspace_journey_action(jsonb)',
   $q$if actor_role='client' then perform private.workspace_owner_enquiry_record(target,input); end if;$q$,
   $q$if actor_role='client' then perform private.workspace_owner_enquiry_record(target,input); end if;
  if actor_role in ('admin','super_admin','stays') then perform private.workspace_team_enquiry_record(target,input); end if;$q$,
   $q$private.workspace_team_enquiry_record(target,input)$q$]
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
