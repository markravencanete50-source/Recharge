-- Approving payouts in bulk, for the Payouts list: "Approve all" for one date or for the month.
--
-- One request approves many stays in one transaction. Approving them one request at a time stops
-- after 60 a minute, which is less than a month of stays. Each stay is checked exactly as a single
-- approval is: the same roles, the same module, the same property access, the same version check,
-- and nothing once the month's statement has been issued or paid.
--
-- A stay that has changed since the screen loaded, is already settled, still needs details, or
-- has a different amount (unless the person asked to include those) is skipped and counted, never
-- failed. The amount agreed is the one the screen showed: the expected payout for a stay that has
-- not been paid yet, the amount received for a stay paid a different amount. Each approved stay
-- gets its own agreement row and its own activity entry, so the history reads the same as
-- approving them one by one.
--
-- The database also limits each person to 60 changes a minute, counted per row written, which
-- would stop a month of approvals at the sixtieth. One bulk approval is counted as one change, once,
-- before it starts, and the row counting is paused for its own writes only (the setting below is
-- local to the transaction and only this function sets it).
--
-- Safe to run more than once.
create or replace function private.workspace_agree_payouts(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 items jsonb:=input->'items';entry jsonb;r private.workspace_reservations;payout jsonb;st text;amount bigint;base text;reason text;
 include_different boolean:=false;approved integer:=0;at_expected integer:=0;at_received integer:=0;total bigint:=0;changes integer;
 skipped jsonb:=jsonb_build_object('changed',0,'settled',0,'needsDetails',0,'different',0,'locked',0,'notFound',0);
begin
 if input is null or jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where not(k=any(array['action','requestId','items','note','includeDifferent']))) then
  raise exception 'Unknown or oversized workflow input' using errcode='22023';
 end if;
 base:=private.workspace_required_text(input,'note',5,1900);
 if input ? 'includeDifferent' then
  if jsonb_typeof(input->'includeDifferent') is distinct from 'boolean' then raise exception 'Invalid field includeDifferent' using errcode='22023';end if;
  include_different:=(input->>'includeDifferent')::boolean;
 end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 500 then raise exception 'Choose between 1 and 500 stays' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(entry)<>'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('reservationId','version'))
   or coalesce(entry->>'reservationId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(entry->'version') is distinct from 'number' or coalesce(entry->>'version','')!~'^\d{1,9}$' then
   raise exception 'Invalid stay in the list' using errcode='22023';
  end if;
 end loop;

 -- The whole approval is one change against the per-person limit; the rows it writes are not counted again.
 insert into private.workspace_write_limits(user_id,writes) values(auth.uid(),1)
  on conflict(user_id) do update set
   writes=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then 1 else workspace_write_limits.writes+1 end,
   window_started_at=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then now() else workspace_write_limits.window_started_at end
  returning writes into changes;
 if changes>60 then raise exception 'Too many changes. Wait a minute before trying again' using errcode='P0429';end if;
 perform set_config('recharge.bulk_write','on',true);

 -- In a fixed order, so two people approving at once cannot lock each other's stays crosswise.
 for entry in select value from jsonb_array_elements(items) order by lower(value->>'reservationId') loop
  reason:=null;
  select * into r from private.workspace_reservations where id=(entry->>'reservationId')::uuid for update;
  if not found then reason:='notFound';
  elsif not private.workspace_can_property(r.property_id,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';
  elsif r.version is distinct from (entry->>'version')::integer then reason:='changed';
  elsif r.channel not in ('airbnb','booking_com') or r.status<>'confirmed' then reason:='notFound';
  elsif exists(select 1 from private.workspace_owner_statements where property_id=r.property_id and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then reason:='locked';
  else
   payout:=private.workspace_payout_row(r);st:=payout->>'state';
   if st in ('matched','agreed') then reason:='settled';
   elsif st in ('no_reference','no_expected_amount') then reason:='needsDetails';
   elsif st='different' and not include_different then reason:='different';
   else
    amount:=case st when 'different' then (payout->>'receivedMinor')::bigint else (payout->>'expectedMinor')::bigint end;
    if amount is null or amount<0 or amount>100000000 then reason:='needsDetails';end if;
   end if;
  end if;
  if reason is not null then
   skipped:=jsonb_set(skipped,array[reason],to_jsonb((skipped->>reason)::integer+1));
   continue;
  end if;
  insert into private.workspace_payout_agreements(reservation_id,received_snapshot_minor,agreed_minor,note,agreed_by)
   values(r.id,(payout->>'receivedMinor')::bigint,amount,
    base||' '||case st when 'different' then 'Approved at the amount received.' else 'Approved at the expected amount, before the payout arrived.' end,auth.uid())
   on conflict(reservation_id) do update set received_snapshot_minor=excluded.received_snapshot_minor,agreed_minor=excluded.agreed_minor,note=excluded.note,agreed_by=excluded.agreed_by,agreed_at=now();
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),r.property_id,'finance.payout_agreed');
  approved:=approved+1;total:=total+amount;
  if st='different' then at_received:=at_received+1;else at_expected:=at_expected+1;end if;
 end loop;
 perform set_config('recharge.bulk_write','off',true);
 return jsonb_build_object('approved',approved,'approvedMinor',total,'atExpected',at_expected,'atReceived',at_received,'skipped',skipped);
end $$;
revoke all on function private.workspace_agree_payouts(jsonb) from public,anon,authenticated;

-- Let the finance action route to it: the same role and module check as approving one payout,
-- and the property check is made for each stay inside. The row limiter honours the pause above.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_finance_action(jsonb)',
   $q$elsif a in ('importPayoutReport','agreePayout','setAsidePayoutLine',$q$,
   $q$elsif a in ('importPayoutReport','agreePayout','agreePayouts','setAsidePayoutLine',$q$,
   $q$'agreePayout','agreePayouts'$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$elsif a='setAsidePayoutLine' then$q$,
   $q$elsif a='agreePayouts' then
  result:=private.workspace_agree_payouts(input);

 elsif a='setAsidePayoutLine' then$q$,
   $q$workspace_agree_payouts(input)$q$],
  ['private.workspace_enforce_write_limit()',
   $q$insert into private.workspace_write_limits(user_id,writes) values(auth.uid(),1)$q$,
   $q$if current_setting('recharge.bulk_write',true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  insert into private.workspace_write_limits(user_id,writes) values(auth.uid(),1)$q$,
   $q$recharge.bulk_write$q$]
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
