-- Provider-independent integration state. No secrets, fixture data, schedules or sends.
create unique index workspace_hostaway_listing_unique on public.workspace_properties(hostaway_listing_id) where hostaway_listing_id is not null;
create table private.workspace_upload_intents (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.workspace_profiles(user_id),
 request_id uuid not null,work_id uuid not null references public.workspace_work_items(id),
 purpose text not null check(purpose in ('cleaning','mailbox','delivery','licence','maintenance')),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 public_id text not null unique,expires_at timestamptz not null default now()+interval '15 minutes',
 evidence_id uuid references private.workspace_media_evidence(id), unique(owner_id,request_id)
);
create index workspace_upload_work_idx on private.workspace_upload_intents(work_id);
create index workspace_upload_evidence_idx on private.workspace_upload_intents(evidence_id);
alter table private.workspace_media_evidence add column asset_version bigint, add column asset_format text,add column asset_bytes integer,add column provider_asset_id text;
create table private.workspace_notification_deliveries (
 id uuid primary key default gen_random_uuid(),outbox_id bigint not null references private.workspace_notification_outbox(id),
 channel text not null check(channel in ('email','push')),destination text not null,
 state text not null default 'queued' check(state in ('queued','accepted','delivered','failed','review','cancelled')),
 provider_id text,attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 lease uuid,lease_until timestamptz,last_error text,created_at timestamptz not null default now(),delivered_at timestamptz,
 unique(outbox_id,channel,destination)
);
create index workspace_delivery_pending_idx on private.workspace_notification_deliveries(next_attempt_at,id) where state in ('queued','accepted');
alter table private.workspace_upload_intents enable row level security;
alter table private.workspace_notification_deliveries enable row level security;
revoke all on private.workspace_upload_intents,private.workspace_notification_deliveries from public,anon,authenticated;
create trigger business_write_limit before insert or update or delete on private.workspace_upload_intents for each row execute function private.workspace_enforce_write_limit();

-- Background permission evaluation uses current grants, not JWTs saved when an event was created.
create function private.integration_can_work(subject uuid,target uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.workspace_profiles p join public.workspace_work_items w on w.id=target join public.workspace_features f on f.module_id=w.module_id
 where p.user_id=subject and p.status='active' and (
 p.role in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments a join public.workspace_module_grants g on g.user_id=a.user_id
 where a.user_id=subject and a.property_id=w.property_id and a.assignment=case p.role when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
 and ((p.role='client' and w.client_visible and g.module_id=f.client_module) or (p.role='cleans' and w.assignee_id=subject and g.module_id=w.module_id) or (p.role not in ('client','cleans') and g.module_id=w.module_id)
 or (p.role='ready' and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and ((d.kind='purchase' and d.data->>'phase' in ('ordered','delivered','reconciled') and g.module_id='purchase-order') or (d.kind='maintenance' and d.data->>'referredAt' is not null and g.module_id='maintenance-reporting'))))))));
