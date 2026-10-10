-- Deleting training courses and staff agreements (contracts), for admins and super admins.
--
-- A course goes completely: its completions and its files (the site's server deletes the stored
-- copies with the paths returned). An agreement nobody has signed goes completely too. One that
-- has been signed is taken out of use and off the lists, but each signed copy is kept: the people
-- who signed still see theirs under "My contracts", and it stays in their copy of their data.
-- Either way the onboarding of anyone it was holding up is worked out again.

alter table private.workspace_contracts add column if not exists deleted_at timestamptz;
alter table private.workspace_contracts add column if not exists deleted_by uuid references public.workspace_profiles(user_id);

create or replace function private.workspace_training_delete_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';course private.workspace_training_courses;c private.workspace_contracts;paths jsonb;signed boolean;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if a='deleteCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId','version']);
  select * into course from private.workspace_training_courses where id=(input->>'courseId')::uuid for update;
  -- Already gone (a second tap, or someone else deleted it): nothing more to do.
  if not found then return jsonb_build_object('deleted',true,'courseId',input->>'courseId','paths','[]'::jsonb);end if;
  if course.version is distinct from (input->>'version')::integer then raise exception 'This course was changed by someone else. Open it again before deleting it.' using errcode='40001';end if;
  paths:=coalesce((select jsonb_agg(f.storage_path) from private.workspace_course_files f where f.course_id=course.id),'[]'::jsonb);
  delete from private.workspace_training_progress where course_id=course.id;
  delete from private.workspace_training_courses where id=course.id;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.course_deleted');
  perform private.workspace_onboarding_refresh();
  return jsonb_build_object('deleted',true,'courseId',course.id,'title',course.title,'paths',paths);
 elsif a='deleteContract' then
  perform private.workspace_json_keys(input,array['action','requestId','contractId','version']);
  select * into c from private.workspace_contracts where id=(input->>'contractId')::uuid and deleted_at is null for update;
  if not found then return jsonb_build_object('deleted',true,'contractId',input->>'contractId','kept',false);end if;
  if c.version is distinct from (input->>'version')::integer then raise exception 'This agreement was changed by someone else. Open it again before deleting it.' using errcode='40001';end if;
  signed:=exists(select 1 from private.workspace_contract_signatures s where s.contract_id=c.id);
  if signed then
   update private.workspace_contracts set active=false,deleted_at=now(),deleted_by=auth.uid(),updated_at=now() where id=c.id;
  else
   delete from private.workspace_contract_versions where contract_id=c.id;
   delete from private.workspace_contracts where id=c.id;
  end if;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'onboarding.contract_deleted');
  perform private.workspace_onboarding_refresh();
  return jsonb_build_object('deleted',true,'contractId',c.id,'title',c.title,'kept',signed);
 end if;
 raise exception 'Unknown team action' using errcode='22023';
end $fn$;
revoke all on function private.workspace_training_delete_action(jsonb) from public,anon,authenticated;

do $$
declare
 fixes text[][] := array[
  -- The team actions send the two deletes here.
  ['private.workspace_teams_action(jsonb)',
   $q$ if input->>'action' in ('inviteEnquiry','resendEnquiry','markEnquiryEmail','startValuing','closeEnquiry') then return private.workspace_client_enquiry_action(input);end if;$q$,
   $q$ if input->>'action' in ('deleteCourse','deleteContract') then return private.workspace_training_delete_action(input);end if;
 if input->>'action' in ('inviteEnquiry','resendEnquiry','markEnquiryEmail','startValuing','closeEnquiry') then return private.workspace_client_enquiry_action(input);end if;$q$,
   $q$private.workspace_training_delete_action(input)$q$],
  -- The agreements list leaves out deleted ones.
  ['private.workspace_onboarding_read(text)',
   $q$order by c.active desc,c.title,c.id) from private.workspace_contracts c),'[]')$q$,
   $q$order by c.active desc,c.title,c.id) from private.workspace_contracts c where c.deleted_at is null),'[]')$q$,
   $q$from private.workspace_contracts c where c.deleted_at is null),'[]')$q$],
  -- A deleted agreement can't be edited back into use.
  ['private.workspace_onboarding_action(jsonb)',
   $q$select * into c from private.workspace_contracts where id=(input->>'contractId')::uuid for update;$q$,
   $q$select * into c from private.workspace_contracts where id=(input->>'contractId')::uuid and deleted_at is null for update;$q$,
   $q$(input->>'contractId')::uuid and deleted_at is null for update;$q$]
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
