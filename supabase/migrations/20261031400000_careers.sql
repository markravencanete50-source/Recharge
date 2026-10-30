-- Careers and applicants (Business Plan v2, "Hiring & Training Processes", parts 1 to 6 from the applicant's side), on the
-- hiring process (20261031300000).
--  * The careers page lists every vacancy whose application form is published (and not withdrawn). Anyone applies with
--    their name, email, phone, CV (PDF or Word, kept privately) and the role-specific answers, and can tick to be
--    considered for other roles. One application per email per vacancy. Recruitment hear about each one.
--  * Emails from careers@ go out for: application received (we aim to respond within 14 working days, with a link to
--    create an account), shortlisted, invited to interview, offered the job, contract to sign, and a message from
--    recruitment. They are queued here and sent by the server (workspace_careers_public emailClaim and emailDone).
--  * The applicant's account is limited: it sees only their applications (status, interview times to choose from or
--    decline within 3 days, the offer to accept or turn down, the contract to sign with a drawn signature) and messages
--    with recruitment. An applicant's sign-in is kept out of the access requests until they are chosen for a job.
-- New tables and functions; replaces private.workspace_recruitment_candidate_more (20261031300000),
-- private.workspace_recruitment_tell (20261029600000); patches private.workspace_enforce_write_limit and
-- private.workspace_access_control_read in place. Safe to run twice.

