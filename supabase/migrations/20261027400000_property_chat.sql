-- Property group chat (Recharge Business Plan v1.0, "Estimate Delivery": "In the inbox section a group chat with the property's
-- address is created. Any notifications about updates to their property will be sent here, as well as emailed to them,
-- automated or human."; Phase 1).
--  * Each property with an owner account gets its own conversation in the Inbox, called by its address: an owner conversation
--    (kind 'owner') with property_id set. The owner and the team who already answer that owner are in it, exactly as in the
--    owner's general conversation (private.chat_owner_team). The general conversation stays for everything else.
--  * It opens when the property's onboarding has an owner (an owner's own enquiry, or an owner account linked later) or when
--    an owner is assigned to the property; installing this opens one for every property that already has an owner.
--  * Messages from the team in a property chat are emailed to the owner (to their sign-in address, "Update on <address>"),
--    unless the owner last wrote by email, which keeps replying in that email thread as before. An owner's email reply to a
--    property chat email lands back in that property chat.
--  * The automatic messages (agreement follow-ups, onboarding fee) now go to the property chat.
--  * Onboarding milestones are noted in the property chat as updates: estimate sent, going ahead, agreement ready to sign
--    (and each new version), agreement signed, set-up form received, fee settled, inspection booked and done, live, closed.
-- Existing functions patched in place (each anchor must be found; skipped once patched): private.chat_summary (title,
-- subtitle, properties, ownerView), private.workspace_chat_action and private.workspace_client_email_action and
-- private.workspace_email_owner_post (the owner's general conversation is the one without a property; email replies follow
-- their thread), private.workspace_email_owner_reply_queue (property chats emailed), private.workspace_agreement_followup_sweep
-- (a reply counts in the general conversation or that property's chat). private.workspace_followup_post and
-- private.workspace_owner_message are replaced. The one-conversation-per-owner index becomes one general conversation per
-- owner plus one chat per property. No data is deleted. Safe to run twice.

-- 1. One general conversation per owner, and one chat per property.
create unique index if not exists chat_owner_general_idx on private.chat_conversations(owner_id) where kind='owner' and property_id is null;
create unique index if not exists chat_owner_property_idx on private.chat_conversations(property_id) where kind='owner' and property_id is not null;
drop index if exists private.chat_owner_one_idx;

-- A property's name in the chat: its address on one line, or its name.
create or replace function private.workspace_property_label(prop uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce(nullif(left(regexp_replace(btrim(p.address),'\s*\n\s*',', ','g'),200),''),nullif(btrim(p.name),''),'Your property') from public.workspace_properties p where p.id=prop
$$;

-- The property's chat, opened if need be, for its owner: the onboarding's owner, or the owner assigned to it.
create or replace function private.workspace_property_chat(prop uuid) returns uuid language plpgsql security definer set search_path='' as $fn$
declare own uuid;conv uuid;begin
 conv:=(select c.id from private.chat_conversations c where c.kind='owner' and c.property_id=prop);
 if conv is not null then return conv;end if;
 own:=coalesce((select j.client_id from private.workspace_journeys j join public.workspace_profiles x on x.user_id=j.client_id and x.role='client' where j.property_id=prop),
  (select a.user_id from public.workspace_property_assignments a join public.workspace_profiles x on x.user_id=a.user_id and x.role='client' where a.property_id=prop and a.assignment='client' order by a.user_id limit 1));
 if own is null or not exists(select 1 from public.workspace_properties p where p.id=prop and p.status<>'archived') then return null;end if;
 insert into private.chat_conversations(kind,owner_id,property_id,created_by) values('owner',own,prop,own) on conflict do nothing;
 conv:=(select c.id from private.chat_conversations c where c.kind='owner' and c.property_id=prop);
 insert into private.chat_members(conversation_id,user_id) select conv,own where conv is not null on conflict do nothing;
 return conv;
end $fn$;

create or replace function private.workspace_property_chat_open() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 perform private.workspace_property_chat(new.property_id);
 return new;
end $fn$;
drop trigger if exists workspace_property_chat_open on private.workspace_journeys;
create trigger workspace_property_chat_open after insert or update of client_id on private.workspace_journeys for each row when (new.client_id is not null)
 execute function private.workspace_property_chat_open();
drop trigger if exists workspace_property_chat_open on public.workspace_property_assignments;
create trigger workspace_property_chat_open after insert on public.workspace_property_assignments for each row when (new.assignment='client')
 execute function private.workspace_property_chat_open();

-- 2. A message in a property's chat from the team (the agreement's sender, or a super admin): a notice to the owner, and the
-- email (the reply queue below sends every team message in a property chat; `subject` names it).
create or replace function private.workspace_property_chat_post(prop uuid,body text,subject text,kind text,at_time timestamptz) returns uuid language plpgsql security definer set search_path='' as $fn$
declare conv private.chat_conversations;author uuid;mid uuid;ev bigint;begin
 conv:=(select c from private.chat_conversations c where c.id=private.workspace_property_chat(prop));
 if conv.id is null then return null;end if;
 author:=coalesce((select x.user_id from public.workspace_profiles x where x.user_id=auth.uid() and x.status='active' and x.role<>'client'),
  (select s.sent_by from private.workspace_followup_sent(prop) s join public.workspace_profiles x on x.user_id=s.sent_by where x.status='active' and x.role<>'client'),
  (select x.user_id from public.workspace_profiles x where x.status='active' and x.role='super_admin' order by x.created_at,x.user_id limit 1));
 if author is null then return null;end if;
 perform set_config('recharge.chat_subject',coalesce(subject,''),true);
 insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at,kind) values(conv.id,author,left(btrim(body),4000),gen_random_uuid(),at_time,kind) returning id into mid;
 perform set_config('recharge.chat_subject','',true);
 update private.chat_conversations set last_message_at=greatest(last_message_at,at_time) where id=conv.id;
 if kind='text' then
  insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values(author,prop,'chat.message',at_time) returning id into ev;
  insert into private.workspace_activity_details(event_id,who,preview,context,replied) values(ev,'Recharge',private.workspace_push_line(body),null,false) on conflict do nothing;
  insert into private.workspace_notification_outbox(user_id,event_id) values(conv.owner_id,ev) on conflict do nothing;
 end if;
 return mid;
