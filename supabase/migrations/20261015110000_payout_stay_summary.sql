-- What the "Approve the payout" sheet shows before anyone approves (Lee, 13 October 2026: "all of the information should show:
-- the property, the guest, the amount, the date etc, to make sure they know what they are approving").
--
-- The reconciliation read already gives the reference, platform, platform code, dates, guests and the money. This adds the
-- rest as one finance report, 'payoutStay' (public.workspace_finance_report('payoutStay', null, <reservation id>)), reached
-- only after that function's finance-role and Accounts checks, like every other report:
--   propertyName, propertyAddress, status (confirmed, cancelled or enquiry), guestName (staff only: finance roles, never an
--   owner), nights, lines (the payout lines matched to the stay: paid on, file, amount, gross, set aside or not),
--   statement (the issued or paid owner statement that holds the stay's money, if any), and the warnings:
--   changedSinceStatement (dates, money or status changed since that statement stored its copy) and
--   differentAfterStatement (the money settled now differs from that copy).
-- The repeated-amount warning is already on the reconciliation row (repeatedAmount).
-- Read only; nothing is patched. Safe to run more than once.

create or replace function private.workspace_report_payout_stay(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_reservations;prop public.workspace_properties;held jsonb;st_id uuid;st private.workspace_owner_statements;settled bigint;
begin
 if target_id is null then raise exception 'Choose a stay' using errcode='22023';end if;
 if filters is not null and jsonb_typeof(filters)='object' and exists(select 1 from jsonb_object_keys(filters)) then raise exception 'Invalid report filters' using errcode='22023';end if;
 select * into r from private.workspace_reservations x where x.id=target_id;
 if r.id is null or (target_property is not null and r.property_id<>target_property) or not private.workspace_can_property(r.property_id,'owner-statements') then
  raise exception 'Stay not found' using errcode='P0002';
 end if;
 select * into prop from public.workspace_properties x where x.id=r.property_id;
 settled:=case when r.channel in ('airbnb','booking_com','vrbo') then (private.workspace_payout_row(r)->>'settledMinor')::bigint else r.payout_minor end;
 -- The first issued or paid statement whose stored copy counts this stay.
 select o.id,q.v into st_id,held from private.workspace_owner_statements o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
  cross join lateral (select private.workspace_statement_entry(e) v) q
  where o.property_id=r.property_id and o.status in ('issued','paid') and q.v->>'reservationId'=r.id::text and coalesce((q.v->>'counted')::boolean,false)
  order by o.period_start,o.id limit 1;
 select * into st from private.workspace_owner_statements o where o.id=st_id;
 return jsonb_build_object('section','payoutStay','reservationId',r.id,'propertyId',r.property_id,
  'propertyName',prop.name,'propertyAddress',prop.address,'status',r.status,
  'guestName',private.workspace_stay_guest_name(r.id),'guests',r.guests,'checkIn',r.check_in,'checkOut',r.check_out,'nights',r.check_out-r.check_in,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.id,'paidOn',l.paid_on,'uploadedAt',rp.created_at,'fileName',rp.file_name,'reference',l.reference,
     'amountMinor',l.amount_minor,'grossMinor',l.gross_minor,'active',l.set_aside_at is null) order by coalesce(l.paid_on,(rp.created_at at time zone 'Europe/London')::date),rp.created_at,l.id)
   from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id
   where r.channel_reference is not null and rp.channel=r.channel and upper(l.reference)=upper(r.channel_reference)),'[]'::jsonb),
  'locked',private.workspace_payout_stay_locked(r),
  'statement',case when st.id is not null then jsonb_build_object('id',st.id,'periodStart',st.period_start,'periodEnd',st.period_end,'status',st.status) end,
  'changedSinceStatement',held is not null and (r.status<>'confirmed' or r.check_in::text<>held->>'checkIn' or r.check_out::text<>held->>'checkOut'
    or settled is distinct from (held->>'settledMinor')::bigint),
  'differentAfterStatement',held is not null and held ? 'settledMinor' and settled is distinct from (held->>'settledMinor')::bigint);
end $fn$;

revoke all on function private.workspace_report_payout_stay(uuid,uuid,date,date,jsonb) from public,anon,authenticated;
