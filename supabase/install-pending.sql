-- Round 9 (client email conversations): the 1 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261019%') then raise exception 'Round 9 (client email conversations) is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261019500000_client_email_threads =====
-- Email to ownerrelations@ from someone who is not an owner yet (a new landlord, an enquiry, an owner not set up in the app) becomes
-- a real email conversation in Messages > Clients (Lee, 14 October, after the live test: "I want to build a reply here"). Until now it
-- waited in an "Unknown senders" list that could only be assigned to an owner or dismissed, and Recharge has no owner accounts yet.
--   * Seen and answered by admins, super admins and the client relations and management rota (workspace_email_owner_team), never by
--     owners, cleaners or Ready.
--   * Replies go out from ownerrelations@ (the Worker, through Resend) with In-Reply-To and References, once per request id, and are
--     stored only when Resend accepted them. Their answer comes back into the same conversation (reply headers, then the address).
--   * Needs a reply / Engaged / Closed like any other conversation. Close and reopen; a new email reopens it.
--   * "Assign to owner", once an owner account exists, moves the whole history into that owner's conversation and remembers the address.
-- The old unknown-sender list is folded in: every open row becomes a conversation. Safe to run twice. The two functions this replaces
-- whole (workspace_email_owner_ingest, workspace_email_files, workspace_email_owner_reply_queue) are defined only in 20261016500000; nothing else patches them.

-- ---------------------------------------------------------------- tables
create table if not exists private.workspace_client_email_threads (
 id uuid primary key default gen_random_uuid(),
 address text not null check(address=lower(address) and char_length(address) between 3 and 320),
 name text check(name is null or char_length(name)<=200),
 subject text check(subject is null or char_length(subject)<=300),
 status text not null default 'open' check(status in ('open','closed','assigned')),
 owner_id uuid references public.workspace_profiles(user_id),
 last_message_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 closed_at timestamptz, closed_by uuid references public.workspace_profiles(user_id),
 assigned_at timestamptz, assigned_by uuid references public.workspace_profiles(user_id)
);
create index if not exists workspace_client_email_threads_address_idx on private.workspace_client_email_threads(address);
create index if not exists workspace_client_email_threads_recent_idx on private.workspace_client_email_threads(status,last_message_at desc);

create table if not exists private.workspace_client_email_messages (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references private.workspace_client_email_threads(id) on delete cascade,
 direction text not null check(direction in ('in','out')),
 -- in: Resend's id (stored once); out: the Send request id (sent once).
 email_id text unique check(email_id is null or char_length(email_id) between 1 and 200),
 request_id uuid unique,
 body text not null check(char_length(body) between 1 and 5000),
 sent_at timestamptz not null default now(),
 author_user_id uuid references public.workspace_profiles(user_id),
 status text not null default 'received' check(status in ('received','sending','sent','failed')),
 error text check(error is null or char_length(error)<=300),
 rfc_message_id text check(rfc_message_id is null or char_length(rfc_message_id) between 1 and 998),
 in_reply_to text, refs text[] not null default '{}',
 created_at timestamptz not null default now(),
 check((direction='in')=(email_id is not null) and (direction='out')=(request_id is not null))
);
create index if not exists workspace_client_email_messages_thread_idx on private.workspace_client_email_messages(thread_id,sent_at);
create unique index if not exists workspace_client_email_messages_rfc_idx on private.workspace_client_email_messages(lower(rfc_message_id)) where rfc_message_id is not null;

