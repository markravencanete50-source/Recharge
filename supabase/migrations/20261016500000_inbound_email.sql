-- Email for guests and clients through Resend (round 6, Session F).
--   guestrelations@rechargegroup.co.uk -> Messages > Guests (source 'email'); ownerrelations@rechargegroup.co.uk -> Messages > Clients.
-- Fasthosts keeps both mailboxes and forwards a copy to Resend inbound; the Worker verifies Resend's signed webhook, fetches the
-- email, drops spam and failed SPF/DKIM/DMARC, and stores it through the functions below (service role only).
-- Guest email goes through workspace_guest_messages_ingest, so the privacy rules of the guest inbox apply unchanged: owners, cleaners
-- and Ready never see it (workspace_guest_messaging_role), in the database as well as on screen. Owner email goes into that owner's
-- own conversation. Replies go out through Resend: guests synchronously (the existing sendReply action, once per request id), owners
-- through an outbox the Worker empties every minute. Safe to run twice.

-- ---------------------------------------------------------------- tables
alter table private.workspace_guest_threads add column if not exists guest_email text check(guest_email is null or char_length(guest_email) between 3 and 320);
create index if not exists workspace_guest_threads_email_idx on private.workspace_guest_threads(lower(guest_email)) where source='email';

-- One row per email Resend delivered (its id), so a repeated webhook is stored once. Dropped emails keep no content.
create table if not exists private.workspace_email_inbound (
 email_id text primary key check(char_length(email_id) between 1 and 200),
 mailbox text not null check(mailbox in ('guest','owner')),
 outcome text not null check(outcome in ('stored','dropped')),
 reason text check(reason is null or char_length(reason)<=200),
 from_address text check(from_address is null or char_length(from_address)<=320),
 received_at timestamptz not null default now()
);
create index if not exists workspace_email_inbound_time_idx on private.workspace_email_inbound(received_at);

-- The mail headers of each stored email, in or out: what a reply's In-Reply-To and References are matched against.
create table if not exists private.workspace_email_messages (
 id uuid primary key default gen_random_uuid(),
 mailbox text not null check(mailbox in ('guest','owner')),
 direction text not null check(direction in ('in','out')),
 guest_message_id uuid references private.workspace_guest_messages(id) on delete cascade,
 chat_message_id uuid references private.chat_messages(id) on delete cascade,
 rfc_message_id text check(rfc_message_id is null or char_length(rfc_message_id) between 1 and 998),
 in_reply_to text check(in_reply_to is null or char_length(in_reply_to)<=998),
 refs text[] not null default '{}' check(cardinality(refs)<=50),
 from_address text check(from_address is null or char_length(from_address)<=320),
 to_address text check(to_address is null or char_length(to_address)<=320),
 subject text check(subject is null or char_length(subject)<=300),
 created_at timestamptz not null default now(),
 check((guest_message_id is not null)::int+(chat_message_id is not null)::int=1)
);
create unique index if not exists workspace_email_messages_rfc_idx on private.workspace_email_messages(lower(rfc_message_id)) where rfc_message_id is not null;
create unique index if not exists workspace_email_messages_guest_idx on private.workspace_email_messages(guest_message_id) where guest_message_id is not null;
create unique index if not exists workspace_email_messages_chat_idx on private.workspace_email_messages(chat_message_id) where chat_message_id is not null;

-- Attachments kept in the private bucket 'email-files' (type and size checked from the bytes by the Worker).
create table if not exists private.workspace_email_attachments (
 id uuid primary key default gen_random_uuid(),
 guest_message_id uuid references private.workspace_guest_messages(id) on delete cascade,
 chat_message_id uuid references private.chat_messages(id) on delete cascade,
 path text not null unique check(char_length(path) between 3 and 300),
 filename text not null check(char_length(filename) between 1 and 200),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
 bytes integer not null check(bytes between 1 and 10485760),
 created_at timestamptz not null default now(),
 check((guest_message_id is not null)::int+(chat_message_id is not null)::int=1)
);
create index if not exists workspace_email_attachments_guest_idx on private.workspace_email_attachments(guest_message_id);
create index if not exists workspace_email_attachments_chat_idx on private.workspace_email_attachments(chat_message_id);

