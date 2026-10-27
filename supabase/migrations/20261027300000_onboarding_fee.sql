-- Onboarding fee (Recharge Business Plan v1.0, "Onboarding Fee" and "Agreement Signed"; Phase 1). When the owner signs the
-- management agreement:
--  * the owner is sent a message in their conversation, and by email, confirming the agreement is signed;
--  * a ticket opens in Accounts > Receivable for the onboarding fee (an invoice to send: the orange dot while accounts prepare
--    it), and accounts are told. It then goes through the same steps as every other receivable invoice (mark sent, email it,
--    record the payment). When it is sent the owner is told in their conversation and the team is told;
--  * while it is sent and not settled, the owner is reminded in their conversation and by email every 48 hours;
--  * when accounts settle it, the onboarding fee step turns green (the journey's onboarding invoice is recorded as settled,
--    so the onboarding moves on to the inspection once the set-up form is in) and the pending tasks from the onboarding
--    package are released onto their boards: cleaning set-up, licensing, garden maintenance and the furnishing quotation.
--    Until then those tasks are held (private.workspace_onboarding_held_tasks), and the old "Issue onboarding invoice" task
--    is not created, because the fee ticket replaces it.
--  * The fee, whether reminders go, how often, and the four messages are a setting (private.workspace_onboarding_fee_settings),
--    changed by admins and super admins. The fee starts empty: accounts fill in the amount on the ticket until it is set.
-- Who: the people who work with enquiries and accounts read it; admins and super admins change the settings; the backend
-- (service role) sends the reminders every 15 minutes. private.workspace_handover is replaced by the same function plus the
-- hold (its body moves, unchanged, to private.workspace_handover_now). Agreements signed before this install keep the old
-- invoice step. No DROP of data, no DELETE. Safe to run twice.

create table if not exists private.workspace_onboarding_fee_settings (
 singleton boolean primary key default true check(singleton),
 amount_minor bigint check(amount_minor is null or amount_minor between 0 and 100000000),
 reminders_on boolean not null default true,
 reminder_hours integer not null default 48 check(reminder_hours between 1 and 2160),
 signed_message text not null check(char_length(signed_message) between 1 and 1000),
 sent_message text not null check(char_length(sent_message) between 1 and 1000),
 reminder_message text not null check(char_length(reminder_message) between 1 and 1000),
 settled_message text not null check(char_length(settled_message) between 1 and 1000),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_onboarding_fee_settings enable row level security;
revoke all on private.workspace_onboarding_fee_settings from public,anon,authenticated;
insert into private.workspace_onboarding_fee_settings(singleton,signed_message,sent_message,reminder_message,settled_message) values(true,
 'Hi {first_name}, thank you for signing the management agreement for {property}. A copy is saved with your documents in the Recharge app. Next, our accounts team will send you the onboarding fee invoice.',
 'Hi {first_name}, the onboarding fee invoice for {property} has been sent{amount_text}. Once it is settled, we will start getting your property ready for guests.',
 'Hi {first_name}, a friendly reminder that the onboarding fee invoice for {property}{amount_text} is still outstanding. Once it is settled, we can start getting your property ready for guests. Reply here if you have any questions.',
 'Hi {first_name}, thank you, we have received the onboarding fee for {property}. Your onboarding tasks are now under way, and you can follow each one in the Recharge app.')
on conflict do nothing;

-- One onboarding fee per property: its Receivable ticket and where it has got to.
create table if not exists private.workspace_onboarding_fees (
 property_id uuid primary key references private.workspace_journeys(property_id) on delete cascade,
 item_id uuid not null unique references private.workspace_hub_items(id) on delete cascade,
 opened_at timestamptz not null default now(),
 sent_at timestamptz,
 last_reminder_at timestamptz,
 reminders integer not null default 0 check(reminders>=0),
 settled_at timestamptz,
 released integer not null default 0 check(released>=0)
);
create index if not exists workspace_onboarding_fees_due_idx on private.workspace_onboarding_fees(last_reminder_at) where settled_at is null and sent_at is not null;
alter table private.workspace_onboarding_fees enable row level security;
revoke all on private.workspace_onboarding_fees from public,anon,authenticated;

-- Tasks from the onboarding package held until the fee is settled.
create table if not exists private.workspace_onboarding_held_tasks (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 feature text not null,
 title text not null,
 kind text not null,
 payload jsonb not null default '{}',
 held_by uuid references public.workspace_profiles(user_id),
 held_at timestamptz not null default now(),
 released_at timestamptz,
 work_id uuid references public.workspace_work_items(id) on delete set null
);
create index if not exists workspace_onboarding_held_tasks_property_idx on private.workspace_onboarding_held_tasks(property_id) where released_at is null;
alter table private.workspace_onboarding_held_tasks enable row level security;
revoke all on private.workspace_onboarding_held_tasks from public,anon,authenticated;

-- The handover as it was, under a new name.
create or replace function private.workspace_handover_now(target_property uuid,feature text,title text,kind text,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;event_id bigint;begin
 insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),target_property,feature,title,auth.uid(),false) returning id into target;
 insert into private.workspace_domain_details(work_id,kind,data) values(target,kind,payload);
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),target_property,target,'handover.created') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
 select p.user_id,target,event_id from public.workspace_profiles p where p.status='active' and p.role not in ('client','cleans') and
 (p.role in ('admin','super_admin') or
  (p.role='accounts' and private.workspace_finance_feature(feature) and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id=feature)) or
  exists(select 1 from public.workspace_module_grants g join public.workspace_property_assignments a on a.user_id=g.user_id where g.user_id=p.user_id and g.module_id=feature and a.property_id=target_property)) on conflict do nothing;
 return target;
