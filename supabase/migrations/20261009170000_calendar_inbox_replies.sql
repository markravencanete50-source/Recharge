-- Calendar, unified inbox, saved replies and property team conversations.
-- 1. Payment runs on the calendar: the shared schedule also returns owner statements (to issue,
--    issued and paid) for admins and accounts. Owners and cleaners never get them.
-- 2. Saved replies: short, editable answers for guests and owners. Everyone with the guest inbox
--    (and admins) uses them; admins and the Stays team keep the list. Nothing is seeded.
-- 3. Property team conversations: one group conversation per property (or per job) with the
--    team on that property, started from a job or a day on the calendar.
-- Written without "select ... into" so it can be pasted into the Supabase SQL editor. Safe to run more than once.

-- 1. Payment runs on the schedule ----------------------------------------------------------------
-- Each statement sits on the day it was paid, else the day it was issued, else (a draft) the first
-- day after its month, when it is due to be issued.
create or replace function private.workspace_schedule_payments(start_on date, end_on date, target_property uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when coalesce(private.workspace_actor_role() in ('admin','super_admin','accounts'),false) then coalesce((
  select jsonb_agg(x.item order by x.item->>'date',x.item->>'propertyName',x.item->>'statementId') from (
   select jsonb_build_object('statementId',s.id,'propertyId',s.property_id,'propertyName',p.name,'period',to_char(s.period_start,'YYYY-MM'),'status',s.status,
    'payoutMinor',s.payout_minor,'date',s.on_day,'issuedAt',s.issued_at,'paidAt',s.paid_at,'reference',s.payout_reference) item
   from (select o.*,coalesce((o.paid_at at time zone 'Europe/London')::date,(o.issued_at at time zone 'Europe/London')::date,(o.period_start+interval '1 month')::date) on_day
     from private.workspace_owner_statements o where o.status in ('draft','issued','paid') and (target_property is null or o.property_id=target_property)) s
   join public.workspace_properties p on p.id=s.property_id
   where s.on_day between start_on and end_on and private.workspace_can_property(s.property_id,'owner-statements')
   order by s.on_day,s.id limit 500) x),'[]'::jsonb) else '[]'::jsonb end;
$$;
revoke all on function private.workspace_schedule_payments(date,date,uuid) from public,anon,authenticated;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$select jsonb_build_object('from',start_on,'to',end_on,$q$,
   $q$select jsonb_build_object('from',start_on,'to',end_on,'payments',private.workspace_schedule_payments(start_on,end_on,target_property),$q$,
   $q$private.workspace_schedule_payments(start_on,end_on,target_property)$q$]
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

-- 2. Saved replies -------------------------------------------------------------------------------
create table if not exists private.workspace_saved_replies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(trim(title)) between 2 and 80),
 body text not null check(char_length(trim(body)) between 2 and 2000),
 audience text not null default 'all' check(audience in ('guest','owner','all')),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index if not exists workspace_saved_replies_created_by_idx on private.workspace_saved_replies(created_by);
create index if not exists workspace_saved_replies_updated_by_idx on private.workspace_saved_replies(updated_by);
alter table private.workspace_saved_replies enable row level security;
revoke all on private.workspace_saved_replies from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_saved_replies;
create trigger business_write_limit before insert or update or delete on private.workspace_saved_replies for each row execute function private.workspace_enforce_write_limit();

-- Who uses them: admins, and team members with the guest inbox (who also answer owners).
create or replace function private.saved_replies_can_read() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_actor_role() not in ('client','cleans') and private.has_workspace_module('guest-communication')),false);
$$;
create or replace function private.saved_reply_json(r private.workspace_saved_replies) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'title',r.title,'body',r.body,'audience',r.audience,'version',r.version,'updatedAt',r.updated_at,
  'updatedBy',(select p.full_name from public.workspace_profiles p where p.user_id=coalesce(r.updated_by,r.created_by)));
$$;
create or replace function private.workspace_saved_replies_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.saved_replies_can_read() then raise exception 'Saved replies are for the guest inbox team' using errcode='42501';end if;
 return jsonb_build_object('canEdit',coalesce(private.workspace_actor_role() in ('admin','super_admin','stays'),false),
  'replies',coalesce((select jsonb_agg(private.saved_reply_json(r) order by lower(r.title),r.id) from private.workspace_saved_replies r),'[]'));
