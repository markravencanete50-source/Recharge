-- Repairs: owners see the contractor's name, and the visit clash warning uses each stay's own times
-- (Lee, 15 October 2026).
--
-- 1. Owners see who is doing the repair. private.workspace_owner_work_data(jsonb), the one owner filter, strips the
--    contractor fields from what owners read (20261021200000, patch 13). It now gives back assignedReadyName, and only
--    when it is plain text: the name the database wrote from the contractor's profile (full name, or "Contractor").
--    Everything else stays stripped: assignedReadyId, previousReadyId, previousReadyName, reassignReason, reviewNote,
--    guestConversationId, and every ...By field. No other profile field (email, phone) is ever on the repair.
--    Only repairs (maintenance work) carry assignedReadyName.
--    The strip list itself is left as it is (the name is added back after it), so 20261021200000's own sentinel for
--    patch 13 stays present and that migration can still run again without failing.
-- 2. private.workspace_repair_clashes(uuid,date,time,time) uses the stay's check_in_time / check_out_time (from
--    Hostaway, 20261021500000), falling back to 14:00 / 10:00 when unknown, in the overlap test and in the label
--    ("Guest stay, check-in 15:00", "Guest stay, check-out 11:00"). Still never names the guest.
--
-- Safe to run twice: the clash function is replaced whole; the owner filter patch needs its anchor exactly once and is
-- skipped once its sentinel is present, else it raises. Nothing is removed from the database.

-- 2. Stays at the property that the visit overlaps on its day, at the stay's own check-in and check-out times
-- (14:00 and 10:00 when Hostaway gave none). Never names the guest.
create or replace function private.workspace_repair_clashes(prop uuid, day date, visit_from time, visit_to time) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('checkIn',to_char(r.check_in,'YYYY-MM-DD'),'checkOut',to_char(r.check_out,'YYYY-MM-DD'),
   'label',case when r.check_in=day then 'Guest stay, check-in '||to_char(coalesce(r.check_in_time,'14:00'::time),'HH24:MI')
    when r.check_out=day then 'Guest stay, check-out '||to_char(coalesce(r.check_out_time,'10:00'::time),'HH24:MI') else 'Guest stay, guests in all day' end)
   order by r.check_in,r.id),'[]'::jsonb)
 from private.workspace_reservations r
 where r.property_id=prop and r.status='confirmed' and r.check_in<=day and r.check_out>=day
  and ((r.check_in<day and r.check_out>day) or (r.check_in=day and visit_to>coalesce(r.check_in_time,'14:00'::time)) or (r.check_out=day and visit_from<coalesce(r.check_out_time,'10:00'::time)));
$$;

-- 1. The owner filter gives back the contractor's name only.
do $patch$
declare
 target constant text:='private.workspace_owner_work_data(jsonb)';
 anchor constant text:=$a$where e.k !~ 'By$'),'{}'::jsonb)$a$;
 replacement constant text:=$r$where e.k !~ 'By$'),'{}'::jsonb)||case when jsonb_typeof(item->'assignedReadyName')='string' then jsonb_build_object('assignedReadyName',item->'assignedReadyName') else '{}'::jsonb end$r$;
 sentinel constant text:=$s$jsonb_build_object('assignedReadyName',item->'assignedReadyName')$s$;
 definition text;hits integer;
begin
 definition:=pg_get_functiondef(target::regprocedure);
 if position(sentinel in definition)=0 then
  -- The strip list must still be the one from 20261021200000, so the id, the previous contractor, the reason, the
  -- review note and the guest conversation stay stripped.
  if position($k$-'assignedReadyId'-'assignedReadyName'-'previousReadyId'-'previousReadyName'-'reassignReason'-'reviewNote'-'guestConversationId'$k$ in definition)=0
   then raise exception 'The owner filter % does not strip the contractor fields; run 20261021200000 first',target;end if;
  hits:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if hits<>1 then raise exception 'Patch anchor found % times in %',hits,target;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef(target::regprocedure))=0 then raise exception 'Patch did not take in %',target;end if;
 end if;
end $patch$;

revoke all on function private.workspace_repair_clashes(uuid,date,time,time),private.workspace_owner_work_data(jsonb) from public,anon,authenticated;
