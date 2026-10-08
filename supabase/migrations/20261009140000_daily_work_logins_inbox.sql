-- Three follow-ups that need no outside service:
-- 1. Bonuses count daily work (S6). The score blends reply times with daily work on the days the
--    person worked a Stays shift (guest or client relations): daily sign-offs, listing checks,
--    pricing decisions and reviews logged, each against an editable target per day. Admins set
--    how much daily work counts (0-100%). The pass mark and bonus tiers apply to the blended score.
-- 2. Platform logins as one row per platform (S15): which account, who holds it, where the
--    password is kept and who gets the security code. Passwords themselves are never stored.
-- 3. Guest inbox (C1): threads and message text, ready for the channel manager to fill through
--    workspace_guest_messages_ingest. Until then staff log guest messages and replies by hand, so
--    reply times (C3, C8) already work.
-- Written without "select ... into" so it can be pasted into the Supabase SQL editor. Safe to run more than once.

-- 1. Daily work in the bonus score ------------------------------------------------------------
alter table private.workspace_performance_targets
 add column if not exists work_weight integer not null default 40 check(work_weight between 0 and 100),
 add column if not exists daily_targets jsonb not null default '{"signOffs":1,"listingChecks":1,"pricingDecisions":1,"reviewsLogged":0}';

-- Reply score and daily-work score, weighted; either alone when the other has nothing to count.
create or replace function private.workspace_blend_score(reply numeric, work numeric, weight integer) returns numeric
language sql immutable set search_path='' as $$
 select case when weight<=0 then reply when weight>=100 then work when reply is null then work when work is null then reply
  else (reply*(100-weight)+work*weight)/100 end;
$$;

-- Days on a Stays shift, what was done, and the daily-work percentage: each item with a target
-- above 0 scores done ÷ (target × days), capped at 100%, and the items are averaged.
create or replace function private.workspace_daily_work(target uuid, start_on date, end_on date) returns jsonb
language sql stable security definer set search_path='' as $$
 with t as (select daily_targets d from private.workspace_performance_targets where singleton),
 lower_at as (select start_on::timestamp at time zone 'Europe/London' v),
 upper_at as (select (end_on+1)::timestamp at time zone 'Europe/London' v),
 days as (select count(distinct (s.clocked_in_at at time zone 'Europe/London')::date) n from private.workspace_shifts s
   where s.user_id=target and s.department in ('guest_relations','client_relations') and (s.clocked_in_at at time zone 'Europe/London')::date between start_on and end_on),
 work as (select d.kind,count(*) n from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where w.created_by=target and d.kind in ('listing_health','daily_pricing','guest_review') and w.created_at>=(select v from lower_at) and w.created_at<(select v from upper_at) group by d.kind),
 done as (select 'signOffs' k,(select count(*) from private.workspace_daily_signoffs o where o.user_id=target and o.day between start_on and end_on) n
   union all select 'listingChecks',coalesce((select n from work where kind='listing_health'),0)
   union all select 'pricingDecisions',coalesce((select n from work where kind='daily_pricing'),0)
   union all select 'reviewsLogged',coalesce((select n from work where kind='guest_review'),0)),
 parts as (select done.k,done.n,coalesce((t.d->>done.k)::numeric,0) per_day from done cross join t)
 select jsonb_build_object('daysWorked',days.n,
  'workPercent',case when days.n>0 and exists(select 1 from parts where per_day>0)
   then floor((select avg(least(100,parts.n*100.0/(parts.per_day*days.n))) from parts where per_day>0))::int end)
 from days;
$$;

