-- Hiring process (Business Plan v2, "Hiring & Training Processes"), on the Recruitment board (20261029600000).
--  * A manager asks for a role with the job, area, why it is needed and any specific requests. The request waits for the
--    directors: they approve it with the maximum budget for the role (recruitment is then auto-assigned: the named recruiter
--    with the fewest open vacancies) or turn it down with a reason. Admins name the directors (otherwise the super admins).
--  * The ticket's checklist: application form (hours, expected earnings, job description and role-specific questions; each
--    job carries questions to start from), marketing (Instagram, Facebook, LinkedIn, Indeed: posted or not used), reviewing
--    (sharing the shortlist ticks it and withdraws the application form), interviews (the manager chooses virtual or in
--    person and the times they are free, then invites shortlisted candidates; an invite not answered within 3 days is
--    expired; a booked interview goes on the manager's to-do on its day), job offer (the manager selects who to offer;
--    the candidate's answer is recorded), contract (a contract template for the role, its blanks filled, pre-signed by a
--    director; the candidate signs) and onboarding and training (as before: the new starter's account, contract and courses).
--  * Until applicants have their own accounts, recruitment record a candidate's answers for them (interview time, offer,
--    a contract signed on paper).
--  * Contract templates: recruitment and admins write them with {{blanks}}; a director signs each one with a drawn signature.
-- Replaces private.workspace_recruitment_settings_default, _vacancy, _read and _action (20261029600000, 20261031100000).
-- Safe to run twice.

-- 1. Directors, the request's approval and the checklist's details.
create table if not exists private.workspace_recruitment_directors (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 added_by uuid references auth.users(id) on delete set null,
 added_at timestamptz not null default now()
);
alter table private.workspace_recruitment_directors enable row level security;

alter table private.workspace_recruitment_vacancies
 add column if not exists reason text not null default '' check (char_length(reason)<=1000),
 add column if not exists approved_by uuid references auth.users(id) on delete set null,
 add column if not exists approved_at timestamptz,
 add column if not exists budget_minor bigint check (budget_minor is null or budget_minor between 1 and 100000000),
 add column if not exists budget_unit text check (budget_unit is null or budget_unit in ('hour','job','week','month','year')),
 add column if not exists assigned_to uuid references public.workspace_profiles(user_id) on delete set null,
 add column if not exists form_hours text not null default '' check (char_length(form_hours)<=200),
 add column if not exists form_earnings text not null default '' check (char_length(form_earnings)<=200),
 add column if not exists form_questions jsonb not null default '[]' check (jsonb_typeof(form_questions)='array' and octet_length(form_questions::text)<=20000),
 add column if not exists form_published_at timestamptz,
 add column if not exists form_published_by uuid references auth.users(id) on delete set null,
 add column if not exists form_closed_at timestamptz,
 add column if not exists platforms jsonb not null default '{}' check (jsonb_typeof(platforms)='object' and octet_length(platforms::text)<=2000),
 add column if not exists interview_mode text check (interview_mode is null or interview_mode in ('virtual','in_person')),
 add column if not exists interview_place text not null default '' check (char_length(interview_place)<=500),
 add column if not exists interview_minutes integer not null default 30 check (interview_minutes between 10 and 240),
 add column if not exists interview_slots jsonb not null default '[]' check (jsonb_typeof(interview_slots)='array' and jsonb_array_length(interview_slots)<=30),
 add column if not exists interviews_done_at timestamptz;
alter table private.workspace_recruitment_vacancies drop constraint if exists workspace_recruitment_vacancies_status_check;
alter table private.workspace_recruitment_vacancies add constraint workspace_recruitment_vacancies_status_check check (status in ('requested','open','filled','cancelled','rejected'));
create index if not exists workspace_recruitment_vacancies_requested on private.workspace_recruitment_vacancies(requested_at) where status='requested';

alter table private.workspace_recruitment_candidates
 add column if not exists source text not null default 'team' check (source in ('team','careers')),
 add column if not exists applicant_id uuid references auth.users(id) on delete set null,
 add column if not exists answers jsonb not null default '[]' check (jsonb_typeof(answers)='array' and octet_length(answers::text)<=20000),
 add column if not exists other_roles boolean not null default false,
 add column if not exists interview_status text check (interview_status is null or interview_status in ('invited','booked','declined','expired','done','no_show')),
 add column if not exists interview_invited_at timestamptz,
 add column if not exists interview_expires_at timestamptz,
 add column if not exists interview_at timestamptz,
 add column if not exists interview_todo_id uuid references private.workspace_hub_items(id) on delete set null,
 add column if not exists interview_note text not null default '' check (char_length(interview_note)<=2000),
 add column if not exists offer_status text check (offer_status is null or offer_status in ('offered','accepted','declined')),
 add column if not exists offered_at timestamptz,
 add column if not exists offer_answered_at timestamptz,
 add column if not exists offer_note text not null default '' check (char_length(offer_note)<=1000);