-- 1. CVs, in a private bucket only the server reads and writes.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('careers-files','careers-files',false,10485760,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- 2. Applicants, their applications, messages and the careers emails.
create table if not exists private.workspace_applicants (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null unique check (char_length(email) between 3 and 320),
 created_at timestamptz not null default now()
);
alter table private.workspace_recruitment_candidates
 add column if not exists cv_path text check (cv_path is null or char_length(cv_path) between 10 and 300),
 add column if not exists cv_name text not null default '' check (char_length(cv_name)<=200),
 add column if not exists cv_mime text check (cv_mime is null or cv_mime in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 add column if not exists cv_bytes integer check (cv_bytes is null or cv_bytes between 1 and 10485760),
 add column if not exists applied_at timestamptz,
 add column if not exists account_token_hash text check (account_token_hash is null or account_token_hash~'^[0-9a-f]{64}$'),
 add column if not exists account_token_expires timestamptz;
create unique index if not exists workspace_recruitment_candidates_one_application on private.workspace_recruitment_candidates(vacancy_id,lower(email)) where source='careers';
create index if not exists workspace_recruitment_candidates_applicant on private.workspace_recruitment_candidates(applicant_id) where applicant_id is not null;
create index if not exists workspace_recruitment_candidates_token on private.workspace_recruitment_candidates(account_token_hash) where account_token_hash is not null;

create table if not exists private.workspace_recruitment_messages (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references private.workspace_recruitment_candidates(id) on delete cascade,
 author_id uuid references auth.users(id) on delete set null,
 from_applicant boolean not null,
 body text not null check (char_length(btrim(body)) between 1 and 4000),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 unique (author_id,request_id)
);
create index if not exists workspace_recruitment_messages_candidate on private.workspace_recruitment_messages(candidate_id,created_at);

create table if not exists private.workspace_careers_emails (
 id uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references private.workspace_recruitment_candidates(id) on delete cascade,
 kind text not null check (kind in ('received','shortlisted','interview','offer','contract','message')),
 status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 error text not null default '' check (char_length(error)<=300)
);
create index if not exists workspace_careers_emails_pending on private.workspace_careers_emails(created_at) where status in ('pending','sending','failed');
alter table private.workspace_applicants enable row level security;
alter table private.workspace_recruitment_messages enable row level security;
alter table private.workspace_careers_emails enable row level security;
revoke all on private.workspace_applicants,private.workspace_recruitment_messages,private.workspace_careers_emails from public,anon,authenticated,service_role;

-- Recruitment's notices, as before (20261029600000), but also from the public careers page, where nobody is signed in
-- ("u<>auth.uid()" was never true there, so a new application told nobody).
create or replace function private.workspace_recruitment_tell(who uuid[],event text,prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare ev bigint;begin
 if coalesce(array_length(who,1),0)=0 then return;end if;
 insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(auth.uid(),prop,event,now()) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(who) u where u is not null and u is distinct from auth.uid() on conflict do nothing;
end $fn$;

-- The write limit on shared tables (20261005065933, patched since), unchanged except that an applicant's own steps also
-- pass (booking an interview puts it on the manager's to-do, and each step keeps a receipt). They have no direct grants,
-- so those steps only come through private.workspace_applicant_action; the same 60 changes a minute apply. Patched in
-- place, once, so the later changes to it are kept.
do $$ declare d text; begin
 d:=pg_get_functiondef('private.workspace_enforce_write_limit()'::regprocedure);
 if position('/* applicants: 20261031400000 */' in d)=0 then
  d:=replace(d,'if private.workspace_actor_role() is null then raise exception ''Active workspace access required''',
   '/* applicants: 20261031400000 */ if private.workspace_actor_role() is null and not exists(select 1 from private.workspace_applicants a where a.user_id=auth.uid()) then raise exception ''Active workspace access required''');
  if position('/* applicants: 20261031400000 */' in d)=0 then raise exception 'The write limit has changed; the careers patch needs updating';end if;
  execute d;
 end if;
end $$;

-- 3. The emails follow what happens to a candidate with an email address (one of each kind waiting at a time).
create or replace function private.workspace_careers_queue(cand uuid,what text) returns void language sql security definer set search_path='' as $fn$
 insert into private.workspace_careers_emails(candidate_id,kind)
 select c.id,what from private.workspace_recruitment_candidates c where c.id=cand and c.email<>''
  and not exists(select 1 from private.workspace_careers_emails e where e.candidate_id=c.id and e.kind=what and e.status in ('pending','sending'))
$fn$;
create or replace function private.workspace_careers_candidate_emails() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.status='shortlisted' and old.status is distinct from 'shortlisted' and old.status not in ('selected','declined') then perform private.workspace_careers_queue(new.id,'shortlisted');end if;
 if new.interview_status='invited' and (old.interview_status is distinct from 'invited' or old.interview_invited_at is distinct from new.interview_invited_at) then perform private.workspace_careers_queue(new.id,'interview');end if;
 if new.offer_status='offered' and old.offer_status is distinct from 'offered' then perform private.workspace_careers_queue(new.id,'offer');end if;
 return new;
end $fn$;
drop trigger if exists workspace_careers_candidate_emails on private.workspace_recruitment_candidates;
create trigger workspace_careers_candidate_emails after update on private.workspace_recruitment_candidates for each row execute function private.workspace_careers_candidate_emails();
create or replace function private.workspace_careers_contract_emails() returns trigger language plpgsql security definer set search_path='' as $fn$
begin perform private.workspace_careers_queue(new.candidate_id,'contract'); return new; end $fn$;
drop trigger if exists workspace_careers_contract_emails on private.workspace_hiring_contracts;
create trigger workspace_careers_contract_emails after insert on private.workspace_hiring_contracts for each row execute function private.workspace_careers_contract_emails();

-- 4. What recruitment see of the applicant's side: the CV file, whether they have an account, and the messages.
create or replace function private.workspace_recruitment_candidate_more(candidate uuid,recruit boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('cvFile',case when c.cv_path is null then null else jsonb_build_object('name',c.cv_name,'mime',c.cv_mime,'bytes',c.cv_bytes) end,
  'appliedAt',c.applied_at,'hasAccount',c.applicant_id is not null,
  'messages',case when recruit then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'fromApplicant',m.from_applicant,'body',m.body,'at',m.created_at,
    'authorName',case when m.from_applicant then c.full_name else coalesce(private.workspace_recruitment_person(m.author_id),'Recruitment') end) order by m.created_at,m.id)
   from private.workspace_recruitment_messages m where m.candidate_id=c.id),'[]') else '[]' end)
 from private.workspace_recruitment_candidates c where c.id=candidate
$fn$;

-- 5. The public side, for the server only (the service role): the careers page, applying, the account link and the emails.
create or replace function private.workspace_careers_listing(v private.workspace_recruitment_vacancies) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',v.id,'title',v.title,'area',v.area,'hours',v.form_hours,'earnings',v.form_earnings,'description',v.advert,'questions',v.form_questions,
  'startBy',v.start_by,'positions',v.positions,'publishedAt',v.form_published_at)