end $fn$;

-- The automatic messages, now in the property chat. Placeholders as before; {property} is the property's name.
create or replace function private.workspace_owner_message(prop uuid,template text,subject text,amount bigint,email boolean,at_time timestamptz) returns uuid language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;p public.workspace_properties;own public.workspace_profiles;body text;place text;begin
 select * into j from private.workspace_journeys where property_id=prop;
 if j.client_id is null then return null;end if;
 select * into p from public.workspace_properties where id=prop;
 select * into own from public.workspace_profiles where user_id=j.client_id;
 if own.user_id is null or own.role<>'client' then return null;end if;
 place:=coalesce(nullif(btrim(p.name),''),'your property');
 body:=replace(replace(replace(replace(template,'{first_name}',coalesce(nullif(split_part(btrim(coalesce(own.full_name,'')),' ',1),''),'there')),'{property}',place),
  '{amount_text}',case when amount is null then '' else ' for '||private.workspace_fee_money(amount) end),'{amount}',private.workspace_fee_money(amount));
 return private.workspace_property_chat_post(prop,body,case when email then replace(subject,'{property}',place) else null end,'text',at_time);
end $fn$;

create or replace function private.workspace_followup_post(f private.workspace_agreement_followups,at_time timestamptz) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;p public.workspace_properties;own public.workspace_profiles;body text;begin
 select * into j from private.workspace_journeys where property_id=f.property_id;
 select * into p from public.workspace_properties where id=f.property_id;
 select * into own from public.workspace_profiles where user_id=j.client_id;
 if own.user_id is null then return;end if;
 body:=replace(replace(f.plan->f.step->>'message','{first_name}',coalesce(nullif(split_part(btrim(coalesce(own.full_name,'')),' ',1),''),'there')),'{property}',coalesce(nullif(btrim(p.name),''),'your property'));
 perform private.workspace_property_chat_post(f.property_id,body||E'\n\nYou can read and sign your agreement in the Recharge app.',
  'Your management agreement for '||coalesce(nullif(btrim(p.name),''),'your property'),'text',at_time);
