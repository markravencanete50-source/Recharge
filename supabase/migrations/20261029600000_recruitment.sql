-- Recruitment (Business Plan v1.0, 17/10/26: Recruitment Manager, the Recruitment board under Tasks, and the housekeeper
-- allocation's "raise a ticket on the recruitment board with the role and area required").
--  * A manager (any active team member but cleaners and owners) asks for a role: which job, the area, how many people,
--    when by and why, optionally for one property (Launch Preparation raises it when there is no housekeeper to allocate).
--  * Recruitment (admins, and the team members admins name as recruiters: the Recruitment Manager) write the job advert
--    (each job has an admin-edited advert to start from) and record where it is posted, add candidates, and shortlist or
--    reject them. Sharing the shortlist asks the manager who asked to choose; the manager selects or turns down each one.
--  * Recruitment then onboards whoever is selected: their account is made in Access control (prefilled from the
--    candidate) and linked here as hired; their contract and required training (staff onboarding) show as their progress.
--    Once as many people are hired as were asked for, the vacancy is filled.
--  * Admins edit the jobs (title, the account role a hire gets, the advert template) and who the recruiters are.
-- New tables and functions only. Safe to run twice.

-- 1. Settings: the jobs, with the role a hire's account gets and the advert to start from.
create table if not exists private.workspace_recruitment_settings (
 singleton boolean primary key default true check (singleton),
 settings jsonb not null check (jsonb_typeof(settings)='object' and octet_length(settings::text)<=100000),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table if not exists private.workspace_recruiters (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 added_by uuid references auth.users(id) on delete set null,
 added_at timestamptz not null default now()
);
create or replace function private.workspace_recruitment_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select '{"jobs":[
  {"key":"housekeeper","title":"Housekeeper","role":"cleans","advert":"Recharge is looking for a Housekeeper. This is not a cleaner: you make sure each property is guest ready and report anything that would stop it being guest ready. You will need an eye for detail, your own transport and good communication."},
  {"key":"property_operations_technician","title":"Property Operations Technician","role":"ready","advert":"Recharge is looking for a Property Operations Technician with good general handy work experience and a general understanding of most trades, to keep our serviced accommodation in top condition."},
  {"key":"furniture_install_technician","title":"Furniture Install Technician","role":"ready","advert":"Recharge is looking for a Furniture Install Technician to receive, assemble and install furniture in our new properties. You must have a van and be able to assemble furniture."},
  {"key":"photographer","title":"Photographer","role":"ready","advert":"Recharge is looking for a Photographer to professionally photograph our serviced accommodation properties for their listings."},
  {"key":"property_onboarding_consultant","title":"Property Onboarding Consultant","role":"stays","advert":"Recharge is looking for a Property Onboarding Consultant, the frontline of our sales team: sending property performance estimates and answering prospective clients'' questions, with a strong understanding of property performance and excellent communication skills."},
  {"key":"admin_assistant","title":"Admin Assistant","role":"stays","advert":"Recharge is looking for an Admin Assistant to respond to inbound calls and messages and create property listings."},
  {"key":"property_revenue_manager","title":"Property Revenue Manager","role":"stays","advert":"Recharge is looking for a Property Revenue Manager to make sure every property is priced correctly."},
  {"key":"licensing_coordinator","title":"Licensing Coordinator","role":"stays","advert":"Recharge is looking for a Licensing Coordinator to answer licensing questions, advise clients and take every licence application through to completion."},
  {"key":"accounting_administrator","title":"Accounting Administrator","role":"accounts","advert":"Recharge is looking for an Accounting Administrator to send and settle the invoices approved by the management team."},
  {"key":"housekeeping_coordinator","title":"Housekeeping Coordinator","role":"cleaning_manager","advert":"Recharge is looking for a Housekeeping Coordinator to allocate housekeepers to properties and keep every changeover on track."},
  {"key":"property_operations_manager","title":"Property Operations Manager","role":"admin","advert":"Recharge is looking for a Property Operations Manager to coordinate property set-up, reactive maintenance and housekeeping across the country. This is a 24/7 role with no set hours."},
  {"key":"property_performance_manager","title":"Property Performance Manager","role":"admin","advert":"Recharge is looking for a Property Performance Manager to own the performance of our portfolio, from listings to pricing."}
 ]}'::jsonb
