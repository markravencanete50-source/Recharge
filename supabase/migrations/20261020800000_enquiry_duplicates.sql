-- Client enquiries (Lee and Alex, client meeting):
--  * The New Property Enquiry Form no longer asks for a correspondence address or "Are you an existing client?". The public
--    submit (private.workspace_enquiry_public) stops requiring them. Forms answered before keep both answers, and the two keys
--    are still accepted, so a form already open in someone's browser can still be sent.
--  * A possible duplicate no longer comes from "existing client". Beside the same address (unchanged), a returned form is
--    flagged when its email (their answer, or the address the form was sent to) is an owner's sign-in email ('existing_owner';
--    duplicate_of is one of that owner's properties, when they have one), or when its email or phone matches another answered
--    enquiry that is not closed ('same_contact'; duplicate_of is that enquiry's property, unless archived). Phone numbers are
--    compared by their digits, with +44 read as 0. The check is private.workspace_enquiry_contact_duplicate, new here, called
--    at the end of private.workspace_enquiry_create_property. Enquiries flagged 'existing_client' before keep it.
--  * When a returned form is a possible duplicate, the people told it is back (the person who sent it and the admins) also
--    get an 'enquiry.duplicate' notice (an activity row and their notification outbox rows), so someone checks before valuing.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_enquiry_create_property (only
-- 20261015200000 defines it), private.workspace_enquiry_public (defined in 20261010300000, patched in 20261015200000).
-- Safe to run twice: the reason check is replaced only while it lacks the new reasons, the new functions are "create or
-- replace", and each patch is skipped once its sentinel is there.

do $$
begin
 if exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason'
   and pg_get_constraintdef(oid) not like '%same_contact%') then
  alter table private.workspace_client_enquiries drop constraint workspace_client_enquiries_duplicate_reason;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_duplicate_reason
   check(duplicate_reason in ('','same_address','existing_owner','same_contact','existing_client'));
 end if;
end $$;

-- A phone number reduced for comparing: digits only, +44 or 0044 (with or without the "(0)") read as 0. Null when too short.
create or replace function private.workspace_phone_key(phone text) returns text language sql immutable set search_path='' as $fn$
 select case when char_length(x.k)>=10 then x.k end from (select regexp_replace(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'^(00)?440?','0') as k) x
$fn$;

-- A returned form from someone we may already know: an owner with that email, or another open enquiry with that email or
-- phone. Left alone when the same address already flagged it. Called once, from the public submit.
create or replace function private.workspace_enquiry_contact_duplicate(enquiry_id uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries; mails text[]; phone text; owner uuid; other private.workspace_client_enquiries;
begin
 select * into e from private.workspace_client_enquiries x where x.id=enquiry_id for update;
 if e.id is null or e.answers is null or e.duplicate_reason='same_address' then return;end if;
 mails:=array_remove(array[lower(btrim(coalesce(e.answers->>'email',''))),lower(btrim(e.recipient_email))],'');
 phone:=private.workspace_phone_key(e.answers->>'phone');
 -- An owner already in Recharge: their sign-in email.
 select p.user_id into owner from public.workspace_profiles p join auth.users u on u.id=p.user_id
  where p.role='client' and p.status<>'revoked' and lower(u.email)=any(mails) order by p.created_at,p.user_id limit 1;
 if owner is not null then
  update private.workspace_client_enquiries set duplicate_reason='existing_owner',
   duplicate_of=(select a.property_id from public.workspace_property_assignments a join public.workspace_properties x on x.id=a.property_id
    where a.user_id=owner and a.assignment='client' and x.status<>'archived' order by x.created_at,x.id limit 1)
   where id=e.id;
  return;
 end if;
 -- Another answered enquiry, not closed, with the same email or phone.
 select x.* into other from private.workspace_client_enquiries x where x.id<>e.id and x.status<>'closed' and x.answers is not null
  and (lower(btrim(coalesce(x.answers->>'email','')))=any(mails) or lower(x.recipient_email)=any(mails) or (phone is not null and private.workspace_phone_key(x.answers->>'phone')=phone))
  order by x.submitted_at,x.id limit 1;
 update private.workspace_client_enquiries set duplicate_reason=case when other.id is null then '' else 'same_contact' end,
  duplicate_of=(select x.id from public.workspace_properties x where x.id=other.property_id and x.status<>'archived')
  where id=e.id;
end $fn$;

revoke all on function private.workspace_phone_key(text),private.workspace_enquiry_contact_duplicate(uuid) from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- "Are you an existing client?" no longer flags a duplicate; the contact check below does instead.
  ['private.workspace_enquiry_create_property(uuid)',
   $q$duplicate_reason=case when dup is not null then 'same_address' when ans->>'existingClient'='yes' then 'existing_client' else '' end$q$,
   $q$duplicate_reason=case when dup is not null then 'same_address' else '' end$q$,
   $q$then 'same_address' else '' end$q$],
  ['private.workspace_enquiry_create_property(uuid)',
   $q$return prop;$q$,
   $q$perform private.workspace_enquiry_contact_duplicate(e.id);
 return prop;$q$,
   $q$private.workspace_enquiry_contact_duplicate(e.id)$q$],
  -- The questions every form must answer, without the correspondence address and "existing client".
  ['private.workspace_enquiry_public(jsonb)',
   $q$array['fullName','correspondenceAddress','email','phone','existingClient','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop$q$,
   $q$array['fullName','email','phone','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop$q$,
   $q$array['fullName','email','phone','propertyAddress'$q$],
  -- A possible duplicate: the same people as enquiry.received hear it.
  ['private.workspace_enquiry_public(jsonb)',
   $q$return jsonb_build_object('state','answered');$q$,
   $q$-- A possible duplicate (20261020800000): the same people hear it, so someone checks before valuing.
  if e.duplicate_reason<>'' then
   insert into public.workspace_activity(actor_id,event_type) values(null,'enquiry.duplicate') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.status='active' and (p.user_id=e.sent_by or p.role in ('admin','super_admin')) on conflict do nothing;
  end if;
  return jsonb_build_object('state','answered');$q$,
   $q$'enquiry.duplicate'$q$]
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
