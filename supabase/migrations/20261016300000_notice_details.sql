-- Updates feed, round 6 (Lee: "instead of saying new task for your team it should be specific what type of task"). The feed read
-- (workspace_controls_read('notifications'), behind the header bell) now returns, for each notice, what the app needs to say what it
-- is: the work item's title and kind (workspace_domain_details) and module, the property's name and address (from the notice, else
-- from its work item), and who did it. All in the same single query, by left joins, with no per-row lookups.
-- Who did it: for team roles, the person's name ("You" for yourself) or nobody (automatic: a sweep, a cron or a channel feed). For
-- owners it is never a staff name: "You" for their own action, otherwise "Recharge", and never "automatic". Which notices a person
-- gets is unchanged (their own outbox, the work and property checks already in the read).
-- Email and push: the two claim functions also return the work kind, so the subject can name the type of work. They still carry no
-- property, title or names (lib/notice-copy.ts: the details stay behind sign-in).
-- All three are patched by anchor and append: the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
-- raises.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_controls_read(text,uuid,uuid)',
   $q$select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,$q$,
   $q$select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,
   w.title as work_title,dd.kind as work_kind,w.module_id as work_module,pr.name as property_name,pr.address as property_address,
   (a.actor_id is null and actor<>'client') as automatic,
   case when a.actor_id=auth.uid() then 'You' when actor='client' then 'Recharge' when a.actor_id is null then null else ap.full_name end as actor_name,$q$,
   $q$w.title as work_title,dd.kind as work_kind$q$],
  ['private.workspace_controls_read(text,uuid,uuid)',
   $q$from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id$q$,
   $q$from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
   left join public.workspace_work_items w on w.id=a.work_id left join private.workspace_domain_details dd on dd.work_id=a.work_id
   left join public.workspace_properties pr on pr.id=coalesce(a.property_id,w.property_id) left join public.workspace_profiles ap on ap.user_id=a.actor_id$q$,
   $q$left join private.workspace_domain_details dd on dd.work_id=a.work_id$q$],
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$'eventType',(select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.id=claimed.outbox_id)$q$,
   $q$'eventType',(select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.id=claimed.outbox_id),
   'workKind',(select dd.kind from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id join private.workspace_domain_details dd on dd.work_id=a.work_id where o.id=claimed.outbox_id)$q$,
   $q$'workKind',(select dd.kind$q$],
  ['private.integration_claim_web_push()',
   $q$'eventType',c.event_type$q$,
   $q$'eventType',c.event_type,'workKind',(select dd.kind from private.workspace_notification_outbox o2 join public.workspace_activity a2 on a2.id=o2.event_id join private.workspace_domain_details dd on dd.work_id=a2.work_id where o2.id=c.outbox_id)$q$,
   $q$'workKind',(select dd.kind$q$]
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