end $$;

-- The handover with the onboarding fee in mind: the old invoice task is not made where a fee ticket exists, and the package's
-- tasks wait for the fee to be settled. Everything else is handed over as before.
create or replace function private.workspace_handover(target_property uuid,feature text,title text,kind text,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if $4='onboarding_invoice' and exists(select 1 from private.workspace_onboarding_fees f where f.property_id=$1) then return null;end if;
 if $4 in ('cleaning_setup','licensing','garden_setup','furnishing_quote') and exists(select 1 from private.workspace_onboarding_fees f where f.property_id=$1 and f.settled_at is null) then
  insert into private.workspace_onboarding_held_tasks(property_id,feature,title,kind,payload,held_by) values($1,$2,$3,$4,coalesce($5,'{}'),auth.uid());
  return null;
 end if;
 return private.workspace_handover_now($1,$2,$3,$4,$5);
end $$;

-- "£1,800.00", or nothing when there is no amount.
create or replace function private.workspace_fee_money(amount bigint) returns text language sql immutable set search_path='' as $$
 select case when amount is null then '' else '£'||to_char(amount/100.0,'FM999,999,990.00') end
$$;

-- A message to a property's owner in their conversation (from whoever sent the agreement, or a super admin), a notice to the
-- owner and, when asked, the same words by email to their sign-in address. Placeholders: {first_name}, {property}, {amount}
-- and {amount_text} (" for £1,800.00", or nothing).
create or replace function private.workspace_owner_message(prop uuid,template text,subject text,amount bigint,email boolean,at_time timestamptz) returns uuid language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;p public.workspace_properties;own public.workspace_profiles;author uuid;conv uuid;mid uuid;ev bigint;body text;mail text;place text;begin
 select * into j from private.workspace_journeys where property_id=prop;
 if j.client_id is null then return null;end if;
 select * into p from public.workspace_properties where id=prop;
 select * into own from public.workspace_profiles where user_id=j.client_id;
 if own.user_id is null or own.role<>'client' then return null;end if;
 author:=(select s.sent_by from private.workspace_followup_sent(prop) s join public.workspace_profiles x on x.user_id=s.sent_by where x.status='active' and x.role<>'client');
 author:=coalesce(author,(select x.user_id from public.workspace_profiles x where x.status='active' and x.role='super_admin' order by x.created_at,x.user_id limit 1));
 if author is null then return null;end if;
 place:=coalesce(nullif(btrim(p.name),''),'your property');
 body:=replace(replace(replace(replace(template,'{first_name}',coalesce(nullif(split_part(btrim(coalesce(own.full_name,'')),' ',1),''),'there')),'{property}',place),
  '{amount_text}',case when amount is null then '' else ' for '||private.workspace_fee_money(amount) end),'{amount}',private.workspace_fee_money(amount));
 insert into private.chat_conversations(kind,owner_id,created_by) values('owner',own.user_id,own.user_id) on conflict do nothing;
 conv:=(select c.id from private.chat_conversations c where c.kind='owner' and c.owner_id=own.user_id);
 insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at) values(conv,author,left(body,4000),gen_random_uuid(),at_time) returning id into mid;
 update private.chat_conversations set last_message_at=greatest(last_message_at,at_time) where id=conv;
 insert into public.workspace_activity(actor_id,event_type,created_at) values(author,'chat.message',at_time) returning id into ev;
 insert into private.workspace_activity_details(event_id,who,preview,context,replied) values(ev,'Recharge',private.workspace_push_line(body),null,false) on conflict do nothing;
 insert into private.workspace_notification_outbox(user_id,event_id) values(own.user_id,ev) on conflict do nothing;
 if email then
  mail:=(select lower(u.email) from auth.users u where u.id=own.user_id);
  if mail is not null and char_length(mail) between 3 and 320 then
   insert into private.workspace_email_outbox(chat_message_id,to_address,subject,body)
    values(mid,mail,left(replace(subject,'{property}',place),300),left(body,4000)) on conflict(chat_message_id) do nothing;
  end if;
 end if;
 return mid;
