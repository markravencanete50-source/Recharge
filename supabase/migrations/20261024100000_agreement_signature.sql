-- Agreements you can edit and sign with a drawn signature (Lee: "upload an agreement file there and once uploaded we
-- can edit each wordings or letters at the same time there should be an option to sign the agreement not only the full
-- name"; houseoflettings' SignaturePad and SignAgreementClient are the reference).
--  * publishAgreement from the contract in use may carry the team's edited wording: the contract fills the agreement in,
--    the team changes any words before publishing, and the edited text is what the owner signs (still recorded against
--    the contract it came from). Without "agreement" the contract fills it in as before.
--  * Typed or uploaded wording (no contract in use) can be in the outline format (headings and lists, as a Word
--    document is read), "format":"outline". Agreements can now be up to 200,000 characters, as long as a contract.
--  * signAgreement may carry signatureImage: the owner's drawn signature, a PNG data URL of up to 200,000 characters,
--    kept on the journey beside the typed name (private.workspace_journeys.signed_signature) and shown on the journey
--    as signatureImage, so the signed copy carries it.
--  * The journey also shows agreementSentAt, when Recharge last published the agreement (from the activity), so the
--    owner's Mailbox can say "Recharge sent the management agreement for your property" with its date.
--  * Both actions check their keys with the larger limit (private.workspace_json_keys with 450,000 bytes), since a whole
--    agreement or a drawing is far bigger than the usual 16 KB request.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (publishAgreement and
-- signAgreement) and private.workspace_journey_view (its fields), keeping the text 20261020870000's own checks look for, so
-- that migration still runs again cleanly. Adds one column. Safe to run twice.

alter table private.workspace_journeys add column if not exists signed_signature text;
do $c$ begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_journeys'::regclass and conname='workspace_journeys_signed_signature') then
  alter table private.workspace_journeys add constraint workspace_journeys_signed_signature
   check(signed_signature is null or (length(signed_signature)<=200000 and signed_signature ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'));
 end if;
end $c$;

-- The drawn signature on signAgreement, checked, or null when the owner only typed their name.
create or replace function private.workspace_agreement_signature(input jsonb) returns text
language plpgsql immutable security definer set search_path='' as $fn$
begin
 if not input ? 'signatureImage' or jsonb_typeof(input->'signatureImage')='null' then return null;end if;
 if jsonb_typeof(input->'signatureImage')<>'string' or length(input->>'signatureImage')>200000
  or input->>'signatureImage' !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
  raise exception 'Draw your signature again' using errcode='22023';end if;
 return input->>'signatureImage';
end $fn$;
revoke all on function private.workspace_agreement_signature(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
 fixes constant text[][] := array[
  -- publishAgreement takes format.
  ['private.workspace_journey_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement','templateId']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement','templateId']||array['format']/* agreement editing keys: 20261024100000 */,450000);$q$,
   $q$/* agreement editing keys: 20261024100000 */$q$],
  -- The contract's wording, edited by the team before publishing.
  ['private.workspace_journey_action(jsonb)',
   $q$if input ? 'agreement' then raise exception 'Use the contract or your own wording, not both' using errcode='22023'; end if;$q$,
   $q$/* agreement editing contract: 20261024100000 */$q$,
   $q$/* agreement editing contract: 20261024100000 */$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$set agreement=private.workspace_agreement_fill(target,agreement_template),$q$,
   $q$set agreement=case when input ? 'agreement' then private.workspace_required_text(input,'agreement',20,200000) else private.workspace_agreement_fill(target,agreement_template) end/* agreement editing edited: 20261024100000 */,$q$,
   $q$/* agreement editing edited: 20261024100000 */$q$],
  -- Typed or uploaded wording: longer, and in the outline format when asked.
  ['private.workspace_journey_action(jsonb)',
   $q$set agreement=private.workspace_required_text(input,'agreement',20,10000),agreement_template_id=null,agreement_format='text',$q$,
   $q$set agreement=private.workspace_required_text(input,'agreement',20,200000),agreement_template_id=null,agreement_format=case when input->>'format'='outline' then 'outline' else 'text' end/* agreement editing typed: 20261024100000 */,$q$,
   $q$/* agreement editing typed: 20261024100000 */$q$],
  -- signAgreement takes the drawn signature.
  ['private.workspace_journey_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreementRevision','signedName','consent']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreementRevision','signedName','consent']||array['signatureImage']/* agreement signature keys: 20261024100000 */,450000);$q$,
   $q$/* agreement signature keys: 20261024100000 */$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$set signed_name=private.workspace_required_text(input,'signedName',2,200),signed_at=now(),$q$,
   $q$set signed_name=private.workspace_required_text(input,'signedName',2,200),signed_signature=private.workspace_agreement_signature(input)/* agreement signature set: 20261024100000 */,signed_at=now(),$q$,
   $q$/* agreement signature set: 20261024100000 */$q$],
  -- The journey shows it.
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'agreementFormat',j.agreement_format,$q$,
   $q$'agreementFormat',j.agreement_format,'signatureImage',j.signed_signature/* agreement signature view: 20261024100000 */,
 'agreementSentAt',(select max(a.created_at) from public.workspace_activity a where a.property_id=j.property_id and a.event_type='journey.publishAgreement'),$q$,
   $q$/* agreement signature view: 20261024100000 */$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
