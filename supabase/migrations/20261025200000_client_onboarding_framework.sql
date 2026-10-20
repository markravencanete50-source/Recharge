-- Alex's property onboarding framework, the client side.
--  * The New Property Enquiry Form is open to anyone at /enquiry, without a link from the team (links the team sends
--    still work and fill in the name and email). The site's server asks for a form of its own when the landlord first
--    uploads a photo or sends the form: private.workspace_enquiry_public action 'start' makes an enquiry from the website
--    (source 'public'), unanswered, with only the hash of a fresh private token, good for two days. Uploads and the
--    submit then work exactly as with a link. Unanswered forms from the website never show in Client enquiries.
--    Abuse: the server limits new forms per address and sent forms per email; here at most 200 new forms an hour across
--    the site, and the upload limits as before (15 files, 25 MB each, 250 MB in all).
--    "Nobody sent it": the enquiry's sender (sent_by, needed by the property and work item it makes) is the first
--    active super admin, else admin. The team sees "From the website" instead of a name.
--  * The form now asks "How did you hear about us?" (heardFrom: Google, Social media, Airbnb or Booking.com, Referral
--    from a friend or client, Other) and who referred them (referral, optional). The enquiry type is shown as "Stage
--    you're at" (same answer). The phone number and the three services questions are optional (they are no longer on
--    the form); older answers are kept and read as before. When a form from the website comes back, its name and email
--    become the enquiry's contact.
--  * Owner account by verified email: private.workspace_enquiry_owner_claim, called by the server at sign-in. A signed-in
--    owner account (role client, not blocked) whose confirmed email is the email on an answered enquiry is given that
--    enquiry's property while it has no owner and is still at enquiry, estimate or reviewing: the same steps as the owner
--    account made at Proceed (20261020880000): the account made active with the usual owner tools (not while owner
--    accounts are switched off), the journey's client, and the property assignment. The admins and the enquiry's sender
--    are told ('enquiry.owner_linked'). Team accounts are never linked.
--  * Not proceeding needs a reason: decideEstimate (private.workspace_journey_action) and the estimate page
--    (private.workspace_estimate_public, decide) refuse a decline without one ("Tell us why you are not going ahead").
--  * The owner's onboarding checklist: "Next" on Welcome and on Process, fees and services ticks the step for the
--    property (private.workspace_onboarding_seen, owner only, with a receipt per requestId). The three onboarding videos
--    (welcome, process, estimate) are a super admin's setting (private.workspace_onboarding_videos: a YouTube, Vimeo or
--    Loom link, or empty for none); everyone signed in may read them. private.workspace_client_onboarding_read and
--    private.workspace_client_onboarding_action, with their public wrappers (authenticated only).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_enquiry_public,
-- private.workspace_client_enquiries_read, private.workspace_journey_action and private.workspace_estimate_public.
-- New tables only; no DROP TABLE, no DELETE. Safe to run twice.

-- ---------------------------------------------------------------- enquiries from the website
do $$
begin
 if exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_source'
   and pg_get_constraintdef(oid) not like '%public%') then
  alter table private.workspace_client_enquiries drop constraint workspace_client_enquiries_source;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_source') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_source
   check(source in ('form','owner_app','team','public') and (source='owner_app')=(owner_id is not null));
 end if;
end $$;
create index if not exists workspace_client_enquiries_public_idx on private.workspace_client_enquiries(sent_at) where source='public';

-- A form of its own for the open form: called from private.workspace_enquiry_public (service key only), never directly.
create or replace function private.workspace_enquiry_public_start(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries; sender uuid;
begin
 perform private.workspace_json_keys(input,array['action','tokenHash']);
 if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
 select * into e from private.workspace_client_enquiries x where x.token_hash=input->>'tokenHash';
 if e.id is null then
  if (select count(*) from private.workspace_client_enquiries x where x.source='public' and x.sent_at>now()-interval '1 hour')>=200 then
   raise exception 'The form is busy just now. Please try again in a few minutes.' using errcode='22023';
  end if;
  select p.user_id into sender from public.workspace_profiles p where p.status='active' and p.role in ('super_admin','admin')
   order by (p.role='super_admin') desc,p.created_at,p.user_id limit 1;
  if sender is null then raise exception 'Client enquiries are not set up' using errcode='55000';end if;
  insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,status,sent_by,opened_at,expires_at,source)
   values(input->>'tokenHash','From the website','website','Enquiry from the website','Sent from the open enquiry form on the website.','link','manual','opened',
    sender,now(),now()+interval '2 days','public')
   returning * into e;
 elsif e.source<>'public' then raise exception 'This link is not valid' using errcode='P0002';
 end if;
 return jsonb_build_object('state',case when e.status='opened' and e.expires_at>now() then 'open' else 'answered' end,'id',e.id);
