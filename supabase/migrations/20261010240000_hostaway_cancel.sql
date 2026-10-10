-- Double bookings, and cancelling one of them from Recharge.
--
-- workspace_hostaway_double_bookings: for admins, every confirmed Hostaway stay (not yet checked
-- out) that overlaps another confirmed stay at the same property.
-- workspace_hostaway_cancel_check: an admin picks one; the backend learns its Hostaway ID and
-- whether Hostaway can cancel it (direct and Vrbo bookings only: Airbnb and Booking.com bookings
-- are cancelled on the channel itself).
-- integration_hostaway_cancelled: after Hostaway accepted the cancellation, the backend records it
-- here straight away (the stay, its unstarted clean, and who did it) instead of waiting for the sync.

create or replace function private.workspace_hostaway_double_bookings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('reservationId',r.id,'reference',r.reference,'channel',r.channel,'checkIn',r.check_in,'checkOut',r.check_out,
   'guests',r.guests,'payoutMinor',r.payout_minor,'propertyId',r.property_id,'propertyName',p.name,
   'canCancelInHostaway',r.channel in ('direct','vrbo'),
   'overlaps',(select jsonb_agg(o.reference order by o.check_in) from private.workspace_reservations o where o.property_id=r.property_id and o.id<>r.id
     and o.status='confirmed' and o.check_in<r.check_out and o.check_out>r.check_in)) order by p.name,r.check_in,r.created_at)
  from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
  where r.source='hostaway' and r.status='confirmed' and r.check_out>=current_date
   and exists(select 1 from private.workspace_reservations o where o.property_id=r.property_id and o.id<>r.id and o.status='confirmed' and o.check_in<r.check_out and o.check_out>r.check_in)),'[]'::jsonb);
end $$;

create or replace function private.workspace_hostaway_cancel_check(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.workspace_reservations;
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 select * into r from private.workspace_reservations where id=target;
 if r.id is null or r.source<>'hostaway' or r.reference !~ '^HA:[0-9]{1,20}$' then raise exception 'Stay not found' using errcode='P0002';end if;
 if r.status<>'confirmed' then raise exception 'This stay is already cancelled' using errcode='22023';end if;
 if r.check_out<current_date then raise exception 'This stay has already ended' using errcode='22023';end if;
 return jsonb_build_object('hostawayId',substr(r.reference,4),'channel',r.channel,'canCancelInHostaway',r.channel in ('direct','vrbo'),
  'checkIn',r.check_in,'checkOut',r.check_out);
end $$;

create or replace function private.integration_hostaway_cancelled(target uuid, actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.workspace_reservations; cleans integer;
begin
 if not exists(select 1 from public.workspace_profiles where user_id=actor and status='active' and role in ('admin','super_admin')) then raise exception 'Admin access required' using errcode='42501';end if;
 select * into r from private.workspace_reservations where id=target and source='hostaway' for update;
 if r.id is null then raise exception 'Stay not found' using errcode='P0002';end if;
 if r.status='cancelled' then return jsonb_build_object('cancelledCleans',0);end if;
 update private.workspace_reservations set status='cancelled',synced_at=now() where id=r.id;
 -- Its clean goes too, unless someone has started it (that stays for the team to check).
 with gone as (
  update private.workspace_domain_details d set data=d.data||jsonb_build_object('workStatus','cancelled','cancelledBecause','The stay was cancelled from Recharge'),updated_at=now()
  from public.workspace_work_items w where w.id=d.work_id and d.kind='cleaning' and d.data->>'reservationId'=r.id::text and w.status='waiting' and not (d.data ? 'submittedBy')
  returning d.work_id)
 update public.workspace_work_items w set status='cancelled',version=version+1,updated_at=now() from gone where w.id=gone.work_id;
 get diagnostics cleans=row_count;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(actor,r.property_id,'reservation.cancelled');
 return jsonb_build_object('cancelledCleans',cleans);
end $$;

create or replace function public.workspace_hostaway_double_bookings() returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_hostaway_double_bookings();$$;
create or replace function public.workspace_hostaway_cancel_check(target uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_hostaway_cancel_check(target);$$;
create or replace function public.integration_hostaway_cancelled(target uuid, actor uuid) returns jsonb language sql security invoker set search_path='' as $$select private.integration_hostaway_cancelled(target,actor);$$;
revoke all on function private.workspace_hostaway_double_bookings(),public.workspace_hostaway_double_bookings(),
 private.workspace_hostaway_cancel_check(uuid),public.workspace_hostaway_cancel_check(uuid),
 private.integration_hostaway_cancelled(uuid,uuid),public.integration_hostaway_cancelled(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.workspace_hostaway_double_bookings(),public.workspace_hostaway_double_bookings(),
 private.workspace_hostaway_cancel_check(uuid),public.workspace_hostaway_cancel_check(uuid) to authenticated;
grant execute on function private.integration_hostaway_cancelled(uuid,uuid),public.integration_hostaway_cancelled(uuid,uuid) to service_role;
