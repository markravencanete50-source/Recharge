-- Fixes from the end-to-end sweep.

-- Display names. Anyone signed in can change their own sign-in metadata, so the name in it is
-- copied to the profile only while the profile is still waiting for access (registration) or has
-- no name yet. After that, names change only through Access control, so nobody can rename
-- themselves to look like a manager. Control and direction-changing characters are never copied.
create or replace function private.workspace_sync_appearance() returns trigger language plpgsql security definer set search_path='' as $$
declare display text; avatar text;
begin
  display:=trim(regexp_replace(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),'[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]','','g'));
  avatar:=new.raw_user_meta_data->>'avatar_preset';
  update public.workspace_profiles set full_name=case when (status='pending' or full_name='') and length(display) between 2 and 120 then display else full_name end,
    avatar_preset=case when avatar in ('forest','sage','ocean','plum','clay','slate') then avatar else avatar_preset end
    where user_id=new.id;
  return new;
end $$;
revoke all on function private.workspace_sync_appearance() from public,anon,authenticated;

-- Web push: only the browsers' own push services (Chrome/Edge/Android, Firefox, Windows, Safari),
-- so a subscription can never point the backend at a server of someone's choosing.
create or replace function private.workspace_push_endpoint_ok(endpoint text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(endpoint,'') ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com|web\.push\.apple\.com)/'
$$;
revoke all on function private.workspace_push_endpoint_ok(text) from public,anon,authenticated;

-- Hub: an item is hidden unless a rule clearly allows it (a missing department or assignee used
-- to count as "allowed", so anyone could move a to-do for another department).
create or replace function private.workspace_hub_can_see(item private.workspace_hub_items) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin') or case item.kind
  when 'todo' then item.assignee_id=auth.uid() or item.created_by=auth.uid() or (item.department is not null and item.department=private.workspace_my_department())
  when 'approval' then item.created_by=auth.uid()
  else private.workspace_hub_keeps(item.kind) end, false)
$$;

-- Long contracts and training courses: the database allows 50,000 and 100,000 characters, but
-- the general 16 KB input cap refused anything past about 15,000.
create or replace function private.workspace_json_keys(input jsonb, allowed text[], max_bytes integer) returns void language plpgsql set search_path='' as $$
begin
 if input is null or jsonb_typeof(input)<>'object' or octet_length(input::text)>least(coalesce(max_bytes,16384),450000) or exists(select 1 from jsonb_object_keys(input) k where not(k=any(allowed))) then
   raise exception 'Unknown or oversized workflow input' using errcode='22023';
 end if;
end $$;
revoke all on function private.workspace_json_keys(jsonb,text[],integer) from public,anon,authenticated;

