-- Property ratings (Lee: "Can we get the ratings for each property?"). Guest review ratings for each property, from
-- Hostaway, with the reviews the team logs by hand.
--  * private.workspace_hostaway_reviews keeps every guest review Hostaway lists, keyed by Hostaway's review id: the listing
--    and the property it is linked to (property_id; null while the listing is not linked to a property, and the review is
--    still kept), the channel, the rating and its scale exactly as Hostaway gave them (out of 5 or out of 10; how the scale
--    is chosen is in lib/hostaway-reviews-policy.ts), stars (the rating on a 5-star scale, worked out here), the review's
--    words, date and link, and when it was last synced. Hostaway's reviews of guests are never stored.
--  * private.workspace_hostaway_reviews_ingest(jsonb), for the backend's service role only: one batch of reviews. Insert or
--    update only (nothing is deleted), so running a batch twice changes nothing. Each review is linked to the property
--    with its listing, and every stored review is linked again when a listing's property changes. Refused quietly (paused)
--    while the Hostaway sync is paused. It runs hourly from the Worker's cron, straight after that tick's reservation
--    sync, and after an admin's "Sync now" (lib/hostaway-sync.ts runHostawayReviews).
--  * private.workspace_hostaway_reviews_failed(jsonb), service role only: records a failed run on the reviews' own state,
--    so it never overwrites the reservation sync's last error.
--  * private.workspace_property_ratings(uuid) and its public wrapper: every visible property's average stars, number of
--    reviews and the last 90 days' average; for one property also the figures by channel and the latest reviews with
--    words. The team's own logged reviews (operations of kind guest_review) count too, marked as logged by the team: they
--    are separate items, so nothing is counted twice. Admins, super admins and Guest relations (stays) see every property;
--    anyone else on the team sees the properties they are assigned to; owners (client) are refused, in one marked check.
-- New: tables private.workspace_hostaway_reviews and private.workspace_hostaway_review_state; functions
--   private.workspace_hostaway_reviews_ingest(jsonb), private.workspace_hostaway_reviews_failed(jsonb) and their public
--   wrappers (service role only); private.workspace_property_ratings(uuid) and public.workspace_property_ratings(uuid)
--   (signed-in people; the function decides who sees what).
-- No existing function is changed. No DROP, no DELETE. Safe to run twice.

create table if not exists private.workspace_hostaway_reviews (
 hostaway_id text primary key check(length(hostaway_id) between 1 and 100),
 listing_id text check(listing_id is null or length(listing_id) between 1 and 100),
 property_id uuid references public.workspace_properties(id) on delete set null,
 channel text not null default 'other' check(channel in ('airbnb','booking_com','vrbo','direct','other')),
 channel_name text check(channel_name is null or length(channel_name)<=60),
 rating numeric(5,2) check(rating is null or rating>0),
 scale smallint check(scale is null or scale in (5,10)),
 stars numeric(4,2) generated always as (case when rating is not null and scale is not null then round(rating*5/scale,2) end) stored,
 review_text text check(review_text is null or length(review_text)<=4000),
 reviewed_at timestamptz,
 review_url text check(review_url is null or (length(review_url)<=1000 and review_url ~ '^https://')),
 status text check(status is null or length(status)<=40),
 first_synced_at timestamptz not null default now(),
 synced_at timestamptz not null default now(),
 constraint workspace_hostaway_reviews_rating_scale check((rating is null and scale is null) or (rating is not null and scale is not null and rating<=scale))
);
create index if not exists workspace_hostaway_reviews_property on private.workspace_hostaway_reviews(property_id,reviewed_at desc);
create index if not exists workspace_hostaway_reviews_listing on private.workspace_hostaway_reviews(listing_id);
alter table private.workspace_hostaway_reviews enable row level security;
revoke all on private.workspace_hostaway_reviews from public,anon,authenticated;

-- When the reviews last synced, and what went wrong if the last run failed (shown on the Ratings report).
create table if not exists private.workspace_hostaway_review_state (
 singleton boolean primary key default true check(singleton),
 last_run_at timestamptz, last_success_at timestamptz,
 last_trigger text check(last_trigger is null or last_trigger in ('schedule','manual')),
 last_error text check(last_error is null or length(last_error)<=500),
 complete boolean not null default true,
 last_summary jsonb not null default '{}'
);
insert into private.workspace_hostaway_review_state(singleton) values(true) on conflict(singleton) do nothing;
alter table private.workspace_hostaway_review_state enable row level security;
revoke all on private.workspace_hostaway_review_state from public,anon,authenticated;

