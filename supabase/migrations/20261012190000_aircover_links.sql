-- AirCover claims linked to maintenance tickets (S6, ask B4).
--
-- 1. Hub items gain a nullable work_id naming the maintenance or routine-visit ticket a claim is about.
--    Only AirCover rows use it (check), a work item has at most ONE live claim (to_claim or claimed; a
--    paid or declined claim frees it, partial unique index), and a lookup index serves the read. A guard
--    trigger gives a plain message when reopening a claim would make a second live one.
-- 2. private.workspace_aircover_action(input), reached through workspace_teams_action:
--      flagAirCover {workId, title?, amountMinor?, reference?}
--    Any team role that can work the ticket (workspace_can_work), or accounts and admins (who keep AirCover
--    claims in the hub and see every property), can flag a maintenance or routine_visit ticket. The claim starts at
--    'to_claim' with the ticket's title and property (and its stay when the ticket names one). Accounts
--    and admins are notified. The client (owner) role is refused. Idempotent through the action receipts.
-- 3. private.workspace_aircover_read(target_property), reached through workspace_teams_read('aircover'):
--    everyone who keeps AirCover claims (stays, accounts, admins) sees every claim, any other team role
--    sees only the claims they flagged. Each claim carries the linked issue (title, repair type, status,
--    phase), the property name and address, the amount, what was settled and its stage. Status changes
--    keep using moveHubItem. The hub view also returns workId.
--
-- Safe to run more than once: the column, indexes, constraint and trigger are guarded, and every patch of an
-- existing function is skipped once its sentinel is present. Each anchor must occur exactly once.
alter table private.workspace_hub_items
 add column if not exists work_id uuid references public.workspace_work_items(id) on delete set null;
create index if not exists workspace_hub_items_work_idx on private.workspace_hub_items(work_id) where work_id is not null;
create unique index if not exists workspace_hub_items_live_claim_idx on private.workspace_hub_items(work_id)
 where work_id is not null and kind='aircover' and status in ('to_claim','claimed');
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_work_only_aircover' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_work_only_aircover check(work_id is null or kind='aircover');
 end if;
end $$;

create or replace function private.workspace_hub_claim_guard() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.kind='aircover' and new.work_id is not null and new.status in ('to_claim','claimed')
  and exists(select 1 from private.workspace_hub_items i where i.work_id=new.work_id and i.kind='aircover' and i.status in ('to_claim','claimed') and i.id<>new.id) then
  raise exception 'This issue already has an AirCover claim in progress' using errcode='23505';
 end if;
 return new;
end $fn$;
revoke all on function private.workspace_hub_claim_guard() from public,anon,authenticated;
drop trigger if exists workspace_hub_claim_guard on private.workspace_hub_items;
create trigger workspace_hub_claim_guard before insert or update of status,work_id on private.workspace_hub_items for each row execute function private.workspace_hub_claim_guard();

