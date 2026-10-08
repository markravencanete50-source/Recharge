-- Run this once in the Supabase SQL editor (project brixfalrrmzqoioggvfx): photos, web push
-- notifications, Messages and property listings. It is migrations 20261009090000 to
-- 20261009120000, then the lines that record them as applied. Safe to run more than once.
-- Paste all of it and press Run; if Supabase offers to add Row Level Security lines, choose to
-- run the query without them (every new table already has it switched on).
begin;

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('workspace-media','workspace-media',false,8388608,array['image/jpeg','image/png','image/webp'])
   on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp']$q$;
 end if;
end $$;

alter table private.workspace_upload_intents drop constraint if exists workspace_upload_intents_purpose_check;
alter table private.workspace_upload_intents add constraint workspace_upload_intents_purpose_check check(purpose in ('cleaning','mailbox','delivery','licence','maintenance','inspection','setup'));
alter table private.workspace_media_evidence drop constraint if exists workspace_media_evidence_purpose_check;
alter table private.workspace_media_evidence add constraint workspace_media_evidence_purpose_check check(purpose in ('cleaning','mailbox','delivery','licence','maintenance','inspection','setup'));

create or replace function private.workspace_journey_media_access(target uuid, subject uuid, purpose text default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.workspace_journeys j join public.workspace_profiles p on p.user_id=subject and p.status='active'
  where j.work_id=target and j.stage<>'archived' and (
   p.role in ('admin','super_admin')
   or (p.role='client' and j.client_id=subject and coalesce(purpose,'setup')='setup' and (purpose is null or j.stage in ('form','invoice','inspection_to_book','inspection_booked')))
   or (p.role in ('stays','ready') and exists(select 1 from public.workspace_property_assignments a where a.user_id=subject and a.property_id=j.property_id and a.assignment='staff')
       and (purpose is null or (purpose='inspection' and j.stage in ('inspection_booked','inspection_complete')) or (purpose='setup' and p.role='stays')))))
$$;
revoke all on function private.workspace_journey_media_access(uuid,uuid,text) from public,anon,authenticated;