$$;
create function private.workspace_prepare_upload(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare intent private.workspace_upload_intents;w public.workspace_work_items;d private.workspace_domain_details;actor text:=private.workspace_actor_role();target uuid;purpose text;nonce uuid;
begin
 perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);
 target:=(input->>'workId')::uuid;purpose:=input->>'purpose';
 if actor is null or not private.workspace_operation_access(target) then raise exception 'Upload access denied' using errcode='42501';end if;
 select * into w from public.workspace_work_items where id=target;
 select * into d from private.workspace_domain_details where work_id=target;
 if w.status in ('completed','cancelled','declined') or not coalesce((
 (purpose in ('cleaning','mailbox') and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or
 (purpose='delivery' and d.kind='purchase' and d.data->>'phase'='ordered' and actor in ('ready','admin','super_admin')) or
 (purpose='licence' and d.kind='licensing' and actor in ('ready','stays','admin','super_admin')) or
 (purpose='maintenance' and d.kind='maintenance' and actor in ('ready','stays','admin','super_admin'))
 ),false) then raise exception 'Upload purpose or work stage denied' using errcode='42501';end if;
 if purpose='mailbox' and not exists(select 1 from private.workspace_journeys j where j.property_id=w.property_id and j.form->>'mailPreference' in ('photograph','open_and_photograph')) then raise exception 'Mailbox photograph consent required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),9));
 select * into intent from private.workspace_upload_intents where owner_id=auth.uid() and request_id=(input->>'requestId')::uuid;
 if found then
  if intent.work_id<>target or intent.purpose<>purpose or intent.content_hash<>input->>'contentHash' then raise exception 'Request identifier already used' using errcode='22023';end if;
  if intent.evidence_id is null and intent.expires_at<now() then raise exception 'Upload request expired' using errcode='22023';end if;
 else
  nonce:=gen_random_uuid();
  insert into private.workspace_upload_intents(id,owner_id,request_id,work_id,purpose,content_hash,public_id) values(nonce,auth.uid(),(input->>'requestId')::uuid,target,purpose,input->>'contentHash','recharge/'||nonce::text) returning * into intent;
 end if;
 return jsonb_build_object('id',intent.id,'publicId',intent.public_id,'evidenceId',intent.evidence_id);
end $$;
-- Service-only commit: the backend has validated Cloudinary's signed response.
create function private.integration_commit_upload(target_intent uuid,asset jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare i private.workspace_upload_intents;w public.workspace_work_items;e uuid;actor text;kind text;phase text;
begin
 select * into i from private.workspace_upload_intents where id=target_intent for update;
 if not found then raise exception 'Upload not found' using errcode='P0002';end if;
 if not private.integration_can_work(i.owner_id,i.work_id) then raise exception 'Upload access revoked' using errcode='42501';end if;
 if i.evidence_id is not null then return i.evidence_id;end if;
 if i.expires_at<now() then raise exception 'Upload expired' using errcode='22023';end if;
 select * into w from public.workspace_work_items where id=i.work_id;
 if w.status in ('completed','cancelled','declined') then raise exception 'Work closed' using errcode='22023';end if;
 select role into actor from public.workspace_profiles where user_id=i.owner_id;
 select d.kind,d.data->>'phase' into kind,phase from private.workspace_domain_details d where work_id=i.work_id;
 if not coalesce(((i.purpose in ('cleaning','mailbox') and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or
 (i.purpose='delivery' and kind='purchase' and phase='ordered' and actor in ('ready','admin','super_admin')) or
 (i.purpose='licence' and kind='licensing' and actor in ('ready','stays','admin','super_admin')) or
 (i.purpose='maintenance' and kind='maintenance' and actor in ('ready','stays','admin','super_admin'))),false) then raise exception 'Upload permission changed' using errcode='42501';end if;
 if i.purpose='mailbox' and not exists(select 1 from private.workspace_journeys j where j.property_id=w.property_id and j.form->>'mailPreference' in ('photograph','open_and_photograph')) then raise exception 'Mailbox photograph consent revoked' using errcode='42501';end if;
 perform private.workspace_json_keys(asset,array['assetId','publicId','version','format','bytes']);
 if asset->>'publicId' is distinct from i.public_id or coalesce(asset->>'assetId','')='' or coalesce(asset->>'format','') not in ('jpg','png','webp') or jsonb_typeof(asset->'bytes') is distinct from 'number' or jsonb_typeof(asset->'version') is distinct from 'number' or (asset->>'bytes')::integer not between 12 and 8388608 or (asset->>'version')::bigint<1 then raise exception 'Invalid verified asset' using errcode='22023';end if;
 insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at,asset_version,asset_format,asset_bytes,provider_asset_id) values(w.property_id,w.id,i.owner_id,i.purpose,i.public_id,now(),(asset->>'version')::bigint,asset->>'format',(asset->>'bytes')::integer,asset->>'assetId') returning id into e;
 update private.workspace_upload_intents set evidence_id=e where id=i.id;
 return e;
end $$;
create function private.workspace_media_asset(target_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.workspace_media_evidence;
begin
 select * into e from private.workspace_media_evidence where id=target_asset;
 if private.workspace_actor_role() is null or not found or not private.workspace_operation_access(e.work_id) or (private.workspace_actor_role()='cleans' and e.owner_id<>auth.uid()) then raise exception 'Media access denied' using errcode='42501';end if;
 if e.provider_asset_id is null then raise exception 'Verified asset unavailable' using errcode='P0002';end if;
 return jsonb_build_object('providerAssetId',e.provider_asset_id,'format',e.asset_format,'bytes',e.asset_bytes);
end $$;
create function private.workspace_media_read(target_work uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null or not private.workspace_operation_access(target_work) then raise exception 'Media access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'purpose',e.purpose,'format',e.asset_format,'bytes',e.asset_bytes,'verifiedAt',e.verified_at)) from private.workspace_media_evidence e where e.work_id=target_work and (private.workspace_actor_role()<>'cleans' or e.owner_id=auth.uid())),'[]');
end $$;

create function private.integration_claim_notifications(email_enabled boolean,push_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- Never fabricate delivery; only initialise channels explicitly enabled in backend configuration.
 if email_enabled then
  insert into private.workspace_notification_deliveries(outbox_id,channel,destination)
  select o.id,'email',u.email from private.workspace_notification_outbox o join auth.users u on u.id=o.user_id
  join public.workspace_profiles p on p.user_id=o.user_id where p.status='active' and u.email_confirmed_at is not null and u.email is not null and (o.work_id is null or private.integration_can_work(o.user_id,o.work_id)) on conflict do nothing;
 end if;
 if push_enabled then
  insert into private.workspace_notification_deliveries(outbox_id,channel,destination)
  select o.id,'push',d.push_token from private.workspace_notification_outbox o join private.workspace_device_tokens d on d.user_id=o.user_id
  join public.workspace_profiles p on p.user_id=o.user_id where p.status='active' and (o.work_id is null or private.integration_can_work(o.user_id,o.work_id)) on conflict do nothing;
 end if;
 update private.workspace_notification_deliveries d set state='cancelled',lease=null,lease_until=null,last_error='access_changed'
 from private.workspace_notification_outbox o join public.workspace_profiles p on p.user_id=o.user_id
 where d.outbox_id=o.id and d.state in ('queued','accepted') and (p.status<>'active' or (o.work_id is not null and not private.integration_can_work(o.user_id,o.work_id))
 or (d.channel='push' and not exists(select 1 from private.workspace_device_tokens t where t.user_id=o.user_id and t.push_token=d.destination))
 or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null)));
 -- Expired send leases are ambiguous; do not blindly resend a push or email.
 update private.workspace_notification_deliveries set state=case when state='queued' or attempts>=8 then 'review' else state end,lease=null,lease_until=null,last_error='lease_expired' where lease_until<now();
 with candidates as (select id from private.workspace_notification_deliveries where state in ('queued','accepted') and next_attempt_at<=now() and lease is null and ((channel='email' and email_enabled) or (channel='push' and push_enabled)) order by next_attempt_at,id limit 5 for update skip locked),
 claimed as(update private.workspace_notification_deliveries d set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 from candidates c where d.id=c.id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease,'channel',channel,'destination',destination,'state',state,'providerId',provider_id,'createdAt',created_at)),'[]') into result from claimed;
 return result;
end $$;
create function private.integration_check_notification(target uuid,claim uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare d private.workspace_notification_deliveries;o private.workspace_notification_outbox;
begin
 select * into d from private.workspace_notification_deliveries where id=target for update;
 if not found or d.lease is distinct from claim or d.lease_until<=now() then return false;end if;
 select * into o from private.workspace_notification_outbox where id=d.outbox_id;
 if not exists(select 1 from public.workspace_profiles where user_id=o.user_id and status='active')
 or (o.work_id is not null and not private.integration_can_work(o.user_id,o.work_id))
 or (d.channel='push' and not exists(select 1 from private.workspace_device_tokens t where t.user_id=o.user_id and t.push_token=d.destination))
 or (d.channel='email' and not exists(select 1 from auth.users u where u.id=o.user_id and u.email=d.destination and u.email_confirmed_at is not null)) then
  update private.workspace_notification_deliveries set state='cancelled',lease=null,lease_until=null,last_error='access_changed' where id=target;
  return false;
 end if;
 return true;
end $$;
create function private.integration_finish_notification(target uuid,claim uuid,outcome text,provider text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare d private.workspace_notification_deliveries;
begin
 select * into d from private.workspace_notification_deliveries where id=target for update;
 if not found or d.lease is distinct from claim or d.lease_until<=now() then return false;end if;
 if outcome not in ('accepted','delivered','pending','retryable','rejected','uncertain','device_removed') then raise exception 'Invalid delivery outcome' using errcode='22023';end if;
 if outcome='accepted' and (d.state<>'queued' or coalesce(provider,'')='' or length(provider)>200) then raise exception 'Provider receipt required' using errcode='22023';end if;
 if outcome in ('delivered','pending') and d.state<>'accepted' then raise exception 'Provider acceptance required first' using errcode='22023';end if;
 update private.workspace_notification_deliveries set
 state=case when outcome='delivered' then 'delivered' when outcome='accepted' then 'accepted' when outcome='uncertain' then 'review' when outcome in ('rejected','device_removed') or d.attempts>=8 then 'failed' else state end,
 provider_id=case when outcome='accepted' then provider else provider_id end,
 delivered_at=case when outcome='delivered' then now() else delivered_at end,
 next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(d.attempts,6)))::integer),
 last_error=case when outcome in ('accepted','delivered','pending') then null else outcome end,lease=null,lease_until=null where id=target;
 if outcome='device_removed' then delete from private.workspace_device_tokens where push_token=d.destination;end if;
 return true;