-- 2. The action.
create or replace function private.workspace_aircover_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;item private.workspace_hub_items;txt text;amount bigint;ref text;stay uuid;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if input->>'action' is distinct from 'flagAirCover' then raise exception 'Unknown AirCover action' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 perform private.workspace_json_keys(input,array['action','requestId','workId','title','amountMinor','reference']);
 if jsonb_typeof(input->'workId') is distinct from 'string' then raise exception 'Choose the issue to claim for' using errcode='22023';end if;
 select * into w from public.workspace_work_items x where x.id=(input->>'workId')::uuid;
 if w.id is null or not (private.workspace_can_work(w.id) or (private.workspace_hub_keeps('aircover') and actor in ('accounts','admin','super_admin'))) then raise exception 'Record not found' using errcode='P0002';end if;
 select * into d from private.workspace_domain_details x where x.work_id=w.id;
 if d.work_id is null or d.kind not in ('maintenance','routine_visit') then raise exception 'Only a maintenance ticket can be flagged as a claim' using errcode='22023';end if;
 if exists(select 1 from private.workspace_hub_items i where i.work_id=w.id and i.kind='aircover' and i.status in ('to_claim','claimed')) then
  raise exception 'This issue already has an AirCover claim in progress' using errcode='23505';
 end if;
 txt:=case when input ? 'title' and input->>'title' is not null then private.workspace_required_text(input,'title',2,200) else left(trim(w.title),200) end;
 amount:=case when input ? 'amountMinor' and input->>'amountMinor' is not null then private.workspace_money(input,'amountMinor') end;
 if input ? 'reference' and input->>'reference' is not null and (jsonb_typeof(input->'reference')<>'string' or length(input->>'reference')>120) then raise exception 'The reference is too long' using errcode='22023';end if;
 ref:=coalesce(trim(input->>'reference'),'');
 stay:=(select r.id from private.workspace_reservations r where r.id::text=d.data->>'reservationId');
 insert into private.workspace_hub_items(kind,title,details,property_id,amount_minor,reference,status,created_by,work_id,reservation_id)
  values('aircover',txt,'',w.property_id,amount,ref,'to_claim',auth.uid(),w.id,stay) returning * into item;
 result:=private.workspace_hub_view(item)||jsonb_build_object('workId',item.work_id);
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'aircover.flagged') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
  select p.user_id,w.id,event_id from public.workspace_profiles p where p.status='active' and p.role in ('accounts','admin','super_admin') and p.user_id is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- 3. The read.
create or replace function private.workspace_aircover_read(target_property uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();keeps boolean;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 keeps:=private.workspace_hub_keeps('aircover');
 return jsonb_build_object('section','aircover','canManage',keeps,
  'claims',coalesce((select jsonb_agg(c.j order by c.rank,c.created_at desc,c.id) from (
   select i.id,i.created_at,case when i.status in ('to_claim','claimed') then 0 else 1 end rank,
    jsonb_build_object('itemId',i.id,'version',i.version,'title',i.title,'details',i.details,'reference',i.reference,'status',i.status,
     'amountMinor',i.amount_minor,'settledMinor',i.settled_minor,'outcomeNote',i.outcome_note,'decidedAt',i.decided_at,
     'createdAt',i.created_at,'updatedAt',i.updated_at,'mine',i.created_by=auth.uid(),
     'flaggedBy',(select f.full_name from public.workspace_profiles f where f.user_id=i.created_by),
     'propertyId',coalesce(w.property_id,i.property_id),'propertyName',p.name,'address',p.address,
     'reservationId',i.reservation_id,'workId',i.work_id,
     'issue',case when w.id is not null then jsonb_build_object('workId',w.id,'title',w.title,'kind',d.kind,'status',w.status,'phase',d.data->>'phase',
       'repairType',d.data->>'repairType','urgent',coalesce((d.data->>'urgent')::boolean,false),'dueOn',w.due_on,'version',w.version,'updatedAt',w.updated_at) end) j
   from private.workspace_hub_items i
   left join public.workspace_work_items w on w.id=i.work_id
   left join private.workspace_domain_details d on d.work_id=w.id
   left join public.workspace_properties p on p.id=coalesce(w.property_id,i.property_id)
   where i.kind='aircover' and (keeps or i.created_by=auth.uid())
    and (target_property is null or coalesce(w.property_id,i.property_id)=target_property)
    and (i.status in ('to_claim','claimed') or i.updated_at>now()-interval '90 days')
   order by case when i.status in ('to_claim','claimed') then 0 else 1 end,i.created_at desc,i.id limit 500) c),'[]'::jsonb));
end $fn$;
revoke all on function private.workspace_aircover_action(jsonb),private.workspace_aircover_read(uuid) from public,anon,authenticated;

-- 4. Patch the hub view and the teams routes from their latest definitions.
do $$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'clientId',item.client_id,$q$,
   $q$'clientId',item.client_id,'workId',item.work_id,$q$,
   $q$'workId',item.work_id$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read(); elsif section='aircover' then result:=private.workspace_aircover_read(target_property);$q$,
   $q$private.workspace_aircover_read(target_property)$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a='flagAirCover' then return private.workspace_aircover_action(input);end if;$q$,
   $q$private.workspace_aircover_action(input)$q$]
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
