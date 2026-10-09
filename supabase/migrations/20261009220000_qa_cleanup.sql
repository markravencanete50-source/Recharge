-- Small fixes from the functional QA sweep (9 October 2026).

-- The Hostaway status says when the sync is paused, so the card stops promising a sync that
-- the database refuses ("Hostaway sync is paused").
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_hostaway_status()',
   $q$'canSync',actor in ('admin','super_admin'),$q$,
   $q$'canSync',actor in ('admin','super_admin'),'paused',coalesce(s.paused,false),$q$,
   $q$'paused',coalesce(s.paused,false)$q$]
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

-- Management → Waiting on you built "stalledOwnerApprovals" twice: the first (48 hours from when
-- the repair was created) is overwritten by the later key from workspace_stalled_owner_approvals()
-- but still ran on every load. Remove the first. Dead code only, so if this exact text is not
-- there (already removed, or changed by hand) it is left alone rather than failing.
do $$
declare
 dead constant text := $q$   'stalledOwnerApprovals',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,'estimatedCostMinor',(d.data->>'estimatedCostMinor')::bigint,'waitingSince',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.status not in ('completed','cancelled') and w.created_at<now()-interval '48 hours'),
$q$;
 definition text := pg_get_functiondef('private.workspace_teams_read(text,date,date,uuid,uuid)'::regprocedure);
begin
 if position(dead in definition) > 0 and position('private.workspace_stalled_owner_approvals()' in definition) > 0 then
  execute replace(definition, dead, '');
 else
  raise notice 'First stalledOwnerApprovals key not found in private.workspace_teams_read; left as it is';
 end if;
end $$;