end $fn$;
revoke all on function private.workspace_enquiry_public_start(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- 'start' needs no form yet: it makes one.
  ['private.workspace_enquiry_public(jsonb)',
   $q$if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;$q$,
   $q$if a='start' then return private.workspace_enquiry_public_start(input);end if;/* open form start: 20261025200000 */
 if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;$q$,
   $q$/* open form start: 20261025200000 */$q$],
  -- The new answers.
  ['private.workspace_enquiry_public(jsonb)',
   $q$'parking','garden','mediaLink','shortLet','furnishQuote','compliance','startWhen','notes','enquiryType']);$q$,
   $q$'parking','garden','mediaLink','shortLet','furnishQuote','compliance','startWhen','notes','enquiryType','heardFrom','referral']);/* open form keys: 20261025200000 */$q$,
   $q$/* open form keys: 20261025200000 */$q$],
  -- The phone number and the services questions are optional now.
  ['private.workspace_enquiry_public(jsonb)',
   $q$foreach k in array array['fullName','email','phone','propertyAddress','propertyType','shortLet','furnishQuote','compliance','enquiryType'] loop$q$,
   $q$foreach k in array array['fullName','email','propertyAddress','propertyType','enquiryType']/* open form required: 20261025200000 */ loop$q$,
   $q$/* open form required: 20261025200000 */$q$],
  -- How they heard about us is one of the choices.
  ['private.workspace_enquiry_public(jsonb)',
   $q$or ans->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'$q$,
   $q$or (ans ? 'heardFrom' and coalesce(ans->>'heardFrom','') not in ('Google','Social media','Airbnb or Booking.com','Referral from a friend or client','Other'))/* open form heard: 20261025200000 */
   or ans->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'$q$,
   $q$/* open form heard: 20261025200000 */$q$],
  -- A form from the website: its answers name the contact.
  ['private.workspace_enquiry_public(jsonb)',
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;$q$,
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1,
   recipient_name=case when e.source='public' then left(btrim(ans->>'fullName'),200) else recipient_name end,
   recipient_email=case when e.source='public' then left(lower(btrim(ans->>'email')),320) else recipient_email end/* open form contact: 20261025200000 */ where id=e.id returning * into e;$q$,
   $q$/* open form contact: 20261025200000 */$q$],
  -- Unanswered forms from the website are not enquiries yet.
  ['private.workspace_client_enquiries_read()',
   $q$select * from private.workspace_client_enquiries x order by coalesce(x.submitted_at,x.sent_at) desc,x.id limit 300$q$,
   $q$select * from private.workspace_client_enquiries x where not (x.source='public' and x.answers is null)/* open form drafts hidden: 20261025200000 */ order by coalesce(x.submitted_at,x.sent_at) desc,x.id limit 300$q$,
   $q$/* open form drafts hidden: 20261025200000 */$q$],
  -- Not proceeding needs a reason, in the app and on the estimate page.
  ['private.workspace_journey_action(jsonb)',
   $q$if coalesce(input->>'decision','') not in ('proceed','review','decline') or input->>'decision'='review' and (input->>'followUpOn')::date is null then raise exception 'Decision and follow-up required' using errcode='22023'; end if;$q$,
   $q$if coalesce(input->>'decision','') not in ('proceed','review','decline') or input->>'decision'='review' and (input->>'followUpOn')::date is null then raise exception 'Decision and follow-up required' using errcode='22023'; end if;
   if input->>'decision'='decline' and length(btrim(coalesce(input->>'feedback','')))<3 then raise exception 'Tell us why you are not going ahead' using errcode='22023'; end if;/* decline reason: 20261025200000 */$q$,
   $q$/* decline reason: 20261025200000 */$q$],
  ['private.workspace_estimate_public(jsonb)',
   $q$if d='review' and (follow is null or follow<current_date or follow>current_date+366) then raise exception 'Choose a follow-up date from today, within a year' using errcode='22023';end if;$q$,
   $q$if d='review' and (follow is null or follow<current_date or follow>current_date+366) then raise exception 'Choose a follow-up date from today, within a year' using errcode='22023';end if;
  if d='decline' and length(btrim(coalesce(input->>'feedback','')))<3 then raise exception 'Tell us why you are not going ahead' using errcode='22023';end if;/* decline reason: 20261025200000 */$q$,
   $q$/* decline reason: 20261025200000 */$q$]
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

