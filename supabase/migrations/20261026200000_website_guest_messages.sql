-- Guest messages from the company website (rechargestays.co.uk): the booking panel and "Message the team" on each home's page.
-- The website's server forwards each message to the app's /api/website/guest-messages with a shared key (WEBSITE_MESSAGES_KEY);
-- the app checks the key, the body and the quotas, then stores the message through workspace_website_message_ingest (service role
-- only). It lands in the Guest inbox as source 'website', channel 'website' ("Website"), beside the Hostaway and email conversations:
--  * one conversation per guest email address and home, so a guest's follow-up joins their earlier conversation;
--  * the home is the property whose hostaway_listing_id is the website's listing id (no match: shared like an unmatched email);
--  * stored through workspace_guest_messages_ingest, so the guest message notices (trigger, 20261015310000), the waiting count,
--    reopening a done conversation and the privacy rules of the guest inbox all apply unchanged.
-- The team's replies go to the guest by email, exactly as for an email conversation (sendReply, Resend as guestrelations@), with
-- the property and the dates in the subject. When the guest answers that email, the answer joins the website conversation.
-- Nothing is loosened: the new functions are for the service role only, and who may read or reply is unchanged. Safe to run twice.

-- ---------------------------------------------------------------- the 'website' channel
alter table private.workspace_guest_threads drop constraint if exists workspace_guest_threads_channel_check;
alter table private.workspace_guest_threads add constraint workspace_guest_threads_channel_check
 check(channel in ('airbnb','booking_com','vrbo','direct','whatsapp','email','website','other'));
alter table private.workspace_guest_messages drop constraint if exists workspace_guest_messages_channel_check;
alter table private.workspace_guest_messages add constraint workspace_guest_messages_channel_check
 check(channel in ('airbnb','booking_com','vrbo','direct','whatsapp','email','website','other'));

