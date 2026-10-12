-- Management flags (B7): anyone on the team can flag a piece of work, a hub record, or a free-standing
-- request ("Ask management") for a management decision. An admin resolves or declines it (declining
-- needs a reason); whoever raised it can withdraw it while it is open. A flag never blocks the work
-- it is about: there is no trigger on work items or hub records, and nothing here changes them.
--
-- 1. private.workspace_management_flags, one row per flag. Partial unique indexes keep at most one
--    open flag per piece of work and one per hub record. raised_by is null when the flag is automatic
--    (the clean form sweep, source 'clean_form').
-- 2. private.workspace_flag_open_for_work(uuid) and private.workspace_flag_open_for_hub(uuid) tell other
--    migrations whether an item already has an open flag.
-- 3. private.workspace_flag_action(input), reached through workspace_teams_action:
--      flagForManagement {source 'work'|'hub'|'request', workId?, hubItemId?, title, reason, amountMinor?}
--        any team role; 'work' needs workspace_can_work on the item, 'hub' needs workspace_hub_can_see,
--        'request' needs neither. Admins are notified.
--      decideFlag {flagId, version, decision 'resolved'|'declined', note?} admins only; declining needs a
--        note of 5 or more characters. The raiser is notified.
--      withdrawFlag {flagId, version} the raiser only.
--    Each is idempotent on requestId (the action receipts), and writes an activity row carrying the
--    work_id so the work's tracker row shows the latest change: management.flag_raised,
--    management.flag_resolved, management.flag_declined, management.flag_withdrawn.
-- 4. private.workspace_flags_read(), reached through workspace_teams_read('flags'): admins see every open
--    flag plus 90 days of closed ones; everyone else sees only the flags they raised. The client (owner)
--    role is refused every call.
-- 5. Routes are appended after the hub anchors in workspace_teams_read and workspace_teams_action, read
--    from their latest definitions. Each anchor must occur exactly once and is kept word for word at the
--    start of its replacement, so other migrations can append after the same anchor in any order.
--
-- Safe to run more than once: the table and indexes are guarded, functions are created or replaced as
-- a whole (nobody else patches them), and each route patch is skipped once its sentinel is present.

create table if not exists private.workspace_management_flags (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('work','hub','request','clean_form')),
 work_id uuid references public.workspace_work_items(id) on delete cascade,
 hub_item_id uuid references private.workspace_hub_items(id) on delete cascade,
 property_id uuid references public.workspace_properties(id),
 title text not null check(length(trim(title)) between 2 and 200),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 amount_minor bigint check(amount_minor is null or amount_minor between 0 and 100000000),
 status text not null default 'open' check(status in ('open','resolved','declined','withdrawn')),
 outcome_note text not null default '' check(length(outcome_note)<=2000),
 raised_by uuid references public.workspace_profiles(user_id),
 decided_by uuid references public.workspace_profiles(user_id),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 check((source in ('work','clean_form') and work_id is not null and hub_item_id is null)
  or (source='hub' and hub_item_id is not null and work_id is null)
  or (source='request' and work_id is null and hub_item_id is null)),
 check(status='open' or decided_at is not null)
);
create unique index if not exists workspace_management_flags_open_work_idx on private.workspace_management_flags(work_id) where status='open' and work_id is not null;
create unique index if not exists workspace_management_flags_open_hub_idx on private.workspace_management_flags(hub_item_id) where status='open' and hub_item_id is not null;
create index if not exists workspace_management_flags_status_idx on private.workspace_management_flags(status,updated_at desc);
create index if not exists workspace_management_flags_raiser_idx on private.workspace_management_flags(raised_by);
create index if not exists workspace_management_flags_decider_idx on private.workspace_management_flags(decided_by);
create index if not exists workspace_management_flags_property_idx on private.workspace_management_flags(property_id);
create index if not exists workspace_management_flags_work_idx on private.workspace_management_flags(work_id);
create index if not exists workspace_management_flags_hub_idx on private.workspace_management_flags(hub_item_id);
alter table private.workspace_management_flags enable row level security;
revoke all on private.workspace_management_flags from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_management_flags;
create trigger business_write_limit before insert or update on private.workspace_management_flags for each row execute function private.workspace_enforce_write_limit();