-- Owner email from an address we do not know, waiting for Client relations; and addresses they matched to an owner.
create table if not exists private.workspace_email_unknown_senders (
 email_id text primary key references private.workspace_email_inbound(email_id) on delete cascade,
 from_address text not null check(char_length(from_address) between 3 and 320),
 from_name text check(from_name is null or char_length(from_name)<=200),
 subject text check(subject is null or char_length(subject)<=300),
 body text not null default '' check(char_length(body)<=5000),
 rfc_message_id text, in_reply_to text, refs text[] not null default '{}',
 received_at timestamptz not null default now(),
 status text not null default 'open' check(status in ('open','assigned','dismissed')),
 owner_id uuid references public.workspace_profiles(user_id),
 resolved_by uuid references public.workspace_profiles(user_id),
 resolved_at timestamptz
);
create index if not exists workspace_email_unknown_open_idx on private.workspace_email_unknown_senders(status,received_at desc);
create table if not exists private.workspace_email_owner_addresses (
 address text primary key check(address=lower(address) and char_length(address) between 3 and 320),
 owner_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 added_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);

-- Replies to owners who wrote by email, sent by the Worker through Resend (once per row: the row id is the idempotency key).
create table if not exists private.workspace_email_outbox (
 id uuid primary key default gen_random_uuid(),
 chat_message_id uuid not null unique references private.chat_messages(id) on delete cascade,
 mailbox text not null default 'owner' check(mailbox='owner'),
 to_address text not null check(char_length(to_address) between 3 and 320),
 subject text not null check(char_length(subject)<=300),
 body text not null check(char_length(body) between 1 and 4000),
 in_reply_to text, refs text[] not null default '{}',
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 error text check(error is null or char_length(error)<=300),
 rfc_message_id text,
 claimed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists workspace_email_outbox_due_idx on private.workspace_email_outbox(status,created_at);

do $$ declare t text; begin
 foreach t in array array['workspace_email_inbound','workspace_email_messages','workspace_email_attachments','workspace_email_unknown_senders','workspace_email_owner_addresses','workspace_email_outbox'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- A private bucket for the attachments (where storage exists; the tests have none).
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('email-files','email-files',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
   on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function private.workspace_email_clean(v text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(v)),'')
$$;
create or replace function private.workspace_email_valid(v text) returns boolean language sql immutable set search_path='' as $$
 select v ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(v)<=320
$$;
-- The Message-ID of an email, kept without angle brackets and capitals.
create or replace function private.workspace_email_msgid(v text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(btrim(coalesce(v,'')),'<>')),'')
$$;
-- Quoted text and long signatures stay in the mailbox; the conversation keeps the new text.
create or replace function private.workspace_email_attachments_add(input jsonb,gm uuid,cm uuid) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb;begin
 if jsonb_typeof(input->'attachments')='array' then
  for a in select value from jsonb_array_elements(input->'attachments') limit 10 loop
   insert into private.workspace_email_attachments(guest_message_id,chat_message_id,path,filename,mime,bytes)
    values(gm,cm,a->>'path',left(coalesce(nullif(a->>'filename',''),'attachment'),200),a->>'mime',(a->>'bytes')::integer) on conflict(path) do nothing;
  end loop;
 end if;
end $$;

-- ---------------------------------------------------------------- drops
-- The Worker dropped an email (spam, failed SPF/DKIM/DMARC, no valid sender): only the fact is kept, never the content.
create or replace function private.workspace_email_drop(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','mailbox','from','reason'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or input->>'mailbox' not in ('guest','owner') then raise exception 'Invalid email drop' using errcode='22023';end if;
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,reason,from_address)
  values(left(input->>'emailId',200),input->>'mailbox','dropped',left(coalesce(input->>'reason',''),200),left(private.workspace_email_clean(input->>'from'),320)) on conflict do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('recorded',n=1);
end $$;

-- ---------------------------------------------------------------- guest email in
-- Matching, in this order (never on the display name):
--   1. In-Reply-To / References against an email we stored (sent or received);
--   2. a booking code (6 to 20 letters and digits) from a stay, found in the subject or text, against that stay's conversation;
--   3. the sender's address against an earlier email conversation;
--   4. otherwise a new unmatched email conversation (property empty, shared with everyone who may use the guest inbox).
create or replace function private.workspace_email_guest_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];ids text[];
 th private.workspace_guest_threads;st private.workspace_reservations;code text;how text;ref text;fresh boolean:=false;gm uuid;body text;n integer;
begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','from','fromName','subject','text','receivedAt','messageId','inReplyTo','references','attachments'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or char_length(coalesce(input->>'emailId',''))=0 then raise exception 'Invalid email' using errcode='22023';end if;
 eid:=left(input->>'emailId',200);sender:=private.workspace_email_clean(input->>'from');
 if sender is null or not private.workspace_email_valid(sender) then raise exception 'Invalid sender' using errcode='22023';end if;
 sname:=nullif(left(btrim(coalesce(input->>'fromName','')),120),'');subj:=left(btrim(coalesce(input->>'subject','')),300);
 txt:=btrim(coalesce(input->>'text',''));at:=coalesce((input->>'receivedAt')::timestamptz,now());
 if at>now()+interval '5 minutes' then at:=now();end if;
 mid:=private.workspace_email_msgid(input->>'messageId');irt:=private.workspace_email_msgid(input->>'inReplyTo');
 refs:=coalesce((select array_agg(distinct r) from (select private.workspace_email_msgid(x) r from jsonb_array_elements_text(case when jsonb_typeof(input->'references')='array' then input->'references' else '[]'::jsonb end) x limit 50) q where r is not null),'{}');
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,from_address,received_at) values(eid,'guest','stored',sender,at) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('duplicate',true);end if;
 ids:=array_remove(array[irt]||refs,null);
 -- 1. a reply to something we stored
 if cardinality(ids)>0 then
  select t.* into th from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
   where e.mailbox='guest' and lower(e.rfc_message_id)=any(ids) order by t.last_message_at desc nulls last limit 1;
  if th.id is not null then how:='reply';end if;
 end if;
 -- 2. a booking code of a stay
 if th.id is null then
  select r.* into st from private.workspace_reservations r where r.status='confirmed' and r.check_out>=current_date-30 and exists(select 1 from unnest(private.workspace_stay_codes(r.channel_reference,r.reference)) c
   where c ~ '^[A-Z0-9]{6,20}$' and upper(subj||' '||txt) ~ ('(^|[^A-Z0-9])'||c||'([^A-Z0-9]|$)')) order by r.check_in desc limit 1;
  if st.id is not null then
   select c into code from unnest(private.workspace_stay_codes(st.channel_reference,st.reference)) c where c ~ '^[A-Z0-9]{6,20}$' and upper(subj||' '||txt) ~ ('(^|[^A-Z0-9])'||c||'([^A-Z0-9]|$)') limit 1;
   select * into th from private.workspace_guest_threads t where t.source='email' and upper(t.reservation_ref)=code order by t.last_message_at desc nulls last limit 1;
   how:='booking';ref:=code;
  end if;
 end if;
 -- 3. the same sender as an earlier email conversation
 if th.id is null then
  select * into th from private.workspace_guest_threads t where t.source='email' and lower(t.guest_email)=sender order by t.last_message_at desc nulls last limit 1;
  if th.id is not null then how:='sender';end if;
 end if;
 -- 4. new
 if th.id is null then
  fresh:=true;how:=coalesce(how,'new');
 end if;
 body:=case when fresh and subj<>'' then 'Subject: '||subj||E'\n\n'||txt else txt end;
 if body='' then body:='(no text)';end if;
 perform private.workspace_guest_messages_ingest(jsonb_build_object('source','email','messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'externalId','email:'||eid,'threadRef',coalesce(th.thread_ref,'email:'||gen_random_uuid()::text),'channel','email','direction','guest','sentAt',at,'body',body,
  'guestName',case when th.id is null or th.guest_name is null then coalesce(sname,sender) end,'propertyId',case when th.id is null then st.property_id end,
  'reservationRef',case when th.id is null then ref end,'checkIn',case when th.id is null then st.check_in end,'checkOut',case when th.id is null then st.check_out end)))));
 select g.id,t.id into gm,th.id from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref where g.source='email' and g.external_id='email:'||eid;
 update private.workspace_guest_threads set guest_email=coalesce(guest_email,sender) where id=th.id;
 insert into private.workspace_email_messages(mailbox,direction,guest_message_id,rfc_message_id,in_reply_to,refs,from_address,subject)
  values('guest','in',gm,mid,irt,refs,sender,nullif(subj,'')) on conflict do nothing;
 perform private.workspace_email_attachments_add(input,gm,null);
 return jsonb_build_object('stored',true,'threadId',th.id,'matched',how);