create or replace function private.workspace_shift_read(section text, start_on date, end_on date)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;t private.workspace_performance_targets;begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 admin:=actor in ('admin','super_admin');
 t:=(select x from private.workspace_performance_targets x where singleton);
 if section='shift' then
  -- The person's own shift, and their own scorecard for the last 30 days.
  lower_at:=((now() at time zone 'Europe/London')::date-29)::timestamp at time zone 'Europe/London';upper_at:=now();
  return jsonb_build_object('open',(select private.workspace_shift_json(s) from private.workspace_shifts s where s.user_id=auth.uid() and s.clocked_out_at is null),
   'today',coalesce((select jsonb_agg(private.workspace_shift_json(s) order by s.clocked_in_at) from private.workspace_shifts s where s.user_id=auth.uid()
     and s.clocked_in_at>=((now() at time zone 'Europe/London')::date::timestamp at time zone 'Europe/London')),'[]'),
   'green',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid() and r.grade='green'),
   'responses',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid()),
   'passPercent',t.pass_percent,
   'rota',(select jsonb_build_object('department',r.department,'usualShift',r.usual_shift) from private.workspace_staff_rota r where r.user_id=auth.uid()));
 elsif section='teamPerformance' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>92 then raise exception 'Choose up to 92 days' using errcode='22023';end if;
  lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
  return jsonb_build_object(
   'targets',jsonb_build_object('greenMinutes',t.green_minutes,'amberMinutes',t.amber_minutes,'passPercent',t.pass_percent,'bonusPercents',to_jsonb(t.bonus_percents),'version',t.version,
     'workWeight',t.work_weight,'dailyTargets',t.daily_targets),
   'onShift',case when admin then coalesce((select jsonb_agg(private.workspace_shift_json(s) order by s.department,s.clocked_in_at) from private.workspace_shifts s where s.clocked_out_at is null),'[]') else '[]' end,
   'messages',(select count(*) from private.workspace_guest_messages g where g.sent_at>=lower_at and g.sent_at<upper_at),
   'unassigned',(select jsonb_build_object('green',count(*) filter(where r.grade='green'),'amber',count(*) filter(where r.grade='amber'),'red',count(*) filter(where r.grade='red'))
     from private.workspace_response_rows(lower_at,upper_at) r where r.user_id is null and admin),
   'people',coalesce((select jsonb_agg(item order by item->>'fullName') from (
    select jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,
     'shifts',(select count(*) from private.workspace_shifts s where s.user_id=p.user_id and s.clocked_in_at<upper_at and coalesce(s.clocked_out_at,now())>lower_at),
     'minutes',(select coalesce(round(sum(extract(epoch from least(coalesce(s.clocked_out_at,now()),upper_at)-greatest(s.clocked_in_at,lower_at))/60)),0)::int
       from private.workspace_shifts s where s.user_id=p.user_id and s.clocked_in_at<upper_at and coalesce(s.clocked_out_at,now())>lower_at),
     'green',r.green,'amber',r.amber,'red',r.red,
     'percentGreen',case when r.total>0 then floor(r.green*100.0/r.total)::int end,
     'daysWorked',(dw.w->>'daysWorked')::int,'workPercent',(dw.w->>'workPercent')::int,
     'score',floor(sc.score)::int,
     'onTrack',case when sc.score is not null then sc.score>=t.pass_percent end,
     'bonusTier',case when sc.score is not null then (select max(b) from unnest(t.bonus_percents) b where sc.score>=b) end,
     'listingChecks',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='listing_health' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at),
     'department',(select r.department from private.workspace_staff_rota r where r.user_id=p.user_id),
     'usualShift',(select r.usual_shift from private.workspace_staff_rota r where r.user_id=p.user_id),
     'signOffs',(select count(*) from private.workspace_daily_signoffs o where o.user_id=p.user_id and o.day between start_on and end_on),
     'reviewsLogged',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='guest_review' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at),
     'pricingDecisions',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='daily_pricing' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at)) item
    from public.workspace_profiles p
    cross join lateral (select count(*) filter(where x.grade='green') green,count(*) filter(where x.grade='amber') amber,count(*) filter(where x.grade='red') red,count(*) total
      from private.workspace_response_rows(lower_at,upper_at) x where x.user_id=p.user_id) r
    cross join lateral (select private.workspace_daily_work(p.user_id,start_on,end_on) w) dw
    cross join lateral (select private.workspace_blend_score(case when r.total>0 then r.green*100.0/r.total end,(dw.w->>'workPercent')::numeric,t.work_weight) score) sc
    where p.status='active' and p.role<>'client' and (admin or p.user_id=auth.uid())) people),'[]'));
 end if;
 raise exception 'Unknown team section' using errcode='22023';
