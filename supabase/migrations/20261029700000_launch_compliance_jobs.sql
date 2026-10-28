-- Launch Preparation: safety compliance jobs (Business Plan v1.0, 17/10/26, Tasks 2. Safety Compliance).
--  * Each safety document Recharge organise (the owner ticked it in the onboarding package) now opens a property
--    maintenance job rather than a plain ticket: the same flow as a repair. The contractor quotes (Recharge add 10% for
--    organising), management review it, the owner approves it within or above their limit, the visit is booked and the
--    owner told, the contractor completes it with photos and their invoice. Completing it hands the invoice to accounts
--    to reconcile and pay, and drafts the owner's expense with the quote and invoice as evidence, so owner statements
--    carry the chain of evidence for each expense.
--  * When the job is completed the team are asked to upload the certificate and its expiry date in Launch Preparation,
--    which ticks the document. The checklist never closes a job itself: a job finishes through its own steps.
--  * Renewals: when a document Recharge organised is due for renewal (the reminder months before expiry), the renewal
--    is a job the same way. Documents the owner looks after keep the plain renewal ticket.
--  * The jobs go on the property maintenance board; the compliance board setting still turns the tickets on or off
--    (blank for none).
-- Replaces private.workspace_launch_sync (20261029300000), private.workspace_launch_ticket_done and
-- private.workspace_launch_compliance_sweep (20261029200000). Safe to run twice.

-- 1. A safety document's job: a repair on the property maintenance board, visible to the owner.
create or replace function private.workspace_launch_compliance_job(prop uuid,step text,doc text,renewal boolean) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;job uuid;begin
 select * into j from private.workspace_journeys where property_id=prop;
 job:=private.workspace_handover_now(prop,'stays-maintenance-reporting',left(case when renewal then 'Renew the ' else 'Safety certificate: ' end||doc,200),'maintenance',
  jsonb_build_object('issue',left((case when renewal then 'Renew the '||doc||' certificate.' else 'Arrange the '||doc||' certificate.' end)
    ||' Get the contractor''s quote with a breakdown of items and labour (Recharge add 10% for organising), book the visit,'
    ||' and attach the contractor''s invoice when the job is done. Then upload the certificate and its expiry date in Launch Preparation.',3000),
   'estimatedCostMinor',0,'hazard',false,'phase','triage','warrantyRequired',false,'workStatus','waiting','repairType','other','urgent',false,
   'contactFirst',nullif(j.form->>'preferredRepairContact',''),'reportedBy',auth.uid(),'complianceStep',step,'complianceRenewal',renewal));
 update public.workspace_work_items set client_visible=true where id=job;
 return job;
end $fn$;
create or replace function private.workspace_launch_is_job(work uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_domain_details d where d.work_id=work and d.kind='maintenance')
$fn$;

