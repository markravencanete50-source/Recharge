-- Changeovers (Business Plan, updated 17/10/26, Property Operations Processes, Changeovers): what the housekeeper's guest
-- readiness checklist adds to the clean form.
--  * Replenishable stock control. Each property should always hold a minimum of each stock item (the plan: 12 toilet rolls,
--    12 kitchen rolls, 2 x 5 l bottles each of body wash, shampoo, hand wash and washing-up liquid, 12 x 2 l Irn-Bru, 5 surface
--    cleaners, 24 cloths). The list and the minimums are a setting admins edit (private.workspace_changeover_settings).
--    Each property's stock on hand is kept per item (private.workspace_property_stock): the team, or the housekeeper on
--    their clean, counts it; each changeover the housekeeper records what was used (private.workspace_clean_stock_use, one
--    record per clean, which they can correct until the clean is reviewed) and it comes off the count. When a counted item
--    falls below its minimum a Restock request is opened for the property (the Replenishment Requests tracker, the
--    team's place for ordering supplies), one open request per item. An item never counted at a property is not alerted.
--  * Late forms: the form must be sent by 14:45 on the day of the clean, otherwise it is late, and that is what
--    "cleaning forms on time" now measures (private.workspace_clean_form_on_time, replaced). The time is a setting
--    (lateAfter). The 18:00 reminder and the 09:00 management flag are unchanged.
--  * Inventory and condition crosses: before reporting a new problem the housekeeper sees the open repairs at the
--    property and can add to one instead ("still an issue", or anything new), which is kept on the repair
--    (data.housekeeperNotesBy, a key ending in By so owners never get it) and tells admins and whoever the repair is with.
--  * Rejected cleans redone by the same housekeeper are already paid at half the rate (Partially successful,
--    20261022050000), and a clean can already be reassigned: nothing changes there.
-- New: tables private.workspace_changeover_settings, private.workspace_property_stock, private.workspace_clean_stock_use;
--   functions private.workspace_changeover_settings_default, private.workspace_changeover_settings,
--   private.workspace_clean_form_late_time, private.workspace_changeover_clean, private.workspace_changeover_stock,
--   private.workspace_changeover_restock, private.workspace_changeover_read and private.workspace_changeover_action (and
--   public wrappers for the last two).
-- Replaces private.workspace_clean_form_on_time (20261015120000). Patched by anchor: private.workspace_teams_action (the
--   changeover actions go through the team route).
-- No DROP, no DELETE of anyone's data (a correction replaces the clean's own stock record). Safe to run twice.

create table if not exists private.workspace_changeover_settings (
 singleton boolean primary key default true check(singleton),
 settings jsonb not null check(jsonb_typeof(settings)='object'),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_changeover_settings_updater_idx on private.workspace_changeover_settings(updated_by);
alter table private.workspace_changeover_settings enable row level security;

create table if not exists private.workspace_property_stock (
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 item_key text not null check(item_key ~ '^[a-z0-9_]{1,40}$'),
 on_hand integer not null check(on_hand between 0 and 100000),
 counted_by uuid references public.workspace_profiles(user_id),
 counted_at timestamptz not null default now(),
 restock_work_id uuid references public.workspace_work_items(id) on delete set null,
 updated_at timestamptz not null default now(),
 primary key(property_id,item_key)
);
create index if not exists workspace_property_stock_counter_idx on private.workspace_property_stock(counted_by);
create index if not exists workspace_property_stock_restock_idx on private.workspace_property_stock(restock_work_id);
alter table private.workspace_property_stock enable row level security;

create table if not exists private.workspace_clean_stock_use (
 work_id uuid not null references public.workspace_work_items(id) on delete cascade,
 item_key text not null check(item_key ~ '^[a-z0-9_]{1,40}$'),
 used integer not null check(used between 1 and 1000),
 recorded_by uuid references public.workspace_profiles(user_id),
 recorded_at timestamptz not null default now(),
 primary key(work_id,item_key)
);
create index if not exists workspace_clean_stock_use_recorder_idx on private.workspace_clean_stock_use(recorded_by);
alter table private.workspace_clean_stock_use enable row level security;

create or replace function private.workspace_changeover_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select '{"lateAfter":"14:45","stock":[
  {"key":"toilet_roll","label":"Toilet rolls","minimum":12},
  {"key":"kitchen_roll","label":"Kitchen rolls","minimum":12},
  {"key":"body_wash","label":"Body wash, 5 l bottles","minimum":2},
  {"key":"shampoo","label":"Shampoo, 5 l bottles","minimum":2},
  {"key":"hand_wash","label":"Hand wash, 5 l bottles","minimum":2},
  {"key":"washing_up","label":"Washing-up liquid, 5 l bottles","minimum":2},
  {"key":"irn_bru","label":"Irn-Bru, 2 l bottles","minimum":12},
  {"key":"surface_cleaner","label":"Surface cleaners","minimum":5},
  {"key":"cloths","label":"Cloths","minimum":24}
 ]}'::jsonb
