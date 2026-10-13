-- Calendar fix (handover): an unrelated enquiry on exactly the same dates as a direct stay could put its guest's name on that stay.
-- The name came from the guest conversation about the stay: first the one carrying the stay's booking code, else one on the same
-- property and dates. Only the Hostaway import gives a conversation dates (one logged by hand has none), and it gives a conversation
-- the booking code whenever its reservation is a stay we hold. So a conversation matched by dates alone was always a Hostaway
-- conversation whose reservation is not one of our stays: an enquiry, or a request that did not go ahead. Nothing in the data tells
-- such a conversation apart from the booked guest's, so the date match is removed: a stay is named only by a conversation that
-- carries one of its codes (the platform booking code, its tidy form, or the stay's own reference). A stay entered by hand gets its
-- name once the conversation is matched to it in the guest inbox (Edit, booking reference: the stay's reference), and otherwise
-- shows as "Guest stay". Replaced whole (only 20261012210000 defines it; nothing patches it).
create or replace function private.workspace_stay_guest_name(reservation uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_reservations;codes text[];guest text;
begin
 select * into r from private.workspace_reservations x where x.id=reservation;
 if r.id is null or private.workspace_is_owner_stay(r) then return null;end if;
 codes:=private.workspace_stay_codes(r.channel_reference,r.reference);
 if cardinality(codes)=0 then return null;end if;
 -- The newest named conversation that carries this stay's code, on this property or not yet placed on one.
 select t.guest_name into guest from private.workspace_guest_threads t
  where t.guest_name is not null and t.reservation_ref is not null and upper(t.reservation_ref)=any(codes) and (t.property_id is null or t.property_id=r.property_id)
  order by (t.property_id is not null) desc,t.last_message_at desc nulls last,t.created_at desc limit 1;
 return guest;
end $fn$;

revoke all on function private.workspace_stay_guest_name(uuid) from public,anon,authenticated;
