-- Cleaners, clean reviews and disputes, as the client asked:
-- * A cleaner goes to a management review on their second upheld rejection this month, the same rule as the
--   monthly warning (an overturned rejection, or one from an earlier month, no longer counts).
-- * Cleaners hear when a clean is accepted or rejected, and when a dispute about it is decided. The clean keeps
--   the reviewer's reason and the dispute's outcome, so the cleaner sees both on the clean.
-- * Cleaning managers decide disputes (uphold or overturn) for the properties they manage, as admins do. The
--   dispute keeps what the cleaner submitted (report, checklist, photos) and why it was rejected. Deciding whether
--   a cleaner stays on the rota is still for admins.
-- * A pay rate per clean for each cleaner, set by admins or the cleaner's cleaning manager. The cleaner sees their
--   month and its amount; Accounts sees the amount for the cleans it invoices.
-- * Each clean shows how many guests are leaving and arriving next, for cleaners too: counts and dates only.
-- * A cleaner can report a problem from a clean. It becomes a repair in triage for the property's Stays team,
--   with optional photos, and the clean lists what was reported.

-- Pay rates ---------------------------------------------------------------------------------------------------
create table private.workspace_cleaner_rates (
 cleaner_id uuid primary key references public.workspace_profiles(user_id),
 rate_minor integer not null check(rate_minor between 1 and 100000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_cleaner_rates enable row level security;
revoke all on private.workspace_cleaner_rates from public,anon,authenticated;
create trigger business_write_limit before insert or update on private.workspace_cleaner_rates for each row execute function private.workspace_enforce_write_limit();

-- Admins manage every cleaner; a cleaning manager manages cleaners on a property they look after.
create function private.workspace_manages_cleaner(cleaner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_profiles c where c.user_id=cleaner and c.role='cleans') and (
  private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='cleaning_manager' and exists(
   select 1 from public.workspace_property_assignments a where a.user_id=cleaner and a.assignment='cleaner' and private.workspace_can_property(a.property_id,'cleaner-performance'))))
$$;

create function private.workspace_cleaner_rate_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;cleaner uuid;prior private.workspace_action_receipts;rate private.workspace_cleaner_rates;result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','cleanerId','rateMinor','version']);
 req:=(input->>'requestId')::uuid;cleaner:=(input->>'cleanerId')::uuid;
 if req is null or cleaner is null then raise exception 'Choose a cleaner' using errcode='22023';end if;
 if not private.workspace_manages_cleaner(cleaner) then raise exception 'Only admins and the cleaner''s cleaning manager can set their rate' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if jsonb_typeof(input->'rateMinor') is distinct from 'number' or input->>'rateMinor'!~'^\d+$' or (input->>'rateMinor')::bigint not between 1 and 100000 then raise exception 'Enter a rate between £0.01 and £1,000 a clean' using errcode='22023';end if;
 if jsonb_typeof(input->'version') is distinct from 'number' or input->>'version'!~'^\d+$' then raise exception 'Rate version required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('cleaner-rate:'||cleaner::text,0));
 if coalesce((select r.version from private.workspace_cleaner_rates r where r.cleaner_id=cleaner),0)<>(input->>'version')::int then raise exception 'The rate was changed by someone else. Refresh and try again' using errcode='40001';end if;
 insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values(cleaner,(input->>'rateMinor')::int,auth.uid())
  on conflict(cleaner_id) do update set rate_minor=excluded.rate_minor,version=private.workspace_cleaner_rates.version+1,updated_by=excluded.updated_by,updated_at=now()
  returning * into rate;
 result:=jsonb_build_object('cleanerId',rate.cleaner_id,'rateMinor',rate.rate_minor,'version',rate.version);
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'cleaning.rate_set');
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Rates for the cleaners this person may see: admins and Accounts (for invoicing) see all, a cleaning manager
-- sees their own cleaners.
create function private.workspace_cleaner_rates_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or not (actor in ('admin','super_admin','cleaning_manager') or (actor='accounts' and private.has_workspace_module('cleans-invoices'))) then raise exception 'Cleaner rates access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('cleanerId',p.user_id,'fullName',p.full_name,'rateMinor',r.rate_minor,'version',r.version,'updatedAt',r.updated_at) order by p.full_name,p.user_id),'[]')
  from private.workspace_cleaner_rates r join public.workspace_profiles p on p.user_id=r.cleaner_id
  where actor<>'cleaning_manager' or private.workspace_manages_cleaner(r.cleaner_id));
end $$;

-- Disputes ----------------------------------------------------------------------------------------------------
-- Admins decide any dispute; a cleaning manager decides disputes on the properties they manage.
create function private.workspace_can_decide_dispute(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='cleaning_manager' and exists(
  select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where w.id=target and d.kind='cleaning_complaint' and private.workspace_can_property(w.property_id,'cleaner-performance')))
