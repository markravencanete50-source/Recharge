-- Launch Preparation: each safety document Recharge organise is confirmed as kept in the property's binder (Business Plan
-- v1.0, 17/10/26, Tasks 2. Safety Compliance: "Also confirm this is stored in a binder in the property").
--  * Ticking (or renewing) a document Recharge organise needs the confirmation, alongside the certificate and its expiry
--    date; documents the owner looks after can say so too. Documents ticked before this keep their tick.
-- Replaces private.workspace_launch_check (20261029200000). Safe to run twice.

create or replace function private.workspace_launch_check(kind text,d jsonb,prop uuid,part_key text) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare st jsonb:=private.workspace_launch_settings();keys text[];begin
 if d is null then d:='{}';end if;
 if jsonb_typeof(d)<>'object' then raise exception 'Invalid details' using errcode='22023';end if;
 if kind='tick' then
  perform private.workspace_json_keys(d,array['note']);
  if jsonb_typeof(coalesce(d->'note','""')) <>'string' or char_length(coalesce(d->>'note',''))>1000 then raise exception 'Up to 1,000 characters in the note' using errcode='22023';end if;
  return jsonb_strip_nulls(jsonb_build_object('note',nullif(btrim(coalesce(d->>'note','')),'')));
 elsif kind='date' then
  perform private.workspace_json_keys(d,array['on','access']);
  if coalesce(d->>'on','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the inspection date' using errcode='22023';end if;
  perform (d->>'on')::date;
  if jsonb_typeof(d->'access') is distinct from 'string' or char_length(btrim(d->>'access'))<3 or char_length(d->>'access')>2000 then raise exception 'Say how to get into the property' using errcode='22023';end if;
  return jsonb_build_object('on',d->>'on','access',btrim(d->>'access'));
 elsif kind='condition' then
  perform private.workspace_json_keys(d,array['ticks']);
  keys:=array(select x->>'key' from jsonb_array_elements(st->'condition') x);
  if jsonb_typeof(d->'ticks') is distinct from 'array' or exists(select 1 from unnest(keys) k where not (d->'ticks') ? k) then
   raise exception 'Tick every condition statement. Anything that cannot be ticked goes to property maintenance first.' using errcode='22023';end if;
  return jsonb_build_object('ticks',to_jsonb(keys));
 elsif kind='expiry' then
  perform private.workspace_json_keys(d,array['expiresOn','binder']);
  if coalesce(d->>'expiresOn','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the expiry date' using errcode='22023';end if;
  if (d->>'expiresOn')::date<=private.workspace_launch_today() then raise exception 'This document has expired. Renew it first.' using errcode='22023';end if;
  if coalesce((st->>'requireComplianceFile')::boolean,true) and not exists(select 1 from private.workspace_launch_files f where f.property_id=prop and f.step=part_key) then
   raise exception 'Upload the certificate first' using errcode='22023';end if;
  -- A document Recharge organise is also confirmed as kept in the property's binder (20261030300000).
  if (select z->>'who' from jsonb_array_elements(private.workspace_launch_plan(prop)) z where z->>'key'=part_key)='recharge' and d->'binder' is distinct from 'true'::jsonb then
   raise exception 'Confirm a copy is in the property''s binder' using errcode='22023';end if;
  return jsonb_strip_nulls(jsonb_build_object('expiresOn',d->>'expiresOn','binder',case when d->'binder'='true'::jsonb then true end));
 elsif kind='licence' then
  perform private.workspace_json_keys(d,array['required','number']);
  if jsonb_typeof(d->'required') is distinct from 'boolean' then raise exception 'Say whether the property needs a licence' using errcode='22023';end if;
  if (d->>'required')::boolean and (jsonb_typeof(d->'number') is distinct from 'string' or char_length(btrim(d->>'number')) not between 2 and 120) then raise exception 'Enter the licence number' using errcode='22023';end if;
  return jsonb_build_object('required',(d->>'required')::boolean,'number',case when (d->>'required')::boolean then btrim(d->>'number') end);
 end if;
 raise exception 'This part is ticked by the app' using errcode='22023';
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Choose a real date' using errcode='22023';
end $fn$;

revoke all on function private.workspace_launch_check(text,jsonb,uuid,text) from public,anon,authenticated,service_role;
