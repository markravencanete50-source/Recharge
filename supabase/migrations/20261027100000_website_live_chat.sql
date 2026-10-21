-- Live chat on the company website (rechargestays.co.uk): the team's replies to a website chat appear in the guest's chat window,
-- not by email. The guest's browser makes a random chat key for each chat (kept only for that browser tab); the website's server
-- sends it with every message and every read, and the app stores only its keyed hash (securityHash 'website-chat'), so a chat can
-- be read only by whoever holds the key, never by knowing a guest's email address.
--  * A message with chatKey belongs to that chat's own conversation (thread_ref 'website-chat:<hash>'). Without one, the earlier
--    rule applies unchanged (one conversation per guest email and home, answered by email).
--  * A reply to a chat conversation is stored straight into it as sent (workspace_website_reply_result); nothing is emailed.
--  * workspace_website_chat_read returns a chat's conversation for the website to show: the guest's and the team's messages, in
--    order, with the team member's first name. Hidden messages and replies that are still going out or failed are left out.
-- The new functions are for the service role only. Who may read or reply in the Guest inbox is unchanged. Safe to run twice.

-- ---------------------------------------------------------------- a website message in, now with an optional chat key
create or replace function private.workspace_website_message_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare em text;nm text;txt text;key text;chat text;listing text;label text;v_in date;v_out date;prop uuid;ref text;ext text;th uuid;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('messageKey','chatKey','name','email','body','listingId','homeLabel','checkIn','checkOut'))
  or coalesce(input->>'messageKey','')!~'^[0-9a-f]{64}$' or jsonb_typeof(input->'name') is distinct from 'string' or jsonb_typeof(input->'email') is distinct from 'string'
  or jsonb_typeof(input->'body') is distinct from 'string'
  or (input ? 'chatKey' and coalesce(input->>'chatKey','')!~'^[0-9a-f]{64}$')
  or (input ? 'listingId' and coalesce(input->>'listingId','')!~'^[0-9]{1,20}$')
  or (input ? 'homeLabel' and (jsonb_typeof(input->'homeLabel') is distinct from 'string' or char_length(input->>'homeLabel') not between 1 and 160))
  or (input ? 'checkIn' and coalesce(input->>'checkIn','')!~'^\d{4}-\d{2}-\d{2}$') or (input ? 'checkOut' and coalesce(input->>'checkOut','')!~'^\d{4}-\d{2}-\d{2}$')
  then raise exception 'Invalid website message' using errcode='22023';end if;
 em:=private.workspace_email_clean(input->>'email');
 if em is null or not private.workspace_email_valid(em) then raise exception 'Invalid email address' using errcode='22023';end if;
 nm:=btrim(input->>'name');txt:=btrim(input->>'body');key:=input->>'messageKey';chat:=input->>'chatKey';listing:=input->>'listingId';label:=btrim(input->>'homeLabel');
 if char_length(nm) not between 1 and 120 then raise exception 'Invalid name' using errcode='22023';end if;
 v_in:=(input->>'checkIn')::date;v_out:=(input->>'checkOut')::date;
 if v_in is not null and v_out is not null and v_out<=v_in then raise exception 'Invalid dates' using errcode='22023';end if;
 ext:='website:'||key;
 -- A retried delivery: already stored, and it neither notifies again nor reopens the conversation.
 if exists(select 1 from private.workspace_guest_messages g where g.source='website' and g.external_id=ext) then
  return jsonb_build_object('stored',true,'duplicate',true,'threadId',(select t.id from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref where g.source='website' and g.external_id=ext));
 end if;
 if listing is not null then prop:=(select p.id from public.workspace_properties p where p.hostaway_listing_id=listing);end if;
 -- A chat is its own conversation; otherwise one conversation per guest and home.
 ref:=case when chat is not null then 'website-chat:'||chat else 'website:'||md5(em||'|'||coalesce(prop::text,'home:'||lower(label),'none')) end;
 if prop is null and label is not null then txt:='Home: '||label||E'\n'||txt;end if;
 if char_length(txt) not between 1 and 5000 then raise exception 'Invalid message' using errcode='22023';end if;
 perform private.workspace_guest_messages_ingest(jsonb_build_object('source','website','messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'externalId',ext,'threadRef',ref,'propertyId',prop,'channel','website','direction','guest','sentAt',now(),'body',txt,'guestName',nm,'checkIn',v_in,'checkOut',v_out)))));
 update private.workspace_guest_threads set guest_email=em,status='open' where source='website' and thread_ref=ref returning id into th;
 return jsonb_build_object('stored',true,'duplicate',false,'threadId',th,'matched',prop is not null);
end $$;

-- ---------------------------------------------------------------- a team reply into a chat
-- Called by the app after workspace_guest_reply_begin has checked who may reply and recorded the request. The chat is the
-- delivery, so the reply is stored as sent at once.
create or replace function private.workspace_website_reply_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rq private.workspace_guest_reply_requests;th private.workspace_guest_threads;ext text;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k<>'requestId')
  or jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'Invalid reply result' using errcode='22023';end if;
 select * into rq from private.workspace_guest_reply_requests where request_id=(input->>'requestId')::uuid for update;
 if not found then raise exception 'Reply request not found' using errcode='P0002';end if;
 if rq.status='sent' then return jsonb_build_object('recorded',false);end if;
 th:=(select x from private.workspace_guest_threads x where x.id=rq.thread_id for update);
 if th.id is null or th.source<>'website' or th.thread_ref not like 'website-chat:%' then raise exception 'Not a website chat' using errcode='22023';end if;
 ext:='chat-out:'||rq.request_id;
 insert into private.workspace_guest_messages as g(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
  values(th.source,ext,th.thread_ref,th.property_id,'website','team',now(),rq.user_id,rq.body,'sent') on conflict(source,external_id) do nothing;
 update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,now()),now()) where id=th.id;
 update private.workspace_guest_reply_requests set status='sent',hostaway_message_id=null,error=null where request_id=rq.request_id;
 return jsonb_build_object('recorded',true);
