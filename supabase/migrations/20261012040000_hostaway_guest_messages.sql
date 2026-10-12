-- Hostaway guest messages: conversations come into the Guest inbox by themselves (read only;
-- nothing is sent to Hostaway). The backend asks which conversations changed, fetches only those,
-- and stores them through workspace_hostaway_messages_ingest, which reuses workspace_guest_messages_ingest.
-- Like the reservation sync it is refused while the sync is paused.

-- Hostaway's "latest activity" text for the conversation, exactly as it gave it, so only changed
-- conversations are fetched (compared as text: no time zone to get wrong).
alter table private.workspace_guest_threads add column if not exists remote_marker text check(remote_marker is null or length(remote_marker)<=100);

-- Which of the newest conversations need their messages fetched: new ones, and ones whose marker moved.
create function private.workspace_hostaway_conversations_due(input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k<>'conversations') then raise exception 'Invalid conversations' using errcode='22023';end if;
 if jsonb_typeof(input->'conversations')<>'array' or jsonb_array_length(input->'conversations')>500 or exists(select 1 from jsonb_array_elements(input->'conversations') c
  where jsonb_typeof(c)<>'object' or jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or length(coalesce(c->>'marker',''))>100) then raise exception 'Invalid conversations' using errcode='22023';end if;
 if (select paused from private.workspace_hostaway_sync_state where singleton) then return jsonb_build_object('due','[]'::jsonb,'paused',true);end if;
 return jsonb_build_object('paused',false,'due',coalesce((select jsonb_agg(x.id order by x.n) from (
   select distinct on (e.c->>'id') e.c->>'id' id,e.n from jsonb_array_elements(input->'conversations') with ordinality e(c,n)
   where not exists(select 1 from private.workspace_guest_threads t where t.source='hostaway' and t.thread_ref=e.c->>'id' and t.remote_marker is not distinct from nullif(e.c->>'marker',''))
   order by e.c->>'id',e.n) x),'[]'::jsonb));
end $$;

-- Stores conversations and their messages from the last 14 days. A conversation new to Recharge whose
-- newest message is over 24 hours old starts as Done, so the first import doesn't flood Waiting.
create function private.workspace_hostaway_messages_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c jsonb; m jsonb; prop uuid; res private.workspace_reservations; has_res boolean; msgs jsonb; known boolean;
 v_channel text; v_in date; v_out date; v_ref text; added integer:=0; touched integer:=0; one jsonb;
begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k<>'conversations') or octet_length(input::text)>5000000 then raise exception 'Invalid conversations' using errcode='22023';end if;
 if jsonb_typeof(input->'conversations')<>'array' or jsonb_array_length(input->'conversations')>100 then raise exception 'Invalid conversations' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(input->'conversations') loop
  if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100
   or length(coalesce(c->>'listingId',''))>100 or length(coalesce(c->>'reservationId',''))>100 or length(coalesce(c->>'guestName',''))>120 or length(coalesce(c->>'marker',''))>100
   or coalesce(c->>'checkIn','2000-01-01')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(c->>'checkOut','2000-01-01')!~'^\d{4}-\d{2}-\d{2}$'
   or coalesce(c->>'channel','other') not in ('airbnb','booking_com','vrbo','direct','whatsapp','email','other')
   or jsonb_typeof(c->'messages')<>'array' or jsonb_array_length(c->'messages')>300 then raise exception 'Invalid conversations' using errcode='22023';end if;
  for m in select value from jsonb_array_elements(c->'messages') loop
   if jsonb_typeof(m)<>'object' or jsonb_typeof(m->'id') is distinct from 'string' or length(m->>'id') not between 1 and 100 or jsonb_typeof(m->'incoming') is distinct from 'boolean'
    or jsonb_typeof(m->'body') is distinct from 'string' or length(m->>'body')>20000
    or coalesce(m->>'sentAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Invalid conversations' using errcode='22023';end if;
  end loop;
 end loop;
 if (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway sync is paused' using errcode='55000';end if;
 -- One import at a time.
 perform pg_advisory_xact_lock(hashtextextended('hostaway-messages',0));

 for c in select value from jsonb_array_elements(input->'conversations') loop
  select id into prop from public.workspace_properties where hostaway_listing_id=nullif(c->>'listingId','');
  select * into res from private.workspace_reservations where source='hostaway' and reference='HA:'||nullif(c->>'reservationId','');
  has_res:=found;
  if has_res then prop:=coalesce(prop,res.property_id);end if;
  -- The stay wins over what the conversation says about dates and platform.
  v_channel:=coalesce(case when has_res then res.channel end,c->>'channel','other');
  v_in:=coalesce(case when has_res then res.check_in end,(c->>'checkIn')::date);
  v_out:=coalesce(case when has_res then res.check_out end,(c->>'checkOut')::date);
  v_ref:=case when has_res then left(coalesce(res.channel_reference,res.reference),100) end;
  known:=exists(select 1 from private.workspace_guest_threads where source='hostaway' and thread_ref=c->>'id');
  -- Only the last 14 days, and only messages not stored yet (so a done conversation isn't reopened by an old message).
  select coalesce(jsonb_agg(jsonb_build_object('externalId',x.m->>'id','threadRef',c->>'id','propertyId',prop,'channel',v_channel,'direction',case when (x.m->>'incoming')::boolean then 'guest' else 'team' end,
    'sentAt',x.m->>'sentAt','body',x.m->>'body','guestName',nullif(trim(c->>'guestName'),''),'reservationRef',v_ref,'checkIn',v_in,'checkOut',v_out) order by (x.m->>'sentAt')::timestamptz),'[]'::jsonb) into msgs
   from jsonb_array_elements(c->'messages') x(m)
   where (x.m->>'sentAt')::timestamptz between now()-interval '14 days' and now()+interval '5 minutes'
    and not exists(select 1 from private.workspace_guest_messages g where g.source='hostaway' and g.external_id=x.m->>'id');
  if not known and jsonb_array_length(msgs)=0 then continue;end if; -- nothing recent to show
  if jsonb_array_length(msgs)>0 then
   one:=private.workspace_guest_messages_ingest(jsonb_build_object('source','hostaway','messages',msgs));
   added:=added+(one->>'added')::integer;
  end if;
  if not known then
   update private.workspace_guest_threads set status='done' where source='hostaway' and thread_ref=c->>'id' and last_message_at<now()-interval '24 hours';
  end if;
  -- Remember the marker, and a property that has become known since.
  update private.workspace_guest_threads set remote_marker=nullif(left(c->>'marker',100),''),property_id=coalesce(property_id,prop) where source='hostaway' and thread_ref=c->>'id';
  if prop is not null then update private.workspace_guest_messages set property_id=prop where source='hostaway' and thread_ref=c->>'id' and property_id is null;end if;
  touched:=touched+1;
 end loop;
 return jsonb_build_object('added',added,'conversations',touched);
end $$;

create function public.workspace_hostaway_conversations_due(input jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.workspace_hostaway_conversations_due(input);$$;
create function public.workspace_hostaway_messages_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_hostaway_messages_ingest(input);$$;
revoke all on function private.workspace_hostaway_conversations_due(jsonb),public.workspace_hostaway_conversations_due(jsonb),
 private.workspace_hostaway_messages_ingest(jsonb),public.workspace_hostaway_messages_ingest(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_hostaway_conversations_due(jsonb),public.workspace_hostaway_conversations_due(jsonb),
 private.workspace_hostaway_messages_ingest(jsonb),public.workspace_hostaway_messages_ingest(jsonb) to service_role;
