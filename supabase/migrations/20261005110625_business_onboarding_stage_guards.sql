-- The generic property editor cannot override the shared onboarding journey.
create function private.workspace_onboarding_property_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare stage text; expected text; begin
 select j.stage into stage from private.workspace_journeys j where j.property_id=new.id;
 if found then
  expected:=case stage when 'live' then 'active' when 'archived' then 'archived' else 'onboarding' end;
  if new.status is distinct from expected then raise exception 'Use the shared property onboarding journey' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function private.workspace_onboarding_property_guard() from public,anon,authenticated;
create trigger onboarding_property_guard before update of status on public.workspace_properties for each row execute function private.workspace_onboarding_property_guard();

create function private.workspace_onboarding_inspection_date_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage='inspection_complete' and old.stage='inspection_booked' and (old.inspection_on is null or old.inspection_on>(now() at time zone 'Europe/London')::date) then
  raise exception 'The booked inspection date has not arrived' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.workspace_onboarding_inspection_date_guard() from public,anon,authenticated;
create trigger onboarding_inspection_date_guard before update of stage on private.workspace_journeys for each row execute function private.workspace_onboarding_inspection_date_guard();
