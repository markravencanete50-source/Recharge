-- Listings in Hostaway, made from onboarding.
--  * Each onboarding property gets a draft listing filled in from what onboarding already knows: the property and enquiry
--    (name, address, type, bedrooms, bathrooms, parking, garden), the estimate (the medium nightly rate), the access
--    instructions from the set-up form, and an admin's settings (the description template, house rules, check-in and
--    check-out times, minimum nights, guests per bedroom, cleaning fee).
--  * From the set-up form onwards the stays team checks the draft, edits anything and adds the photos (stored in the
--    private "lead-files" bucket under listings/). Saving keeps their version; until then the draft follows onboarding.
--  * An admin approves it: the server then creates the listing in Hostaway (or updates the one it made before) and writes
--    the outcome back through the service-role-only private.workspace_listing_publish_result, which links the listing to
--    the property, so the Hostaway sync takes it from there. A property already linked to a listing made elsewhere is
--    never overwritten.
-- New tables and functions only; no existing function is changed and no data is changed. Safe to run twice.

-- 1. Settings, drafts and photos.
create or replace function private.workspace_listing_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select $json${"descriptionTemplate":"{name} is a {bedrooms}-bedroom {propertyType} in {area}, sleeping up to {guests} guests.\n\nThe space\n{bedrooms} bedrooms and {bathrooms} bathrooms.\nParking: {parking}.\nOutside: {garden}.\n\nGuest access\nSelf check-in, with your instructions sent before you arrive.\n\nManaged by Recharge, with a fresh clean, fresh linen and towels, and local support for every stay.","houseRules":"No smoking.\nNo parties or events.\nNo pets unless agreed in advance.\nQuiet hours from 10pm to 8am.\nPlease respect the neighbours.","checkInFrom":15,"checkInTo":22,"checkOut":10,"minNights":2,"guestsPerBedroom":2,"cleaningFeeMinor":0}$json$::jsonb
$fn$;
create table if not exists private.workspace_listing_settings (
 singleton boolean primary key default true check (singleton),
 content jsonb not null default private.workspace_listing_settings_default() check (jsonb_typeof(content)='object' and pg_column_size(content)<32768),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
insert into private.workspace_listing_settings(singleton) values(true) on conflict do nothing;
create table if not exists private.workspace_listing_drafts (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 fields jsonb not null check (jsonb_typeof(fields)='object' and pg_column_size(fields)<32768),
 status text not null default 'draft' check (status in ('draft','publishing','published','changed','failed')),
 publish_request uuid, approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
 published_by uuid references auth.users(id) on delete set null, published_at timestamptz,
 last_error text check (char_length(last_error)<=1000),
 version integer not null default 1,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table if not exists private.workspace_listing_photos (
 id uuid primary key,
 property_id uuid not null references public.workspace_properties(id) on delete cascade,
 path text not null unique check (path~'^listings/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
 name text not null check (char_length(btrim(name)) between 1 and 200),
 mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
 bytes bigint not null check (bytes between 1 and 15728640),
 caption text not null default '' check (char_length(caption)<=300),
 sort integer not null default 0,
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 removed_at timestamptz
);
create index if not exists workspace_listing_photos_property on private.workspace_listing_photos(property_id) where removed_at is null;
-- A property deleted with its photos: their stored copies are queued for removal, as an enquiry's files are.
create or replace function private.workspace_listing_photo_gone() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if old.removed_at is null then
  insert into private.workspace_storage_removals(bucket,path,reason,queued_by)
   select 'lead-files',old.path,'listing_photo.deleted',(select p.user_id from public.workspace_profiles p where p.user_id=auth.uid());
 end if;
 return old;
end $fn$;
drop trigger if exists workspace_listing_photo_gone on private.workspace_listing_photos;
create trigger workspace_listing_photo_gone after delete on private.workspace_listing_photos for each row execute function private.workspace_listing_photo_gone();
revoke all on function private.workspace_listing_photo_gone() from public,anon,authenticated,service_role;
alter table private.workspace_listing_settings enable row level security;
alter table private.workspace_listing_drafts enable row level security;
alter table private.workspace_listing_photos enable row level security;
revoke all on private.workspace_listing_settings,private.workspace_listing_drafts,private.workspace_listing_photos from public,anon,authenticated,service_role;

create or replace function private.workspace_listing_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select private.workspace_listing_settings_default()||coalesce((select s.content from private.workspace_listing_settings s where s.singleton),'{}')
$$;
create or replace function private.workspace_listing_person(who uuid) returns text language sql stable security definer set search_path='' as $$
 select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=who
$$;

-- 2. The draft onboarding fills in.
create or replace function private.workspace_listing_prefill(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare p public.workspace_properties;j private.workspace_journeys;s jsonb;e jsonb;a jsonb;parts text[];area text;guests integer;beds integer;
 vals jsonb;line text;kept text[]:='{}';k text;ok boolean;descr text;access text;begin
 select * into p from public.workspace_properties where id=prop;
 select * into j from private.workspace_journeys where property_id=prop;
 s:=private.workspace_listing_settings();
 e:=coalesce(j.enquiry,'{}');
 a:=coalesce((select ce.answers from private.workspace_client_enquiries ce where ce.property_id=prop and ce.answers is not null order by ce.sent_at desc limit 1),'{}');
 parts:=array(select btrim(x) from unnest(regexp_split_to_array(coalesce(p.address,''),'\s*[\n,]\s*')) x where btrim(x)<>'');
 if cardinality(parts)>0 then parts[cardinality(parts)]:=btrim(regexp_replace(parts[cardinality(parts)],'\m[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\s*$',''));end if;
 parts:=array(select x from unnest(parts) x where x<>'');
 area:=case when cardinality(parts)>1 then array_to_string(parts[2:],', ') else coalesce(parts[1],'') end;
 beds:=greatest(coalesce(p.bedrooms,0),1);
 guests:=least(40,greatest(1,beds*(s->>'guestsPerBedroom')::integer));
 vals:=jsonb_build_object('name',coalesce(p.name,''),'propertyType',lower(coalesce(j.property_type,'')),'bedrooms',coalesce(p.bedrooms,0)::text,
  'bathrooms',coalesce(j.bathrooms,0)::text,'guests',guests::text,'area',area,
  'parking',coalesce(nullif(btrim(e->>'parking'),''),nullif(btrim(a->>'parking'),''),''),
  'garden',coalesce(nullif(btrim(e->>'garden'),''),nullif(btrim(a->>'garden'),''),''));
 -- Each line of the template, filled in; a line whose placeholder has nothing to fill it is left out.
 foreach line in array string_to_array(s->>'descriptionTemplate',E'\n') loop
  ok:=true;
  for k in select jsonb_object_keys(vals) loop
   if position('{'||k||'}' in line)>0 then
    if coalesce(vals->>k,'')='' then ok:=false;else line:=replace(line,'{'||k||'}',vals->>k);end if;
   end if;
  end loop;
  if ok then kept:=kept||line;end if;
 end loop;
 descr:=btrim(regexp_replace(array_to_string(kept,E'\n'),E'\n{3,}',E'\n\n','g'),E' \n');
 access:=coalesce((select x.access_instructions from private.workspace_property_secrets x where x.property_id=prop),'');
 return jsonb_build_object(
  'name',left(coalesce(p.name,''),200),
  'externalName',left(btrim(coalesce(p.bedrooms,0)::text||' bed '||lower(coalesce(j.property_type,'home'))||case when area<>'' then ' in '||area else '' end),100),
  'description',left(descr,5000),'address',left(coalesce(p.address,''),1000),'propertyType',left(coalesce(j.property_type,''),120),
  'bedrooms',least(40,coalesce(p.bedrooms,0)),'bathrooms',least(40,coalesce(j.bathrooms,0)),'beds',least(80,beds),'guests',guests,
  'nightlyMinor',least(10000000,greatest(0,coalesce((j.estimate->>'mediumRateMinor')::bigint,0))),'cleaningFeeMinor',(s->>'cleaningFeeMinor')::bigint,
  'minNights',(s->>'minNights')::integer,'checkInFrom',(s->>'checkInFrom')::integer,'checkInTo',(s->>'checkInTo')::integer,'checkOut',(s->>'checkOut')::integer,
  'houseRules',left(s->>'houseRules',5000),'wifiName','','wifiPassword','','accessCode','','checkInInstructions',left(access,3000));
end $fn$;

-- 3. Reading. The team who see enquiries; the draft from the set-up form onwards.
create or replace function private.workspace_listing_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();j private.workspace_journeys;p public.workspace_properties;d private.workspace_listing_drafts;pre jsonb;
 status text;stage_ok boolean;elsewhere boolean;begin
 if actor is null or not private.workspace_can_enquiries() then raise exception 'Property not found' using errcode='42501';end if;
 select * into j from private.workspace_journeys where property_id=prop;
 if j.property_id is null then raise exception 'Property not found' using errcode='42501';end if;
 select * into p from public.workspace_properties where id=prop;
 select * into d from private.workspace_listing_drafts where property_id=prop;
 pre:=private.workspace_listing_prefill(prop);
 -- A publish that never came back (the server stopped half way) can be approved again after five minutes.
 status:=case when d.status='publishing' and d.approved_at<now()-interval '5 minutes' then 'failed' else coalesce(d.status,'draft') end;
 stage_ok:=j.stage in ('form','invoice','inspection_to_book','inspection_booked','inspection_complete','live');
 elsewhere:=p.hostaway_listing_id is not null and d.published_at is null;
 return jsonb_build_object('propertyId',prop,'stage',j.stage,'fields',case when d.property_id is null then pre else pre||d.fields end,'prefill',pre,
  'saved',d.property_id is not null,'status',status,'hostawayListingId',p.hostaway_listing_id,'linkedElsewhere',elsewhere,
  'publishedAt',d.published_at,'publishedByName',private.workspace_listing_person(d.published_by),
  'lastError',case when status='failed' then coalesce(d.last_error,'Hostaway did not answer. Approve it again.') end,
  'updatedAt',d.updated_at,'updatedByName',private.workspace_listing_person(d.updated_by),'version',coalesce(d.version,0),
  'photos',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'caption',x.caption,'sort',x.sort,'sent',x.sent_at is not null) order by x.sort,x.created_at,x.id)
   from private.workspace_listing_photos x where x.property_id=prop and x.removed_at is null),'[]'),
  'canEdit',stage_ok and status<>'publishing' and not elsewhere,
  'canPublish',stage_ok and status<>'publishing' and not elsewhere and actor in ('admin','super_admin'));