end $fn$;

-- Accounts (and super admins) hear that an onboarding fee invoice is to prepare.
create or replace function private.workspace_fee_tell_accounts(prop uuid,event text,at_time timestamptz) returns void language plpgsql security definer set search_path='' as $fn$
declare ev bigint;begin
 insert into public.workspace_activity(property_id,event_type,created_at) values(prop,event,at_time) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id)
 select p.user_id,ev from public.workspace_profiles p where p.status='active' and p.role in ('accounts','super_admin') on conflict do nothing;
end $fn$;

-- Signing: the confirmation to the owner and the fee ticket in Receivable (once per property).
create or replace function private.workspace_onboarding_fee_open() returns trigger language plpgsql security definer set search_path='' as $fn$
declare st private.workspace_onboarding_fee_settings;p public.workspace_properties;item uuid;maker uuid;client uuid;begin
 if exists(select 1 from private.workspace_onboarding_fees f where f.property_id=new.property_id) then return new;end if;
 select * into st from private.workspace_onboarding_fee_settings where singleton;
 select * into p from public.workspace_properties where id=new.property_id;
 perform private.workspace_owner_message(new.property_id,st.signed_message,'Your management agreement for {property} is signed',st.amount_minor,true,now());
 maker:=coalesce((select x.user_id from public.workspace_profiles x where x.user_id=auth.uid() and x.role<>'client'),
  (select s.sent_by from private.workspace_followup_sent(new.property_id) s join public.workspace_profiles x on x.user_id=s.sent_by where x.status='active' and x.role<>'client'),
  (select x.user_id from public.workspace_profiles x where x.status='active' and x.role='super_admin' order by x.created_at,x.user_id limit 1));
 if maker is null then return new;end if;
 client:=(select x.user_id from public.workspace_profiles x where x.user_id=new.client_id and x.role='client');
 insert into private.workspace_hub_items(kind,title,details,property_id,department,amount_minor,status,client_id,created_by)
  values('invoice',left('Onboarding fee: '||coalesce(nullif(btrim(p.name),''),'new property'),200),
   'Opened automatically when the management agreement was signed. Prepare and send the onboarding fee invoice; once it is settled, the onboarding package tasks are released.',
   new.property_id,'accounts',st.amount_minor,'to_send',client,maker) returning id into item;
 insert into private.workspace_onboarding_fees(property_id,item_id) values(new.property_id,item) on conflict do nothing;
 perform private.workspace_followup_note(new.property_id,'Agreement signed: the owner was sent a confirmation, and the onboarding fee invoice was opened in Receivable for accounts.',null);
 perform private.workspace_fee_tell_accounts(new.property_id,'hub.onboarding_fee',now());
 return new;
end $fn$;
drop trigger if exists workspace_onboarding_fee_open on private.workspace_journeys;
create trigger workspace_onboarding_fee_open after update of signed_at on private.workspace_journeys for each row
 when (old.signed_at is null and new.signed_at is not null) execute function private.workspace_onboarding_fee_open();