$fn$;
create or replace function private.workspace_changeover_settings() returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce((select s.settings from private.workspace_changeover_settings s where s.singleton),private.workspace_changeover_settings_default())
$fn$;
-- The time of day after which a clean form is late (London).
create or replace function private.workspace_clean_form_late_time() returns time language plpgsql stable security definer set search_path='' as $fn$
begin
 return (private.workspace_changeover_settings()->>'lateAfter')::time;
exception when others then return time '14:45';
end $fn$;

-- On time: sent by the late time (14:45 London) on the clean's day when the stamp is there; otherwise the reminder rule.
create or replace function private.workspace_clean_form_on_time(item jsonb,clean_day date) returns boolean language plpgsql stable set search_path='' as $fn$
begin
 if not private.workspace_clean_form_in(item) then return false;end if;
 if jsonb_typeof(item->'submittedAt')='string' then
  return clean_day is not null and ((item->>'submittedAt')::timestamptz at time zone private.workspace_clean_form_zone())<=(clean_day::timestamp+private.workspace_clean_form_late_time());
 end if;
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
exception when others then
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
end $fn$;

-- The clean when the caller is its housekeeper and it is still theirs to change (to do, or waiting for review).
create or replace function private.workspace_changeover_clean(target uuid) returns public.workspace_work_items language sql stable security definer set search_path='' as $fn$
 select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id and d.kind='cleaning'
 where w.id=target and w.assignee_id=auth.uid() and private.workspace_actor_role()='cleans'
  and w.status not in ('completed','cancelled','declined') and coalesce(d.data->>'phase','assigned') in ('assigned','review')
$fn$;

-- A property's stock against the list: each item with its minimum, the count (null when never counted) and whether it is low.
create or replace function private.workspace_changeover_stock(prop uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('key',i->>'key','label',i->>'label','minimum',(i->>'minimum')::int,'onHand',s.on_hand,'countedAt',s.counted_at,
   'countedByName',p.full_name,'low',s.on_hand is not null and s.on_hand<(i->>'minimum')::int,
   'restockOpen',exists(select 1 from public.workspace_work_items r where r.id=s.restock_work_id and r.status not in ('completed','cancelled','declined'))) order by n),'[]')
 from jsonb_array_elements(private.workspace_changeover_settings()->'stock') with ordinality x(i,n)
 left join private.workspace_property_stock s on s.property_id=prop and s.item_key=i->>'key'
 left join public.workspace_profiles p on p.user_id=s.counted_by
$fn$;

-- Opens a Restock request for each counted item below its minimum that has no open one.
create or replace function private.workspace_changeover_restock(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare i jsonb;s private.workspace_property_stock;w uuid;ev bigint;begin
 for i in select x from jsonb_array_elements(private.workspace_changeover_settings()->'stock') x loop
  select * into s from private.workspace_property_stock y where y.property_id=prop and y.item_key=i->>'key' for update;
  continue when s.property_id is null or s.on_hand>=(i->>'minimum')::int;
  continue when exists(select 1 from public.workspace_work_items r where r.id=s.restock_work_id and r.status not in ('completed','cancelled','declined'));
  insert into public.workspace_work_items(request_id,property_id,module_id,title,description,created_by,client_visible)
   values(gen_random_uuid(),prop,'replenishment-requests',left('Restock: '||(i->>'label'),200),
    left(format('%s left, the minimum is %s. Order more for this property.',s.on_hand,i->>'minimum'),10000),auth.uid(),false) returning id into w;
  update private.workspace_property_stock y set restock_work_id=w where y.property_id=prop and y.item_key=i->>'key';
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'cleaning.stock_low') returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,ev from public.workspace_profiles p where p.status='active' and p.user_id is distinct from auth.uid()
    and (p.role in ('admin','super_admin') or (p.role='cleaning_manager' and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='replenishment-requests')))
   on conflict do nothing;
 end loop;
