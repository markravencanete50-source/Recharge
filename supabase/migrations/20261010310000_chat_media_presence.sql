-- Messages, more like a messenger: reactions on messages; up to 5 photos and 1 video (up to 50 MB)
-- in a message; group chats anyone can start, see the people in and add people to (with a line in
-- the conversation when someone is added, removed, leaves or renames it); who is online; and a
-- profile of your own (a photo, a colour and a line about you).
--
-- Files go straight from the device to private storage with a one-off upload link the server
-- asks for (prepareFiles); the message then claims them, and the database checks each stored
-- file's size and type before it does. Files are only opened with short-lived signed links, by
-- people who can read the conversation.

-- ---------------------------------------------------------------- tables
alter table private.chat_messages drop constraint if exists chat_messages_body_check;
alter table private.chat_messages add constraint chat_messages_body_length check(char_length(body)<=4000);
alter table private.chat_messages add column if not exists kind text not null default 'text';
alter table private.chat_messages drop constraint if exists chat_messages_kind_check;
alter table private.chat_messages add constraint chat_messages_kind_check check(kind in ('text','event'));

create table if not exists private.chat_attachments (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references private.chat_conversations(id) on delete cascade,
 message_id uuid references private.chat_messages(id) on delete cascade,
 uploader_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 path text not null unique,
 kind text not null check(kind in ('image','video')),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')),
 bytes bigint not null check(bytes between 1 and 52428800),
 name text not null default '' check(char_length(name)<=200),
 width integer check(width is null or width between 1 and 20000),
 height integer check(height is null or height between 1 and 20000),
 position smallint not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists chat_attachments_message_idx on private.chat_attachments(message_id,position);
create index if not exists chat_attachments_unsent_idx on private.chat_attachments(uploader_id,created_at) where message_id is null;

-- One reaction per person per message; the same one again takes it off, another replaces it.
create table if not exists private.chat_reactions (
 message_id uuid not null references private.chat_messages(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 emoji text not null check(emoji in ('👍','❤️','😂','😮','😢','🙏','🎉','✅')),
 created_at timestamptz not null default now(),
 primary key(message_id,user_id)
);

-- When each person last had the app open (a heartbeat while it is open and in view).
create table if not exists private.workspace_presence (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 seen_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['chat_attachments','chat_reactions','workspace_presence'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

alter table public.workspace_profiles add column if not exists avatar_path text;
alter table public.workspace_profiles add column if not exists about text not null default '';
alter table public.workspace_profiles drop constraint if exists workspace_profiles_about_length;
alter table public.workspace_profiles add constraint workspace_profiles_about_length check(char_length(about)<=160);

do $$
begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('chat-files','chat-files',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- ---------------------------------------------------------------- small helpers
-- A profile photo's version (changes with each new photo), or null for none.
create or replace function private.chat_photo(subject uuid) returns text language sql stable security definer set search_path='' as $fn$
 select left(md5(p.avatar_path),12) from public.workspace_profiles p where p.user_id=subject and p.avatar_path is not null
$fn$;
-- When someone was last in the app. Owners are not shown the team's comings and goings.
create or replace function private.chat_seen(subject uuid) returns timestamptz language sql stable security definer set search_path='' as $fn$
 select case when coalesce(private.workspace_actor_role(),'client')='client' then null else (select s.seen_at from private.workspace_presence s where s.user_id=subject) end
$fn$;
create or replace function private.chat_attachments_json(msg uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'mime',a.mime,'name',a.name,'bytes',a.bytes,'width',a.width,'height',a.height) order by a.position,a.created_at),'[]'::jsonb)
 from private.chat_attachments a where a.message_id=msg
$fn$;
create or replace function private.chat_reactions_json(msg uuid, me uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,'mine',r.mine,'names',r.names) order by r.first_at),'[]'::jsonb) from (
  select x.emoji,count(*) as n,bool_or(x.user_id=me) as mine,min(x.created_at) as first_at,
   jsonb_agg(case when x.user_id=me then 'You' else coalesce(nullif(split_part(p.full_name,' ',1),''),'Someone') end order by x.created_at) as names
  from private.chat_reactions x join public.workspace_profiles p on p.user_id=x.user_id where x.message_id=msg group by x.emoji) r
$fn$;
-- What a message with only photos or a video says in the conversation list.
create or replace function private.chat_attachment_label(msg uuid) returns text language sql stable security definer set search_path='' as $fn$
 select case when count(*)=0 then '' when count(*) filter(where a.kind='video')>0 and count(*)=1 then '🎬 Video'
  when count(*) filter(where a.kind='video')>0 then '📎 '||count(*)||' photos and videos'
  when count(*)=1 then '📷 Photo' else '📷 '||count(*)||' photos' end
 from private.chat_attachments a where a.message_id=msg
$fn$;

-- A line in a group's conversation ("added Alex"), shown in the middle and never notified.
create or replace function private.chat_event(target uuid, me uuid, words text) returns void language plpgsql security definer set search_path='' as $fn$
declare at_time timestamptz;
begin
 insert into private.chat_messages(conversation_id,author_id,body,request_id,kind) values(target,me,left(words,4000),gen_random_uuid(),'event') returning created_at into at_time;
 update private.chat_conversations set last_message_at=at_time where id=target;
 insert into private.chat_reads(conversation_id,user_id,last_read_at) values(target,me,at_time) on conflict(conversation_id,user_id) do update set last_read_at=greatest(private.chat_reads.last_read_at,excluded.last_read_at);
end $fn$;

-- The files a message claims: this person's uploads to this conversation not yet in a message,
-- at most 5 photos and 1 video, each found in storage at its stated size and type.
create or replace function private.chat_attach(msg uuid, target uuid, me uuid, ids jsonb) returns void language plpgsql security definer set search_path='' as $fn$
declare wanted uuid[];found integer;stored integer;paths text[];
begin
 if ids is null or jsonb_typeof(ids)<>'array' then raise exception 'Choose photos or a video' using errcode='22023';end if;
 if jsonb_array_length(ids)=0 then return;end if;
 if jsonb_array_length(ids)>6 then raise exception 'Send up to 5 photos and 1 video at a time' using errcode='22023';end if;
 -- In the order they were added (the first photo leads).
 wanted:=array(select x.u from (select (e.value#>>'{}')::uuid u,min(e.ord) o from jsonb_array_elements(ids) with ordinality e(value,ord) group by 1) x order by x.o);
 select count(*),array_agg(a.path) into found,paths from private.chat_attachments a where a.id=any(wanted) and a.uploader_id=me and a.conversation_id=target and a.message_id is null;
 if found<>cardinality(wanted) then raise exception 'A photo or video was not uploaded. Remove it and add it again.' using errcode='22023';end if;
 if (select count(*) from private.chat_attachments a where a.id=any(wanted) and a.kind='image')>5 then raise exception 'Send up to 5 photos at a time' using errcode='22023';end if;
 if (select count(*) from private.chat_attachments a where a.id=any(wanted) and a.kind='video')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;
 if to_regclass('storage.objects') is not null then
  execute $q$select count(*) from storage.objects o join private.chat_attachments a on a.path=o.name
   where o.bucket_id='chat-files' and o.name=any($1) and coalesce(o.metadata->>'mimetype','')=a.mime
    and coalesce((o.metadata->>'size')::bigint,0) between 1 and case when a.kind='video' then 52428800 else 15728640 end$q$ into stored using paths;
  if stored<>found then raise exception 'A photo or video has not finished uploading, or is too large. Remove it and add it again.' using errcode='22023';end if;
  execute $q$update private.chat_attachments a set bytes=(o.metadata->>'size')::bigint from storage.objects o where o.bucket_id='chat-files' and o.name=a.path and a.path=any($1)$q$ using paths;
 end if;
 update private.chat_attachments a set message_id=msg,position=w.ord from unnest(wanted) with ordinality w(id,ord) where a.id=w.id;
end $fn$;

-- Who is in a conversation: its members; for a team channel everyone in it; for an owner's
-- conversation the owner and the team who answer them.
create or replace function private.chat_members_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();c private.chat_conversations;people uuid[];
begin
 if actor is null or target is null or not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
 c:=(select x from private.chat_conversations x where x.id=target);
 if c.department is not null then
  people:=array(select p.user_id from public.workspace_profiles p where p.status='active' and p.role<>'client' and private.chat_in_channel(c.department,p.user_id));
 elsif c.kind='owner' then
  people:=array(select c.owner_id union select p.user_id from public.workspace_profiles p where p.status='active' and p.role<>'client' and private.chat_owner_team(c.owner_id,p.user_id));
 else
  people:=array(select m.user_id from private.chat_members m where m.conversation_id=target);
 end if;
 -- An owner sees "Recharge", not the team's names.
 if actor='client' then people:=array[me];end if;
 return jsonb_build_object('kind',c.kind,'department',c.department,'title',c.title,'canAdd',c.kind='group' and c.department is null and actor<>'client',
  'canRemove',c.kind='group' and c.department is null and (c.created_by=me or actor in ('admin','super_admin')),
  'members',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'about',p.about,'photo',private.chat_photo(p.user_id),
    'seenAt',private.chat_seen(p.user_id),'you',p.user_id=me,'creator',p.user_id=c.created_by and c.kind='group' and c.department is null) order by p.user_id<>me,p.full_name)
   from public.workspace_profiles p where p.user_id=any(people) and p.status='active'),'[]'::jsonb));