end $fn$;
create or replace function private.workspace_listing_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();st private.workspace_listing_settings;begin
 if actor is null or not private.workspace_can_enquiries() then raise exception 'Client enquiries access required' using errcode='42501';end if;
 select * into st from private.workspace_listing_settings where singleton;
 return jsonb_build_object('settings',private.workspace_listing_settings(),'canEditSettings',actor in ('admin','super_admin'),
  'settingsUpdatedAt',case when st.updated_by is not null then st.updated_at end,'settingsUpdatedByName',private.workspace_listing_person(st.updated_by),
  'listing',case when target is null then null else private.workspace_listing_view(target) end);
end $fn$;

-- 4. Checks.
create or replace function private.workspace_listing_check_fields(f jsonb) returns void language plpgsql immutable set search_path='' as $fn$
declare k text;lim integer;lo bigint;hi bigint;begin
 if jsonb_typeof(f) is distinct from 'object' then raise exception 'Invalid listing' using errcode='22023';end if;
 perform private.workspace_json_keys(f,array['name','externalName','description','address','propertyType','bedrooms','bathrooms','beds','guests','nightlyMinor',
  'cleaningFeeMinor','minNights','checkInFrom','checkInTo','checkOut','houseRules','wifiName','wifiPassword','accessCode','checkInInstructions'],30000);
 foreach k in array array['name','externalName','description','address','propertyType','houseRules','wifiName','wifiPassword','accessCode','checkInInstructions'] loop
  lim:=case k when 'name' then 200 when 'externalName' then 100 when 'address' then 1000 when 'propertyType' then 120 when 'checkInInstructions' then 3000
   when 'description' then 5000 when 'houseRules' then 5000 else 200 end;
  if jsonb_typeof(f->k) is distinct from 'string' or char_length(f->>k)>lim then raise exception 'Check the listing''s %',k using errcode='22023';end if;
 end loop;
 foreach k in array array['bedrooms','bathrooms','beds','guests','nightlyMinor','cleaningFeeMinor','minNights','checkInFrom','checkInTo','checkOut'] loop
  lo:=case k when 'guests' then 1 when 'minNights' then 1 else 0 end;
  hi:=case k when 'bedrooms' then 40 when 'bathrooms' then 40 when 'beds' then 80 when 'guests' then 40 when 'minNights' then 365
   when 'checkInFrom' then 23 when 'checkInTo' then 23 when 'checkOut' then 23 else 10000000 end;
  if jsonb_typeof(f->k) is distinct from 'number' or (f->>k)::numeric<>floor((f->>k)::numeric) or (f->>k)::numeric not between lo and hi then
   raise exception 'Check the listing''s %',k using errcode='22023';end if;
 end loop;
