-- Fixes from the cross-check of the onboarding and team performance work (8 October 2026).
-- 1. Staff contracts and required courses are for team members only: owners no longer see
--    contract wording through the onboarding checklist ('all' means every team member).
-- 2. The shift card's "today" and "last 30 days" follow the London date, not the server's.
create or replace function private.workspace_onboarding_status(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with person as (select p.user_id,p.role from public.workspace_profiles p where p.user_id=target and p.role in ('stays','cleans','cleaning_manager','ready','accounts')),
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
  'required',exists(select 1 from person) and (exists(select 1 from contracts) or exists(select 1 from courses)),
  'complete',not exists(select 1 from person)
    or (not exists(select 1 from contracts where signed_version is null or signed_version<minimum) and not exists(select 1 from courses where completed_at is null)),
  'contractsSigned',(select count(*) from contracts where signed_version>=minimum),'contractsNeeded',(select count(*) from contracts),
  'coursesDone',(select count(*) from courses where completed_at is not null),'coursesNeeded',(select count(*) from courses),
  'contracts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'version',version,'signedVersion',signed_version,'signedAt',signed_at,'current',signed_version>=minimum) order by title,id) from contracts),'[]'),
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'completedAt',completed_at) order by title,id) from courses),'[]'));
$$;
revoke all on function private.workspace_onboarding_status(uuid) from public,anon,authenticated;

do $$
declare definition text;begin
 definition:=pg_get_functiondef('private.workspace_shift_read(text,date,date)'::regprocedure);
 if position('current_date' in definition)>0 then
  execute replace(definition,'current_date',$q$(now() at time zone 'Europe/London')::date$q$);
 end if;
end $$;