end $$;

-- ---------------------------------------------------------------- owner email in
create or replace function private.workspace_email_owner_find(sender text) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(
  (select a.owner_id from private.workspace_email_owner_addresses a join public.workspace_profiles p on p.user_id=a.owner_id and p.role='client' and p.status='active' where a.address=sender),
  (select p.user_id from public.workspace_profiles p join auth.users u on u.id=p.user_id where p.role='client' and p.status='active' and lower(u.email)=sender order by p.created_at limit 1))
$$;

-- Posts the email into the owner's one conversation with Recharge, as the owner, and tells whoever answers owners.
create or replace function private.workspace_email_owner_post(owner uuid,eid text,body text,at timestamptz,input jsonb,sender text,subj text,mid text,irt text,refs text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare conv private.chat_conversations;msg uuid:=gen_random_uuid();req uuid:=md5('email:'||eid)::uuid;ev bigint;begin
 conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
 if conv.id is null then
  insert into private.chat_conversations(kind,owner_id,created_by) values('owner',owner,owner) on conflict do nothing;
  conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
  insert into private.chat_members(conversation_id,user_id) values(conv.id,owner) on conflict do nothing;
 end if;
 insert into private.chat_messages(id,conversation_id,author_id,body,request_id,created_at) values(msg,conv.id,owner,left(btrim(body),4000),req,at) on conflict(author_id,request_id) do nothing;
 msg:=(select m.id from private.chat_messages m where m.author_id=owner and m.request_id=req);
 update private.chat_conversations set last_message_at=greatest(last_message_at,at) where id=conv.id;
 insert into private.workspace_email_messages(mailbox,direction,chat_message_id,rfc_message_id,in_reply_to,refs,from_address,subject)
  values('owner','in',msg,mid,irt,refs,sender,nullif(subj,'')) on conflict do nothing;
 perform private.workspace_email_attachments_add(input,null,msg);
 insert into public.workspace_activity(actor_id,property_id,event_type) values(owner,conv.property_id,'chat.owner_message') returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id)
  select u,ev from private.chat_audience(conv.id) u where u<>owner and not private.chat_blocked(u,owner) on conflict do nothing;
 return msg;
end $$;

create or replace function private.workspace_email_owner_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];owner uuid;n integer;body text;begin
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
 body:=case when subj<>'' then 'Subject: '||subj||E'\n\n'||txt else txt end;
 if btrim(body)='' then body:='(no text)';end if;
 owner:=private.workspace_email_owner_find(sender);
 if owner is null then
  insert into private.workspace_email_unknown_senders(email_id,from_address,from_name,subject,body,rfc_message_id,in_reply_to,refs,received_at)
   values(eid,sender,sname,nullif(subj,''),left(body,5000),mid,irt,refs,at);
  return jsonb_build_object('stored',true,'matched','unknown');
 end if;
 perform private.workspace_email_owner_post(owner,eid,body,at,input,sender,subj,mid,irt,refs);
 return jsonb_build_object('stored',true,'matched','owner');
end $$;

-- ---------------------------------------------------------------- unknown senders (Client relations)
create or replace function private.workspace_email_owner_team() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_actor_role() in ('stays') and exists(select 1 from private.workspace_staff_rota r where r.user_id=auth.uid() and r.department in ('client_relations','management'))),false)
$$;

create or replace function private.workspace_email_unknown_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 return jsonb_build_object('senders',coalesce((select jsonb_agg(jsonb_build_object('id',u.email_id,'from',u.from_address,'name',u.from_name,'subject',u.subject,'body',u.body,'receivedAt',u.received_at) order by u.received_at desc)
  from (select * from private.workspace_email_unknown_senders where status='open' order by received_at desc limit 200) u),'[]'));
end $$;

