-- Team channels in Messages: one always-there conversation for everyone, and one for each
-- department (Management, Guest relations, Client relations, Cleaning, Ready, Accounts). A person
-- is in their department's channel by their rota department, or by their role if they have none;
-- admins can read every channel. Admins are told only about Management and Everyone; each person
-- is told once per channel until they read it, like any other conversation.

alter table private.chat_conversations add column if not exists department text check(department is null or department in ('all','management','guest_relations','client_relations','cleaning','ready','accounts'));
create unique index if not exists chat_team_channel_idx on private.chat_conversations(department) where department is not null;

create or replace function private.chat_in_channel(dept text, subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.workspace_profiles p where p.user_id=subject and p.status='active' and p.role<>'client' and (
  dept='all' or p.role in ('admin','super_admin')
  or exists(select 1 from private.workspace_staff_rota r where r.user_id=subject and r.department=dept)
  or (not exists(select 1 from private.workspace_staff_rota r where r.user_id=subject) and (
   (p.role in ('cleans','cleaning_manager') and dept='cleaning') or (p.role='ready' and dept='ready') or (p.role='accounts' and dept='accounts')
   or (p.role='stays' and dept in ('guest_relations','client_relations'))))))
$fn$;
revoke all on function private.chat_in_channel(text,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.chat_can(target uuid, subject uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.chat_conversations c join public.workspace_profiles p on p.user_id=subject and p.status='active' where c.id=target and (
  exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=subject)
  or (c.kind='owner' and private.chat_owner_team(c.owner_id,subject))
  or (c.department is not null and private.chat_in_channel(c.department,subject))));
$function$
;

CREATE OR REPLACE FUNCTION private.chat_audience(target uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select m.user_id from private.chat_members m join public.workspace_profiles p on p.user_id=m.user_id and p.status='active' where m.conversation_id=target
 union
 select p.user_id from private.chat_conversations c join public.workspace_profiles p on p.status='active' and p.role<>'client'
 where c.id=target and c.kind='owner' and private.chat_owner_team(c.owner_id,p.user_id)
 union
 -- A team channel is heard by everyone in it, except that admins only hear Management and Everyone.
 select p.user_id from private.chat_conversations c join public.workspace_profiles p on p.status='active' and p.role<>'client'
 where c.id=target and c.department is not null and private.chat_in_channel(c.department,p.user_id)
  and (p.role not in ('admin','super_admin') or c.department in ('management','all'));
$function$
;

CREATE OR REPLACE FUNCTION private.chat_summary(c private.chat_conversations, me uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',c.id,'kind',c.kind,'department',c.department,'propertyId',c.property_id,'workId',c.work_id,'lastMessageAt',c.last_message_at,
  'title',case when c.kind='group' then c.title
   when c.kind='owner' then case when c.owner_id=me then 'Recharge' else coalesce((select full_name from public.workspace_profiles where user_id=c.owner_id),'Owner') end
   else coalesce((select string_agg(p.full_name,', ' order by p.full_name) from private.chat_members m join public.workspace_profiles p on p.user_id=m.user_id where m.conversation_id=c.id and m.user_id<>me),'Just you') end,
  'subtitle',case when c.kind='owner' and c.owner_id<>me then 'Owner' when c.department='all' then 'The whole team' when c.department is not null then 'Team channel' when c.kind='group' then (select count(*)||' people' from private.chat_members m where m.conversation_id=c.id) else null end,
  'propertyName',(select name from public.workspace_properties where id=c.property_id),
  -- Mine: the reader is in it (their own conversation, a member, or has written in it), or looks after the owner's property.
  'mine',((c.department is not null and private.chat_in_channel(c.department,me)) or c.owner_id=me or (c.kind<>'owner' and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me))
   or exists(select 1 from private.chat_messages x where x.conversation_id=c.id and x.author_id=me)
   or (c.kind='owner' and exists(select 1 from public.workspace_property_assignments a join public.workspace_property_assignments o on o.property_id=a.property_id
    where a.user_id=me and a.assignment='staff' and o.user_id=c.owner_id and o.assignment='client'))),
  -- The properties it is about: the owner's properties the reader can see, or the conversation's property.
  'propertyIds',coalesce(case when c.kind='owner' then (select jsonb_agg(a.property_id order by a.property_id) from public.workspace_property_assignments a join public.workspace_properties wp on wp.id=a.property_id
    where a.user_id=c.owner_id and a.assignment='client' and wp.status<>'archived' and (c.owner_id=me or (select role from public.workspace_profiles where user_id=me) in ('admin','super_admin')
     or exists(select 1 from public.workspace_property_assignments s where s.property_id=a.property_id and s.user_id=me)))
   when c.property_id is not null then jsonb_build_array(c.property_id) end,'[]'::jsonb),
  'last',(select jsonb_build_object('body',left(x.body,140),'fromOwner',coalesce(x.author_id=c.owner_id,false),'authorName',case when x.author_id=me then 'You' else (select full_name from public.workspace_profiles where user_id=x.author_id) end,'at',x.created_at)
    from private.chat_messages x where x.conversation_id=c.id order by x.created_at desc limit 1),
  'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me
    and x.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=c.id and r.user_id=me),'-infinity')));
$function$
;