end $$;

-- ---------------------------------------------------------------- a chat, read back for the website
create or replace function private.workspace_website_chat_read(input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare th private.workspace_guest_threads;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k<>'chatKey') or coalesce(input->>'chatKey','')!~'^[0-9a-f]{64}$'
  then raise exception 'Invalid chat' using errcode='22023';end if;
 select * into th from private.workspace_guest_threads where source='website' and thread_ref='website-chat:'||(input->>'chatKey');
 if not found then return jsonb_build_object('found',false,'messages','[]'::jsonb);end if;
 return jsonb_build_object('found',true,'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',m.direction,'body',m.body,'sentAt',m.sent_at,
   'name',case when m.direction='team' then nullif(split_part(btrim(coalesce(p.full_name,'')),' ',1),'') end) order by m.sent_at,m.id)
  from (select g.* from private.workspace_guest_messages g where g.source='website' and g.thread_ref=th.thread_ref and g.hidden_at is null
         and (g.direction='guest' or g.delivery='sent') order by g.sent_at desc,g.id desc limit 200) m
  left join public.workspace_profiles p on p.user_id=m.author_user_id),'[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- public wrappers and grants
create or replace function public.workspace_website_reply_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_website_reply_result(input);$$;
create or replace function public.workspace_website_chat_read(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_website_chat_read(input);$$;
revoke all on function private.workspace_website_reply_result(jsonb),public.workspace_website_reply_result(jsonb),private.workspace_website_chat_read(jsonb),public.workspace_website_chat_read(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_website_reply_result(jsonb),public.workspace_website_reply_result(jsonb),private.workspace_website_chat_read(jsonb),public.workspace_website_chat_read(jsonb) to service_role;
revoke all on function private.workspace_website_message_ingest(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_website_message_ingest(jsonb) to service_role;

-- ---------------------------------------------------------------- patches by anchor (exactly one anchor each, with a sentinel)
-- 1. workspace_guest_reply_begin: a chat conversation is answered in the chat (source 'website'); other website conversations by email.
-- 2. guest_thread_json: says whether a conversation is a website chat, so the Guest inbox offers Send for it whatever the email switch.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$when th.source='website' then jsonb_build_object('source','email'$q$,
   $q$when th.source='website' and th.thread_ref like 'website-chat:%' then jsonb_build_object('source','website') when th.source='website' then jsonb_build_object('source','email'$q$,
   $q$jsonb_build_object('source','website')$q$],
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$'stayReason',private.workspace_thread_stay_reason(t.source,t.thread_ref));$q$,
   $q$'stayReason',private.workspace_thread_stay_reason(t.source,t.thread_ref),'websiteChat',(t.source='website' and t.thread_ref like 'website-chat:%'));$q$,
   $q$'websiteChat'$q$]
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