end $$;
create function private.workspace_integration_status() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 return jsonb_build_object('notifications',coalesce((select jsonb_object_agg(state,n) from(select state,count(*) n from private.workspace_notification_deliveries group by state) c),'{}'::jsonb),'unverifiedUploads',(select count(*) from private.workspace_upload_intents where evidence_id is null));
end $$;

-- Public RPC wrappers are invokers. Private privileged operations have explicit role grants.
create function private.workspace_import_reservation(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prop uuid;listing text;source_reference text;r private.workspace_reservations;previous private.workspace_reservations;policy private.workspace_booking_policy;followup uuid;changed boolean;
begin
 perform private.workspace_json_keys(input,array['propertyId','listingId','externalId','checkIn','checkOut','status']);
 prop:=(input->>'propertyId')::uuid;listing:=input->>'listingId';source_reference:='HA:'||private.workspace_required_text(input,'externalId',1,100);
 if coalesce(private.workspace_actor_role(),'') not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'direct-bookings') then raise exception 'Reservation import access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(prop::text,42));
 if not exists(select 1 from public.workspace_properties where id=prop and hostaway_listing_id=listing) then raise exception 'Listing mapping changed' using errcode='40001';end if;
 if coalesce(input->>'status','') not in ('enquiry','confirmed','cancelled') or (input->>'checkOut')::date<=(input->>'checkIn')::date or (input->>'checkOut')::date-(input->>'checkIn')::date>365 or input->>'checkIn' is null or input->>'checkOut' is null then raise exception 'Invalid reservation dates' using errcode='22023';end if;
 select * into previous from private.workspace_reservations where property_id=prop and reference=source_reference;
 if found and previous.source<>'hostaway' then raise exception 'Reservation belongs to another source' using errcode='23505';end if;
 if input->>'status'='confirmed' and exists(select 1 from private.workspace_reservations where property_id=prop and status='confirmed' and id is distinct from previous.id and check_in<(input->>'checkOut')::date and check_out>(input->>'checkIn')::date) then raise exception 'Reservation overlaps occupied dates' using errcode='23505';end if;
 changed:=previous.id is null or previous.check_in is distinct from (input->>'checkIn')::date or previous.check_out is distinct from (input->>'checkOut')::date or previous.status is distinct from input->>'status';
 if not changed then return jsonb_build_object('id',previous.id,'changed',false);end if;
 insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by)
 values(prop,source_reference,(input->>'checkIn')::date,(input->>'checkOut')::date,input->>'status','hostaway',auth.uid())
 on conflict(property_id,reference) do update set check_in=excluded.check_in,check_out=excluded.check_out,status=excluded.status returning * into r;
 -- Imported changes invalidate an unconfirmed quote; never silently retain guest acceptance of old dates.
 if previous.id is not null then
  update private.workspace_domain_details d set data=d.data||jsonb_build_object('workStatus','cancelled','importChangedAt',now()),updated_at=now()
  from public.workspace_work_items w where d.work_id=w.id and d.kind='direct_booking' and d.data->>'reservationId'=r.id::text and w.status not in ('completed','cancelled');
  update public.workspace_work_items w set status='cancelled',version=version+1,updated_at=now()
  from private.workspace_domain_details d where d.work_id=w.id and d.kind='direct_booking' and d.data->>'reservationId'=r.id::text and w.status not in ('completed','cancelled');
 end if;
 select * into policy from private.workspace_booking_policy where singleton;
 if r.status<>'cancelled' and r.check_out-r.check_in>=policy.minimum_nights then
  followup:=private.workspace_handover(prop,'direct-bookings','Follow up imported reservation','direct_booking',jsonb_build_object('reservationId',r.id,'phase','follow_up','workStatus','waiting'));
 end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'reservation.imported');
 return jsonb_build_object('id',r.id,'changed',true,'followUpWorkId',followup);