$fn$;
create or replace function private.workspace_careers_public(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v private.workspace_recruitment_vacancies;c private.workspace_recruitment_candidates;vid uuid;cid uuid;who uuid;q jsonb;ans jsonb;txt text;mail text;n integer;out jsonb;begin
 perform private.workspace_json_keys(input,array['action','vacancyId','fullName','email','phone','answers','otherRoles','cv','tokenHash','tokenExpires','userId','id','ok','error'],60000);
 if input->>'action' in ('form','apply') then
  begin vid:=(input->>'vacancyId')::uuid; exception when others then vid:=null; end;
  select * into v from private.workspace_recruitment_vacancies where id=vid;
  if v.id is null or v.status<>'open' or v.form_published_at is null or v.form_closed_at is not null then raise exception 'This job is no longer taking applications' using errcode='P0002';end if;
 end if;

 if input->>'action'='list' then
  return coalesce((select jsonb_agg(private.workspace_careers_listing(x) order by x.form_published_at desc,x.id) from private.workspace_recruitment_vacancies x
   where x.status='open' and x.form_published_at is not null and x.form_closed_at is null),'[]');

 elsif input->>'action'='form' then
  return private.workspace_careers_listing(v);

 elsif input->>'action'='apply' then
  if jsonb_typeof(input->'fullName') is distinct from 'string' or char_length(btrim(input->>'fullName')) not between 2 and 200 then raise exception 'Give your full name' using errcode='22023';end if;
  mail:=lower(btrim(coalesce(input->>'email','')));
  if char_length(mail)>320 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Check your email address' using errcode='22023';end if;
  if jsonb_typeof(input->'phone') is distinct from 'string' or char_length(btrim(input->>'phone')) not between 6 and 40 then raise exception 'Give your phone number' using errcode='22023';end if;
  if jsonb_typeof(coalesce(input->'otherRoles','false')) is distinct from 'boolean' then raise exception 'Invalid request' using errcode='22023';end if;
  if input->>'tokenHash'!~'^[0-9a-f]{64}$' then raise exception 'Invalid request' using errcode='22023';end if;
  -- The CV the server stored (checked from its bytes) under this vacancy's folder.
  if jsonb_typeof(input->'cv') is distinct from 'object' then raise exception 'Add your CV' using errcode='22023';end if;
  perform private.workspace_json_keys(input->'cv',array['path','name','mime','bytes']);
  if coalesce(input->'cv'->>'path','')!~('^applications/'||v.id::text||'/[0-9a-f-]{36}\.(pdf|doc|docx)$') or coalesce(input->'cv'->>'mime','') not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
   or jsonb_typeof(input->'cv'->'bytes') is distinct from 'number' or (input->'cv'->>'bytes')::numeric not between 1 and 10485760 or char_length(coalesce(input->'cv'->>'name',''))>200 then raise exception 'Add your CV' using errcode='22023';end if;
  -- The answers: each question once, required ones answered.
  if jsonb_typeof(coalesce(input->'answers','{}')) is distinct from 'object' then raise exception 'Invalid request' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(coalesce(input->'answers','{}')) k where not exists(select 1 from jsonb_array_elements(v.form_questions) x where x->>'id'=k)) then raise exception 'Invalid request' using errcode='22023';end if;
  ans:='[]';
  for q in select * from jsonb_array_elements(v.form_questions) loop
   txt:=btrim(coalesce(input->'answers'->>(q->>'id'),''));
   if jsonb_typeof(coalesce(input->'answers'->(q->>'id'),'""')) is distinct from 'string' or char_length(txt)>3000 then raise exception 'Keep each answer to 3,000 characters' using errcode='22023';end if;
   if txt='' and (q->>'required')::boolean then raise exception 'Answer: %',q->>'label' using errcode='22023';end if;
   if q->>'kind'='yes_no' and txt<>'' and txt not in ('Yes','No') then raise exception 'Answer yes or no: %',q->>'label' using errcode='22023';end if;
   if q->>'kind'='number' and txt<>'' and txt!~'^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Answer with a number: %',q->>'label' using errcode='22023';end if;
   if txt<>'' then ans:=ans||jsonb_build_array(jsonb_build_object('id',q->>'id','label',q->>'label','answer',txt));end if;
  end loop;
  if exists(select 1 from private.workspace_recruitment_candidates x where x.vacancy_id=v.id and lower(x.email)=mail and x.source='careers') then raise exception 'You have already applied for this job' using errcode='22023';end if;
  if (select count(*) from private.workspace_recruitment_candidates x where x.vacancy_id=v.id)>=500 then raise exception 'This job is no longer taking applications' using errcode='22023';end if;
  insert into private.workspace_recruitment_candidates(vacancy_id,full_name,email,phone,source,answers,other_roles,cv_path,cv_name,cv_mime,cv_bytes,applied_at,account_token_hash,account_token_expires,applicant_id)
   values(v.id,btrim(input->>'fullName'),mail,btrim(input->>'phone'),'careers',ans,coalesce((input->>'otherRoles')::boolean,false),input->'cv'->>'path',coalesce(nullif(btrim(input->'cv'->>'name'),''),'CV'),
    input->'cv'->>'mime',(input->'cv'->>'bytes')::int,now(),input->>'tokenHash',now()+interval '30 days',(select a.user_id from private.workspace_applicants a where a.email=mail))
   returning * into c;
  perform private.workspace_careers_queue(c.id,'received');
  perform private.workspace_recruitment_tell(case when v.assigned_to is null then private.workspace_recruitment_team() else array[v.assigned_to] end,'recruitment.applied',v.property_id);
  return jsonb_build_object('candidateId',c.id,'title',v.title);

 elsif input->>'action'='claimAccount' then
  -- The link in the "received" email: whose account it makes (good for 30 days).
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
  select * into c from private.workspace_recruitment_candidates where account_token_hash=input->>'tokenHash';
  if c.id is null or c.account_token_expires<now() then raise exception 'This link has expired. Reply to our email and we will send a new one.' using errcode='P0002';end if;
  return jsonb_build_object('email',c.email,'name',c.full_name,'userId',coalesce(c.applicant_id,(select a.user_id from private.workspace_applicants a where a.email=c.email),(select u.id from auth.users u where lower(u.email)=c.email limit 1)),
   'linked',c.applicant_id is not null);

 elsif input->>'action'='linkApplicant' then
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
  select * into c from private.workspace_recruitment_candidates where account_token_hash=input->>'tokenHash';
  if c.id is null or c.account_token_expires<now() then raise exception 'This link has expired. Reply to our email and we will send a new one.' using errcode='P0002';end if;
  begin who:=(input->>'userId')::uuid; exception when others then who:=null; end;
  if who is null or not exists(select 1 from auth.users u where u.id=who and lower(u.email)=c.email) then raise exception 'Invalid request' using errcode='22023';end if;
  insert into private.workspace_applicants(user_id,email) values(who,c.email) on conflict do nothing;
  update private.workspace_recruitment_candidates set applicant_id=who where lower(email)=c.email and applicant_id is null;
  return jsonb_build_object('ok',true);

 elsif input->>'action'='emailClaim' then
  -- Up to 20 emails to send now (a claim not finished in 10 minutes, or a failure, is tried again, three times at most).
  update private.workspace_careers_emails set status='pending' where status='sending' and claimed_at<now()-interval '10 minutes';
  with picked as (select e.id from private.workspace_careers_emails e where (e.status='pending' or (e.status='failed' and e.attempts<3 and e.claimed_at<now()-interval '5 minutes'))
    order by e.created_at limit 20 for update skip locked),
  claimed as (update private.workspace_careers_emails e set status='sending',claimed_at=now(),attempts=e.attempts+1 from picked where e.id=picked.id returning e.id,e.kind,e.candidate_id,e.created_at)
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'to',c2.email,'name',c2.full_name,'title',v2.title,'candidateId',c2.id,'hasAccount',c2.applicant_id is not null,
    'interviewExpiresAt',c2.interview_expires_at,'interviewMode',v2.interview_mode) order by e.created_at),'[]') into out
   from claimed e join private.workspace_recruitment_candidates c2 on c2.id=e.candidate_id join private.workspace_recruitment_vacancies v2 on v2.id=c2.vacancy_id;
  return out;

 elsif input->>'action'='emailDone' then
  update private.workspace_careers_emails set status=case when (input->>'ok')::boolean then 'sent' else 'failed' end,
   sent_at=case when (input->>'ok')::boolean then now() end,error=left(coalesce(input->>'error',''),300) where id=(input->>'id')::uuid and status='sending';
  return jsonb_build_object('ok',true);

 elsif input->>'action'='refreshToken' then
  -- A fresh account link for an email that is about to go out (received, or any email to someone without an account yet).
  begin cid:=(input->>'id')::uuid; exception when others then cid:=null; end;
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid request' using errcode='22023';end if;
  update private.workspace_recruitment_candidates set account_token_hash=input->>'tokenHash',account_token_expires=now()+interval '30 days' where id=cid and applicant_id is null;
  return jsonb_build_object('ok',found);

 elsif input->>'action'='cvFile' then
  -- The stored CV, for the team's "open their CV" (the server checked the team member can see the candidate first).
  begin cid:=(input->>'id')::uuid; exception when others then cid:=null; end;
  select * into c from private.workspace_recruitment_candidates where id=cid;
  if c.cv_path is null then raise exception 'No CV file' using errcode='P0002';end if;
  return jsonb_build_object('path',c.cv_path,'name',c.cv_name,'mime',c.cv_mime);
 end if;
 raise exception 'Unknown careers action' using errcode='22023';
