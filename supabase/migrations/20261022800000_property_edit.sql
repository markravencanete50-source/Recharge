-- Edit a property's name and address from Properties (Alex). Until now only admins could change them, in Management,
-- Properties, through private.workspace_save_property, which also writes the region, bedrooms and status. Stays on the
-- property now change the name and address too, from the property in Properties, with the same checks as the other
-- property team actions (listing links, location):
--  * private.workspace_portfolio_action(jsonb) gets the action 'saveNameAddress'. It already lets only stays, admins and
--    super admins in, and only on a property they may see with the property database tool
--    (private.workspace_can_property): admins every property, stays the properties they are assigned to. Owners,
--    cleaners, contractors and everyone else are refused as before.
--  * The change is recorded the way the other portfolio actions are: an activity row 'portfolio.saveNameAddress' with
--    who and which property, and the request receipt with the new name and address.
--  * The name is trimmed, 2 to 200 characters (the table's own limit); the address is trimmed, 1 to 1000 characters.
--    The property's version must match, so two people editing at once never overwrite each other.
--  * A region that was worked out from the old address (private.workspace_infer_region) is worked out again from the
--    new one. A region someone chose by hand is kept.
--  * The Hostaway sync finds a linked property by its listing id and never changes its name or address, so an edit
--    stays. It matches an unlinked property by name only when it first links a listing.
-- New: private.workspace_save_property_name_address(uuid,jsonb) (internal, no grants).
-- Patch by anchor, applied once (a sentinel shows it is in): private.workspace_portfolio_action(jsonb).
-- No DROP, no DELETE. Safe to run more than once.

create or replace function private.workspace_save_property_name_address(prop uuid, input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare previous public.workspace_properties;new_name text;new_address text;new_region text;
begin
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','name','address']);
 if jsonb_typeof(input->'version') is distinct from 'number' then raise exception 'Property version required' using errcode='22023';end if;
 if jsonb_typeof(input->'name') is distinct from 'string' or jsonb_typeof(input->'address') is distinct from 'string' then raise exception 'Give the property a name and an address' using errcode='22023';end if;
 new_name:=btrim(input->>'name');new_address:=btrim(input->>'address');
 if length(new_name)<2 then raise exception 'Give the property a name of at least 2 characters' using errcode='22023';end if;
 if length(new_name)>200 then raise exception 'Keep the name to 200 characters or fewer' using errcode='22023';end if;
 if length(new_address)<1 then raise exception 'Add the property''s address' using errcode='22023';end if;
 if length(new_address)>1000 then raise exception 'Keep the address to 1000 characters or fewer' using errcode='22023';end if;
 select * into previous from public.workspace_properties where id=prop for update;
 if not found then raise exception 'Property not found' using errcode='P0002';end if;
 if previous.version is distinct from (input->>'version')::integer then raise exception 'Property changed. Refresh and try again' using errcode='40001';end if;
 if (previous.name,previous.address) is distinct from (new_name,new_address) then
  -- A region worked out from the old address is worked out again (the region trigger fills a blank one).
  new_region:=case when new_address is distinct from previous.address and previous.region=private.workspace_infer_region(previous.address) then '' else previous.region end;
  update public.workspace_properties set name=new_name,address=new_address,region=new_region,version=version+1,updated_at=now() where id=prop returning * into previous;
 end if;
 return jsonb_build_object('propertyId',previous.id,'name',previous.name,'address',previous.address,'region',previous.region,'version',previous.version);
end $fn$;
revoke all on function private.workspace_save_property_name_address(uuid,jsonb) from public,anon,authenticated;

do $patch$
declare
 fixes constant text[][] := array[
  -- Stays, admins and super admins on the property change its name and address.
  ['private.workspace_portfolio_action(jsonb)',
   $q$ elsif a='recordLocalEvent' then$q$,
   $q$ elsif a='saveNameAddress' then
  /* property edit: 20261022800000 */ result:=private.workspace_save_property_name_address(prop,input);
 elsif a='recordLocalEvent' then$q$,
   $q$/* property edit: 20261022800000 */$q$]
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