$$;

-- Upholding or overturning a rejected clean (every "decideComplaint" now comes here). Overturning removes the
-- rejection from the cleaner's record and, if the clean was not redone, accepts it for invoicing. The outcome is
-- written on the clean and the cleaner is told.
create function private.workspace_decide_clean_dispute(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;cleaner uuid;event_id bigint;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if not private.workspace_can_decide_dispute((input->>'workId')::uuid) then raise exception 'Management access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 perform private.workspace_json_keys(input,array['action','requestId','workId','version','outcome','note']);
 perform 1 from public.workspace_work_items x where x.id=(input->>'workId')::uuid for update;
 w:=(select x from public.workspace_work_items x where x.id=(input->>'workId')::uuid);
 d:=(select x from private.workspace_domain_details x where x.work_id=w.id);
 if w.id is null or d.work_id is null or d.kind<>'cleaning_complaint' then raise exception 'Decision not found' using errcode='P0002';end if;
 if w.version is distinct from (input->>'version')::integer then raise exception 'Decision changed' using errcode='40001';end if;
 if w.status in ('completed','cancelled') then raise exception 'Already decided' using errcode='42501';end if;
 if coalesce(input->>'outcome','') not in ('upheld','overturned') then raise exception 'Choose an outcome' using errcode='22023';end if;
 update private.workspace_domain_details set data=data||jsonb_build_object('decision',input->>'outcome','decisionNote',private.workspace_required_text(input,'note',5,2000),'decidedBy',auth.uid(),'decidedAt',now(),'workStatus','completed'),updated_at=now() where work_id=w.id;
 insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(w.id,auth.uid(),req,w.status,'completed',input->>'note',w.version);
 update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
 cleaner:=(d.data->>'cleanerId')::uuid;
 perform 1 from public.workspace_work_items x where x.id=(d.data->>'sourceWorkId')::uuid for update;
 src:=(select x from public.workspace_work_items x where x.id=(d.data->>'sourceWorkId')::uuid);
 sd:=(select x from private.workspace_domain_details x where x.work_id=src.id);
 if input->>'outcome'='overturned' then
  -- The rejection no longer counts against the cleaner.
  update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=auth.uid(),overturn_note=input->>'note'
   where id=(select r.id from private.workspace_cleaning_reviews r where r.work_id=src.id and r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null order by r.created_at desc limit 1);
  -- If the clean has not been redone, it is accepted as originally submitted and can be invoiced.
  if src.id is not null and sd.kind='cleaning' and sd.data->>'phase'='assigned' and src.status='waiting' and src.assignee_id=cleaner and sd.data ? 'submittedBy' then
   update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','workStatus','completed','overturnedBy',auth.uid()),updated_at=now() where work_id=src.id;
   insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(src.id,auth.uid(),gen_random_uuid(),src.status,'completed','Rejection overturned by management',src.version);
   update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=src.id;
   perform private.workspace_handover(src.property_id,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',src.id,'cleanerId',src.assignee_id,
    'cleanerName',(select p.full_name from public.workspace_profiles p where p.user_id=src.assignee_id),'cleanedOn',src.due_on));
  end if;
 end if;
 -- The clean shows the outcome to its cleaner, unless a later rejection of the same clean is now the open one.
 if sd.kind='cleaning' and coalesce(sd.data->>'complaintWorkId',w.id::text)=w.id::text then
  update private.workspace_domain_details set data=data||jsonb_build_object('complaintWorkId',w.id,'disputeDecision',input->>'outcome','disputeNote',input->>'note','disputeDecidedAt',now()),updated_at=now() where work_id=src.id;
 end if;
 result:=jsonb_build_object('workId',w.id,'version',w.version,'status',w.status,'outcome',input->>'outcome');
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.decision_'||(input->>'outcome'));
 if cleaner is not null then
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,case when src.assignee_id=cleaner then src.id end,'cleaning.dispute_'||(input->>'outcome')) returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(cleaner,case when src.assignee_id=cleaner then src.id end,event_id) on conflict do nothing;
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Guests for each clean ---------------------------------------------------------------------------------------
-- For each clean in the schedule the person can see: guests on the stay it follows, and the date and guests of the
-- next arrival at that property. Nothing else about the booking leaves the database.
create function private.workspace_clean_guests(start_on date,end_on date,target_property uuid,target_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',c.id,
   'guestsLeaving',(select r.guests from private.workspace_reservations r where r.property_id=c.property_id and r.status='confirmed'
     and (r.id::text=c.data->>'reservationId' or (c.data->>'reservationId' is null and r.check_out=c.due_on)) order by r.check_out desc,r.id limit 1),
   'nextArrivalOn',n.check_in,'nextArrivalGuests',n.guests) order by c.due_on,c.id),'[]')
 from (select w.id,w.property_id,w.due_on,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='cleaning' and w.due_on between start_on and end_on and w.status not in ('cancelled','declined') and (target_property is null or w.property_id=target_property)
    and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) c
 left join lateral (select r.check_in,r.guests from private.workspace_reservations r where r.property_id=c.property_id and r.status='confirmed' and r.check_in>=c.due_on order by r.check_in,r.id limit 1) n on true