end $function$;

create or replace function private.workspace_shift_action(input jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;s private.workspace_shifts;t private.workspace_performance_targets;bonuses integer[];daily jsonb;begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('closeShift','saveTargets') and actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if a='clockIn' and not private.workspace_onboarded() then raise exception 'Finish your onboarding before clocking in' using errcode='42501';end if;
 if a not in ('clockIn','clockOut','closeShift','saveTargets') then raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.request_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='clockIn' then
  perform private.workspace_json_keys(input,array['action','requestId','department']);
  if exists(select 1 from private.workspace_shifts where user_id=auth.uid() and clocked_out_at is null) then raise exception 'You are already clocked in' using errcode='23505';end if;
  insert into private.workspace_shifts(user_id,department,request_id) values(auth.uid(),private.workspace_required_text(input,'department',2,40),req) returning * into s;
 elsif a='clockOut' then
  perform private.workspace_json_keys(input,array['action','requestId']);
  update private.workspace_shifts set clocked_out_at=now() where user_id=auth.uid() and clocked_out_at is null returning * into s;
  if not found then raise exception 'You are not clocked in' using errcode='P0002';end if;
 elsif a='closeShift' then
  -- For someone who forgot to clock out: the admin sets when the shift ended.
  perform private.workspace_json_keys(input,array['action','requestId','shiftId','endedAt']);
  update private.workspace_shifts set clocked_out_at=greatest(clocked_in_at,least(now(),(input->>'endedAt')::timestamptz)),closed_by=auth.uid()
   where id=(input->>'shiftId')::uuid and clocked_out_at is null returning * into s;
  if not found then raise exception 'That shift has already ended' using errcode='P0002';end if;
 elsif a='saveTargets' then
  perform private.workspace_json_keys(input,array['action','requestId','version','greenMinutes','amberMinutes','passPercent','bonusPercents','workWeight','dailyTargets']);
  if jsonb_typeof(input->'bonusPercents') is distinct from 'array' or exists(select 1 from jsonb_array_elements(input->'bonusPercents') e where jsonb_typeof(e)<>'number') then raise exception 'Invalid targets' using errcode='22023';end if;
  if input ? 'workWeight' and (jsonb_typeof(input->'workWeight')<>'number' or input->>'workWeight'!~'^\d{1,3}$' or (input->>'workWeight')::int>100) then raise exception 'Daily work counts for 0 to 100 percent' using errcode='22023';end if;
  if input ? 'dailyTargets' then
   daily:=input->'dailyTargets';
   if jsonb_typeof(daily)<>'object' or exists(select 1 from jsonb_object_keys(daily) k where k not in ('signOffs','listingChecks','pricingDecisions','reviewsLogged'))
    or exists(select 1 from jsonb_each(daily) e where jsonb_typeof(e.value)<>'number' or e.value#>>'{}'!~'^\d{1,2}$') then raise exception 'Daily targets are whole numbers from 0 to 99' using errcode='22023';end if;
  end if;
  bonuses:=array(select distinct (e#>>'{}')::int from jsonb_array_elements(input->'bonusPercents') e order by 1);
  t:=(select x from private.workspace_performance_targets x where singleton for update);
  if t.version is distinct from (input->>'version')::integer then raise exception 'Targets changed' using errcode='40001';end if;
  update private.workspace_performance_targets set green_minutes=(input->>'greenMinutes')::int,amber_minutes=(input->>'amberMinutes')::int,pass_percent=(input->>'passPercent')::int,
   bonus_percents=bonuses,work_weight=coalesce((input->>'workWeight')::int,work_weight),daily_targets=coalesce(daily_targets||daily,daily_targets),
   version=version+1,updated_by=auth.uid(),updated_at=now() where singleton;
  result:=jsonb_build_object('version',t.version+1);
 end if;
 if a<>'saveTargets' then result:=private.workspace_shift_json(s);end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $function$;
revoke all on function private.workspace_blend_score(numeric,numeric,integer),private.workspace_daily_work(uuid,date,date) from public,anon,authenticated;

-- 2. Platform logins, one row per platform ----------------------------------------------------
alter table private.workspace_property_secrets add column if not exists ota_accounts jsonb not null default '[]';

create or replace function private.workspace_property_details(target_property uuid, section text)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare actor text:=private.workspace_actor_role();begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if section='access' then
  if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or
    (actor='cleans' and private.workspace_can_property(target_property,'cleaning-schedule') and exists(select 1 from public.workspace_work_items where property_id=target_property and assignee_id=auth.uid() and module_id='cleaning-schedule' and status in ('waiting','in_progress')))) then raise exception 'Property access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('accessInstructions',access_instructions) from private.workspace_property_secrets where property_id=target_property),'{}');
 elsif section='ota' then
  if actor in ('client','cleans','cleaning_manager') or not private.workspace_can_property(target_property,'ota-logins') then raise exception 'OTA access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('otaInstructions',ota_instructions,'otaAccounts',ota_accounts) from private.workspace_property_secrets where property_id=target_property),'{}');
 elsif section='owner' then
  if not (actor in ('admin','super_admin') or (actor='stays' and private.workspace_can_property(target_property,'property-database')) or (actor='accounts' and private.workspace_can_property(target_property,'owner-statements'))) then raise exception 'Owner details access denied' using errcode='42501';end if;
  return jsonb_build_object('owners',coalesce((select jsonb_agg(jsonb_build_object('name',pr.full_name,'email',u.email) order by pr.full_name) from public.workspace_profiles pr join auth.users u on u.id=pr.user_id
   where pr.user_id in (select a.user_id from public.workspace_property_assignments a where a.property_id=target_property and a.assignment='client' union select j.client_id from private.workspace_journeys j where j.property_id=target_property)),'[]'));
 elsif section='finance' then
  if not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Financial access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('managementFeeBps',management_fee_bps,'paymentNotes',payment_notes) from private.workspace_property_financials where property_id=target_property),'{}');
 end if;
 raise exception 'Invalid section' using errcode='22023';
end $function$;

create or replace function private.workspace_save_property_details(target_property uuid, expected_version integer, section text, input jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
declare v integer;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 v:=(select p.version from public.workspace_properties p where p.id=target_property for update);
 if v is null then raise exception 'Property not found' using errcode='P0002';end if;
 if v is distinct from expected_version then raise exception 'Property changed' using errcode='40001';end if;
 if section='access' then
  perform private.workspace_json_keys(input,array['accessInstructions']);
  if jsonb_typeof(input->'accessInstructions') is distinct from 'string' or length(input->>'accessInstructions')>5000 then raise exception 'Invalid access instructions' using errcode='22023';end if;
  insert into private.workspace_property_secrets(property_id,access_instructions) values(target_property,input->>'accessInstructions') on conflict(property_id) do update set access_instructions=excluded.access_instructions,updated_at=now();
 elsif section='ota' then
  perform private.workspace_json_keys(input,array['otaInstructions']);
  if jsonb_typeof(input->'otaInstructions') is distinct from 'string' or length(input->>'otaInstructions')>5000 then raise exception 'Invalid OTA instructions' using errcode='22023';end if;
  insert into private.workspace_property_secrets(property_id,ota_instructions) values(target_property,input->>'otaInstructions') on conflict(property_id) do update set ota_instructions=excluded.ota_instructions,updated_at=now();
 elsif section='otaAccounts' then
  -- Which account each platform uses and where its password is kept. There is no password field.
  perform private.workspace_json_keys(input,array['accounts']);
  if jsonb_typeof(input->'accounts') is distinct from 'array' or jsonb_array_length(input->'accounts')>20 or exists(
    select 1 from jsonb_array_elements(input->'accounts') e where jsonb_typeof(e)<>'object'
     or exists(select 1 from jsonb_object_keys(e) k where k not in ('platform','login','holder','passwordWhere','twoFactor','notes'))
     or exists(select 1 from jsonb_each(e) x where jsonb_typeof(x.value)<>'string')
     or char_length(trim(coalesce(e->>'platform',''))) not between 1 and 40
     or coalesce(e->>'holder','') not in ('recharge','owner')
     or char_length(coalesce(e->>'login',''))>200 or char_length(coalesce(e->>'passwordWhere',''))>200
     or char_length(coalesce(e->>'twoFactor',''))>200 or char_length(coalesce(e->>'notes',''))>500)
  then raise exception 'Check the platform logins' using errcode='22023';end if;
  insert into private.workspace_property_secrets(property_id,ota_accounts) values(target_property,input->'accounts') on conflict(property_id) do update set ota_accounts=excluded.ota_accounts,updated_at=now();
 elsif section='finance' then
  perform private.workspace_json_keys(input,array['managementFeeBps','paymentNotes']);
  if jsonb_typeof(input->'paymentNotes') is distinct from 'string' or length(input->>'paymentNotes')>5000 or
    (input->>'managementFeeBps' is not null and (jsonb_typeof(input->'managementFeeBps') is distinct from 'number' or input->>'managementFeeBps'!~'^\d+$' or (input->>'managementFeeBps')::numeric>10000)) then raise exception 'Invalid financial details' using errcode='22023';end if;
  insert into private.workspace_property_financials(property_id,management_fee_bps,payment_notes) values(target_property,(input->>'managementFeeBps')::integer,input->>'paymentNotes') on conflict(property_id) do update set management_fee_bps=excluded.management_fee_bps,payment_notes=excluded.payment_notes,updated_at=now();
 else raise exception 'Invalid section' using errcode='22023';end if;
 update public.workspace_properties set version=version+1,updated_at=now() where id=target_property;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),target_property,'property_details.'||section||'.updated');
