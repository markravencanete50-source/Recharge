-- Why guests stay (Alex: "the reason for each stay"; Lee approved stay analytics parts 2 and 3).
--
-- Part 2. A pre-arrival question to every guest (OTA and direct bookings), through the existing Hostaway guest messaging
--    send path (lib/hostaway.ts sendHostawayConversationMessage, the same call as a reply written in the Guest inbox).
--    Three days before check-in, from 10:00 London (a missed run catches up until 12:59), one message per stay:
--    lib/stay-reason.ts stayReasonQuestion. Never for owner stays (private.workspace_is_owner_stay), cancelled stays or
--    stays already asked. A stay booked less than 3 days ahead is asked at the next 10:00 only while check-in is at
--    least 1 day away. A conversation with a guest message still waiting for the team is left until the team has answered.
--    Once per stay: private.workspace_stay_reason_asks is keyed by the stay, and the claim takes an advisory lock and the
--    row's key, so two workers can never both send. A claim that went out and was not recorded ('sending') is never sent
--    again. A send that failed is tried again after an hour, at most 3 times in all.
--    Reading the reply: the guest's next message on that conversation after the question. When it is just an answer
--    (1 to 5, "1.", "1 holiday", "Holiday", "work" and so on, any case, at the start of the message; see
--    private.workspace_stay_reason_parse, mirrored by lib/stay-reason.ts parseStayReason) the stay gets its reason:
--    holiday, work, family_friends, event or other. Any other reply is left alone for the team. A reason once set is
--    never overwritten, by a later message or by the survey.
--    The guest's first name comes from the booking (Hostaway's guestFirstName, kept in private.workspace_stay_contacts by
--    the sync), else the conversation's guest name, else "there".
--    The thread shows "Asked reason for stay on <date>" and the answer once known (guest_thread_json's stayReason).
-- Part 3. A survey email after direct stays only (channel 'direct'), the day after checkout from 10:00 London (catching up
--    for 2 more days), only with the guest's email on file (kept by the sync for direct bookings only). Sent from
--    guestrelations@ through lib/resend-email.ts sendMailboxEmail('guest', ...): never ownerrelations@. One-tap rating 1 to 5,
--    the same reason question, and a comment box on the page. Each link carries the stay's own signed token (an HMAC of the
--    stay made on the server, lib/stay-reason-server.ts); only its SHA-256 hash is kept here, it opens that one stay and
--    expires 30 days after it was sent. The page (/stay-survey) needs no account and shows only the property name and the
--    stay dates. The answer keeps the rating, the reason (which sets the stay's reason if it has none), the comment and
--    when it was answered.
-- Switches: "Ask guests the reason for their stay" and "Send a survey after direct stays", both OFF, in
--    private.workspace_stay_reason_settings. Admins and super admins turn them on or off (who and when are kept), on
--    Reports > Guests & stays. While a switch is off its job finds nothing to send and the claim refuses.
-- Report: workspace_stay_analytics also answers the reasons (with how many stays they are known for), the average rating
--    (and how many stays it is known for) and the survey replies (sent and answered). Names-free.
--
-- Patched by anchor (the anchor must occur exactly once; skipped once its sentinel is present; each keeps its anchor):
--   private.workspace_hostaway_sync(jsonb): the guest's first name (and email, direct bookings only), on the same anchor
--     as 20261020900000, 20261021500000 and 20261021600000.
--   private.workspace_hostaway_messages_ingest(jsonb): the conversation's Hostaway reservation id is kept on its thread.
--   private.guest_thread_json(private.workspace_guest_threads): stayReason.
--   private.workspace_stay_analytics(date,date,uuid,text): reasons, rating and survey.
-- Safe to run twice. No DROP and no DELETE.

-- 1. Tables -------------------------------------------------------------------------------------------------------
create table if not exists private.workspace_stay_reason_settings (
 singleton boolean primary key default true check(singleton),
 ask_enabled boolean not null default false, ask_changed_by uuid references public.workspace_profiles(user_id), ask_changed_at timestamptz,
 survey_enabled boolean not null default false, survey_changed_by uuid references public.workspace_profiles(user_id), survey_changed_at timestamptz
);
insert into private.workspace_stay_reason_settings(singleton) values(true) on conflict do nothing;

alter table private.workspace_reservations
 add column if not exists stay_reason text,
 add column if not exists stay_reason_from text,
 add column if not exists stay_reason_at timestamptz;
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_reservations'::regclass and conname='workspace_reservations_stay_reason_valid') then
  alter table private.workspace_reservations add constraint workspace_reservations_stay_reason_valid check(
   (stay_reason is null or stay_reason in ('holiday','work','family_friends','event','other'))
   and (stay_reason_from is null or stay_reason_from in ('message','survey')));
 end if;
end $$;

-- The guest's first name and, for a direct booking only, their email: only for the question and the survey.
create table if not exists private.workspace_stay_contacts (
 reservation_id uuid primary key references private.workspace_reservations(id),
 first_name text check(first_name is null or char_length(first_name) between 1 and 60),
 email text check(email is null or char_length(email) between 3 and 320),
 updated_at timestamptz not null default now()
);

create table if not exists private.workspace_stay_reason_asks (
 reservation_id uuid primary key references private.workspace_reservations(id),
 status text not null check(status in ('sending','sent','failed')),
 conversation_id text not null check(char_length(conversation_id) between 1 and 100),
 body text not null check(char_length(body) between 1 and 2000),
 attempts integer not null default 1 check(attempts between 1 and 10),
 claimed_at timestamptz not null default now(), sent_at timestamptz,
 message_id text check(message_id is null or char_length(message_id)<=100), error text check(error is null or char_length(error)<=300),
 reply_checked_at timestamptz, reply_message_id uuid, reply_reason text
);
create index if not exists workspace_stay_reason_asks_conversation_idx on private.workspace_stay_reason_asks(conversation_id);

create table if not exists private.workspace_stay_surveys (
 reservation_id uuid primary key references private.workspace_reservations(id),
 status text not null check(status in ('sending','sent','failed')),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 attempts integer not null default 1 check(attempts between 1 and 10),
 claimed_at timestamptz not null default now(), sent_at timestamptz, expires_at timestamptz not null,
 error text check(error is null or char_length(error)<=300),
 rating smallint check(rating is null or rating between 1 and 5),
 reason text check(reason is null or reason in ('holiday','work','family_friends','event','other')),
 comment text check(comment is null or char_length(comment) between 1 and 2000),
 answered_at timestamptz, updated_at timestamptz
);

do $$ declare t text; begin
 foreach t in array array['workspace_stay_reason_settings','workspace_stay_contacts','workspace_stay_reason_asks','workspace_stay_surveys'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

alter table private.workspace_guest_threads add column if not exists hostaway_reservation_id text check(hostaway_reservation_id is null or char_length(hostaway_reservation_id) between 1 and 100);
create index if not exists workspace_guest_threads_hostaway_reservation_idx on private.workspace_guest_threads(hostaway_reservation_id) where hostaway_reservation_id is not null;

-- 2. The reply ----------------------------------------------------------------------------------------------------
-- A guest's answer, or null. The whole message must be the answer: a number 1 to 5 (optionally with its own words), or
-- the words alone; trailing punctuation and a "thanks" are allowed. Mirrored by lib/stay-reason.ts parseStayReason.
create or replace function private.workspace_stay_reason_word(input text) returns text language sql immutable set search_path='' as $$
 select case
  when input in ('holiday','holidays','a holiday','on holiday','vacation','leisure') then 'holiday'
  when input in ('work','for work','working','business','work trip','business trip') then 'work'
  when input in ('visiting family or friends','visiting friends or family','visiting family and friends','visiting friends and family','visiting family','visiting friends',
   'family','friends','family or friends','friends or family','family and friends','friends and family','visiting') then 'family_friends'
  when input in ('an event','event','for an event','a wedding','wedding') then 'event'
  when input in ('something else','other','else') then 'other'
 end
$$;
create or replace function private.workspace_stay_reason_parse(body text) returns text language plpgsql immutable set search_path='' as $$
declare t text;m text[];by_number text;
begin
 t:=lower(btrim(regexp_replace(coalesce(body,''),'\s+',' ','g')));
 t:=regexp_replace(t,'[\s.!?,;:)-]+$','');
 t:=regexp_replace(t,'(^|[\s.!?,;:-]+)(many thanks|thanks|thank you|thankyou|cheers)$','');
 t:=regexp_replace(t,'[\s.!?,;:)-]+$','');
 if t='' or char_length(t)>60 then return null;end if;
 m:=regexp_match(t,'^([1-5])(?:\s*[.):-]?\s*(.*))?$');
 if m is not null then
  by_number:=(array['holiday','work','family_friends','event','other'])[m[1]::integer];
  if coalesce(m[2],'')='' then return by_number;end if;
  return case when private.workspace_stay_reason_word(m[2])=by_number then by_number end;
 end if;
 return private.workspace_stay_reason_word(t);
end $$;

-- After each guest message from Hostaway: the first one after the question on that conversation is read, once.
-- Never fails the import.
create or replace function private.workspace_stay_reason_reply() returns trigger language plpgsql security definer set search_path='' as $fn$
declare a private.workspace_stay_reason_asks;v_reason text;
begin
 begin
  select * into a from private.workspace_stay_reason_asks x where x.conversation_id=new.thread_ref and x.status='sent' and x.reply_checked_at is null
   and x.sent_at<=new.sent_at+interval '1 minute' order by x.sent_at desc limit 1 for update;
  if found then
   v_reason:=private.workspace_stay_reason_parse(new.body);
   update private.workspace_stay_reason_asks set reply_checked_at=now(),reply_message_id=new.id,reply_reason=v_reason where reservation_id=a.reservation_id;
   if v_reason is not null then
    update private.workspace_reservations set stay_reason=v_reason,stay_reason_from='message',stay_reason_at=now() where id=a.reservation_id and stay_reason is null;
   end if;
  end if;
 exception when others then null;
 end;
 return null;
end $fn$;
do $$
begin
 if not exists(select 1 from pg_trigger where tgrelid='private.workspace_guest_messages'::regclass and tgname='workspace_stay_reason_reply') then
  create trigger workspace_stay_reason_reply after insert on private.workspace_guest_messages
   for each row when (new.direction='guest' and new.source='hostaway') execute function private.workspace_stay_reason_reply();
 end if;
end $$;

-- 3. The guest's name and email from the sync ---------------------------------------------------------------------
-- {firstName, email}: a first name of letters (60 at most), an email for a direct booking only. A blank keeps what was kept.
create or replace function private.workspace_store_stay_contact(target uuid,input jsonb) returns void language plpgsql set search_path='' as $$
declare r private.workspace_reservations;fname text;mail text;
begin
 if target is null or jsonb_typeof(input) is distinct from 'object' then return;end if;
 select * into r from private.workspace_reservations where id=target;
 if r.id is null or private.workspace_is_owner_stay(r) then return;end if;
 if jsonb_typeof(input->'firstName')='string' then
  fname:=split_part(btrim(regexp_replace(input->>'firstName','\s+',' ','g')),' ',1);
  if not (char_length(fname) between 1 and 60 and fname ~ '^[[:alpha:]][[:alpha:]''.-]*$') then fname:=null;end if;
 end if;
 if r.channel='direct' and jsonb_typeof(input->'email')='string' then
  mail:=lower(btrim(input->>'email'));
  if not (char_length(mail) between 6 and 320 and mail ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$') or mail ~ '@rechargegroup\.co\.uk$' then mail:=null;end if;
 end if;
 if fname is null and mail is null then return;end if;
 insert into private.workspace_stay_contacts as c(reservation_id,first_name,email) values(target,fname,mail)
  on conflict(reservation_id) do update set first_name=coalesce(excluded.first_name,c.first_name),email=coalesce(excluded.email,c.email),updated_at=now()
  where (c.first_name,c.email) is distinct from (coalesce(excluded.first_name,c.first_name),coalesce(excluded.email,c.email));
end $$;

do $patch$
declare
 fixes constant text[][] := array[
  -- The sync keeps the guest's first name (and a direct booking's email) after the stay is written.
  ['private.workspace_hostaway_sync(jsonb)',
   $a$touched:=touched||res.property_id;$a$,
   $r$if r ? 'guestContact' then perform private.workspace_store_stay_contact(res.id,r->'guestContact');end if;touched:=touched||res.property_id;$r$,
   $s$perform private.workspace_store_stay_contact(res.id,r->'guestContact')$s$],
  -- Each Hostaway conversation keeps its reservation id, so a stay finds its conversation.
  ['private.workspace_hostaway_messages_ingest(jsonb)',
   $a$update private.workspace_guest_threads set remote_marker=nullif(left(c->>'marker',100),''),property_id=coalesce(property_id,prop) where source='hostaway' and thread_ref=c->>'id';$a$,
   $r$update private.workspace_guest_threads set hostaway_reservation_id=left(c->>'reservationId',100) where source='hostaway' and thread_ref=c->>'id' and nullif(c->>'reservationId','') is not null and hostaway_reservation_id is distinct from left(c->>'reservationId',100);update private.workspace_guest_threads set remote_marker=nullif(left(c->>'marker',100),''),property_id=coalesce(property_id,prop) where source='hostaway' and thread_ref=c->>'id';$r$,
   $s$set hostaway_reservation_id=left(c->>'reservationId',100)$s$]
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

-- 4. The switches -------------------------------------------------------------------------------------------------
create or replace function private.workspace_stay_reason_settings_view() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'ask',jsonb_build_object('on',s.ask_enabled,'changedAt',s.ask_changed_at,'changedBy',(select u.full_name from public.workspace_profiles u where u.user_id=s.ask_changed_by)),
  'survey',jsonb_build_object('on',s.survey_enabled,'changedAt',s.survey_changed_at,'changedBy',(select u.full_name from public.workspace_profiles u where u.user_id=s.survey_changed_by)))
 from private.workspace_stay_reason_settings s where s.singleton
$$;
create or replace function private.workspace_stay_reason_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return private.workspace_stay_reason_settings_view();
end $$;
-- {action:'setStayReasonSwitch', switch:'ask'|'survey', on:boolean}. Keeps who changed it and when.
create or replace function private.workspace_stay_reason_switch(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare which text;turn boolean;
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('action','switch','on'))
  or input->>'switch' not in ('ask','survey') or jsonb_typeof(input->'on') is distinct from 'boolean' then raise exception 'Choose the switch' using errcode='22023';end if;
 which:=input->>'switch';turn:=(input->>'on')::boolean;
 if which='ask' then
  update private.workspace_stay_reason_settings set ask_enabled=turn,ask_changed_by=auth.uid(),ask_changed_at=now() where singleton and ask_enabled is distinct from turn;
 else
  update private.workspace_stay_reason_settings set survey_enabled=turn,survey_changed_by=auth.uid(),survey_changed_at=now() where singleton and survey_enabled is distinct from turn;
 end if;
 return private.workspace_stay_reason_settings_view();
end $$;

-- 5. The question -------------------------------------------------------------------------------------------------
-- The stay's Hostaway conversation: the one Hostaway says is this reservation's, else one carrying the stay's code.
create or replace function private.workspace_stay_thread(r private.workspace_reservations) returns private.workspace_guest_threads language plpgsql stable security definer set search_path='' as $$
declare th private.workspace_guest_threads;
begin
 select t.* into th from private.workspace_guest_threads t
 where t.source='hostaway' and r.source='hostaway' and (t.hostaway_reservation_id=substr(r.reference,4)
  or (t.hostaway_reservation_id is null and t.reservation_ref is not null and upper(t.reservation_ref)=any(private.workspace_stay_codes(r.channel_reference,r.reference))
   and (t.property_id is null or t.property_id=r.property_id)))
 order by (t.hostaway_reservation_id is not null) desc,t.last_message_at desc nulls last,t.created_at desc limit 1;
 return th;
end $$;

-- Whether a stay may be asked at this moment (the switch, the hours, the stay and the days until check-in).
create or replace function private.workspace_stay_reason_askable(r private.workspace_reservations,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select s.ask_enabled from private.workspace_stay_reason_settings s where s.singleton),false)
  and extract(hour from (at_time at time zone 'Europe/London')) between 10 and 12
  and not coalesce((select paused from private.workspace_hostaway_sync_state where singleton),false)
  and r.source='hostaway' and r.status='confirmed' and not private.workspace_is_owner_stay(r)
  and r.check_in-(at_time at time zone 'Europe/London')::date between 1 and 3
$$;
-- A stay not asked yet, or whose send failed (an hour ago at least, fewer than 3 tries).
create or replace function private.workspace_stay_reason_open(target uuid,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.workspace_stay_reason_asks a where a.reservation_id=target
  and (a.status in ('sending','sent') or a.attempts>=3 or a.claimed_at>at_time-interval '1 hour'))
$$;

-- The stays to ask now (at most 25), for the worker: the stay, its conversation when known, the first name, the home.
create or replace function private.workspace_stay_reason_questions_due(at_time timestamptz default now()) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare stamp timestamptz:=coalesce(at_time,now());
begin
 if not coalesce((select s.ask_enabled from private.workspace_stay_reason_settings s where s.singleton),false) then return jsonb_build_object('switchedOff',true,'stays','[]'::jsonb);end if;
 return jsonb_build_object('switchedOff',false,'stays',coalesce((select jsonb_agg(jsonb_build_object('reservationId',x.id,'hostawayReservationId',substr(x.reference,4),
   'conversationId',(x.th).thread_ref,'firstName',coalesce(x.first_name,nullif(split_part(btrim((x.th).guest_name),' ',1),'')),'propertyName',x.name,'checkIn',x.check_in) order by x.check_in,x.id)
  from (select r.id,r.reference,r.check_in,p.name,c.first_name,private.workspace_stay_thread(r) th
   from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
   left join private.workspace_stay_contacts c on c.reservation_id=r.id
   where private.workspace_stay_reason_askable(r,stamp) and private.workspace_stay_reason_open(r.id,stamp)
   order by r.check_in,r.id limit 25) x
  -- A conversation whose last message is the guest's, still open, waits for the team's answer first.
  where (x.th).id is null or (x.th).status<>'open' or coalesce((select m.direction from private.workspace_guest_messages m where m.source='hostaway' and m.thread_ref=(x.th).thread_ref
   order by m.sent_at desc,m.id desc limit 1),'team')<>'guest'),'[]'::jsonb));
end $fn$;

-- {reservationId, conversationId, body}: takes the stay for this worker, once. send:false when it may not be sent now.
create or replace function private.workspace_stay_reason_question_claim(input jsonb,at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r private.workspace_reservations;stamp timestamptz:=coalesce(at_time,now());v_body text;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('reservationId','conversationId','body'))
  or coalesce(input->>'reservationId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(input->>'conversationId','')!~'^\d{1,20}$' or jsonb_typeof(input->'body') is distinct from 'string' then raise exception 'Invalid question' using errcode='22023';end if;
 v_body:=btrim(input->>'body');
 if char_length(v_body) not between 1 and 2000 then raise exception 'Invalid question' using errcode='22023';end if;
 -- One claim at a time; the stay's own row is the second guard.
 perform pg_advisory_xact_lock(hashtextextended('workspace_stay_reason_questions',0));
 select * into r from private.workspace_reservations where id=(input->>'reservationId')::uuid for update;
 if r.id is null or not private.workspace_stay_reason_askable(r,stamp) or not private.workspace_stay_reason_open(r.id,stamp) then return jsonb_build_object('send',false);end if;
 insert into private.workspace_stay_reason_asks as a(reservation_id,status,conversation_id,body,claimed_at) values(r.id,'sending',input->>'conversationId',v_body,stamp)
  on conflict(reservation_id) do update set status='sending',conversation_id=excluded.conversation_id,body=excluded.body,claimed_at=excluded.claimed_at,attempts=a.attempts+1,error=null
  where a.status='failed' and a.attempts<3;
 if not found then return jsonb_build_object('send',false);end if;
 return jsonb_build_object('send',true);
end $fn$;

-- {reservationId, ok, messageId?, error?}: what Hostaway answered. A sent question shows on the stay's thread.
create or replace function private.workspace_stay_reason_question_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a private.workspace_stay_reason_asks;th private.workspace_guest_threads;ext text;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('reservationId','ok','messageId','error'))
  or coalesce(input->>'reservationId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(input->'ok') is distinct from 'boolean'
  or coalesce(jsonb_typeof(input->'messageId'),'null') not in ('string','null') or char_length(coalesce(input->>'messageId',''))>100
  or coalesce(jsonb_typeof(input->'error'),'null') not in ('string','null') then raise exception 'Invalid question result' using errcode='22023';end if;
 select * into a from private.workspace_stay_reason_asks where reservation_id=(input->>'reservationId')::uuid for update;
 if not found then raise exception 'Question not found' using errcode='P0002';end if;
 if a.status<>'sending' then return jsonb_build_object('recorded',false);end if;
 if not (input->>'ok')::boolean then
  update private.workspace_stay_reason_asks set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where reservation_id=a.reservation_id;
  return jsonb_build_object('recorded',true);
 end if;
 ext:=nullif(btrim(coalesce(input->>'messageId','')),'');
 update private.workspace_stay_reason_asks set status='sent',sent_at=now(),message_id=ext,error=null where reservation_id=a.reservation_id;
 -- On the thread straight away when Recharge has it (the next Hostaway import takes Hostaway's id, as for a reply).
 select * into th from private.workspace_guest_threads t where t.source='hostaway' and t.thread_ref=a.conversation_id;
 if th.id is not null then
  insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,body,delivery)
   values('hostaway',coalesce(ext,'app:stay-reason-'||a.reservation_id),th.thread_ref,th.property_id,th.channel,'team',now(),a.body,'sent') on conflict(source,external_id) do nothing;
  update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,now()),now()) where id=th.id;
 end if;
 return jsonb_build_object('recorded',true);
