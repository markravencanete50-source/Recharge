-- Guest replies sent from the Guest inbox, delivered to the guest through Hostaway. Staff press Send;
-- workspace_guest_inbox_action ('sendReply') checks access and records the request once, the backend
-- posts the message to Hostaway, then tells workspace_guest_reply_result how it went. A message is
-- stored only once Hostaway took it, so a failed send leaves nothing behind. Also tidies the Airbnb booking
-- code a conversation shows ("473976-guest-651540639-confirmation-HMFMWDE8AH" -> "HMFMWDE8AH"). Stays keep
-- Hostaway's full reference: the same Airbnb booking can sit under two Airbnb accounts, and only the full
-- reference tells them apart (platform and reference are unique).

-- One row per Send press (the app's request id), so a retried request never sends twice.
create table if not exists private.workspace_guest_reply_requests (
 request_id uuid primary key,
 thread_id uuid not null references private.workspace_guest_threads(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 body text not null check(char_length(body) between 1 and 5000),
 status text not null default 'sending' check(status in ('sending','sent','failed')),
 hostaway_message_id text check(hostaway_message_id is null or char_length(hostaway_message_id) between 1 and 100),
 error text check(error is null or char_length(error)<=300),
 created_at timestamptz not null default now()
);
create index if not exists workspace_guest_reply_requests_thread_idx on private.workspace_guest_reply_requests(thread_id);
alter table private.workspace_guest_reply_requests enable row level security;
revoke all on private.workspace_guest_reply_requests from public,anon,authenticated;

-- Step 1, as the signed-in user: may they reply, is it a Hostaway conversation, is the text valid. Returns
-- send:true with the Hostaway conversation to post to, or send:false when this request is already sent or
-- still going out (a sending row older than 2 minutes, or a failed one, may be tried again).
create or replace function private.workspace_guest_reply_begin(th private.workspace_guest_threads,req uuid,raw text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();v_body text:=regexp_replace(coalesce(raw,''),'^\s+|\s+$','','g');rq private.workspace_guest_reply_requests;begin
 if th.id is null or th.source<>'hostaway' then raise exception 'Only Hostaway conversations can be replied to from here' using errcode='22023';end if;
 if char_length(v_body) not between 1 and 5000 then raise exception 'Write the reply (up to 5,000 characters)' using errcode='22023';end if;
 if (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway is paused, so replies can’t be sent from here' using errcode='22023';end if;
 select * into rq from private.workspace_guest_reply_requests where request_id=req;
 if found then
  if rq.user_id<>me or rq.thread_id<>th.id then raise exception 'Request identifier already used' using errcode='22023';end if;
  if rq.status='sent' or (rq.status='sending' and rq.created_at>now()-interval '2 minutes') then
   return jsonb_build_object('send',false,'thread',private.guest_thread_json(th));
  end if;
  update private.workspace_guest_reply_requests set status='sending',body=v_body,error=null,hostaway_message_id=null,created_at=now() where request_id=req;
 else
  insert into private.workspace_guest_reply_requests(request_id,thread_id,user_id,body) values(req,th.id,me,v_body);
 end if;
 return jsonb_build_object('send',true,'conversationId',th.thread_ref,'requestId',req);
end $$;

-- Step 3, the backend (service role) after posting to Hostaway. ok: the request is sent and the team message
-- stored, credited to whoever pressed Send (the Hostaway sync may have stored it first: it then only gains its
-- author). Not ok: the request is failed and nothing is stored. Repeating a result changes nothing.
create or replace function private.workspace_guest_reply_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rq private.workspace_guest_reply_requests;th private.workspace_guest_threads;ext text;found_id uuid;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','ok','hostawayMessageId','error'))
  or jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(input->'ok') is distinct from 'boolean'
  or coalesce(jsonb_typeof(input->'hostawayMessageId'),'null') not in ('string','null') or char_length(coalesce(input->>'hostawayMessageId',''))>100
  or coalesce(jsonb_typeof(input->'error'),'null') not in ('string','null') then raise exception 'Invalid reply result' using errcode='22023';end if;
 select * into rq from private.workspace_guest_reply_requests where request_id=(input->>'requestId')::uuid for update;
 if not found then raise exception 'Reply request not found' using errcode='P0002';end if;
 if rq.status='sent' then return jsonb_build_object('recorded',false);end if;
 if not (input->>'ok')::boolean then
  update private.workspace_guest_reply_requests set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where request_id=rq.request_id;
  return jsonb_build_object('recorded',true);
 end if;
 th:=(select x from private.workspace_guest_threads x where x.id=rq.thread_id for update);
 ext:=nullif(trim(coalesce(input->>'hostawayMessageId','')),'');
 if ext is null then
  -- Hostaway gave no message id. If the sync already brought this message in (the same text, since the request began),
  -- it is that one: it gains its author instead of a second copy being stored.
  select g.id,g.external_id into found_id,ext from private.workspace_guest_messages g where g.source=th.source and g.thread_ref=th.thread_ref and g.direction='team'
   and g.author_user_id is null and g.external_id not like 'app:%' and btrim(regexp_replace(coalesce(g.body,''),'\s+',' ','g'))=btrim(regexp_replace(rq.body,'\s+',' ','g'))
   and g.sent_at>=rq.created_at-interval '1 minute' order by g.sent_at desc limit 1;
  if found_id is not null then
   update private.workspace_guest_messages set author_user_id=rq.user_id,delivery='sent' where id=found_id;
  end if;
 end if;
 if found_id is null then
  ext:=coalesce(ext,'app:'||rq.request_id);
  insert into private.workspace_guest_messages as g(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
   values(th.source,ext,th.thread_ref,th.property_id,th.channel,'team',now(),rq.user_id,rq.body,'sent')
   on conflict(source,external_id) do update set author_user_id=coalesce(g.author_user_id,excluded.author_user_id),delivery='sent';
 end if;
 update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,now()),now()) where id=th.id;
 update private.workspace_guest_reply_requests set status='sent',hostaway_message_id=case when ext like 'app:%' then null else ext end,error=null where request_id=rq.request_id;
 return jsonb_build_object('recorded',true);
end $$;

create or replace function public.workspace_guest_reply_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_guest_reply_result(input);$$;
revoke all on function private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.workspace_guest_reply_result(jsonb),public.workspace_guest_reply_result(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_guest_reply_result(jsonb),public.workspace_guest_reply_result(jsonb) to service_role;

-- Patched by anchor: the inbox action gains 'sendReply', and the Hostaway import takes a reply sent from
-- Recharge (stored with a Recharge id because Hostaway gave none) as the same message when it comes back.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_guest_inbox_action(jsonb)',
   $q$else raise exception 'Unknown inbox action' using errcode='22023';end if;$q$,
   $q$elsif a='sendReply' then
  -- Sent to the guest through Hostaway: recorded once per request here, posted and stored by the backend afterwards.
  perform private.workspace_json_keys(input,array['action','requestId','threadId','body']);
  return private.workspace_guest_reply_begin(th,req,input->>'body');
 else raise exception 'Unknown inbox action' using errcode='22023';end if;$q$,
   'workspace_guest_reply_begin'],
  ['private.workspace_hostaway_messages_ingest(jsonb)',
   $q$known:=exists(select 1 from private.workspace_guest_threads where source='hostaway' and thread_ref=c->>'id');$q$,
   $q$known:=exists(select 1 from private.workspace_guest_threads where source='hostaway' and thread_ref=c->>'id');
  -- A team message sent from Recharge is stored under a Recharge id when Hostaway gave none: the same message
  -- coming back (same text, within 10 minutes) takes Hostaway's id instead of being stored twice.
  for m in select value from jsonb_array_elements(c->'messages') loop
   if not (m->>'incoming')::boolean and not exists(select 1 from private.workspace_guest_messages g where g.source='hostaway' and g.external_id=m->>'id') then
    update private.workspace_guest_messages set external_id=m->>'id' where id=(select g.id from private.workspace_guest_messages g where g.source='hostaway' and g.thread_ref=c->>'id'
      and g.external_id like 'app:%' and g.direction='team' and btrim(regexp_replace(coalesce(g.body,''),'\s+',' ','g'))=btrim(regexp_replace(m->>'body','\s+',' ','g'))
      and abs(extract(epoch from g.sent_at-(m->>'sentAt')::timestamptz))<=600 order by abs(extract(epoch from g.sent_at-(m->>'sentAt')::timestamptz)) limit 1);
   end if;
  end loop;$q$,
   $q$external_id like 'app:%'$q$],
  ['private.workspace_hostaway_messages_ingest(jsonb)',
   $q$v_ref:=case when has_res then left(coalesce(res.channel_reference,res.reference),100) end;$q$,
   $q$v_ref:=case when has_res then left(regexp_replace(coalesce(res.channel_reference,res.reference),'^.*-confirmation-(.+)$','\1'),100) end;$q$,
   $q$'^.*-confirmation-(.+)$q$]
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

-- Conversations already stored show the tidy Airbnb booking code.
update private.workspace_guest_threads set reservation_ref=regexp_replace(reservation_ref,'^.*-confirmation-','')
 where reservation_ref like '%-confirmation-_%';