-- 2. Contract templates and each candidate's contract (its own copy of the filled wording and the director's signature).
create table if not exists private.workspace_hiring_contract_templates (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(btrim(title)) between 2 and 200),
 job_keys text[] not null default '{}' check (cardinality(job_keys)<=40),
 body text not null check (char_length(btrim(body)) between 20 and 100000),
 director_name text not null default '' check (char_length(director_name)<=200),
 director_signature text check (director_signature is null or (char_length(director_signature)<=200000 and director_signature ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$')),
 director_signed_by uuid references auth.users(id) on delete set null,
 director_signed_at timestamptz,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table if not exists private.workspace_hiring_contracts (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null unique references private.workspace_recruitment_candidates(id) on delete cascade,
 template_id uuid references private.workspace_hiring_contract_templates(id) on delete set null,
 title text not null check (char_length(title) between 2 and 200),
 body text not null check (char_length(body) between 20 and 120000),
 fields jsonb not null default '{}' check (jsonb_typeof(fields)='object'),
 director_name text not null default '',
 director_signature text,
 issued_by uuid references auth.users(id) on delete set null,
 issued_at timestamptz not null default now(),
 signed_name text check (signed_name is null or char_length(btrim(signed_name)) between 2 and 200),
 signed_signature text check (signed_signature is null or (char_length(signed_signature)<=200000 and signed_signature ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$')),
 signed_at timestamptz,
 signed_how text check (signed_how is null or signed_how in ('candidate','paper')),
 recorded_by uuid references auth.users(id) on delete set null
);
alter table private.workspace_hiring_contract_templates enable row level security;
alter table private.workspace_hiring_contracts enable row level security;
revoke all on private.workspace_recruitment_directors,private.workspace_hiring_contract_templates,private.workspace_hiring_contracts from public,anon,authenticated,service_role;

-- 3. The jobs carry their application form to start from: hours, expected earnings and role-specific questions.
create or replace function private.workspace_recruitment_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select '{"jobs":[
  {"key":"housekeeper","title":"Housekeeper","role":"cleans","hours":"Flexible, mainly 11am to 3pm on changeover days","earnings":"Paid per clean","advert":"Recharge is looking for a Housekeeper. This is not a cleaner: you make sure each property is guest ready and report anything that would stop it being guest ready. You will need an eye for detail, your own transport and good communication.",
   "questions":[{"id":"q1","label":"What are your pay expectations per clean for a 1, 2, 3, 4 and 5-bedroom property?","kind":"long","required":true},{"id":"q2","label":"Do you have your own transport?","kind":"yes_no","required":true},{"id":"q3","label":"Which days and times are you available?","kind":"long","required":true}]},
  {"key":"property_operations_technician","title":"Property Operations Technician","role":"ready","hours":"","earnings":"","advert":"Recharge is looking for a Property Operations Technician with good general handy work experience and a general understanding of most trades, to keep our serviced accommodation in top condition.",
   "questions":[{"id":"q1","label":"Which trades are you experienced in?","kind":"long","required":true},{"id":"q2","label":"Do you have your own tools and transport?","kind":"yes_no","required":true}]},
  {"key":"furniture_install_technician","title":"Furniture Install Technician","role":"ready","hours":"","earnings":"","advert":"Recharge is looking for a Furniture Install Technician to receive, assemble and install furniture in our new properties. You must have a van and be able to assemble furniture.",
   "questions":[{"id":"q1","label":"Do you have a van?","kind":"yes_no","required":true}]},
  {"key":"photographer","title":"Photographer","role":"ready","hours":"","earnings":"","advert":"Recharge is looking for a Photographer to professionally photograph our serviced accommodation properties for their listings.",
   "questions":[{"id":"q1","label":"A link to your portfolio","kind":"short","required":true}]},
  {"key":"property_onboarding_consultant","title":"Property Performance Consultant","role":"stays","hours":"","earnings":"","advert":"Recharge is looking for a Property Performance Consultant, the frontline of our sales team: preparing property performance estimates for the Property Performance Manager and answering prospective clients'' questions, with a strong understanding of property performance and excellent communication skills.","questions":[]},
  {"key":"admin_assistant","title":"Admin Assistant","role":"stays","hours":"","earnings":"","advert":"Recharge is looking for an Admin Assistant to respond to inbound calls and messages and create property listings.","questions":[]},
  {"key":"property_revenue_manager","title":"Property Revenue Manager","role":"stays","hours":"","earnings":"","advert":"Recharge is looking for a Property Revenue Manager to make sure every property is priced correctly.","questions":[]},
  {"key":"licensing_coordinator","title":"Licensing Coordinator","role":"stays","hours":"","earnings":"","advert":"Recharge is looking for a Licensing Coordinator to answer licensing questions, advise clients and take every licence application through to completion.","questions":[]},
  {"key":"accounting_administrator","title":"Accounting Administrator","role":"accounts","hours":"","earnings":"","advert":"Recharge is looking for an Accounting Administrator to send and settle the invoices approved by the management team.","questions":[]},
  {"key":"housekeeping_coordinator","title":"Housekeeping Coordinator","role":"cleaning_manager","hours":"","earnings":"","advert":"Recharge is looking for a Housekeeping Coordinator to allocate housekeepers to properties and keep every changeover on track.","questions":[]},
  {"key":"recruitment_manager","title":"Recruitment Manager","role":"admin","hours":"","earnings":"","advert":"Recharge is looking for a Recruitment Manager to create job adverts for our managers, find suitable candidates for them to choose from and onboard new staff onto our systems.","questions":[]},
  {"key":"property_operations_manager","title":"Property Operations Manager","role":"admin","hours":"","earnings":"","advert":"Recharge is looking for a Property Operations Manager to coordinate property set-up, reactive maintenance and housekeeping across the country. This is a 24/7 role with no set hours.","questions":[]},
  {"key":"property_performance_manager","title":"Property Performance Manager","role":"admin","hours":"","earnings":"","advert":"Recharge is looking for a Property Performance Manager to own the performance of our portfolio, from listings to pricing.","questions":[]}
 ]}'::jsonb
$fn$;
-- Saved jobs gain the new fields (blank) and, where they have no questions yet, the default job's questions.
update private.workspace_recruitment_settings s set settings=jsonb_set(s.settings,'{jobs}',(select jsonb_agg(
  jsonb_build_object('hours',coalesce(j->>'hours',d->>'hours',''),'earnings',coalesce(j->>'earnings',d->>'earnings',''),'questions',coalesce(j->'questions',d->'questions','[]'::jsonb))||j order by o)
 from jsonb_array_elements(s.settings->'jobs') with ordinality q(j,o)
 left join lateral (select x from jsonb_array_elements(private.workspace_recruitment_settings_default()->'jobs') x where x->>'key'=j->>'key') dd(d) on true))
 where s.singleton and exists(select 1 from jsonb_array_elements(s.settings->'jobs') j where not (j ? 'questions'));

-- 4. Who is who. Directors: the admins named as directors, or the super admins when nobody is named (or the admins).
create or replace function private.workspace_recruitment_director_ids() returns uuid[] language sql stable security definer set search_path='' as $fn$
 select coalesce(
  (select array_agg(d.user_id order by d.user_id) from private.workspace_recruitment_directors d join public.workspace_profiles p on p.user_id=d.user_id where p.status='active' and p.role in ('admin','super_admin')),
  (select array_agg(p.user_id order by p.user_id) from public.workspace_profiles p where p.status='active' and p.role='super_admin'),
  (select array_agg(p.user_id order by p.user_id) from public.workspace_profiles p where p.status='active' and p.role='admin'))
$fn$;
create or replace function private.workspace_recruitment_is_director() returns boolean language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and auth.uid()=any(coalesce(private.workspace_recruitment_director_ids(),'{}'))
$fn$;
-- Recruitment is auto-assigned: the named recruiter with the fewest open vacancies.
create or replace function private.workspace_recruitment_pick_recruiter() returns uuid language sql stable security definer set search_path='' as $fn$
 select r.user_id from private.workspace_recruiters r join public.workspace_profiles p on p.user_id=r.user_id where p.status='active'
  order by (select count(*) from private.workspace_recruitment_vacancies v where v.assigned_to=r.user_id and v.status='open'),p.full_name,r.user_id limit 1
$fn$;
-- An interview invite not answered within 3 days expires.
create or replace function private.workspace_recruitment_expire() returns void language sql security definer set search_path='' as $fn$
 update private.workspace_recruitment_candidates set interview_status='expired' where interview_status='invited' and interview_expires_at<now()
$fn$;
-- The {{blanks}} in a contract's wording, in order.
create or replace function private.workspace_hiring_blanks(body text) returns text[] language sql immutable set search_path='' as $fn$
 select coalesce(array_agg(k order by pos),'{}') from (select m[1] k,min(o) pos from regexp_matches(body,'\{\{([a-z][a-z0-9_]{1,39})\}\}','g') with ordinality r(m,o) group by m[1]) x
$fn$;
create or replace function private.workspace_hiring_valid_png(s text) returns boolean language sql immutable set search_path='' as $fn$
 select s is not null and char_length(s)<=200000 and s ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'
$fn$;

-- Role-specific questions on an application form: up to 15, each with an id, a label, a kind and whether it is required.
create or replace function private.workspace_recruitment_check_questions(q jsonb) returns void language plpgsql immutable set search_path='' as $fn$
declare x jsonb;begin
 if jsonb_typeof(q) is distinct from 'array' or jsonb_array_length(q)>15 then raise exception 'Up to 15 questions' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(q) loop
  if jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','label','kind','required'))
   or coalesce(x->>'id','')!~'^q[a-z0-9]{1,12}$' or jsonb_typeof(x->'label') is distinct from 'string' or char_length(btrim(x->>'label')) not between 3 and 300
   or coalesce(x->>'kind','') not in ('short','long','yes_no','number') or jsonb_typeof(x->'required') is distinct from 'boolean' then
   raise exception 'Give every question a label (3 to 300 characters) and a kind' using errcode='22023';end if;
 end loop;
 if (select count(distinct z->>'id') from jsonb_array_elements(q) z)<>jsonb_array_length(q) then raise exception 'Invalid request' using errcode='22023';end if;
end $fn$;
create or replace function private.workspace_recruitment_clean_questions(q jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','label',btrim(x->>'label'),'kind',x->>'kind','required',(x->>'required')::boolean) order by o),'[]')
 from jsonb_array_elements(q) with ordinality e(x,o)
$fn$;

-- More about a candidate, for later parts to fill in (the applicants' own side: their CV file and messages).
create or replace function private.workspace_recruitment_candidate_more(candidate uuid,recruit boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select '{}'::jsonb
$fn$;

-- The candidate's side of the interview and the offer, answered by them (in their applicant account) or recorded for them
-- by the manager or recruitment. A booked interview goes on the manager's to-do on its day.
create or replace function private.workspace_recruitment_book(cand uuid,slot_at timestamptz) returns void language plpgsql security definer set search_path='' as $fn$
declare c private.workspace_recruitment_candidates;v private.workspace_recruitment_vacancies;me uuid:=auth.uid();manager uuid;owner_id uuid;item uuid;txt text;doc text;begin
 select * into c from private.workspace_recruitment_candidates where id=cand for update;
 select * into v from private.workspace_recruitment_vacancies where id=c.vacancy_id for update;
 if v.id is null or v.status<>'open' then raise exception 'This vacancy is closed' using errcode='22023';end if;
 if coalesce(c.interview_status,'') not in ('invited','booked') or (c.interview_status='invited' and c.interview_expires_at<now()) then raise exception 'Invite them to interview first' using errcode='22023';end if;
 if slot_at is null or not exists(select 1 from jsonb_array_elements_text(v.interview_slots) e where e::timestamptz=slot_at) then raise exception 'Choose one of the times offered' using errcode='22023';end if;
 if slot_at<=now() then raise exception 'Choose a time from now on' using errcode='22023';end if;
 if exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.id<>c.id and c2.interview_status='booked' and c2.interview_at=slot_at) then raise exception 'That time is taken' using errcode='22023';end if;
 -- The manager who asked (or, if they have left, whoever is recruiting, or an admin) has it on their to-do.
 manager:=coalesce((select p.user_id from public.workspace_profiles p where p.user_id in (v.requested_by,v.assigned_to) and p.status='active' and p.role<>'client' order by p.user_id=v.requested_by desc limit 1),
  (select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') order by p.role='super_admin',p.user_id limit 1));
 owner_id:=case when exists(select 1 from public.workspace_profiles p where p.user_id=me and p.status='active' and p.role<>'client') then me else manager end;
 item:=c.interview_todo_id;
 txt:=left('Interview: '||c.full_name||' ('||v.title||')',200);
 doc:=left('Interview at '||to_char(slot_at at time zone 'Europe/London','HH24:MI')||', '||v.interview_minutes||' minutes, '||case v.interview_mode when 'virtual' then 'virtual: ' else 'in person at ' end||v.interview_place||'.',3000);
 if manager is not null then
  if item is not null and exists(select 1 from private.workspace_hub_items h where h.id=item) then
   update private.workspace_hub_items set title=txt,details=doc,due_on=(slot_at at time zone 'Europe/London')::date,status='open',updated_at=now(),version=version+1 where id=item;
  else
   insert into private.workspace_hub_items(kind,title,details,assignee_id,due_on,status,priority,created_by)
    values('todo',txt,doc,manager,(slot_at at time zone 'Europe/London')::date,'open','high',owner_id) returning id into item;
  end if;
 end if;
 update private.workspace_recruitment_candidates set interview_status='booked',interview_at=slot_at,interview_todo_id=item where id=c.id;
 perform private.workspace_recruitment_tell(array_remove(array[manager,case when me=c.applicant_id then v.assigned_to end],me),'recruitment.interview_booked',v.property_id);
end $fn$;
create or replace function private.workspace_recruitment_decline_interview(cand uuid,note text) returns void language plpgsql security definer set search_path='' as $fn$
declare c private.workspace_recruitment_candidates;begin
 select * into c from private.workspace_recruitment_candidates where id=cand for update;
 if coalesce(c.interview_status,'') not in ('invited','booked','expired') then raise exception 'They are not invited' using errcode='22023';end if;
 if char_length(coalesce(note,''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
 if c.interview_todo_id is not null then update private.workspace_hub_items set status='done',updated_at=now() where id=c.interview_todo_id and status='open';end if;
 update private.workspace_recruitment_candidates set interview_status='declined',interview_note=btrim(coalesce(note,'')) where id=c.id;
end $fn$;
create or replace function private.workspace_recruitment_answer_offer(cand uuid,answer text,note text) returns void language plpgsql security definer set search_path='' as $fn$
declare c private.workspace_recruitment_candidates;v private.workspace_recruitment_vacancies;k private.workspace_hiring_contracts;manager uuid;begin
 select * into c from private.workspace_recruitment_candidates where id=cand for update;
 select * into v from private.workspace_recruitment_vacancies where id=c.vacancy_id;
 select * into k from private.workspace_hiring_contracts where candidate_id=c.id;
 if v.status<>'open' then raise exception 'This vacancy is closed' using errcode='22023';end if;
 if c.status<>'selected' or c.offer_status is null then raise exception 'Offer them the job first' using errcode='22023';end if;
 if coalesce(answer,'') not in ('accept','decline') then raise exception 'Say whether they accepted' using errcode='22023';end if;
 if char_length(coalesce(note,''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
 if answer='decline' and k.signed_at is not null then raise exception 'They have signed their contract' using errcode='22023';end if;
 manager:=coalesce(v.requested_by,auth.uid());
 if answer='accept' then
  update private.workspace_recruitment_candidates set offer_status='accepted',offer_answered_at=now(),offer_note=btrim(coalesce(note,'')) where id=c.id;
  perform private.workspace_recruitment_tell(coalesce(private.workspace_recruitment_team(),'{}')||array[manager],'recruitment.offer_accepted',v.property_id);
 else
  update private.workspace_recruitment_candidates set offer_status='declined',offer_answered_at=now(),offer_note=btrim(coalesce(note,'')),status='withdrawn' where id=c.id;
  if k.id is not null then delete from private.workspace_hiring_contracts where id=k.id;end if;
  perform private.workspace_recruitment_tell(array[manager],'recruitment.offer_declined',v.property_id);
 end if;
end $fn$;

-- 5. One vacancy, as the signed-in person sees it.
create or replace function private.workspace_recruitment_vacancy(v private.workspace_recruitment_vacancies,recruit boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare mine boolean:=v.requested_by=auth.uid();admin boolean:=private.workspace_actor_role() in ('admin','super_admin');director boolean:=private.workspace_recruitment_is_director();
 hired integer;manager boolean;live boolean:=v.status='open';begin
 hired:=(select count(*) from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and c.status='hired');
 manager:=mine or admin;
 return jsonb_build_object('id',v.id,'jobKey',v.job_key,'title',v.title,'role',v.role,'area',v.area,'positions',v.positions,'startBy',v.start_by,'notes',v.notes,'reason',v.reason,
  'propertyId',v.property_id,'propertyName',(select coalesce(nullif(btrim(p.name),''),p.address,'Property') from public.workspace_properties p where p.id=v.property_id),
  'requestedById',v.requested_by,'requestedByName',coalesce(private.workspace_recruitment_person(v.requested_by),'A manager'),'requestedAt',v.requested_at,
  'approvedAt',v.approved_at,'approvedByName',private.workspace_recruitment_person(v.approved_by),'budgetMinor',v.budget_minor,'budgetUnit',v.budget_unit,
  'assignedToId',v.assigned_to,'assignedToName',private.workspace_recruitment_person(v.assigned_to),
  'advert',v.advert,'postedTo',v.posted_to,'advertisedAt',v.advertised_at,'advertisedByName',private.workspace_recruitment_person(v.advertised_by),
  'form',jsonb_build_object('hours',v.form_hours,'earnings',v.form_earnings,'questions',v.form_questions,'publishedAt',v.form_published_at,
   'publishedByName',private.workspace_recruitment_person(v.form_published_by),'closedAt',v.form_closed_at),
  'platforms',v.platforms,
  'interview',jsonb_build_object('mode',v.interview_mode,'place',v.interview_place,'minutes',v.interview_minutes,'slots',v.interview_slots,'doneAt',v.interviews_done_at),
  'shortlistSharedAt',v.shortlist_shared_at,'status',v.status,'closedAt',v.closed_at,'closedByName',private.workspace_recruitment_person(v.closed_by),'closeReason',v.close_reason,
  'hired',hired,'isMine',mine,
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'fullName',c.full_name,'email',c.email,'phone',c.phone,'cvUrl',c.cv_url,
    'notes',case when recruit then c.notes else '' end,'status',c.status,'decisionNote',c.decision_note,'decidedByName',private.workspace_recruitment_person(c.decided_by),'decidedAt',c.decided_at,
    'hiredUserId',c.hired_user_id,'hiredName',private.workspace_recruitment_person(c.hired_user_id),'hiredAt',c.hired_at,'addedAt',c.added_at,
    'source',c.source,'answers',c.answers,'otherRoles',c.other_roles,
    'interviewStatus',case when c.interview_status='invited' and c.interview_expires_at<now() then 'expired' else c.interview_status end,
    'interviewInvitedAt',c.interview_invited_at,'interviewExpiresAt',c.interview_expires_at,'interviewAt',c.interview_at,'interviewNote',c.interview_note,
    'offerStatus',c.offer_status,'offeredAt',c.offered_at,'offerAnsweredAt',c.offer_answered_at,'offerNote',c.offer_note,
    'contract',(select jsonb_build_object('id',k.id,'title',k.title,'body',k.body,'fields',k.fields,'directorName',k.director_name,'directorSignature',k.director_signature,
      'issuedAt',k.issued_at,'issuedByName',private.workspace_recruitment_person(k.issued_by),'signedName',k.signed_name,'signedSignature',k.signed_signature,'signedAt',k.signed_at,'signedHow',k.signed_how)
     from private.workspace_hiring_contracts k where k.candidate_id=c.id and (recruit or manager)),
    'onboarding',case when c.hired_user_id is null then null else private.workspace_onboarding_status(c.hired_user_id) end)||private.workspace_recruitment_candidate_more(c.id,recruit) order by c.added_at,c.id)
   from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and (recruit or c.status in ('shortlisted','selected','declined','hired'))),'[]'),
  'canDecide',v.status='requested' and director,
  'canAssign',live and (recruit or admin),
  'canEdit',v.status in ('requested','open') and (recruit or mine),
  'canAdvertise',live and recruit,
  'canShare',live and recruit and exists(select 1 from private.workspace_recruitment_candidates c where c.vacancy_id=v.id and c.status='shortlisted'),
  'canInterview',live and (manager or recruit),
  'canChoose',live and manager,
  'canAnswerFor',live and (recruit or manager),
  'canContract',live and recruit,
  'canHire',live and recruit,
  'canReopen',v.status in ('filled','cancelled') and (recruit or mine));
end $fn$;

create or replace function private.workspace_recruitment_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();recruit boolean;admin boolean;director boolean;begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if actor in ('client','cleans') then raise exception 'Recruitment is for the team' using errcode='42501';end if;
 recruit:=private.workspace_can_recruit();admin:=actor in ('admin','super_admin');director:=private.workspace_recruitment_is_director();
 return jsonb_build_object('settings',private.workspace_recruitment_settings(),'canEditSettings',admin,'canRecruit',recruit,'canRequest',true,'canApprove',director,
  'recruiters',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member')) order by p.full_name,p.user_id)
   from private.workspace_recruiters r join public.workspace_profiles p on p.user_id=r.user_id where p.status='active'),'[]'),
  'directors',coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member')) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.user_id=any(coalesce(private.workspace_recruitment_director_ids(),'{}'))),'[]'),
  'namedDirectors',coalesce((select jsonb_agg(d.user_id order by d.user_id) from private.workspace_recruitment_directors d),'[]'),
  -- Who admins can name as recruiters or directors, and who recruitment can link a hire to: the active team.
  'people',case when recruit or director then coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Team member'),'role',p.role) order by p.full_name,p.user_id)
   from public.workspace_profiles p where p.status='active' and p.role<>'client'),'[]') else '[]' end,
  'templates',case when recruit or director then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'jobKeys',to_jsonb(t.job_keys),'body',t.body,'blanks',to_jsonb(private.workspace_hiring_blanks(t.body)),
    'directorName',t.director_name,'directorSignature',t.director_signature,'directorSignedAt',t.director_signed_at,'active',t.active,'updatedAt',t.updated_at) order by t.active desc,t.title,t.id)
   from private.workspace_hiring_contract_templates t),'[]') else '[]' end,
  'vacancies',coalesce((select jsonb_agg(private.workspace_recruitment_vacancy(v,recruit) order by (v.status='requested') desc,(v.status='open') desc,v.requested_at desc,v.id)
   from private.workspace_recruitment_vacancies v where (recruit or v.requested_by=auth.uid() or admin or director)
    and (v.status in ('requested','open') or v.closed_at>now()-interval '180 days')),'[]'));
