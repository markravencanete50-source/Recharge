-- Photos without an outside service. Photos are kept in a private Supabase Storage bucket that
-- only the backend can read or write; people see them through the app, which checks access first.
-- Adds two kinds of photo on the onboarding journey: the owner's set-up photos and documents, and
-- Ready's inspection photos. Cleaners can attach photos of the post when the owner asked for it,
-- and owners see those photos in their Mailbox. Safe to run more than once.

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('workspace-media','workspace-media',false,8388608,array['image/jpeg','image/png','image/webp'])
   on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp']$q$;
 end if;
end $$;

alter table private.workspace_upload_intents drop constraint if exists workspace_upload_intents_purpose_check;
alter table private.workspace_upload_intents add constraint workspace_upload_intents_purpose_check check(purpose in ('cleaning','mailbox','delivery','licence','maintenance','inspection','setup'));
alter table private.workspace_media_evidence drop constraint if exists workspace_media_evidence_purpose_check;
alter table private.workspace_media_evidence add constraint workspace_media_evidence_purpose_check check(purpose in ('cleaning','mailbox','delivery','licence','maintenance','inspection','setup'));

-- Who may add or see photos on an onboarding journey: the owner, admins, and Stays or Ready
-- working on that property.
create or replace function private.workspace_journey_media_access(target uuid, subject uuid, purpose text default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.workspace_journeys j join public.workspace_profiles p on p.user_id=subject and p.status='active'
  where j.work_id=target and j.stage<>'archived' and (
   p.role in ('admin','super_admin')
   or (p.role='client' and j.client_id=subject and coalesce(purpose,'setup')='setup' and (purpose is null or j.stage in ('form','invoice','inspection_to_book','inspection_booked')))
   or (p.role in ('stays','ready') and exists(select 1 from public.workspace_property_assignments a where a.user_id=subject and a.property_id=j.property_id and a.assignment='staff')
       and (purpose is null or (purpose='inspection' and j.stage in ('inspection_booked','inspection_complete')) or (purpose='setup' and p.role='stays')))))
$$;
revoke all on function private.workspace_journey_media_access(uuid,uuid,text) from public,anon,authenticated;