$fn$;
create or replace function private.workspace_recruitment_settings() returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce((select s.settings from private.workspace_recruitment_settings s where s.singleton),private.workspace_recruitment_settings_default())
$fn$;
alter table private.workspace_recruitment_settings enable row level security;
alter table private.workspace_recruiters enable row level security;

-- 2. Vacancies and their candidates.
create table if not exists private.workspace_recruitment_vacancies (
 id uuid primary key default gen_random_uuid(),
 job_key text not null check (job_key~'^[a-z][a-z0-9_]{1,39}$'),
 title text not null check (char_length(title) between 1 and 80),
 role text not null check (role in ('stays','cleans','cleaning_manager','ready','accounts','admin')),
 area text not null check (char_length(area) between 1 and 200),
 positions integer not null default 1 check (positions between 1 and 20),
 start_by date,
 notes text not null default '' check (char_length(notes)<=2000),
 property_id uuid references public.workspace_properties(id) on delete set null,
 requested_by uuid references auth.users(id) on delete set null,
 requested_at timestamptz not null default now(),
 advert text not null default '' check (char_length(advert)<=5000),
 posted_to text not null default '' check (char_length(posted_to)<=1000),
 advertised_at timestamptz,
 advertised_by uuid references auth.users(id) on delete set null,
 shortlist_shared_at timestamptz,
 status text not null default 'open' check (status in ('open','filled','cancelled')),
 closed_at timestamptz,
 closed_by uuid references auth.users(id) on delete set null,
 close_reason text not null default '' check (char_length(close_reason)<=1000)
);
create index if not exists workspace_recruitment_vacancies_open on private.workspace_recruitment_vacancies(requested_at) where status='open';
create table if not exists private.workspace_recruitment_candidates (
 id uuid primary key default gen_random_uuid(),
 vacancy_id uuid not null references private.workspace_recruitment_vacancies(id) on delete cascade,
 full_name text not null check (char_length(full_name) between 2 and 200),
 email text not null default '' check (char_length(email)<=320),
 phone text not null default '' check (char_length(phone)<=40),
 cv_url text not null default '' check (char_length(cv_url)<=1000),
 notes text not null default '' check (char_length(notes)<=2000),
 -- new, shortlisted, rejected (by recruitment), selected or declined (by the manager), hired, withdrawn (by the candidate).
 status text not null default 'new' check (status in ('new','shortlisted','rejected','selected','declined','hired','withdrawn')),
 decision_note text not null default '' check (char_length(decision_note)<=1000),
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz,
 hired_user_id uuid references public.workspace_profiles(user_id) on delete set null,
 hired_at timestamptz,
 added_by uuid references auth.users(id) on delete set null,
 added_at timestamptz not null default now()
);
create index if not exists workspace_recruitment_candidates_vacancy on private.workspace_recruitment_candidates(vacancy_id,added_at);
alter table private.workspace_recruitment_vacancies enable row level security;
alter table private.workspace_recruitment_candidates enable row level security;
revoke all on private.workspace_recruitment_settings,private.workspace_recruiters,private.workspace_recruitment_vacancies,private.workspace_recruitment_candidates
 from public,anon,authenticated,service_role;

-- 3. Who is who. Recruiters: admins and the named recruiters still active on the team. Managers who can ask: any active
-- team member but cleaners and owners.
create or replace function private.workspace_recruitment_person(who uuid) returns text language sql stable security definer set search_path='' as $fn$
 select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=who
$fn$;
create or replace function private.workspace_can_recruit() returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role() not in ('client','cleans')
  and exists(select 1 from private.workspace_recruiters r join public.workspace_profiles p on p.user_id=r.user_id where r.user_id=auth.uid() and p.status='active'))