do $$
declare
 fixes text[][] := array[
  ['private.workspace_web_push_subscribe(jsonb)',
   $q$if coalesce(input->>'endpoint','') !~ '^https://' or$q$,
   $q$if not private.workspace_push_endpoint_ok(input->>'endpoint') or$q$,
   $q$private.workspace_push_endpoint_ok($q$],
  -- Hostaway: a checkout clean someone cancelled by hand stays cancelled. Before, the next sync
  -- found no open clean for the stay and made a new one every time.
  ['private.workspace_hostaway_sync(jsonb)',
   $q$if found then select * into detail from private.workspace_domain_details where work_id=clean.id;end if;$q$,
   $q$if found then select * into detail from private.workspace_domain_details where work_id=clean.id;end if;
   -- A clean someone cancelled by hand is left alone; one the sync cancelled comes back if the stay does.
   if clean.status='cancelled' and not coalesce(detail.data ? 'cancelledBecause',false) then clean:=null;detail:=null;continue;end if;
   if clean.status='cancelled' then clean:=null;detail:=null;end if;$q$,
   $q$A clean someone cancelled by hand is left alone$q$],
  ['private.workspace_hostaway_sync(jsonb)',
   $q$and d.data->>'reservationId'=res.id::text and w.status<>'cancelled' order by w.created_at desc limit 1;$q$,
   $q$and d.data->>'reservationId'=res.id::text order by w.created_at desc limit 1;$q$,
   $q$and d.data->>'reservationId'=res.id::text order by w.created_at desc limit 1;$q$],
  -- Hostaway: two confirmed stays ending the same day at one property (a double booking) need one
  -- clean, not two. The overlap is still reported; if the stay with the clean is cancelled, the
  -- next sync makes the other stay's clean.
  ['private.workspace_hostaway_sync(jsonb)',
   $q$if res.check_out>=current_date then$q$,
   $q$if res.check_out>=current_date and not exists(select 1 from public.workspace_work_items o join private.workspace_domain_details od on od.work_id=o.id
       where od.kind='cleaning' and o.property_id=res.property_id and o.due_on=res.check_out and o.status not in ('cancelled','declined')
         and od.data->>'source'='hostaway' and od.data->>'reservationId'<>res.id::text) then$q$,
   $q$od.data->>'reservationId'<>res.id::text$q$],
  -- Training "for everyone" means every team member, never owners (they could read courses and
  -- download course files).
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'all'=any(c.audience) or actor=any(c.audience)$q$,
   $q$('all'=any(c.audience) and actor<>'client') or actor=any(c.audience)$q$,
   $q$'all'=any(c.audience) and actor<>'client'$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$'all'=any(c.audience) or actor=any(c.audience)$q$,
   $q$('all'=any(c.audience) and actor<>'client') or actor=any(c.audience)$q$,
   $q$'all'=any(c.audience) and actor<>'client'$q$],
  ['private.workspace_course_visible(uuid)',
   $q$('all'=any(c.audience) or private.workspace_actor_role()=any(c.audience))$q$,
   $q$(('all'=any(c.audience) and private.workspace_actor_role()<>'client') or private.workspace_actor_role()=any(c.audience))$q$,
   $q$private.workspace_actor_role()<>'client'$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$'published','redoRequired']);$q$,
   $q$'published','redoRequired'],450000);$q$,
   $q$'published','redoRequired'],450000);$q$],
  ['private.workspace_onboarding_action(jsonb)',
   $q$'body','active','resignRequired']);$q$,
   $q$'body','active','resignRequired'],450000);$q$,
   $q$'body','active','resignRequired'],450000);$q$],
  -- "Download my data": statements and payout details only for properties the person owns now, not
  -- ones they once started onboarding for and that have since passed to another owner.
  ['private.workspace_privacy_read(text)',
   $q$from private.workspace_owner_statements s where s.property_id=any(owned) and$q$,
   $q$from private.workspace_owner_statements s where s.property_id in (select a.property_id from public.workspace_property_assignments a where a.user_id=me and a.assignment='client') and$q$,
   $q$s.property_id in (select a.property_id from public.workspace_property_assignments a where a.user_id=me$q$],
  ['private.workspace_privacy_read(text)',
   $q$from private.workspace_bank_details b where b.property_id=j.property_id),$q$,
   $q$from private.workspace_bank_details b where b.property_id=j.property_id
        and not exists(select 1 from public.workspace_property_assignments o where o.property_id=j.property_id and o.assignment='client' and o.user_id<>me)),$q$,
   $q$o.assignment='client' and o.user_id<>me$q$],
  -- Invoice and handover tasks close only through their own action (with evidence); the general
  -- status change let anyone with access walk one to "completed" (and mark its repair paid).
  ['private.workspace_transition_work(uuid,integer,text,text,uuid)',
   $q$select * into item from public.workspace_work_items where id=target_work for update;$q$,
   $q$select * into item from public.workspace_work_items where id=target_work for update;
  if exists(select 1 from private.workspace_domain_details d where d.work_id=target_work and d.kind in ('cleaning_setup','garden_setup','furnishing_quote','relisting','onboarding_invoice','direct_booking_invoice','maintenance_invoice','cleaning_invoice')) then
    raise exception 'Use the workflow action' using errcode='42501';
  end if;$q$,
   $q$raise exception 'Use the workflow action'$q$],
  -- Owner chats: a leftover rota row never lets an owner (or a cleaner) into another owner's chat.
  ['private.chat_owner_team(uuid,uuid)',
   $q$and p.role<>'cleans')$q$,
   $q$and p.role not in ('cleans','client'))$q$,
   $q$and p.role not in ('cleans','client'))$q$],
  -- A journey the team started has no owner yet; its questions then read as not asked by the owner
  -- (null broke the whole onboarding list).
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'askedByOwner',q.asked_by=j.client_id$q$,
   $q$'askedByOwner',coalesce(q.asked_by=j.client_id,false)$q$,
   $q$coalesce(q.asked_by=j.client_id,false)$q$]
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