-- ---------------------------------------------------------------- the owner account, by verified email
create or replace function private.workspace_enquiry_owner_claim() returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid(); mail text; who public.workspace_profiles; r record; linked jsonb:='[]'; event_id bigint;
 beta boolean:=coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton),false);
begin
 if me is null or not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode='42501';end if;
 select lower(btrim(u.email)) into mail from auth.users u where u.id=me and u.email_confirmed_at is not null;
 select * into who from public.workspace_profiles p where p.user_id=me;
 if coalesce(mail,'')!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or who.user_id is null or who.role<>'client' or who.status='revoked' then
  return jsonb_build_object('linked',0,'propertyIds','[]'::jsonb);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('recharge-enquiry-claim:'||mail,0));
 for r in
  select j.property_id,j.work_id,e.sent_by,e.answers->>'fullName' as full_name from private.workspace_journeys j
   join private.workspace_client_enquiries e on e.property_id=j.property_id
   join public.workspace_properties p on p.id=j.property_id
   where j.client_id is null and j.stage in ('enquiry','estimate','reviewing') and p.status<>'archived'
    and e.answers is not null and e.status<>'closed' and e.source in ('form','public','team')
    and (lower(btrim(coalesce(e.answers->>'email','')))=mail or lower(btrim(coalesce(j.enquiry->>'email','')))=mail)
   order by e.submitted_at,j.property_id
 loop
  -- The account first, so its own writes below are an active owner's.
  if who.status<>'active' then
   if beta then return jsonb_build_object('linked',jsonb_array_length(linked),'propertyIds',linked,'reason','owner_accounts_off');end if;
   update public.workspace_profiles set status='active',
    full_name=case when btrim(full_name)='' then left(coalesce(nullif(btrim(r.full_name),''),''),200) else full_name end
    where user_id=me returning * into who;
   insert into public.workspace_module_grants(user_id,module_id) select me,m from unnest(private.workspace_role_tools('client')) m on conflict do nothing;
  else
   insert into public.workspace_module_grants(user_id,module_id) values(me,'property-onboarding') on conflict do nothing;
  end if;
  update private.workspace_journeys set client_id=me,version=version+1,updated_at=now() where property_id=r.property_id and client_id is null;
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(r.property_id,me,'client',r.sent_by)
   on conflict(property_id,user_id) do nothing;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(me,r.property_id,r.work_id,'enquiry.owner_linked') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id)
   select p.user_id,r.work_id,event_id from public.workspace_profiles p where p.status='active' and (p.user_id=r.sent_by or p.role in ('admin','super_admin')) on conflict do nothing;
  linked:=linked||to_jsonb(r.property_id);
 end loop;
 return jsonb_build_object('linked',jsonb_array_length(linked),'propertyIds',linked);
end $fn$;
create or replace function public.workspace_enquiry_owner_claim() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_enquiry_owner_claim();$$;
revoke all on function private.workspace_enquiry_owner_claim(),public.workspace_enquiry_owner_claim() from public,anon,authenticated,service_role;
grant execute on function private.workspace_enquiry_owner_claim(),public.workspace_enquiry_owner_claim() to authenticated;

-- ---------------------------------------------------------------- the owner's checklist and the videos
create table if not exists private.workspace_onboarding_seen (
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 step text not null check(step in ('welcome','process')),
 user_id uuid not null references public.workspace_profiles(user_id),
 seen_at timestamptz not null default now(),
 primary key(property_id,step)
);
create index if not exists workspace_onboarding_seen_user_idx on private.workspace_onboarding_seen(user_id);
alter table private.workspace_onboarding_seen enable row level security;
revoke all on private.workspace_onboarding_seen from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_onboarding_seen for each row execute function private.workspace_enforce_write_limit();