end $fn$;

-- On a guest thread: when the stay's reason was asked, and the answer once known. Null when it was not asked.
create or replace function private.workspace_thread_stay_reason(src text,ref text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('askedAt',a.sent_at,'reason',r.stay_reason,'from',r.stay_reason_from)
 from private.workspace_stay_reason_asks a join private.workspace_reservations r on r.id=a.reservation_id
 where src='hostaway' and a.conversation_id=ref and a.status='sent' order by a.sent_at desc limit 1
$$;

-- 6. The survey ---------------------------------------------------------------------------------------------------
create or replace function private.workspace_stay_survey_sendable(r private.workspace_reservations,at_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select s.survey_enabled from private.workspace_stay_reason_settings s where s.singleton),false)
  and extract(hour from (at_time at time zone 'Europe/London')) between 10 and 12
  and r.channel='direct' and r.status='confirmed' and not private.workspace_is_owner_stay(r)
  and (at_time at time zone 'Europe/London')::date-r.check_out between 1 and 3
  and exists(select 1 from private.workspace_stay_contacts c where c.reservation_id=r.id and c.email is not null)
  and not exists(select 1 from private.workspace_stay_surveys v where v.reservation_id=r.id
   and (v.status in ('sending','sent') or v.attempts>=3 or v.claimed_at>at_time-interval '1 hour'))