do $$ declare t text; begin
 foreach t in array array['workspace_client_email_threads','workspace_client_email_messages'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Attachments can belong to these messages too.
alter table private.workspace_email_attachments add column if not exists client_email_message_id uuid references private.workspace_client_email_messages(id) on delete cascade;
alter table private.workspace_email_attachments drop constraint if exists workspace_email_attachments_check;
alter table private.workspace_email_attachments drop constraint if exists workspace_email_attachments_one_owner;
alter table private.workspace_email_attachments add constraint workspace_email_attachments_one_owner
 check((guest_message_id is not null)::int+(chat_message_id is not null)::int+(client_email_message_id is not null)::int=1);
create index if not exists workspace_email_attachments_client_idx on private.workspace_email_attachments(client_email_message_id);

-- ---------------------------------------------------------------- who
-- Everyone who answers these: active admins and super admins, and Stays people on the client relations or management rota.
create or replace function private.workspace_client_email_team() returns setof uuid language sql stable security definer set search_path='' as $$
 select p.user_id from public.workspace_profiles p where p.status='active' and (p.role in ('admin','super_admin')
  or (p.role='stays' and exists(select 1 from private.workspace_staff_rota r where r.user_id=p.user_id and r.department in ('client_relations','management'))))
$$;

-- ---------------------------------------------------------------- in
-- An email from an address that is not an owner's: into the conversation it replies to (In-Reply-To / References against what we
-- stored or sent), else the latest conversation with that address (reopened), else a new one. Tells the client team.
create or replace function private.workspace_client_email_in(eid text,sender text,sname text,subj text,body text,at timestamptz,mid text,irt text,refs text[],input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare th private.workspace_client_email_threads;ids text[]:=array_remove(array[irt]||refs,null);msg uuid;ev bigint;fresh boolean:=false;begin
 if cardinality(ids)>0 then
  select t.* into th from private.workspace_client_email_messages m join private.workspace_client_email_threads t on t.id=m.thread_id
   where lower(m.rfc_message_id)=any(ids) and t.status<>'assigned' order by t.last_message_at desc limit 1;
 end if;
 if th.id is null then
  select * into th from private.workspace_client_email_threads t where t.address=sender and t.status<>'assigned' order by t.last_message_at desc limit 1;
 end if;
 if th.id is null then
  insert into private.workspace_client_email_threads(address,name,subject,last_message_at) values(sender,sname,nullif(subj,''),at) returning * into th;
  fresh:=true;
 end if;
 -- A conversation shows its subject in the header; the first email also starts with it, as written in the message.
 if fresh and coalesce(subj,'')<>'' and body not like 'Subject: %' then body:='Subject: '||subj||E'\n\n'||body;end if;
 insert into private.workspace_client_email_messages(thread_id,direction,email_id,body,sent_at,rfc_message_id,in_reply_to,refs)
  values(th.id,'in',eid,left(body,5000),at,mid,irt,refs) on conflict do nothing returning id into msg;
 if msg is null then return th.id;end if;
 update private.workspace_client_email_threads set status='open',closed_at=null,closed_by=null,last_message_at=greatest(last_message_at,at),
  name=coalesce(name,sname),subject=coalesce(subject,nullif(subj,'')) where id=th.id;
 if jsonb_typeof(input->'attachments')='array' then
  insert into private.workspace_email_attachments(client_email_message_id,path,filename,mime,bytes)
   select msg,a->>'path',left(coalesce(nullif(a->>'filename',''),'attachment'),200),a->>'mime',(a->>'bytes')::integer from jsonb_array_elements(input->'attachments') a limit 10
   on conflict(path) do nothing;
 end if;
 begin
  insert into public.workspace_activity(actor_id,property_id,event_type) values(null,null,'client.email') returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id) select u,ev from private.workspace_client_email_team() u on conflict do nothing;
 exception when others then raise warning 'Client email notices skipped: %',sqlerrm;
 end;
 return th.id;
end $$;

-- Replaced whole (only 20261016500000 defines it): an unknown sender now starts or joins a client email conversation.
create or replace function private.workspace_email_owner_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];owner uuid;n integer;body text;th uuid;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','from','fromName','subject','text','receivedAt','messageId','inReplyTo','references','attachments'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or char_length(coalesce(input->>'emailId',''))=0 then raise exception 'Invalid email' using errcode='22023';end if;
 eid:=left(input->>'emailId',200);sender:=private.workspace_email_clean(input->>'from');
 if sender is null or not private.workspace_email_valid(sender) then raise exception 'Invalid sender' using errcode='22023';end if;
 sname:=nullif(left(btrim(coalesce(input->>'fromName','')),200),'');subj:=left(btrim(coalesce(input->>'subject','')),300);
 txt:=btrim(coalesce(input->>'text',''));at:=coalesce((input->>'receivedAt')::timestamptz,now());
 if at>now()+interval '5 minutes' then at:=now();end if;
 mid:=private.workspace_email_msgid(input->>'messageId');irt:=private.workspace_email_msgid(input->>'inReplyTo');
 refs:=coalesce((select array_agg(distinct r) from (select private.workspace_email_msgid(x) r from jsonb_array_elements_text(case when jsonb_typeof(input->'references')='array' then input->'references' else '[]'::jsonb end) x limit 50) q where r is not null),'{}');
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,from_address,received_at) values(eid,'owner','stored',sender,at) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('duplicate',true);end if;
 owner:=private.workspace_email_owner_find(sender);
 if owner is null then
  body:=case when btrim(txt)='' then '(no text)' else txt end;
  th:=private.workspace_client_email_in(eid,sender,sname,subj,body,at,mid,irt,refs,input);
  return jsonb_build_object('stored',true,'matched','unknown','threadId',th);
 end if;
 body:=case when subj<>'' then 'Subject: '||subj||E'\n\n'||txt else txt end;
 if btrim(body)='' then body:='(no text)';end if;
 perform private.workspace_email_owner_post(owner,eid,body,at,input,sender,subj,mid,irt,refs);
 return jsonb_build_object('stored',true,'matched','owner');