end $fn$;

-- What the clean form and the property's stock card show. With a clean: its housekeeper, or the team who can see it; the
-- stock, what this clean used, and the open repairs at the property. With a property: the team only, its stock.
create or replace function private.workspace_changeover_read(target_work uuid,target_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();w public.workspace_work_items;prop uuid;keeper boolean:=false;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501';end if;
 if target_work is not null then
  w:=private.workspace_changeover_clean(target_work);
  keeper:=w.id is not null;
  if not keeper then
   select * into w from public.workspace_work_items x where x.id=target_work;
   if w.id is null or actor in ('client','cleans') or not private.workspace_can_work(w.id) then raise exception 'Clean not found' using errcode='42501';end if;
  end if;
  prop:=w.property_id;
 else
  if target_property is null or actor in ('client','cleans') or not private.workspace_can_property(target_property,'cleaning-schedule') then raise exception 'Property not found' using errcode='42501';end if;
  prop:=target_property;
 end if;
 return jsonb_build_object('lateAfter',to_char(private.workspace_clean_form_late_time(),'HH24:MI'),
  'canEditSettings',actor in ('admin','super_admin'),'settings',case when actor in ('admin','super_admin') then private.workspace_changeover_settings() end,
  'canCount',keeper or actor not in ('client','cleans'),'stock',private.workspace_changeover_stock(prop),
  'used',case when target_work is null then null else (select coalesce(jsonb_object_agg(u.item_key,u.used),'{}') from private.workspace_clean_stock_use u where u.work_id=w.id) end,
  'repairs',case when target_work is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('workId',r.id,'issue',left(coalesce(d.data->>'issue',r.title),500),
    'urgent',coalesce((d.data->>'urgent')::boolean,false),'reportedAt',r.created_at,'notes',jsonb_array_length(coalesce(d.data->'housekeeperNotesBy','[]'))) order by r.created_at desc,r.id),'[]')
   from (select * from public.workspace_work_items y where y.property_id=prop and y.status not in ('completed','cancelled','declined') order by y.created_at desc limit 40) r
   join private.workspace_domain_details d on d.work_id=r.id and d.kind='maintenance'
   where coalesce(d.data->>'phase','') not in ('closed','completed','resolved')) end);
end $fn$;

-- The changeover actions:
--   saveChangeoverSettings { requestId, settings: { lateAfter 'HH:MM', stock [{ key, label, minimum }] } }   admins
--   countStock     { requestId, workId | propertyId, counts { key: n } }                        the housekeeper on their clean, or the team
--   recordStockUse { requestId, workId, used { key: n } }                                       the housekeeper (or the team) on a clean
--   addRepairNote  { requestId, workId, repairId, note }                                        the housekeeper, on an open repair at the property
create or replace function private.workspace_changeover_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();me uuid:=auth.uid();a text:=input->>'action';req uuid;prior jsonb;result jsonb;
 w public.workspace_work_items;prop uuid;keeper boolean:=false;st jsonb;item jsonb;k text;n integer;keys text[];old integer;txt text;d jsonb;ev bigint;who text;
