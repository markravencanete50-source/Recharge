-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It completes staff onboarding (see supabase/migrations/20261009150000_staff_onboarding_complete.sql).
-- Safe to run more than once. The last line records it in the migration history.

-- Staff onboarding, completed (client videos: "Training centre with courses by team and progress",
-- "storage for uploaded documents and videos, and course progress per person").
-- 1. Per-person progress for admins: every contract and every course for the person's role, and
--    when they finished onboarding.
-- 2. Notifications: admins hear when someone finishes onboarding; a team member hears when a new
--    contract, new wording to sign again, or a newly required course closes their tools.
-- 3. "Do this course again": editing a course can ask everyone to complete it again.
-- 4. Course files: documents, pictures and short videos attached to a course, kept in a private
--    storage bucket and opened through short-lived links after an access check.
-- 5. Team members can read the contracts they have signed.
-- Written without "select ... into" so it can be pasted into the Supabase SQL editor. Safe to run more than once.

-- Who currently has full access (onboarding complete or nothing to complete), so a change that
-- closes someone's tools can tell them, and finishing can tell the admins once.
create table if not exists private.workspace_onboarding_done (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 completed_at timestamptz not null default now()
);
alter table private.workspace_onboarding_done enable row level security;
revoke all on private.workspace_onboarding_done from public,anon,authenticated;
insert into private.workspace_onboarding_done(user_id)
 select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('stays','cleans','cleaning_manager','ready','accounts')
  and (private.workspace_onboarding_status(p.user_id)->>'complete')::boolean
on conflict do nothing;

-- One notice to several people (in the app, and by push where switched on).
create or replace function private.workspace_onboarding_notify(actor uuid, event text, recipients uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare ev bigint;begin
 if coalesce(cardinality(recipients),0)=0 then return;end if;
 insert into public.workspace_activity(actor_id,event_type) values(actor,event) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(recipients) u where u is not null on conflict do nothing;
end $$;

-- Called after anything that can change one person's onboarding.
create or replace function private.workspace_onboarding_progress(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare st jsonb:=private.workspace_onboarding_status(target);had boolean;begin
 had:=exists(select 1 from private.workspace_onboarding_done d where d.user_id=target);
 if (st->>'complete')::boolean then
  if not had then
   insert into private.workspace_onboarding_done(user_id) values(target) on conflict do nothing;
   if (st->>'required')::boolean then
    perform private.workspace_onboarding_notify(target,'onboarding.completed',
     array(select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin')));
   end if;
  end if;
 elsif had then
  delete from private.workspace_onboarding_done where user_id=target;
  perform private.workspace_onboarding_notify(coalesce(auth.uid(),target),'onboarding.action_needed',array[target]);
 end if;
end $$;

-- Every active team member, after an admin changes a contract or a required course.
create or replace function private.workspace_onboarding_refresh() returns void
language plpgsql security definer set search_path='' as $$
declare u uuid;begin
 for u in select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('stays','cleans','cleaning_manager','ready','accounts') loop
  perform private.workspace_onboarding_progress(u);
 end loop;
end $$;

-- Every published course for a person's role, required or not, and whether they have done it.
create or replace function private.workspace_person_training(target uuid, person_role text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'required',c.required,
   'completedAt',(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=target)) order by c.required desc,c.title,c.id),'[]')
 from private.workspace_training_courses c where c.published and ('all'=any(c.audience) or person_role=any(c.audience));
$$;

-- Course files ------------------------------------------------------------------------------------
create table if not exists private.workspace_course_files (
 id uuid primary key default gen_random_uuid(),
 course_id uuid not null references private.workspace_training_courses(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 200),
 mime text not null check(mime in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm')),
 bytes integer not null check(bytes between 1 and 26214400),
 storage_path text not null unique check(storage_path ~ '^courses/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx|jpg|png|webp|mp4|mov|webm)$'),
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);
create index if not exists workspace_course_files_course_idx on private.workspace_course_files(course_id,created_at);
alter table private.workspace_course_files enable row level security;
revoke all on private.workspace_course_files from public,anon,authenticated;

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('training-files','training-files',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

create or replace function private.workspace_course_files_json(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'bytes',f.bytes) order by f.created_at,f.id),'[]')
 from private.workspace_course_files f where f.course_id=target;
$$;

-- Who may open a course's files: admins, and anyone the published course is for (including people
-- still onboarding, who need their training before their tools open).
create or replace function private.workspace_course_visible(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin'),false) or exists(select 1 from private.workspace_training_courses c
  where c.id=target and c.published and private.workspace_actor_role() is not null and ('all'=any(c.audience) or private.workspace_actor_role()=any(c.audience)));
$$;

create or replace function private.workspace_course_file(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f private.workspace_course_files;begin
 f:=(select x from private.workspace_course_files x where x.id=target);
 if f.id is null or not private.workspace_course_visible(f.course_id) then raise exception 'File not found' using errcode='P0002';end if;
 return jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'path',f.storage_path);
end $$;

-- Admins record a file the server has just stored, or remove one (the server then deletes it).
create or replace function private.workspace_course_file_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a text:=input->>'action';f private.workspace_course_files;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if a='addFile' then
  perform private.workspace_json_keys(input,array['action','fileId','courseId','name','mime','bytes','path']);
  if not exists(select 1 from private.workspace_training_courses c where c.id=(input->>'courseId')::uuid) then raise exception 'Course not found' using errcode='P0002';end if;
  if (select count(*) from private.workspace_course_files x where x.course_id=(input->>'courseId')::uuid)>=10 then raise exception 'A course can have up to 10 files' using errcode='22023';end if;
  if input->>'path' is distinct from 'courses/'||(input->>'courseId')||'/'||(input->>'fileId')||substring(input->>'path' from '\.[a-z0-9]+$') then raise exception 'Invalid file' using errcode='22023';end if;
  insert into private.workspace_course_files(id,course_id,name,mime,bytes,storage_path,created_by)
   values((input->>'fileId')::uuid,(input->>'courseId')::uuid,left(trim(input->>'name'),200),input->>'mime',(input->>'bytes')::int,input->>'path',auth.uid()) returning * into f;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.file_added');
  return jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'bytes',f.bytes);
 elsif a='removeFile' then
  perform private.workspace_json_keys(input,array['action','fileId']);
  delete from private.workspace_course_files where id=(input->>'fileId')::uuid returning * into f;
  if f.id is null then raise exception 'File not found' using errcode='P0002';end if;
  return jsonb_build_object('id',f.id,'path',f.storage_path);
 end if;
 raise exception 'Unknown file action' using errcode='22023';