$$;

revoke all on function private.workspace_manages_cleaner(uuid),private.workspace_cleaner_rate_action(jsonb),private.workspace_cleaner_rates_read(),
 private.workspace_can_decide_dispute(uuid),private.workspace_decide_clean_dispute(jsonb),private.workspace_clean_guests(date,date,uuid,uuid) from public,anon,authenticated;

-- Patches to shared functions, each inside the cleaning parts only -----------------------------------------------
do $$
declare
 fixes constant text[][] := array[
  -- Second-rejection rule: upheld (not overturned) rejections this month, like the monthly warning.
  ['private.workspace_operations_action(jsonb)',
   $q$if (select count(distinct work_id) from private.workspace_cleaning_reviews where cleaner_id=w.assignee_id and not accepted)>=2 then$q$,
   $q$if (select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=w.assignee_id and not r.accepted and r.overturned_at is null and r.created_at>=date_trunc('month',current_date)::date)>=2 then$q$,
   $q$r.overturned_at is null and r.created_at>=date_trunc('month',current_date)::date)>=2 then$q$],
  -- The cleaner hears the review's result.
  ['private.workspace_operations_action(jsonb)',
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');$q$,
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');
    insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,case when (data->>'accepted')::boolean then 'cleaning.accepted' else 'cleaning.rejected' end) returning id into event_id;
    insert into private.workspace_notification_outbox(user_id,work_id,event_id) select w.assignee_id,target,event_id where w.assignee_id is not null and w.assignee_id is distinct from auth.uid() on conflict do nothing;$q$,
   $q$'cleaning.accepted'$q$],
  -- The dispute keeps what was submitted and why it was rejected; the clean links to its open dispute.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true));$q$,
   $q$data:=data||jsonb_build_object('complaintWorkId',private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true,
      'report',d.data->'report','checklist',d.data->'checklist','photoIds',d.data->'photoIds','reviewNote',data->>'reviewNote','guestFeedback',data->>'guestFeedback','reviewedBy',auth.uid(),'cleanedOn',w.due_on)),
      'disputeDecision',null,'disputeNote',null,'disputeDecidedAt',null);$q$,
   $q$'complaintWorkId',private.workspace_handover($q$],
  -- A cleaner reports a problem found on the clean: a repair in triage for the Stays team, with optional photos.
  ['private.workspace_operations_action(jsonb)',
   $q$elsif kind='cleaning' and step='reviewCleaning' then$q$,
   $q$elsif kind='cleaning' and step='reportCleanProblem' then
    perform private.workspace_json_keys(data,array['issue','urgent','repairType','photoIds']);
    if actor<>'cleans' or w.assignee_id is distinct from auth.uid() then raise exception 'Only the cleaner on this clean can report a problem from it' using errcode='42501';end if;
    if jsonb_typeof(data->'urgent') is distinct from 'boolean' or coalesce(data->>'repairType','other') not in ('heating','hot_water','leak','toilet_drain','electrics','appliance','wifi','locks_access','pests','damage','other') then raise exception 'Say what kind of problem it is and whether it is urgent' using errcode='22023';end if;
    if jsonb_array_length(coalesce(d.data->'problems','[]'::jsonb))>=10 then raise exception 'Ten problems are already reported on this clean. Ask the Stays team' using errcode='22023';end if;
    if data ? 'photoIds' and (jsonb_typeof(data->'photoIds') is distinct from 'array' or jsonb_array_length(data->'photoIds') not between 1 and 10
     or (select count(distinct e.id) from private.workspace_media_evidence e where e.work_id=target and e.owner_id=auth.uid() and e.purpose='maintenance' and e.id::text in (select value#>>'{}' from jsonb_array_elements(data->'photoIds')))<>jsonb_array_length(data->'photoIds'))
     then raise exception 'Photos must be saved photos of this problem' using errcode='22023';end if;
    j:=(select x from private.workspace_journeys x where x.property_id=prop);
    entry:=jsonb_build_object('issue',private.workspace_required_text(data,'issue',5,3000),'estimatedCostMinor',0,'hazard',false,'phase','triage','warrantyRequired',coalesce(j.form->>'warrantyDetails','')<>'','workStatus','waiting',
     'repairType',coalesce(data->>'repairType','other'),'urgent',(data->>'urgent')::boolean,'contactFirst',nullif(j.form->>'preferredRepairContact',''),'warrantyDetails',nullif(j.form->>'warrantyDetails',''),
     'reportedBy',auth.uid(),'reportedFromClean',target);
    declare repair uuid; begin
     repair:=private.workspace_handover(prop,'stays-maintenance-reporting','Property repair request','maintenance',entry);
     update public.workspace_work_items set client_visible=true where id=repair;
     -- The photos move to the repair, where Stays and Ready see them.
     update private.workspace_media_evidence set work_id=repair where work_id=target and owner_id=auth.uid() and purpose='maintenance' and id::text in (select value#>>'{}' from jsonb_array_elements(coalesce(data->'photoIds','[]'::jsonb)));
     data:=jsonb_build_object('problems',coalesce(d.data->'problems','[]'::jsonb)||jsonb_build_array(jsonb_build_object('repairWorkId',repair,'issue',entry->>'issue','repairType',entry->>'repairType','urgent',entry->'urgent','photos',coalesce(jsonb_array_length(data->'photoIds'),0),'reportedAt',now())));
    end;
   elsif kind='cleaning' and step='reviewCleaning' then$q$,
   $q$step='reportCleanProblem'$q$],
  -- The assigned cleaner may add photos of a problem to their clean.
  ['private.workspace_prepare_upload(jsonb)',
   $q$(purpose in ('cleaning','mailbox') and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or$q$,
   $q$(purpose in ('cleaning','mailbox') and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or
 (purpose='maintenance' and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or$q$,
   $q$(purpose='maintenance' and d.kind='cleaning'$q$],
  ['private.integration_commit_upload(uuid,jsonb)',
   $q$(i.purpose in ('cleaning','mailbox') and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or$q$,
   $q$(i.purpose in ('cleaning','mailbox') and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or
 (i.purpose='maintenance' and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or$q$,
   $q$(i.purpose='maintenance' and kind='cleaning'$q$],
  -- Disputes are decided by admins or the cleaning manager; pay rates are set by the same people.
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('decideComplaint','decideCleanerReview','saveCourse') then$q$,
   $q$if a='decideComplaint' then return private.workspace_decide_clean_dispute(input);end if;
 if a='setCleanerRate' then return private.workspace_cleaner_rate_action(input);end if;
 if a in ('decideComplaint','decideCleanerReview','saveCourse') then$q$,
   $q$workspace_decide_clean_dispute$q$],
  -- Guests per clean in the schedule; cleaner pay rates for Accounts and cleaning managers.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'stays',case when actor='cleans' then '[]'::jsonb else$q$,
   $q$'cleanGuests',private.workspace_clean_guests(start_on,end_on,target_property,target_user),'stays',case when actor='cleans' then '[]'::jsonb else$q$,
   $q$workspace_clean_guests$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='performance' then$q$,
   $q$elsif section='cleanerRates' then result:=private.workspace_cleaner_rates_read();
 elsif section='performance' then$q$,
   $q$workspace_cleaner_rates_read$q$],
  -- A cleaner's month: their rate and the cleans it pays for (accepted, or overturned and not redone), and the
  -- disputes decided this month. The rate is shown to the cleaner, admins and cleaning managers only.
  ['private.workspace_cleaner_month(uuid,date)',
   $q$'openComplaints',(select$q$,
   $q$'rateMinor',case when private.workspace_actor_role() in ('admin','super_admin','cleaning_manager') or cleaner=auth.uid() then (select r.rate_minor from private.workspace_cleaner_rates r where r.cleaner_id=cleaner) end,
  'rateVersion',case when private.workspace_actor_role() in ('admin','super_admin','cleaning_manager') or cleaner=auth.uid() then coalesce((select r.version from private.workspace_cleaner_rates r where r.cleaner_id=cleaner),0) end,
  'paidCleans',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_invoice' and d.data->>'cleanerId'=cleaner::text and w.status<>'cancelled' and w.created_at>=start_on and w.created_at<(start_on+interval '1 month')),
  'decidedComplaints',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'sourceWorkId',d.data->>'sourceWorkId','decision',d.data->>'decision','decisionNote',d.data->>'decisionNote','decidedAt',w.completed_at) order by w.completed_at desc),'[]')
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'cleanerId'=cleaner::text and w.status='completed' and w.completed_at>=start_on and w.completed_at<(start_on+interval '1 month')),
  'openComplaints',(select$q$,
   $q$'decidedComplaints'$q$]
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