-- 2. The mirrored tickets: Recharge's safety documents are jobs; a done part never closes a job.
create or replace function private.workspace_launch_sync(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare plan jsonb;s jsonb;boards jsonb;board text;place text;w uuid;begin
 plan:=private.workspace_launch_plan(prop);
 if plan is null then return;end if;
 perform pg_advisory_xact_lock(hashtext('workspace_launch_sync:'||prop));
 boards:=coalesce(private.workspace_launch_settings()->'boards','{}');
 place:=coalesce((select nullif(btrim(p.name),'') from public.workspace_properties p where p.id=prop),'Property');
 for s in select * from jsonb_array_elements(plan) loop
  w:=(select t.work_id from private.workspace_launch_tickets t where t.property_id=prop and t.step=s->>'key');
  if s->>'state'='done' then
   if w is not null and not private.workspace_launch_is_job(w) then
    update public.workspace_work_items x set status='completed',completed_at=now(),version=x.version+1,updated_at=now() where x.id=w and x.status not in ('completed','cancelled','declined');
   end if;
   -- A renewed safety document completes its renewal tickets (a renewal job finishes through its own steps).
   if s->>'section'='compliance' then
    update public.workspace_work_items x set status='completed',completed_at=now(),version=x.version+1,updated_at=now()
     from private.workspace_launch_reminders m where m.property_id=prop and m.step=s->>'key' and m.expires_on<(s#>>'{data,expiresOn}')::date and x.id=m.work_id
      and x.status not in ('completed','cancelled','declined') and not private.workspace_launch_is_job(x.id);
   end if;
  elsif s->>'state'='todo' and w is null and s->>'who'='recharge'
   and (s->>'section' not in ('setUp','garden','housekeeper','licensing','listing') or s->>'key' in ('setUp.order','setUp.received','setUp.install')) then
   -- The furnishing order, delivery and install go on the furnishing board (purchase orders by default).
   board:=nullif(boards->>(case when s->>'section'='setUp' then 'furnishing' else s->>'section' end),'');
   if board is not null and exists(select 1 from public.workspace_features f where f.module_id=board) then
    if s->>'section'='compliance' then
     w:=private.workspace_launch_compliance_job(prop,s->>'key',coalesce(s->>'title','safety'),false);
    else
     w:=private.workspace_handover_now(prop,board,left(place||': '||(s->>'title'),200),'launch_step',jsonb_build_object('step',s->>'key','section',s->>'section','kind',s->>'kind'));
    end if;
    insert into private.workspace_launch_tickets(property_id,step,work_id) values(prop,s->>'key',w);
   end if;
  end if;
 end loop;
end $fn$;

-- 3. A ticket completed on its board ticks the part. A completed job leaves the certificate to upload: the team are asked.
create or replace function private.workspace_launch_ticket_done() returns trigger language plpgsql security definer set search_path='' as $fn$
declare t private.workspace_launch_tickets;s jsonb;prop uuid;step text;begin
 select * into t from private.workspace_launch_tickets where work_id=new.id;
 prop:=t.property_id;step:=t.step;
 if prop is null then
  select m.property_id,m.step into prop,step from private.workspace_launch_reminders m where m.work_id=new.id limit 1;
  if prop is null then return null;end if;
 end if;
 s:=(select z from jsonb_array_elements(private.workspace_launch_plan(prop)) z where z->>'key'=step);
 if private.workspace_launch_is_job(new.id) then
  perform private.workspace_followup_note(prop,'The '||coalesce(s->>'title','safety')||' job is done. Upload the certificate and its expiry date in Launch Preparation to tick it off.',auth.uid());
  return null;
 end if;
 if t.work_id is null or s is null or s->>'state'<>'todo' then return null;end if;
 if s->>'kind'<>'tick' then raise exception 'Finish "%" in Launch Preparation on the property',s->>'title' using errcode='22023';end if;
 insert into private.workspace_launch_steps(property_id,step,data,done_by,done_at)
  values(t.property_id,t.step,'{}',(select p.user_id from public.workspace_profiles p where p.user_id=auth.uid()),now()) on conflict do nothing;
 return null;
end $fn$;

-- 4. Expiry reminders: once per document and expiry date, the owner in the property's chat and, on the compliance board
-- setting, a renewal: a job for a document Recharge organise, a ticket for one the owner looks after.
create or replace function private.workspace_launch_compliance_sweep(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare st jsonb:=private.workspace_launch_settings();months integer;board text;today date;x record;doc text;w uuid;n integer:=0;part jsonb;begin
 perform pg_advisory_xact_lock(hashtext('workspace_launch_compliance_sweep'));
 months:=coalesce((st->>'reminderMonths')::integer,3);
 board:=nullif(st#>>'{boards,compliance}','');
 if board is not null and not exists(select 1 from public.workspace_features f where f.module_id=board) then board:=null;end if;
 today:=(at_time at time zone 'Europe/London')::date;
 for x in select s.property_id,s.step,(s.data->>'expiresOn')::date expires_on from private.workspace_launch_steps s
   join private.workspace_onboarding_packages k on k.property_id=s.property_id and k.submitted_at is not null
   join private.workspace_journeys j on j.property_id=s.property_id and j.stage<>'archived'
  where s.step like 'compliance:%' and s.data->>'expiresOn' ~ '^\d{4}-\d{2}-\d{2}$' and ((s.data->>'expiresOn')::date-make_interval(months=>months))::date<=today
   and not exists(select 1 from private.workspace_launch_reminders m where m.property_id=s.property_id and m.step=s.step and m.expires_on=(s.data->>'expiresOn')::date)
  order by 3,1 limit 100 loop
  part:=(select z from jsonb_array_elements(private.workspace_launch_plan(x.property_id)) z where z->>'key'=x.step);
  doc:=coalesce(part->>'title',initcap(replace(split_part(x.step,':',2),'-',' ')));
  w:=null;
  if board is not null then
   if part->>'who'='recharge' then
    w:=private.workspace_launch_compliance_job(x.property_id,x.step,doc,true);
   else
    w:=private.workspace_handover_now(x.property_id,board,left('Renew '||doc||' (expires '||to_char(x.expires_on,'FMDD FMMonth YYYY')||')',200),'compliance_renewal',
     jsonb_build_object('step',x.step,'expiresOn',x.expires_on));
   end if;
  end if;
  insert into private.workspace_launch_reminders(property_id,step,expires_on,work_id,sent_at) values(x.property_id,x.step,x.expires_on,w,at_time);
  perform private.workspace_property_chat_post(x.property_id,'The '||doc||' certificate '||case when x.expires_on<=today then 'expired on ' else 'expires on ' end
   ||to_char(x.expires_on,'FMDay FMDD FMMonth YYYY')||case when part->>'who'='recharge' and board is not null
    then '. We are arranging the renewal and will ask you to approve the quote.' else '. Please arrange the renewal and upload the new certificate in Launch Preparation.' end,null,'event',at_time);
  n:=n+1;
 end loop;
 return jsonb_build_object('reminded',n);
end $fn$;

revoke all on function private.workspace_launch_compliance_job(uuid,text,text,boolean),private.workspace_launch_is_job(uuid),private.workspace_launch_sync(uuid),
 private.workspace_launch_ticket_done(),private.workspace_launch_compliance_sweep(timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.workspace_launch_compliance_sweep(timestamptz) to service_role;