end $function$;

-- 3. Guest inbox -------------------------------------------------------------------------------
create table if not exists private.workspace_guest_threads (
 id uuid primary key default gen_random_uuid(),
 source text not null check(length(source) between 1 and 40),
 thread_ref text not null check(length(thread_ref) between 1 and 200),
 property_id uuid references public.workspace_properties(id) on delete set null,
 channel text not null default 'other' check(channel in ('airbnb','booking_com','vrbo','direct','whatsapp','email','other')),
 guest_name text check(guest_name is null or char_length(guest_name) between 1 and 120),
 reservation_ref text check(reservation_ref is null or char_length(reservation_ref)<=100),
 check_in date, check_out date,
 status text not null default 'open' check(status in ('open','done')),
 last_message_at timestamptz,
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 unique(source,thread_ref)
);
create index if not exists workspace_guest_threads_recent_idx on private.workspace_guest_threads(status,last_message_at desc);
create index if not exists workspace_guest_threads_property_idx on private.workspace_guest_threads(property_id);
alter table private.workspace_guest_threads enable row level security;
revoke all on private.workspace_guest_threads from public,anon,authenticated;
alter table private.workspace_guest_messages
 add column if not exists body text check(body is null or char_length(body)<=5000),
 add column if not exists delivery text check(delivery is null or delivery in ('logged','queued','sent','failed'));