end $fn$;

-- 6. The team: who can open a candidate's CV, and messages to the applicant.
create or replace function private.workspace_recruitment_can_see(cand uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_recruitment_candidates c join private.workspace_recruitment_vacancies v on v.id=c.vacancy_id where c.id=cand
  and private.workspace_actor_role() is not null and private.workspace_actor_role() not in ('client','cleans')
  and (private.workspace_can_recruit() or ((v.requested_by=auth.uid() or private.workspace_actor_role() in ('admin','super_admin')) and c.status in ('shortlisted','selected','declined','hired'))))
$fn$;
create or replace function private.workspace_recruitment_message(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c private.workspace_recruitment_candidates;cid uuid;req uuid;begin
 perform private.workspace_json_keys(input,array['action','requestId','vacancyId','candidateId','body']);
 if not private.workspace_can_recruit() then raise exception 'Recruitment message applicants' using errcode='42501';end if;
 begin cid:=(input->>'candidateId')::uuid;req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 select * into c from private.workspace_recruitment_candidates where id=cid and vacancy_id::text=input->>'vacancyId';
 if c.id is null then raise exception 'Candidate not found' using errcode='P0002';end if;
 if jsonb_typeof(input->'body') is distinct from 'string' or char_length(btrim(input->>'body')) not between 1 and 4000 then raise exception 'Write a message (up to 4,000 characters)' using errcode='22023';end if;
 if c.email='' then raise exception 'Add their email address first' using errcode='22023';end if;
 insert into private.workspace_recruitment_messages(candidate_id,author_id,from_applicant,body,request_id) values(c.id,auth.uid(),false,btrim(input->>'body'),req) on conflict do nothing;
 if found then perform private.workspace_careers_queue(c.id,'message');end if;
 return private.workspace_recruitment_read();
end $fn$;

-- 7. The applicant's own account: only their applications.
create or replace function private.workspace_applicant_application(c private.workspace_recruitment_candidates) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',c.id,'title',v.title,'area',v.area,'appliedAt',coalesce(c.applied_at,c.added_at),
  'stage',case when c.status='hired' then 'hired' when c.status='withdrawn' then 'withdrawn' when c.status in ('rejected','declined') or v.status in ('cancelled','rejected') then 'closed'
   when c.offer_status='accepted' then case when k.signed_at is not null then 'signed' when k.id is not null then 'contract' else 'accepted' end
   when c.offer_status='offered' then 'offer' when c.interview_status in ('invited','booked','done','no_show') then 'interview' when c.status in ('shortlisted','selected') then 'shortlisted'
   when v.status='filled' then 'closed' else 'received' end,
  'interview',case when c.interview_status is null then null else jsonb_build_object(
   'status',case when c.interview_status='invited' and c.interview_expires_at<now() then 'expired' else c.interview_status end,'expiresAt',c.interview_expires_at,'at',c.interview_at,
   'mode',v.interview_mode,'place',case when c.interview_status in ('invited','booked') then v.interview_place else '' end,'minutes',v.interview_minutes,
   'freeSlots',case when c.interview_status in ('invited','booked') and v.status='open' then coalesce((select jsonb_agg(to_jsonb(e::timestamptz) order by e::timestamptz) from jsonb_array_elements_text(v.interview_slots) e
     where e::timestamptz>now() and not exists(select 1 from private.workspace_recruitment_candidates c2 where c2.vacancy_id=v.id and c2.id<>c.id and c2.interview_status='booked' and c2.interview_at=e::timestamptz)),'[]') else '[]' end) end,
  'offerStatus',c.offer_status,
  'contract',case when k.id is null then null else jsonb_build_object('title',k.title,'body',k.body,'directorName',k.director_name,'directorSignature',k.director_signature,'issuedAt',k.issued_at,
   'signedName',k.signed_name,'signedSignature',k.signed_signature,'signedAt',k.signed_at) end,
  'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'fromApplicant',m.from_applicant,'body',m.body,'at',m.created_at,
    'authorName',case when m.from_applicant then 'You' else coalesce(nullif(split_part(private.workspace_recruitment_person(m.author_id),' ',1),''),'Recruitment') end) order by m.created_at,m.id)
   from private.workspace_recruitment_messages m where m.candidate_id=c.id),'[]'),
  'open',v.status='open' and c.status not in ('hired','withdrawn','rejected','declined'))
 from private.workspace_recruitment_vacancies v left join private.workspace_hiring_contracts k on k.candidate_id=c.id where v.id=c.vacancy_id