end $fn$;

-- 3. Onboarding milestones as updates in the property chat (not emailed: they are notes, and the owner already hears about
-- each one the usual way).
create or replace function private.workspace_property_chat_milestone() returns trigger language plpgsql security definer set search_path='' as $fn$
declare words text;begin
 if new.stage is not distinct from old.stage then
  -- The agreement is published (or a new version is) while the stage stays at agreement.
  if new.stage='agreement' and new.agreement_revision>coalesce(old.agreement_revision,0) and new.agreement is not null then
   perform private.workspace_property_chat_post(new.property_id,case when new.agreement_revision>1 then 'An updated management agreement is ready to read and sign in the app.'
    else 'Your management agreement is ready to read and sign in the app.' end,null,'event',now());
  end if;
  return new;
 end if;
 words:=case new.stage
  when 'estimate' then 'Your estimate has been sent. You can read it in the app.'
  when 'reviewing' then 'You would like time to think the estimate over. We will be in touch.'
  when 'agreement' then 'Thank you for going ahead. We are preparing your management agreement.'
  when 'form' then 'Agreement signed. Next: the property set-up form.'
  when 'invoice' then 'Set-up form received. Next: the onboarding fee.'
  when 'inspection_to_book' then 'Onboarding fee settled. Next: we book the property inspection.'
  when 'inspection_booked' then 'Property inspection booked'||coalesce(' for '||to_char(new.inspection_on,'FMDD FMMonth YYYY'),'')||'.'
  when 'inspection_complete' then 'Property inspection done.'
  when 'live' then 'Your property is live.'
  when 'archived' then 'This onboarding has been closed.'
  else null end;
 if words is not null then perform private.workspace_property_chat_post(new.property_id,words,null,'event',now());end if;
 return new;
exception when others then
 raise warning 'Property chat update not posted: %',sqlerrm;
 return new;
end $fn$;
drop trigger if exists workspace_property_chat_milestone on private.workspace_journeys;
create trigger workspace_property_chat_milestone after update of stage,agreement_revision on private.workspace_journeys for each row execute function private.workspace_property_chat_milestone();