-- Any messages already recorded get a thread.
insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,last_message_at)
 select distinct on (g.source,g.thread_ref) g.source,g.thread_ref,g.property_id,g.channel,max(g.sent_at) over(partition by g.source,g.thread_ref)
 from private.workspace_guest_messages g order by g.source,g.thread_ref,g.sent_at desc
on conflict(source,thread_ref) do nothing;

-- Team members with the Stays Communication Centre see threads for their properties; threads not
-- yet matched to a property are seen by everyone with the tool.
create or replace function private.guest_inbox_can(prop uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() not in ('client','cleans'),false) and private.has_workspace_module('guest-communication')
  and (prop is null or private.workspace_can_property(prop,'guest-communication'));
$$;
create or replace function private.guest_thread_json(t private.workspace_guest_threads) returns jsonb language sql stable security definer set search_path='' as $$
 with msgs as (select m.direction,m.body,m.sent_at,m.id from private.workspace_guest_messages m where m.source=t.source and m.thread_ref=t.thread_ref),
 last as (select * from msgs order by sent_at desc,id desc limit 1),
 replied as (select max(sent_at) v from msgs where direction='team')
 select jsonb_build_object('id',t.id,'source',t.source,'channel',t.channel,'guestName',t.guest_name,'propertyId',t.property_id,
  'propertyName',(select p.name from public.workspace_properties p where p.id=t.property_id),'reservationRef',t.reservation_ref,
  'checkIn',t.check_in,'checkOut',t.check_out,'status',t.status,'lastMessageAt',t.last_message_at,
  'preview',(select left(coalesce(nullif(last.body,''),case last.direction when 'team' then 'Replied outside the app' else '' end),160) from last),
  'lastFrom',(select last.direction from last),
  'waitingSince',(select min(m.sent_at) from msgs m where m.direction='guest' and m.sent_at>coalesce((select v from replied),'-infinity'::timestamptz)),
  'messages',(select count(*) from msgs));
