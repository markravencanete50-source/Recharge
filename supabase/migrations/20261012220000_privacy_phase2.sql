-- Privacy for the Phase 2 records, and one owner scrub (review of 54b3996, defects A and B).
--
-- A. "Download my data" and "Delete my account" now cover the records Phase 2 added about a person:
--    end-of-day reflections (20261012150000), team events such as absences (20261012210000) and the
--    management flags they raised (20261012140000).
--    1. The export gains three lists, each holding only the person's own rows and no other person's name:
--       reflections {day, wentWell, notWell, feedback, completed, summary, createdAt, updatedAt, reviewedAt},
--       teamEvents {kind, title, startsOn, endsOn, startTime, endTime, location, status, addedByYou, createdAt,
--       cancelledAt} and flagsRaised {source, title, reason, amountMinor, status, outcomeNote, createdAt,
--       decidedAt}. A person with none gets empty lists.
--    2. Deleting the account ERASES the person's reflections and team events. Reflection text (how the day
--       went, feedback about colleagues) and absences (often health reasons) are personal data that no
--       business record depends on, so they go, as do the request receipts other people (admins) hold for
--       events they added for the person, because a receipt keeps what was typed (the event title).
--       The day's sign-off row (workspace_daily_signoffs) is a performance record like shifts and stays.
--    3. Flags the person raised are ANONYMISED, not deleted: a flag is a request for a management decision,
--       and decisions (resolved, declined, the outcome note, the amount) must stay auditable, the same rule
--       that keeps work, money and statements under "Deleted user". raised_by is set to null, and so is
--       decided_by where the person decided their own flag (a withdrawal), so nothing on the flag points
--       back at them; title, reason, amount and outcome stay. Open flags stay open for management.
--       private.workspace_flag_view is not patched here: 20261012140000 creates it whole and is re-run by its
--       own test, so an anonymised flag reads with no raiser name, like a flag the clean form sweep raised
--       (source 'clean_form' tells them apart).
--       Decisions a deleted admin made on other people's flags, reflections they marked as read and events
--       they added or cancelled for others keep pointing at the anonymised profile, which reads "Deleted
--       user": no foreign key or check needs them cleared, and the profile row is never removed while
--       anything refers to it (the existing removable check), so these references cannot block.
--    The deletes run after the access removal and before the removable check, and touch only tables that
--    nothing else references (reflections and team events have no dependants), so no foreign key blocks.
-- B. Owners no longer receive a repair's resolution text or who resolved it: private.workspace_operation_view
--    strips 'resolution' and 'resolvedBy' (added by resolveRepair in 20261012200000) for the client role,
--    next to the troubleshooting and evidence keys it already strips. Owners still see the phase 'resolved',
--    the completed status and resolvedAt.
--
-- Every patch reads the LATEST definition, requires its anchor exactly once, keeps the anchor word for word
-- at the start of its replacement, and is skipped once its sentinel is present, so the migration is safe
-- to run twice. A missing or repeated anchor stops the migration.

do $patch$
declare
 -- function, anchor (exactly once), replacement, sentinel (present once patched)
 fixes text[][]:=array[
  -- A1. The export: after the shifts list.
  ['private.workspace_privacy_read(text)',
   $q$from private.workspace_shifts s where s.user_id=me),'[]'),$q$,
   $q$from private.workspace_shifts s where s.user_id=me),'[]'),
   'reflections',coalesce((select jsonb_agg(jsonb_build_object('day',r.day,'wentWell',r.went_well,'notWell',r.not_well,'feedback',r.feedback,'completed',r.completed,
     'summary',r.summary,'createdAt',r.created_at,'updatedAt',r.updated_at,'reviewedAt',r.reviewed_at) order by r.day,r.created_at,r.id)
    from private.workspace_day_reflections r where r.user_id=me),'[]'),
   'teamEvents',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'title',e.title,'startsOn',e.starts_on,'endsOn',e.ends_on,
     'startTime',to_char(e.start_time,'HH24:MI'),'endTime',to_char(e.end_time,'HH24:MI'),'location',e.location,
     'status',case when e.cancelled_at is null then 'active' else 'cancelled' end,'addedByYou',e.created_by=me,'createdAt',e.created_at,'cancelledAt',e.cancelled_at)
     order by e.starts_on,e.created_at,e.id)
    from private.workspace_team_events e where e.user_id=me),'[]'),
   'flagsRaised',coalesce((select jsonb_agg(jsonb_build_object('source',f.source,'title',f.title,'reason',f.reason,'amountMinor',f.amount_minor,'status',f.status,
     'outcomeNote',f.outcome_note,'createdAt',f.created_at,'decidedAt',f.decided_at) order by f.created_at,f.id)
    from private.workspace_management_flags f where f.raised_by=me),'[]'),$q$,
   $q$'flagsRaised',coalesce($q$],
  -- A2 and A3. Deleting the account: right after every way in is taken away.
  ['private.workspace_delete_own_account(uuid)',
   $q$perform private.workspace_remove_account_access(target);$q$,
   $q$perform private.workspace_remove_account_access(target);
 -- Phase 2 records (20261012220000): reflections and team events are erased, flags they raised are anonymised.
 delete from private.workspace_action_receipts x where x.input->>'action' in ('saveTeamEvent','cancelTeamEvent')
  and (x.input->>'userId'=target::text or x.result->>'userId'=target::text
   or x.input->>'id' in (select e.id::text from private.workspace_team_events e where e.user_id=target));
 delete from private.workspace_team_events where user_id=target;
 delete from private.workspace_day_reflections where user_id=target;
 update private.workspace_management_flags set raised_by=null,decided_by=case when decided_by=target then null else decided_by end where raised_by=target;$q$,
   $q$delete from private.workspace_day_reflections where user_id=target;$q$],
  -- B. Owners: no resolution text and no resolver.
  ['private.workspace_operation_view(uuid)',
   $q$d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'$q$,
   $q$d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'-'resolution'-'resolvedBy'$q$,
   $q$-'warrantyContactEvidence'-'resolution'-'resolvedBy'$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   found_count:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if found_count<>1 then raise exception 'Patch anchor found % times in % (%), expected once',found_count,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (%)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