end $fn$;
-- What has to be there before an admin approves (lib/hostaway-listing.ts listingMissing says the same).
create or replace function private.workspace_listing_missing(f jsonb,photos integer) returns text[] language sql immutable set search_path='' as $$
 select array_remove(array[
  case when char_length(btrim(f->>'name'))<2 then 'Internal name' end,
  case when char_length(btrim(f->>'externalName'))<5 then 'Listing title guests see' end,
  case when char_length(btrim(f->>'description'))<50 then 'Description' end,
  case when char_length(btrim(f->>'address'))<5 then 'Address' end,
  case when (f->>'nightlyMinor')::bigint<100 then 'Base nightly price' end,
  case when (f->>'checkInTo')::integer<(f->>'checkInFrom')::integer then 'Check-in times' end,
  case when photos<1 then 'Photos' end],null)
$$;

-- 5. Actions. saveDraft, removePhoto and addPhoto (the server, after storing the file) for the team who see enquiries;
-- publish and saveSettings for admins.
create or replace function private.workspace_listing_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;prop uuid;view jsonb;
 d private.workspace_listing_drafts;p public.workspace_properties;s jsonb;x jsonb;n integer;ph private.workspace_listing_photos;missing text[];photos jsonb;payload jsonb;k text;lo bigint;hi bigint;begin
 if actor is null then raise exception 'Workspace access required' using errcode='42501';end if;
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(me::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=me and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if input->>'action'='saveSettings' then
  perform private.workspace_json_keys(input,array['action','requestId','settings'],30000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change the listing settings' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' or exists(select 1 from jsonb_object_keys(private.workspace_listing_settings_default()) z where not s ? z)
   or exists(select 1 from jsonb_object_keys(s) z where not private.workspace_listing_settings_default() ? z) then raise exception 'Invalid listing settings' using errcode='22023';end if;
  if jsonb_typeof(s->'descriptionTemplate') is distinct from 'string' or char_length(btrim(s->>'descriptionTemplate')) not between 1 and 5000 then raise exception 'Write the description' using errcode='22023';end if;
  if jsonb_typeof(s->'houseRules') is distinct from 'string' or char_length(s->>'houseRules')>5000 then raise exception 'House rules can be up to 5000 characters' using errcode='22023';end if;
  foreach k in array array['checkInFrom','checkInTo','checkOut','minNights','guestsPerBedroom','cleaningFeeMinor'] loop
   lo:=case k when 'minNights' then 1 when 'guestsPerBedroom' then 1 else 0 end;
   hi:=case k when 'minNights' then 365 when 'guestsPerBedroom' then 10 when 'cleaningFeeMinor' then 10000000 else 23 end;
   if jsonb_typeof(s->k) is distinct from 'number' or (s->>k)::numeric<>floor((s->>k)::numeric) or (s->>k)::numeric not between lo and hi then
    raise exception 'Check the listing settings: %',k using errcode='22023';end if;
  end loop;
  update private.workspace_listing_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_listing_read(null);
 elsif input->>'action' in ('saveDraft','removePhoto','addPhoto','publish') then
  begin prop:=(input->>'propertyId')::uuid; exception when others then prop:=null; end;
  if prop is null then raise exception 'Property not found' using errcode='42501';end if;
  perform 1 from public.workspace_properties where id=prop for update;
  view:=private.workspace_listing_view(prop);
  select * into d from private.workspace_listing_drafts where property_id=prop;
  if input->>'action'='publish' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId']);
   if actor not in ('admin','super_admin') then raise exception 'Only admins can approve a listing' using errcode='42501';end if;
   if (view->>'linkedElsewhere')::boolean then raise exception 'This property is already linked to a Hostaway listing. Change it in Hostaway.' using errcode='22023';end if;
   if not (view->>'canPublish')::boolean then raise exception 'The listing can be approved from the set-up form onwards' using errcode='22023';end if;
   if d.property_id is null then raise exception 'Save the listing first' using errcode='22023';end if;
   missing:=private.workspace_listing_missing(view->'fields',jsonb_array_length(view->'photos'));
   if cardinality(missing)>0 then raise exception 'Fill in the listing first: %',array_to_string(missing,', ') using errcode='22023';end if;
   update private.workspace_listing_drafts set status='publishing',publish_request=req,approved_by=me,approved_at=now(),last_error=null where property_id=prop;
   -- Photos go with a new listing only.
   photos:=case when d.published_at is null then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'path',x.path,'caption',x.caption) order by x.sort,x.created_at,x.id)
    from private.workspace_listing_photos x where x.property_id=prop and x.removed_at is null),'[]') else '[]' end;
   payload:=jsonb_build_object('send',true,'requestId',req,'propertyId',prop,'hostawayListingId',case when d.published_at is not null then view->>'hostawayListingId' end,
    'fields',view->'fields','photos',photos);
   -- The receipt never says "send" again: a repeated press does not post twice.
   insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,jsonb_build_object('send',false,'listing',private.workspace_listing_view(prop)));
   return payload;
  end if;
  if not (view->>'canEdit')::boolean then
   raise exception '%',case when (view->>'linkedElsewhere')::boolean then 'This property is already linked to a Hostaway listing. Change it in Hostaway.'
    when view->>'status'='publishing' then 'The listing is being sent to Hostaway. Try again in a moment.' else 'The listing can be prepared from the set-up form onwards' end using errcode='22023';end if;
  if input->>'action'='saveDraft' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','fields','photos'],60000);
   perform private.workspace_listing_check_fields(input->'fields');
   if jsonb_typeof(input->'photos') is distinct from 'array' or jsonb_array_length(input->'photos')>40 then raise exception 'Invalid photos' using errcode='22023';end if;
   n:=0;
   for x in select * from jsonb_array_elements(input->'photos') loop
    n:=n+1;
    perform private.workspace_json_keys(x,array['id','caption']);
    if coalesce(x->>'id','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(x->'caption') is distinct from 'string' or char_length(x->>'caption')>300 then raise exception 'Invalid photos' using errcode='22023';end if;
    update private.workspace_listing_photos set sort=n,caption=btrim(x->>'caption') where id=(x->>'id')::uuid and property_id=prop and removed_at is null;
    if not found then raise exception 'A photo was removed. Refresh and try again.' using errcode='22023';end if;
   end loop;
   insert into private.workspace_listing_drafts(property_id,fields,status,updated_by,updated_at) values(prop,input->'fields','draft',me,now())
    on conflict(property_id) do update set fields=excluded.fields,updated_by=me,updated_at=now(),version=private.workspace_listing_drafts.version+1,
     status=case when private.workspace_listing_drafts.published_at is not null then 'changed' else 'draft' end;
   result:=private.workspace_listing_read(prop);
  elsif input->>'action'='addPhoto' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','photoId','name','mime','bytes','path']);
   if actor not in ('stays','admin','super_admin') then raise exception 'Client enquiries access required' using errcode='42501';end if;
   if (select count(*) from private.workspace_listing_photos x where x.property_id=prop and x.removed_at is null)>=40 then raise exception 'Up to 40 photos on a listing' using errcode='22023';end if;
   if coalesce(input->>'path','')<>'listings/'||prop||'/'||(input->>'photoId')||'.'||(case input->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'x' end) then
    raise exception 'Invalid photo' using errcode='22023';end if;
   insert into private.workspace_listing_photos(id,property_id,path,name,mime,bytes,sort,created_by)
    values((input->>'photoId')::uuid,prop,input->>'path',btrim(input->>'name'),input->>'mime',(input->>'bytes')::bigint,
     coalesce((select max(x.sort) from private.workspace_listing_photos x where x.property_id=prop and x.removed_at is null),0)+1,me);
   result:=private.workspace_listing_read(prop);
  else
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','photoId']);
   update private.workspace_listing_photos set removed_at=now() where id=(input->>'photoId')::uuid and property_id=prop and removed_at is null returning * into ph;
   if ph.id is null then raise exception 'Photo not found' using errcode='22023';end if;
   -- The server deletes the stored copy (removedPath), then drops the key before answering.
   result:=private.workspace_listing_read(prop)||jsonb_build_object('removedPath',ph.path);
  end if;
 else
  raise exception 'Unknown listing action' using errcode='22023';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

-- 6. What Hostaway said (the server only). Links the listing to the property and tells the team.
create or replace function private.workspace_listing_publish_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare prop uuid;req uuid;d private.workspace_listing_drafts;ok boolean;listing text;err text;first boolean;begin
 perform private.workspace_json_keys(input,array['requestId','propertyId','ok','hostawayListingId','error','photoIds']);
 begin prop:=(input->>'propertyId')::uuid;req:=(input->>'requestId')::uuid; exception when others then raise exception 'Invalid listing result' using errcode='22023'; end;
 select * into d from private.workspace_listing_drafts where property_id=prop and publish_request=req and status='publishing' for update;
 if d.property_id is null then return jsonb_build_object('recorded',false);end if;
 ok:=coalesce((input->>'ok')::boolean,false);
 listing:=nullif(btrim(coalesce(input->>'hostawayListingId','')),'');
 err:=left(coalesce(nullif(btrim(input->>'error'),''),'Hostaway did not accept the listing'),1000);
 first:=d.published_at is null;
 if ok and (listing is null or listing!~'^[A-Za-z0-9._:-]{1,100}$') then ok:=false;err:='Hostaway did not return a listing ID';end if;
 if ok then
  begin
   update public.workspace_properties set hostaway_listing_id=listing,version=version+1,updated_at=now() where id=prop and coalesce(hostaway_listing_id,listing)=listing;
   if not found then ok:=false;err:='The property is linked to a different Hostaway listing';end if;
  exception when unique_violation then
   ok:=false;err:='Hostaway made listing '||listing||', but another property in Recharge is already linked to it. Link them in the Property database.';
  end;
 end if;
 if ok then
  update private.workspace_listing_drafts set status='published',published_at=now(),published_by=d.approved_by,last_error=null where property_id=prop;
  update private.workspace_listing_photos set sent_at=now() where property_id=prop and removed_at is null and sent_at is null
   and id::text in (select jsonb_array_elements_text(coalesce(input->'photoIds','[]')));
  perform private.workspace_followup_note(prop,case when first then 'Listing created in Hostaway (listing '||listing||'). Connect it to the channels in Hostaway.' else 'Listing updated in Hostaway.' end,d.approved_by);
  perform private.workspace_followup_tell(prop,'listing.published',now());
 else
  update private.workspace_listing_drafts set status='failed',last_error=err where property_id=prop;
  perform private.workspace_followup_note(prop,'The listing could not be sent to Hostaway: '||err,d.approved_by);
 end if;
 return jsonb_build_object('recorded',true,'ok',ok);
end $fn$;

-- Opening one photo (the server makes a 10-minute link): the team who see the draft.
create or replace function private.workspace_listing_photo(prop uuid,photo uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare x private.workspace_listing_photos;begin
 perform private.workspace_listing_view(prop);
 select * into x from private.workspace_listing_photos f where f.id=photo and f.property_id=prop and f.removed_at is null;
 if x.id is null then raise exception 'Photo not found' using errcode='42501';end if;
 return jsonb_build_object('path',x.path,'name',x.name,'mime',x.mime);
end $fn$;
create or replace function public.workspace_listing_photo(prop uuid,photo uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_listing_photo(prop,photo);$$;

create or replace function public.workspace_listing_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_listing_read(target);$$;
create or replace function public.workspace_listing_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_listing_action(input);$$;
create or replace function public.workspace_listing_publish_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_listing_publish_result(input);$$;
revoke all on function private.workspace_listing_settings_default(),private.workspace_listing_settings(),private.workspace_listing_person(uuid),private.workspace_listing_prefill(uuid),
 private.workspace_listing_view(uuid),private.workspace_listing_read(uuid),private.workspace_listing_check_fields(jsonb),private.workspace_listing_missing(jsonb,integer),
 private.workspace_listing_action(jsonb),private.workspace_listing_publish_result(jsonb),private.workspace_listing_photo(uuid,uuid),public.workspace_listing_photo(uuid,uuid),
 public.workspace_listing_read(uuid),public.workspace_listing_action(jsonb),public.workspace_listing_publish_result(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_listing_read(uuid),public.workspace_listing_read(uuid),private.workspace_listing_photo(uuid,uuid),public.workspace_listing_photo(uuid,uuid),private.workspace_listing_action(jsonb),public.workspace_listing_action(jsonb) to authenticated;
grant execute on function private.workspace_listing_publish_result(jsonb),public.workspace_listing_publish_result(jsonb) to service_role;