-- 2. Whether an item already has an open flag (for the clean form sweep and any later package).
create or replace function private.workspace_flag_open_for_work(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_management_flags f where f.work_id=target and f.status='open')
$fn$;
create or replace function private.workspace_flag_open_for_hub(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_management_flags f where f.hub_item_id=target and f.status='open')
$fn$;

-- One flag as the app reads it. Only team roles ever reach this (clients are refused first).
create or replace function private.workspace_flag_view(f private.workspace_management_flags) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',f.id,'source',f.source,'workId',f.work_id,'hubItemId',f.hub_item_id,'propertyId',f.property_id,
  'propertyName',(select p.name from public.workspace_properties p where p.id=f.property_id),
  'propertyAddress',(select p.address from public.workspace_properties p where p.id=f.property_id),
  'workTitle',(select w.title from public.workspace_work_items w where w.id=f.work_id),
  'workKind',(select d.kind from private.workspace_domain_details d where d.work_id=f.work_id),
  'hubTitle',(select h.title from private.workspace_hub_items h where h.id=f.hub_item_id),
  'title',f.title,'reason',f.reason,'amountMinor',f.amount_minor,'status',f.status,'outcomeNote',f.outcome_note,
  'raisedBy',f.raised_by,'raisedByName',(select nullif(trim(a.full_name),'') from public.workspace_profiles a where a.user_id=f.raised_by),
  'mine',coalesce(f.raised_by=auth.uid(),false),
  'decidedByName',(select nullif(trim(a.full_name),'') from public.workspace_profiles a where a.user_id=f.decided_by),'decidedAt',f.decided_at,
  'createdAt',f.created_at,'updatedAt',f.updated_at,'version',f.version)
$fn$;

-- 4. The flags list.
create or replace function private.workspace_flags_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();manager boolean;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 manager:=actor in ('admin','super_admin');
 return jsonb_build_object('canDecide',manager,
  'flags',(select coalesce(jsonb_agg(private.workspace_flag_view(f) order by (f.status='open') desc,f.created_at desc,f.id),'[]') from (
    select * from private.workspace_management_flags x where (manager or x.raised_by=auth.uid())
     and (x.status='open' or x.updated_at>now()-interval '90 days')
    order by (x.status='open') desc,x.created_at desc,x.id limit 500) f));
end $fn$;