$$;

create or replace function private.workspace_guest_inbox_read(section text, target uuid default null, status_filter text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare th private.workspace_guest_threads;tg private.workspace_performance_targets;begin
 if not coalesce(private.workspace_actor_role() not in ('client','cleans'),false) or not private.has_workspace_module('guest-communication') then
  raise exception 'Guest inbox access required' using errcode='42501';end if;
 tg:=(select x from private.workspace_performance_targets x where singleton);
 if section='list' then
  if coalesce(status_filter,'waiting') not in ('waiting','open','done','all') then raise exception 'Unknown filter' using errcode='22023';end if;
  return jsonb_build_object(
   'threads',coalesce((select jsonb_agg(j order by (j->>'waitingSince') is null,(j->>'waitingSince'),(j->>'lastMessageAt') desc nulls last) from (
     select private.guest_thread_json(t) j,t.status from private.workspace_guest_threads t where private.guest_inbox_can(t.property_id)
      and (coalesce(status_filter,'waiting')='all' or (status_filter='done' and t.status='done') or (coalesce(status_filter,'waiting') in ('open','waiting') and t.status='open'))
      order by t.last_message_at desc nulls last limit 300) x
     where coalesce(status_filter,'waiting')<>'waiting' or (x.j->>'waitingSince') is not null),'[]'),
   'waiting',(select count(*) from private.workspace_guest_threads t where t.status='open' and private.guest_inbox_can(t.property_id) and (private.guest_thread_json(t)->>'waitingSince') is not null),
   'targets',jsonb_build_object('greenMinutes',tg.green_minutes,'amberMinutes',tg.amber_minutes),
   'connected',exists(select 1 from private.workspace_guest_threads t where t.source<>'manual'));
 elsif section='thread' then
  th:=(select x from private.workspace_guest_threads x where x.id=target);
  if th.id is null or not private.guest_inbox_can(th.property_id) then raise exception 'Conversation not found' using errcode='P0002';end if;
  return jsonb_build_object('thread',private.guest_thread_json(th),
   'targets',jsonb_build_object('greenMinutes',tg.green_minutes,'amberMinutes',tg.amber_minutes),
   'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',m.body,'sentAt',m.sent_at,'delivery',m.delivery,
     'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id)) order by m.sent_at,m.id)
    from (select * from private.workspace_guest_messages g where g.source=th.source and g.thread_ref=th.thread_ref order by g.sent_at desc,g.id desc limit 300) m),'[]'));
 end if;
 raise exception 'Unknown inbox section' using errcode='22023';
end $$;

