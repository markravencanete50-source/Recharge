-- The onboarding package (Recharge Business Plan v1.0, "Build Onboarding Package"; Phase 2).
--  * After the owner goes ahead, they build their package like a questionnaire, for each part of getting the property
--    ready (set-up, broadband, utilities, safety compliance, licensing, garden, waste): Recharge does it, or they do. Then
--    the operator information (who owns or operates the property, the payout account, the automatic repair limit and
--    preferred repair contacts) and a summary of what is included and what they added. "Proceed to signing" submits it.
--  * Every question, note, price, list and video is an admin's setting (private.workspace_package_settings).
--  * Payout details go where the set-up form puts them (private.workspace_bank_details) and never come back in full.
--  * The consultant publishes the agreement once the package is in; the agreement is filled in from it (new placeholders:
--    Operator name, Payout account name, Payout sort code, Payout account ending, Repair limit, Preferred repair contact,
--    Onboarding package, Onboarding fee).
--  * Signing opens the fee (migration 20261027300000) at the included fee plus the chosen extras, listed on the ticket.
--  * After signing, the set-up form takes the package's answers; the owner adds only what the package did not ask. A garden
--    maintenance task is made only when they asked for a quote.
-- Existing functions patched in place (each anchor must be found once; skipped once patched): private.workspace_journey_action,
-- private.workspace_journey_view, private.workspace_agreement_values, private.workspace_agreement_fill,
-- private.workspace_onboarding_fee_open, private.workspace_property_chat_milestone. private.workspace_agreement_placeholders
-- is replaced. No data is changed. Safe to run twice.

-- 1. The settings and the packages.
create or replace function private.workspace_package_settings_default() returns jsonb language sql immutable set search_path='' as $fn$
 select $json${"intro":{"note":"We will now guide you through each part of getting your property ready for guests. For each one, choose whether you would like Recharge to do it or to do it yourself. You can come back and change your answers until you sign the agreement.","video":""},"setUp":{"on":true,"question":"Would you like Recharge to make sure the property has all the right inventory and is in a rentable condition?","note":"If you would like us to, a furnishing inspection is carried out once your onboarding fee is settled, and we tell you what the property needs.","video":"","rechargeNote":"We will carry out a furnishing inspection once your onboarding fee is settled.","selfNote":"You will make sure the property has everything it needs and is in a rentable condition."},"broadband":{"on":true,"question":"Is there broadband installed at the property?","note":"Due to the nature of broadband contracts, we do not sign clients up to broadband.","video":"","guide":"Choose a provider with a fast, reliable connection: at least 50 Mbps for up to three bedrooms and 100 Mbps for larger homes, with no data limit. A 12 or 24 month contract is usual.","installQuestion":"Once you have signed up to your broadband package, would you like Recharge to install it into the property?","priceMinor":5000},"utilities":{"on":true,"question":"Have the utilities been set up at the property, and moved to a credit meter if it was on prepayment?","note":"Due to the nature of the contracts, we do not sign clients up to utilities. We recommend Octopus for all your properties: they allow several properties on the same log-in, which makes them very easy to access and set up.","video":"","understand":"I understand the utilities must be set up, on a credit meter, before the property can be guest ready."},"compliance":{"on":true,"question":"Do you have your safety compliance in place? Choose any you would like Recharge to organise.","note":"Anything you do not choose, you organise and upload yourself.","video":"","documents":["EICR","Gas Safety","PAT Testing","EPC","Legionella","Interlinked smoke, heat and carbon monoxide alarms"],"priceMinor":1000},"licensing":{"on":true,"question":"Would you like License to Let to contact you about your property licensing?","note":"Recharge work with License to Let, a specialist short-term let licensing company. There is no financial affiliation with this recommendation. License to Let charge £399 for a full licence application and £299 for a temporary one.","video":""},"garden":{"on":true,"question":"Does your property have a garden?","note":"","video":"","quoteQuestion":"Would you like Recharge to obtain a quote for regular garden maintenance?","selfNote":"We will assume you will look after the garden yourself."},"waste":{"on":true,"question":"Does your property have private or communal waste bins?","note":"","video":"","communalNote":"Housekeeping will put the property’s waste in the communal bins.","privateNote":"Waste from a short-term let counts as commercial waste and is not collected by the council. We partner with a waste collection company who empty the bins every week.","monthlyMinor":9500},"operator":{"note":"Who owns or operates the property, and where your payouts go. Your automatic repair limit and preferred contacts for repair work are set here too. These details fill in your management agreement.","video":""},"summary":{"included":["Pricing strategy","Listing creation and preparation","Photography","Property inspection","First month’s consumables"],"note":"Check your package, then proceed to signing. You can still change your answers until you sign."}}$json$::jsonb
