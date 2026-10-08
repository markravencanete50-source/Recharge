-- Each property's listings, kept up to date after it goes live: the platform, the public link and
-- the listing's ID on that platform or in the channel manager. With the IDs recorded, bookings and
-- guest messages from the channel manager can be matched to the right property once it is
-- connected. Stays and admins with the property database tool edit them. Safe to run more than once.
create or replace function private.workspace_save_listing_links(prop uuid, links jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
 if jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links)>12 then raise exception 'Up to 12 listings' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(links) loop
  perform private.workspace_json_keys(entry,array['platform','url','listingId']);
  if coalesce(entry->>'platform','') not in ('Airbnb','Booking.com','Vrbo','Direct','Channel manager','Comfy Workers') then raise exception 'Choose the platform for each listing' using errcode='22023';end if;
  if coalesce(entry->>'url','')<>'' and (char_length(entry->>'url')>1000 or entry->>'url' !~ '^https://[^/@[:space:]]+([/:?#]|$)') then raise exception 'Listing links must start with https://' using errcode='22023';end if;
  if coalesce(entry->>'listingId','')<>'' and entry->>'listingId' !~ '^[A-Za-z0-9._:-]{1,100}$' then raise exception 'Listing IDs use letters, numbers, dots, dashes or colons' using errcode='22023';end if;
  if coalesce(entry->>'url','')='' and coalesce(entry->>'listingId','')='' then raise exception 'Give each listing a link or an ID' using errcode='22023';end if;
 end loop;
 insert into private.workspace_listing_links(property_id,links) values(prop,
   (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('platform',e->>'platform','url',nullif(e->>'url',''),'listingId',nullif(e->>'listingId','')))),'[]') from jsonb_array_elements(links) e))
  on conflict(property_id) do update set links=excluded.links;
 return jsonb_build_object('propertyId',prop,'links',(select l.links from private.workspace_listing_links l where l.property_id=prop));
end $$;
revoke all on function private.workspace_save_listing_links(uuid,jsonb) from public,anon,authenticated;

do $$
declare definition text;
 anchor constant text := $q$ elsif a='recordLocalEvent' then$q$;
begin
 definition:=pg_get_functiondef('private.workspace_portfolio_action(jsonb)'::regprocedure);
 if position('workspace_save_listing_links' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'Patch anchor missing in workspace_portfolio_action'; end if;
  execute replace(definition,anchor,$q$ elsif a='saveListingLinks' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','links']);
  result:=private.workspace_save_listing_links(prop,input->'links');
$q$||anchor);
 end if;
end $$;