do $$
declare definition text;
begin
 -- Preparing an upload: journeys are checked by the journey rule; other work as before.
 definition:=pg_get_functiondef('private.workspace_prepare_upload(jsonb)'::regprocedure);
 if position('workspace_journey_media_access' in definition)=0 then
  definition:=replace(definition,$q$ if actor is null or not private.workspace_operation_access(target) then raise exception 'Upload access denied' using errcode='42501';end if;$q$,
   $q$ if actor is null or not (private.workspace_operation_access(target) or (purpose in ('inspection','setup') and private.workspace_journey_media_access(target,auth.uid(),purpose))) then raise exception 'Upload access denied' using errcode='42501';end if;$q$);
  definition:=replace(definition,$q$ (purpose='maintenance' and d.kind='maintenance' and actor in ('ready','stays','admin','super_admin'))$q$,
   $q$ (purpose='maintenance' and d.kind='maintenance' and actor in ('ready','stays','admin','super_admin')) or
 (purpose in ('inspection','setup') and private.workspace_journey_media_access(target,auth.uid(),purpose))$q$);
  if position('workspace_journey_media_access(target,auth.uid(),purpose))) then' in definition)=0 or position($q$or
 (purpose in ('inspection','setup')$q$ in definition)=0 then raise exception 'Patch anchor missing in workspace_prepare_upload'; end if;
  execute definition;
 end if;
 -- Committing the upload repeats the same check for the person who started it.
 definition:=pg_get_functiondef('private.integration_commit_upload(uuid,jsonb)'::regprocedure);
 if position('workspace_journey_media_access' in definition)=0 then
  definition:=replace(definition,$q$ if not private.integration_can_work(i.owner_id,i.work_id) then raise exception 'Upload access revoked' using errcode='42501';end if;$q$,
   $q$ if not (private.integration_can_work(i.owner_id,i.work_id) or (i.purpose in ('inspection','setup') and private.workspace_journey_media_access(i.work_id,i.owner_id,i.purpose))) then raise exception 'Upload access revoked' using errcode='42501';end if;$q$);
  definition:=replace(definition,$q$(i.purpose='maintenance' and kind='maintenance' and actor in ('ready','stays','admin','super_admin'))$q$,
   $q$(i.purpose='maintenance' and kind='maintenance' and actor in ('ready','stays','admin','super_admin')) or
 (i.purpose in ('inspection','setup') and private.workspace_journey_media_access(i.work_id,i.owner_id,i.purpose))$q$);
  if (length(definition)-length(replace(definition,'workspace_journey_media_access','')))/length('workspace_journey_media_access')<>2 then raise exception 'Patch anchor missing in integration_commit_upload'; end if;
  execute definition;
 end if;
end $$;

-- Seeing photos: the work's own access rule, the journey rule, and owners' post photos.
create or replace function private.workspace_media_visible(e private.workspace_media_evidence) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role() is not null and (private.workspace_actor_role()<>'cleans' or e.owner_id=auth.uid()) and (
  private.workspace_operation_access(e.work_id)
  or private.workspace_journey_media_access(e.work_id,auth.uid())
  or (e.purpose='mailbox' and private.workspace_actor_role()='client' and private.workspace_can_property(e.property_id,'client-mailbox')))
$$;
revoke all on function private.workspace_media_visible(private.workspace_media_evidence) from public,anon,authenticated;

create or replace function private.workspace_media_read(target_work uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if private.workspace_actor_role() is null then raise exception 'Media access denied' using errcode='42501';end if;
 items:=(select jsonb_agg(jsonb_build_object('id',e.id,'purpose',e.purpose,'format',e.asset_format,'bytes',e.asset_bytes,'verifiedAt',e.verified_at) order by e.verified_at)
  from private.workspace_media_evidence e where e.work_id=target_work and private.workspace_media_visible(e));
 if items is null and not (private.workspace_operation_access(target_work) or private.workspace_journey_media_access(target_work,auth.uid())
   or exists(select 1 from public.workspace_work_items w where w.id=target_work and private.workspace_actor_role()='client' and private.workspace_can_property(w.property_id,'client-mailbox'))) then
  raise exception 'Media access denied' using errcode='42501';
 end if;
 return coalesce(items,'[]');
end $$;

create or replace function private.workspace_media_asset(target_asset uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.workspace_media_evidence;
begin
 select * into e from private.workspace_media_evidence where id=target_asset;
 if not found or not private.workspace_media_visible(e) then raise exception 'Media access denied' using errcode='42501';end if;
 if e.provider_asset_id is null then raise exception 'Verified asset unavailable' using errcode='P0002';end if;
 return jsonb_build_object('providerAssetId',e.provider_asset_id,'format',e.asset_format,'bytes',e.asset_bytes);
end $$;

-- A cleaner can attach photos of the post with the clean, when the owner asked for photos.
do $$
declare definition text;
 anchor constant text := $q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote']);$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position('mailPhotoIds' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_operations_action'; end if;
  execute replace(definition,anchor,$q$perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote','mailPhotoIds']);
    if data ? 'mailPhotoIds' then
     if jsonb_typeof(data->'mailPhotoIds') is distinct from 'array' or jsonb_array_length(data->'mailPhotoIds')>20 or coalesce(data->>'mailAction','none') not in ('photograph','open_and_photograph')
      or (select count(distinct e.id) from private.workspace_media_evidence e where e.work_id=target and e.owner_id=auth.uid() and e.purpose='mailbox' and e.id::text in (select value#>>'{}' from jsonb_array_elements(data->'mailPhotoIds')))<>jsonb_array_length(data->'mailPhotoIds')
     then raise exception 'Post photos must be verified photos of this clean' using errcode='22023';end if;
    end if;$q$);
 end if;
end $$;

-- The owner's Mailbox lists the post photos with each entry.
do $$
declare definition text;
 anchor constant text := $q$'action',d.data->>'mailAction','note',left(coalesce(d.data->>'mailNote',''),500))$q$;
begin
 definition:=pg_get_functiondef('private.workspace_mailbox_read()'::regprocedure);
 if position('photoIds' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_mailbox_read'; end if;
  execute replace(definition,anchor,$q$'action',d.data->>'mailAction','note',left(coalesce(d.data->>'mailNote',''),500),'photoIds',coalesce(d.data->'mailPhotoIds','[]'::jsonb))$q$);
 end if;
end $$;
