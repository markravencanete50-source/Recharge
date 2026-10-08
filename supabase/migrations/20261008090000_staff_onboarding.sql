-- Staff onboarding (8 October 2026). Recharge onboards its team afresh: before a team member
-- (Stays, cleaners, cleaning managers, Ready, Accounts) can use any tool, they sign the staff
-- contract for their role and complete the training marked "required" for their role.
-- Admins write the contracts and choose the required courses. Nothing is gated until an admin
-- publishes a contract or marks a course required. Admins and owners are never gated.

create table private.workspace_contracts (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 2 and 200),
  audience text[] not null check(cardinality(audience) between 1 and 6 and audience <@ array['all','stays','cleans','cleaning_manager','ready','accounts']),
  active boolean not null default true, version integer not null default 1 check(version>0),
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(created_by,request_id)
);
-- Each published wording is kept as signed. "resign_required" asks everyone to sign that wording again.
create table private.workspace_contract_versions (
  contract_id uuid not null references private.workspace_contracts(id), version integer not null check(version>0),
  title text not null, body text not null check(length(trim(body)) between 20 and 100000), resign_required boolean not null default false,
  published_by uuid not null references public.workspace_profiles(user_id), published_at timestamptz not null default now(),
  primary key(contract_id,version)
);
create table private.workspace_contract_signatures (
  contract_id uuid not null, version integer not null, user_id uuid not null references public.workspace_profiles(user_id),
  signed_name text not null check(length(trim(signed_name)) between 2 and 200), signed_at timestamptz not null default now(),
  primary key(contract_id,version,user_id), foreign key(contract_id,version) references private.workspace_contract_versions(contract_id,version)
);
create index workspace_contract_signatures_user_idx on private.workspace_contract_signatures(user_id);
alter table private.workspace_training_courses add column if not exists required boolean not null default false;

do $$ declare t text; begin
 foreach t in array array['workspace_contracts','workspace_contract_versions','workspace_contract_signatures'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- What a person still has to do. Contracts: the active ones for their role, signed at or after
-- the latest wording that asked everyone to sign again. Training: published required courses.
create function private.workspace_onboarding_status(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with person as (select p.user_id,p.role from public.workspace_profiles p where p.user_id=target),
 contracts as (
  select c.id,c.title,c.version,
   (select max(s.version) from private.workspace_contract_signatures s where s.contract_id=c.id and s.user_id=target) signed_version,
   (select max(s.signed_at) from private.workspace_contract_signatures s where s.contract_id=c.id and s.user_id=target) signed_at,
   coalesce((select max(v.version) from private.workspace_contract_versions v where v.contract_id=c.id and v.resign_required),1) minimum
  from private.workspace_contracts c,person where c.active and ('all'=any(c.audience) or person.role=any(c.audience))),
 courses as (
  select c.id,c.title,(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=target) completed_at
  from private.workspace_training_courses c,person where c.published and c.required and ('all'=any(c.audience) or person.role=any(c.audience)))
 select jsonb_build_object(
  'required',(select role from person) in ('stays','cleans','cleaning_manager','ready','accounts') and (exists(select 1 from contracts) or exists(select 1 from courses)),
  'complete',(select role from person) not in ('stays','cleans','cleaning_manager','ready','accounts')
    or (not exists(select 1 from contracts where signed_version is null or signed_version<minimum) and not exists(select 1 from courses where completed_at is null)),
  'contractsSigned',(select count(*) from contracts where signed_version>=minimum),'contractsNeeded',(select count(*) from contracts),
  'coursesDone',(select count(*) from courses where completed_at is not null),'coursesNeeded',(select count(*) from courses),
  'contracts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'version',version,'signedVersion',signed_version,'signedAt',signed_at,'current',signed_version>=minimum) order by title,id) from contracts),'[]'),
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'completedAt',completed_at) order by title,id) from courses),'[]'));
$$;