$$;
create or replace function private.workspace_stay_surveys_due(at_time timestamptz default now()) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare stamp timestamptz:=coalesce(at_time,now());
begin
 if not coalesce((select s.survey_enabled from private.workspace_stay_reason_settings s where s.singleton),false) then return jsonb_build_object('switchedOff',true,'stays','[]'::jsonb);end if;
 return jsonb_build_object('switchedOff',false,'stays',coalesce((select jsonb_agg(jsonb_build_object('reservationId',x.id,'email',x.email,'firstName',x.first_name,'propertyName',x.name,
   'checkIn',x.check_in,'checkOut',x.check_out) order by x.check_out,x.id)
  from (select r.id,r.check_in,r.check_out,p.name,c.email,c.first_name from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
   join private.workspace_stay_contacts c on c.reservation_id=r.id
   where private.workspace_stay_survey_sendable(r,stamp) order by r.check_out,r.id limit 25) x),'[]'::jsonb));
end $fn$;
-- {reservationId, tokenHash}: takes the stay for this worker, once, and keeps the link's hash (it expires in 30 days).
create or replace function private.workspace_stay_survey_claim(input jsonb,at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r private.workspace_reservations;stamp timestamptz:=coalesce(at_time,now());
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('reservationId','tokenHash'))
  or coalesce(input->>'reservationId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid survey' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace_stay_surveys',0));
 select * into r from private.workspace_reservations where id=(input->>'reservationId')::uuid for update;
 if r.id is null or not private.workspace_stay_survey_sendable(r,stamp) then return jsonb_build_object('send',false);end if;
 -- A link belongs to one stay only.
 if exists(select 1 from private.workspace_stay_surveys v where v.token_hash=input->>'tokenHash' and v.reservation_id<>r.id) then raise exception 'Invalid survey' using errcode='22023';end if;
 insert into private.workspace_stay_surveys as v(reservation_id,status,token_hash,claimed_at,expires_at) values(r.id,'sending',input->>'tokenHash',stamp,stamp+interval '30 days')
  on conflict(reservation_id) do update set status='sending',token_hash=excluded.token_hash,claimed_at=excluded.claimed_at,expires_at=excluded.expires_at,attempts=v.attempts+1,error=null
  where v.status='failed' and v.attempts<3;
 if not found then return jsonb_build_object('send',false);end if;
 return jsonb_build_object('send',true);
end $fn$;
create or replace function private.workspace_stay_survey_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v private.workspace_stay_surveys;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('reservationId','ok','error'))
  or coalesce(input->>'reservationId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(input->'ok') is distinct from 'boolean'
  or coalesce(jsonb_typeof(input->'error'),'null') not in ('string','null') then raise exception 'Invalid survey result' using errcode='22023';end if;
 select * into v from private.workspace_stay_surveys where reservation_id=(input->>'reservationId')::uuid for update;
 if not found then raise exception 'Survey not found' using errcode='P0002';end if;
 if v.status<>'sending' then return jsonb_build_object('recorded',false);end if;
 if (input->>'ok')::boolean then update private.workspace_stay_surveys set status='sent',sent_at=now(),expires_at=now()+interval '30 days',error=null where reservation_id=v.reservation_id;
 else update private.workspace_stay_surveys set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where reservation_id=v.reservation_id;end if;
 return jsonb_build_object('recorded',true);
end $fn$;

-- The guest's page, through the server (no account): {action:'open'|'answer', tokenHash, rating?, reason?, comment?}.
-- It shows only the property name and the stay dates. An unknown link is refused (P0002); an expired one says so only.
create or replace function private.workspace_stay_survey_public(input jsonb,at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v private.workspace_stay_surveys;r private.workspace_reservations;home text;v_rating integer;v_reason text;v_note text;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('action','tokenHash','rating','reason','comment'))
  or input->>'action' not in ('open','answer') or coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link isn’t working' using errcode='22023';end if;
 select * into v from private.workspace_stay_surveys where token_hash=input->>'tokenHash' and status in ('sending','sent') for update;
 if not found then raise exception 'This link isn’t working' using errcode='P0002';end if;
 if v.expires_at<=coalesce(at_time,now()) then return jsonb_build_object('state','expired');end if;
 select * into r from private.workspace_reservations where id=v.reservation_id;
 select p.name into home from public.workspace_properties p where p.id=r.property_id;
 if input->>'action'='answer' then
  if input ? 'rating' and input->'rating'<>'null'::jsonb then
   if jsonb_typeof(input->'rating') is distinct from 'number' or (input->>'rating')!~'^[1-5]$' then raise exception 'Choose a rating from 1 to 5' using errcode='22023';end if;
   v_rating:=(input->>'rating')::integer;
  end if;
  if input ? 'reason' and input->'reason'<>'null'::jsonb then
   if input->>'reason' not in ('holiday','work','family_friends','event','other') then raise exception 'Choose what brought you here' using errcode='22023';end if;
   v_reason:=input->>'reason';
  end if;
  if input ? 'comment' and input->'comment'<>'null'::jsonb then
   if jsonb_typeof(input->'comment') is distinct from 'string' or char_length(input->>'comment')>2000 then raise exception 'Comments can be up to 2,000 characters' using errcode='22023';end if;
   v_note:=nullif(btrim(input->>'comment'),'');
  end if;
  if v_rating is null and v_reason is null and v_note is null then raise exception 'Choose an answer' using errcode='22023';end if;
  update private.workspace_stay_surveys set rating=coalesce(v_rating,workspace_stay_surveys.rating),reason=coalesce(v_reason,workspace_stay_surveys.reason),
   comment=coalesce(v_note,workspace_stay_surveys.comment),answered_at=coalesce(answered_at,now()),updated_at=now() where reservation_id=v.reservation_id;
  if v_reason is not null then
   update private.workspace_reservations set stay_reason=v_reason,stay_reason_from='survey',stay_reason_at=now() where id=v.reservation_id and stay_reason is null;
  end if;
  return jsonb_build_object('state','thanks','propertyName',home,'checkIn',r.check_in,'checkOut',r.check_out);
 end if;
 return jsonb_build_object('state','open','propertyName',home,'checkIn',r.check_in,'checkOut',r.check_out);
end $fn$;

-- 7. The thread and the report ------------------------------------------------------------------------------------
do $patch$
declare
 fixes constant text[][] := array[
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $a$'messages',(select count(*) from msgs));$a$,
   $r$'messages',(select count(*) from msgs),'stayReason',private.workspace_thread_stay_reason(t.source,t.thread_ref));$r$,
   $s$'stayReason',private.workspace_thread_stay_reason($s$],
  ['private.workspace_stay_analytics(date,date,uuid,text)',
   $a$select r.property_id,r.check_in,r.check_out,$a$,
   $r$select r.id reservation_id,r.stay_reason,r.property_id,r.check_in,r.check_out,$r$,
   $s$select r.id reservation_id,r.stay_reason,$s$],
  -- Why they stay (and how many stays it is known for), the average rating and the survey replies. Names-free.
  ['private.workspace_stay_analytics(date,date,uuid,text)',
   $a$'stays',count(*),'nights'$a$,
   $r$'stays',count(*),'reasons',jsonb_build_object('known',count(stay_reason),'counts',(select jsonb_agg(jsonb_build_object('reason',k.reason,'stays',(select count(*) from s where s.stay_reason=k.reason)) order by k.n) from unnest(array['holiday','work','family_friends','event','other']) with ordinality k(reason,n))),'rating',(select jsonb_build_object('known',count(v.rating),'average',round(avg(v.rating),1)) from s join private.workspace_stay_surveys v on v.reservation_id=s.reservation_id),'survey',(select jsonb_build_object('sent',count(*) filter(where v.status='sent'),'answered',count(*) filter(where v.status='sent' and v.answered_at is not null)) from s join private.workspace_stay_surveys v on v.reservation_id=s.reservation_id),'nights'$r$,
   $s$'reasons',jsonb_build_object('known',count(stay_reason)$s$]
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

-- 8. Public wrappers and grants ------------------------------------------------------------------------------------
create or replace function public.workspace_stay_reason_settings() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_reason_settings();$$;
create or replace function public.workspace_stay_reason_switch(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_reason_switch(input);$$;
create or replace function public.workspace_stay_reason_questions_due() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_reason_questions_due();$$;
create or replace function public.workspace_stay_reason_question_claim(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_reason_question_claim(input);$$;
create or replace function public.workspace_stay_reason_question_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_reason_question_result(input);$$;
create or replace function public.workspace_stay_surveys_due() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_surveys_due();$$;
create or replace function public.workspace_stay_survey_claim(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_survey_claim(input);$$;
create or replace function public.workspace_stay_survey_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_survey_result(input);$$;
create or replace function public.workspace_stay_survey_public(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_stay_survey_public(input);$$;

revoke all on function private.workspace_stay_reason_word(text),private.workspace_stay_reason_parse(text),private.workspace_stay_reason_reply(),
 private.workspace_store_stay_contact(uuid,jsonb),private.workspace_stay_reason_settings_view(),private.workspace_stay_thread(private.workspace_reservations),
 private.workspace_stay_reason_askable(private.workspace_reservations,timestamptz),private.workspace_stay_reason_open(uuid,timestamptz),
 private.workspace_thread_stay_reason(text,text),private.workspace_stay_survey_sendable(private.workspace_reservations,timestamptz) from public,anon,authenticated;
revoke all on function private.workspace_stay_reason_settings(),public.workspace_stay_reason_settings(),private.workspace_stay_reason_switch(jsonb),public.workspace_stay_reason_switch(jsonb),
 private.workspace_stay_reason_questions_due(timestamptz),public.workspace_stay_reason_questions_due(),private.workspace_stay_reason_question_claim(jsonb,timestamptz),public.workspace_stay_reason_question_claim(jsonb),
 private.workspace_stay_reason_question_result(jsonb),public.workspace_stay_reason_question_result(jsonb),private.workspace_stay_surveys_due(timestamptz),public.workspace_stay_surveys_due(),
 private.workspace_stay_survey_claim(jsonb,timestamptz),public.workspace_stay_survey_claim(jsonb),private.workspace_stay_survey_result(jsonb),public.workspace_stay_survey_result(jsonb),
 private.workspace_stay_survey_public(jsonb,timestamptz),public.workspace_stay_survey_public(jsonb) from public,anon,authenticated;
-- The app: the switches (admins and super admins, checked inside).
grant execute on function private.workspace_stay_reason_settings(),public.workspace_stay_reason_settings(),private.workspace_stay_reason_switch(jsonb),public.workspace_stay_reason_switch(jsonb) to authenticated;
-- The worker and the survey page's server: the service role only.
grant execute on function private.workspace_stay_reason_questions_due(timestamptz),public.workspace_stay_reason_questions_due(),private.workspace_stay_reason_question_claim(jsonb,timestamptz),public.workspace_stay_reason_question_claim(jsonb),
 private.workspace_stay_reason_question_result(jsonb),public.workspace_stay_reason_question_result(jsonb),private.workspace_stay_surveys_due(timestamptz),public.workspace_stay_surveys_due(),
 private.workspace_stay_survey_claim(jsonb,timestamptz),public.workspace_stay_survey_claim(jsonb),private.workspace_stay_survey_result(jsonb),public.workspace_stay_survey_result(jsonb),
 private.workspace_stay_survey_public(jsonb,timestamptz),public.workspace_stay_survey_public(jsonb) to service_role;
