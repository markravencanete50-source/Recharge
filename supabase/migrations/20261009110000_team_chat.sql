-- Chat inside Recharge. Team members message each other one to one or in groups (optionally
-- about a property or a job), and each owner has one conversation with Recharge. The owner side
-- is answered by client relations, management, admins and the Stays team on the owner's
-- properties. Owner messages are timed like guest messages (green/amber/red) and credited to
-- whoever was clocked in to client relations, which gives the client relations score.
-- Everything goes through the functions below; people never read the tables directly.

create table if not exists private.chat_conversations (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('direct','group','owner')),
 title text check(title is null or char_length(trim(title)) between 2 and 80),
 owner_id uuid references public.workspace_profiles(user_id) on delete cascade,
 property_id uuid references public.workspace_properties(id) on delete set null,
 work_id uuid references public.workspace_work_items(id) on delete set null,
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 last_message_at timestamptz not null default now(),
 check((kind='owner')=(owner_id is not null))
);
create unique index if not exists chat_owner_one_idx on private.chat_conversations(owner_id) where kind='owner';
create table if not exists private.chat_members (
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
create index if not exists chat_members_user_idx on private.chat_members(user_id);
create table if not exists private.chat_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 author_id uuid not null references public.workspace_profiles(user_id),
 body text not null check(char_length(trim(body)) between 1 and 4000),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 unique(author_id,request_id)
);
create index if not exists chat_messages_conversation_idx on private.chat_messages(conversation_id,created_at desc);
create table if not exists private.chat_reads (
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 last_read_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
do $$ declare t text; begin
 foreach t in array array['chat_conversations','chat_members','chat_messages','chat_reads'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

create or replace function private.chat_is_team(subject uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_profiles where user_id=subject and status='active' and role<>'client');
$$;
-- Who answers an owner: admins, client relations and management, and Stays on the owner's properties.
create or replace function private.chat_owner_team(owner uuid, subject uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_profiles p where p.user_id=subject and p.status='active' and (
  p.role in ('admin','super_admin')
  or exists(select 1 from private.workspace_staff_rota r where r.user_id=subject and r.department in ('client_relations','management') and p.role<>'cleans')
  or (p.role='stays' and exists(select 1 from public.workspace_property_assignments a join public.workspace_property_assignments o on o.property_id=a.property_id
     where a.user_id=subject and a.assignment='staff' and o.user_id=owner and o.assignment='client'))));
$$;
create or replace function private.chat_can(target uuid, subject uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.chat_conversations c join public.workspace_profiles p on p.user_id=subject and p.status='active' where c.id=target and (
  exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=subject)
  or (c.kind='owner' and private.chat_owner_team(c.owner_id,subject))));
$$;
-- Everyone who should hear about a new message in a conversation, apart from its author.
create or replace function private.chat_audience(target uuid) returns setof uuid language sql stable security definer set search_path='' as $$
 select m.user_id from private.chat_members m join public.workspace_profiles p on p.user_id=m.user_id and p.status='active' where m.conversation_id=target
 union
 select p.user_id from private.chat_conversations c join public.workspace_profiles p on p.status='active' and p.role<>'client'
 where c.id=target and c.kind='owner' and private.chat_owner_team(c.owner_id,p.user_id);
$$;

create or replace function private.chat_summary(c private.chat_conversations, me uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'kind',c.kind,'propertyId',c.property_id,'workId',c.work_id,'lastMessageAt',c.last_message_at,
  'title',case when c.kind='group' then c.title
   when c.kind='owner' then case when c.owner_id=me then 'Recharge' else coalesce((select full_name from public.workspace_profiles where user_id=c.owner_id),'Owner') end
   else coalesce((select string_agg(p.full_name,', ' order by p.full_name) from private.chat_members m join public.workspace_profiles p on p.user_id=m.user_id where m.conversation_id=c.id and m.user_id<>me),'Just you') end,
  'subtitle',case when c.kind='owner' and c.owner_id<>me then 'Owner' when c.kind='group' then (select count(*)||' people' from private.chat_members m where m.conversation_id=c.id) else null end,
  'propertyName',(select name from public.workspace_properties where id=c.property_id),
  'last',(select jsonb_build_object('body',left(x.body,140),'authorName',case when x.author_id=me then 'You' else (select full_name from public.workspace_profiles where user_id=x.author_id) end,'at',x.created_at)
    from private.chat_messages x where x.conversation_id=c.id order by x.created_at desc limit 1),
  'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me
    and x.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=c.id and r.user_id=me),'-infinity')));