end $fn$;

-- ---------------------------------------------------------------- the new actions
create or replace function private.chat_more_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();a text:=input->>'action';target uuid;msg private.chat_messages;c private.chat_conversations;
 current_emoji text;f jsonb;new_id uuid;ext text;fkind text;made jsonb:='[]'::jsonb;stale jsonb;people uuid[];names text;other uuid;
begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if a='heartbeat' then
  perform private.workspace_json_keys(input,array['action']);
  insert into private.workspace_presence(user_id,seen_at) values(me,now())
   on conflict(user_id) do update set seen_at=excluded.seen_at where private.workspace_presence.seen_at<now()-interval '20 seconds';
  return jsonb_build_object('at',now());
 elsif a='react' then
  perform private.workspace_json_keys(input,array['action','messageId','emoji']);
  msg:=(select m from private.chat_messages m where m.id=(input->>'messageId')::uuid);
  if msg.id is null or not private.chat_can(msg.conversation_id,me) or msg.kind<>'text' then raise exception 'Message not found' using errcode='42501';end if;
  if coalesce(input->>'emoji','') not in ('👍','❤️','😂','😮','😢','🙏','🎉','✅') then raise exception 'Choose a reaction' using errcode='22023';end if;
  current_emoji:=(select r.emoji from private.chat_reactions r where r.message_id=msg.id and r.user_id=me);
  if current_emoji=input->>'emoji' then delete from private.chat_reactions where message_id=msg.id and user_id=me;
  else insert into private.chat_reactions(message_id,user_id,emoji) values(msg.id,me,input->>'emoji') on conflict(message_id,user_id) do update set emoji=excluded.emoji,created_at=now();
  end if;
  return jsonb_build_object('messageId',msg.id,'reactions',private.chat_reactions_json(msg.id,me));
 elsif a='prepareFiles' then
  -- Up to 5 photos (15 MB each) and 1 video (50 MB) for a message about to be sent.
  perform private.workspace_json_keys(input,array['action','conversationId','files']);
  target:=(input->>'conversationId')::uuid;
  if not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  if jsonb_typeof(input->'files')<>'array' or jsonb_array_length(input->'files') not between 1 and 6 then raise exception 'Send up to 5 photos and 1 video at a time' using errcode='22023';end if;
  if (select count(*) from jsonb_array_elements(input->'files') x where x->>'mime' like 'image/%')>5 then raise exception 'Send up to 5 photos at a time' using errcode='22023';end if;
  if (select count(*) from jsonb_array_elements(input->'files') x where x->>'mime' like 'video/%')>1 then raise exception 'Send 1 video at a time' using errcode='22023';end if;
  if (select count(*) from private.chat_attachments x where x.uploader_id=me and x.created_at>now()-interval '1 hour')>=120 then raise exception 'Too many uploads. Please wait a little.' using errcode='22023';end if;
  -- Files added but never sent are let go after a few hours.
  with gone as (delete from private.chat_attachments x where x.uploader_id=me and x.message_id is null and x.created_at<now()-interval '6 hours' returning x.path)
  select coalesce(jsonb_agg(path),'[]'::jsonb) into stale from gone;
  for f in select value from jsonb_array_elements(input->'files') loop
   ext:=case f->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' end;
   if ext is null then raise exception 'Add photos (JPG, PNG, WebP, GIF) or a video (MP4, MOV, WebM)' using errcode='22023';end if;
   fkind:=case when f->>'mime' like 'video/%' then 'video' else 'image' end;
   if jsonb_typeof(f->'bytes')<>'number' or (f->>'bytes')::numeric<1 or (f->>'bytes')::numeric>(case when fkind='video' then 52428800 else 15728640 end) then
    raise exception '%',case when fkind='video' then 'Videos can be up to 50 MB' else 'Photos can be up to 15 MB each' end using errcode='22023';end if;
   new_id:=gen_random_uuid();
   insert into private.chat_attachments(id,conversation_id,uploader_id,path,kind,mime,bytes,name,width,height)
    values(new_id,target,me,target::text||'/'||new_id::text||'.'||ext,fkind,f->>'mime',(f->>'bytes')::bigint,
     left(regexp_replace(coalesce(f->>'name',''),'[[:cntrl:]/\\]','','g'),200),
     case when jsonb_typeof(f->'width')='number' and (f->>'width')::numeric between 1 and 20000 then (f->>'width')::numeric::integer end,
     case when jsonb_typeof(f->'height')='number' and (f->>'height')::numeric between 1 and 20000 then (f->>'height')::numeric::integer end);
   made:=made||jsonb_build_array(jsonb_build_object('id',new_id,'path',target::text||'/'||new_id::text||'.'||ext,'mime',f->>'mime'));
  end loop;
  return jsonb_build_object('files',made,'stale',stale);
 elsif a='discardFiles' then
  perform private.workspace_json_keys(input,array['action','ids']);
  if jsonb_typeof(input->'ids')<>'array' or jsonb_array_length(input->'ids')>6 then raise exception 'Choose files' using errcode='22023';end if;
  with gone as (delete from private.chat_attachments x where x.uploader_id=me and x.message_id is null and x.id in (select (value#>>'{}')::uuid from jsonb_array_elements(input->'ids')) returning x.path)
  select coalesce(jsonb_agg(path),'[]'::jsonb) into stale from gone;
  return jsonb_build_object('paths',stale);
 elsif a in ('addMembers','removeMember','renameGroup') then
  perform private.workspace_json_keys(input,array['action','conversationId','userIds','userId','title']);
  target:=(input->>'conversationId')::uuid;
  c:=(select x from private.chat_conversations x where x.id=target);
  if c.id is null or not private.chat_can(target,me) then raise exception 'Conversation not found' using errcode='42501';end if;
  if c.kind<>'group' or c.department is not null or actor='client' then raise exception 'Only group conversations can be changed' using errcode='22023';end if;
  if not exists(select 1 from private.chat_members m where m.conversation_id=target and m.user_id=me) then raise exception 'Join the group first' using errcode='42501';end if;
  if a='addMembers' then
   if jsonb_typeof(input->'userIds')<>'array' or jsonb_array_length(input->'userIds') not between 1 and 50 then raise exception 'Choose who to add' using errcode='22023';end if;
   people:=array(select distinct (value#>>'{}')::uuid from jsonb_array_elements(input->'userIds'));
   if exists(select 1 from unnest(people) u where not private.chat_is_team(u)) then raise exception 'Only team members can be added' using errcode='22023';end if;
   people:=array(select u from unnest(people) u where not exists(select 1 from private.chat_members m where m.conversation_id=target and m.user_id=u));
   if (select count(*) from private.chat_members m where m.conversation_id=target)+cardinality(people)>100 then raise exception 'Groups can have up to 100 people' using errcode='22023';end if;
   if cardinality(people)=0 then return jsonb_build_object('added',0);end if;
   insert into private.chat_members(conversation_id,user_id) select target,u from unnest(people) u on conflict do nothing;
   names:=(select string_agg(p.full_name,', ' order by p.full_name) from public.workspace_profiles p where p.user_id=any(people));
   perform private.chat_event(target,me,'added '||names);
   return jsonb_build_object('added',cardinality(people));
  elsif a='removeMember' then
   other:=(input->>'userId')::uuid;
   if other is null or not exists(select 1 from private.chat_members m where m.conversation_id=target and m.user_id=other) then raise exception 'They are not in this group' using errcode='22023';end if;
   if other<>me and not (c.created_by=me or actor in ('admin','super_admin')) then raise exception 'Only whoever started the group, or an admin, can remove people' using errcode='42501';end if;
   perform private.chat_event(target,me,case when other=me then 'left the group' else 'removed '||(select full_name from public.workspace_profiles where user_id=other) end);
   delete from private.chat_members where conversation_id=target and user_id=other;
   return jsonb_build_object('removed',other);
  else
   if input->>'title' is not null and char_length(trim(input->>'title')) not between 2 and 80 then raise exception 'Give the group a name of 2 to 80 characters' using errcode='22023';end if;
   update private.chat_conversations set title=nullif(trim(coalesce(input->>'title','')),'') where id=target;
   perform private.chat_event(target,me,case when nullif(trim(coalesce(input->>'title','')),'') is null then 'removed the group name' else 'named the group '||trim(input->>'title') end);
   return private.chat_summary((select x from private.chat_conversations x where x.id=target),me);
  end if;
 end if;
 raise exception 'Unknown chat action' using errcode='22023';
end $fn$;

-- Opening files: the ones in conversations this person can read (or their own, not yet sent).
create or replace function private.workspace_chat_files(ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if ids is null or cardinality(ids)>60 then raise exception 'Choose up to 60 files' using errcode='22023';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'mime',a.mime,'name',a.name,'kind',a.kind))
  from private.chat_attachments a where a.id=any(ids) and (a.message_id is not null or a.uploader_id=me) and private.chat_can(a.conversation_id,me)),'[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------- your profile
create or replace function private.workspace_profile_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();a text:=input->>'action';old text;found integer;
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 old:=(select avatar_path from public.workspace_profiles where user_id=me);
 if a='saveProfile' then
  perform private.workspace_json_keys(input,array['action','about','avatar']);
  if char_length(coalesce(input->>'about',''))>160 then raise exception 'Keep it to 160 characters' using errcode='22023';end if;
  if input->>'avatar' is not null and input->>'avatar' not in ('forest','sage','ocean','plum','clay','slate') then raise exception 'Choose a colour' using errcode='22023';end if;
  update public.workspace_profiles set about=trim(coalesce(input->>'about',about)),avatar_preset=coalesce(input->>'avatar',avatar_preset),updated_at=now() where user_id=me;
  return private.workspace_account_json(me);
 elsif a='setPhoto' then
  perform private.workspace_json_keys(input,array['action','path']);
  if coalesce(input->>'path','')!~('^'||me::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') then raise exception 'Choose a photo' using errcode='22023';end if;
  if to_regclass('storage.objects') is not null then
   execute $q$select count(*) from storage.objects where bucket_id='avatars' and name=$1$q$ into found using input->>'path';
   if found=0 then raise exception 'The photo has not finished uploading' using errcode='22023';end if;
  end if;
  update public.workspace_profiles set avatar_path=input->>'path',updated_at=now() where user_id=me;
  return private.workspace_account_json(me)||jsonb_build_object('replaced',old);
 elsif a='clearPhoto' then
  perform private.workspace_json_keys(input,array['action']);
  update public.workspace_profiles set avatar_path=null,updated_at=now() where user_id=me;
  return private.workspace_account_json(me)||jsonb_build_object('replaced',old);
 end if;
 raise exception 'Unknown profile action' using errcode='22023';
end $fn$;
-- Where someone's photo is kept, for anyone in the workspace.
create or replace function private.workspace_profile_photo(target uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 return (select avatar_path from public.workspace_profiles where user_id=target);
end $fn$;

create or replace function private.workspace_account_json(target_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('userId', p.user_id, 'email', u.email, 'fullName', p.full_name,
    'role', p.role, 'status', p.status, 'responsibilities', p.responsibilities,
    'avatar', p.avatar_preset, 'photo', left(md5(p.avatar_path),12), 'about', p.about,
    'modules', coalesce((select jsonb_agg(g.module_id order by g.module_id) from public.workspace_module_grants g where g.user_id = p.user_id), '[]'::jsonb))
  from public.workspace_profiles p join auth.users u on u.id = p.user_id where p.user_id = target_id;
$fn$;
revoke all on function private.workspace_account_json(uuid) from public, anon, authenticated;

create or replace function public.workspace_chat_files(ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_chat_files(ids);$$;
create or replace function public.workspace_profile_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_profile_action(input);$$;
create or replace function public.workspace_profile_photo(target uuid) returns text language sql security invoker set search_path='' as $$select private.workspace_profile_photo(target);$$;

revoke all on function private.chat_photo(uuid),private.chat_seen(uuid),private.chat_attachments_json(uuid),private.chat_reactions_json(uuid,uuid),private.chat_attachment_label(uuid),
 private.chat_event(uuid,uuid,text),private.chat_attach(uuid,uuid,uuid,jsonb),private.chat_members_read(uuid),private.chat_more_action(jsonb),
 private.workspace_chat_files(uuid[]),private.workspace_profile_action(jsonb),private.workspace_profile_photo(uuid),
 public.workspace_chat_files(uuid[]),public.workspace_profile_action(jsonb),public.workspace_profile_photo(uuid) from public,anon,authenticated;
grant execute on function private.workspace_chat_files(uuid[]),private.workspace_profile_action(jsonb),private.workspace_profile_photo(uuid),
 public.workspace_chat_files(uuid[]),public.workspace_profile_action(jsonb),public.workspace_profile_photo(uuid) to authenticated;

-- ---------------------------------------------------------------- patches to Messages
do $$
declare
 fixes text[][] := array[
  -- Sending: a message can be photos or a video with no words.
  ['private.workspace_chat_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','conversationId','body']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','conversationId','body','attachments']);$q$,
   $q$array['action','requestId','conversationId','body','attachments']$q$],
  ['private.workspace_chat_action(jsonb)',
   $q$if char_length(trim(coalesce(input->>'body','')))=0 or char_length(input->>'body')>4000 then$q$,
   $q$if (char_length(trim(coalesce(input->>'body','')))=0 and jsonb_array_length(coalesce(nullif(input->'attachments','null'::jsonb),'[]'::jsonb))=0) or char_length(coalesce(input->>'body',''))>4000 then$q$,
   $q$jsonb_array_length(coalesce(nullif(input->'attachments','null'::jsonb),'[]'::jsonb))=0) or$q$],
  ['private.workspace_chat_action(jsonb)',
   $q$values(new_id,target,me,trim(input->>'body'),(input->>'requestId')::uuid);$q$,
   $q$values(new_id,target,me,trim(coalesce(input->>'body','')),(input->>'requestId')::uuid);
  perform private.chat_attach(new_id,target,me,coalesce(nullif(input->'attachments','null'::jsonb),'[]'::jsonb));$q$,
   $q$perform private.chat_attach(new_id$q$],
  ['private.workspace_chat_action(jsonb)',
   $q$raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$if a in ('heartbeat','react','prepareFiles','discardFiles','addMembers','removeMember','renameGroup') then return private.chat_more_action(input);end if;
 raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$private.chat_more_action(input)$q$],
  -- Reading: who wrote each message (and their photo), its kind, photos and video, and reactions.
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$'fromOwner',coalesce(x.author_id=(select owner_id from private.chat_conversations where id=target),false)) item$q$,
   $q$'fromOwner',coalesce(x.author_id=(select owner_id from private.chat_conversations where id=target),false),
     'authorId',x.author_id,'authorPhoto',private.chat_photo(x.author_id),'kind',x.kind,'attachments',private.chat_attachments_json(x.id),'reactions',private.chat_reactions_json(x.id,me)) item$q$,
   $q$'reactions',private.chat_reactions_json(x.id,me)$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role)$q$,
   $q$jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'photo',private.chat_photo(p.user_id),'seenAt',private.chat_seen(p.user_id))$q$,
   $q$'photo',private.chat_photo(p.user_id),'seenAt'$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$join private.chat_messages x on x.conversation_id=c.id and x.author_id<>me$q$,
   $q$join private.chat_messages x on x.conversation_id=c.id and x.author_id<>me and x.kind='text'$q$,
   $q$x.author_id<>me and x.kind='text'$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$if section='savedReplies' then return private.workspace_saved_replies_read();end if;$q$,
   $q$if section='savedReplies' then return private.workspace_saved_replies_read();end if;
 if section='members' then return private.chat_members_read(target);end if;$q$,
   $q$private.chat_members_read(target)$q$],
  -- The list: a group with no name is called after its people; the other person's photo and
  -- when they were last in; photo-only messages and group lines read sensibly; lines are not unread.
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'title',case when c.kind='group' then c.title$q$,
   $q$'title',case when c.kind='group' then coalesce(c.title,(select string_agg(split_part(p.full_name,' ',1),', ' order by p.full_name) from private.chat_members m join public.workspace_profiles p on p.user_id=m.user_id where m.conversation_id=c.id and m.user_id<>me),'Group')$q$,
   $q$then coalesce(c.title,(select string_agg(split_part(p.full_name$q$],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'propertyName',(select name from public.workspace_properties where id=c.property_id),$q$,
   $q$'propertyName',(select name from public.workspace_properties where id=c.property_id),
  'peer',case when c.kind='direct' then (select jsonb_build_object('userId',m.user_id,'photo',private.chat_photo(m.user_id),'seenAt',private.chat_seen(m.user_id)) from private.chat_members m where m.conversation_id=c.id and m.user_id<>me order by m.user_id limit 1)
   when c.kind='owner' and c.owner_id<>me then jsonb_build_object('userId',c.owner_id,'photo',private.chat_photo(c.owner_id),'seenAt',private.chat_seen(c.owner_id)) end,
  'named',c.kind<>'group' or c.title is not null,$q$,
   $q$'peer',case when c.kind='direct'$q$],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'last',(select jsonb_build_object('body',left(x.body,140),$q$,
   $q$'last',(select jsonb_build_object('kind',x.kind,'body',coalesce(nullif(left(x.body,140),''),private.chat_attachment_label(x.id)),$q$,
   $q$jsonb_build_object('kind',x.kind,'body',coalesce(nullif(left(x.body,140),'')$q$],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me$q$,
   $q$'unread',(select count(*) from private.chat_messages x where x.conversation_id=c.id and x.author_id<>me and x.kind='text'$q$,
   $q$x.conversation_id=c.id and x.author_id<>me and x.kind='text'$q$],
  -- Viewing as someone: their members list only for conversations the super admin could open.
  ['private.workspace_chat_read_shown(text,uuid,timestamptz)',
   $q$if section='messages' and (target is null$q$,
   $q$if section in ('messages','members') and (target is null$q$,
   $q$section in ('messages','members')$q$],
  -- Deleting an account clears its photo and words too; a copy of your data includes them.
  ['private.workspace_delete_own_account(uuid)',
   $q$avatar_preset='ocean',status='revoked'$q$,
   $q$avatar_preset='ocean',avatar_path=null,about='',status='revoked'$q$,
   $q$avatar_path=null,about=''$q$],
  ['private.workspace_privacy_read(text)',
   $q$'avatar',person.avatar_preset,$q$,
   $q$'avatar',person.avatar_preset,'about',person.about,'hasPhoto',person.avatar_path is not null,$q$,
   $q$'hasPhoto',person.avatar_path is not null$q$]
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