create table if not exists private.workspace_onboarding_videos (
 step text primary key check(step in ('welcome','process','estimate')),
 url text not null default '' check(length(url)<=1000 and (url='' or url~'^https://(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com)/')),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_onboarding_videos_updater_idx on private.workspace_onboarding_videos(updated_by);
alter table private.workspace_onboarding_videos enable row level security;
revoke all on private.workspace_onboarding_videos from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_onboarding_videos for each row execute function private.workspace_enforce_write_limit();

-- With a property: its ticks, what the landlord told us on the enquiry (for "TBC") and the videos; the owner of the
-- property, or the team who hold its onboarding. Without one: the videos, for anyone signed in.
create or replace function private.workspace_client_onboarding_read(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role(); j private.workspace_journeys; e private.workspace_client_enquiries; videos jsonb;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 select jsonb_build_object('welcome',coalesce(max(v.url) filter (where v.step='welcome'),''),'process',coalesce(max(v.url) filter (where v.step='process'),''),
  'estimate',coalesce(max(v.url) filter (where v.step='estimate'),'')) into videos from private.workspace_onboarding_videos v;
 if target is null then return jsonb_build_object('videos',videos,'canEditVideos',actor='super_admin');end if;
 select * into j from private.workspace_journeys x where x.property_id=target;
 if j.property_id is null or not ((actor='client' and j.client_id=auth.uid())
   or (actor in ('stays','admin','super_admin') and private.workspace_can_property(target,'property-onboarding'))) then
  raise exception 'Onboarding access denied' using errcode='42501';
 end if;
 select * into e from private.workspace_client_enquiries x where x.property_id=target and x.answers is not null
  order by x.submitted_at desc nulls last,x.sent_at desc,x.id limit 1;
 return jsonb_build_object('videos',videos,'canEditVideos',actor='super_admin',
  'seen',jsonb_build_object('welcome',(select s.seen_at from private.workspace_onboarding_seen s where s.property_id=target and s.step='welcome'),
   'process',(select s.seen_at from private.workspace_onboarding_seen s where s.property_id=target and s.step='process')),
  'answers',e.answers,'files',coalesce(jsonb_array_length(e.files),0));
end $fn$;

-- The owner's "Next" (markSeen) and a super admin's video link (setVideo), each with a receipt per requestId.
create or replace function private.workspace_client_onboarding_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role(); a text:=coalesce(input->>'action',''); req uuid; prior private.workspace_action_receipts;
 result jsonb; target uuid; wanted text; link text;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 begin req:=(input->>'requestId')::uuid; exception when others then req:=null; end;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='markSeen' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','step']);
  begin target:=(input->>'propertyId')::uuid; exception when others then target:=null; end;
  wanted:=coalesce(input->>'step','');
  if wanted not in ('welcome','process') then raise exception 'Choose the step' using errcode='22023';end if;
  if actor<>'client' or target is null or not exists(select 1 from private.workspace_journeys j where j.property_id=target and j.client_id=auth.uid()) then
   raise exception 'Only the owner can tick their onboarding' using errcode='42501';
  end if;
  insert into private.workspace_onboarding_seen(property_id,step,user_id) values(target,wanted,auth.uid()) on conflict(property_id,step) do nothing;
  result:=private.workspace_client_onboarding_read(target);
 elsif a='setVideo' then
  perform private.workspace_json_keys(input,array['action','requestId','step','url']);
  if actor<>'super_admin' then raise exception 'Only a super admin can change the onboarding videos' using errcode='42501';end if;
  wanted:=coalesce(input->>'step','');
  if wanted not in ('welcome','process','estimate') then raise exception 'Choose the step' using errcode='22023';end if;
  link:=btrim(coalesce(input->>'url',''));
  if jsonb_typeof(input->'url') is distinct from 'string' or length(link)>1000
    or (link<>'' and link!~'^https://(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com)/') then
   raise exception 'Paste a YouTube, Vimeo or Loom link starting https://' using errcode='22023';
  end if;
  insert into private.workspace_onboarding_videos(step,url,updated_by,updated_at) values(wanted,link,auth.uid(),now())
   on conflict(step) do update set url=excluded.url,updated_by=excluded.updated_by,updated_at=now();
  result:=private.workspace_client_onboarding_read(null);
 else raise exception 'Unknown onboarding action' using errcode='22023';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

create or replace function public.workspace_client_onboarding_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_onboarding_read(target);$$;
create or replace function public.workspace_client_onboarding_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_onboarding_action(input);$$;
revoke all on function private.workspace_client_onboarding_read(uuid),public.workspace_client_onboarding_read(uuid),
 private.workspace_client_onboarding_action(jsonb),public.workspace_client_onboarding_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_client_onboarding_read(uuid),public.workspace_client_onboarding_read(uuid),
 private.workspace_client_onboarding_action(jsonb),public.workspace_client_onboarding_action(jsonb) to authenticated;