-- ---------------------------------------------------------------- a website message in
-- input: messageKey (the app's hash of the message, so a retried delivery is stored once), name, email, body (already carrying the
-- booking summary), and optionally listingId, homeLabel (shown when the listing matches no property), checkIn, checkOut.
create or replace function private.workspace_website_message_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare em text;nm text;txt text;key text;listing text;label text;v_in date;v_out date;prop uuid;ref text;ext text;th uuid;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('messageKey','name','email','body','listingId','homeLabel','checkIn','checkOut'))
  or coalesce(input->>'messageKey','')!~'^[0-9a-f]{64}$' or jsonb_typeof(input->'name') is distinct from 'string' or jsonb_typeof(input->'email') is distinct from 'string'
  or jsonb_typeof(input->'body') is distinct from 'string'
  or (input ? 'listingId' and coalesce(input->>'listingId','')!~'^[0-9]{1,20}$')
  or (input ? 'homeLabel' and (jsonb_typeof(input->'homeLabel') is distinct from 'string' or char_length(input->>'homeLabel') not between 1 and 160))
  or (input ? 'checkIn' and coalesce(input->>'checkIn','')!~'^\d{4}-\d{2}-\d{2}$') or (input ? 'checkOut' and coalesce(input->>'checkOut','')!~'^\d{4}-\d{2}-\d{2}$')
  then raise exception 'Invalid website message' using errcode='22023';end if;
 em:=private.workspace_email_clean(input->>'email');
 if em is null or not private.workspace_email_valid(em) then raise exception 'Invalid email address' using errcode='22023';end if;
 nm:=btrim(input->>'name');txt:=btrim(input->>'body');key:=input->>'messageKey';listing:=input->>'listingId';label:=btrim(input->>'homeLabel');
 if char_length(nm) not between 1 and 120 then raise exception 'Invalid name' using errcode='22023';end if;
 v_in:=(input->>'checkIn')::date;v_out:=(input->>'checkOut')::date;
 if v_in is not null and v_out is not null and v_out<=v_in then raise exception 'Invalid dates' using errcode='22023';end if;
 ext:='website:'||key;
 -- A retried delivery: already stored, and it neither notifies again nor reopens the conversation.
 if exists(select 1 from private.workspace_guest_messages g where g.source='website' and g.external_id=ext) then
  return jsonb_build_object('stored',true,'duplicate',true,'threadId',(select t.id from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref where g.source='website' and g.external_id=ext));
 end if;
 if listing is not null then prop:=(select p.id from public.workspace_properties p where p.hostaway_listing_id=listing);end if;
 -- One conversation per guest and home.
 ref:='website:'||md5(em||'|'||coalesce(prop::text,'home:'||lower(label),'none'));
 if prop is null and label is not null then txt:='Home: '||label||E'\n'||txt;end if;
 if char_length(txt) not between 1 and 5000 then raise exception 'Invalid message' using errcode='22023';end if;
 perform private.workspace_guest_messages_ingest(jsonb_build_object('source','website','messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'externalId',ext,'threadRef',ref,'propertyId',prop,'channel','website','direction','guest','sentAt',now(),'body',txt,'guestName',nm,'checkIn',v_in,'checkOut',v_out)))));
 update private.workspace_guest_threads set guest_email=em,status='open' where source='website' and thread_ref=ref returning id into th;
 return jsonb_build_object('stored',true,'duplicate',false,'threadId',th,'matched',prop is not null);
end $$;

-- ---------------------------------------------------------------- replies out
-- A website conversation is answered by email like an email conversation, to the guest's address; the subject names the home and
-- the dates ("Your Recharge stay at Harbour Flat, 10 Nov to 16 Nov 2026"), and later replies thread on the last email sent.
create or replace function private.workspace_website_reply_context(th private.workspace_guest_threads) returns jsonb language sql stable security definer set search_path='' as $$
 select private.workspace_email_reply_context(th)||jsonb_build_object('subject',left(
  'Your Recharge stay'||coalesce(' at '||(select p.name from public.workspace_properties p where p.id=th.property_id),'')
  ||case when th.check_in is not null and th.check_out is not null then ', '||to_char(th.check_in,'FMDD Mon')||' to '||to_char(th.check_out,'FMDD Mon YYYY') else '' end,300))
$$;

-- ---------------------------------------------------------------- public wrapper and grants
create or replace function public.workspace_website_message_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_website_message_ingest(input);$$;
revoke all on function private.workspace_website_reply_context(private.workspace_guest_threads) from public,anon,authenticated,service_role;
revoke all on function private.workspace_website_message_ingest(jsonb),public.workspace_website_message_ingest(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_website_message_ingest(jsonb),public.workspace_website_message_ingest(jsonb) to service_role;

-- ---------------------------------------------------------------- patches by anchor (exactly one anchor each, with a sentinel)
-- 1-2. workspace_guest_reply_begin: website conversations can be replied to, by email, with the website subject. The text
--      20261016500000 looks for when it is run again (its sentinels) is left in place.
-- 3-4. workspace_email_guest_ingest: an email answering one sent from a website conversation joins that conversation (it used to
--      start a separate email conversation under the same reference).
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$if th.id is null or th.source not in ('hostaway','email') then$q$,
   $q$if th.id is null or (th.source not in ('hostaway','email') and th.source<>'website') then$q$,
   $q$and th.source<>'website') then$q$],
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$case when th.source='email' then jsonb_build_object('source','email','email',private.workspace_email_reply_context(th)) else '{}'::jsonb end$q$,
   $q$case when th.source='email' then jsonb_build_object('source','email','email',private.workspace_email_reply_context(th))
   when th.source='website' then jsonb_build_object('source','email','email',private.workspace_website_reply_context(th)) else '{}'::jsonb end$q$,
   $q$private.workspace_website_reply_context(th)$q$],
  ['private.workspace_email_guest_ingest(jsonb)',
   $q$perform private.workspace_guest_messages_ingest(jsonb_build_object('source','email','messages'$q$,
   $q$perform private.workspace_guest_messages_ingest(jsonb_build_object('source',case when th.source='website' then 'website' else 'email' end,'messages'$q$,
   $q$'source',case when th.source='website' then 'website' else 'email' end,'messages'$q$],
  ['private.workspace_email_guest_ingest(jsonb)',
   $q$where g.source='email' and g.external_id='email:'||eid;$q$,
   $q$where g.source=case when th.source='website' then 'website' else 'email' end and g.external_id='email:'||eid;$q$,
   $q$where g.source=case when th.source='website' then 'website' else 'email' end and g.external_id$q$]
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