end $fn$;

-- 6. The actions.
create or replace function private.workspace_recruitment_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();req uuid;prior jsonb;result jsonb;recruit boolean;admin boolean;director boolean;s jsonb;x jsonb;job jsonb;
 v private.workspace_recruitment_vacancies;c private.workspace_recruitment_candidates;t private.workspace_hiring_contract_templates;k private.workspace_hiring_contracts;
 vid uuid;cid uuid;tid uuid;who uuid;prop uuid;day date;slot_at timestamptz;n integer;hired integer;txt text;doc text;blank text;manager uuid;item uuid;keys text[];begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if actor in ('client','cleans') then raise exception 'Recruitment is for the team' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','settings','recruiterIds','directorIds','vacancyId','candidateId','jobKey','area','positions','startBy','notes','reason','propertyId',
  'advert','postedTo','posted','fullName','email','phone','cvUrl','status','decision','note','userId','budgetMinor','budgetUnit','hours','earnings','questions','publish',
  'platforms','mode','place','minutes','slots','at','outcome','answer','templateId','title','jobKeys','body','active','directorName','directorSignature','fields','signedName'],330000);
 begin req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r2.result into prior from private.workspace_action_receipts r2 where r2.actor_id=me and r2.request_id=req;
 if prior is not null then return prior;end if;
 perform private.workspace_recruitment_expire();
 recruit:=private.workspace_can_recruit();admin:=actor in ('admin','super_admin');director:=private.workspace_recruitment_is_director();
 if input ? 'vacancyId' then
  begin vid:=(input->>'vacancyId')::uuid; exception when others then vid:=null; end;
  select * into v from private.workspace_recruitment_vacancies where id=vid for update;
  if v.id is null or not (recruit or admin or director or v.requested_by=me) then raise exception 'Vacancy not found' using errcode='P0002';end if;
 end if;
 if input ? 'candidateId' then
  begin cid:=(input->>'candidateId')::uuid; exception when others then cid:=null; end;
  select * into c from private.workspace_recruitment_candidates where id=cid and vacancy_id=v.id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  select * into k from private.workspace_hiring_contracts where candidate_id=c.id for update;
 end if;
 manager:=coalesce(v.requested_by,me);

 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings','recruiterIds','directorIds'],200000);
  if not admin then raise exception 'Only admins can change Recruitment' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Invalid settings' using errcode='22023';end if;
  perform private.workspace_json_keys(s,array['jobs'],200000);
  if jsonb_typeof(s->'jobs') is distinct from 'array' or jsonb_array_length(s->'jobs') not between 1 and 40 then raise exception 'Keep between 1 and 40 jobs' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(s->'jobs') loop
   perform private.workspace_json_keys(x,array['key','title','role','advert','hours','earnings','questions'],40000);
   if coalesce(x->>'key','')!~'^[a-z][a-z0-9_]{1,39}$' or jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 80
    or coalesce(x->>'role','') not in ('stays','cleans','cleaning_manager','ready','accounts','admin')
    or jsonb_typeof(x->'advert') is distinct from 'string' or char_length(x->>'advert')>5000 then raise exception 'Give every job a title, a role and an advert of up to 5,000 characters' using errcode='22023';end if;
   if jsonb_typeof(coalesce(x->'hours','""')) is distinct from 'string' or char_length(coalesce(x->>'hours',''))>200
    or jsonb_typeof(coalesce(x->'earnings','""')) is distinct from 'string' or char_length(coalesce(x->>'earnings',''))>200 then raise exception 'Keep the hours and earnings to 200 characters' using errcode='22023';end if;
   perform private.workspace_recruitment_check_questions(coalesce(x->'questions','[]'));
  end loop;
  if (select count(distinct z->>'key') from jsonb_array_elements(s->'jobs') z)<>jsonb_array_length(s->'jobs') then raise exception 'Invalid settings' using errcode='22023';end if;
  if jsonb_typeof(input->'recruiterIds') is distinct from 'array' or jsonb_array_length(input->'recruiterIds')>50
   or exists(select 1 from jsonb_array_elements(input->'recruiterIds') z where jsonb_typeof(z)<>'string' or z#>>'{}'!~'^[0-9a-fA-F-]{36}$'
    or not exists(select 1 from public.workspace_profiles p where p.user_id=(z#>>'{}')::uuid and p.status='active' and p.role not in ('client','cleans')))
   then raise exception 'Choose recruiters from the active team' using errcode='22023';end if;
  if input ? 'directorIds' and (jsonb_typeof(input->'directorIds') is distinct from 'array' or jsonb_array_length(input->'directorIds')>20
   or exists(select 1 from jsonb_array_elements(input->'directorIds') z where jsonb_typeof(z)<>'string' or z#>>'{}'!~'^[0-9a-fA-F-]{36}$'
    or not exists(select 1 from public.workspace_profiles p where p.user_id=(z#>>'{}')::uuid and p.status='active' and p.role in ('admin','super_admin'))))
   then raise exception 'Choose directors from the active admins' using errcode='22023';end if;
  insert into private.workspace_recruitment_settings(singleton,settings,updated_by,updated_at)
   values(true,jsonb_build_object('jobs',(select jsonb_agg(jsonb_build_object('key',z->>'key','title',btrim(z->>'title'),'role',z->>'role','advert',btrim(z->>'advert'),
     'hours',btrim(coalesce(z->>'hours','')),'earnings',btrim(coalesce(z->>'earnings','')),'questions',private.workspace_recruitment_clean_questions(coalesce(z->'questions','[]'))) order by o)
    from jsonb_array_elements(s->'jobs') with ordinality q(z,o))),me,now())
   on conflict (singleton) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  delete from private.workspace_recruiters where user_id::text not in (select lower(jsonb_array_elements_text(input->'recruiterIds')));
  insert into private.workspace_recruiters(user_id,added_by) select distinct lower(z)::uuid,me from jsonb_array_elements_text(input->'recruiterIds') z on conflict do nothing;
  if input ? 'directorIds' then
   delete from private.workspace_recruitment_directors where user_id::text not in (select lower(jsonb_array_elements_text(input->'directorIds')));
   insert into private.workspace_recruitment_directors(user_id,added_by) select distinct lower(z)::uuid,me from jsonb_array_elements_text(input->'directorIds') z on conflict do nothing;
  end if;

 elsif input->>'action'='requestRole' then
  -- A manager asks for a role (Launch Preparation's housekeeper step passes the property). It waits for the directors.
  perform private.workspace_json_keys(input,array['action','requestId','jobKey','area','positions','startBy','notes','reason','propertyId']);
  job:=(select z from jsonb_array_elements(private.workspace_recruitment_settings()->'jobs') z where z->>'key'=input->>'jobKey');
  if job is null then raise exception 'Choose the job' using errcode='22023';end if;
  if jsonb_typeof(input->'area') is distinct from 'string' or char_length(btrim(input->>'area')) not between 1 and 200 then raise exception 'Say which area the role covers' using errcode='22023';end if;
  if jsonb_typeof(input->'reason') is distinct from 'string' or char_length(btrim(input->>'reason')) not between 3 and 1000 then raise exception 'Say why the role is needed' using errcode='22023';end if;
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
  insert into private.workspace_recruitment_vacancies(job_key,title,role,area,positions,start_by,notes,reason,property_id,requested_by,advert,form_hours,form_earnings,form_questions,status)
   values(job->>'key',job->>'title',job->>'role',btrim(input->>'area'),(input->>'positions')::int,day,btrim(coalesce(input->>'notes','')),btrim(input->>'reason'),prop,me,coalesce(job->>'advert',''),
    coalesce(job->>'hours',''),coalesce(job->>'earnings',''),coalesce(job->'questions','[]'),'requested')
   returning * into v;
  perform private.workspace_recruitment_tell(private.workspace_recruitment_director_ids(),'recruitment.approval_needed',prop);

 elsif input->>'action'='decideRequest' then
  -- The directors approve the request with the maximum budget (recruitment is assigned) or turn it down.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','decision','budgetMinor','budgetUnit','note','userId']);
  if v.status<>'requested' then raise exception 'This request is already decided' using errcode='22023';end if;
  if not director then raise exception 'The directors approve requests for a role' using errcode='42501';end if;
  if coalesce(input->>'decision','') not in ('approve','reject') then raise exception 'Approve or turn down the request' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  if input->>'decision'='reject' then
   if btrim(coalesce(input->>'note',''))='' then raise exception 'Say why the request is turned down' using errcode='22023';end if;
   update private.workspace_recruitment_vacancies set status='rejected',closed_at=now(),closed_by=me,close_reason=btrim(input->>'note') where id=v.id;
   perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.rejected',v.property_id);
  else
   if jsonb_typeof(input->'budgetMinor') is distinct from 'number' or (input->>'budgetMinor')!~'^[0-9]+$' or (input->>'budgetMinor')::bigint not between 1 and 100000000 then raise exception 'Give the maximum budget for the role' using errcode='22023';end if;
   if coalesce(input->>'budgetUnit','') not in ('hour','job','week','month','year') then raise exception 'Say what the budget is per' using errcode='22023';end if;
   who:=null;
   if coalesce(input->>'userId','')<>'' then
    begin who:=(input->>'userId')::uuid; exception when others then who:=null; end;
    if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and (p.role in ('admin','super_admin') or exists(select 1 from private.workspace_recruiters r where r.user_id=who)))
     then raise exception 'Assign a recruiter or an admin' using errcode='22023';end if;
   end if;
   who:=coalesce(who,private.workspace_recruitment_pick_recruiter());
   update private.workspace_recruitment_vacancies set status='open',approved_at=now(),approved_by=me,budget_minor=(input->>'budgetMinor')::bigint,budget_unit=input->>'budgetUnit',
    assigned_to=who where id=v.id;
   perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.approved',v.property_id);
   perform private.workspace_recruitment_tell(case when who is null then private.workspace_recruitment_team() else array[who] end,'recruitment.requested',v.property_id);
  end if;

 elsif input->>'action'='assignVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','userId']);
  if v.status<>'open' or not (recruit or admin) then raise exception 'Recruitment assign the vacancy' using errcode='42501';end if;
  begin who:=(input->>'userId')::uuid; exception when others then who:=null; end;
  if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and (p.role in ('admin','super_admin') or exists(select 1 from private.workspace_recruiters r where r.user_id=who)))
   then raise exception 'Assign a recruiter or an admin' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set assigned_to=who where id=v.id;
  if who<>me then perform private.workspace_recruitment_tell(array[who],'recruitment.requested',v.property_id);end if;

 elsif input->>'action'='updateVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','area','positions','startBy','notes','reason']);
  if v.status not in ('requested','open') or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, change an open vacancy' using errcode='42501';end if;
  if jsonb_typeof(input->'area') is distinct from 'string' or char_length(btrim(input->>'area')) not between 1 and 200 then raise exception 'Say which area the role covers' using errcode='22023';end if;
  if jsonb_typeof(input->'positions') is distinct from 'number' or (input->>'positions')!~'^[0-9]+$' or (input->>'positions')::int not between 1 and 20 then raise exception 'Ask for between 1 and 20 people' using errcode='22023';end if;
  if (input->>'positions')::int<(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired') then raise exception 'More people are already hired than that' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'notes','""')) is distinct from 'string' or char_length(coalesce(input->>'notes',''))>2000 then raise exception 'Up to 2,000 characters of notes' using errcode='22023';end if;
  if input ? 'reason' and (jsonb_typeof(input->'reason') is distinct from 'string' or char_length(btrim(input->>'reason')) not between 3 and 1000) then raise exception 'Say why the role is needed' using errcode='22023';end if;
  day:=null;
  if coalesce(input->>'startBy','')<>'' then
   begin day:=(input->>'startBy')::date; exception when others then day:=null; end;
   if day is null then raise exception 'Choose a start date' using errcode='22023';end if;
  end if;
  update private.workspace_recruitment_vacancies set area=btrim(input->>'area'),positions=(input->>'positions')::int,start_by=day,notes=btrim(coalesce(input->>'notes','')),
   reason=case when input ? 'reason' then btrim(input->>'reason') else reason end where id=v.id;

 elsif input->>'action'='saveApplicationForm' then
  -- 1. Application form: the title is the job's; recruitment set the hours, expected earnings, the job description and the
  -- role-specific questions. Publishing it ticks the step (it goes on the careers page with the applicants' part).
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','hours','earnings','advert','questions','publish'],60000);
  if v.status<>'open' or not recruit then raise exception 'Recruitment write the application form' using errcode='42501';end if;
  if jsonb_typeof(input->'hours') is distinct from 'string' or char_length(btrim(input->>'hours')) not between 1 and 200 then raise exception 'Give the hours (up to 200 characters)' using errcode='22023';end if;
  if jsonb_typeof(input->'earnings') is distinct from 'string' or char_length(btrim(input->>'earnings')) not between 1 and 200 then raise exception 'Give the expected earnings (up to 200 characters)' using errcode='22023';end if;
  if jsonb_typeof(input->'advert') is distinct from 'string' or char_length(btrim(input->>'advert')) not between 20 and 5000 then raise exception 'Write the job description (20 to 5,000 characters)' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'publish','false')) is distinct from 'boolean' then raise exception 'Invalid request' using errcode='22023';end if;
  perform private.workspace_recruitment_check_questions(input->'questions');
  update private.workspace_recruitment_vacancies set form_hours=btrim(input->>'hours'),form_earnings=btrim(input->>'earnings'),advert=btrim(input->>'advert'),
   form_questions=private.workspace_recruitment_clean_questions(input->'questions'),
   form_published_at=case when coalesce((input->>'publish')::boolean,false) then coalesce(form_published_at,now()) else form_published_at end,
   form_published_by=case when coalesce((input->>'publish')::boolean,false) then coalesce(form_published_by,me) else form_published_by end,
   form_closed_at=case when coalesce((input->>'publish')::boolean,false) then null else form_closed_at end
   where id=v.id;

 elsif input->>'action'='withdrawForm' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment withdraw the application form' using errcode='42501';end if;
  if v.form_published_at is null then raise exception 'The application form is not published' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set form_closed_at=coalesce(form_closed_at,now()) where id=v.id;

 elsif input->>'action'='saveMarketing' then
  -- 2. Marketing: each platform is posted or not used. Once all four are decided (one posted at least) the step is ticked.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','platforms','postedTo']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment post the job' using errcode='42501';end if;
  if v.form_published_at is null then raise exception 'Publish the application form first: the posts link to it' using errcode='22023';end if;
  if jsonb_typeof(input->'platforms') is distinct from 'object' then raise exception 'Invalid request' using errcode='22023';end if;
  perform private.workspace_json_keys(input->'platforms',array['instagram','facebook','linkedin','indeed']);
  if exists(select 1 from jsonb_each(input->'platforms') e where jsonb_typeof(e.value)<>'string' or e.value#>>'{}' not in ('todo','posted','skipped')) then raise exception 'Invalid request' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'postedTo','""')) is distinct from 'string' or char_length(coalesce(input->>'postedTo',''))>1000 then raise exception 'Up to 1,000 characters on other places' using errcode='22023';end if;
  s:=(select jsonb_object_agg(e.key,e.value) from jsonb_each(input->'platforms') e where e.value#>>'{}'<>'todo');
  s:=coalesce(s,'{}');
  update private.workspace_recruitment_vacancies set platforms=s,posted_to=btrim(coalesce(input->>'postedTo','')) where id=v.id;
  if v.advertised_at is null and (select count(*) from jsonb_object_keys(s))=4 and exists(select 1 from jsonb_each_text(s) e where e.value='posted') then
   update private.workspace_recruitment_vacancies set advertised_at=now(),advertised_by=me where id=v.id;
   if v.requested_by is not null then perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.advertised',v.property_id);end if;
  end if;

 elsif input->>'action'='saveAdvert' then
  -- The advert and where it is posted; "posted" marks it as advertised (once). Kept for older apps.
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
  -- 3. Reviewing: recruitment shortlist, reject, put back or mark withdrawn. A hired candidate stays hired.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','status','note']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment shortlist the candidates' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if coalesce(input->>'status','') not in ('new','shortlisted','rejected','withdrawn') then raise exception 'Invalid request' using errcode='22023';end if;
  if c.status='hired' then raise exception 'This candidate is already hired' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status=input->>'status',decision_note=btrim(coalesce(input->>'note','')),decided_by=me,decided_at=now() where id=c.id;

 elsif input->>'action'='deleteCandidate' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId']);
  if not recruit then raise exception 'Recruitment remove candidates' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status='hired' then raise exception 'A hired candidate stays on record' using errcode='22023';end if;
  if c.interview_todo_id is not null then update private.workspace_hub_items set status='done',updated_at=now() where id=c.interview_todo_id and status='open';end if;
  delete from private.workspace_recruitment_candidates where id=c.id;

 elsif input->>'action'='shareShortlist' then
  -- Sharing the shortlist ticks Reviewing and withdraws the application form.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment share the shortlist' using errcode='42501';end if;
  if not exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='shortlisted') then raise exception 'Shortlist at least one candidate first' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set shortlist_shared_at=now(),form_closed_at=case when form_published_at is null then form_closed_at else coalesce(form_closed_at,now()) end where id=v.id;
  perform private.workspace_recruitment_tell(array[coalesce(v.requested_by,me)],'recruitment.shortlist_ready',v.property_id);

 elsif input->>'action'='setInterviews' then
  -- 4. Interviews: the manager says virtual or in person, where, how long, and the times they are free.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','mode','place','minutes','slots']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager who asked sets the interviews' using errcode='42501';end if;
  if coalesce(input->>'mode','') not in ('virtual','in_person') then raise exception 'Choose virtual or in person' using errcode='22023';end if;
  if jsonb_typeof(input->'place') is distinct from 'string' or char_length(btrim(input->>'place')) not between 2 and 500 then raise exception 'Give the meeting link or the address' using errcode='22023';end if;
  if jsonb_typeof(input->'minutes') is distinct from 'number' or (input->>'minutes')!~'^[0-9]+$' or (input->>'minutes')::int not between 10 and 240 then raise exception 'Interviews last 10 to 240 minutes' using errcode='22023';end if;
  if jsonb_typeof(input->'slots') is distinct from 'array' or jsonb_array_length(input->'slots') not between 1 and 30 then raise exception 'Give between 1 and 30 times you are free' using errcode='22023';end if;
  for x in select * from jsonb_array_elements(input->'slots') loop
   begin slot_at:=(x#>>'{}')::timestamptz; exception when others then slot_at:=null; end;
   if jsonb_typeof(x)<>'string' or slot_at is null then raise exception 'Check the interview times' using errcode='22023';end if;
  end loop;
  -- Times already booked stay offered.
  s:=(select coalesce(jsonb_agg(to_jsonb(z) order by z),'[]') from (select distinct (e#>>'{}')::timestamptz z from jsonb_array_elements(input->'slots') e
   union select c2.interview_at from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.interview_status='booked' and c2.interview_at is not null) q);
  if jsonb_array_length(s)>30 then raise exception 'Give between 1 and 30 times you are free' using errcode='22023';end if;
  if not exists(select 1 from jsonb_array_elements_text(s) e where e::timestamptz>now()) then raise exception 'Give at least one time from now on' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set interview_mode=input->>'mode',interview_place=btrim(input->>'place'),interview_minutes=(input->>'minutes')::int,interview_slots=s where id=v.id;

 elsif input->>'action'='inviteToInterview' then
  -- The manager (or recruitment) invites a shortlisted candidate. The invite expires after 3 days unanswered.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager who asked invites to interview' using errcode='42501';end if;
  if c.status not in ('shortlisted','selected') then raise exception 'Invite from the shortlist' using errcode='22023';end if;
  if v.interview_mode is null or not exists(select 1 from jsonb_array_elements_text(v.interview_slots) e where e::timestamptz>now()) then raise exception 'Say how and when you can interview first' using errcode='22023';end if;
  if c.interview_status in ('invited','booked') then raise exception 'They are already invited' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set interview_status='invited',interview_invited_at=now(),interview_expires_at=now()+interval '3 days',interview_at=null where id=c.id;

 elsif input->>'action'='bookInterview' then
  -- The candidate's chosen time (recorded for them by the manager or recruitment). It goes on the manager's to-do.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','at']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager or recruitment book the interview' using errcode='42501';end if;
  begin slot_at:=(input->>'at')::timestamptz; exception when others then slot_at:=null; end;
  perform private.workspace_recruitment_book(c.id,slot_at);

 elsif input->>'action'='declineInterview' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','note']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager or recruitment record this' using errcode='42501';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' then raise exception 'Invalid request' using errcode='22023';end if;
  perform private.workspace_recruitment_decline_interview(c.id,coalesce(input->>'note',''));

 elsif input->>'action'='interviewOutcome' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','outcome','note']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager or recruitment record the interview' using errcode='42501';end if;
  if c.interview_status not in ('booked','done','no_show') then raise exception 'Book the interview first' using errcode='22023';end if;
  if coalesce(input->>'outcome','') not in ('done','no_show') then raise exception 'Say whether the interview happened' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>2000 then raise exception 'Up to 2,000 characters of notes' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set interview_status=input->>'outcome',interview_note=btrim(coalesce(input->>'note','')) where id=c.id;
  if c.interview_todo_id is not null then update private.workspace_hub_items set status='done',updated_at=now() where id=c.interview_todo_id and status='open';end if;

 elsif input->>'action'='finishInterviews' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'The manager or recruitment tick the interviews' using errcode='42501';end if;
  if not exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.interview_status='done') then raise exception 'Record at least one interview first' using errcode='22023';end if;
  if exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.interview_status='booked') then raise exception 'Record how the booked interviews went first' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set interviews_done_at=coalesce(interviews_done_at,now()) where id=v.id;

 elsif input->>'action'='chooseCandidate' then
  -- 5. Job offer: the manager who asked (or an admin) selects who to offer the job (and phones them), or turns one down.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','decision','note']);
  if v.status<>'open' or not (admin or v.requested_by=me) then raise exception 'The manager who asked for the role chooses' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status not in ('shortlisted','selected','declined') then raise exception 'Choose from the shortlist' using errcode='22023';end if;
  if coalesce(input->>'decision','') not in ('select','decline') then raise exception 'Select or turn down the candidate' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' or char_length(coalesce(input->>'note',''))>1000 then raise exception 'Up to 1,000 characters' using errcode='22023';end if;
  if input->>'decision'='decline' and btrim(coalesce(input->>'note',''))='' then raise exception 'Say why they are not right for the role' using errcode='22023';end if;
  if input->>'decision'='decline' and k.signed_at is not null then raise exception 'They have signed their contract' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status=case when input->>'decision'='select' then 'selected' else 'declined' end,
   decision_note=btrim(coalesce(input->>'note','')),decided_by=me,decided_at=now(),
   offer_status=case when input->>'decision'='select' then coalesce(offer_status,'offered') else null end,
   offered_at=case when input->>'decision'='select' then coalesce(offered_at,now()) else null end,
   offer_answered_at=case when input->>'decision'='select' then offer_answered_at else null end where id=c.id;
  if input->>'decision'='decline' and k.id is not null then delete from private.workspace_hiring_contracts where id=k.id;end if;
  if input->>'decision'='select' then perform private.workspace_recruitment_tell(private.workspace_recruitment_team(),'recruitment.candidate_selected',v.property_id);end if;

 elsif input->>'action'='answerOffer' then
  -- The candidate's answer to the offer (recorded for them by recruitment or the manager).
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','answer','note']);
  if v.status<>'open' or not (admin or recruit or v.requested_by=me) then raise exception 'Recruitment or the manager record the answer' using errcode='42501';end if;
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' then raise exception 'Invalid request' using errcode='22023';end if;
  perform private.workspace_recruitment_answer_offer(c.id,coalesce(input->>'answer',''),coalesce(input->>'note',''));

 elsif input->>'action'='saveContractTemplate' then
  -- Contract templates: recruitment or admins write them; a director's drawn signature pre-signs one.
  perform private.workspace_json_keys(input,array['action','requestId','templateId','title','jobKeys','body','active','directorName','directorSignature'],330000);
  if not (recruit or admin or director) then raise exception 'Recruitment write the contract templates' using errcode='42501';end if;
  if input ? 'templateId' then
   begin tid:=(input->>'templateId')::uuid; exception when others then tid:=null; end;
   select * into t from private.workspace_hiring_contract_templates where id=tid for update;
   if t.id is null then raise exception 'Template not found' using errcode='P0002';end if;
  end if;
  if jsonb_typeof(input->'title') is distinct from 'string' or char_length(btrim(input->>'title')) not between 2 and 200 then raise exception 'Give the template a title' using errcode='22023';end if;
  if jsonb_typeof(input->'body') is distinct from 'string' or char_length(btrim(input->>'body')) not between 20 and 100000 then raise exception 'Write the contract (20 to 100,000 characters)' using errcode='22023';end if;
  if jsonb_typeof(input->'jobKeys') is distinct from 'array' or jsonb_array_length(input->'jobKeys')>40
   or exists(select 1 from jsonb_array_elements(input->'jobKeys') z where jsonb_typeof(z)<>'string' or z#>>'{}'!~'^[a-z][a-z0-9_]{1,39}$') then raise exception 'Choose the jobs it is for' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'active','true')) is distinct from 'boolean' then raise exception 'Invalid request' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'directorName','""')) is distinct from 'string' or char_length(coalesce(input->>'directorName',''))>200 then raise exception 'Up to 200 characters for the director''s name' using errcode='22023';end if;
  if input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then
   if not director then raise exception 'A director signs the template' using errcode='42501';end if;
   if not private.workspace_hiring_valid_png(input->>'directorSignature') then raise exception 'Draw the signature again' using errcode='22023';end if;
   if char_length(btrim(coalesce(input->>'directorName','')))<2 then raise exception 'Give the director''s name under the signature' using errcode='22023';end if;
  end if;
  keys:=array(select distinct z from jsonb_array_elements_text(input->'jobKeys') z order by z);
  if t.id is null then
   insert into private.workspace_hiring_contract_templates(title,job_keys,body,director_name,director_signature,director_signed_by,director_signed_at,active,updated_by)
    values(btrim(input->>'title'),keys,btrim(input->>'body'),btrim(coalesce(input->>'directorName','')),
     case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then input->>'directorSignature' end,
     case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then me end,
     case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then now() end,coalesce((input->>'active')::boolean,true),me);
  else
   -- A new signature replaces the old one; changing the wording without signing again removes it.
   update private.workspace_hiring_contract_templates set title=btrim(input->>'title'),job_keys=keys,body=btrim(input->>'body'),active=coalesce((input->>'active')::boolean,true),updated_by=me,updated_at=now(),
    director_name=btrim(coalesce(input->>'directorName','')),
    director_signature=case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then input->>'directorSignature'
     when input->'directorSignature'='null'::jsonb or body<>btrim(input->>'body') then null else director_signature end,
    director_signed_by=case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then me
     when input->'directorSignature'='null'::jsonb or body<>btrim(input->>'body') then null else director_signed_by end,
    director_signed_at=case when input ? 'directorSignature' and input->'directorSignature'<>'null'::jsonb then now()
     when input->'directorSignature'='null'::jsonb or body<>btrim(input->>'body') then null else director_signed_at end
    where id=t.id;
  end if;

 elsif input->>'action'='deleteContractTemplate' then
  perform private.workspace_json_keys(input,array['action','requestId','templateId']);
  if not (recruit or admin) then raise exception 'Recruitment remove contract templates' using errcode='42501';end if;
  begin tid:=(input->>'templateId')::uuid; exception when others then tid:=null; end;
  delete from private.workspace_hiring_contract_templates where id=tid;
  if not found then raise exception 'Template not found' using errcode='P0002';end if;

 elsif input->>'action'='issueContract' then
  -- 6. Contract: recruitment choose the role's template and fill its blanks; the candidate's copy keeps the wording.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','templateId','fields'],120000);
  if v.status<>'open' or not recruit then raise exception 'Recruitment create the contract' using errcode='42501';end if;
  if c.offer_status is distinct from 'accepted' then raise exception 'They accept the job offer first' using errcode='22023';end if;
  if k.signed_at is not null then raise exception 'They have already signed their contract' using errcode='22023';end if;
  begin tid:=(input->>'templateId')::uuid; exception when others then tid:=null; end;
  select * into t from private.workspace_hiring_contract_templates where id=tid and active;
  if t.id is null then raise exception 'Choose a contract template' using errcode='P0002';end if;
  if t.director_signature is null then raise exception 'A director signs this template first' using errcode='22023';end if;
  if jsonb_typeof(input->'fields') is distinct from 'object' then raise exception 'Fill in the blanks' using errcode='22023';end if;
  doc:=t.body;
  foreach blank in array private.workspace_hiring_blanks(t.body) loop
   if jsonb_typeof(input->'fields'->blank) is distinct from 'string' or char_length(btrim(input->'fields'->>blank)) not between 1 and 500 then
    raise exception 'Fill in %',replace(blank,'_',' ') using errcode='22023';end if;
   doc:=replace(doc,'{{'||blank||'}}',btrim(input->'fields'->>blank));
  end loop;
  if exists(select 1 from jsonb_object_keys(input->'fields') f where not f=any(private.workspace_hiring_blanks(t.body))) then raise exception 'Invalid request' using errcode='22023';end if;
  delete from private.workspace_hiring_contracts where candidate_id=c.id;
  insert into private.workspace_hiring_contracts(candidate_id,template_id,title,body,fields,director_name,director_signature,issued_by)
   values(c.id,t.id,t.title,doc,(select coalesce(jsonb_object_agg(f,btrim(input->'fields'->>f)),'{}') from unnest(private.workspace_hiring_blanks(t.body)) f),t.director_name,t.director_signature,me);

 elsif input->>'action'='withdrawContract' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment withdraw the contract' using errcode='42501';end if;
  if k.id is null then raise exception 'No contract to withdraw' using errcode='P0002';end if;
  if k.signed_at is not null then raise exception 'A signed contract stays on record' using errcode='22023';end if;
  delete from private.workspace_hiring_contracts where id=k.id;

 elsif input->>'action'='recordContractSigned' then
  -- A contract the candidate signed on paper (applicants sign in the app once they have their own accounts).
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','signedName']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment record the signed contract' using errcode='42501';end if;
  if k.id is null then raise exception 'Create the contract first' using errcode='P0002';end if;
  if k.signed_at is not null then raise exception 'It is already signed' using errcode='22023';end if;
  if jsonb_typeof(input->'signedName') is distinct from 'string' or char_length(btrim(input->>'signedName')) not between 2 and 200 then raise exception 'Give the name they signed with' using errcode='22023';end if;
  update private.workspace_hiring_contracts set signed_name=btrim(input->>'signedName'),signed_at=now(),signed_how='paper',recorded_by=me where id=k.id;
  perform private.workspace_recruitment_tell(private.workspace_recruitment_team()||array[manager],'recruitment.contract_signed',v.property_id);

 elsif input->>'action'='hireCandidate' then
  -- 7. Onboarding: their account (made in Access control) is linked here. An offer made must be accepted and a contract
  -- created must be signed first.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','userId']);
  if v.status<>'open' or not recruit then raise exception 'Recruitment onboard the new starter' using errcode='42501';end if;
  if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
  if c.status<>'selected' then raise exception 'The manager selects the candidate first' using errcode='22023';end if;
  if c.offer_status is not null and c.offer_status<>'accepted' then raise exception 'They accept the job offer first' using errcode='22023';end if;
  if k.id is not null and k.signed_at is null then raise exception 'They sign their contract first' using errcode='22023';end if;
  begin who:=(input->>'userId')::uuid; exception when others then who:=null; end;
  if not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.status='active' and p.role<>'client') then raise exception 'Choose their team account' using errcode='22023';end if;
  if exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.hired_user_id=who) then raise exception 'That account is already hired for this vacancy' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set status='hired',hired_user_id=who,hired_at=now() where id=c.id;
  hired:=(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired');
  if hired>=v.positions then
   update private.workspace_recruitment_vacancies set status='filled',closed_at=now(),closed_by=me,close_reason='',form_closed_at=case when form_published_at is null then form_closed_at else coalesce(form_closed_at,now()) end where id=v.id;
  end if;
  perform private.workspace_recruitment_tell(array[v.requested_by],'recruitment.hired',v.property_id);

 elsif input->>'action'='cancelVacancy' then
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId','reason']);
  if v.status not in ('requested','open') or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, close the vacancy' using errcode='42501';end if;
  if jsonb_typeof(input->'reason') is distinct from 'string' or char_length(btrim(input->>'reason')) not between 1 and 1000 then raise exception 'Say why the vacancy is closed' using errcode='22023';end if;
  update private.workspace_recruitment_vacancies set status='cancelled',closed_at=now(),closed_by=me,close_reason=btrim(input->>'reason'),
   form_closed_at=case when form_published_at is null then form_closed_at else coalesce(form_closed_at,now()) end where id=v.id;
  update private.workspace_hub_items h set status='done',updated_at=now() from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and h.id=c2.interview_todo_id and h.status='open';
  perform private.workspace_recruitment_tell(case when v.requested_by=me then coalesce(private.workspace_recruitment_team(),'{}')||coalesce(case when v.assigned_to is null then null else array[v.assigned_to] end,'{}') else array[v.requested_by] end,'recruitment.closed',v.property_id);

 elsif input->>'action'='reopenVacancy' then
  -- A filled or closed vacancy opens again (one that was approved before) or goes back to the directors.
  perform private.workspace_json_keys(input,array['action','requestId','vacancyId']);
  if v.status not in ('filled','cancelled') or not (recruit or v.requested_by=me) then raise exception 'Only the manager who asked, or recruitment, reopen the vacancy' using errcode='42501';end if;
  if v.status='filled' then
   update private.workspace_recruitment_vacancies set status='open',closed_at=null,closed_by=null,close_reason='',
    positions=greatest(positions,(select count(*) from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.status='hired')::int+1) where id=v.id;
  elsif v.approved_at is null and v.advertised_at is null and not exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id) and v.reason<>'' then
   update private.workspace_recruitment_vacancies set status='requested',closed_at=null,closed_by=null,close_reason='' where id=v.id;
   perform private.workspace_recruitment_tell(private.workspace_recruitment_director_ids(),'recruitment.approval_needed',v.property_id);
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
revoke all on function private.workspace_recruitment_settings_default(),private.workspace_recruitment_director_ids(),private.workspace_recruitment_is_director(),
 private.workspace_recruitment_pick_recruiter(),private.workspace_recruitment_expire(),private.workspace_hiring_blanks(text),private.workspace_hiring_valid_png(text),
 private.workspace_recruitment_check_questions(jsonb),private.workspace_recruitment_clean_questions(jsonb),private.workspace_recruitment_candidate_more(uuid,boolean),private.workspace_recruitment_book(uuid,timestamptz),
 private.workspace_recruitment_decline_interview(uuid,text),private.workspace_recruitment_answer_offer(uuid,text,text),
 private.workspace_recruitment_vacancy(private.workspace_recruitment_vacancies,boolean),private.workspace_recruitment_read(),private.workspace_recruitment_action(jsonb),
 public.workspace_recruitment_read(),public.workspace_recruitment_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_recruitment_read(),public.workspace_recruitment_read(),private.workspace_recruitment_action(jsonb),public.workspace_recruitment_action(jsonb) to authenticated;