$fn$;
create or replace function private.workspace_recruitment_tell(who uuid[],event text,prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare ev bigint;begin
 if coalesce(array_length(who,1),0)=0 then return;end if;
 insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(auth.uid(),prop,event,now()) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(who) u where u is not null and u<>auth.uid() on conflict do nothing;
end $fn$;
-- Recruitment's people: the named recruiters, or the admins when nobody is named.
create or replace function private.workspace_recruitment_team() returns uuid[] language sql stable security definer set search_path='' as $fn$
 select coalesce(nullif((select array_agg(r.user_id) from private.workspace_recruiters r join public.workspace_profiles p on p.user_id=r.user_id where p.status='active'),'{}'),
  (select array_agg(p.user_id) from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin')))
$fn$;

-- 4. One vacancy, as the signed-in person sees it. The manager who asked sees the shortlist (not the candidates still
-- being looked at or turned down by recruitment).
create or replace function private.workspace_recruitment_vacancy(v private.workspace_recruitment_vacancies,recruit boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare mine boolean:=v.requested_by=auth.uid();admin boolean:=private.workspace_actor_role() in ('admin','super_admin');hired integer;begin
 hired:=(select count(*) from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and c.status='hired');
 return jsonb_build_object('id',v.id,'jobKey',v.job_key,'title',v.title,'role',v.role,'area',v.area,'positions',v.positions,'startBy',v.start_by,'notes',v.notes,
  'propertyId',v.property_id,'propertyName',(select coalesce(nullif(btrim(p.name),''),p.address,'Property') from public.workspace_properties p where p.id=v.property_id),
  'requestedById',v.requested_by,'requestedByName',coalesce(private.workspace_recruitment_person(v.requested_by),'A manager'),'requestedAt',v.requested_at,
  'advert',v.advert,'postedTo',v.posted_to,'advertisedAt',v.advertised_at,'advertisedByName',private.workspace_recruitment_person(v.advertised_by),
  'shortlistSharedAt',v.shortlist_shared_at,'status',v.status,'closedAt',v.closed_at,'closedByName',private.workspace_recruitment_person(v.closed_by),'closeReason',v.close_reason,
  'hired',hired,'isMine',mine,
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'fullName',c.full_name,'email',c.email,'phone',c.phone,'cvUrl',c.cv_url,
    'notes',case when recruit then c.notes else '' end,'status',c.status,'decisionNote',c.decision_note,'decidedByName',private.workspace_recruitment_person(c.decided_by),'decidedAt',c.decided_at,
    'hiredUserId',c.hired_user_id,'hiredName',private.workspace_recruitment_person(c.hired_user_id),'hiredAt',c.hired_at,'addedAt',c.added_at,
    'onboarding',case when c.hired_user_id is null then null else private.workspace_onboarding_status(c.hired_user_id) end) order by c.added_at,c.id)
   from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and (recruit or c.status in ('shortlisted','selected','declined','hired'))),'[]'),
  'canEdit',v.status='open' and (recruit or mine),
  'canAdvertise',v.status='open' and recruit,
  'canShare',v.status='open' and recruit and exists(select 1 from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and c.status='shortlisted'),
  'canChoose',v.status='open' and (mine or admin),
  'canHire',v.status='open' and recruit,
  'canReopen',v.status<>'open' and (recruit or mine));
end $fn$;

create or replace function private.workspace_recruitment_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();recruit boolean;admin boolean;begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if actor in ('client','cleans') then raise exception 'Recruitment is for the team' using errcode='42501';end if;
 recruit:=private.workspace_can_recruit();admin:=actor in ('admin','super_admin');
 return jsonb_build_object('settings',private.workspace_recruitment_settings(),'canEditSettings',admin,'canRecruit',recruit,'canRequest',true,
  'recruiters',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member')) order by p.full_name,p.user_id)
   from private.workspace_recruiters r join public.workspace_profiles p on p.user_id=r.user_id where p.status='active'),'[]'),
  -- Who admins can name as recruiters, and who recruitment can link a hire to: the active team.
  'people',case when recruit then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member'),'role',p.role) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role<>'client'),'[]') else '[]' end,
  'vacancies',coalesce((select jsonb_agg(private.workspace_recruitment_vacancy(v,recruit) order by (v.status='open') desc,v.requested_at desc,v.id)
   from private.workspace_recruitment_vacancies v where (recruit or v.requested_by=auth.uid() or admin)
    and (v.status='open' or v.closed_at>now()-interval '180 days')),'[]'));
