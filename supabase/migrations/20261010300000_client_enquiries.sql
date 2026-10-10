-- Client Enquiries: the New Property Enquiry Form, sent to landlords by email.
--  * The team (admins, super admins, and Stays with property onboarding) writes the email, and the
--    landlord gets a private link to the form; only a hash of the link's token is kept here.
--  * The landlord fills it in without an account (through the site's server, which holds the
--    service key), adding photos or videos; every answer lands here with the status "received".
--  * The team values the property from it: "Start valuing" makes the property and its onboarding
--    journey from the answers (the same as adding an enquiry by hand), ready for the estimate.
--  * Statuses: sent → opened → received → valuing (then the onboarding stage), or closed.

create table if not exists private.workspace_client_enquiries (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
 recipient_name text not null check(length(btrim(recipient_name)) between 1 and 200),
 recipient_email text not null check(length(recipient_email) between 3 and 320),
 subject text not null check(length(btrim(subject)) between 1 and 200),
 body text not null check(length(body) between 1 and 5000),
 delivery text not null check(delivery in ('email','link')),
 email_status text not null default 'pending' check(email_status in ('pending','sent','failed','manual')),
 status text not null default 'sent' check(status in ('sent','opened','received','valuing','closed')),
 answers jsonb,
 files jsonb not null default '[]' check(jsonb_typeof(files)='array'),
 sent_by uuid not null references public.workspace_profiles(user_id),
 sent_at timestamptz not null default now(),
 opened_at timestamptz,
 submitted_at timestamptz,
 expires_at timestamptz not null default now()+interval '30 days',
 property_id uuid references public.workspace_properties(id),
 valued_by uuid references public.workspace_profiles(user_id),
 valued_at timestamptz,
 closed_by uuid references public.workspace_profiles(user_id),
 closed_at timestamptz,
 close_note text not null default '' check(length(close_note)<=500),
 version integer not null default 1 check(version>0),
 check(status not in ('received','valuing') or answers is not null),
 check((status='valuing')=(property_id is not null))
);
create index if not exists workspace_client_enquiries_status_idx on private.workspace_client_enquiries(status,sent_at desc);
create index if not exists workspace_client_enquiries_sender_idx on private.workspace_client_enquiries(sent_by);
create index if not exists workspace_client_enquiries_property_idx on private.workspace_client_enquiries(property_id);
create index if not exists workspace_client_enquiries_valuer_idx on private.workspace_client_enquiries(valued_by);
create index if not exists workspace_client_enquiries_closer_idx on private.workspace_client_enquiries(closed_by);
alter table private.workspace_client_enquiries enable row level security;
revoke all on private.workspace_client_enquiries from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_client_enquiries for each row execute function private.workspace_enforce_write_limit();

-- Photos and short videos from the form, in a private bucket only the server reads and writes.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('enquiry-files','enquiry-files',false,26214400,array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- Who works with enquiries: admins, super admins, and Stays who hold property onboarding.
create or replace function private.workspace_can_enquiries() returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='stays' and private.has_workspace_module('property-onboarding')),false)
$fn$;

create or replace function private.workspace_client_enquiry_view(e private.workspace_client_enquiries) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',e.id,'status',e.status,'recipientName',e.recipient_name,'recipientEmail',e.recipient_email,'subject',e.subject,'body',e.body,
  'delivery',e.delivery,'emailStatus',e.email_status,'sentBy',e.sent_by,'sentByName',(select p.full_name from public.workspace_profiles p where p.user_id=e.sent_by),
  'sentAt',e.sent_at,'openedAt',e.opened_at,'submittedAt',e.submitted_at,'expiresAt',e.expires_at,'answers',e.answers,
  'files',(select coalesce(jsonb_agg(f-'path'),'[]') from jsonb_array_elements(e.files) f),
  'propertyId',e.property_id,'propertyName',(select x.name from public.workspace_properties x where x.id=e.property_id),
  'stage',(select j.stage from private.workspace_journeys j where j.property_id=e.property_id),
  'valuedByName',(select p.full_name from public.workspace_profiles p where p.user_id=e.valued_by),'valuedAt',e.valued_at,
  'closedByName',(select p.full_name from public.workspace_profiles p where p.user_id=e.closed_by),'closedAt',e.closed_at,'closeNote',e.close_note,'version',e.version)