$$;

create or replace function private.workspace_chat_read(section text, target uuid default null, before_at timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();owner_side boolean;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if section='list' then
  return coalesce((select jsonb_agg(private.chat_summary(c,me) order by c.last_message_at desc) from private.chat_conversations c
   where exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me) or (c.kind='owner' and actor<>'client' and private.chat_owner_team(c.owner_id,me))),'[]');
 elsif section='messages' then
  if target is null or not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  owner_side:=(select owner_id=me from private.chat_conversations where id=target and kind='owner');
  return jsonb_build_object('conversation',(select private.chat_summary(c,me) from private.chat_conversations c where c.id=target),
   'messages',coalesce((select jsonb_agg(item order by item->>'at') from (
    select jsonb_build_object('id',x.id,'body',x.body,'at',x.created_at,'mine',x.author_id=me,
     'authorName',case when x.author_id=me then 'You' when coalesce(owner_side,false) then 'Recharge · '||split_part(p.full_name,' ',1) else p.full_name end,
     'fromOwner',x.author_id=(select owner_id from private.chat_conversations where id=target)) item
    from private.chat_messages x join public.workspace_profiles p on p.user_id=x.author_id
    where x.conversation_id=target and (before_at is null or x.created_at<before_at) order by x.created_at desc limit 60) recent),'[]'));
 elsif section='people' then
  -- Who a team member can start a conversation with, and the owners they look after.
  if actor='client' then return jsonb_build_object('team','[]'::jsonb,'owners','[]'::jsonb);end if;
  return jsonb_build_object(
   'team',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role) order by p.full_name) from public.workspace_profiles p
     where p.status='active' and p.role<>'client' and p.user_id<>me and p.full_name<>''),'[]'),
   'owners',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role) order by p.full_name) from public.workspace_profiles p
     where p.status='active' and p.role='client' and private.chat_owner_team(p.user_id,me)),'[]'));
 elsif section='unread' then
  return to_jsonb((select count(*) from private.chat_conversations c join private.chat_messages x on x.conversation_id=c.id and x.author_id<>me
   where (exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me) or (c.kind='owner' and actor<>'client' and private.chat_owner_team(c.owner_id,me)))
    and x.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=c.id and r.user_id=me),'-infinity')));
 end if;
 raise exception 'Unknown chat section' using errcode='22023';
end $$;