begin
 if actor is null or me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if a is null or a not in ('saveChangeoverSettings','countStock','recordStockUse','addRepairNote') then raise exception 'Unknown changeover action' using errcode='22023';end if;
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(me::text||req::text,0));
 select r.result into prior from private.workspace_action_receipts r where r.actor_id=me and r.request_id=req;
 if prior is not null then return prior;end if;
 st:=private.workspace_changeover_settings();
 keys:=array(select x->>'key' from jsonb_array_elements(st->'stock') x);

 if a='saveChangeoverSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings']);
  if actor not in ('admin','super_admin') then raise exception 'Only admins change the changeover settings' using errcode='42501';end if;
  d:=input->'settings';
  if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'stock') is distinct from 'array' or exists(select 1 from jsonb_object_keys(d) x where x not in ('lateAfter','stock')) then raise exception 'Invalid settings' using errcode='22023';end if;
  if coalesce(d->>'lateAfter','')!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Give the late time as HH:MM' using errcode='22023';end if;
  if jsonb_array_length(d->'stock') not between 1 and 40 then raise exception 'Keep between 1 and 40 stock items' using errcode='22023';end if;
  for item in select x from jsonb_array_elements(d->'stock') x loop
   if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) x where x not in ('key','label','minimum'))
    or coalesce(item->>'key','')!~'^[a-z0-9_]{1,40}$' or char_length(btrim(coalesce(item->>'label','')))not between 1 and 80
    or jsonb_typeof(item->'minimum') is distinct from 'number' or (item->>'minimum')!~'^\d+$' or (item->>'minimum')::int>1000 then
    raise exception 'Give every stock item a name and a minimum of 0 to 1,000' using errcode='22023';end if;
  end loop;
  if (select count(distinct x->>'key') from jsonb_array_elements(d->'stock') x)<>jsonb_array_length(d->'stock') then raise exception 'Invalid settings' using errcode='22023';end if;
  d:=jsonb_build_object('lateAfter',d->>'lateAfter','stock',(select jsonb_agg(jsonb_build_object('key',x->>'key','label',btrim(x->>'label'),'minimum',(x->>'minimum')::int) order by ord) from jsonb_array_elements(d->'stock') with ordinality y(x,ord)));
  insert into private.workspace_changeover_settings(singleton,settings,updated_by,updated_at) values(true,d,me,now())
   on conflict(singleton) do update set settings=excluded.settings,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  result:=jsonb_build_object('settings',d);
 else
  -- Which clean or property, and whether the caller is its housekeeper or on the team.
  if input ? 'workId' then
   if coalesce(input->>'workId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Clean not found' using errcode='42501';end if;
   w:=private.workspace_changeover_clean((input->>'workId')::uuid);
   keeper:=w.id is not null;
   if not keeper then
    select x.* into w from public.workspace_work_items x join private.workspace_domain_details dd on dd.work_id=x.id and dd.kind='cleaning' where x.id=(input->>'workId')::uuid;
    if w.id is null or actor in ('client','cleans') or not private.workspace_can_work(w.id) then raise exception 'Clean not found' using errcode='42501';end if;
   end if;
   prop:=w.property_id;
  elsif a='countStock' and coalesce(input->>'propertyId','')~'^[0-9a-fA-F-]{36}$' then
   prop:=(input->>'propertyId')::uuid;
   if actor in ('client','cleans') or not private.workspace_can_property(prop,'cleaning-schedule') then raise exception 'Property not found' using errcode='42501';end if;
  else raise exception 'Choose the clean' using errcode='22023';end if;

  if a in ('countStock','recordStockUse') then
   perform private.workspace_json_keys(input,array['action','requestId','workId','propertyId',case when a='countStock' then 'counts' else 'used' end]);
   d:=input->(case when a='countStock' then 'counts' else 'used' end);
   if jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid stock' using errcode='22023';end if;
   for k in select jsonb_object_keys(d) loop
    if not k=any(keys) then raise exception 'That stock item is not on the list' using errcode='22023';end if;
    if jsonb_typeof(d->k) is distinct from 'number' or (d->>k)!~'^\d+$' or (d->>k)::int>(case when a='countStock' then 100000 else 1000 end) then
     raise exception 'Give each amount as a whole number' using errcode='22023';end if;
   end loop;
   if a='countStock' then
    if d='{}'::jsonb then raise exception 'Count at least one item' using errcode='22023';end if;
    insert into private.workspace_property_stock as s(property_id,item_key,on_hand,counted_by,counted_at,updated_at)
     select prop,x.key,(x.value#>>'{}')::int,me,now(),now() from jsonb_each(d) x
     on conflict(property_id,item_key) do update set on_hand=excluded.on_hand,counted_by=excluded.counted_by,counted_at=excluded.counted_at,updated_at=excluded.updated_at;
   else
    if not keeper and actor in ('client','cleans') then raise exception 'Clean not found' using errcode='42501';end if;
    -- A correction: what this clean used before goes back on the count (unless the count was taken after it, so it
    -- already shows it), then the new amounts come off.
    for k,old in select u.item_key,u.used from private.workspace_clean_stock_use u where u.work_id=w.id loop
     update private.workspace_property_stock s set on_hand=least(100000,s.on_hand+old),updated_at=now()
      where s.property_id=prop and s.item_key=k and s.counted_at<=(select u.recorded_at from private.workspace_clean_stock_use u where u.work_id=w.id and u.item_key=k);
    end loop;
    delete from private.workspace_clean_stock_use u where u.work_id=w.id;
    insert into private.workspace_clean_stock_use(work_id,item_key,used,recorded_by) select w.id,x.key,(x.value#>>'{}')::int,me from jsonb_each(d) x where (x.value#>>'{}')::int>0;
    update private.workspace_property_stock s set on_hand=greatest(0,s.on_hand-u.used),updated_at=now()
     from private.workspace_clean_stock_use u where u.work_id=w.id and s.property_id=prop and s.item_key=u.item_key;
   end if;
   perform private.workspace_changeover_restock(prop);
   result:=jsonb_build_object('stock',private.workspace_changeover_stock(prop),
    'used',case when w.id is null then null else (select coalesce(jsonb_object_agg(u.item_key,u.used),'{}') from private.workspace_clean_stock_use u where u.work_id=w.id) end);
  else
   perform private.workspace_json_keys(input,array['action','requestId','workId','repairId','note']);
   if not keeper then raise exception 'Only the housekeeper on this clean adds to a repair from it' using errcode='42501';end if;
   txt:=private.workspace_required_text(input,'note',3,1000);
   if coalesce(input->>'repairId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Repair not found' using errcode='P0002';end if;
   select dd.data into d from public.workspace_work_items r join private.workspace_domain_details dd on dd.work_id=r.id and dd.kind='maintenance'
    where r.id=(input->>'repairId')::uuid and r.property_id=prop and r.status not in ('completed','cancelled','declined') and coalesce(dd.data->>'phase','') not in ('closed','completed','resolved') for update of dd;
   if d is null then raise exception 'That repair is closed or not at this property' using errcode='P0002';end if;
   if jsonb_array_length(coalesce(d->'housekeeperNotesBy','[]'))>=50 then raise exception 'This repair has 50 notes already. Tell the team directly' using errcode='22023';end if;
   select coalesce(nullif(btrim(p.full_name),''),'Housekeeper') into who from public.workspace_profiles p where p.user_id=me;
   update private.workspace_domain_details dd set data=jsonb_set(dd.data,'{housekeeperNotesBy}',coalesce(dd.data->'housekeeperNotesBy','[]')||jsonb_build_array(jsonb_build_object(
     'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'userId',me,'name',who,'note',txt,'cleanWorkId',w.id)))
    where dd.work_id=(input->>'repairId')::uuid and dd.kind='maintenance';
   insert into public.workspace_activity(actor_id,property_id,event_type) values(me,prop,'maintenance.housekeeper_note') returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,ev from public.workspace_profiles p join public.workspace_work_items r on r.id=(input->>'repairId')::uuid
    where p.status='active' and p.user_id is distinct from me and (p.role in ('admin','super_admin') or p.user_id=r.assignee_id)
    on conflict do nothing;
   result:=jsonb_build_object('repairId',input->>'repairId','notes',jsonb_array_length(coalesce(d->'housekeeperNotesBy','[]'))+1);
  end if;
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

create or replace function public.workspace_changeover_read(target_work uuid,target_property uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_changeover_read(target_work,target_property);$$;
create or replace function public.workspace_changeover_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_changeover_action(input);$$;

revoke all on function private.workspace_changeover_settings_default(),private.workspace_changeover_settings(),private.workspace_clean_form_late_time(),
 private.workspace_changeover_clean(uuid),private.workspace_changeover_stock(uuid),private.workspace_changeover_restock(uuid) from public,anon,authenticated,service_role;
revoke all on function private.workspace_changeover_read(uuid,uuid),public.workspace_changeover_read(uuid,uuid),
 private.workspace_changeover_action(jsonb),public.workspace_changeover_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_changeover_read(uuid,uuid),public.workspace_changeover_read(uuid,uuid),
 private.workspace_changeover_action(jsonb),public.workspace_changeover_action(jsonb) to authenticated;

do $patch$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$/* lead actions: 20261025300000 */ then return private.workspace_lead_action(input);end if;$q$,
   $q$/* lead actions: 20261025300000 */ then return private.workspace_lead_action(input);end if;
 if a in ('saveChangeoverSettings','countStock','recordStockUse','addRepairNote')/* changeover actions: 20261031200000 */ then return private.workspace_changeover_action(input);end if;$q$,
   $q$/* changeover actions: 20261031200000 */$q$]
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
