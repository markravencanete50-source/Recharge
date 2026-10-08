-- The published estimate can carry the team's assumptions, so the owner can explore it: expected
-- occupancy, expected direct-booking share, the platform fee and Recharge's management fee. Each is
-- optional, a whole number of basis points from 0 to 10000 (100%).
do $$
declare definition text;
 keys_anchor constant text:=$q$array['action','requestId','propertyId','version','lowRateMinor','mediumRateMinor','highRateMinor','comparables','comments']$q$;
 keys_patched constant text:=$q$array['action','requestId','propertyId','version','lowRateMinor','mediumRateMinor','highRateMinor','comparables','comments','occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']$q$;
 save_anchor constant text:=$q$update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;$q$;
 check_added constant text:=$q$if exists(select 1 from unnest(array['occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']) k where input ? k and (jsonb_typeof(input->k) is distinct from 'number' or input->>k!~'^\d+$' or (input->>k)::numeric>10000)) then raise exception 'Invalid estimate assumptions' using errcode='22023'; end if;
   $q$;
begin
 definition:=pg_get_functiondef('private.workspace_journey_action(jsonb)'::regprocedure);
 if position('''managementFeeBps''' in definition)>0 then return; end if;
 if position(keys_anchor in definition)=0 then raise exception 'Patch anchor missing: estimate keys'; end if;
 if position(save_anchor in definition)=0 then raise exception 'Patch anchor missing: estimate save'; end if;
 definition:=replace(definition,keys_anchor,keys_patched);
 definition:=replace(definition,save_anchor,check_added||save_anchor);
 execute definition;
end $$;
