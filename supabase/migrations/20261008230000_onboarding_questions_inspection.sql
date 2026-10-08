-- Onboarding, as the client described it:
-- * The owner can ask Recharge a question at any point, separately from their estimate decision,
--   and the team answers it on the journey. Both sides are notified.
-- * The new-property inspection is a checklist plus the report and any issues found.
-- * Stays with the onboarding tool are put on every new enquiry, and Ready with the inspection
--   board on every new inspection, so the right people hear about it straight away.

create table private.workspace_journey_questions (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.workspace_properties(id),
 asked_by uuid not null references public.workspace_profiles(user_id),
 question text not null check(length(question) between 5 and 2000),
 answer text check(answer is null or length(answer) between 2 and 2000),
 answered_by uuid references public.workspace_profiles(user_id),
 asked_at timestamptz not null default now(),
 answered_at timestamptz
);
create index workspace_journey_questions_property on private.workspace_journey_questions(property_id,asked_at);
alter table private.workspace_journey_questions enable row level security;
revoke all on private.workspace_journey_questions from public,anon,authenticated;
alter table private.workspace_journeys add column inspection_checks jsonb not null default '{}';

create or replace function private.workspace_journey_view(j private.workspace_journeys) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_form jsonb; begin
 safe_form:=j.form-'bankAccountName'-'bankAccountNumber'-'bankSortCode'-'accessInfo';
 return jsonb_build_object('propertyId',j.property_id,'clientId',j.client_id,'workId',j.work_id,'stage',j.stage,'propertyType',j.property_type,'bathrooms',j.bathrooms,
 'estimate',j.estimate,'followUpOn',j.follow_up_on,'feedback',j.feedback,'agreement',j.agreement,'agreementRevision',j.agreement_revision,
 'signedName',j.signed_name,'signedAt',j.signed_at,'signedRevision',j.signed_revision,'form',safe_form,'submittedAt',j.submitted_at,
 'invoiceId',j.invoice_id,'inspectionOn',j.inspection_on,'inspectionCompletedAt',j.inspection_completed_at,'inspectionReport',j.inspection_report,'inspectionChecks',j.inspection_checks,'version',j.version,
 'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'askedAt',q.asked_at,'askedByOwner',q.asked_by=j.client_id,'answer',q.answer,'answeredAt',q.answered_at) order by q.asked_at)
   from private.workspace_journey_questions q where q.property_id=j.property_id),'[]'));
end $$;

do $$
declare
 definition text;
 fixes constant text[][]:=array[
  [$q$  else raise exception 'Unknown journey action' using errcode='22023'; end if;$q$,
   $q$  elsif action='askQuestion' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','question']);
   if not (actor_role='client' and j.client_id=auth.uid() or actor_role in ('stays','admin','super_admin')) then raise exception 'Only the owner or the team can ask here' using errcode='42501'; end if;
   insert into private.workspace_journey_questions(property_id,asked_by,question) values(target,auth.uid(),private.workspace_required_text(input,'question',5,2000));
  elsif action='answerQuestion' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','questionId','answer']);
   if actor_role not in ('stays','admin','super_admin') then raise exception 'Team answer required' using errcode='42501'; end if;
   update private.workspace_journey_questions set answer=private.workspace_required_text(input,'answer',2,2000),answered_by=auth.uid(),answered_at=now()
    where id=(input->>'questionId')::uuid and property_id=target and answered_at is null;
   if not found then raise exception 'That question has already been answered' using errcode='22023'; end if;
  else raise exception 'Unknown journey action' using errcode='22023'; end if;$q$],
  [$q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','report']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','report','checks','issues']);
   if input ? 'checks' and (jsonb_typeof(input->'checks') is distinct from 'object' or exists(select 1 from jsonb_each(input->'checks') c where jsonb_typeof(c.value)<>'boolean' or c.key not in ('keysAccess','alarms','heatingHotWater','appliances','wifi','damage','furnishing','safetyItems','guestReady'))) then raise exception 'Invalid inspection checklist' using errcode='22023'; end if;
   if length(coalesce(input->>'issues',''))>3000 then raise exception 'Issues note is too long' using errcode='22023'; end if;$q$],
  [$q$update private.workspace_journeys set inspection_report=private.workspace_required_text(input,'report',10,5000),inspection_completed_at=now(),stage='inspection_complete' where property_id=target;$q$,
   $q$update private.workspace_journeys set inspection_report=private.workspace_required_text(input,'report',10,5000),inspection_checks=jsonb_build_object('checks',coalesce(input->'checks','{}'),'issues',coalesce(input->>'issues','')),inspection_completed_at=now(),stage='inspection_complete' where property_id=target;$q$]
 ];
begin
 definition:=pg_get_functiondef('private.workspace_journey_action(jsonb)'::regprocedure);
 if position('askQuestion' in definition)>0 then return; end if;
 for i in 1..array_length(fixes,1) loop
  if position(fixes[i][1] in definition)=0 then raise exception 'Patch anchor missing: journey fix %',i; end if;
  definition:=replace(definition,fixes[i][1],fixes[i][2]);
 end loop;
 execute definition;
end $$;

-- The right team on every new enquiry and inspection.
create function private.workspace_assign_onboarding_team() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by)
 select new.property_id,p.user_id,'staff',coalesce(auth.uid(),new.client_id) from public.workspace_profiles p
  join public.workspace_module_grants g on g.user_id=p.user_id and g.module_id='property-onboarding'
  where p.role='stays' and p.status='active'
 on conflict(property_id,user_id) do nothing;
 return new;
end $$;
create trigger journey_team_assigned after insert on private.workspace_journeys for each row execute function private.workspace_assign_onboarding_team();

create function private.workspace_assign_inspection_team() returns trigger language plpgsql security definer set search_path='' as $$
declare prop uuid;owner uuid;begin
 if new.kind<>'inspection' then return new;end if;
 select w.property_id into prop from public.workspace_work_items w where w.id=new.work_id;
 select j.client_id into owner from private.workspace_journeys j where j.property_id=prop;
 insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by)
 select prop,p.user_id,'staff',coalesce(auth.uid(),owner,p.user_id) from public.workspace_profiles p
  join public.workspace_module_grants g on g.user_id=p.user_id and g.module_id='new-property-inspection-board'
  where p.role='ready' and p.status='active'
 on conflict(property_id,user_id) do nothing;
 return new;
end $$;
create trigger inspection_team_assigned after insert on private.workspace_domain_details for each row execute function private.workspace_assign_inspection_team();
revoke all on function private.workspace_assign_onboarding_team(),private.workspace_assign_inspection_team() from public,anon,authenticated;