create or replace function private.workspace_email_unknown_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();a text:=input->>'action';u private.workspace_email_unknown_senders;owner uuid;begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','id','ownerId']);
 select * into u from private.workspace_email_unknown_senders where email_id=input->>'id' for update;
 if u.email_id is null or u.status<>'open' then raise exception 'Email not found' using errcode='P0002';end if;
 if a='dismiss' then
  update private.workspace_email_unknown_senders set status='dismissed',resolved_by=me,resolved_at=now() where email_id=u.email_id;
 elsif a='assign' then
  owner:=(input->>'ownerId')::uuid;
  if owner is null or not exists(select 1 from public.workspace_profiles where user_id=owner and role='client' and status='active') or not private.chat_owner_team(owner,me) then raise exception 'Owner not found' using errcode='42501';end if;
  -- This address now counts as the owner's, so their next emails land in the conversation by themselves.
  insert into private.workspace_email_owner_addresses(address,owner_id,added_by) values(u.from_address,owner,me) on conflict(address) do nothing;
  perform private.workspace_email_owner_post(owner,u.email_id,u.body,u.received_at,'{}'::jsonb,u.from_address,u.subject,u.rfc_message_id,u.in_reply_to,u.refs);
  update private.workspace_email_unknown_senders set status='assigned',owner_id=owner,resolved_by=me,resolved_at=now() where email_id=u.email_id;
 else raise exception 'Unknown action' using errcode='22023';end if;
 return jsonb_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- attachments: who may open them
-- Returns the stored path of each attachment the signed-in person may open; the Worker then signs a short link.
create or replace function private.workspace_email_files(ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'filename',a.filename,'mime',a.mime,'bytes',a.bytes)),'[]')
 from private.workspace_email_attachments a where a.id=any(ids) and (
  (a.guest_message_id is not null and private.workspace_guest_messaging_role(private.workspace_actor_role()) and exists(
    select 1 from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
    where g.id=a.guest_message_id and private.guest_inbox_can(t.property_id)))
  or (a.chat_message_id is not null and exists(select 1 from private.chat_messages m where m.id=a.chat_message_id and private.chat_can(m.conversation_id,auth.uid()))))
$$;

-- ---------------------------------------------------------------- replies out
-- A conversation that began as an email is answered by email: to the sender's address, as guestrelations@, with In-Reply-To and
-- References from the latest email in the conversation.
create or replace function private.workspace_email_reply_context(th private.workspace_guest_threads) returns jsonb language sql stable security definer set search_path='' as $$
 with last as (select e.* from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   where g.source=th.source and g.thread_ref=th.thread_ref and e.rfc_message_id is not null order by g.sent_at desc,g.id desc limit 1),
 first as (select e.subject from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   where g.source=th.source and g.thread_ref=th.thread_ref and e.subject is not null order by g.sent_at,g.id limit 1)
 select jsonb_build_object('to',th.guest_email,'subject',(select case when s.subject ~* '^(re|aw):' then s.subject else 'Re: '||s.subject end from first s),
  'inReplyTo',(select l.rfc_message_id from last l),'references',coalesce((select to_jsonb((l.refs||l.rfc_message_id)[greatest(1,cardinality(l.refs||l.rfc_message_id)-19):]) from last l),'[]'::jsonb))
$$;

-- The team's reply, after Resend accepted it (service role): stored once per request, with the Message-ID it went out under.
create or replace function private.workspace_email_reply_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rq private.workspace_guest_reply_requests;th private.workspace_guest_threads;gm uuid;ext text;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','ok','resendId','messageId','error'))
  or jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(input->'ok') is distinct from 'boolean' then raise exception 'Invalid reply result' using errcode='22023';end if;
 select * into rq from private.workspace_guest_reply_requests where request_id=(input->>'requestId')::uuid for update;
 if not found then raise exception 'Reply request not found' using errcode='P0002';end if;
 if rq.status='sent' then return jsonb_build_object('recorded',false);end if;
 if not (input->>'ok')::boolean then
  update private.workspace_guest_reply_requests set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where request_id=rq.request_id;
  return jsonb_build_object('recorded',true);
 end if;
 th:=(select x from private.workspace_guest_threads x where x.id=rq.thread_id for update);
 ext:='email-out:'||rq.request_id;
 insert into private.workspace_guest_messages as g(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
  values(th.source,ext,th.thread_ref,th.property_id,'email','team',now(),rq.user_id,rq.body,'sent') on conflict(source,external_id) do nothing;
 gm:=(select g.id from private.workspace_guest_messages g where g.source=th.source and g.external_id=ext);
 insert into private.workspace_email_messages(mailbox,direction,guest_message_id,rfc_message_id,in_reply_to,from_address,to_address)
  values('guest','out',gm,private.workspace_email_msgid(input->>'messageId'),null,'guestrelations@rechargegroup.co.uk',th.guest_email) on conflict do nothing;
 update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,now()),now()) where id=th.id;
 update private.workspace_guest_reply_requests set status='sent',hostaway_message_id=null,error=null where request_id=rq.request_id;
 return jsonb_build_object('recorded',true);