end $$;

-- The old list becomes conversations (each open row once; dismissed and assigned rows stay as they were).
do $$ declare u record;begin
 for u in select * from private.workspace_email_unknown_senders where status='open' order by received_at loop
  if not exists(select 1 from private.workspace_client_email_messages m where m.email_id=u.email_id) then
   perform private.workspace_client_email_in(u.email_id,u.from_address,u.from_name,coalesce(u.subject,''),u.body,u.received_at,u.rfc_message_id,u.in_reply_to,u.refs,'{}'::jsonb);
  end if;
  update private.workspace_email_unknown_senders set status='assigned',resolved_at=coalesce(resolved_at,now()) where email_id=u.email_id and status='open';
 end loop;
end $$;

-- ---------------------------------------------------------------- read
create or replace function private.workspace_client_email_json(t private.workspace_client_email_threads) returns jsonb language sql stable security definer set search_path='' as $$
 with msgs as (select m.* from private.workspace_client_email_messages m where m.thread_id=t.id and m.status in ('received','sent')),
 last as (select * from msgs order by sent_at desc,id desc limit 1),
 answered as (select max(sent_at) v from msgs where direction='out')
 select jsonb_build_object('id',t.id,'address',t.address,'name',t.name,'subject',t.subject,'status',t.status,'lastMessageAt',t.last_message_at,
  'preview',(select left(last.body,160) from last),'lastFrom',(select last.direction from last),
  'waitingSince',case when t.status='open' then (select min(m.sent_at) from msgs m where m.direction='in' and m.sent_at>coalesce((select v from answered),'-infinity'::timestamptz)) end,
  'messages',(select count(*) from msgs))
$$;

create or replace function private.workspace_client_email_read(section text,target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare th private.workspace_client_email_threads;begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 if section='list' then
  return jsonb_build_object('threads',coalesce((select jsonb_agg(private.workspace_client_email_json(t) order by t.last_message_at desc)
   from (select * from private.workspace_client_email_threads where status in ('open','closed') order by last_message_at desc limit 300) t),'[]'));
 elsif section='thread' then
  select * into th from private.workspace_client_email_threads where id=target and status in ('open','closed');
  if th.id is null then raise exception 'Conversation not found' using errcode='P0002';end if;
  return jsonb_build_object('thread',private.workspace_client_email_json(th),'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'sentAt',m.sent_at,
    'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id),
    'files',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'bytes',a.bytes) order by a.created_at) from private.workspace_email_attachments a where a.client_email_message_id=m.id),'[]'::jsonb))
    order by m.sent_at,m.id) from private.workspace_client_email_messages m where m.thread_id=th.id and m.status in ('received','sent')),'[]'));
 end if;
 raise exception 'Unknown section' using errcode='22023';
end $$;