create or replace function private.workspace_guest_inbox_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();a text:=input->>'action';req uuid;th private.workspace_guest_threads;prop uuid;at timestamptz;body text;latest_guest timestamptz;begin
 if not coalesce(private.workspace_actor_role() not in ('client','cleans'),false) or not private.has_workspace_module('guest-communication') then
  raise exception 'Guest inbox access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if input->>'threadId' is not null then
  th:=(select x from private.workspace_guest_threads x where x.id=(input->>'threadId')::uuid for update);
  if th.id is null or not private.guest_inbox_can(th.property_id) then raise exception 'Conversation not found' using errcode='P0002';end if;
 end if;
 if a in ('logMessage','reply') then
  at:=coalesce((input->>'sentAt')::timestamptz,now());
  if at>now()+interval '5 minutes' or at<now()-interval '14 days' then raise exception 'Choose a time in the last 14 days' using errcode='22023';end if;
  body:=trim(coalesce(input->>'body',''));
  if char_length(body)>5000 then raise exception 'Keep messages under 5,000 characters' using errcode='22023';end if;
 end if;
 if a='logMessage' then
  -- A guest message received outside Recharge (until the channel manager brings them in).
  perform private.workspace_json_keys(input,array['action','requestId','threadId','propertyId','channel','guestName','reservationRef','body','sentAt']);
  if body='' then raise exception 'Add the guest’s message' using errcode='22023';end if;
  if th.id is null then
   prop:=(input->>'propertyId')::uuid;
   if prop is not null and not private.guest_inbox_can(prop) then raise exception 'Property not found' using errcode='42501';end if;
   if coalesce(input->>'channel','') not in ('airbnb','booking_com','vrbo','direct','whatsapp','email','other') then raise exception 'Choose where the message came from' using errcode='22023';end if;
   if char_length(trim(coalesce(input->>'guestName',''))) not between 1 and 120 then raise exception 'Add the guest’s name' using errcode='22023';end if;
   if char_length(coalesce(input->>'reservationRef',''))>100 then raise exception 'Keep the booking reference short' using errcode='22023';end if;
   insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,reservation_ref,created_by,last_message_at)
    values('manual','manual:'||req,prop,input->>'channel',trim(input->>'guestName'),nullif(trim(coalesce(input->>'reservationRef','')),''),me,at)
    on conflict(source,thread_ref) do nothing;
   th:=(select x from private.workspace_guest_threads x where x.source='manual' and x.thread_ref='manual:'||req);
  end if;
  insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
   values(th.source,'app:'||req,th.thread_ref,th.property_id,th.channel,'guest',at,null,body,null) on conflict(source,external_id) do nothing;
  update private.workspace_guest_threads set status='open',last_message_at=greatest(coalesce(last_message_at,at),at) where id=th.id;
 elsif a='reply' then
  -- The team's reply. Until the channel manager is connected the reply is recorded here and sent
  -- on the platform by hand ("logged"); an empty reply records one sent outside the app.
  perform private.workspace_json_keys(input,array['action','requestId','threadId','body','sentAt']);
  if th.id is null then raise exception 'Choose a conversation' using errcode='22023';end if;
  latest_guest:=(select max(g.sent_at) from private.workspace_guest_messages g where g.source=th.source and g.thread_ref=th.thread_ref and g.direction='guest');
  if latest_guest is not null and at<latest_guest then raise exception 'The reply can’t be before the guest’s message' using errcode='22023';end if;
  insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
   values(th.source,'app:'||req,th.thread_ref,th.property_id,th.channel,'team',at,me,nullif(body,''),'logged') on conflict(source,external_id) do nothing;
  update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,at),at) where id=th.id;
 elsif a='setStatus' then
  perform private.workspace_json_keys(input,array['action','requestId','threadId','status']);
  if th.id is null or coalesce(input->>'status','') not in ('open','done') then raise exception 'Choose a conversation' using errcode='22023';end if;
  update private.workspace_guest_threads set status=input->>'status' where id=th.id;
 elsif a='editThread' then
  -- Match a conversation to its property and guest (for example one the channel manager couldn't match).
  perform private.workspace_json_keys(input,array['action','requestId','threadId','propertyId','guestName','reservationRef']);
  if th.id is null then raise exception 'Choose a conversation' using errcode='22023';end if;
  prop:=(input->>'propertyId')::uuid;
  if prop is not null and not private.guest_inbox_can(prop) then raise exception 'Property not found' using errcode='42501';end if;
  if char_length(trim(coalesce(input->>'guestName',''))) not between 1 and 120 or char_length(coalesce(input->>'reservationRef',''))>100 then raise exception 'Check the guest details' using errcode='22023';end if;
  update private.workspace_guest_threads set property_id=prop,guest_name=trim(input->>'guestName'),reservation_ref=nullif(trim(coalesce(input->>'reservationRef','')),'') where id=th.id;
  update private.workspace_guest_messages set property_id=prop where source=th.source and thread_ref=th.thread_ref;
 else raise exception 'Unknown inbox action' using errcode='22023';end if;
 return private.guest_thread_json((select x from private.workspace_guest_threads x where x.id=th.id));
end $$;

-- The channel manager's feed: messages with their text and guest, grouped into threads.
create or replace function private.workspace_guest_messages_ingest(input jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare added integer;src text;begin
 if jsonb_typeof(input->'messages') is distinct from 'array' or jsonb_array_length(input->'messages')>2000 then raise exception 'Invalid messages' using errcode='22023';end if;
 src:=private.workspace_required_text(input,'source',1,40);
 if src='manual' then raise exception 'Reserved source' using errcode='22023';end if;
 insert into private.workspace_guest_threads as t(source,thread_ref,property_id,channel,guest_name,reservation_ref,check_in,check_out,last_message_at)
  -- Details can come on any message in the batch (often only the guest's), so take the first given.
  select src,m->>'threadRef',(array_agg((m->>'propertyId')::uuid) filter(where m->>'propertyId' is not null))[1],
   coalesce((array_agg(m->>'channel') filter(where m->>'channel' is not null))[1],'other'),
   (array_agg(nullif(left(trim(m->>'guestName'),120),'')) filter(where nullif(trim(m->>'guestName'),'') is not null))[1],
   (array_agg(left(m->>'reservationRef',100)) filter(where nullif(m->>'reservationRef','') is not null))[1],
   (array_agg((m->>'checkIn')::date) filter(where m->>'checkIn' is not null))[1],(array_agg((m->>'checkOut')::date) filter(where m->>'checkOut' is not null))[1],
   max((m->>'sentAt')::timestamptz)
  from jsonb_array_elements(input->'messages') m group by m->>'threadRef'
 on conflict(source,thread_ref) do update set last_message_at=greatest(t.last_message_at,excluded.last_message_at),
  property_id=coalesce(t.property_id,excluded.property_id),guest_name=coalesce(excluded.guest_name,t.guest_name),
  reservation_ref=coalesce(excluded.reservation_ref,t.reservation_ref),check_in=coalesce(excluded.check_in,t.check_in),check_out=coalesce(excluded.check_out,t.check_out);
 insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
  select src,m->>'externalId',m->>'threadRef',(m->>'propertyId')::uuid,coalesce(m->>'channel','other'),m->>'direction',(m->>'sentAt')::timestamptz,(m->>'authorUserId')::uuid,
   nullif(left(coalesce(m->>'body',''),5000),''),case when m->>'direction'='team' then 'sent' end
  from jsonb_array_elements(input->'messages') m on conflict do nothing;
 get diagnostics added=row_count;
 -- A new guest message reopens its conversation.
 update private.workspace_guest_threads t set status='open' where t.source=src and t.status='done'
  and exists(select 1 from jsonb_array_elements(input->'messages') m where m->>'threadRef'=t.thread_ref and m->>'direction'='guest' and (m->>'sentAt')::timestamptz>=coalesce(t.last_message_at,'-infinity'::timestamptz));
 return jsonb_build_object('added',added);
end $function$;

create or replace function public.workspace_guest_inbox_read(section text, target uuid default null, status_filter text default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_guest_inbox_read(section,target,status_filter);$$;
create or replace function public.workspace_guest_inbox_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_guest_inbox_action(input);$$;
revoke all on function private.guest_inbox_can(uuid),private.guest_thread_json(private.workspace_guest_threads) from public,anon,authenticated;
revoke all on function private.workspace_guest_inbox_read(text,uuid,text),private.workspace_guest_inbox_action(jsonb),
 public.workspace_guest_inbox_read(text,uuid,text),public.workspace_guest_inbox_action(jsonb) from public,anon;
grant execute on function private.workspace_guest_inbox_read(text,uuid,text),private.workspace_guest_inbox_action(jsonb),
 public.workspace_guest_inbox_read(text,uuid,text),public.workspace_guest_inbox_action(jsonb) to authenticated;