do $$
declare definition text;
begin
 -- Preparing an upload: journeys are checked by the journey rule; other work as before.
 definition:=pg_get_functiondef('private.workspace_prepare_upload(jsonb)'::regprocedure);
 if position('workspace_journey_media_access' in definition)=0 then
  definition:=replace(definition,$q$ if actor is null or not private.workspace_operation_access(target) then raise exception 'Upload access denied' using errcode='42501';end if;$q$,
   $q$ if actor is null or not (private.workspace_operation_access(target) or (purpose in ('inspection','setup') and private.workspace_journey_media_access(target,auth.uid(),purpose))) then raise exception 'Upload access denied' using errcode='42501';end if;$q$);
  definition:=replace(definition,$q$ (purpose='maintenance' and d.kind='maintenance' and actor in ('ready','stays','admin','super_admin'))$q$,
   $q$ (purpose='maintenance' and d.kind='maintenance' and actor in ('ready','stays','admin','super_admin')) or
 (purpose in ('inspection','setup') and private.workspace_journey_media_access(target,auth.uid(),purpose))$q$);
  if position('workspace_journey_media_access(target,auth.uid(),purpose))) then' in definition)=0 or position($q$or
 (purpose in ('inspection','setup')$q$ in definition)=0 then raise exception 'Patch anchor missing in workspace_prepare_upload'; end if;
  execute definition;
 end if;
 -- Committing the upload repeats the same check for the person who started it.
 definition:=pg_get_functiondef('private.integration_commit_upload(uuid,jsonb)'::regprocedure);
 if position('workspace_journey_media_access' in definition)=0 then
  definition:=replace(definition,$q$ if not private.integration_can_work(i.owner_id,i.work_id) then raise exception 'Upload access revoked' using errcode='42501';end if;$q$,
   $q$ if not (private.integration_can_work(i.owner_id,i.work_id) or (i.purpose in ('inspection','setup') and private.workspace_journey_media_access(i.work_id,i.owner_id,i.purpose))) then raise exception 'Upload access revoked' using errcode='42501';end if;$q$);
  definition:=replace(definition,$q$(i.purpose='maintenance' and kind='maintenance' and actor in ('ready','stays','admin','super_admin'))$q$,
   $q$(i.purpose='maintenance' and kind='maintenance' and actor in ('ready','stays','admin','super_admin')) or
 (i.purpose in ('inspection','setup') and private.workspace_journey_media_access(i.work_id,i.owner_id,i.purpose))$q$);
  if (length(definition)-length(replace(definition,'workspace_journey_media_access','')))/length('workspace_journey_media_access')<>2 then raise exception 'Patch anchor missing in integration_commit_upload'; end if;
  execute definition;
 end if;
end $$;

create or replace function private.workspace_media_visible(e private.workspace_media_evidence) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role() is not null and (private.workspace_actor_role()<>'cleans' or e.owner_id=auth.uid()) and (
  private.workspace_operation_access(e.work_id)
  or private.workspace_journey_media_access(e.work_id,auth.uid())
  or (e.purpose='mailbox' and private.workspace_actor_role()='client' and private.workspace_can_property(e.property_id,'client-mailbox')))
$$;
revoke all on function private.workspace_media_visible(private.workspace_media_evidence) from public,anon,authenticated;

create or replace function private.workspace_media_read(target_work uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if private.workspace_actor_role() is null then raise exception 'Media access denied' using errcode='42501';end if;
 items:=(select jsonb_agg(jsonb_build_object('id',e.id,'purpose',e.purpose,'format',e.asset_format,'bytes',e.asset_bytes,'verifiedAt',e.verified_at) order by e.verified_at)
  from private.workspace_media_evidence e where e.work_id=target_work and private.workspace_media_visible(e));
 if items is null and not (private.workspace_operation_access(target_work) or private.workspace_journey_media_access(target_work,auth.uid())
   or exists(select 1 from public.workspace_work_items w where w.id=target_work and private.workspace_actor_role()='client' and private.workspace_can_property(w.property_id,'client-mailbox'))) then
  raise exception 'Media access denied' using errcode='42501';
 end if;
 return coalesce(items,'[]');
end $$;

create or replace function private.workspace_media_asset(target_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.workspace_media_evidence;
begin
 e:=(select x from private.workspace_media_evidence x where x.id=target_asset);
 if e.id is null or not private.workspace_media_visible(e) then raise exception 'Media access denied' using errcode='42501';end if;
 if e.provider_asset_id is null then raise exception 'Verified asset unavailable' using errcode='P0002';end if;
 return jsonb_build_object('providerAssetId',e.provider_asset_id,'format',e.asset_format,'bytes',e.asset_bytes);
end $$;

do $$
declare definition text;
 anchor constant text := $q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote']);$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position('mailPhotoIds' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_operations_action'; end if;
  execute replace(definition,anchor,$q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote','mailPhotoIds']);
    if data ? 'mailPhotoIds' then
     if jsonb_typeof(data->'mailPhotoIds') is distinct from 'array' or jsonb_array_length(data->'mailPhotoIds')>20 or coalesce(data->>'mailAction','none') not in ('photograph','open_and_photograph')
      or (select count(distinct e.id) from private.workspace_media_evidence e where e.work_id=target and e.owner_id=auth.uid() and e.purpose='mailbox' and e.id::text in (select value#>>'{}' from jsonb_array_elements(data->'mailPhotoIds')))<>jsonb_array_length(data->'mailPhotoIds')
     then raise exception 'Post photos must be verified photos of this clean' using errcode='22023';end if;
    end if;$q$);
 end if;
end $$;

do $$
declare definition text;
 anchor constant text := $q$'action',d.data->>'mailAction','note',left(coalesce(d.data->>'mailNote',''),500))$q$;
begin
 definition:=pg_get_functiondef('private.workspace_mailbox_read()'::regprocedure);
 if position('photoIds' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_mailbox_read'; end if;
  execute replace(definition,anchor,$q$'action',d.data->>'mailAction','note',left(coalesce(d.data->>'mailNote',''),500),'photoIds',coalesce(d.data->'mailPhotoIds','[]'::jsonb))$q$);
 end if;
end $$;

insert into supabase_migrations.schema_migrations(version,name) values('20261009090000','photos_storage') on conflict do nothing;

create table if not exists private.workspace_web_push (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{20,24}$'),
 created_at timestamptz not null default now()
);
create index if not exists workspace_web_push_user_idx on private.workspace_web_push(user_id);
create table if not exists private.workspace_web_push_sent (
 outbox_id bigint not null references private.workspace_notification_outbox(id) on delete cascade,
 subscription_id uuid not null references private.workspace_web_push(id) on delete cascade,
 sent_at timestamptz not null default now(),
 primary key(outbox_id,subscription_id)
);
alter table private.workspace_web_push enable row level security;
alter table private.workspace_web_push_sent enable row level security;
revoke all on private.workspace_web_push,private.workspace_web_push_sent from public,anon,authenticated;

create or replace function private.workspace_web_push_subscribe(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['endpoint','p256dh','auth']);
 if coalesce(input->>'endpoint','') !~ '^https://' or char_length(input->>'endpoint')>1000 or coalesce(input->>'p256dh','') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(input->>'auth','') !~ '^[A-Za-z0-9_-]{20,24}$' then
  raise exception 'Check the notification subscription' using errcode='22023';
 end if;
 -- A browser belongs to whoever signed in on it last; each person keeps their 10 newest.
 delete from private.workspace_web_push where endpoint=input->>'endpoint';
 insert into private.workspace_web_push(user_id,endpoint,p256dh,auth) values(auth.uid(),input->>'endpoint',input->>'p256dh',input->>'auth');
 delete from private.workspace_web_push where user_id=auth.uid() and id not in (select id from private.workspace_web_push where user_id=auth.uid() order by created_at desc limit 10);
 return jsonb_build_object('subscribed',true,'devices',(select count(*) from private.workspace_web_push where user_id=auth.uid()));
end $$;
create or replace function private.workspace_web_push_unsubscribe(target_endpoint text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 delete from private.workspace_web_push where user_id=auth.uid() and endpoint=target_endpoint;
 return jsonb_build_object('subscribed',false);
end $$;

create or replace function private.integration_claim_web_push() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- One claim at a time, so two runs never pick the same notice.
 perform pg_advisory_xact_lock(hashtextextended('recharge-web-push-claim',0));
 result:=(select coalesce(jsonb_agg(jsonb_build_object('outboxId',c.outbox_id,'subscriptionId',c.subscription_id,'endpoint',c.endpoint,'p256dh',c.p256dh,'auth',c.auth,'eventType',c.event_type) order by c.created_at),'[]')
  from (select o.id outbox_id,s.id subscription_id,s.endpoint,s.p256dh,s.auth,a.event_type,a.created_at
   from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
   join private.workspace_web_push s on s.user_id=o.user_id join public.workspace_profiles p on p.user_id=o.user_id and p.status='active'
   where a.created_at>now()-interval '1 day' and a.created_at>=s.created_at-interval '1 minute'
    and not exists(select 1 from private.workspace_web_push_sent x where x.outbox_id=o.id and x.subscription_id=s.id)
    and (o.work_id is null or private.integration_can_work(o.user_id,o.work_id))
   order by a.created_at limit 50) c);
 insert into private.workspace_web_push_sent(outbox_id,subscription_id)
  select (j->>'outboxId')::bigint,(j->>'subscriptionId')::uuid from jsonb_array_elements(result) j on conflict do nothing;
 delete from private.workspace_web_push_sent where sent_at<now()-interval '3 days';
 return result;
end $$;
create or replace function private.integration_remove_web_push(target_endpoint text) returns void language sql security definer set search_path='' as $$
 delete from private.workspace_web_push where endpoint=target_endpoint;
$$;

create or replace function public.workspace_web_push_subscribe(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_web_push_subscribe(input);$$;
create or replace function public.workspace_web_push_unsubscribe(target_endpoint text) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_web_push_unsubscribe(target_endpoint);$$;
create or replace function public.integration_claim_web_push() returns jsonb language sql security invoker set search_path='' as $$select private.integration_claim_web_push();$$;
create or replace function public.integration_remove_web_push(target_endpoint text) returns void language sql security invoker set search_path='' as $$select private.integration_remove_web_push(target_endpoint);$$;

revoke all on function private.workspace_web_push_subscribe(jsonb),private.workspace_web_push_unsubscribe(text),private.integration_claim_web_push(),private.integration_remove_web_push(text),
 public.workspace_web_push_subscribe(jsonb),public.workspace_web_push_unsubscribe(text),public.integration_claim_web_push(),public.integration_remove_web_push(text) from public,anon,authenticated,service_role;
grant execute on function private.workspace_web_push_subscribe(jsonb),private.workspace_web_push_unsubscribe(text),public.workspace_web_push_subscribe(jsonb),public.workspace_web_push_unsubscribe(text) to authenticated;
grant execute on function private.integration_claim_web_push(),private.integration_remove_web_push(text),public.integration_claim_web_push(),public.integration_remove_web_push(text) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values('20261009100000','web_push') on conflict do nothing;

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
 raise exception 'Unknown chat action' using errcode='22023';
end $$;

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
 t:=(select x from private.workspace_performance_targets x where x.singleton);
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

insert into supabase_migrations.schema_migrations(version,name) values('20261009110000','team_chat') on conflict do nothing;
create or replace function private.workspace_save_listing_links(prop uuid, links jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
 if jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links)>12 then raise exception 'Up to 12 listings' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(links) loop
  perform private.workspace_json_keys(entry,array['platform','url','listingId']);
  if coalesce(entry->>'platform','') not in ('Airbnb','Booking.com','Vrbo','Direct','Channel manager','Comfy Workers') then raise exception 'Choose the platform for each listing' using errcode='22023';end if;
  if coalesce(entry->>'url','')<>'' and (char_length(entry->>'url')>1000 or entry->>'url' !~ '^https://[^/@[:space:]]+([/:?#]|$)') then raise exception 'Listing links must start with https://' using errcode='22023';end if;
  if coalesce(entry->>'listingId','')<>'' and entry->>'listingId' !~ '^[A-Za-z0-9._:-]{1,100}$' then raise exception 'Listing IDs use letters, numbers, dots, dashes or colons' using errcode='22023';end if;
  if coalesce(entry->>'url','')='' and coalesce(entry->>'listingId','')='' then raise exception 'Give each listing a link or an ID' using errcode='22023';end if;
 end loop;
 insert into private.workspace_listing_links(property_id,links) values(prop,
   (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('platform',e->>'platform','url',nullif(e->>'url',''),'listingId',nullif(e->>'listingId','')))),'[]') from jsonb_array_elements(links) e))
  on conflict(property_id) do update set links=excluded.links;
 return jsonb_build_object('propertyId',prop,'links',(select l.links from private.workspace_listing_links l where l.property_id=prop));
end $$;
revoke all on function private.workspace_save_listing_links(uuid,jsonb) from public,anon,authenticated;

do $$
declare definition text;
 anchor constant text := $q$ elsif a='recordLocalEvent' then$q$;
begin
 definition:=pg_get_functiondef('private.workspace_portfolio_action(jsonb)'::regprocedure);
 if position('workspace_save_listing_links' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_portfolio_action'; end if;
  execute replace(definition,anchor,$q$ elsif a='saveListingLinks' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','links']);
  result:=private.workspace_save_listing_links(prop,input->'links');
$q$||anchor);
 end if;
end $$;

insert into supabase_migrations.schema_migrations(version,name) values('20261009120000','listing_links') on conflict do nothing;
commit;
