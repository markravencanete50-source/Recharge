-- The API's database connections refuse an UPDATE without a WHERE clause ("UPDATE requires a
-- WHERE clause"), so the single-row settings tables are updated "where singleton". This patches
-- databases that ran the earlier versions of these functions; on a fresh database (where the
-- earlier migrations already say "where singleton") it changes nothing.
do $$
declare
  fixes constant text[][] := array[
    ['private.workspace_hostaway_sync(jsonb)', $q$last_summary=summary-'problems';$q$, $q$last_summary=summary-'problems' where singleton;$q$],
    ['private.workspace_hostaway_sync_failed(jsonb)', $q$'Hostaway sync failed'),500);$q$, $q$'Hostaway sync failed'),500) where singleton;$q$],
    ['private.workspace_operations_action(jsonb)', $q$confirmed=(input->>'confirmed')::boolean,version=version+1 returning * into policy;$q$, $q$confirmed=(input->>'confirmed')::boolean,version=version+1 where singleton returning * into policy;$q$],
    ['private.workspace_finance_action(jsonb)', $q$updated_by=auth.uid(),updated_at=now() returning * into policy;$q$, $q$updated_by=auth.uid(),updated_at=now() where singleton returning * into policy;$q$]
  ];
  definition text;
begin
  for i in 1..array_length(fixes, 1) loop
    definition := pg_get_functiondef(fixes[i][1]::regprocedure);
    if position(fixes[i][2] in definition) > 0 then execute replace(definition, fixes[i][2], fixes[i][3]); end if;
  end loop;
end $$;