$fn$;
create or replace function private.workspace_applicant_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();begin
 if me is null or not private.has_workspace_session() then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from private.workspace_applicants a where a.user_id=me) then return jsonb_build_object('applicant',false,'applications','[]'::jsonb);end if;
 return jsonb_build_object('applicant',true,'name',(select c.full_name from private.workspace_recruitment_candidates c where c.applicant_id=me order by c.added_at desc limit 1),
  'applications',coalesce((select jsonb_agg(private.workspace_applicant_application(c) order by coalesce(c.applied_at,c.added_at) desc,c.id)
   from private.workspace_recruitment_candidates c where c.applicant_id=me),'[]'));
end $fn$;
create or replace function private.workspace_applicant_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();req uuid;prior jsonb;result jsonb;c private.workspace_recruitment_candidates;v private.workspace_recruitment_vacancies;k private.workspace_hiring_contracts;cid uuid;slot_at timestamptz;begin
 if me is null or not private.has_workspace_session() then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from private.workspace_applicants a where a.user_id=me) then raise exception 'This is for applicants' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','candidateId','at','answer','note','body','signedName','signatureImage','consent'],220000);
 begin req:=(input->>'requestId')::uuid;cid:=(input->>'candidateId')::uuid; exception when others then raise exception 'Invalid request' using errcode='22023'; end;
 if req is null then raise exception 'Invalid request' using errcode='22023';end if;
 select r.result into prior from private.workspace_action_receipts r where r.actor_id=me and r.request_id=req;
 if prior is not null then return prior;end if;
 perform private.workspace_recruitment_expire();
 select * into c from private.workspace_recruitment_candidates where id=cid and applicant_id=me for update;
 if c.id is null then raise exception 'Application not found' using errcode='P0002';end if;
 select * into v from private.workspace_recruitment_vacancies where id=c.vacancy_id;
 select * into k from private.workspace_hiring_contracts where candidate_id=c.id for update;

 if input->>'action'='bookInterview' then
  begin slot_at:=(input->>'at')::timestamptz; exception when others then slot_at:=null; end;
  perform private.workspace_recruitment_book(c.id,slot_at);
 elsif input->>'action'='declineInterview' then
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' then raise exception 'Invalid request' using errcode='22023';end if;
  if coalesce(c.interview_status,'') not in ('invited','booked') then raise exception 'There is no interview to decline' using errcode='22023';end if;
  perform private.workspace_recruitment_decline_interview(c.id,coalesce(input->>'note',''));
  perform private.workspace_recruitment_tell(array_remove(array[v.requested_by,v.assigned_to],null),'recruitment.interview_declined',v.property_id);
 elsif input->>'action'='answerOffer' then
  if jsonb_typeof(coalesce(input->'note','""')) is distinct from 'string' then raise exception 'Invalid request' using errcode='22023';end if;
  perform private.workspace_recruitment_answer_offer(c.id,coalesce(input->>'answer',''),coalesce(input->>'note',''));
 elsif input->>'action'='signContract' then
  if k.id is null then raise exception 'There is no contract to sign yet' using errcode='P0002';end if;
  if k.signed_at is not null then raise exception 'You have already signed it' using errcode='22023';end if;
  if v.status<>'open' then raise exception 'This vacancy is closed' using errcode='22023';end if;
  if input->'consent' is distinct from 'true'::jsonb then raise exception 'Tick to agree to the contract' using errcode='22023';end if;
  if jsonb_typeof(input->'signedName') is distinct from 'string' or char_length(btrim(input->>'signedName')) not between 2 and 200 then raise exception 'Type your full name' using errcode='22023';end if;
  if not private.workspace_hiring_valid_png(input->>'signatureImage') then raise exception 'Draw your signature' using errcode='22023';end if;
  update private.workspace_hiring_contracts set signed_name=btrim(input->>'signedName'),signed_signature=input->>'signatureImage',signed_at=now(),signed_how='candidate' where id=k.id;
  perform private.workspace_recruitment_tell(coalesce(case when v.assigned_to is null then private.workspace_recruitment_team() else array[v.assigned_to] end,'{}')||array[v.requested_by],'recruitment.contract_signed',v.property_id);
 elsif input->>'action'='sendMessage' then
  if jsonb_typeof(input->'body') is distinct from 'string' or char_length(btrim(input->>'body')) not between 1 and 4000 then raise exception 'Write a message (up to 4,000 characters)' using errcode='22023';end if;
  if (select count(*) from private.workspace_recruitment_messages m where m.candidate_id=c.id and m.from_applicant and m.created_at>now()-interval '1 day')>=20 then raise exception 'That is a lot of messages today. Recruitment will reply soon.' using errcode='22023';end if;
  insert into private.workspace_recruitment_messages(candidate_id,author_id,from_applicant,body,request_id) values(c.id,me,true,btrim(input->>'body'),req);
  perform private.workspace_recruitment_tell(case when v.assigned_to is null then private.workspace_recruitment_team() else array[v.assigned_to] end,'recruitment.applicant_message',v.property_id);
 elsif input->>'action'='withdraw' then
  if c.status in ('hired','withdrawn') then raise exception 'This application is already closed' using errcode='22023';end if;
  if k.signed_at is not null then raise exception 'You have signed your contract. Message recruitment instead.' using errcode='22023';end if;
  if c.interview_todo_id is not null then update private.workspace_hub_items set status='done',updated_at=now() where id=c.interview_todo_id and status='open';end if;
  if k.id is not null then delete from private.workspace_hiring_contracts where id=k.id;end if;
  update private.workspace_recruitment_candidates set status='withdrawn',decision_note='Withdrawn by the applicant',decided_at=now(),
   interview_status=case when interview_status in ('invited','booked') then 'declined' else interview_status end where id=c.id;
  perform private.workspace_recruitment_tell(case when v.assigned_to is null then private.workspace_recruitment_team() else array[v.assigned_to] end,'recruitment.applicant_withdrew',v.property_id);
 else
  raise exception 'Unknown action' using errcode='22023';
 end if;
 result:=private.workspace_applicant_read();
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,'applicant',input-'signatureImage',result);
 return result;