-- 4. Patches to existing functions.
do $patch$
declare
 -- function, anchor, replacement, sentinel (present once patched), how many times the anchor occurs
 fixes constant text[][] := array[
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$when c.kind='owner' then case when c.owner_id=me then 'Recharge' else$q$,
   $q$when c.kind='owner' and c.property_id is not null then private.workspace_property_label(c.property_id) when c.kind='owner' then case when c.owner_id=me then 'Recharge' else$q$,
   $q$private.workspace_property_label(c.property_id) when c.kind='owner'$q$,'1'],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'subtitle',case when c.kind='owner' and c.owner_id<>me then 'Owner'$q$,
   $q$'ownerView',c.kind='owner' and c.owner_id=me,'subtitle',case when c.kind='owner' and c.property_id is not null then case when c.owner_id=me then 'Recharge team' else coalesce((select full_name from public.workspace_profiles where user_id=c.owner_id),'Owner') end when c.kind='owner' and c.owner_id<>me then 'Owner'$q$,
   $q$'ownerView',c.kind='owner' and c.owner_id=me$q$,'1'],
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'propertyIds',coalesce(case when c.kind='owner' then$q$,
   $q$'propertyIds',coalesce(case when c.kind='owner' and c.property_id is not null then jsonb_build_array(c.property_id) when c.kind='owner' then$q$,
   $q$when c.kind='owner' and c.property_id is not null then jsonb_build_array(c.property_id)$q$,'1'],
  ['private.workspace_chat_action(jsonb)',
   $q$c.kind='owner' and c.owner_id=other)$q$,
   $q$c.kind='owner' and c.owner_id=other and c.property_id is null)$q$,
   $q$c.owner_id=other and c.property_id is null$q$,'2'],
  ['private.workspace_client_email_action(jsonb)',
   $q$c.kind='owner' and c.owner_id=owner)$q$,
   $q$c.kind='owner' and c.owner_id=owner and c.property_id is null)$q$,
   $q$c.owner_id=owner and c.property_id is null$q$,'2'],
  ['private.workspace_email_owner_post(uuid,text,text,timestamp with time zone,jsonb,text,text,text,text,text[])',
   $q$c.kind='owner' and c.owner_id=owner)$q$,
   $q$c.kind='owner' and c.owner_id=owner and c.property_id is null)$q$,
   $q$c.owner_id=owner and c.property_id is null$q$,'2'],
  ['private.workspace_email_owner_post(uuid,text,text,timestamp with time zone,jsonb,text,text,text,text,text[])',
   $q$if conv.id is null then$q$,
   $q$/* property chat thread: 20261027400000 */ conv:=coalesce((select c from private.chat_conversations c join private.workspace_email_messages e on e.mailbox='owner' and e.direction='out' and e.rfc_message_id is not null
    and (lower(e.rfc_message_id)=lower(workspace_email_owner_post.irt) or lower(e.rfc_message_id)=any(array(select lower(r) from unnest(coalesce(workspace_email_owner_post.refs,'{}')) r))) join private.chat_messages m on m.id=e.chat_message_id and m.conversation_id=c.id
    where c.kind='owner' and c.owner_id=owner order by e.created_at desc limit 1),conv);
 if conv.id is null then$q$,
   $q$property chat thread: 20261027400000$q$,'1'],
  ['private.workspace_email_owner_reply_queue()',
   $q$if e.id is not null and e.from_address is not null then$q$,
   $q$/* property chat email: 20261027400000 */ if e.id is null and c.property_id is not null and new.kind='text' then
   insert into private.workspace_email_outbox(chat_message_id,to_address,subject,body)
    select new.id,lower(u.email),left(coalesce(nullif(current_setting('recharge.chat_subject',true),''),'Update on '||private.workspace_property_label(c.property_id)),300),left(new.body,4000)
    from auth.users u where u.id=c.owner_id and u.email is not null and char_length(u.email) between 3 and 320 on conflict(chat_message_id) do nothing;
  end if;
  if e.id is not null and e.from_address is not null then$q$,
   $q$property chat email: 20261027400000$q$,'1'],
  ['private.workspace_agreement_followup_sweep(timestamp with time zone)',
   $q$where c.kind='owner' and c.owner_id=x.client_id and m.author_id=x.client_id$q$,
   $q$where c.kind='owner' and c.owner_id=x.client_id and (c.property_id is null or c.property_id=x.property_id) and m.author_id=x.client_id$q$,
   $q$(c.property_id is null or c.property_id=x.property_id)$q$,'1']
 ];
 def text;i integer;n integer;
begin
 for i in 1..array_length(fixes,1) loop
  def:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in def)>0 then continue;end if;
  n:=(length(def)-length(replace(def,fixes[i][2],'')))/length(fixes[i][2]);
  if n<>fixes[i][5]::integer then raise exception 'Property chat patch: % has the anchor % time(s), expected %',fixes[i][1],n,fixes[i][5];end if;
  execute replace(def,fixes[i][2],fixes[i][3]);
 end loop;
end $patch$;

revoke all on function private.workspace_property_label(uuid),private.workspace_property_chat(uuid),private.workspace_property_chat_open(),
 private.workspace_property_chat_post(uuid,text,text,text,timestamptz),private.workspace_property_chat_milestone(),
 private.workspace_owner_message(uuid,text,text,bigint,boolean,timestamptz),private.workspace_followup_post(private.workspace_agreement_followups,timestamptz)
 from public,anon,authenticated,service_role;

-- 5. A chat for every property that already has an owner.
select private.workspace_property_chat(p.id) from public.workspace_properties p
 where p.status<>'archived' and (exists(select 1 from private.workspace_journeys j where j.property_id=p.id and j.client_id is not null)
  or exists(select 1 from public.workspace_property_assignments a where a.property_id=p.id and a.assignment='client'));