create or replace function private.workspace_chat_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();a text:=input->>'action';target uuid;other uuid;conv private.chat_conversations;
 people uuid[];msg private.chat_messages;ev bigint;previous timestamptz;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if a='startDirect' then
  perform private.workspace_json_keys(input,array['action','userId']);
  other:=(input->>'userId')::uuid;
  if actor='client' or other=me or not private.chat_is_team(other) then raise exception 'Choose someone on the team' using errcode='22023';end if;
  select c.* into conv from private.chat_conversations c where c.kind='direct'
   and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me)
   and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=other)
   and (select count(*) from private.chat_members m where m.conversation_id=c.id)=2 limit 1;
  if not found then
   insert into private.chat_conversations(kind,created_by) values('direct',me) returning * into conv;
   insert into private.chat_members(conversation_id,user_id) values(conv.id,me),(conv.id,other);
  end if;
  return private.chat_summary(conv,me);
 elsif a='startGroup' then
  perform private.workspace_json_keys(input,array['action','title','userIds','propertyId','workId']);
  if actor='client' then raise exception 'Team members start group conversations' using errcode='42501';end if;
  if jsonb_typeof(input->'userIds') is distinct from 'array' or jsonb_array_length(input->'userIds') not between 1 and 50 then raise exception 'Choose who to add' using errcode='22023';end if;
  people:=array(select distinct (value#>>'{}')::uuid from jsonb_array_elements(input->'userIds'));
  if exists(select 1 from unnest(people) u where not private.chat_is_team(u)) then raise exception 'Only team members can be added' using errcode='22023';end if;
  if input->>'propertyId' is not null and not (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments x where x.user_id=me and x.property_id=(input->>'propertyId')::uuid)) then raise exception 'Property not found' using errcode='42501';end if;
  if input->>'workId' is not null and not private.workspace_operation_access((input->>'workId')::uuid) then raise exception 'Job not found' using errcode='42501';end if;
  insert into private.chat_conversations(kind,title,property_id,work_id,created_by) values('group',trim(input->>'title'),(input->>'propertyId')::uuid,(input->>'workId')::uuid,me) returning * into conv;
  insert into private.chat_members(conversation_id,user_id) select conv.id,u from unnest(array_append(people,me)) u on conflict do nothing;
  return private.chat_summary(conv,me);
 elsif a='startOwner' then
  -- An owner opens their conversation with Recharge; the team opens one with an owner they look after.
  perform private.workspace_json_keys(input,array['action','ownerId']);
  other:=case when actor='client' then me else (input->>'ownerId')::uuid end;
  if other is null or not exists(select 1 from public.workspace_profiles where user_id=other and role='client' and status='active') or (actor<>'client' and not private.chat_owner_team(other,me)) then raise exception 'Owner not found' using errcode='42501';end if;
  select * into conv from private.chat_conversations where kind='owner' and owner_id=other;
  if not found then
   insert into private.chat_conversations(kind,owner_id,created_by) values('owner',other,me) on conflict do nothing returning * into conv;
   if conv.id is null then select * into conv from private.chat_conversations where kind='owner' and owner_id=other;end if;
   insert into private.chat_members(conversation_id,user_id) values(conv.id,other) on conflict do nothing;
  end if;
  return private.chat_summary(conv,me);
 elsif a='send' then
  perform private.workspace_json_keys(input,array['action','requestId','conversationId','body']);
  target:=(input->>'conversationId')::uuid;
  if not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  if char_length(trim(coalesce(input->>'body','')))=0 or char_length(input->>'body')>4000 then raise exception 'Write a message of up to 4,000 characters' using errcode='22023';end if;
  select * into msg from private.chat_messages where author_id=me and request_id=(input->>'requestId')::uuid;
  if found then return jsonb_build_object('id',msg.id,'at',msg.created_at);end if;
  previous:=(select max(created_at) from private.chat_messages where conversation_id=target);
  insert into private.chat_messages(conversation_id,author_id,body,request_id) values(target,me,trim(input->>'body'),(input->>'requestId')::uuid) returning * into msg;
  update private.chat_conversations set last_message_at=msg.created_at where id=target returning * into conv;
  insert into private.chat_reads(conversation_id,user_id,last_read_at) values(target,me,msg.created_at) on conflict(conversation_id,user_id) do update set last_read_at=excluded.last_read_at;
  -- People are notified once per conversation until they read it, not for every message.
  insert into public.workspace_activity(actor_id,property_id,event_type) values(me,conv.property_id,case when conv.kind='owner' and conv.owner_id=me then 'chat.owner_message' else 'chat.message' end) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select u,ev from private.chat_audience(target) u where u<>me
    and coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=target and r.user_id=u),'-infinity')>=coalesce(previous,'-infinity')
   on conflict do nothing;
  return jsonb_build_object('id',msg.id,'at',msg.created_at);
 elsif a='markRead' then
  perform private.workspace_json_keys(input,array['action','conversationId']);
  target:=(input->>'conversationId')::uuid;
  if not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  insert into private.chat_reads(conversation_id,user_id,last_read_at) values(target,me,now()) on conflict(conversation_id,user_id) do update set last_read_at=greatest(private.chat_reads.last_read_at,excluded.last_read_at);
  return jsonb_build_object('read',true);
 end if;
 raise exception 'Unknown chat action' using errcode='22023';
end $$;