end $fn$;

-- 8. An applicant's sign-in waits as a pending account, kept out of the access requests until they are chosen for a job:
-- then it shows there, so the super admin can make it their team account and recruitment can onboard them with it.
do $$ declare d text; begin
 d:=pg_get_functiondef('private.workspace_access_control_read(text)'::regprocedure);
 if position('/* applicants: 20261031400000 */' in d)=0 then
  d:=replace(d,'from public.workspace_profiles p),''[]'');',
   'from public.workspace_profiles p /* applicants: 20261031400000 */ where not (p.status=''pending'' and exists(select 1 from private.workspace_applicants a where a.user_id=p.user_id)'
   ||' and not exists(select 1 from private.workspace_recruitment_candidates c where c.applicant_id=p.user_id and c.status in (''selected'',''hired'')))),''[]'');');
  if position('/* applicants: 20261031400000 */' in d)=0 then raise exception 'Access control has changed; the careers patch needs updating';end if;
  execute d;
 end if;
end $$;

create or replace function public.workspace_careers_public(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_careers_public(input);$$;
create or replace function public.workspace_recruitment_message(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_recruitment_message(input);$$;
create or replace function public.workspace_recruitment_can_see(cand uuid) returns boolean language sql security invoker set search_path='' as $$select private.workspace_recruitment_can_see(cand);$$;
create or replace function public.workspace_applicant_read() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_applicant_read();$$;
create or replace function public.workspace_applicant_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_applicant_action(input);$$;
revoke all on function private.workspace_careers_queue(uuid,text),private.workspace_careers_candidate_emails(),private.workspace_careers_contract_emails(),
 private.workspace_recruitment_candidate_more(uuid,boolean),private.workspace_careers_listing(private.workspace_recruitment_vacancies),private.workspace_careers_public(jsonb),
 private.workspace_recruitment_can_see(uuid),private.workspace_recruitment_message(jsonb),private.workspace_applicant_application(private.workspace_recruitment_candidates),
 private.workspace_applicant_read(),private.workspace_applicant_action(jsonb),
 public.workspace_careers_public(jsonb),public.workspace_recruitment_message(jsonb),public.workspace_recruitment_can_see(uuid),public.workspace_applicant_read(),public.workspace_applicant_action(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.workspace_careers_public(jsonb),public.workspace_careers_public(jsonb) to service_role;
grant execute on function private.workspace_recruitment_message(jsonb),public.workspace_recruitment_message(jsonb),private.workspace_recruitment_can_see(uuid),public.workspace_recruitment_can_see(uuid),
 private.workspace_applicant_read(),public.workspace_applicant_read(),private.workspace_applicant_action(jsonb),public.workspace_applicant_action(jsonb) to authenticated;