-- ---------------------------------------------------------------- actions
-- reply: recorded once per request id; the Worker sends it as ownerrelations@ and reports back (workspace_client_email_result).
-- A request already sent, or still going out (under 2 minutes), is not sent again; a failed or stuck one may be tried again.
create or replace function private.workspace_client_email_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();a text:=input->>'action';th private.workspace_client_email_threads;req uuid;v_body text;m private.workspace_client_email_messages;
 owner uuid;last_in private.workspace_client_email_messages;x record;cm uuid;conv private.chat_conversations;begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 select * into th from private.workspace_client_email_threads where id=(input->>'threadId')::uuid for update;
 if th.id is null or th.status='assigned' then raise exception 'Conversation not found' using errcode='P0002';end if;
 if a='reply' then
  perform private.workspace_json_keys(input,array['action','requestId','threadId','body']);
  req:=(input->>'requestId')::uuid;
  if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
  v_body:=regexp_replace(coalesce(input->>'body',''),'^\s+|\s+$','','g');
  if char_length(v_body) not between 1 and 5000 then raise exception 'Write the reply (up to 5,000 characters)' using errcode='22023';end if;
  select * into m from private.workspace_client_email_messages where request_id=req;
  if m.id is not null then
   if m.thread_id<>th.id or m.author_user_id is distinct from me then raise exception 'Request identifier already used' using errcode='22023';end if;
   if m.status='sent' or (m.status='sending' and m.created_at>now()-interval '2 minutes') then return jsonb_build_object('send',false,'thread',private.workspace_client_email_json(th));end if;
   update private.workspace_client_email_messages set status='sending',body=v_body,error=null,created_at=now() where id=m.id;
  else
   insert into private.workspace_client_email_messages(thread_id,direction,request_id,body,author_user_id,status) values(th.id,'out',req,v_body,me,'sending');
  end if;
  select * into last_in from private.workspace_client_email_messages where thread_id=th.id and rfc_message_id is not null and status in ('received','sent') order by sent_at desc,id desc limit 1;
  return jsonb_build_object('send',true,'requestId',req,'email',jsonb_build_object('to',th.address,
   'subject',case when coalesce(th.subject,'') ~* '^(re|aw):' then th.subject else 'Re: '||coalesce(th.subject,'Your message') end,
   'inReplyTo',last_in.rfc_message_id,'references',coalesce(to_jsonb((last_in.refs||last_in.rfc_message_id)[greatest(1,cardinality(last_in.refs||last_in.rfc_message_id)-19):]),'[]'::jsonb)));
 elsif a in ('close','reopen') then
  perform private.workspace_json_keys(input,array['action','threadId']);
  update private.workspace_client_email_threads set status=case when a='close' then 'closed' else 'open' end,
   closed_at=case when a='close' then now() end,closed_by=case when a='close' then me end where id=th.id;
 elsif a='assign' then
  -- Moves the history into the owner's conversation (their emails as theirs, the team's replies as the team's), remembers the address.
  perform private.workspace_json_keys(input,array['action','threadId','ownerId']);
  owner:=(input->>'ownerId')::uuid;
  if owner is null or not exists(select 1 from public.workspace_profiles where user_id=owner and role='client' and status='active') or not private.chat_owner_team(owner,me) then raise exception 'Owner not found' using errcode='42501';end if;
  conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
  if conv.id is null then
   insert into private.chat_conversations(kind,owner_id,created_by) values('owner',owner,me) on conflict do nothing;
   conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
   insert into private.chat_members(conversation_id,user_id) values(conv.id,owner) on conflict do nothing;
  end if;
  perform set_config('recharge.email_move','on',true);
  for x in select * from private.workspace_client_email_messages where thread_id=th.id and status in ('received','sent') order by sent_at,id loop
   insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at)
    values(conv.id,case when x.direction='in' then owner else coalesce(x.author_user_id,me) end,left(x.body,4000),x.id,x.sent_at)
    on conflict(author_id,request_id) do nothing returning id into cm;
   if cm is not null then
    insert into private.workspace_email_messages(mailbox,direction,chat_message_id,rfc_message_id,in_reply_to,refs,from_address,subject)
     values('owner',x.direction,cm,x.rfc_message_id,x.in_reply_to,x.refs,case when x.direction='in' then th.address else 'ownerrelations@rechargegroup.co.uk' end,th.subject) on conflict do nothing;
    update private.workspace_email_attachments set client_email_message_id=null,chat_message_id=cm where client_email_message_id=x.id;
   end if;
  end loop;
  perform set_config('recharge.email_move','off',true);
  update private.chat_conversations set last_message_at=greatest(last_message_at,th.last_message_at) where id=conv.id;
  insert into private.workspace_email_owner_addresses(address,owner_id,added_by) values(th.address,owner,me) on conflict(address) do nothing;
  update private.workspace_client_email_threads set status='assigned',owner_id=owner,assigned_at=now(),assigned_by=me where id=th.id;
  return jsonb_build_object('ok',true,'conversationId',conv.id);
 else raise exception 'Unknown action' using errcode='22023';end if;
 return jsonb_build_object('ok',true,'thread',private.workspace_client_email_json((select t from private.workspace_client_email_threads t where t.id=th.id)));
end $$;