$fn$;

create or replace function private.workspace_client_enquiries_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 return jsonb_build_object('canInvite',true,
  'items',(select coalesce(jsonb_agg(private.workspace_client_enquiry_view(e) order by coalesce(e.submitted_at,e.sent_at) desc,e.id),'[]') from (
    select * from private.workspace_client_enquiries x order by coalesce(x.submitted_at,x.sent_at) desc,x.id limit 300) e));
end $fn$;

-- The team's side: send the form, send a fresh link, record whether the email went, value, close.
create or replace function private.workspace_client_enquiry_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;journey jsonb;event_id bigint;
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a<>'inviteEnquiry' then
  select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode='P0002';end if;
 end if;

 if a='inviteEnquiry' then
  perform private.workspace_json_keys(input,array['action','requestId','tokenHash','name','email','subject','body','delivery']);
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid link' using errcode='22023';end if;
  if coalesce(input->>'email','')!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(input->>'email')>320 then raise exception 'Enter a valid email address' using errcode='22023';end if;
  if coalesce(input->>'delivery','') not in ('email','link') then raise exception 'Choose how to send it' using errcode='22023';end if;
  insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,sent_by)
   values(input->>'tokenHash',private.workspace_required_text(input,'name',1,200),lower(btrim(input->>'email')),private.workspace_required_text(input,'subject',1,200),
    private.workspace_required_text(input,'body',1,5000),input->>'delivery',case when input->>'delivery'='link' then 'manual' else 'pending' end,auth.uid()) returning * into e;
 elsif a='resendEnquiry' then
  -- A fresh link (the old one stops working) and the email again, while the form is still unanswered.
  perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version','tokenHash','subject','body','delivery']);
  if e.status not in ('sent','opened') then raise exception 'They have already answered' using errcode='22023';end if;
  if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' or coalesce(input->>'delivery','') not in ('email','link') then raise exception 'Invalid link' using errcode='22023';end if;
  update private.workspace_client_enquiries set token_hash=input->>'tokenHash',subject=private.workspace_required_text(input,'subject',1,200),body=private.workspace_required_text(input,'body',1,5000),
   delivery=input->>'delivery',email_status=case when input->>'delivery'='link' then 'manual' else 'pending' end,sent_by=auth.uid(),sent_at=now(),expires_at=now()+interval '30 days',version=version+1
   where id=e.id returning * into e;
 elsif a='markEnquiryEmail' then
  perform private.workspace_json_keys(input,array['action','requestId','enquiryId','emailStatus']);
  if coalesce(input->>'emailStatus','') not in ('sent','failed') or e.delivery<>'email' then raise exception 'Invalid email status' using errcode='22023';end if;
  update private.workspace_client_enquiries set email_status=input->>'emailStatus' where id=e.id returning * into e;
 elsif a='startValuing' then
  perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version','name','address','region','propertyType','bedrooms','bathrooms','enquiry']);
  if e.status<>'received' then raise exception 'Only an answered enquiry can be valued' using errcode='22023';end if;
  if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  -- The property and its onboarding journey, made exactly as an enquiry added by hand.
  journey:=private.workspace_journey_action(jsonb_build_object('action','createEnquiry','requestId',md5(req::text||':valuing')::uuid,'name',input->'name','address',input->'address',
   'region',coalesce(input->'region','""'::jsonb),'propertyType',input->'propertyType','bedrooms',input->'bedrooms','bathrooms',input->'bathrooms','enquiry',coalesce(input->'enquiry','{}'::jsonb)));
  update private.workspace_client_enquiries set status='valuing',property_id=(journey->>'propertyId')::uuid,valued_by=auth.uid(),valued_at=now(),version=version+1 where id=e.id returning * into e;
 elsif a='closeEnquiry' then
  perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version','note']);
  if e.status in ('valuing','closed') then raise exception 'This enquiry is already being valued or closed' using errcode='22023';end if;
  if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  update private.workspace_client_enquiries set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=private.workspace_required_text(input,'note',3,500),version=version+1 where id=e.id returning * into e;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 result:=private.workspace_client_enquiry_view(e);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- A file from an answered form, for the team to open (the server makes a short-lived link).
