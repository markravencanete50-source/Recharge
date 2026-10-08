-- Departments and shifts per person: each team member belongs to a department (guest relations,
-- client relations, ...) and usually works the early shift (08:00-16:00), the late shift
-- (15:00-23:00) or both. Clock-in starts from their department, and Team performance shows both.
create table private.workspace_staff_rota (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 department text not null check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 usual_shift text not null check(usual_shift in ('early','late','both')),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_staff_rota enable row level security;
revoke all on private.workspace_staff_rota from public,anon,authenticated;

create function private.workspace_rota_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'department',r.department,'usualShift',r.usual_shift) order by p.full_name)
  from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id
  where p.status='active' and p.role<>'client' and (actor in ('admin','super_admin') or p.user_id=auth.uid())),'[]');
end $$;

create function private.workspace_rota_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare req uuid;prior private.workspace_action_receipts;result jsonb;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','userId','department','usualShift']);
 req:=(input->>'requestId')::uuid;if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if not exists(select 1 from public.workspace_profiles where user_id=(input->>'userId')::uuid and status='active' and role<>'client') then raise exception 'Team member not found' using errcode='P0002';end if;
 if coalesce(input->>'department','') not in ('guest_relations','client_relations','cleaning','ready','accounts','management') or coalesce(input->>'usualShift','') not in ('early','late','both') then raise exception 'Choose a department and a shift' using errcode='22023';end if;
 insert into private.workspace_staff_rota(user_id,department,usual_shift,updated_by) values((input->>'userId')::uuid,input->>'department',input->>'usualShift',auth.uid())
  on conflict(user_id) do update set department=excluded.department,usual_shift=excluded.usual_shift,updated_by=excluded.updated_by,updated_at=now();
 result:=jsonb_build_object('userId',input->>'userId','department',input->>'department','usualShift',input->>'usualShift');
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
revoke all on function private.workspace_rota_read(),private.workspace_rota_action(jsonb) from public,anon,authenticated;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$ elsif section='budgetChart' then$q$,
   $q$ elsif section='rota' then result:=private.workspace_rota_read();
 elsif section='budgetChart' then$q$, 'workspace_rota_read'],
  ['private.workspace_teams_action(jsonb)', $q$ if input->>'action' in ('saveBudgetItem','removeBudgetItem') then return private.workspace_budget_action(input);end if;$q$,
   $q$ if input->>'action' in ('saveBudgetItem','removeBudgetItem') then return private.workspace_budget_action(input);end if;
 if input->>'action'='saveRota' then return private.workspace_rota_action(input);end if;$q$, 'workspace_rota_action'],
  ['private.workspace_shift_read(text,date,date)', $q$'signOffs',(select count(*)$q$,
   $q$'department',(select r.department from private.workspace_staff_rota r where r.user_id=p.user_id),
     'usualShift',(select r.usual_shift from private.workspace_staff_rota r where r.user_id=p.user_id),
     'signOffs',(select count(*)$q$, '''usualShift'''],
  ['private.workspace_shift_read(text,date,date)', $q$   'passPercent',t.pass_percent);$q$,
   $q$   'passPercent',t.pass_percent,
   'rota',(select jsonb_build_object('department',r.department,'usualShift',r.usual_shift) from private.workspace_staff_rota r where r.user_id=auth.uid()));$q$, '''rota''']
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