-- Client relations: each owner message that starts a wait, graded by how long the team took to
-- reply, and credited to whoever was clocked in to client relations when it arrived.
create or replace function private.workspace_client_response_rows(lower_at timestamptz,upper_at timestamptz) returns table(message_id uuid,sent_at timestamptz,minutes numeric,grade text,user_id uuid)
language sql stable security definer set search_path='' as $$
 with t as (select * from private.workspace_performance_targets where singleton),
 m as (select x.id,x.conversation_id,x.created_at,(x.author_id=c.owner_id) from_owner,
   lag(x.author_id=c.owner_id) over(partition by x.conversation_id order by x.created_at,x.id) prev_owner
  from private.chat_messages x join private.chat_conversations c on c.id=x.conversation_id and c.kind='owner'
  where x.created_at<upper_at and x.created_at>=lower_at-interval '1 day'),
 asks as (select m.id,m.created_at,(select min(r.created_at) from private.chat_messages r join private.chat_conversations c on c.id=r.conversation_id
   where r.conversation_id=m.conversation_id and r.author_id<>c.owner_id and r.created_at>=m.created_at) replied_at
  from m where m.from_owner and (m.prev_owner is null or not m.prev_owner) and m.created_at>=lower_at),
 timed as (select a.id,a.created_at,a.replied_at,extract(epoch from coalesce(a.replied_at,now())-a.created_at)/60 mins from asks a)
 select x.id,x.created_at,round(x.mins::numeric,1),
  case when x.mins<=t.green_minutes then 'green' when x.mins<=t.amber_minutes then 'amber' else 'red' end,
  (select s.user_id from private.workspace_shifts s where s.department='client_relations' and s.clocked_in_at<=x.created_at and (s.clocked_out_at is null or s.clocked_out_at>x.created_at) order by s.clocked_in_at limit 1)
 from timed x cross join t
 where x.replied_at is not null or x.mins>t.amber_minutes;
$$;
create or replace function private.workspace_client_relations_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;t private.workspace_performance_targets;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 admin:=actor in ('admin','super_admin');
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>92 then raise exception 'Choose up to 92 days' using errcode='22023';end if;
 lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
 select * into t from private.workspace_performance_targets where singleton;
 return jsonb_build_object(
  'ownerMessages',(select count(*) from private.chat_messages x join private.chat_conversations c on c.id=x.conversation_id and c.kind='owner' and x.author_id=c.owner_id where x.created_at>=lower_at and x.created_at<upper_at and admin),
  'overall',(select jsonb_build_object('green',count(*) filter(where r.grade='green'),'amber',count(*) filter(where r.grade='amber'),'red',count(*) filter(where r.grade='red'))
    from private.workspace_client_response_rows(lower_at,upper_at) r where admin),
  'people',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'green',r.green,'amber',r.amber,'red',r.red,
     'percentGreen',case when r.total>0 then floor(r.green*100.0/r.total)::int end,'onTrack',case when r.total>0 then r.green*100.0/r.total>=t.pass_percent end,
     'bonusTier',case when r.total>0 then (select max(b) from unnest(t.bonus_percents) b where r.green*100.0/r.total>=b) end) order by p.full_name)
   from public.workspace_profiles p cross join lateral (select count(*) filter(where x.grade='green') green,count(*) filter(where x.grade='amber') amber,count(*) filter(where x.grade='red') red,count(*) total
     from private.workspace_client_response_rows(lower_at,upper_at) x where x.user_id=p.user_id) r
   where p.status='active' and p.role<>'client' and r.total>0 and (admin or p.user_id=auth.uid())),'[]'));
end $$;

create or replace function public.workspace_chat_read(section text, target uuid default null, before_at timestamptz default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_chat_read(section,target,before_at);$$;
create or replace function public.workspace_chat_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_chat_action(input);$$;
create or replace function public.workspace_client_relations_read(start_on date,end_on date) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_relations_read(start_on,end_on);$$;
revoke all on function private.chat_is_team(uuid),private.chat_owner_team(uuid,uuid),private.chat_can(uuid,uuid),private.chat_audience(uuid),private.chat_summary(private.chat_conversations,uuid),
 private.workspace_client_response_rows(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function private.workspace_chat_read(text,uuid,timestamptz),private.workspace_chat_action(jsonb),private.workspace_client_relations_read(date,date),
 public.workspace_chat_read(text,uuid,timestamptz),public.workspace_chat_action(jsonb),public.workspace_client_relations_read(date,date) from public,anon;
grant execute on function private.workspace_chat_read(text,uuid,timestamptz),private.workspace_chat_action(jsonb),private.workspace_client_relations_read(date,date),
 public.workspace_chat_read(text,uuid,timestamptz),public.workspace_chat_action(jsonb),public.workspace_client_relations_read(date,date) to authenticated;