end $$;

-- A team reply in an owner conversation whose latest owner message came by email is queued to be emailed too.
create or replace function private.workspace_email_owner_reply_queue() returns trigger language plpgsql security definer set search_path='' as $fn$
declare c private.chat_conversations;e private.workspace_email_messages;begin
 begin
  select * into c from private.chat_conversations where id=new.conversation_id and kind='owner';
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
drop trigger if exists workspace_email_owner_reply_queue on private.chat_messages;
create trigger workspace_email_owner_reply_queue after insert on private.chat_messages for each row execute function private.workspace_email_owner_reply_queue();

-- The Worker takes due rows (or a row left "sending" for over 5 minutes) and reports each result; a row is sent once.
create or replace function private.workspace_email_outbox_claim(max_rows integer default 10) returns jsonb language sql security definer set search_path='' as $$
 with due as (select o.id from private.workspace_email_outbox o where (o.status='pending' or (o.status='sending' and o.claimed_at<now()-interval '5 minutes')) and o.attempts<5
   order by o.created_at limit greatest(1,least(coalesce(max_rows,10),25)) for update skip locked),
 taken as (update private.workspace_email_outbox o set status='sending',attempts=o.attempts+1,claimed_at=now() from due where o.id=due.id
   returning o.id,o.to_address,o.subject,o.body,o.in_reply_to,o.refs,o.created_at)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'to',t.to_address,'subject',t.subject,'body',t.body,'inReplyTo',t.in_reply_to,'references',to_jsonb(t.refs)) order by t.created_at),'[]'::jsonb) from taken t
$$;
create or replace function private.workspace_email_outbox_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.workspace_email_outbox;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('id','ok','messageId','error'))
  or jsonb_typeof(input->'id') is distinct from 'string' or jsonb_typeof(input->'ok') is distinct from 'boolean' then raise exception 'Invalid outbox result' using errcode='22023';end if;
 select * into o from private.workspace_email_outbox where id=(input->>'id')::uuid for update;
 if not found then raise exception 'Outbox row not found' using errcode='P0002';end if;
 if o.status='sent' then return jsonb_build_object('recorded',false);end if;
 if (input->>'ok')::boolean then
  update private.workspace_email_outbox set status='sent',error=null,rfc_message_id=private.workspace_email_msgid(input->>'messageId') where id=o.id;
  insert into private.workspace_email_messages(mailbox,direction,chat_message_id,rfc_message_id,from_address,to_address,subject)
   values('owner','out',o.chat_message_id,private.workspace_email_msgid(input->>'messageId'),'ownerrelations@rechargegroup.co.uk',o.to_address,o.subject) on conflict do nothing;
 else
  update private.workspace_email_outbox set status=case when attempts>=5 then 'failed' else 'pending' end,error=nullif(left(coalesce(input->>'error',''),300),'') where id=o.id;
 end if;
 return jsonb_build_object('recorded',true);
end $$;