$fn$;
create table if not exists private.workspace_package_settings (
 singleton boolean primary key default true check (singleton),
 content jsonb not null default private.workspace_package_settings_default() check (jsonb_typeof(content)='object' and pg_column_size(content)<65536),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
insert into private.workspace_package_settings(singleton) values(true) on conflict do nothing;
create table if not exists private.workspace_onboarding_packages (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 answers jsonb not null default '{}' check (jsonb_typeof(answers)='object' and pg_column_size(answers)<32768),
 submitted_at timestamptz,
 submitted_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
alter table private.workspace_package_settings enable row level security;
alter table private.workspace_onboarding_packages enable row level security;
revoke all on private.workspace_package_settings,private.workspace_onboarding_packages from public,anon,authenticated;

create or replace function private.workspace_package_settings() returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce((select s.content from private.workspace_package_settings s where s.singleton),private.workspace_package_settings_default())
$fn$;

-- 2. What a package comes to: the included fee (the onboarding fee setting), the chosen extras, and the monthly ones.
create or replace function private.workspace_package_lines(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare s jsonb:=private.workspace_package_settings();a jsonb;lines jsonb:='[]';monthly jsonb:='[]';extras bigint:=0;doc text;base bigint;begin
 a:=coalesce((select k.answers from private.workspace_onboarding_packages k where k.property_id=prop),'{}');
 base:=(select f.amount_minor from private.workspace_onboarding_fee_settings f where f.singleton);
 if (s#>>'{broadband,on}')::boolean and a->'broadbandInstalled'='false'::jsonb and a->'broadbandRecharge'='true'::jsonb then
  lines:=lines||jsonb_build_array(jsonb_build_object('label','Broadband installation','amountMinor',(s#>>'{broadband,priceMinor}')::bigint));
  extras:=extras+(s#>>'{broadband,priceMinor}')::bigint;
 end if;
 if (s#>>'{compliance,on}')::boolean and jsonb_typeof(a->'complianceRecharge')='array' then
  for doc in select x from jsonb_array_elements_text(a->'complianceRecharge') x where s#>'{compliance,documents}' ? x loop
   lines:=lines||jsonb_build_array(jsonb_build_object('label','Organise '||doc,'amountMinor',(s#>>'{compliance,priceMinor}')::bigint));
   extras:=extras+(s#>>'{compliance,priceMinor}')::bigint;
  end loop;
 end if;
 if (s#>>'{waste,on}')::boolean and a->>'waste'='private' and a->'wasteRecharge'='true'::jsonb then
  monthly:=jsonb_build_array(jsonb_build_object('label','Weekly waste collection','amountMinor',(s#>>'{waste,monthlyMinor}')::bigint));
 end if;
 return jsonb_build_object('included',s#>'{summary,included}','baseMinor',base,'extras',lines,'extrasMinor',extras,'monthly',monthly,
  'totalMinor',case when base is null then null else base+extras end);
end $fn$;

-- The fee for a property: the included fee plus the extras once a package is in (accounts fill it in when there is no fee).
create or replace function private.workspace_package_fee(prop uuid,base bigint) returns bigint language sql stable security definer set search_path='' as $fn$
 select case when base is null or not exists(select 1 from private.workspace_onboarding_packages k where k.property_id=prop and k.submitted_at is not null) then base
  else base+coalesce((private.workspace_package_lines(prop)->>'extrasMinor')::bigint,0) end
$fn$;
create or replace function private.workspace_package_invoice_text(prop uuid) returns text language sql stable security definer set search_path='' as $fn$
 select case when not exists(select 1 from private.workspace_onboarding_packages k where k.property_id=prop and k.submitted_at is not null) then ''
  else E'\n\nOnboarding package (each + VAT):\n- Included: '||(select string_agg(x,', ') from jsonb_array_elements_text(l->'included') x)
   ||coalesce(' ('||private.workspace_fee_money((l->>'baseMinor')::bigint)||')','')
   ||coalesce((select string_agg(E'\n- '||(e->>'label')||' ('||private.workspace_fee_money((e->>'amountMinor')::bigint)||')',''order by o) from jsonb_array_elements(l->'extras') with ordinality t(e,o)),'')
   ||coalesce((select string_agg(E'\n- Monthly, not on this invoice: '||(e->>'label')||' ('||private.workspace_fee_money((e->>'amountMinor')::bigint)||' a month)','') from jsonb_array_elements(l->'monthly') e),'') end
 from (select private.workspace_package_lines(prop) l) x
$fn$;

-- What the set-up form takes from a submitted package, and which of its keys that covers (the app asks the rest).
create or replace function private.workspace_package_form(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare k private.workspace_onboarding_packages;s jsonb:=private.workspace_package_settings();a jsonb;b private.workspace_bank_details;f jsonb:='{}';begin
 select * into k from private.workspace_onboarding_packages where property_id=prop and submitted_at is not null;
 if k.property_id is null then return '{}';end if;
 a:=k.answers;
 select * into b from private.workspace_bank_details where property_id=prop;
 if coalesce(a->>'operatorName','')<>'' then f:=f||jsonb_build_object('businessName',a->>'operatorName');end if;
 if b.property_id is not null then f:=f||jsonb_build_object('bankAccountName',b.account_name,'bankSortCode',b.sort_code,'bankAccountNumber',b.account_number);end if;
 if a ? 'fullRepairPermission' or a ? 'repairLimitMinor' then
  f:=f||jsonb_build_object('fullRepairPermission',coalesce((a->>'fullRepairPermission')::boolean,false),'repairLimitMinor',coalesce((a->>'repairLimitMinor')::bigint,0));
 end if;
 if a ? 'preferredRepairContact' then f:=f||jsonb_build_object('preferredRepairContact',a->>'preferredRepairContact');end if;
 if (s#>>'{setUp,on}')::boolean and a ? 'setUp' then f:=f||jsonb_build_object('furnishingChoice',a->>'setUp');end if;
 if (s#>>'{utilities,on}')::boolean and a ? 'utilitiesConnected' and a ? 'prepaymentMeters' then f:=f||jsonb_build_object('utilitiesConnected',a->'utilitiesConnected','prepaymentMeters',a->'prepaymentMeters');end if;
 if (s#>>'{broadband,on}')::boolean and a ? 'broadbandInstalled' then f:=f||jsonb_build_object('broadbandConnected',a->'broadbandInstalled');end if;
 if (s#>>'{licensing,on}')::boolean and a ? 'licensingContact' then f:=f||jsonb_build_object('licensingRequired',a->'licensingContact');end if;
 if (s#>>'{garden,on}')::boolean and a ? 'garden' then f:=f||jsonb_build_object('hasGarden',a->'garden','gardenQuote',coalesce(a->'gardenQuote','false'::jsonb));end if;
 return f;
end $fn$;
-- For the journey (the app's set-up form): when the package went in, and the form keys it already answers.
create or replace function private.workspace_package_brief(prop uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select case when k.property_id is null then null else jsonb_build_object('submittedAt',k.submitted_at,
  'formKeys',(select coalesce(jsonb_agg(x order by x),'[]') from jsonb_object_keys(private.workspace_package_form(prop)) x where x<>'gardenQuote'),
  'answers',k.answers-'operatorName'-'preferredRepairContact') end
 from (select 1) one left join private.workspace_onboarding_packages k on k.property_id=prop
$fn$;

-- The agreement's values from the package (empty until it is in).
create or replace function private.workspace_package_agreement_values(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare k private.workspace_onboarding_packages;b private.workspace_bank_details;l jsonb;extras text;begin
 select * into k from private.workspace_onboarding_packages where property_id=prop and submitted_at is not null;
 select * into b from private.workspace_bank_details where property_id=prop;
 if k.property_id is null then
  return jsonb_build_object('operator name','','payout account name','','payout sort code','','payout account ending','','repair limit','','preferred repair contact','','onboarding package','','onboarding fee','');
 end if;
 l:=private.workspace_package_lines(prop);
 extras:=(select string_agg((e->>'label')||' ('||private.workspace_fee_money((e->>'amountMinor')::bigint)||' + VAT)','; ' order by o) from jsonb_array_elements(l->'extras') with ordinality t(e,o));
 return jsonb_build_object(
  'operator name',coalesce(btrim(k.answers->>'operatorName'),''),
  'payout account name',coalesce(b.account_name,''),
  'payout sort code',coalesce(regexp_replace(b.sort_code,'^(\d{2})(\d{2})(\d{2})$','\1-\2-\3'),''),
  'payout account ending',coalesce(right(b.account_number,4),''),
  'repair limit',case when (k.answers->>'fullRepairPermission')::boolean then 'No limit' when k.answers ? 'repairLimitMinor' then private.workspace_fee_money((k.answers->>'repairLimitMinor')::bigint)||' per repair' else '' end,
  'preferred repair contact',coalesce(btrim(k.answers->>'preferredRepairContact'),''),
  'onboarding package','Included: '||(select string_agg(x,', ') from jsonb_array_elements_text(l->'included') x)||coalesce('. Added: '||extras,'')
   ||coalesce((select '. Monthly: '||string_agg((e->>'label')||' ('||private.workspace_fee_money((e->>'amountMinor')::bigint)||' a month + VAT)','; ') from jsonb_array_elements(l->'monthly') e),'')||'.',
  'onboarding fee',coalesce(private.workspace_fee_money((l->>'totalMinor')::bigint)||' + VAT',''));
end $fn$;

create or replace function private.workspace_agreement_placeholders() returns text[] language sql immutable set search_path='' as $fn$
 select array['Owner name','Owner email','Company name','Property name','Property address','Management fee','Start date','Operator name','Payout account name','Payout sort code','Payout account ending','Repair limit','Preferred repair contact','Onboarding package','Onboarding fee']
$fn$;

-- 3. Reading: the settings (anyone signed in: owners need the questions) and, for a property, its package (its owner, or
-- the team who see enquiries, and accounts, who pay owners out). Payout details only to the owner, admins and accounts, and never the full account number.
create or replace function private.workspace_package_view(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();j private.workspace_journeys;k private.workspace_onboarding_packages;b private.workspace_bank_details;
 is_owner boolean;owner_account boolean;begin
 select * into j from private.workspace_journeys where property_id=prop;
 if j.property_id is null then raise exception 'Property not found' using errcode='42501';end if;
 is_owner:=actor='client' and j.client_id=me;
 if not is_owner and not private.workspace_can_enquiries() and actor<>'accounts' then raise exception 'Property not found' using errcode='42501';end if;
 owner_account:=exists(select 1 from public.workspace_profiles x where x.user_id=j.client_id and x.role='client');
 select * into k from private.workspace_onboarding_packages where property_id=prop;
 select * into b from private.workspace_bank_details where property_id=prop;
 return jsonb_build_object('propertyId',prop,'answers',coalesce(k.answers,'{}'),'submittedAt',k.submitted_at,'updatedAt',k.updated_at,'stage',j.stage,
  'ownerRepairLimit',j.owner_repair_limit,
  'bank',case when b.property_id is not null and (is_owner or actor in ('admin','super_admin','accounts')) then jsonb_build_object('accountName',b.account_name,
   'sortCode',regexp_replace(b.sort_code,'^(\d{2})(\d{2})(\d{2})$','\1-\2-\3'),'last4',right(b.account_number,4)) end,
  'canEdit',j.stage='agreement' and j.signed_at is null and (is_owner or (not owner_account and actor in ('stays','admin','super_admin'))));
end $fn$;
create or replace function private.workspace_package_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();st private.workspace_package_settings;begin
 if actor is null then raise exception 'Workspace access required' using errcode='42501';end if;
 select * into st from private.workspace_package_settings where singleton;
 return jsonb_build_object('settings',private.workspace_package_settings(),'canEditSettings',actor in ('admin','super_admin'),
  'updatedAt',st.updated_at,'updatedByName',(select x.full_name from public.workspace_profiles x where x.user_id=st.updated_by),
  'baseMinor',(select f.amount_minor from private.workspace_onboarding_fee_settings f where f.singleton),
  'package',case when target is null then null else private.workspace_package_view(target) end);
end $fn$;

-- 4. Saving: the owner's package (as they go, then "Proceed to signing"), and an admin's settings.
create or replace function private.workspace_package_check(s jsonb,a jsonb,prop uuid,submit boolean) returns void language plpgsql stable security definer set search_path='' as $fn$
declare k text;missing text[]:='{}';begin
 perform private.workspace_json_keys(a,array['setUp','broadbandInstalled','broadbandRecharge','utilitiesConnected','prepaymentMeters','utilitiesUnderstood','complianceRecharge',
  'licensingContact','garden','gardenQuote','waste','wasteRecharge','operatorName','repairLimitMinor','fullRepairPermission','preferredRepairContact'],16000);
 foreach k in array array['broadbandInstalled','broadbandRecharge','utilitiesConnected','prepaymentMeters','utilitiesUnderstood','licensingContact','garden','gardenQuote','wasteRecharge','fullRepairPermission'] loop
  if a ? k and jsonb_typeof(a->k)<>'boolean' then raise exception 'Invalid onboarding package' using errcode='22023';end if;
 end loop;
 if (a ? 'setUp' and coalesce(a->>'setUp','') not in ('recharge','self')) or (a ? 'waste' and coalesce(a->>'waste','') not in ('communal','private'))
  or (a ? 'operatorName' and (jsonb_typeof(a->'operatorName')<>'string' or char_length(a->>'operatorName')>200))
  or (a ? 'preferredRepairContact' and (jsonb_typeof(a->'preferredRepairContact')<>'string' or char_length(a->>'preferredRepairContact')>2000))
  or (a ? 'repairLimitMinor' and (jsonb_typeof(a->'repairLimitMinor')<>'number' or (a->>'repairLimitMinor')::numeric<>floor((a->>'repairLimitMinor')::numeric) or (a->>'repairLimitMinor')::numeric not between 0 and 10000000))
  or (a ? 'complianceRecharge' and (jsonb_typeof(a->'complianceRecharge')<>'array' or jsonb_array_length(a->'complianceRecharge')>20
   or exists(select 1 from jsonb_array_elements(a->'complianceRecharge') x where jsonb_typeof(x)<>'string' or not (s#>'{compliance,documents}' ? (x#>>'{}'))))) then
  raise exception 'Invalid onboarding package' using errcode='22023';
 end if;
 if not submit then return;end if;
 if (s#>>'{setUp,on}')::boolean and not a ? 'setUp' then missing:=missing||'Property set-up'::text;end if;
 if (s#>>'{broadband,on}')::boolean and (not a ? 'broadbandInstalled' or (a->'broadbandInstalled'='false'::jsonb and not a ? 'broadbandRecharge')) then missing:=missing||'Broadband'::text;end if;
 if (s#>>'{utilities,on}')::boolean and (not a ? 'utilitiesConnected' or not a ? 'prepaymentMeters' or a->'utilitiesUnderstood' is distinct from 'true'::jsonb) then missing:=missing||'Utilities'::text;end if;
 if (s#>>'{compliance,on}')::boolean and not a ? 'complianceRecharge' then missing:=missing||'Safety compliance'::text;end if;
 if (s#>>'{licensing,on}')::boolean and not a ? 'licensingContact' then missing:=missing||'Licensing'::text;end if;
 if (s#>>'{garden,on}')::boolean and (not a ? 'garden' or (a->'garden'='true'::jsonb and not a ? 'gardenQuote')) then missing:=missing||'Garden maintenance'::text;end if;
 if (s#>>'{waste,on}')::boolean and (not a ? 'waste' or (a->>'waste'='private' and not a ? 'wasteRecharge')) then missing:=missing||'Waste collection'::text;end if;
 if char_length(btrim(coalesce(a->>'operatorName','')))<2 or not exists(select 1 from private.workspace_bank_details b where b.property_id=prop)
  or (not a ? 'repairLimitMinor' and a->'fullRepairPermission' is distinct from 'true'::jsonb) then missing:=missing||'Operator information'::text;end if;
 if cardinality(missing)>0 then raise exception 'Answer every part first: %',array_to_string(missing,', ') using errcode='22023';end if;
end $fn$;

create or replace function private.workspace_package_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;prop uuid;view jsonb;
 j private.workspace_journeys;was private.workspace_onboarding_packages;s jsonb;k text;b jsonb;submit boolean;begin
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
  perform private.workspace_json_keys(input,array['action','requestId','settings'],70000);
  if actor not in ('admin','super_admin') then raise exception 'Only admins can change the onboarding package' using errcode='42501';end if;
  s:=input->'settings';
  if jsonb_typeof(s) is distinct from 'object' or pg_column_size(s)>=65536 or exists(select 1 from jsonb_object_keys(private.workspace_package_settings_default()) d where not s ? d)
   or exists(select 1 from jsonb_object_keys(s) x where not private.workspace_package_settings_default() ? x) then raise exception 'Invalid onboarding package settings' using errcode='22023';end if;
  foreach k in array array['setUp','broadband','utilities','compliance','licensing','garden','waste'] loop
   if jsonb_typeof(s#>array[k,'on']) is distinct from 'boolean' or jsonb_typeof(s#>array[k,'question']) is distinct from 'string' or char_length(btrim(s#>>array[k,'question'])) not between 1 and 2000 then
    raise exception 'Write the question for each part' using errcode='22023';end if;
  end loop;
  foreach k in array array['{broadband,priceMinor}','{compliance,priceMinor}','{waste,monthlyMinor}'] loop
   if jsonb_typeof(s#>k::text[]) is distinct from 'number' or (s#>>k::text[])::numeric<>floor((s#>>k::text[])::numeric) or (s#>>k::text[])::numeric not between 0 and 10000000 then
    raise exception 'Enter each price in pounds, up to £100,000' using errcode='22023';end if;
  end loop;
  foreach k in array array['{compliance,documents}','{summary,included}'] loop
   if jsonb_typeof(s#>k::text[]) is distinct from 'array' or jsonb_array_length(s#>k::text[]) not between 1 and 20
    or exists(select 1 from jsonb_array_elements(s#>k::text[]) x where jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 300) then
    raise exception 'Each list needs 1 to 20 items' using errcode='22023';end if;
  end loop;
  update private.workspace_package_settings set content=s,updated_by=me,updated_at=now() where singleton;
  result:=private.workspace_package_read(null);
 elsif input->>'action'='savePackage' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','answers','bank','submit'],20000);
  begin prop:=(input->>'propertyId')::uuid; exception when others then prop:=null; end;
  if prop is null then raise exception 'Property not found' using errcode='42501';end if;
  view:=private.workspace_package_view(prop);
  if not (view->>'canEdit')::boolean then raise exception 'The package can be changed until the agreement is signed' using errcode='42501';end if;
  if jsonb_typeof(input->'submit') is distinct from 'boolean' or jsonb_typeof(input->'answers') is distinct from 'object' then raise exception 'Invalid onboarding package' using errcode='22023';end if;
  submit:=(input->>'submit')::boolean;
  select * into j from private.workspace_journeys where property_id=prop for update;
  if input ? 'bank' then
   b:=input->'bank';
   perform private.workspace_json_keys(b,array['accountName','sortCode','accountNumber']);
   if char_length(btrim(coalesce(b->>'accountName','')))not between 2 and 200 or coalesce(b->>'sortCode','')!~'^\d{2}-?\d{2}-?\d{2}$' or coalesce(b->>'accountNumber','')!~'^\d{8}$' then
    raise exception 'Check the payout account details' using errcode='22023';end if;
   perform private.workspace_store_bank_details(prop,j.client_id,jsonb_build_object('bankAccountName',b->>'accountName','bankSortCode',b->>'sortCode','bankAccountNumber',b->>'accountNumber'));
  end if;
  s:=private.workspace_package_settings();
  perform private.workspace_package_check(s,input->'answers',prop,submit);
  select * into was from private.workspace_onboarding_packages where property_id=prop;
  insert into private.workspace_onboarding_packages(property_id,answers,submitted_at,submitted_by,updated_by,updated_at)
   values(prop,input->'answers',case when submit then now() end,case when submit then me end,me,now())
   on conflict(property_id) do update set answers=excluded.answers,updated_by=me,updated_at=now(),
    submitted_at=case when submit then now() else private.workspace_onboarding_packages.submitted_at end,
    submitted_by=case when submit then me else private.workspace_onboarding_packages.submitted_by end;
  if submit then
   if was.submitted_at is null then
    perform private.workspace_followup_note(prop,'Onboarding package completed'||coalesce(', with '||(select string_agg(e->>'label',', ') from jsonb_array_elements(private.workspace_package_lines(prop)->'extras') e),'')||'.',me);
    perform private.workspace_property_chat_post(prop,'Onboarding package completed. Next: your management agreement.',null,'event',now());
   else
    perform private.workspace_followup_note(prop,'Onboarding package changed by '||case when actor='client' then 'the owner' else 'the team' end||
     case when j.agreement_revision>0 then '. Publish the agreement again so it shows the change.' else '.' end,me);
   end if;
   perform private.workspace_followup_tell(prop,'enquiry.package_submitted',now());
  end if;
  result:=private.workspace_package_read(prop);
 else
  raise exception 'Unknown onboarding package action' using errcode='22023';
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,actor_role,input,result) values(me,req,actor,input,result);
 return result;
end $fn$;

create or replace function public.workspace_package_read(target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_package_read(target);$$;
create or replace function public.workspace_package_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_package_action(input);$$;
revoke all on function private.workspace_package_settings_default(),private.workspace_package_settings(),private.workspace_package_lines(uuid),private.workspace_package_fee(uuid,bigint),
 private.workspace_package_invoice_text(uuid),private.workspace_package_form(uuid),private.workspace_package_brief(uuid),private.workspace_package_agreement_values(uuid),
 private.workspace_package_view(uuid),private.workspace_package_read(uuid),private.workspace_package_check(jsonb,jsonb,uuid,boolean),private.workspace_package_action(jsonb),
 public.workspace_package_read(uuid),public.workspace_package_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_package_read(uuid),public.workspace_package_read(uuid),private.workspace_package_action(jsonb),public.workspace_package_action(jsonb) to authenticated;

-- 5. Patches to existing functions.
do $patch$
declare
 -- function, anchor, replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  -- The agreement is published once the owner's package is in (an owner without an account has none: the team records it).
  ['private.workspace_journey_action(jsonb)',
   $q$then raise exception 'Agreement publishing denied' using errcode='42501'; end if;$q$,
   $q$then raise exception 'Agreement publishing denied' using errcode='42501'; end if;
   /* package first: 20261028100000 */ if exists(select 1 from public.workspace_profiles x where x.user_id=j.client_id and x.role='client')
    and not exists(select 1 from private.workspace_onboarding_packages k where k.property_id=target and k.submitted_at is not null) then
    raise exception 'The owner has not finished their onboarding package yet' using errcode='22023'; end if;$q$,
   $q$package first: 20261028100000$q$],
  -- The set-up form takes the package's answers; what the owner sends now wins.
  ['private.workspace_journey_action(jsonb)',
   $q$fields:=input->'form';$q$,
   $q$fields:=private.workspace_package_form(target)||coalesce(input->'form','{}')/* package form: 20261028100000 */;$q$,
   $q$package form: 20261028100000$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$'gasElectricMeters','operatingStatus']);$q$,
   $q$'gasElectricMeters','operatingStatus','gardenQuote']);$q$,
   $q$'operatingStatus','gardenQuote']);$q$],
  -- Garden maintenance only when they asked for a quote (the form alone has no such question: as before).
  ['private.workspace_journey_action(jsonb)',
   $q$if (fields->>'hasGarden')::boolean then perform private.workspace_handover($q$,
   $q$if (fields->>'hasGarden')::boolean and coalesce((fields->>'gardenQuote')::boolean,true) then perform private.workspace_handover($q$,
   $q$coalesce((fields->>'gardenQuote')::boolean,true)$q$],
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'questions',coalesce($q$,
   $q$'package',private.workspace_package_brief(j.property_id),'questions',coalesce($q$,
   $q$'package',private.workspace_package_brief(j.property_id)$q$],
  ['private.workspace_agreement_values(uuid)',
   $q$'start date',to_char((now() at time zone 'Europe/London')::date,'FMDD FMMonth YYYY'))$q$,
   $q$'start date',to_char((now() at time zone 'Europe/London')::date,'FMDD FMMonth YYYY'))||private.workspace_package_agreement_values(target)$q$,
   $q$||private.workspace_package_agreement_values(target)$q$],
  ['private.workspace_agreement_fill(uuid,uuid)',
   $q$concat_ws(E'\n','Management fee: '||nullif(v->>'management fee',''),'Start date: '||(v->>'start date'))];$q$,
   $q$concat_ws(E'\n','Management fee: '||nullif(v->>'management fee',''),'Start date: '||(v->>'start date')),
  /* package details: 20261028100000 */ case when coalesce(v->>'operator name','')<>'' then '## Operator and payouts' else '' end,
  concat_ws(E'\n','Operator: '||nullif(v->>'operator name',''),'Payout account: '||nullif(v->>'payout account name',''),'Sort code: '||nullif(v->>'payout sort code',''),
   'Account ending: '||nullif(v->>'payout account ending',''),'Automatic repair limit: '||nullif(v->>'repair limit',''),'Preferred repair contact: '||nullif(v->>'preferred repair contact','')),
  case when coalesce(v->>'onboarding package','')<>'' then '## Onboarding package' else '' end,
  concat_ws(E'\n',nullif(v->>'onboarding package',''),'Onboarding fee: '||nullif(v->>'onboarding fee',''))];$q$,
   $q$package details: 20261028100000$q$],
  -- The fee: the included fee plus the chosen extras, listed on the ticket.
  ['private.workspace_onboarding_fee_open()',
   $q$new.property_id,'accounts',st.amount_minor,'to_send',client,maker) returning id into item;$q$,
   $q$new.property_id,'accounts',private.workspace_package_fee(new.property_id,st.amount_minor),'to_send',client,maker) returning id into item;
 /* package fee: 20261028100000 */ update private.workspace_hub_items set details=left(details||private.workspace_package_invoice_text(new.property_id),4000) where id=item;$q$,
   $q$package fee: 20261028100000$q$],
  ['private.workspace_onboarding_fee_open()',
   $q$'Your management agreement for {property} is signed',st.amount_minor,true,now());$q$,
   $q$'Your management agreement for {property} is signed',private.workspace_package_fee(new.property_id,st.amount_minor),true,now());$q$,
   $q$is signed',private.workspace_package_fee($q$],
  ['private.workspace_property_chat_milestone()',
   $q$'Thank you for going ahead. We are preparing your management agreement.'$q$,
   $q$'Thank you for going ahead. Next: build your onboarding package.'$q$,
   $q$Next: build your onboarding package.$q$]
 ];
 def text;i integer;n integer;
begin
 for i in 1..array_length(fixes,1) loop
  def:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in def)>0 then continue;end if;
  n:=(length(def)-length(replace(def,fixes[i][2],'')))/length(fixes[i][2]);
  if n<>1 then raise exception 'Onboarding package patch: % has the anchor % time(s), expected 1',fixes[i][1],n;end if;
  execute replace(def,fixes[i][2],fixes[i][3]);
 end loop;
end $patch$;