-- One batch of reviews from the backend: {trigger, reviews:[...], done, complete}. `done` marks the run's last batch.
create or replace function private.workspace_hostaway_reviews_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r jsonb; prop uuid; prev private.workspace_hostaway_reviews; v_rating numeric; v_scale smallint; v_at timestamptz; v_listing text; v_channel text;
 v_name text; v_text text; v_url text; v_status text; added integer:=0; changed integer:=0; unchanged integer:=0;
begin
 if jsonb_typeof(input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('trigger','reviews','done','complete'))
  or coalesce(input->>'trigger','') not in ('schedule','manual') or jsonb_typeof(input->'reviews') is distinct from 'array' or jsonb_array_length(input->'reviews')>500
  or jsonb_typeof(coalesce(input->'done','false')) is distinct from 'boolean' or jsonb_typeof(coalesce(input->'complete','true')) is distinct from 'boolean'
  or octet_length(input::text)>3000000 then raise exception 'Invalid reviews' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(input->'reviews') loop
  if jsonb_typeof(r) is distinct from 'object' or exists(select 1 from jsonb_object_keys(r) k where k not in ('id','listingId','channel','channelName','rating','scale','text','reviewedAt','url','status'))
   or jsonb_typeof(r->'id') is distinct from 'string' or length(r->>'id') not between 1 and 100
   or coalesce(jsonb_typeof(r->'listingId'),'null') not in ('string','null') or length(coalesce(r->>'listingId','x')) not between 1 and 100
   or coalesce(r->>'channel','') not in ('airbnb','booking_com','vrbo','direct','other')
   or coalesce(jsonb_typeof(r->'channelName'),'null') not in ('string','null') or length(coalesce(r->>'channelName',''))>60
   or coalesce(jsonb_typeof(r->'rating'),'null') not in ('number','null') or coalesce(jsonb_typeof(r->'scale'),'null') not in ('number','null')
   or (jsonb_typeof(r->'rating')='number') is distinct from (jsonb_typeof(r->'scale')='number')
   or (jsonb_typeof(r->'scale')='number' and (r->>'scale') not in ('5','10'))
   or (jsonb_typeof(r->'rating')='number' and ((r->>'rating')::numeric<=0 or (r->>'rating')::numeric>(r->>'scale')::numeric))
   or coalesce(jsonb_typeof(r->'text'),'null') not in ('string','null') or length(coalesce(r->>'text',''))>4000
   or coalesce(jsonb_typeof(r->'reviewedAt'),'null') not in ('string','null')
   or coalesce(r->>'reviewedAt','2000-01-01T00:00:00Z')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   or coalesce(jsonb_typeof(r->'url'),'null') not in ('string','null') or (r->>'url' is not null and (length(r->>'url')>1000 or r->>'url'!~'^https://'))
   or coalesce(jsonb_typeof(r->'status'),'null') not in ('string','null') or length(coalesce(r->>'status',''))>40
   then raise exception 'Invalid reviews' using errcode='22023';end if;
 end loop;
 -- Nothing comes in while the sync is paused (no channel manager connected); the backend stops quietly.
 if (select paused from private.workspace_hostaway_sync_state where singleton) then
  return jsonb_build_object('added',0,'changed',0,'unchanged',0,'paused',true);
 end if;
 -- One run at a time.
 perform pg_advisory_xact_lock(hashtextextended('hostaway-reviews',0));

 for r in select value from jsonb_array_elements(input->'reviews') loop
  v_listing:=nullif(r->>'listingId','');
  select p.id into prop from public.workspace_properties p where p.hostaway_listing_id=v_listing;
  if not found then prop:=null;end if;
  v_rating:=(r->>'rating')::numeric;v_scale:=(r->>'scale')::smallint;v_channel:=r->>'channel';
  v_name:=nullif(btrim(coalesce(r->>'channelName','')),'');v_text:=nullif(btrim(coalesce(r->>'text','')),'');
  v_url:=r->>'url';v_status:=nullif(btrim(coalesce(r->>'status','')),'');
  v_at:=(r->>'reviewedAt')::timestamptz;
  if v_at is not null and (v_at<'2000-01-01'::timestamptz or v_at>now()+interval '1 day') then v_at:=null;end if;
  select * into prev from private.workspace_hostaway_reviews where hostaway_id=r->>'id' for update;
  if not found then
   insert into private.workspace_hostaway_reviews(hostaway_id,listing_id,property_id,channel,channel_name,rating,scale,review_text,reviewed_at,review_url,status)
   values(r->>'id',v_listing,prop,v_channel,v_name,v_rating,v_scale,v_text,v_at,v_url,v_status);
   added:=added+1;
  elsif (prev.listing_id,prev.property_id,prev.channel,prev.channel_name,prev.rating,prev.scale,prev.review_text,prev.reviewed_at,prev.review_url,prev.status)
    is distinct from (v_listing,prop,v_channel,v_name,v_rating,v_scale,v_text,v_at,v_url,v_status) then
   update private.workspace_hostaway_reviews set listing_id=v_listing,property_id=prop,channel=v_channel,channel_name=v_name,rating=v_rating,scale=v_scale,
    review_text=v_text,reviewed_at=v_at,review_url=v_url,status=v_status,synced_at=now() where hostaway_id=prev.hostaway_id;
   changed:=changed+1;
  else
   update private.workspace_hostaway_reviews set synced_at=now() where hostaway_id=prev.hostaway_id;
   unchanged:=unchanged+1;
  end if;
 end loop;

 -- Reviews stored earlier follow their listing: linked once the listing is linked to a property, unlinked if it no longer is.
 update private.workspace_hostaway_reviews h set property_id=p.id from public.workspace_properties p
  where p.hostaway_listing_id=h.listing_id and h.property_id is distinct from p.id;
 update private.workspace_hostaway_reviews h set property_id=null
  where h.property_id is not null and not exists(select 1 from public.workspace_properties p where p.id=h.property_id and p.hostaway_listing_id is not distinct from h.listing_id);

 update private.workspace_hostaway_review_state set last_run_at=now(),last_trigger=input->>'trigger' where singleton;
 if coalesce((input->>'done')::boolean,false) then
  update private.workspace_hostaway_review_state set last_success_at=now(),last_error=null,complete=coalesce((input->>'complete')::boolean,true),
   last_summary=jsonb_build_object('reviews',(select count(*) from private.workspace_hostaway_reviews),
    'unlinked',(select count(*) from private.workspace_hostaway_reviews where property_id is null)) where singleton;
 end if;
 return jsonb_build_object('added',added,'changed',changed,'unchanged',unchanged,'paused',false);
