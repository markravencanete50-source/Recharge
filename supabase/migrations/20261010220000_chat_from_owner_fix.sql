-- A message in a conversation that is not with an owner (a direct message, a group or a team channel)
-- has no owner to compare its author with, so "from the owner" came back empty and the app refused
-- the thread. It is now false.
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
     'fromOwner',coalesce(x.author_id=(select owner_id from private.chat_conversations where id=target),false)) item
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
