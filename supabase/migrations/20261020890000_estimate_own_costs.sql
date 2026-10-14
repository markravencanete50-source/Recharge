-- "Your own costs" on the estimate, giving the owner's net profit (Lee and Alex, client meeting). The team may add the
-- owner's monthly costs (mortgage, insurance, utilities, council tax, other: the categories an admin keeps in Onboarding
-- settings, private.workspace_onboarding_settings.own_cost_categories, migration 20261020870000) when publishing the
-- estimate. They are kept in the estimate as ownCosts: [{category, monthlyMinor}], at most 12, each category once,
-- each up to 100,000 pounds a month. The owner's app and their estimate page then show the income after Recharge's and
-- the platforms' fees, minus these costs, as the estimated net profit per month and per year. An estimate without them
-- reads exactly as before.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (publishEstimate takes
-- ownCosts and checks them) and private.workspace_journey_view (the team's form lists the categories in use).
-- Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$'occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']);$q$,
   $q$'occupancyBps','directBookingBps','otaFeeBps','managementFeeBps','ownCosts']);$q$,
   $q$'managementFeeBps','ownCosts']);$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;$q$,
   $q$if input ? 'ownCosts' and (case when jsonb_typeof(input->'ownCosts') is distinct from 'array' then true else jsonb_array_length(input->'ownCosts')>12
    or exists(select 1 from jsonb_array_elements(input->'ownCosts') c where case when jsonb_typeof(c)<>'object' then true
     else exists(select 1 from jsonb_object_keys(c) k where k not in ('category','monthlyMinor')) or jsonb_typeof(c->'category') is distinct from 'string'
      or length(btrim(c->>'category')) not between 1 and 60
      or case when jsonb_typeof(c->'monthlyMinor') is distinct from 'number' or c->>'monthlyMinor'!~'^\d+$' then true else (c->>'monthlyMinor')::numeric>10000000 end end)
    or (select count(distinct lower(btrim(c->>'category'))) from jsonb_array_elements(input->'ownCosts') c)<>jsonb_array_length(input->'ownCosts') end) then
    raise exception 'Check the owner''s own costs: each category once, up to 100,000 pounds a month' using errcode='22023';
   end if;
   update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;$q$,
   $q$Check the owner''s own costs$q$],
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,$q$,
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,
 'ownCostCategories',(select s.own_cost_categories from private.workspace_onboarding_settings s
   where s.singleton and j.stage in ('enquiry','estimate','reviewing') and coalesce(private.workspace_actor_role(),'') in ('stays','admin','super_admin')),$q$,
   $q$'ownCostCategories'$q$]
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