end $fn$;

-- The backend records a failed run (Hostaway unreachable, keys rejected) without changing any review.
create or replace function private.workspace_hostaway_reviews_failed(input jsonb) returns void language plpgsql security definer set search_path='' as $fn$
begin
 if jsonb_typeof(input) is distinct from 'object' or coalesce(input->>'trigger','') not in ('schedule','manual') then raise exception 'Invalid sync trigger' using errcode='22023';end if;
 if (select paused from private.workspace_hostaway_sync_state where singleton) then return;end if;
 update private.workspace_hostaway_review_state set last_run_at=now(),last_trigger=input->>'trigger',last_error=left(coalesce(input->>'error','Hostaway reviews could not be synced'),500) where singleton;
end $fn$;

create or replace function public.workspace_hostaway_reviews_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_hostaway_reviews_ingest(input);$$;
create or replace function public.workspace_hostaway_reviews_failed(input jsonb) returns void language sql security invoker set search_path='' as $$select private.workspace_hostaway_reviews_failed(input);$$;
revoke all on function private.workspace_hostaway_reviews_ingest(jsonb),public.workspace_hostaway_reviews_ingest(jsonb),
 private.workspace_hostaway_reviews_failed(jsonb),public.workspace_hostaway_reviews_failed(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_hostaway_reviews_ingest(jsonb),public.workspace_hostaway_reviews_ingest(jsonb),
 private.workspace_hostaway_reviews_failed(jsonb),public.workspace_hostaway_reviews_failed(jsonb) to service_role;

-- Each visible property's ratings, or one property's in full (target_property). Stars are out of 5. A review counts in the
-- figures once it has a rating; the team's logged reviews (guest_review operations, not cancelled) count alongside
-- Hostaway's, marked source 'team'. "Last 90 days" is the 90 days to today in London, by the review's date.
create or replace function private.workspace_property_ratings(target_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role(); me uuid:=auth.uid(); everything boolean; today date:=(now() at time zone 'Europe/London')::date;
 s private.workspace_hostaway_review_state; result jsonb;
begin
 if actor is null then raise exception 'Ratings access denied' using errcode='42501';end if;
 -- OWNERS (client): not shown ratings for now; Lee decides later. This is the one place that decides it. To show owners
 -- their own properties' ratings, remove this check: an owner's assigned properties then pass the assignment rule below
 -- once it also accepts the 'client' assignment.
 if actor='client' then raise exception 'Ratings are not shown to owners' using errcode='42501';end if;
 everything:=actor in ('admin','super_admin','stays');
 if target_property is not null and not exists(select 1 from public.workspace_properties p where p.id=target_property and p.status<>'archived'
   and (everything or exists(select 1 from public.workspace_property_assignments a where a.property_id=p.id and a.user_id=me and a.assignment<>'client'))) then
  raise exception 'Property access denied' using errcode='42501';
 end if;
 select * into s from private.workspace_hostaway_review_state where singleton;

 with visible as (
  select p.id,p.name,p.hostaway_listing_id from public.workspace_properties p
  where p.status<>'archived' and (target_property is null or p.id=target_property)
   and (everything or exists(select 1 from public.workspace_property_assignments a where a.property_id=p.id and a.user_id=me and a.assignment<>'client'))
 ), reviews as (
  select h.property_id,'hostaway'::text source,h.channel,h.stars,h.rating,h.scale::integer scale,(h.reviewed_at at time zone 'Europe/London')::date reviewed_on,
   h.review_text body,h.review_url url,h.hostaway_id ref
  from private.workspace_hostaway_reviews h join visible v on v.id=h.property_id where h.stars is not null
  union all
  select w.property_id,'team',case d.data->>'platform' when 'Airbnb' then 'airbnb' when 'Booking.com' then 'booking_com' when 'Direct' then 'direct' else 'other' end,
   round((d.data->>'rating')::numeric*5/(d.data->>'outOf')::numeric,2),(d.data->>'rating')::numeric,(d.data->>'outOf')::integer,(d.data->>'reviewedOn')::date,
   nullif(btrim(d.data->>'summary'),''),null,w.id::text
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join visible v on v.id=w.property_id
  where d.kind='guest_review' and w.status<>'cancelled' and d.data->>'outOf' in ('5','10') and coalesce(d.data->>'rating','')~'^\d{1,2}(\.\d+)?$'
   and (d.data->>'rating')::numeric>0 and (d.data->>'rating')::numeric<=(d.data->>'outOf')::numeric and coalesce(d.data->>'reviewedOn','')~'^\d{4}-\d{2}-\d{2}$'
 ), figures as (
  select v.id,v.name,v.hostaway_listing_id is not null linked,count(r.stars)::int n,round(avg(r.stars),2) average,
   count(r.stars) filter(where r.reviewed_on>today-90)::int recent_n,round(avg(r.stars) filter(where r.reviewed_on>today-90),2) recent_average,
   count(*) filter(where r.source='hostaway')::int hostaway_n,count(*) filter(where r.source='team')::int team_n,max(r.reviewed_on) latest_on
  from visible v left join reviews r on r.property_id=v.id group by v.id,v.name,v.hostaway_listing_id
 )
 select jsonb_build_object(
  'sync',jsonb_build_object('lastRunAt',s.last_run_at,'lastSuccessAt',s.last_success_at,'complete',s.complete,
   'lastError',case when everything then s.last_error end,
   'unlinked',case when everything then (select count(*) from private.workspace_hostaway_reviews where property_id is null and stars is not null) else 0 end),
  'properties',coalesce((select jsonb_agg(jsonb_build_object('propertyId',f.id,'propertyName',f.name,'linked',f.linked,'reviews',f.n,'average',f.average,
    'recentReviews',f.recent_n,'recentAverage',f.recent_average,'hostawayReviews',f.hostaway_n,'teamReviews',f.team_n,'latestOn',f.latest_on) order by f.name,f.id) from figures f),'[]'::jsonb),
  'property',case when target_property is null then null else jsonb_build_object(
   'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',x.channel,'reviews',x.n,'average',x.average) order by x.n desc,x.channel)
    from (select r.channel,count(*)::int n,round(avg(r.stars),2) average from reviews r group by r.channel) x),'[]'::jsonb),
   'latest',coalesce((select jsonb_agg(jsonb_build_object('source',x.source,'channel',x.channel,'stars',x.stars,'rating',x.rating,'scale',x.scale,
     'reviewedOn',x.reviewed_on,'text',x.body,'url',x.url) order by x.reviewed_on desc nulls last,x.ref desc)
    from (select * from reviews r where r.body is not null order by r.reviewed_on desc nulls last,r.ref desc limit 10) x),'[]'::jsonb)) end)
 into result;
 return result;
end $fn$;

create or replace function public.workspace_property_ratings(target_property uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.workspace_property_ratings(target_property);$$;
revoke all on function private.workspace_property_ratings(uuid),public.workspace_property_ratings(uuid) from public,anon,authenticated;
grant execute on function private.workspace_property_ratings(uuid),public.workspace_property_ratings(uuid) to authenticated;
