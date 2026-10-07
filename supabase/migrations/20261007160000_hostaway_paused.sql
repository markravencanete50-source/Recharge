-- Recharge starts as a new business (7 October 2026): properties, owners and staff are onboarded
-- afresh, and the Recharge Stays data imported from Hostaway was archived (archive schema) and
-- cleared from the live tables. The Hostaway sync is paused: a sync is refused and a failed run
-- records nothing. The channel manager that replaces Hostaway reuses the same database functions.
alter table private.workspace_hostaway_sync_state add column if not exists paused boolean not null default false;
update private.workspace_hostaway_sync_state set paused = true where singleton;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_hostaway_sync(jsonb)', $q$ -- One sync at a time.$q$,
   $q$ if (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway sync is paused' using errcode='55000';end if;
 -- One sync at a time.$q$, 'Hostaway sync is paused'],
  ['private.workspace_hostaway_sync_failed(jsonb)', $q$'Invalid sync trigger' using errcode='22023';end if;$q$,
   $q$'Invalid sync trigger' using errcode='22023';end if;
 -- Nothing to record while paused: the schedule keeps calling until it is switched off.
 if (select paused from private.workspace_hostaway_sync_state where singleton) then return; end if;$q$, 'while paused']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 and position(fixes[i][2] in definition) > 0 then execute replace(definition, fixes[i][2], fixes[i][3]); end if;
 end loop;
end $$;