-- 3. Raise, decide and withdraw.
create or replace function private.workspace_flag_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 f private.workspace_management_flags;w public.workspace_work_items;h private.workspace_hub_items;src text;prop uuid;amount bigint;note text;
 event text;notify uuid[]:='{}';event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='flagForManagement' then
  perform private.workspace_json_keys(input,array['action','requestId','source','workId','hubItemId','title','reason','amountMinor']);
  src:=input->>'source';
  if src is null or src not in ('work','hub','request')
   or (src='work') is distinct from (input->>'workId' is not null)
   or (src='hub') is distinct from (input->>'hubItemId' is not null) then raise exception 'Choose what to flag' using errcode='22023';end if;
  if jsonb_typeof(input->'title') is distinct from 'string' or length(trim(input->>'title')) not between 2 and 200 then raise exception 'Add a short title' using errcode='22023';end if;
  if jsonb_typeof(input->'reason') is distinct from 'string' or length(trim(input->>'reason')) not between 5 and 2000 then raise exception 'Say why management should look at this' using errcode='22023';end if;
  amount:=case when input->>'amountMinor' is not null then private.workspace_money(input,'amountMinor') end;
  if src='work' then
   select * into w from public.workspace_work_items x where x.id=(input->>'workId')::uuid;
   if w.id is null or not private.workspace_can_work(w.id) then raise exception 'Work not found' using errcode='P0002';end if;
   prop:=w.property_id;
  elsif src='hub' then
   select * into h from private.workspace_hub_items x where x.id=(input->>'hubItemId')::uuid;
   if h.id is null or not private.workspace_hub_can_see(h) then raise exception 'Record not found' using errcode='P0002';end if;
   prop:=h.property_id;
  end if;
  insert into private.workspace_management_flags(source,work_id,hub_item_id,property_id,title,reason,amount_minor,raised_by)
   values(src,w.id,h.id,prop,trim(input->>'title'),trim(input->>'reason'),amount,auth.uid())
   on conflict do nothing returning * into f;
  if f.id is null then raise exception 'Already flagged for management' using errcode='23505';end if;
  event:='management.flag_raised';
  notify:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');

 elsif a='decideFlag' then
  perform private.workspace_json_keys(input,array['action','requestId','flagId','version','decision','note']);
  if actor not in ('admin','super_admin') then raise exception 'Only management decides flags' using errcode='42501';end if;
  select * into f from private.workspace_management_flags x where x.id=(input->>'flagId')::uuid for update;
  if f.id is null then raise exception 'Flag not found' using errcode='P0002';end if;
  if f.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if f.status<>'open' then raise exception 'This flag is already closed' using errcode='22023';end if;
  if coalesce(input->>'decision','') not in ('resolved','declined') then raise exception 'Choose resolved or declined' using errcode='22023';end if;
  if input->'note' is not null and jsonb_typeof(input->'note') not in ('string','null') then raise exception 'Write the note as text' using errcode='22023';end if;
  note:=trim(coalesce(input->>'note',''));
  if length(note)>2000 then raise exception 'The note is too long' using errcode='22023';end if;
  if input->>'decision'='declined' and length(note)<5 then raise exception 'Say why it is declined' using errcode='22023';end if;
  update private.workspace_management_flags set status=input->>'decision',outcome_note=note,decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now()
   where id=f.id returning * into f;
  event:='management.flag_'||f.status;
  notify:=array[f.raised_by];

 elsif a='withdrawFlag' then
  perform private.workspace_json_keys(input,array['action','requestId','flagId','version']);
  select * into f from private.workspace_management_flags x where x.id=(input->>'flagId')::uuid for update;
  if f.id is null or (f.raised_by is distinct from auth.uid() and actor not in ('admin','super_admin')) then raise exception 'Flag not found' using errcode='P0002';end if;
  if f.raised_by is distinct from auth.uid() then raise exception 'Only whoever raised it can withdraw it' using errcode='42501';end if;
  if f.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if f.status<>'open' then raise exception 'This flag is already closed' using errcode='22023';end if;
  update private.workspace_management_flags set status='withdrawn',decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now()
   where id=f.id returning * into f;
  event:='management.flag_withdrawn';
 else raise exception 'Unknown flag action' using errcode='22023';
 end if;

 result:=private.workspace_flag_view(f);
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),f.property_id,f.work_id,event) returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
  select distinct p.user_id,f.work_id,event_id from unnest(notify) u join public.workspace_profiles p on p.user_id=u and p.status='active'
  where u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_flag_open_for_work(uuid),private.workspace_flag_open_for_hub(uuid),
 private.workspace_flag_view(private.workspace_management_flags),private.workspace_flags_read(),private.workspace_flag_action(jsonb) from public,anon,authenticated;

-- 5. Routes, appended after the hub anchors of the latest definitions.
do $$
declare
 -- function, anchor (must occur exactly once, kept at the start of the replacement), replacement, sentinel
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='flags' then result:=private.workspace_flags_read();$q$,
   $q$result:=private.workspace_flags_read();$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('flagForManagement','decideFlag','withdrawFlag') then return private.workspace_flag_action(input);end if;$q$,
   $q$return private.workspace_flag_action(input);$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