-- Cached per transaction like the session checks; only a completed onboarding is cached.
create function private.workspace_onboarded() returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();key text;ok boolean;begin
 if actor is null then return false;end if;
 if actor not in ('stays','cleans','cleaning_manager','ready','accounts') then return true;end if;
 key:=auth.uid()::text||':'||coalesce(auth.jwt()->>'session_id','');
 if current_setting('recharge.workspace_onboarded',true)=key then return true;end if;
 ok:=(private.workspace_onboarding_status(auth.uid())->>'complete')::boolean;
 if ok then perform set_config('recharge.workspace_onboarded',key,true);end if;
 return ok;
end $$;

-- Every tool goes through this check, so tools stay closed until onboarding is complete.
create or replace function private.has_workspace_module(requested_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_workspace_session() and exists (
    select 1 from public.workspace_profiles p where p.user_id = auth.uid() and p.status = 'active'
      and (p.role <> 'cleans' or requested_module in ('cleaning-schedule', 'cleaner-performance', 'cleans-invoices'))
      and (p.role in ('super_admin', 'admin') or exists (
        select 1 from public.workspace_module_grants g where g.user_id = p.user_id and g.module_id = requested_module
      ))
  ) and private.workspace_onboarded();
$$;

create function private.workspace_contract_json(c private.workspace_contracts,with_signatures boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'active',c.active,'version',c.version,
  'body',v.body,'resignRequired',v.resign_required,'publishedAt',v.published_at,
  'signatures',case when with_signatures then coalesce((select jsonb_agg(jsonb_build_object('userId',s.user_id,'fullName',p.full_name,'signedName',s.signed_name,'version',s.version,'signedAt',s.signed_at) order by s.signed_at desc)
   from private.workspace_contract_signatures s join public.workspace_profiles p on p.user_id=s.user_id where s.contract_id=c.id),'[]') end)
 from private.workspace_contract_versions v where v.contract_id=c.id and v.version=c.version;
$$;

create function private.workspace_onboarding_read(section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();status jsonb;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='onboarding' then
  -- The person's own checklist, with the wording of each contract they still need to sign.
  status:=private.workspace_onboarding_status(auth.uid());
  return status||jsonb_build_object('contracts',coalesce((select jsonb_agg(x.value||jsonb_build_object('body',v.body,'resignRequired',v.resign_required) order by x.value->>'title')
   from jsonb_array_elements(status->'contracts') x join private.workspace_contracts c on c.id=(x.value->>'id')::uuid
   join private.workspace_contract_versions v on v.contract_id=c.id and v.version=c.version),'[]'));
 elsif section='contracts' then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
  return jsonb_build_object(
   'contracts',coalesce((select jsonb_agg(private.workspace_contract_json(c,true) order by c.active desc,c.title,c.id) from private.workspace_contracts c),'[]'),
   'people',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role)||private.workspace_onboarding_status(p.user_id)-'contracts'-'courses' order by p.full_name)
    from public.workspace_profiles p where p.status='active' and p.role in ('stays','cleans','cleaning_manager','ready','accounts')),'[]'));
 end if;
 raise exception 'Unknown team section' using errcode='22023';
end $$;