end $$;
create function public.workspace_import_reservation(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_import_reservation(input);$$;
revoke all on function private.workspace_import_reservation(jsonb),public.workspace_import_reservation(jsonb) from public,anon,service_role;
grant execute on function private.workspace_import_reservation(jsonb),public.workspace_import_reservation(jsonb) to authenticated;

create function public.workspace_prepare_upload(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_prepare_upload(input);$$;
create function public.workspace_media_read(target_work uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_media_read(target_work);$$;
create function public.workspace_media_asset(target_asset uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_media_asset(target_asset);$$;
revoke all on function private.workspace_media_asset(uuid),public.workspace_media_asset(uuid) from public,anon,service_role;
grant execute on function private.workspace_media_asset(uuid),public.workspace_media_asset(uuid) to authenticated;
create function public.workspace_integration_status() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_integration_status();$$;
create function public.integration_commit_upload(target_intent uuid,asset jsonb) returns uuid language sql security invoker set search_path='' as $$select private.integration_commit_upload(target_intent,asset);$$;
create function public.integration_claim_notifications(email_enabled boolean,push_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select private.integration_claim_notifications(email_enabled,push_enabled);$$;
create function public.integration_check_notification(target uuid,claim uuid) returns boolean language sql security invoker set search_path='' as $$select private.integration_check_notification(target,claim);$$;
revoke all on function private.integration_check_notification(uuid,uuid),public.integration_check_notification(uuid,uuid) from public,anon,authenticated;
grant execute on function private.integration_check_notification(uuid,uuid),public.integration_check_notification(uuid,uuid) to service_role;
create function public.integration_finish_notification(target uuid,claim uuid,outcome text,provider text default null) returns boolean language sql security invoker set search_path='' as $$select private.integration_finish_notification(target,claim,outcome,provider);$$;
revoke all on function private.integration_can_work(uuid,uuid) from public,anon,authenticated,service_role;
do $$ declare schema_name text;begin
 foreach schema_name in array array['private','public'] loop
  execute format('revoke all on function %I.workspace_prepare_upload(jsonb),%I.workspace_media_read(uuid),%I.workspace_integration_status() from public,anon,service_role',schema_name,schema_name,schema_name);
  execute format('grant execute on function %I.workspace_prepare_upload(jsonb),%I.workspace_media_read(uuid),%I.workspace_integration_status() to authenticated',schema_name,schema_name,schema_name);
  execute format('revoke all on function %I.integration_commit_upload(uuid,jsonb),%I.integration_claim_notifications(boolean,boolean),%I.integration_finish_notification(uuid,uuid,text,text) from public,anon,authenticated',schema_name,schema_name,schema_name);
  execute format('grant execute on function %I.integration_commit_upload(uuid,jsonb),%I.integration_claim_notifications(boolean,boolean),%I.integration_finish_notification(uuid,uuid,text,text) to service_role',schema_name,schema_name,schema_name);
 end loop;
end $$;