end $fn$;

-- 5. The actions.
create or replace function private.workspace_recruitment_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prior jsonb;result jsonb;recruit boolean;admin boolean;s jsonb;x jsonb;job jsonb;
 v private.workspace_recruitment_vacancies;c private.workspace_recruitment_candidates;vid uuid;cid uuid;who uuid;prop uuid;day date;n integer;hired integer;txt text;begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if actor in ('client','cleans') then raise exception 'Recruitment is for the team' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','settings','recruiterIds','vacancyId','candidateId','jobKey','area','positions','startBy','notes','propertyId',
  'advert','postedTo','posted','fullName','email','phone','cvUrl','status','decision','note','userId','reason'],120000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 recruit:=private.workspace_can_recruit();admin:=actor in ('admin','super_admin');
 if input ? 'vacancyId' then
  begin vid:=(input->>'vacancyId')::uuid; exception when others then vid:=null; end;
  select * into v from private.workspace_recruitment_vacancies where id=vid for update;
  if v.id is null or not (recruit or admin or v.requested_by=me) then raise exception 'Vacancy not found' using errcode='P0002';end if;
 end if;
 if input ? 'candidateId' then
  begin cid:=(input->>'candidateId')::uuid; exception when others then cid:=null; end;
  select * into c from private.workspace_recruitment_candidates where id=cid and vacancy_id=v.id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
 end if;

 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings','recruiterIds'],120000);
  if not admin then raise exception 'Only admins can change Recruitment' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['jobs'],100000);
  if jsonb_typeof(s->'jobs') is distinct from 'array' or jsonb_array_length(s->'jobs') not between 1 and 40 then raise exception 'Keep between 1 and 40 jobs' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(s->'jobs') loop
   perform private.workspace_json_keys(x,array['key','title','role','advert']);
   if coalesce(x->>'key','')!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 80
    or coalesce(x->>'role','') not in ('stays','cleans','cleaning_manager','ready','accounts','admin')
    or jsonb_typeof(x->'advert') is distinct from 'string' or char_length(x->>'advert')>5000 then raise exception 'Give every job a title, a role and an advert of up to 5,000 characters' using errcode='22023';end if;
  end loop;
  if (select count(distinct z->>'key') from jsonb_array_elements(s->'jobs') z)<>jsonb_array_length(s->'jobs') then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(input->'recruiterIds') is distinct from 'array' or jsonb_array_length(input->'recruiterIds')>50
   or exists(select 1 from jsonb_array_elements(input->'recruiterIds') z where jsonb_typeof(z)<>'string' or z#>>'{}'!~'^[0-9a-fA-F-]{36}$'
    or not exists(select 1 from public.workspace_profiles p where p.user_id=(z#>>'{}')::uuid and p.status='active' and p.role not in ('client','cleans')))
   then raise exception 'Choose recruiters from the active team' using errcode='22023';end if;
  insert into private.workspace_recruitment_settings(singleton,settings,updated_by,updated_at)
   values(true,jsonb_build_object('jobs',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'role',z->>'role','advert',btrim(z->>'advert')) order by o)
    from jsonb_array_elements(s->'jobs') with ordinality q(z,o))),me,now())
   on conflict (singleton) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  delete from private.workspace_recruiters where user_id::text not in (select lower(jsonb_array_elements_text(input->'recruiterIds')));
  insert into private.workspace_recruiters(user_id,added_by) select distinct lower(z)::uuid,me from jsonb_array_elements_text(input->'recruiterIds') z on conflict do nothing;

 elsif input->>'action'='requestRole' then
  -- A manager asks for a role (Launch Preparation's housekeeper step passes the property).
  perform private.workspace_json_keys(input,array['action','requestId','jobKey','area','positions','startBy','notes','propertyId']);
  job:=(select z from jsonb_array_elements(private.workspace_recruitment_settings()->'jobs') z where z->>'key'=input->>'jobKey');
  if job is null then raise exception 'Choose the job' using errcode='22023';end if;
  if jsonb_typeof(input->'area') is distinct from 'string' or char_length(btrim(input->>'area')) not between 1 and 200 then raise exception 'Say which area the role covers' using errcode='22023';end if;
  if jsonb_typeof(input->'positions') is distinct from 'number' or (input->>'positions')!~'^[0-9]+$' or (input->>'positions')::int not between 1 and 20 then raise exception 'Ask for between 1 and 20 people' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'notes','""')) is distinct from 'string' or char_length(coalesce(input->>'notes',''))>2000 then raise exception 'Up to 2,000 characters of notes' using errcode='22023';end if;
  day:=null;
  if coalesce(input->>'startBy','')<>'' then
   begin day:=(input->>'startBy')::date; exception when others then day:=null; end;
   if day is null or day<(now() at time zone 'Europe/London')::date then raise exception 'Choose a start date from today' using errcode='22023';end if;
  end if;
  prop:=null;
  if coalesce(input->>'propertyId','')<>'' then
   begin prop:=(input->>'propertyId')::uuid; exception when others then prop:=null; end;
   if prop is null or not exists(select 1 from public.workspace_properties p where p.id=prop) then raise exception 'Property not found' using errcode='P0002';end if;
  end if;
  insert into private.workspace_recruitment_vacancies(job_key,title,role,area,positions,start_by,notes,property_id,requested_by,advert)
   values(job->>'key',job->>'title',job->>'role',btrim(input->>'area'),(input->>'positions')::int,day,btrim(coalesce(input->>'notes','')),prop,me,coalesce(job->>'advert',''))
   returning * into v;
  perform private.workspace_recruitment_tell(private.workspace_recruitment_team(),'recruitment.requested',prop);

 elsif input->>'action'='updateVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','area','positions','startBy','notes']);
  if v.status<>'open' or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, change an open vacancy' using errcode='42501';end if;
  if jsonb_typeof(input->'area') is distinct from 'string' or char_length(btrim(input->>'area')) not between 1 and 200 then raise exception 'Say which area the role covers' using errcode='22023';end if;
  if jsonb_typeof(input->'positions') is distinct from 'number' or (input->>'positions')!~'^[0-9]+$' or (input->>'positions')::int not between 1 and 20 then raise exception 'Ask for between 1 and 20 people' using errcode='22023';end if;
  if (input->>'positions')::int<(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired') then raise exception 'More people are already hired than that' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'notes','""')) is distinct from 'string' or char_length(coalesce(input->>'notes',''))>2000 then raise exception 'Up to 2,000 characters of notes' using errcode='22023';end if;
  day:=null;
  if coalesce(input->>'startBy','')<>'' then
   begin day:=(input->>'startBy')::date; exception when others then day:=null; end;
   if day is null then raise exception 'Choose a start date' using errcode='22023';end if;
  end if;
  update private.workspace_recruitment_vacancies set area=btrim(input->>'area'),positions=(input->>'positions')::int,start_by=day,notes=btrim(coalesce(input->>'notes','')) where id=v.id;

 elsif input->>'action'='saveAdvert' then
  -- The advert and where it is posted; "posted" marks it as advertised (once).
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','advert','postedTo','posted'],20000);
  if v.status<>'open' or not recruit then raise exception 'Recruitment write the advert' using errcode='42501';end if;
  if jsonb_typeof(input->'advert') is distinct from 'string' or char_length(btrim(input->>'advert')) not between 1 and 5000 then raise exception 'Write the advert (up to 5,000 characters)' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'postedTo','""')) is distinct from 'string' or char_length(coalesce(input->>'postedTo',''))>1000 then raise exception 'Up to 1,000 characters on where it is posted' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'posted','false')) is distinct from 'boolean' then raise exception 'Invalid request' using errcode='22023';end if;
  if coalesce((input->>'posted')::boolean,false) and btrim(coalesce(input->>'postedTo',''))='' then raise exception 'Say where the advert is posted' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set advert=btrim(input->>'advert'),posted_to=btrim(coalesce(input->>'postedTo','')),
   advertised_at=case when coalesce((input->>'posted')::boolean,false) then coalesce(advertised_at,now()) else advertised_at end,
   advertised_by=case when coalesce((input->>'posted')::boolean,false) then coalesce(advertised_by,me) else advertised_by end
   where id=v.id;
  if coalesce((input->>'posted')::boolean,false) and v.advertised_at is null and v.requested_by is not null then
   perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.advertised',v.property_id);
  end if;

 elsif input->>'action' in ('addCandidate','editCandidate') then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','fullName','email','phone','cvUrl','notes']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment add the candidates' using errcode='42501';end if;
  if input->>'action'='addCandidate' and input ? 'candidateId' then raise exception 'Invalid request' using errcode='22023';end if;
  if input->>'action'='editCandidate' and c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if jsonb_typeof(input->'fullName') is distinct from 'string' or char_length(btrim(input->>'fullName')) not between 2 and 200 then raise exception 'Give the candidate''s full name' using errcode='22023';end if;
  for txt in select unnest(array['email','phone','cvUrl','notes']) loop
   if jsonb_typeof(coalesce(input->txt,'""')) is distinct from 'string' then raise exception 'Invalid request' using errcode='22023';end if;
  end loop;
  if coalesce(btrim(input->>'email'),'')<>'' and (char_length(btrim(input->>'email'))>320 or btrim(input->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Check the email address' using errcode='22023';end if;
  if char_length(coalesce(btrim(input->>'phone'),''))>40 then raise exception 'Check the phone number' using errcode='22023';end if;
  if coalesce(btrim(input->>'cvUrl'),'')<>'' and (char_length(btrim(input->>'cvUrl'))>1000 or btrim(input->>'cvUrl')!~'^https://[^[:space:]]+$') then raise exception 'The CV link starts https://' using errcode='22023';end if;
  if char_length(coalesce(input->>'notes',''))>2000 then raise exception 'Up to 2,000 characters of notes' using errcode='22023';end if;
  if btrim(coalesce(input->>'email',''))='' and btrim(coalesce(input->>'phone',''))='' then raise exception 'Give an email address or a phone number' using errcode='22023';end if;
  if input->>'action'='addCandidate' then
   if (select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id)>=200 then raise exception 'A vacancy holds up to 200 candidates' using errcode='22023';end if;
   insert into private.workspace_recruitment_candidates(vacancy_id,full_name,email,phone,cv_url,notes,added_by)
    values(v.id,btrim(input->>'fullName'),lower(btrim(coalesce(input->>'email',''))),btrim(coalesce(input->>'phone','')),btrim(coalesce(input->>'cvUrl','')),btrim(coalesce(input->>'notes','')),me);
  else
   update private.workspace_recruitment_candidates set full_name=btrim(input->>'fullName'),email=lower(btrim(coalesce(input->>'email',''))),phone=btrim(coalesce(input->>'phone','')),
    cv_url=btrim(coalesce(input->>'cvUrl','')),notes=btrim(coalesce(input->>'notes','')) where id=c.id;
  end if;

 elsif input->>'action'='setCandidate' then
  -- Recruitment shortlist, reject, put back or mark withdrawn. A hired candidate stays hired.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','status','note']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment shortlist the candidates' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if coalesce(input->>'status','') not in ('new','shortlisted','rejected','withdrawn') then raise exception 'Invalid request' using errcode='22023';end if;
  if c.status='hired' then raise exception 'This candidate is already hired' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status=input->>'status',decision_note=btrim(coalesce(input->>'note','')),decided_by=me,decided_at=now() where id=c.id;

 elsif input->>'action'='deleteCandidate' then
  -- A candidate's details go when they are no longer needed (a hired candidate stays on record).
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId']);
  if not recruit then raise exception 'Recruitment remove candidates' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status='hired' then raise exception 'A hired candidate stays on record' using errcode='22023';end if;
  delete from private.workspace_recruitment_candidates where id=c.id;

 elsif input->>'action'='shareShortlist' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment share the shortlist' using errcode='42501';end if;
  if not exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='shortlisted') then raise exception 'Shortlist at least one candidate first' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set shortlist_shared_at=now() where id=v.id;
  perform private.workspace_recruitment_tell(array[coalesce(v.requested_by,me)],'recruitment.shortlist_ready',v.property_id);

 elsif input->>'action'='chooseCandidate' then
  -- The manager who asked (or an admin) selects or turns down a shortlisted candidate.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','decision','note']);
  if v.status<>'open' or not (admin or v.requested_by=me) then raise exception 'The manager who asked for the role chooses' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status not in ('shortlisted','selected','declined') then raise exception 'Choose from the shortlist' using errcode='22023';end if;
  if coalesce(input->>'decision','') not in ('select','decline') then raise exception 'Select or turn down the candidate' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  if input->>'decision'='decline' and btrim(coalesce(input->>'note',''))='' then raise exception 'Say why they are not right for the role' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status=case when input->>'decision'='select' then 'selected' else 'declined' end,
   decision_note=btrim(coalesce(input->>'note','')),decided_by=me,decided_at=now() where id=c.id;
  if input->>'decision'='select' then perform private.workspace_recruitment_tell(private.workspace_recruitment_team(),'recruitment.candidate_selected',v.property_id);end if;

 elsif input->>'action'='hireCandidate' then
  -- Recruitment onboard the selected candidate: their account (made in Access control) is linked here.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','userId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment onboard the new starter' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status<>'selected' then raise exception 'The manager selects the candidate first' using errcode='22023';end if;
  begin who:=(input->>'userId')::uuid; exception when others then who:=null; end;
  if not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and p.role<>'client') then raise exception 'Choose their team account' using errcode='22023';end if;
  if exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.hired_user_id=who) then raise exception 'That account is already hired for this vacancy' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status='hired',hired_user_id=who,hired_at=now() where id=c.id;
  hired:=(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired');
  if hired>=v.positions then
   update private.workspace_recruitment_vacancies set status='filled',closed_at=now(),closed_by=me,close_reason='' where id=v.id;
  end if;
  perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.hired',v.property_id);

 elsif input->>'action'='cancelVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','reason']);
  if v.status<>'open' or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, close the vacancy' using errcode='42501';end if;
  if jsonb_typeof(input->'reason') is distinct from 'string' or char_length(btrim(input->>'reason')) not between 1 and 1000 then raise exception 'Say why the vacancy is closed' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set status='cancelled',closed_at=now(),closed_by=me,close_reason=btrim(input->>'reason') where id=v.id;
  perform private.workspace_recruitment_tell(case when v.requested_by=me then private.workspace_recruitment_team() else array[v.requested_by] end,'recruitment.closed',v.property_id);

 elsif input->>'action'='reopenVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status='open' or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, reopen the vacancy' using errcode='42501';end if;
  if v.status='filled' then
   update private.workspace_recruitment_vacancies set status='open',closed_at=null,closed_by=null,close_reason='',
    positions=greatest(positions,(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired')::int+1) where id=v.id;
  else
   update private.workspace_recruitment_vacancies set status='open',closed_at=null,closed_by=null,close_reason='' where id=v.id;
  end if;

 else
  raise exception 'Unknown Recruitment action' using errcode='22023';
 end if;
 result:=private.workspace_recruitment_read();
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

create or replace function public.workspace_recruitment_read() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_recruitment_read();$$;
create or replace function public.workspace_recruitment_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_recruitment_action(input);$$;

revoke all on function private.workspace_recruitment_settings_default(),private.workspace_recruitment_settings(),private.workspace_recruitment_person(uuid),
 private.workspace_can_recruit(),private.workspace_recruitment_tell(uuid[],text,uuid),private.workspace_recruitment_team(),
 private.workspace_recruitment_vacancy(private.workspace_recruitment_vacancies,boolean),private.workspace_recruitment_read(),private.workspace_recruitment_action(jsonb),
 public.workspace_recruitment_read(),public.workspace_recruitment_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_recruitment_read(),public.workspace_recruitment_read(),private.workspace_recruitment_action(jsonb),public.workspace_recruitment_action(jsonb) to authenticated;