create function private.workspace_onboarding_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;c private.workspace_contracts;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('saveContract','setCourseRequired') and actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if a='signContract' and actor not in ('stays','cleans','cleaning_manager','ready','accounts') then raise exception 'Only team members sign the staff contract' using errcode='42501';end if;
 if a not in ('saveContract','setCourseRequired','signContract') then raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveContract' then
  perform private.workspace_json_keys(input,array['action','requestId','contractId','version','title','audience','body','active','resignRequired']);
  if jsonb_typeof(input->'audience') is distinct from 'array' or jsonb_typeof(input->'active') is distinct from 'boolean'
   or exists(select 1 from jsonb_array_elements(input->'audience') e where jsonb_typeof(e)<>'string' or e#>>'{}' not in ('all','stays','cleans','cleaning_manager','ready','accounts'))
   or (input->'resignRequired' is not null and jsonb_typeof(input->'resignRequired')<>'boolean') then raise exception 'Invalid contract' using errcode='22023';end if;
  if input->>'contractId' is null then
   insert into private.workspace_contracts(title,audience,active,created_by,request_id)
    values(private.workspace_required_text(input,'title',2,200),array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),(input->>'active')::boolean,auth.uid(),req) returning * into c;
   insert into private.workspace_contract_versions(contract_id,version,title,body,resign_required,published_by)
    values(c.id,1,c.title,private.workspace_required_text(input,'body',20,100000),true,auth.uid());
  else
   select * into c from private.workspace_contracts where id=(input->>'contractId')::uuid for update;
   if not found then raise exception 'Contract not found' using errcode='P0002';end if;
   if c.version is distinct from (input->>'version')::integer then raise exception 'Contract changed' using errcode='40001';end if;
   -- New wording becomes a new version; switching it on or off alone does not.
   if exists(select 1 from private.workspace_contract_versions v where v.contract_id=c.id and v.version=c.version
     and (v.body<>trim(input->>'body') or v.title<>trim(input->>'title') or coalesce((input->>'resignRequired')::boolean,false))) then
    update private.workspace_contracts set title=private.workspace_required_text(input,'title',2,200),audience=array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),
     active=(input->>'active')::boolean,version=version+1,updated_at=now() where id=c.id returning * into c;
    insert into private.workspace_contract_versions(contract_id,version,title,body,resign_required,published_by)
     values(c.id,c.version,c.title,private.workspace_required_text(input,'body',20,100000),coalesce((input->>'resignRequired')::boolean,false),auth.uid());
   else
    update private.workspace_contracts set audience=array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),active=(input->>'active')::boolean,updated_at=now() where id=c.id returning * into c;
   end if;
  end if;
  result:=private.workspace_contract_json(c,false);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'onboarding.contract_saved');

 elsif a='setCourseRequired' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId','required']);
  if jsonb_typeof(input->'required') is distinct from 'boolean' then raise exception 'Invalid course' using errcode='22023';end if;
  update private.workspace_training_courses set required=(input->>'required')::boolean,updated_at=now() where id=(input->>'courseId')::uuid;
  if not found then raise exception 'Course not found' using errcode='P0002';end if;
  result:=jsonb_build_object('courseId',input->>'courseId','required',(input->>'required')::boolean);

 elsif a='signContract' then
  perform private.workspace_json_keys(input,array['action','requestId','contractId','version','signedName','agree']);
  if jsonb_typeof(input->'agree') is distinct from 'boolean' or not (input->>'agree')::boolean then raise exception 'Tick the box to agree to the contract' using errcode='22023';end if;
  select * into c from private.workspace_contracts where id=(input->>'contractId')::uuid and active and ('all'=any(audience) or actor=any(audience));
  if not found then raise exception 'Contract not available' using errcode='P0002';end if;
  if c.version is distinct from (input->>'version')::integer then raise exception 'The contract has just been updated. Read the new wording and sign again.' using errcode='40001';end if;
  insert into private.workspace_contract_signatures(contract_id,version,user_id,signed_name) values(c.id,c.version,auth.uid(),private.workspace_required_text(input,'signedName',2,200)) on conflict do nothing;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'onboarding.contract_signed');
  result:=private.workspace_onboarding_status(auth.uid())-'contracts'-'courses';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Route the new sections and actions through the existing team endpoints, and show which
-- courses are required. (Patched in place: the live definitions use CRLF line endings.)
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$ else raise exception 'Unknown team section' using errcode='22023';end if;$q$,
   $q$ elsif section in ('onboarding','contracts') then result:=private.workspace_onboarding_read(section);
 else raise exception 'Unknown team section' using errcode='22023';end if;$q$, 'workspace_onboarding_read'],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$'published',c.published,'version',c.version,$q$, $q$'published',c.published,'required',c.required,'version',c.version,$q$, $q$'required',c.required$q$],
  ['private.workspace_teams_action(jsonb)', $q$ if actor is null then raise exception 'Active access required' using errcode='42501';end if;$q$,
   $q$ if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input->>'action' in ('saveContract','setCourseRequired','signContract') then return private.workspace_onboarding_action(input);end if;$q$, 'workspace_onboarding_action']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in %', fixes[i][1]; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;

-- Only reached through the team endpoints and the tool check, which run as the definer.
revoke all on function private.workspace_onboarding_status(uuid),private.workspace_onboarded(),private.workspace_contract_json(private.workspace_contracts,boolean),
 private.workspace_onboarding_read(text),private.workspace_onboarding_action(jsonb) from public,anon,authenticated;