-- ---------------------------------------------------------------- public wrappers and grants
create or replace function public.workspace_email_guest_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_guest_ingest(input);$$;
create or replace function public.workspace_email_owner_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_owner_ingest(input);$$;
create or replace function public.workspace_email_drop(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_drop(input);$$;
create or replace function public.workspace_email_reply_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_reply_result(input);$$;
create or replace function public.workspace_email_outbox_claim(max_rows integer default 10) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_outbox_claim(max_rows);$$;
create or replace function public.workspace_email_outbox_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_outbox_result(input);$$;
create or replace function public.workspace_email_unknown_read() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_unknown_read();$$;
create or replace function public.workspace_email_unknown_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_unknown_action(input);$$;
create or replace function public.workspace_email_files(ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_files(ids);$$;

revoke all on function
 private.workspace_email_clean(text),private.workspace_email_valid(text),private.workspace_email_msgid(text),private.workspace_email_attachments_add(jsonb,uuid,uuid),
 private.workspace_email_owner_find(text),private.workspace_email_owner_post(uuid,text,text,timestamptz,jsonb,text,text,text,text,text[]),
 private.workspace_email_owner_team(),private.workspace_email_reply_context(private.workspace_guest_threads),private.workspace_email_owner_reply_queue()
 from public,anon,authenticated,service_role;
revoke all on function
 private.workspace_email_guest_ingest(jsonb),private.workspace_email_owner_ingest(jsonb),private.workspace_email_drop(jsonb),private.workspace_email_reply_result(jsonb),
 private.workspace_email_outbox_claim(integer),private.workspace_email_outbox_result(jsonb),private.workspace_email_unknown_read(),private.workspace_email_unknown_action(jsonb),private.workspace_email_files(uuid[]),
 public.workspace_email_guest_ingest(jsonb),public.workspace_email_owner_ingest(jsonb),public.workspace_email_drop(jsonb),public.workspace_email_reply_result(jsonb),
 public.workspace_email_outbox_claim(integer),public.workspace_email_outbox_result(jsonb),public.workspace_email_unknown_read(),public.workspace_email_unknown_action(jsonb),public.workspace_email_files(uuid[])
 from public,anon,authenticated,service_role;
grant execute on function
 private.workspace_email_guest_ingest(jsonb),private.workspace_email_owner_ingest(jsonb),private.workspace_email_drop(jsonb),private.workspace_email_reply_result(jsonb),
 private.workspace_email_outbox_claim(integer),private.workspace_email_outbox_result(jsonb),
 public.workspace_email_guest_ingest(jsonb),public.workspace_email_owner_ingest(jsonb),public.workspace_email_drop(jsonb),public.workspace_email_reply_result(jsonb),
 public.workspace_email_outbox_claim(integer),public.workspace_email_outbox_result(jsonb) to service_role;
grant execute on function
 private.workspace_email_unknown_read(),private.workspace_email_unknown_action(jsonb),private.workspace_email_files(uuid[]),
 public.workspace_email_unknown_read(),public.workspace_email_unknown_action(jsonb),public.workspace_email_files(uuid[]) to authenticated;

-- ---------------------------------------------------------------- patches by anchor (exactly one anchor each, with a sentinel)
-- 1. workspace_guest_reply_begin: email conversations can be replied to; the Hostaway pause only concerns Hostaway; the result carries
--    what the Worker needs to send an email.
-- 2. workspace_guest_inbox_read: each message lists its attachments.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$if th.id is null or th.source<>'hostaway' then raise exception 'Only Hostaway conversations can be replied to from here' using errcode='22023';end if;$q$,
   $q$if th.id is null or th.source not in ('hostaway','email') then raise exception 'Only Hostaway conversations can be replied to from here' using errcode='22023';end if;$q$,
   $q$th.source not in ('hostaway','email')$q$],
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$if (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway is paused, so replies can’t be sent from here' using errcode='22023';end if;$q$,
   $q$if th.source='hostaway' and (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway is paused, so replies can’t be sent from here' using errcode='22023';end if;$q$,
   $q$if th.source='hostaway' and (select paused$q$],
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$return jsonb_build_object('send',true,'conversationId',th.thread_ref,'requestId',req);$q$,
   $q$return jsonb_build_object('send',true,'conversationId',th.thread_ref,'requestId',req)||case when th.source='email' then jsonb_build_object('source','email','email',private.workspace_email_reply_context(th)) else '{}'::jsonb end;$q$,
   $q$jsonb_build_object('source','email','email'$q$],
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id)) order by m.sent_at,m.id)$q$,
   $q$'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id),
     'files',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'bytes',a.bytes) order by a.created_at) from private.workspace_email_attachments a where a.guest_message_id=m.id),'[]'::jsonb)) order by m.sent_at,m.id)$q$,
   $q$'files',coalesce((select jsonb_agg(jsonb_build_object('id',a.id$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
