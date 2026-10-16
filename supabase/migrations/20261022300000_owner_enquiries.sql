-- Owner enquiries (Lee, onboarding a property as an existing owner).
--  * An owner signed in to the app adds another property ("Add a property enquiry", createEnquiry). Until now that made
--    the property, its onboarding and the "Property onboarding" work item, but nothing in Client enquiries, so the team
--    never saw it where they value enquiries. The same request now also records it in
--    private.workspace_client_enquiries, answered (status received, "To value"), marked as from an existing owner
--    (source owner_app) and linked to their account (owner_id), with the property it made. Their name and sign-in email
--    are the contact; the property's details are the answers; "When would you like to get started?" (startWhen, new and
--    optional on the owner's sheet) gives the Priority tag exactly as on the public form.
--  * Possible duplicates the same way as the public form: the same address as another property in use first; else an
--    open answer from the public form with the owner's email ('same_contact'). An owner is never flagged as a duplicate
--    of their own account (that is who they are), and their own other enquiries are not "the same contact". A possible
--    duplicate tells the admins ('enquiry.duplicate'), as the public form does.
--  * Photos and short videos from the owner's sheet go to the same private enquiry-files bucket, under the same path
--    (enquiries/<enquiry>/<file>.<ext>), with the same types and limits as the public form (15 files, 25 MB each,
--    250 MB in all): private.workspace_owner_enquiry_files (open, addFile, removeFile), for the owner of that enquiry
--    only, while it is answered or being valued. The team opens them as any enquiry's files.
--  * The rest of the path is unchanged: the team checks the details and values it, publishes the estimate from the
--    property (the owner is told in the app by the journey's own notice), and the owner chooses Proceed in the app. The
--    property is already on their account, so nothing else is made.
--  * "Invalid estimate": the estimate was refused with that message alone when the expected nightly rate was below the
--    low rate, or the high rate below the expected one (the app did not check the order). Each now says which rate.
--    Every other check and its wording is unchanged.
-- New: columns private.workspace_client_enquiries.source and owner_id; functions private.workspace_owner_enquiry_record
-- (internal) and private.workspace_owner_enquiry_files with its public wrapper (authenticated only).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (createEnquiry takes
-- startWhen and records an owner's enquiry; publishEstimate names a rate out of order) and
-- private.workspace_client_enquiry_view (source and ownerId).
--  * Item 7: at Proceed the owner says which repairs Recharge may approve without asking them ("Repairs we can approve
--    without asking you": Always ask me (0), up to 100 (the company default), 250, 500 or another whole amount up to
--    100,000 pounds, as Limit Changer accepts), in the app (decideEstimate) and on the private estimate page (decide),
--    as repairLimitMinor. The choice is kept on the onboarding (workspace_journeys.owner_repair_limit, shown to the team
--    with the estimate and on the enquiry) and saved as the property's limit in Limit Changer's own table
--    (private.workspace_repair_limits) with a history row marked as set by the owner at Proceed. In the app it is saved
--    at once; from the estimate page, when the owner's account is linked (a trigger on the journey's client), because the limit
--    needs the person who set it. A limit already there (a super admin's) is kept and nothing is recorded.
-- New (item 7): column private.workspace_journeys.owner_repair_limit; functions private.workspace_owner_repair_limit_check
-- and private.workspace_owner_repair_limit_apply (internal, no grants). Patched: decideEstimate in
-- private.workspace_journey_action, private.workspace_estimate_public (decide), private.workspace_journey_view
-- (ownerRepairLimit). New trigger workspace_journeys_owner_repair_limit (private.workspace_owner_repair_limit_on_owner).
-- No DROP, no DELETE. Safe to run twice.

alter table private.workspace_client_enquiries add column if not exists source text not null default 'form';
alter table private.workspace_client_enquiries add column if not exists owner_id uuid references public.workspace_profiles(user_id);
create index if not exists workspace_client_enquiries_owner_idx on private.workspace_client_enquiries(owner_id);
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_source') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_source
   check(source in ('form','owner_app') and (source='owner_app')=(owner_id is not null));
 end if;
end $$;

-- An owner's enquiry from the app, recorded in Client enquiries. Called once, from createEnquiry (an owner signed in),
-- after the property and its onboarding are made; the request's receipt makes a retry return the first result.
create or replace function private.workspace_owner_enquiry_record(prop uuid, input jsonb) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid(); who public.workspace_profiles; mail text; d jsonb:=coalesce(input->'enquiry','{}'); ans jsonb;
 e private.workspace_client_enquiries; key text; dup uuid; other private.workspace_client_enquiries; event_id bigint;
begin
 select * into who from public.workspace_profiles p where p.user_id=me;
 if who.user_id is null or who.role<>'client' then raise exception 'Active client required' using errcode='42501';end if;
 if input ? 'startWhen' and (jsonb_typeof(input->'startWhen') is distinct from 'string'
   or input->>'startWhen' not in ('','As soon as possible','Within a month','In 1 to 3 months','In 3 months or more','Not sure yet')) then
  raise exception 'Choose when you would like to get started' using errcode='22023';
 end if;
 mail:=lower(btrim(coalesce((select u.email from auth.users u where u.id=me),'')));
 ans:=jsonb_strip_nulls(jsonb_build_object(
  'fullName',left(coalesce(nullif(btrim(who.full_name),''),'Owner'),200),
  'email',left(mail,320),
  'propertyAddress',left(btrim(input->>'address'),1000),
  'propertyType',left(btrim(input->>'propertyType'),120),
  'bedrooms',(input->>'bedrooms')::int,
  'bathrooms',(input->>'bathrooms')::int,
  'wcs',case when jsonb_typeof(d->'wcs')='number' then d->'wcs' end,
  'parking',nullif(left(btrim(coalesce(d->>'parking','')),300),''),
  'garden',nullif(left(btrim(coalesce(d->>'garden','')),300),''),
  'mediaLink',nullif(left(btrim(coalesce(d->>'photoLink','')),1000),''),
  'notes',nullif(left(btrim(coalesce(d->>'notes','')),3000),''),
  'startWhen',nullif(input->>'startWhen','')));
 insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,status,answers,
   sent_by,opened_at,submitted_at,property_id,owner_id,source)
  values(encode(sha256(convert_to('owner-enquiry:'||prop::text||':'||gen_random_uuid()::text,'UTF8')),'hex'),ans->>'fullName',
   case when length(mail) between 3 and 320 then mail else 'no email' end,
   'Added in the Recharge app','Added in the Recharge app by an owner who already has an account.','link','manual','received',ans,
   me,now(),now(),prop,me,'owner_app')
  returning * into e;
 -- A possible duplicate: the same address as another property still in use.
 key:=private.workspace_address_key(input->>'address');
 if key<>'' then
  select p.id into dup from public.workspace_properties p where p.id<>prop and p.status<>'archived' and private.workspace_address_key(p.address)=key order by p.created_at,p.id limit 1;
 end if;
 if dup is not null then
  update private.workspace_client_enquiries set duplicate_of=dup,duplicate_reason='same_address' where id=e.id returning * into e;
 elsif mail<>'' then
  -- Else an open answer to the public form with their email: they may have sent the same property both ways.
  select x.* into other from private.workspace_client_enquiries x where x.id<>e.id and x.source='form' and x.status<>'closed' and x.answers is not null
   and (lower(btrim(coalesce(x.answers->>'email','')))=mail or lower(x.recipient_email)=mail) order by x.submitted_at,x.id limit 1;
  if other.id is not null then
   update private.workspace_client_enquiries set duplicate_reason='same_contact',
    duplicate_of=(select x.id from public.workspace_properties x where x.id=other.property_id and x.status<>'archived')
    where id=e.id returning * into e;
  end if;
 end if;
 if e.duplicate_reason<>'' then
  insert into public.workspace_activity(actor_id,event_type) values(null,'enquiry.duplicate') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,event_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') on conflict do nothing;
 end if;
 return e.id;
end $fn$;

-- Photos and short videos on an owner's own enquiry, the same as the public form's (private.workspace_enquiry_public):
-- the server checks first ("open"), stores the file, then records it ("addFile"); "removeFile" forgets one and hands its
-- path back for the server to delete. Only the owner who sent it, while it is answered or being valued.
create or replace function private.workspace_owner_enquiry_files(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare a text:=coalesce(input->>'action','');target uuid;e private.workspace_client_enquiries;file jsonb;
begin
 if private.workspace_actor_role() is distinct from 'client' then raise exception 'Only the owner can add photos to their enquiry' using errcode='42501';end if;
 begin target:=(input->>'propertyId')::uuid;exception when others then target:=null;end;
 select * into e from private.workspace_client_enquiries x where x.property_id=target and x.owner_id=auth.uid() and x.source='owner_app'
  order by x.submitted_at desc,x.id limit 1 for update;
 if e.id is null then raise exception 'Enquiry not found' using errcode='P0002';end if;
 if e.status not in ('received','valuing') then raise exception 'This enquiry can no longer take photos. Send them to Recharge in Messages.' using errcode='22023';end if;
 if a='open' then
  perform private.workspace_json_keys(input,array['action','propertyId']);
  return jsonb_build_object('id',e.id,'files',jsonb_array_length(e.files));
 elsif a='addFile' then
  perform private.workspace_json_keys(input,array['action','propertyId','file']);
  file:=input->'file';
  perform private.workspace_json_keys(file,array['id','path','name','mime','bytes']);
  if jsonb_array_length(e.files)>=15 then raise exception 'Up to 15 photos or videos. For more, add a link to an album.' using errcode='22023';end if;
  if coalesce(file->>'id','')!~'^[0-9a-f-]{36}$' or coalesce(file->>'path','')!~('^enquiries/'||e.id::text||'/[0-9a-f-]{36}\.[a-z0-9]{3,4}$')
   or coalesce(file->>'mime','') not in ('image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm')
   or jsonb_typeof(file->'bytes') is distinct from 'number' or coalesce(file->>'bytes','')!~'^\d{1,12}$' or (file->>'bytes')::bigint not between 1 and 26214400
   or length(coalesce(file->>'name',''))>200 then raise exception 'Invalid file' using errcode='22023';end if;
  if (select coalesce(sum((f->>'bytes')::bigint),0) from jsonb_array_elements(e.files) f)+(file->>'bytes')::bigint>262144000 then
   raise exception 'That is more than we can take in one enquiry. Add a link to an album instead.' using errcode='22023';end if;
  update private.workspace_client_enquiries set files=files||jsonb_build_array(jsonb_build_object('id',file->>'id','path',file->>'path',
   'name',coalesce(nullif(btrim(file->>'name'),''),'File'),'mime',file->>'mime','bytes',(file->>'bytes')::bigint)) where id=e.id;
  return jsonb_build_object('id',file->>'id');
 elsif a='removeFile' then
  perform private.workspace_json_keys(input,array['action','propertyId','fileId']);
  file:=(select f from jsonb_array_elements(e.files) f where f->>'id'=input->>'fileId');
  if file is null then raise exception 'File not found' using errcode='P0002';end if;
  update private.workspace_client_enquiries set files=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(e.files) f where f->>'id'<>input->>'fileId') where id=e.id;
  return jsonb_build_object('path',file->>'path');
 end if;
 raise exception 'Unknown action' using errcode='22023';
end $fn$;

create or replace function public.workspace_owner_enquiry_files(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_enquiry_files(input);$$;
revoke all on function private.workspace_owner_enquiry_record(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.workspace_owner_enquiry_files(jsonb),public.workspace_owner_enquiry_files(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_owner_enquiry_files(jsonb),public.workspace_owner_enquiry_files(jsonb) to authenticated;

-- Item 7: the owner's repair limit at Proceed.
alter table private.workspace_journeys add column if not exists owner_repair_limit jsonb;
-- The amount chosen, in pence: whole pounds from 0 to 100,000 (Limit Changer's own maximum). Null when not asked.
create or replace function private.workspace_owner_repair_limit_check(input jsonb) returns bigint
language plpgsql immutable set search_path='' as $fn$
begin
 if not input ? 'repairLimitMinor' then return null;end if;
 if jsonb_typeof(input->'repairLimitMinor') is distinct from 'number' or input->>'repairLimitMinor'!~'^\d{1,8}$'
  or (input->>'repairLimitMinor')::bigint>10000000 or (input->>'repairLimitMinor')::bigint%100<>0 then
  raise exception 'Choose the repair limit in whole pounds, from 0 to 100,000' using errcode='22023';
 end if;
 return (input->>'repairLimitMinor')::bigint;
end $fn$;
-- Saves the owner's choice as the property's limit, unless the property already has one (a super admin's stays, and
-- nothing is recorded). `by` is who chose it: the owner, or the team recording Proceed for them. True when saved.
create or replace function private.workspace_owner_repair_limit_apply(prop uuid, by uuid, req uuid) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare choice jsonb;lim bigint;
begin
 select j.owner_repair_limit into choice from private.workspace_journeys j where j.property_id=prop;
 if choice is null or by is null or req is null or not exists(select 1 from public.workspace_profiles p where p.user_id=by) then return false;end if;
 lim:=(choice->>'limitMinor')::bigint;
 insert into private.workspace_repair_limits(property_id,limit_minor,full_permission,updated_by,updated_at) values(prop,lim,false,by,now())
  on conflict(property_id) do nothing;
 if not found then return false;end if;
 insert into private.workspace_repair_limit_history(property_id,changed_by,before,after,request_id)
  values(prop,by,null,jsonb_build_object('limitMinor',lim,'fullPermission',false,'setBy','owner','at','proceed','via',choice->>'via'),req);
 return true;
end $fn$;
-- When an owner's account is linked to the onboarding after Proceed on the estimate page (workspace_owner_account sets
-- the journey's client), their choice is saved as the limit, against them. A trigger rather than a patch, so it holds
-- however the account is linked.
create or replace function private.workspace_owner_repair_limit_on_owner() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if new.client_id is not null and old.client_id is null and new.owner_repair_limit is not null then
  perform private.workspace_owner_repair_limit_apply(new.property_id,new.client_id,md5('owner-repair-limit:'||new.property_id::text)::uuid);
 end if;
 return new;
end $fn$;
do $$
begin
 if not exists(select 1 from pg_trigger where tgrelid='private.workspace_journeys'::regclass and tgname='workspace_journeys_owner_repair_limit') then
  create trigger workspace_journeys_owner_repair_limit after update of client_id on private.workspace_journeys
   for each row execute function private.workspace_owner_repair_limit_on_owner();
 end if;
end $$;
revoke all on function private.workspace_owner_repair_limit_check(jsonb),private.workspace_owner_repair_limit_apply(uuid,uuid,uuid),private.workspace_owner_repair_limit_on_owner() from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- createEnquiry takes "When would you like to get started?" (the owner's sheet).
  ['private.workspace_journey_action(jsonb)',
   $q$array['action','requestId','clientId','name','address','region','propertyType','bedrooms','bathrooms','enquiry']);$q$,
   $q$array['action','requestId','clientId','name','address','region','propertyType','bedrooms','bathrooms','enquiry','startWhen']);$q$,
   $q$'enquiry','startWhen']);$q$],
  -- An owner's own enquiry is recorded in Client enquiries, in the same request.
  ['private.workspace_journey_action(jsonb)',
   $q$values(target,owner_id,task,private.workspace_required_text(input,'propertyType',2,120),(input->>'bathrooms')::int,fields) returning * into j;$q$,
   $q$values(target,owner_id,task,private.workspace_required_text(input,'propertyType',2,120),(input->>'bathrooms')::int,fields) returning * into j;
  if actor_role='client' then perform private.workspace_owner_enquiry_record(target,input); end if;$q$,
   $q$private.workspace_owner_enquiry_record(target,input)$q$],
  -- A nightly rate out of order says which one, instead of "Invalid estimate".
  ['private.workspace_journey_action(jsonb)',
   $q$if input->>'lowRateMinor' is null or input->>'mediumRateMinor' is null or input->>'highRateMinor' is null or (input->>'lowRateMinor')::bigint<100 or$q$,
   $q$if coalesce(input->>'lowRateMinor','')~'^\d{1,12}$' and coalesce(input->>'mediumRateMinor','')~'^\d{1,12}$' and (input->>'mediumRateMinor')::bigint<(input->>'lowRateMinor')::bigint then
    raise exception 'The expected nightly rate must be at least the low nightly rate' using errcode='22023'; end if;
   if coalesce(input->>'mediumRateMinor','')~'^\d{1,12}$' and coalesce(input->>'highRateMinor','')~'^\d{1,12}$' and (input->>'highRateMinor')::bigint<(input->>'mediumRateMinor')::bigint then
    raise exception 'The high nightly rate must be at least the expected nightly rate' using errcode='22023'; end if;
   if input->>'lowRateMinor' is null or input->>'mediumRateMinor' is null or input->>'highRateMinor' is null or (input->>'lowRateMinor')::bigint<100 or$q$,
   $q$must be at least the low nightly rate$q$],
  -- The team sees where an enquiry came from, and the owner's account it is linked to.
  ['private.workspace_client_enquiry_view(private.workspace_client_enquiries)',
   $q$||jsonb_build_object('estimateDelivery',(select private.workspace_estimate_delivery(j) from private.workspace_journeys j where j.property_id=e.property_id))$q$,
   $q$||jsonb_build_object('estimateDelivery',(select private.workspace_estimate_delivery(j) from private.workspace_journeys j where j.property_id=e.property_id))||jsonb_build_object('source',e.source,'ownerId',e.owner_id,
  'ownerRepairLimit',(select j.owner_repair_limit from private.workspace_journeys j where j.property_id=e.property_id))$q$,
   $q$'source',e.source$q$],
  -- Item 7: decideEstimate takes the owner's repair limit, checked before anything changes.
  ['private.workspace_journey_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','decision','feedback','followUpOn']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','decision','feedback','followUpOn','repairLimitMinor']);
   perform private.workspace_owner_repair_limit_check(input);$q$,
   $q$'followUpOn','repairLimitMinor']);$q$],
  -- Item 7: on Proceed it is kept on the onboarding and saved as the property's limit (never over one already set).
  ['private.workspace_journey_action(jsonb)',
   $q$if input->>'decision'='decline' then update public.workspace_properties set status='archived',version=version+1 where id=target; update public.workspace_work_items set status='declined',version=version+1 where id=j.work_id; end if;$q$,
   $q$if input->>'decision'='decline' then update public.workspace_properties set status='archived',version=version+1 where id=target; update public.workspace_work_items set status='declined',version=version+1 where id=j.work_id; end if;
   if input->>'decision'='proceed' and input ? 'repairLimitMinor' then
    update private.workspace_journeys set owner_repair_limit=jsonb_build_object('limitMinor',private.workspace_owner_repair_limit_check(input),'chosenAt',now(),
     'via',case when actor_role='client' then 'app' else 'team' end) where property_id=target;
    perform private.workspace_owner_repair_limit_apply(target,auth.uid(),v_request_id);
   end if;$q$,
   $q$private.workspace_owner_repair_limit_apply(target,auth.uid(),v_request_id)$q$],
  -- Item 7: the private estimate page's Proceed takes it too.
  ['private.workspace_estimate_public(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','tokenHash','decision','feedback','followUpOn']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','tokenHash','decision','feedback','followUpOn','repairLimitMinor']);
  perform private.workspace_owner_repair_limit_check(input);$q$,
   $q$'followUpOn','repairLimitMinor']);$q$],
  -- Item 7: kept on the onboarding; saved as the limit once the owner's account is linked (it needs the person).
  ['private.workspace_estimate_public(jsonb)',
   $q$update private.workspace_estimate_links set decided_at=now(),decision=d,opened_at=coalesce(opened_at,now()) where id=l.id;$q$,
   $q$update private.workspace_estimate_links set decided_at=now(),decision=d,opened_at=coalesce(opened_at,now()) where id=l.id;
  if d='proceed' and input ? 'repairLimitMinor' then
   update private.workspace_journeys set owner_repair_limit=jsonb_build_object('limitMinor',private.workspace_owner_repair_limit_check(input),'chosenAt',now(),'via','link') where property_id=j.property_id;
  end if;$q$,
   $q$'via','link'$q$],
  -- Item 7: the team (and the owner) see the choice with the onboarding.
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,$q$,
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,'ownerRepairLimit',j.owner_repair_limit,$q$,
   $q$'ownerRepairLimit',j.owner_repair_limit$q$]
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
