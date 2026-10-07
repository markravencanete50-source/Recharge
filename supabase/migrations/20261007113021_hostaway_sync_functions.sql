-- Hostaway sync, part 2: the service-role-only sync function, failure recording, and the
-- status read for admins and the Stays team. Part 1 (tables) is 20261007113020_hostaway_sync_tables.sql.

create function private.workspace_hostaway_sync(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 l jsonb; r jsonb; prop uuid; prev private.workspace_reservations; res private.workspace_reservations;
 clean public.workspace_work_items; detail private.workspace_domain_details; work uuid; found_prev boolean;
 v_status text; v_channel text; v_reference text; v_guests integer; v_payout bigint; v_in date; v_out date; v_name text;
 touched uuid[]:='{}'; issues jsonb:='[]'; created_properties integer:=0; linked_properties integer:=0;
 new_reservations integer:=0; changed_reservations integer:=0; new_cleans integer:=0; moved_cleans integer:=0; cancelled_cleans integer:=0;
 trigger_name text:=input->>'trigger'; summary jsonb;
 checklist constant jsonb:='["Strip the beds and remake them with fresh linen","Clean and restock the kitchen","Clean the bathrooms and replace the towels","Vacuum and mop every floor","Empty every bin","Restock guest essentials","Check for damage or missing items and report it"]';
begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('trigger','listings','reservations')) then raise exception 'Invalid sync input' using errcode='22023';end if;
 if trigger_name is null or trigger_name not in ('schedule','webhook','manual') then raise exception 'Invalid sync trigger' using errcode='22023';end if;
 if jsonb_typeof(coalesce(input->'listings','[]'))<>'array' or jsonb_typeof(coalesce(input->'reservations','[]'))<>'array'
  or jsonb_array_length(coalesce(input->'listings','[]'))>1000 or jsonb_array_length(coalesce(input->'reservations','[]'))>5000 then raise exception 'Invalid sync batch' using errcode='22023';end if;
 -- One sync at a time.
 perform pg_advisory_xact_lock(hashtextextended('hostaway-sync',0));

 -- Listings: link a listing to the property with the same name if one is unlinked, else create it.
 for l in select value from jsonb_array_elements(coalesce(input->'listings','[]')) loop
  begin
   if coalesce(l->>'id','')='' or length(l->>'id')>100 then raise exception 'Listing without an id';end if;
   v_name:=left(trim(coalesce(l->>'name','')),200);
   if length(v_name)<2 then v_name:='Hostaway listing '||(l->>'id');end if;
   select id into prop from public.workspace_properties where hostaway_listing_id=l->>'id';
   if not found then
    select id into prop from public.workspace_properties where hostaway_listing_id is null and status<>'archived' and lower(trim(name))=lower(v_name) order by created_at limit 1;
    if found then
     update public.workspace_properties set hostaway_listing_id=l->>'id',version=version+1,updated_at=now() where id=prop;
     linked_properties:=linked_properties+1;
    else
     insert into public.workspace_properties(name,address,bedrooms,status,created_by,request_id,hostaway_listing_id)
     values(v_name,left(coalesce(l->>'address',''),1000),least(greatest(coalesce((l->>'bedrooms')::integer,0),0),100),'active',null,gen_random_uuid(),l->>'id')
     returning id into prop;
     if length(trim(coalesce(l->>'accessInfo','')))>0 then
      insert into private.workspace_property_secrets(property_id,access_instructions) values(prop,left(l->>'accessInfo',5000)) on conflict(property_id) do nothing;
     end if;
     created_properties:=created_properties+1;
    end if;
   end if;
  exception when others then issues:=issues||jsonb_build_object('listingId',l->>'id','problem',left(sqlerrm,200));
  end;
 end loop;

 -- Reservations, then each one's checkout clean.
 for r in select value from jsonb_array_elements(coalesce(input->'reservations','[]')) loop
  begin
   select id into prop from public.workspace_properties where hostaway_listing_id=r->>'listingId';
   if not found then raise exception 'Listing % is not in Recharge yet',r->>'listingId';end if;
   if coalesce(r->>'id','')='' or length(r->>'id')>100 then raise exception 'Reservation without an id';end if;
   v_status:=r->>'status';v_channel:=r->>'channel';v_in:=(r->>'checkIn')::date;v_out:=(r->>'checkOut')::date;
   if v_status is null or v_status not in ('confirmed','enquiry','cancelled') then raise exception 'Unknown status';end if;
   if v_channel is null or v_channel not in ('airbnb','booking_com','vrbo','direct','other') then raise exception 'Unknown channel';end if;
   if v_in is null or v_out is null or v_out<=v_in or v_out-v_in>365 then raise exception 'Invalid dates';end if;
   v_reference:=nullif(left(trim(coalesce(r->>'channelReference','')),120),'');
   v_guests:=case when (r->>'guests')::integer between 1 and 50 then (r->>'guests')::integer end;
   v_payout:=case when (r->>'payoutMinor')::bigint between 0 and 100000000 then (r->>'payoutMinor')::bigint end;

   select * into prev from private.workspace_reservations where reference='HA:'||(r->>'id') and source='hostaway' for update;
   found_prev:=found;
   if not found_prev and exists(select 1 from private.workspace_reservations where property_id=prop and reference='HA:'||(r->>'id')) then
    raise exception 'Reservation belongs to another source';
   end if;
   if not found_prev and v_status='cancelled' then continue;end if; -- nothing to record or clean
   if not found_prev then
    insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,channel_reference,guests,payout_minor,synced_at)
    values(prop,'HA:'||(r->>'id'),v_in,v_out,v_status,'hostaway',null,v_channel,v_reference,v_guests,v_payout,now()) returning * into res;
    new_reservations:=new_reservations+1;
    insert into public.workspace_activity(actor_id,property_id,event_type) values(null,prop,'reservation.imported');
   elsif (prev.property_id,prev.check_in,prev.check_out,prev.status,prev.channel,prev.channel_reference,prev.guests,prev.payout_minor)
     is distinct from (prop,v_in,v_out,v_status,v_channel,coalesce(v_reference,prev.channel_reference),coalesce(v_guests,prev.guests),coalesce(v_payout,prev.payout_minor)) then
    -- Hostaway wins, except that a blank in Hostaway never wipes a detail Accounts has filled in.
    update private.workspace_reservations set property_id=prop,check_in=v_in,check_out=v_out,status=v_status,channel=v_channel,
     channel_reference=coalesce(v_reference,channel_reference),guests=coalesce(v_guests,guests),payout_minor=coalesce(v_payout,payout_minor),synced_at=now()
     where id=prev.id returning * into res;
    changed_reservations:=changed_reservations+1;
    insert into public.workspace_activity(actor_id,property_id,event_type) values(null,prop,case when v_status='cancelled' then 'reservation.cancelled' else 'reservation.updated' end);
   else
    update private.workspace_reservations set synced_at=now() where id=prev.id returning * into res;
   end if;
   touched:=touched||res.property_id;
   if found_prev and prev.property_id<>res.property_id then touched:=touched||prev.property_id;end if;
   if res.status='confirmed' and exists(select 1 from private.workspace_reservations o where o.property_id=res.property_id and o.id<>res.id and o.status='confirmed' and o.check_in<res.check_out and o.check_out>res.check_in) then
    issues:=issues||jsonb_build_object('reservationId',r->>'id','problem','Overlaps another stay at this property');
   end if;

   -- The checkout clean. Only a clean nobody has started is moved or cancelled automatically.
   select w.* into clean from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and d.data->>'reservationId'=res.id::text and w.status<>'cancelled' order by w.created_at desc limit 1;
   if found then select * into detail from private.workspace_domain_details where work_id=clean.id;end if;
   if res.status='confirmed' then
    if clean.id is null then
     if res.check_out>=current_date then
      work:=private.workspace_handover(res.property_id,'cleaning-schedule','Checkout clean','cleaning',
       jsonb_build_object('dueOn',res.check_out,'checklist',checklist,'phase','assigned','workStatus','waiting','reservationId',res.id,'source','hostaway'));
      update public.workspace_work_items set due_on=res.check_out where id=work;
      new_cleans:=new_cleans+1;
     end if;
    elsif clean.due_on is distinct from res.check_out or clean.property_id<>res.property_id then
     if clean.status='waiting' and not (detail.data ? 'submittedBy') and clean.property_id=res.property_id then
      update private.workspace_domain_details set data=data||jsonb_build_object('dueOn',res.check_out),updated_at=now() where work_id=clean.id;
      update public.workspace_work_items set due_on=res.check_out,version=version+1,updated_at=now() where id=clean.id;
      moved_cleans:=moved_cleans+1;
     else
      issues:=issues||jsonb_build_object('reservationId',r->>'id','problem','The stay changed after its clean started. Check the clean');
     end if;
    end if;
   elsif clean.id is not null then
    if clean.status='waiting' and not (detail.data ? 'submittedBy') then
     update private.workspace_domain_details set data=data||jsonb_build_object('workStatus','cancelled','cancelledBecause','The stay was cancelled in Hostaway'),updated_at=now() where work_id=clean.id;
     update public.workspace_work_items set status='cancelled',version=version+1,updated_at=now() where id=clean.id;
     cancelled_cleans:=cancelled_cleans+1;
    else
     issues:=issues||jsonb_build_object('reservationId',r->>'id','problem','The stay was cancelled after its clean started. Check the clean');
    end if;
   end if;
   clean:=null;detail:=null;
  exception when others then issues:=issues||jsonb_build_object('reservationId',r->>'id','problem',left(sqlerrm,200));
  end;
 end loop;

 -- Same-day turnovers: the clean is urgent when the next guest arrives on the checkout day.
 update private.workspace_domain_details d set data=d.data||jsonb_build_object('sameDayTurnover',s.same_day),updated_at=now()
 from (select w.id,exists(select 1 from private.workspace_reservations n where n.property_id=w.property_id and n.status='confirmed' and n.check_in=w.due_on) same_day
   from public.workspace_work_items w join private.workspace_domain_details x on x.work_id=w.id
   where x.kind='cleaning' and x.data->>'source'='hostaway' and w.status='waiting' and w.due_on>=current_date and w.property_id=any(touched)) s
 where d.work_id=s.id and (d.data->'sameDayTurnover') is distinct from to_jsonb(s.same_day);
 update public.workspace_work_items w set priority=case when (d.data->>'sameDayTurnover')::boolean then 'high' else 'normal' end,version=version+1,updated_at=now()
 from private.workspace_domain_details d where d.work_id=w.id and d.kind='cleaning' and d.data->>'source'='hostaway' and w.status='waiting' and w.due_on>=current_date and w.property_id=any(touched)
  and w.priority is distinct from (case when (d.data->>'sameDayTurnover')::boolean then 'high' else 'normal' end);

 summary:=jsonb_build_object('createdProperties',created_properties,'linkedProperties',linked_properties,'newReservations',new_reservations,
  'changedReservations',changed_reservations,'newCleans',new_cleans,'movedCleans',moved_cleans,'cancelledCleans',cancelled_cleans,'problems',issues);
 update private.workspace_hostaway_sync_state set last_run_at=now(),last_success_at=now(),last_trigger=trigger_name,last_error=null,
  problems=(select coalesce(jsonb_agg(p),'[]') from (select p from jsonb_array_elements(issues) p limit 25) x),last_summary=summary-'problems';
 return summary;
