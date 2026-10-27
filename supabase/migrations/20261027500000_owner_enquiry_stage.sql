-- An existing client's New property enquiry in the app (Recharge Business Plan v1.0, "Existing Client Estimate Request";
-- Phase 1): the form captures the property address, bedrooms, WCs, photos and videos and the stage they're at. The stage
-- ("Stage you're at", stored as enquiryType, the same choices as the website form) is new here: createEnquiry takes it and an
-- owner's enquiry records it in Client enquiries, where the Leads ticket shows it as it does for the website form.
-- Existing functions patched in place (each anchor must be found once; skipped once patched): private.workspace_journey_action,
-- private.workspace_owner_enquiry_record. No data is changed. Safe to run twice.
do $patch$
declare
 -- function, anchor, replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$'enquiry','startWhen']);$q$,
   $q$'enquiryType','enquiry','startWhen']);$q$,
   $q$'enquiryType','enquiry','startWhen']);$q$],
  ['private.workspace_owner_enquiry_record(uuid,jsonb)',
   $q$raise exception 'Choose when you would like to get started' using errcode='22023';$q$,
   $q$raise exception 'Choose when you would like to get started' using errcode='22023';
 end if;
 /* stage you're at: 20261027500000 */ if input ? 'enquiryType' and (jsonb_typeof(input->'enquiryType') is distinct from 'string'
   or input->>'enquiryType' not in ('','I''d like a free performance estimate','I''m ready to get started','My property is already a short-term let and I want a new manager',
    'I''m thinking about switching from long-term letting','I''m just exploring my options','Something else')) then
  raise exception 'Choose the stage you''re at' using errcode='22023';$q$,
   $q$stage you're at: 20261027500000$q$],
  ['private.workspace_owner_enquiry_record(uuid,jsonb)',
   $q$'startWhen',nullif(input->>'startWhen','')));$q$,
   $q$'startWhen',nullif(input->>'startWhen',''),'enquiryType',nullif(input->>'enquiryType','')));$q$,
   $q$'enquiryType',nullif(input->>'enquiryType','')$q$]
 ];
 def text;i integer;n integer;
begin
 for i in 1..array_length(fixes,1) loop
  def:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in def)>0 then continue;end if;
  n:=(length(def)-length(replace(def,fixes[i][2],'')))/length(fixes[i][2]);
  if n<>1 then raise exception 'Owner enquiry stage patch: % has the anchor % time(s), expected 1',fixes[i][1],n;end if;
  execute replace(def,fixes[i][2],fixes[i][3]);
 end loop;
end $patch$;