-- Settled: the fee step turns green, the onboarding moves on, and the held tasks are released.
create or replace function private.workspace_onboarding_fee_settle(prop uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $fn$
declare h private.workspace_onboarding_held_tasks;n integer:=0;w uuid;ref text;begin
 ref:=(select nullif(btrim(i.reference),'') from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=prop);
 update private.workspace_onboarding_fees set settled_at=coalesce(settled_at,at_time) where property_id=prop;
 update private.workspace_journeys set invoice_outside_at=coalesce(invoice_outside_at,at_time),
  invoice_outside_note=coalesce(invoice_outside_note,left('Onboarding fee settled in Receivable'||coalesce(' ('||ref||')',''),500)),
  stage=case when stage='invoice' then 'inspection_to_book' else stage end,version=version+1,updated_at=now() where property_id=prop;
 update public.workspace_work_items wi set status='completed',completed_at=now(),version=version+1 where wi.property_id=prop and wi.status not in ('completed','cancelled')
  and exists(select 1 from private.workspace_domain_details d where d.work_id=wi.id and d.kind='onboarding_invoice');
 for h in select * from private.workspace_onboarding_held_tasks t where t.property_id=prop and t.released_at is null order by t.held_at,t.id for update loop
  w:=private.workspace_handover_now(h.property_id,h.feature,h.title,h.kind,h.payload);
  update private.workspace_onboarding_held_tasks set released_at=at_time,work_id=w where id=h.id;
  n:=n+1;
 end loop;
 update private.workspace_onboarding_fees set released=released+n where property_id=prop;
 return n;
end $fn$;

-- The fee ticket moving in Receivable: sent tells the owner and the team; paid settles it.
create or replace function private.workspace_onboarding_fee_moved() returns trigger language plpgsql security definer set search_path='' as $fn$
declare f private.workspace_onboarding_fees;st private.workspace_onboarding_fee_settings;n integer;begin
 select * into f from private.workspace_onboarding_fees where item_id=new.id;
 if f.property_id is null or new.status is not distinct from old.status then return new;end if;
 select * into st from private.workspace_onboarding_fee_settings where singleton;
 if new.status='sent' and f.sent_at is null then
  update private.workspace_onboarding_fees set sent_at=now(),last_reminder_at=now() where property_id=f.property_id;
  perform private.workspace_owner_message(f.property_id,st.sent_message,'Your onboarding fee invoice for {property}',new.amount_minor,false,now());
  perform private.workspace_followup_note(f.property_id,'Onboarding fee invoice sent to the owner'||coalesce(' ('||nullif(private.workspace_fee_money(new.amount_minor),'')||')','')||'.',auth.uid());
  perform private.workspace_followup_tell(f.property_id,'enquiry.fee_sent',now());
 elsif new.status='paid' and f.settled_at is null then
  n:=private.workspace_onboarding_fee_settle(f.property_id,now());
  perform private.workspace_owner_message(f.property_id,st.settled_message,'Onboarding fee received for {property}',new.amount_minor,true,now());
  perform private.workspace_followup_note(f.property_id,'Onboarding fee settled. '||case when n=0 then 'No onboarding tasks were waiting.' when n=1 then '1 onboarding task released to its board.' else n||' onboarding tasks released to their boards.' end,auth.uid());
  perform private.workspace_followup_tell(f.property_id,'enquiry.fee_settled',now());
 end if;
 return new;
end $fn$;
drop trigger if exists workspace_onboarding_fee_moved on private.workspace_hub_items;
create trigger workspace_onboarding_fee_moved after update of status on private.workspace_hub_items for each row execute function private.workspace_onboarding_fee_moved();

-- Settled another way (an onboarding invoice linked and paid, or recorded as handled outside the app): the fee ticket in
-- Receivable is closed as paid, which settles the fee and releases the tasks as above.
create or replace function private.workspace_onboarding_fee_elsewhere() returns trigger language plpgsql security definer set search_path='' as $fn$
declare f private.workspace_onboarding_fees;begin
 select * into f from private.workspace_onboarding_fees where property_id=new.property_id;
 if f.property_id is null or f.settled_at is not null then return new;end if;
 if (old.invoice_outside_at is null and new.invoice_outside_at is not null)
   or (old.stage in ('form','invoice') and new.stage in ('inspection_to_book','inspection_booked','inspection_complete','live')) then
  update private.workspace_hub_items set status='paid',settled_minor=coalesce(amount_minor,settled_minor),
   outcome_note=left(coalesce(nullif(outcome_note,'')||' ','')||'Settled through the onboarding invoice.',2000),decided_by=coalesce(decided_by,auth.uid()),decided_at=coalesce(decided_at,now()),
   version=version+1,updated_at=now() where id=f.item_id and status<>'paid';
 end if;
 return new;
end $fn$;
drop trigger if exists workspace_onboarding_fee_elsewhere on private.workspace_journeys;
create trigger workspace_onboarding_fee_elsewhere after update of stage,invoice_outside_at on private.workspace_journeys for each row execute function private.workspace_onboarding_fee_elsewhere();

-- Reminders, every 15 minutes (the backend): a sent fee not yet settled reminds the owner every 48 hours (the setting), in
-- their conversation and by email. At most 50 a run.
create or replace function private.workspace_onboarding_fee_sweep(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare st private.workspace_onboarding_fee_settings;f private.workspace_onboarding_fees;i private.workspace_hub_items;sent integer:=0;begin
 perform pg_advisory_xact_lock(hashtext('workspace_onboarding_fee_sweep'));
 select * into st from private.workspace_onboarding_fee_settings where singleton;
 if not st.reminders_on then return jsonb_build_object('reminded',0);end if;
 for f in select x.* from private.workspace_onboarding_fees x join private.workspace_hub_items h on h.id=x.item_id
   where x.settled_at is null and x.sent_at is not null and h.status='sent' and x.last_reminder_at<=at_time-make_interval(hours=>st.reminder_hours)
   order by x.last_reminder_at limit 50 for update of x skip locked loop
  select * into i from private.workspace_hub_items where id=f.item_id;
  perform private.workspace_owner_message(f.property_id,st.reminder_message,'Reminder: your onboarding fee invoice for {property}',case when i.amount_minor is null then null else greatest(i.amount_minor-coalesce(i.settled_minor,0),0) end,true,at_time);
  update private.workspace_onboarding_fees set last_reminder_at=at_time,reminders=reminders+1 where property_id=f.property_id;
  perform private.workspace_followup_note(f.property_id,'Payment reminder '||(f.reminders+1)||' sent to the owner in the app and by email.',null);
  sent:=sent+1;
 end loop;
 return jsonb_build_object('reminded',sent);
end $fn$;

create or replace function private.workspace_onboarding_fee_settings_view() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('amountMinor',s.amount_minor,'remindersOn',s.reminders_on,'reminderHours',s.reminder_hours,'signedMessage',s.signed_message,
  'sentMessage',s.sent_message,'reminderMessage',s.reminder_message,'settledMessage',s.settled_message,'updatedAt',s.updated_at,'updatedByName',p.full_name,
  'canEdit',coalesce(private.workspace_actor_role() in ('admin','super_admin'),false))
 from private.workspace_onboarding_fee_settings s left join public.workspace_profiles p on p.user_id=s.updated_by where s.singleton
$$;

create or replace function private.workspace_onboarding_fee_view(prop uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('propertyId',f.property_id,'itemId',f.item_id,'status',i.status,'title',i.title,'reference',i.reference,'amountMinor',i.amount_minor,
  'settledMinor',coalesce(i.settled_minor,0),'openedAt',f.opened_at,'sentAt',f.sent_at,'lastReminderAt',f.last_reminder_at,'reminders',f.reminders,'settledAt',f.settled_at,
  'released',f.released,'held',(select coalesce(jsonb_agg(jsonb_build_object('title',h.title,'releasedAt',h.released_at) order by h.held_at,h.id),'[]'::jsonb)
   from private.workspace_onboarding_held_tasks h where h.property_id=f.property_id))
 from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=prop
$$;

create or replace function private.workspace_onboarding_fee_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if not (private.workspace_can_enquiries() or coalesce(private.workspace_actor_role()='accounts',false)) then raise exception 'Client enquiries access required' using errcode='42501';end if;
 return jsonb_build_object('settings',private.workspace_onboarding_fee_settings_view(),'fee',case when target is null then null else private.workspace_onboarding_fee_view(target) end);
end $fn$;

--   { action: 'saveSettings', requestId, amountMinor|null, remindersOn, reminderHours, signedMessage, sentMessage, reminderMessage, settledMessage }
create or replace function private.workspace_onboarding_fee_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;msgs text[];k text;h numeric;amt numeric;begin
 if not (private.workspace_can_enquiries() or coalesce(actor='accounts',false)) then raise exception 'Client enquiries access required' using errcode='42501';end if;
 if input->>'action' is distinct from 'saveSettings' then raise exception 'Unknown onboarding fee action' using errcode='22023';end if;
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 perform private.workspace_json_keys(input,array['action','requestId','amountMinor','remindersOn','reminderHours','signedMessage','sentMessage','reminderMessage','settledMessage'],16000);
 if actor not in ('admin','super_admin') then raise exception 'Only admins can change the onboarding fee settings' using errcode='42501';end if;
 if input->'amountMinor' is not null and jsonb_typeof(input->'amountMinor')<>'null' then
  if jsonb_typeof(input->'amountMinor')<>'number' then raise exception 'Enter the fee in pounds' using errcode='22023';end if;
  amt:=(input->>'amountMinor')::numeric;
  if amt<>floor(amt) or amt not between 0 and 100000000 then raise exception 'Enter a fee up to £1,000,000' using errcode='22023';end if;
 end if;
 if jsonb_typeof(input->'remindersOn') is distinct from 'boolean' then raise exception 'Choose whether reminders are sent' using errcode='22023';end if;
 if jsonb_typeof(input->'reminderHours') is distinct from 'number' then raise exception 'Remind every 1 hour to 90 days' using errcode='22023';end if;
 h:=(input->>'reminderHours')::numeric;
 if h<>floor(h) or h not between 1 and 2160 then raise exception 'Remind every 1 hour to 90 days' using errcode='22023';end if;
 foreach k in array array['signedMessage','sentMessage','reminderMessage','settledMessage'] loop
  if jsonb_typeof(input->k) is distinct from 'string' or char_length(btrim(input->>k)) not between 1 and 1000 then raise exception 'Write each message (up to 1000 characters)' using errcode='22023';end if;
 end loop;
 update private.workspace_onboarding_fee_settings set amount_minor=amt::bigint,reminders_on=(input->>'remindersOn')::boolean,reminder_hours=h::integer,
  signed_message=btrim(input->>'signedMessage'),sent_message=btrim(input->>'sentMessage'),reminder_message=btrim(input->>'reminderMessage'),settled_message=btrim(input->>'settledMessage'),
  updated_by=auth.uid(),updated_at=now() where singleton;
 result:=jsonb_build_object('settings',private.workspace_onboarding_fee_settings_view(),'fee',null);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

create or replace function public.workspace_onboarding_fee_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_onboarding_fee_read(target) $$;
create or replace function public.workspace_onboarding_fee_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_onboarding_fee_action(input) $$;
create or replace function public.workspace_onboarding_fee_sweep() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_onboarding_fee_sweep() $$;

revoke all on function private.workspace_handover_now(uuid,text,text,text,jsonb),private.workspace_handover(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function private.workspace_fee_money(bigint),
 private.workspace_owner_message(uuid,text,text,bigint,boolean,timestamptz),private.workspace_fee_tell_accounts(uuid,text,timestamptz),
 private.workspace_onboarding_fee_open(),private.workspace_onboarding_fee_settle(uuid,timestamptz),private.workspace_onboarding_fee_moved(),private.workspace_onboarding_fee_elsewhere(),
 private.workspace_onboarding_fee_sweep(timestamptz),public.workspace_onboarding_fee_sweep(),
 private.workspace_onboarding_fee_settings_view(),private.workspace_onboarding_fee_view(uuid),
 private.workspace_onboarding_fee_read(uuid),public.workspace_onboarding_fee_read(uuid),
 private.workspace_onboarding_fee_action(jsonb),public.workspace_onboarding_fee_action(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.workspace_onboarding_fee_read(uuid),public.workspace_onboarding_fee_read(uuid),
 private.workspace_onboarding_fee_action(jsonb),public.workspace_onboarding_fee_action(jsonb) to authenticated;
grant execute on function private.workspace_onboarding_fee_sweep(timestamptz),public.workspace_onboarding_fee_sweep() to service_role;
