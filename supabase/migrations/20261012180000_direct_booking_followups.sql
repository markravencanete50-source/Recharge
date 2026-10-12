-- Direct booking follow-ups for Hostaway stays (client ask B3).
--
-- Client words: guests who book through Airbnb, Booking.com or Vrbo for 7 nights or more should get a "direct booking"
-- follow-up ticket, the same as a stay entered by hand. Entering a stay by hand already does this (recordReservation
-- hands over a 'direct_booking' item when the stay reaches the policy's minimum nights). The Hostaway sync does
-- not, so imported stays never got one.
--
-- private.workspace_direct_booking_sweep(at) closes that gap. It runs from the backend's cron (service role only),
-- NOT as a trigger on the reservations table, so it can never break or slow the Hostaway sync. For each stay that:
--   * is confirmed and was NOT entered by hand (source <> 'manual'; a hand-entered stay already got its own item);
--   * came through Airbnb, Booking.com or Vrbo (channel direct and other are left out: a guest who already booked
--     direct needs no follow-up, and owner stays are channel 'other', code 'Owner stay');
--   * checks in today or later (the date in Europe/London, from `at`);
--   * lasts at least the booking policy's minimum_nights (private.workspace_booking_policy, the very setting the
--     manual path reads, so the two always agree);
--   * belongs to a property that is not archived;
--   * has no direct_booking item for its reservation id (any status: a declined, cancelled or finished follow-up is
--     never brought back; the one exception is an item cancelled because the STAY changed, which the manual path
--     also replaces after an edit),
-- it creates the item through private.workspace_handover with the same title, module and data keys as the manual
-- path (reservationId, phase 'follow_up', workStatus 'waiting'), so the two look identical and the same people are
-- told. At most 50 per run, soonest check-in first; the rest wait for the next run. Returns
-- {created, skipped, failed}: skipped = stays that qualify but were held over by the cap; failed = stays whose item
-- could not be made (the others still go ahead).
--
-- Safe to run more than once, and the function itself is idempotent: a second run creates nothing.

-- Look-ups of "the direct booking item for this reservation" (this sweep, the edit guard, the Hostaway import).
create index if not exists workspace_domain_details_reservation_idx on private.workspace_domain_details((data->>'reservationId'));

-- The per-run cap, one switch.
create or replace function private.workspace_direct_booking_sweep_limit() returns integer language sql immutable set search_path='' as $$ select 50 $$;

create or replace function private.workspace_direct_booking_sweep(at timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 today date:=(coalesce($1,now()) at time zone 'Europe/London')::date;
 policy private.workspace_booking_policy;r private.workspace_reservations;
 cap constant integer:=private.workspace_direct_booking_sweep_limit();
 created integer:=0;skipped integer:=0;failed integer:=0;
begin
 -- One run at a time, so "no item yet" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_direct_booking_sweep',0));
 select * into policy from private.workspace_booking_policy where singleton;
 if not found then return jsonb_build_object('created',0,'skipped',0,'failed',0);end if;

 for r in select s.* from private.workspace_reservations s join public.workspace_properties p on p.id=s.property_id
  where s.status='confirmed' and s.source<>'manual' and s.channel in ('airbnb','booking_com','vrbo')
   and not private.workspace_is_owner_stay(s)
   and s.check_in>=today and s.check_out-s.check_in>=policy.minimum_nights and p.status<>'archived'
   and not exists(select 1 from private.workspace_domain_details d
    where d.kind='direct_booking' and d.data->>'reservationId'=s.id::text
     and not (coalesce(d.data->>'workStatus','')='cancelled' and (d.data ? 'reservationChangedAt' or d.data ? 'importChangedAt')))
  order by s.check_in,s.id
 loop
  if created>=cap then skipped:=skipped+1;continue;end if;
  begin
   perform private.workspace_handover(r.property_id,'direct-bookings','Follow up eligible direct booking','direct_booking',
    jsonb_build_object('reservationId',r.id,'phase','follow_up','workStatus','waiting'));
   created:=created+1;
  exception when others then failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('created',created,'skipped',skipped,'failed',failed);
end $$;

-- The backend's run (service role only).
create or replace function public.workspace_direct_booking_sweep() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_direct_booking_sweep(now());$$;

revoke all on function private.workspace_direct_booking_sweep_limit(),private.workspace_direct_booking_sweep(timestamptz) from public,anon,authenticated;
revoke all on function public.workspace_direct_booking_sweep() from public,anon,authenticated;
grant execute on function private.workspace_direct_booking_sweep(timestamptz),public.workspace_direct_booking_sweep() to service_role;