end $$;

create or replace function public.workspace_course_file(target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_course_file(target);$$;
create or replace function public.workspace_course_file_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_course_file_action(input);$$;

-- Patches to the existing functions, applied in place ------------------------------------------
do $$
declare
 fixes constant text[][] := array[
  -- Team members read the contracts they signed.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section in ('onboarding','contracts') then result:=private.workspace_onboarding_read(section);$q$,
   $q$elsif section in ('onboarding','contracts','myContracts') then result:=private.workspace_onboarding_read(section);$q$,
   $q$'contracts','myContracts'$q$],
  -- Each course lists its files.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'required',c.required,'version',c.version,$q$,
   $q$'required',c.required,'version',c.version,'files',private.workspace_course_files_json(c.id),$q$,
   'workspace_course_files_json'],
  -- Editing a course can ask everyone to do it again; tools close until they have.
  ['private.workspace_teams_action(jsonb)',
   $q$array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published']);$q$,
   $q$array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published','redoRequired']);perform private.workspace_onboarding_refresh();$q$,
   $q$'published','redoRequired'$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;$q$,
   $q$published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;if coalesce((input->>'redoRequired')::boolean,false) then delete from private.workspace_training_progress where course_id=course.id;end if;$q$,
   $q$delete from private.workspace_training_progress where course_id=course.id$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$values(auth.uid(),'training.course_saved');$q$,
   $q$values(auth.uid(),'training.course_saved');perform private.workspace_onboarding_refresh();$q$,
   $q$'training.course_saved');perform private.workspace_onboarding_refresh();$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;$q$,
   $q$insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;perform private.workspace_onboarding_progress(auth.uid());$q$,
   $q$on conflict do nothing;perform private.workspace_onboarding_progress(auth.uid());$q$],
  -- Signing tells the admins when it was the last step.
  ['private.workspace_onboarding_action(jsonb)',
   $q$values(auth.uid(),'onboarding.contract_signed');$q$,
   $q$values(auth.uid(),'onboarding.contract_signed');perform private.workspace_onboarding_progress(auth.uid());$q$,
   $q$'onboarding.contract_signed');perform private.workspace_onboarding_progress$q$],
  -- A new contract or new wording tells the people whose tools it closes.
  ['private.workspace_onboarding_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','contractId','version','title','audience','body','active','resignRequired']);$q$,
   $q$perform private.workspace_onboarding_refresh();perform private.workspace_json_keys(input,array['action','requestId','contractId','version','title','audience','body','active','resignRequired']);$q$,
   $q$perform private.workspace_onboarding_refresh();perform private.workspace_json_keys(input,array['action','requestId','contractId'$q$],
  ['private.workspace_onboarding_action(jsonb)',
   $q$values(auth.uid(),'onboarding.contract_saved');$q$,
   $q$values(auth.uid(),'onboarding.contract_saved');perform private.workspace_onboarding_refresh();$q$,
   $q$'onboarding.contract_saved');perform private.workspace_onboarding_refresh();$q$],
  ['private.workspace_onboarding_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','courseId','required']);$q$,
   $q$perform private.workspace_onboarding_refresh();perform private.workspace_json_keys(input,array['action','requestId','courseId','required']);$q$,
   $q$perform private.workspace_onboarding_refresh();perform private.workspace_json_keys(input,array['action','requestId','courseId','required'$q$],
  ['private.workspace_onboarding_action(jsonb)',
   $q$result:=jsonb_build_object('courseId',input->>'courseId','required',(input->>'required')::boolean);$q$,
   $q$result:=jsonb_build_object('courseId',input->>'courseId','required',(input->>'required')::boolean);perform private.workspace_onboarding_refresh();$q$,
   $q$(input->>'required')::boolean);perform private.workspace_onboarding_refresh();$q$],
  -- Admins see each person's contracts and courses, not only the counts.
  ['private.workspace_onboarding_read(text)',
   $q$private.workspace_onboarding_status(p.user_id)-'contracts'-'courses'$q$,
   $q$private.workspace_onboarding_status(p.user_id)||jsonb_build_object('training',private.workspace_person_training(p.user_id,p.role),'onboardedAt',(select d.completed_at from private.workspace_onboarding_done d where d.user_id=p.user_id))$q$,
   'workspace_person_training'],
  ['private.workspace_onboarding_read(text)',
   $q$elsif section='contracts' then$q$,
   $q$elsif section='myContracts' then
  return coalesce((select jsonb_agg(jsonb_build_object('contractId',s.contract_id,'title',v.title,'version',s.version,'signedName',s.signed_name,'signedAt',s.signed_at,'body',v.body,'latest',s.version=c.version) order by s.signed_at desc)
   from private.workspace_contract_signatures s join private.workspace_contract_versions v on v.contract_id=s.contract_id and v.version=s.version
   join private.workspace_contracts c on c.id=s.contract_id where s.user_id=auth.uid()),'[]');
 elsif section='contracts' then$q$,
   $q$section='myContracts'$q$]
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

revoke all on function private.workspace_onboarding_notify(uuid,text,uuid[]),private.workspace_onboarding_progress(uuid),private.workspace_onboarding_refresh(),
 private.workspace_person_training(uuid,text),private.workspace_course_files_json(uuid),private.workspace_course_visible(uuid) from public,anon,authenticated;
revoke all on function private.workspace_course_file(uuid),private.workspace_course_file_action(jsonb),public.workspace_course_file(uuid),public.workspace_course_file_action(jsonb) from public,anon;
grant execute on function private.workspace_course_file(uuid),private.workspace_course_file_action(jsonb),public.workspace_course_file(uuid),public.workspace_course_file_action(jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261009150000','staff_onboarding_complete') on conflict do nothing;

select 'Staff onboarding is up to date' as result;