-- Replaced whole (only 20261016500000 defines it): the owner email reply queue skips a history moved in by Assign to owner.
create or replace function private.workspace_email_owner_reply_queue() returns trigger language plpgsql security definer set search_path='' as $fn$
declare c private.chat_conversations;e private.workspace_email_messages;begin
 begin
  select * into c from private.chat_conversations where id=new.conversation_id and kind='owner';
  -- A history moved in by Assign to owner is not emailed again.
  if current_setting('recharge.email_move',true)='on' then return new;end if;
  if c.id is null or new.author_id=c.owner_id then return new;end if;
  -- the owner's latest message, and only when it arrived by email
  select e2.* into e from private.chat_messages m join private.workspace_email_messages e2 on e2.chat_message_id=m.id and e2.direction='in'
   where m.conversation_id=c.id and m.author_id=c.owner_id and m.created_at=(select max(x.created_at) from private.chat_messages x where x.conversation_id=c.id and x.author_id=c.owner_id)
   order by m.id limit 1;
  if e.id is not null and e.from_address is not null then
   insert into private.workspace_email_outbox(chat_message_id,to_address,subject,body,in_reply_to,refs)
    values(new.id,e.from_address,case when coalesce(e.subject,'') ~* '^(re|aw):' then e.subject else 'Re: '||coalesce(e.subject,'Your message') end,left(new.body,4000),e.rfc_message_id,(e.refs||e.rfc_message_id)[greatest(1,cardinality(e.refs||e.rfc_message_id)-19):])
    on conflict(chat_message_id) do nothing;
  end if;
 exception when others then
  -- A queued email is never worth losing the team's message.
  raise warning 'Owner email reply not queued: %',sqlerrm;
 end;
 return new;
end $fn$;

-- The Worker, after Resend: ok stores the reply (with the Message-ID it went out under); not ok marks it failed. Repeating changes nothing.
create or replace function private.workspace_client_email_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.workspace_client_email_messages;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','ok','messageId','error'))
  or jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(input->'ok') is distinct from 'boolean' then raise exception 'Invalid reply result' using errcode='22023';end if;
 select * into m from private.workspace_client_email_messages where request_id=(input->>'requestId')::uuid for update;
 if m.id is null then raise exception 'Reply request not found' using errcode='P0002';end if;
 if m.status='sent' then return jsonb_build_object('recorded',false);end if;
 if (input->>'ok')::boolean then
  update private.workspace_client_email_messages set status='sent',error=null,sent_at=now(),rfc_message_id=private.workspace_email_msgid(input->>'messageId') where id=m.id;
  update private.workspace_client_email_threads set last_message_at=greatest(last_message_at,now()) where id=m.thread_id;
 else
  update private.workspace_client_email_messages set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where id=m.id;
 end if;
 return jsonb_build_object('recorded',true);
end $$;

-- Replaced whole (only 20261016500000 defines it): attachments of client email conversations open for the client team.
create or replace function private.workspace_email_files(ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'filename',a.filename,'mime',a.mime,'bytes',a.bytes)),'[]')
 from private.workspace_email_attachments a where a.id=any(ids) and (
  (a.guest_message_id is not null and private.workspace_guest_messaging_role(private.workspace_actor_role()) and exists(
    select 1 from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
    where g.id=a.guest_message_id and private.guest_inbox_can(t.property_id)))
  or (a.chat_message_id is not null and exists(select 1 from private.chat_messages m where m.id=a.chat_message_id and private.chat_can(m.conversation_id,auth.uid())))
  or (a.client_email_message_id is not null and private.workspace_email_owner_team()))
$$;

-- ---------------------------------------------------------------- wrappers and grants
create or replace function public.workspace_client_email_read(section text,target uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_email_read(section,target);$$;
create or replace function public.workspace_client_email_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_email_action(input);$$;
create or replace function public.workspace_client_email_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_client_email_result(input);$$;
revoke all on function private.workspace_client_email_team(),private.workspace_client_email_in(text,text,text,text,text,timestamptz,text,text,text[],jsonb),
 private.workspace_client_email_json(private.workspace_client_email_threads) from public,anon,authenticated,service_role;
revoke all on function private.workspace_client_email_read(text,uuid),private.workspace_client_email_action(jsonb),private.workspace_client_email_result(jsonb),
 public.workspace_client_email_read(text,uuid),public.workspace_client_email_action(jsonb),public.workspace_client_email_result(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_client_email_read(text,uuid),private.workspace_client_email_action(jsonb),
 public.workspace_client_email_read(text,uuid),public.workspace_client_email_action(jsonb) to authenticated;
grant execute on function private.workspace_client_email_result(jsonb),public.workspace_client_email_result(jsonb) to service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('20261019500000','client_email_threads');

commit;