create or replace function private.workspace_client_enquiry_file(target uuid,file uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare f jsonb;
begin
 if not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 f:=(select x from private.workspace_client_enquiries e,jsonb_array_elements(e.files) x where e.id=target and x->>'id'=file::text);
 if f is null then raise exception 'File not found' using errcode='P0002';end if;
 return f;
end $fn$;

-- The landlord's side, reached only through the site's server (service key), by the link's hash.
create or replace function private.workspace_enquiry_public(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a text:=input->>'action';e private.workspace_client_enquiries;ans jsonb;k text;file jsonb;event_id bigint;
begin
 if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
 select * into e from private.workspace_client_enquiries x where x.token_hash=input->>'tokenHash' for update;
 if e.id is null then raise exception 'This link is not valid' using errcode='P0002';end if;
 if a='open' then
  perform private.workspace_json_keys(input,array['action','tokenHash']);
  if e.status='sent' and e.expires_at>now() then update private.workspace_client_enquiries set status='opened',opened_at=now() where id=e.id returning * into e;end if;
  return jsonb_build_object('state',case when e.status in ('sent','opened') then case when e.expires_at>now() then 'open' else 'expired' end when e.status='closed' and e.answers is null then 'closed' else 'answered' end,
   'id',e.id,'name',e.recipient_name,'email',e.recipient_email,'files',(select coalesce(jsonb_agg(f-'path'),'[]') from jsonb_array_elements(e.files) f));
 end if;
 if e.status not in ('sent','opened') then raise exception 'This form has already been sent to us' using errcode='22023';end if;
 if e.expires_at<=now() then raise exception 'This link has expired. Ask Recharge for a new one.' using errcode='22023';end if;
 if a='addFile' then
  perform private.workspace_json_keys(input,array['action','tokenHash','file']);
  file:=input->'file';
  perform private.workspace_json_keys(file,array['id','path','name','mime','bytes']);
  if jsonb_array_length(e.files)>=15 then raise exception 'Up to 15 photos or videos. For more, add a link to an album.' using errcode='22023';end if;
  if coalesce(file->>'id','')!~'^[0-9a-f-]{36}$' or coalesce(file->>'path','')!~('^enquiries/'||e.id::text||'/[0-9a-f-]{36}\.[a-z0-9]{3,4}$') or coalesce(file->>'mime','') not in ('image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm')
   or jsonb_typeof(file->'bytes')<>'number' or (file->>'bytes')::bigint not between 1 and 26214400 or length(coalesce(file->>'name',''))>200 then raise exception 'Invalid file' using errcode='22023';end if;
  if (select coalesce(sum((f->>'bytes')::bigint),0) from jsonb_array_elements(e.files) f)+(file->>'bytes')::bigint>262144000 then raise exception 'That is more than we can take in one form. Add a link to an album instead.' using errcode='22023';end if;
  update private.workspace_client_enquiries set files=files||jsonb_build_array(jsonb_build_object('id',file->>'id','path',file->>'path','name',coalesce(nullif(btrim(file->>'name'),''),'File'),'mime',file->>'mime','bytes',(file->>'bytes')::bigint)) where id=e.id;
  return jsonb_build_object('id',file->>'id');
 elsif a='removeFile' then
  perform private.workspace_json_keys(input,array['action','tokenHash','fileId']);
  file:=(select f from jsonb_array_elements(e.files) f where f->>'id'=input->>'fileId');
  if file is null then raise exception 'File not found' using errcode='P0002';end if;
  update private.workspace_client_enquiries set files=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(e.files) f where f->>'id'<>input->>'fileId') where id=e.id;
  return jsonb_build_object('path',file->>'path');
 elsif a='submit' then
  perform private.workspace_json_keys(input,array['action','tokenHash','answers']);
  ans:=input->'answers';
  if jsonb_typeof(ans) is distinct from 'object' then raise exception 'Invalid answers' using errcode='22023';end if;
  perform private.workspace_json_keys(ans,array['fullName','companyName','correspondenceAddress','email','phone','existingClient','propertyAddress','propertyType','bedrooms','wcs','bathrooms',
   'parking','garden','mediaLink','shortLet','furnishQuote','compliance','startWhen','notes','enquiryType']);
  foreach k in array array['fullName','correspondenceAddress','email','phone','existingClient','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop
   if jsonb_typeof(ans->k) is distinct from 'string' or btrim(ans->>k)='' then raise exception 'Answer every question marked with *' using errcode='22023';end if;
  end loop;
  foreach k in array array['bedrooms','wcs','bathrooms'] loop
   if jsonb_typeof(ans->k) is distinct from 'number' or ans->>k!~'^\d{1,2}$' or (ans->>k)::int>40 then raise exception 'Choose the number of rooms' using errcode='22023';end if;
  end loop;
  if exists(select 1 from jsonb_each(ans) x where jsonb_typeof(x.value)='string' and length(x.value#>>'{}')>(case when x.key in ('notes') then 3000 when x.key in ('correspondenceAddress','propertyAddress','mediaLink') then 1000 else 320 end))
   or exists(select 1 from unnest(array['existingClient','shortLet','furnishQuote','compliance']) y where ans->>y not in ('yes','no'))
   or ans->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or (coalesce(ans->>'mediaLink','')<>'' and ans->>'mediaLink'!~'^https://[^/@[:space:]]+([/:?#]|$)') then raise exception 'Check your answers' using errcode='22023';end if;
  update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;
  -- The person who sent the form and management hear that it is back.
  insert into public.workspace_activity(actor_id,event_type) values(null,'enquiry.received') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,event_id from public.workspace_profiles p where p.status='active' and (p.user_id=e.sent_by or p.role in ('admin','super_admin')) on conflict do nothing;
  return jsonb_build_object('state','answered');
 end if;
 raise exception 'Unknown action' using errcode='22023';
end $fn$;
create or replace function public.workspace_enquiry_public(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_enquiry_public(input);$$;
create or replace function public.workspace_client_enquiry_file(target uuid,file uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_enquiry_file(target,file);$$;

revoke all on function private.workspace_can_enquiries(),private.workspace_client_enquiry_view(private.workspace_client_enquiries),private.workspace_client_enquiries_read(),
 private.workspace_client_enquiry_action(jsonb),private.workspace_client_enquiry_file(uuid,uuid),private.workspace_enquiry_public(jsonb),
 public.workspace_enquiry_public(jsonb),public.workspace_client_enquiry_file(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.workspace_enquiry_public(jsonb),public.workspace_enquiry_public(jsonb) to service_role;
grant execute on function private.workspace_client_enquiry_file(uuid,uuid),public.workspace_client_enquiry_file(uuid,uuid) to authenticated;

-- Routes: the enquiries list in the team read, and the team's actions.
do $$
declare
 fixes text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$ if input->>'action' in ('editShift','addShift','closeShift','decideShiftChange','withdrawShiftChange') then return private.workspace_shift_change_action(input);end if;$q$,
   $q$ if input->>'action' in ('inviteEnquiry','resendEnquiry','markEnquiryEmail','startValuing','closeEnquiry') then return private.workspace_client_enquiry_action(input);end if;
 if input->>'action' in ('editShift','addShift','closeShift','decideShiftChange','withdrawShiftChange') then return private.workspace_shift_change_action(input);end if;$q$,
   $q$private.workspace_client_enquiry_action(input)$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$ elsif section='shiftChanges' then result:=private.workspace_shift_changes_read();$q$,
   $q$ elsif section='shiftChanges' then result:=private.workspace_shift_changes_read();
 elsif section='clientEnquiries' then result:=private.workspace_client_enquiries_read();$q$,
   $q$private.workspace_client_enquiries_read()$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