CREATE OR REPLACE FUNCTION private.workspace_chat_read(section text, target uuid DEFAULT NULL::uuid, before_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();owner_side boolean;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if section='list' then
  return coalesce((select jsonb_agg(private.chat_summary(c,me) order by c.last_message_at desc) from private.chat_conversations c
   where exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me) or (c.kind='owner' and actor<>'client' and private.chat_owner_team(c.owner_id,me))
    or (c.department is not null and private.chat_in_channel(c.department,me))),'[]');
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
   where (exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me) or (c.kind='owner' and actor<>'client' and private.chat_owner_team(c.owner_id,me))
    or (c.department is not null and private.chat_in_channel(c.department,me)))
    and x.created_at>coalesce((select r.last_read_at from private.chat_reads r where r.conversation_id=c.id and r.user_id=me),'-infinity')));
 end if;
 if section='savedReplies' then return private.workspace_saved_replies_read();end if;
 raise exception 'Unknown chat section' using errcode='22023';
end $function$
;

CREATE OR REPLACE FUNCTION private.workspace_chat_action(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();a text:=input->>'action';target uuid;other uuid;conv private.chat_conversations;
 people uuid[];msg private.chat_messages;ev bigint;previous timestamptz;new_id uuid:=gen_random_uuid();
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if a='startDirect' then
  perform private.workspace_json_keys(input,array['action','userId']);
  other:=(input->>'userId')::uuid;
  if actor='client' or other=me or not private.chat_is_team(other) then raise exception 'Choose someone on the team' using errcode='22023';end if;
  conv:=(select c from private.chat_conversations c where c.kind='direct'
   and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=me)
   and exists(select 1 from private.chat_members m where m.conversation_id=c.id and m.user_id=other)
   and (select count(*) from private.chat_members m where m.conversation_id=c.id)=2 limit 1);
  if conv.id is null then
   insert into private.chat_conversations(id,kind,created_by) values(new_id,'direct',me);
   insert into private.chat_members(conversation_id,user_id) values(new_id,me),(new_id,other);
   conv:=(select c from private.chat_conversations c where c.id=new_id);
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
  insert into private.chat_conversations(id,kind,title,property_id,work_id,created_by) values(new_id,'group',trim(input->>'title'),(input->>'propertyId')::uuid,(input->>'workId')::uuid,me);
  insert into private.chat_members(conversation_id,user_id) select new_id,u from unnest(array_append(people,me)) u on conflict do nothing;
  conv:=(select c from private.chat_conversations c where c.id=new_id);
  return private.chat_summary(conv,me);
 elsif a='startOwner' then
  -- An owner opens their conversation with Recharge; the team opens one with an owner they look after.
  perform private.workspace_json_keys(input,array['action','ownerId']);
  other:=case when actor='client' then me else (input->>'ownerId')::uuid end;
  if other is null or not exists(select 1 from public.workspace_profiles where user_id=other and role='client' and status='active') or (actor<>'client' and not private.chat_owner_team(other,me)) then raise exception 'Owner not found' using errcode='42501';end if;
  conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=other);
  if conv.id is null then
   insert into private.chat_conversations(id,kind,owner_id,created_by) values(new_id,'owner',other,me) on conflict do nothing;
   conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=other);
   insert into private.chat_members(conversation_id,user_id) values(conv.id,other) on conflict do nothing;
  end if;
  return private.chat_summary(conv,me);
 elsif a='openTeams' then
  -- The team channels, made the first time anyone on the team opens Messages.
  perform private.workspace_json_keys(input,array['action']);
  if actor='client' then raise exception 'Team access required' using errcode='42501';end if;
  insert into private.chat_conversations(kind,title,department,created_by)
   select 'group',t.title,t.department,me from (values('all','Everyone'),('management','Management'),('guest_relations','Guest relations'),('client_relations','Client relations'),('cleaning','Cleaning'),('ready','Ready'),('accounts','Accounts')) t(department,title)
  on conflict(department) where department is not null do nothing;
  return jsonb_build_object('ready',true);
 elsif a='send' then
  perform private.workspace_json_keys(input,array['action','requestId','conversationId','body']);
  target:=(input->>'conversationId')::uuid;
  if not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  if char_length(trim(coalesce(input->>'body','')))=0 or char_length(input->>'body')>4000 then raise exception 'Write a message of up to 4,000 characters' using errcode='22023';end if;
  msg:=(select m from private.chat_messages m where m.author_id=me and m.request_id=(input->>'requestId')::uuid);
  if msg.id is not null then return jsonb_build_object('id',msg.id,'at',msg.created_at);end if;
  previous:=(select max(created_at) from private.chat_messages where conversation_id=target);
  insert into private.chat_messages(id,conversation_id,author_id,body,request_id) values(new_id,target,me,trim(input->>'body'),(input->>'requestId')::uuid);
  msg:=(select m from private.chat_messages m where m.id=new_id);
  update private.chat_conversations set last_message_at=msg.created_at where id=target;
  conv:=(select c from private.chat_conversations c where c.id=target);
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
 if a='startProperty' then return private.chat_start_property(input);end if;
 if a in ('saveReply','deleteReply') then return private.workspace_saved_replies_action(input);end if;
 raise exception 'Unknown chat action' using errcode='22023';
end $function$
;

-- Make the channels now when an admin already exists; otherwise the first person to open Messages makes them.
insert into private.chat_conversations(kind,title,department,created_by)
 select 'group',t.title,t.department,(select a.user_id from public.workspace_profiles a where a.role in ('super_admin','admin') and a.status='active' order by a.user_id limit 1)
 from (values('all','Everyone'),('management','Management'),('guest_relations','Guest relations'),('client_relations','Client relations'),('cleaning','Cleaning'),('ready','Ready'),('accounts','Accounts')) t(department,title)
 where exists(select 1 from public.workspace_profiles a where a.role in ('super_admin','admin') and a.status='active')
 on conflict(department) where department is not null do nothing;