end $$;

-- The backend records a failed run (Hostaway unreachable, keys rejected) without changing any data.
create function private.workspace_hostaway_sync_failed(input jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(input)<>'object' or coalesce(input->>'trigger','') not in ('schedule','webhook','manual') then raise exception 'Invalid sync trigger' using errcode='22023';end if;
 update private.workspace_hostaway_sync_state set last_run_at=now(),last_trigger=input->>'trigger',last_error=left(coalesce(input->>'error','Hostaway sync failed'),500);
end $$;

-- What admins and the Stays team see: when it last ran, what it found, and anything to check.
create function private.workspace_hostaway_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();s private.workspace_hostaway_sync_state;begin
 if coalesce(actor,'') not in ('admin','super_admin','stays') then raise exception 'Admin access required' using errcode='42501';end if;
 select * into s from private.workspace_hostaway_sync_state where singleton;
 return jsonb_build_object('lastRunAt',s.last_run_at,'lastSuccessAt',s.last_success_at,'lastTrigger',s.last_trigger,'lastError',s.last_error,
  'problems',s.problems,'lastSummary',s.last_summary,'canSync',actor in ('admin','super_admin'),
  'linkedProperties',(select count(*) from public.workspace_properties where hostaway_listing_id is not null and status<>'archived'),
  'upcomingStays',(select count(*) from private.workspace_reservations where source='hostaway' and status='confirmed' and check_out>=current_date),
  'unassignedCleans',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='cleaning' and d.data->>'source'='hostaway' and w.status='waiting' and w.assignee_id is null and w.due_on between current_date and current_date+14));
end $$;

create function public.workspace_hostaway_sync(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_hostaway_sync(input);$$;
create function public.workspace_hostaway_sync_failed(input jsonb) returns void language sql security invoker set search_path='' as $$select private.workspace_hostaway_sync_failed(input);$$;
create function public.workspace_hostaway_status() returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_hostaway_status();$$;
revoke all on function private.workspace_hostaway_sync(jsonb),public.workspace_hostaway_sync(jsonb),private.workspace_hostaway_sync_failed(jsonb),public.workspace_hostaway_sync_failed(jsonb),
 private.workspace_hostaway_status(),public.workspace_hostaway_status() from public,anon,authenticated,service_role;
grant execute on function private.workspace_hostaway_sync(jsonb),public.workspace_hostaway_sync(jsonb),private.workspace_hostaway_sync_failed(jsonb),public.workspace_hostaway_sync_failed(jsonb) to service_role;
grant execute on function private.workspace_hostaway_status(),public.workspace_hostaway_status() to authenticated;