end $$;
create or replace function private.workspace_saved_replies_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=input->>'action';target uuid:=(input->>'replyId')::uuid;r private.workspace_saved_replies;begin
 if not private.saved_replies_can_read() or coalesce(private.workspace_actor_role() not in ('admin','super_admin','stays'),true) then
  raise exception 'Only admins and the Stays team change saved replies' using errcode='42501';end if;
 if a='saveReply' then
  perform private.workspace_json_keys(input,array['action','replyId','version','title','body','audience']);
  if char_length(trim(coalesce(input->>'title',''))) not between 2 and 80 then raise exception 'Give the reply a title of 2 to 80 characters' using errcode='22023';end if;
  if char_length(trim(coalesce(input->>'body',''))) not between 2 and 2000 then raise exception 'Write a reply of 2 to 2,000 characters' using errcode='22023';end if;
  if coalesce(input->>'audience','') not in ('guest','owner','all') then raise exception 'Choose who the reply is for' using errcode='22023';end if;
  if target is null then
   insert into private.workspace_saved_replies(title,body,audience,created_by) values(trim(input->>'title'),trim(input->>'body'),input->>'audience',auth.uid()) returning * into r;
  else
   update private.workspace_saved_replies set title=trim(input->>'title'),body=trim(input->>'body'),audience=input->>'audience',updated_by=auth.uid(),updated_at=now(),version=version+1
    where id=target and version=(input->>'version')::integer returning * into r;
  end if;
 elsif a='deleteReply' then
  perform private.workspace_json_keys(input,array['action','replyId','version']);
  delete from private.workspace_saved_replies where id=target and version=(input->>'version')::integer returning * into r;
 else raise exception 'Unknown saved reply action' using errcode='22023';end if;
 if r.id is null then
  if exists(select 1 from private.workspace_saved_replies where id=target) then raise exception 'Someone else changed this reply. Refresh and try again' using errcode='40001';end if;
  raise exception 'Saved reply not found' using errcode='P0002';
 end if;
 if a='deleteReply' then return jsonb_build_object('id',r.id,'deleted',true);end if;
 return private.saved_reply_json(r);
end $$;
revoke all on function private.saved_replies_can_read(),private.saved_reply_json(private.workspace_saved_replies),
 private.workspace_saved_replies_read(),private.workspace_saved_replies_action(jsonb) from public,anon,authenticated;

-- 3. Property team conversations -----------------------------------------------------------------
alter table private.chat_conversations add column if not exists property_team boolean not null default false;
create index if not exists chat_conversations_property_team_idx on private.chat_conversations(property_id,work_id) where property_team;

-- Finds or starts the team conversation for a property (or one job there). Its members: the
-- caller, the Stays and Ready staff and cleaning managers assigned to the property, and the job's
-- assignee. Other cleaners and admins are only added when they start it themselves. Anyone
-- already in it stays; people newly assigned are added when it is opened again.
create or replace function private.chat_start_property(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();prop uuid;wid uuid;w public.workspace_work_items;conv private.chat_conversations;
 people uuid[];new_id uuid:=gen_random_uuid();label text;begin
 perform private.workspace_json_keys(input,array['action','propertyId','workId']);
 prop:=(input->>'propertyId')::uuid;wid:=(input->>'workId')::uuid;
 if actor is null or actor='client' or prop is null or not exists(select 1 from public.workspace_properties where id=prop)
  or not (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments x where x.property_id=prop and x.user_id=me and x.assignment in ('staff','cleaning_manager','cleaner')))
 then raise exception 'Property not found' using errcode='42501';end if;
 if wid is not null then
  w:=(select x from public.workspace_work_items x where x.id=wid);
  if w.id is null or w.property_id<>prop or not private.workspace_operation_access(wid) then raise exception 'Job not found' using errcode='42501';end if;
 end if;
 people:=array(
  select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id and p.status='active'
   where a.property_id=prop and ((a.assignment='staff' and p.role in ('stays','ready')) or (a.assignment='cleaning_manager' and p.role='cleaning_manager'))
  union select w.assignee_id where w.assignee_id is not null and private.chat_is_team(w.assignee_id)
  union select me);
 perform pg_advisory_xact_lock(hashtextextended('chat-property:'||prop::text||':'||coalesce(wid::text,''),0));
 conv:=(select c from private.chat_conversations c where c.property_team and c.kind='group' and c.property_id=prop and c.work_id is not distinct from wid order by c.created_at,c.id limit 1);
 if conv.id is null then
  label:=(select left(case when w.id is null then p.name||' team' else w.title||' · '||p.name end,80) from public.workspace_properties p where p.id=prop);
  insert into private.chat_conversations(id,kind,title,property_id,work_id,created_by,property_team) values(new_id,'group',label,prop,wid,me,true);
  conv:=(select c from private.chat_conversations c where c.id=new_id);
 end if;
 insert into private.chat_members(conversation_id,user_id) select conv.id,u from unnest(people) u on conflict do nothing;
 return private.chat_summary(conv,me);
end $$;
revoke all on function private.chat_start_property(jsonb) from public,anon,authenticated;

-- Messages routes the new actions and the saved replies list (added before the "unknown" errors).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_chat_action(jsonb)',
   $q$raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$if a='startProperty' then return private.chat_start_property(input);end if;
 if a in ('saveReply','deleteReply') then return private.workspace_saved_replies_action(input);end if;
 raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$private.chat_start_property(input)$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$raise exception 'Unknown chat section' using errcode='22023';$q$,
   $q$if section='savedReplies' then return private.workspace_saved_replies_read();end if;
 raise exception 'Unknown chat section' using errcode='22023';$q$,
   $q$private.workspace_saved_replies_read()$q$]
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
