-- Visitor levy on owner statements (Alex, 13 October 2026: "a toggle for visitor levy too at 5%... only accounted for
-- in certain council areas, so it will be a property specific thing"). Councils differ: Edinburgh charges 5% on the
-- first 5 consecutive nights of stays from 24 July 2026, and other councils plan other rates and dates, so nothing
-- about a council is fixed here. Every value is a per-property setting.
--
-- 1. Per-property settings on private.workspace_property_financials:
--      levy_enabled    on or off (default off)
--      levy_rate_bps   the rate in basis points (default 500, 5%)
--      levy_night_cap  the most nights of one stay that are levied (null: every night)
--      levy_from       only stays checking in on or after this day are levied (null: every stay)
--    Set with setStatementTerms {visitorLevy: {enabled, rateBps?, nightCap?, from?}} (admins, as the other terms).
-- 2. The levy of a stay, worked out once, when a statement first counts it:
--      accommodation = the stay's gross less the guest's cleaning fee (the cleaning fee lines on its payout report;
--                      a platform stay whose report has none is levied on its gross and flagged
--                      levy_cleaning_fee_unknown, for staff)
--      levied nights = the stay's nights, at most the night cap
--      levy          = accommodation x levied nights / nights x rate, rounded to whole pence half away from zero
--                      (the management fee's rule)
--    Owner stays are never levied. The levy is shared across statement periods by its levied nights (the first
--    nights of the stay) with the statements' floor rule (private.workspace_prorate), so the parts add up exactly;
--    a statement by check-in takes it whole.
-- 3. The statement gets one "Visitor levy" line per levied stay, straight after the OTA fees: OTA fees, visitor levy,
--    changeovers, management fee, VAT, other payables. The payout is gross less all of them.
-- 4. Whether the management fee is charged after the levy is ONE switch, private.workspace_statement_fee_after_levy(),
--    default true: fee base = gross less OTA fees less the levy less changeovers. A question for Alex.
-- 5. The stored-copy rule: an issued or paid statement stores each stay's levy and levied nights with its other money
--    (stayLevyMinor, stayLevyNights), and later statements take their share from that copy, never from the settings as
--    they are now. A stay first issued before this migration has no stored levy and is never levied afterwards.
--    Issuing still recomputes and refuses if anything changed, the levy lines and stored levy included.
-- 6. Owners see the levy line on their statement (detail.lines) and the total (detail.visitorLevyMinor).
-- The same rules are in lib/statement-maths.ts, kept in step by the 200-scenario test.
--
-- The patches read the LATEST definitions, need each anchor exactly once and are skipped once their sentinel is
-- present, so the migration is safe to run twice.

alter table private.workspace_property_financials
 add column if not exists levy_enabled boolean not null default false,
 add column if not exists levy_rate_bps integer not null default 500 check(levy_rate_bps between 0 and 10000),
 add column if not exists levy_night_cap integer check(levy_night_cap between 1 and 366),
 add column if not exists levy_from date;

-- FEE_AFTER_LEVY: the management fee is charged on the payout after the levy. One switch.
create or replace function private.workspace_statement_fee_after_levy() returns boolean language sql immutable set search_path='' as $$ select true $$;

-- The levy on an amount for some of its nights: amount x levied / nights x bps / 10000, half pence away from zero.
create or replace function private.workspace_levy_minor(amount bigint,levied integer,nights integer,bps integer) returns bigint language sql immutable set search_path='' as $$
 select case when amount is null or levied is null or nights is null or bps is null or nights<=0 or levied<=0 or bps<=0 then 0::bigint
  else (sign(x)*div(abs(x)*2+d,d*2))::bigint end
 from (select amount::numeric*least(levied,nights)*bps x,nights::numeric*10000 d) q;
$$;

-- The guest's cleaning fee on a platform stay: the cleaning fee lines on its payout report (the same lines as
-- private.workspace_payout_row), or null when none says.
create or replace function private.workspace_stay_cleaning_fee(target private.workspace_reservations) returns bigint language sql stable security definer set search_path='' as $$
 select case when target.channel in ('airbnb','booking_com','vrbo') and target.channel_reference is not null then
  (select sum(l.cleaning_fee_minor) from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id
    where r.channel=target.channel and upper(l.reference)=upper(target.channel_reference) and l.set_aside_at is null and l.cleaning_fee_minor is not null) end;
$$;

-- The property's levy settings, as statements and the terms sheet show them.
create or replace function private.workspace_visitor_levy_terms(f private.workspace_property_financials) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(f.levy_enabled,false),'rateBps',coalesce(f.levy_rate_bps,500),'nightCap',f.levy_night_cap,'from',f.levy_from,
  'feeAfterLevy',private.workspace_statement_fee_after_levy());
$$;

-- {enabled, rateBps?, nightCap?, from?}: the property's levy settings. Leaves out keys keep their value.
create or replace function private.workspace_set_visitor_levy(prop uuid,v jsonb) returns private.workspace_property_financials language plpgsql security definer set search_path='' as $$
declare f private.workspace_property_financials;cap integer;start_on date;bps integer;
begin
 if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('enabled','rateBps','nightCap','from')) then raise exception 'Invalid visitor levy' using errcode='22023';end if;
 if jsonb_typeof(v->'enabled') is distinct from 'boolean' then raise exception 'Choose whether the visitor levy is charged' using errcode='22023';end if;
 select * into f from private.workspace_property_financials where property_id=prop;
 bps:=f.levy_rate_bps;cap:=f.levy_night_cap;start_on:=f.levy_from;
 if v ? 'rateBps' then
  if jsonb_typeof(v->'rateBps') is distinct from 'number' or v->>'rateBps'!~'^\d{1,5}$' or (v->>'rateBps')::integer>10000 then raise exception 'Enter the visitor levy rate' using errcode='22023';end if;
  bps:=(v->>'rateBps')::integer;
 end if;
 if v ? 'nightCap' then
  if jsonb_typeof(v->'nightCap')='null' then cap:=null;
  elsif jsonb_typeof(v->'nightCap') is distinct from 'number' or v->>'nightCap'!~'^\d{1,3}$' or (v->>'nightCap')::integer not between 1 and 366 then raise exception 'Enter the most nights levied, from 1 to 366' using errcode='22023';
  else cap:=(v->>'nightCap')::integer;
  end if;
 end if;
 if v ? 'from' then
  if jsonb_typeof(v->'from')='null' then start_on:=null;
  else start_on:=private.workspace_statement_date(v,'from');
  end if;
 end if;
 update private.workspace_property_financials set levy_enabled=(v->>'enabled')::boolean,levy_rate_bps=bps,levy_night_cap=cap,levy_from=start_on,updated_at=now()
  where property_id=prop returning * into f;
 return f;
end $$;

do $patch$
declare
 -- {function, anchor, replacement, sentinel}; applied in order on the latest definition.
 fixes constant text[][]:=array[
  -- Terms: the levy settings.
  ['private.workspace_set_statement_terms(jsonb)',
   $q$array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor','vatOnFee','cleanChargeMode']$q$,
   $q$array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor','vatOnFee','cleanChargeMode','visitorLevy']$q$,
   $q$'cleanChargeMode','visitorLevy']$q$],
  ['private.workspace_set_statement_terms(jsonb)',
   $q$returning * into f;$q$,
   $q$returning * into f; if input ? 'visitorLevy' then f:=private.workspace_set_visitor_levy(prop,input->'visitorLevy');end if;$q$,
   $q$f:=private.workspace_set_visitor_levy(prop,input->'visitorLevy')$q$],
  ['private.workspace_set_statement_terms(jsonb)',
   $q$insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');$q$,
   $q$if input ? 'visitorLevy' then result:=result||jsonb_build_object('visitorLevy',private.workspace_visitor_levy_terms(f));end if; insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');$q$,
   $q$result:=result||jsonb_build_object('visitorLevy',private.workspace_visitor_levy_terms(f))$q$],
  -- The statements list shows the levy settings with the other terms.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps())$q$,
   $q$'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps(),'visitorLevy',private.workspace_visitor_levy_terms(f))$q$,
   $q$'visitorLevy',private.workspace_visitor_levy_terms(f))$q$],
  -- The stored copy carries the stay's levy.
  ['private.workspace_statement_entry(jsonb)',
   $q$'checkIn',e->>'stayCheckIn','checkOut',e->>'stayCheckOut')$q$,
   $q$'checkIn',e->>'stayCheckIn','checkOut',e->>'stayCheckOut','levyMinor',e->'stayLevyMinor','levyNights',e->'stayLevyNights')$q$,
   $q$'levyMinor',e->'stayLevyMinor'$q$],
  -- Issuing compares the levy too.
  ['private.workspace_statement_money(jsonb)',
   $q$e->>'stayCheckIn',e->>'stayCheckOut',e->'wholeStay')$q$,
   $q$e->>'stayCheckIn',e->>'stayCheckOut',e->'wholeStay',e->'levyMinor',e->'stayLevyMinor',e->'stayLevyNights')$q$,
   $q$e->'wholeStay',e->'levyMinor'$q$],
  -- The statement keeps the total for the screens.
  ['private.workspace_prepare_statement_v2(jsonb)',
   $q$'feeBaseMinor',c->'feeBaseMinor','feeBase',c->'terms'->'feeBase',$q$,
   $q$'feeBaseMinor',c->'feeBaseMinor','feeBase',c->'terms'->'feeBase','visitorLevyMinor',c->'visitorLevyMinor','visitorLevy',c->'terms'->'visitorLevy',$q$,
   $q$'visitorLevyMinor',c->'visitorLevyMinor'$q$],
  -- The statement compute.
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$base bigint;fee_minor bigint;vat_minor bigint;$q$,
   $q$base bigint;fee_minor bigint;vat_minor bigint; levy_on boolean;levy_bps integer;levy_cap integer;levy_from date;levy_total bigint:=0;levy_lines jsonb:='[]';stay_levy bigint;stay_levy_nights integer;share_levy bigint;cfee bigint;$q$,
   $q$levy_on boolean;levy_bps integer;$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$available:=to_on-from_on;whole:=statement_method='check_in_month';$q$,
   $q$available:=to_on-from_on;whole:=statement_method='check_in_month'; levy_on:=coalesce(f.levy_enabled,false);levy_bps:=coalesce(f.levy_rate_bps,500);levy_cap:=f.levy_night_cap;levy_from:=f.levy_from;$q$,
   $q$levy_on:=coalesce(f.levy_enabled,false)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$share_gross:=0;share_fee:=0;took:=false;stay_gross:=null;stay_fee:=null;stay_settled:=null;$q$,
   $q$share_gross:=0;share_fee:=0;took:=false;stay_gross:=null;stay_fee:=null;stay_settled:=null;share_levy:=0;stay_levy:=0;stay_levy_nights:=0;$q$,
   $q$share_levy:=0;stay_levy:=0;stay_levy_nights:=0;$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$stay_gross:=(b->>'grossMinor')::bigint;stay_fee:=(b->>'otaFeeMinor')::bigint;stay_settled:=(b->>'settledMinor')::bigint;$q$,
   $q$stay_gross:=(b->>'grossMinor')::bigint;stay_fee:=(b->>'otaFeeMinor')::bigint;stay_settled:=(b->>'settledMinor')::bigint;stay_levy:=coalesce((b->>'levyMinor')::bigint,0);stay_levy_nights:=coalesce((b->>'levyNights')::integer,0);$q$,
   $q$stay_levy:=coalesce((b->>'levyMinor')::bigint,0)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$stay_gross:=gross;stay_fee:=fee;stay_settled:=settled;$q$,
   $q$stay_gross:=gross;stay_fee:=fee;stay_settled:=settled; if levy_on and w_n>0 and (levy_from is null or r.check_in>=levy_from) then cfee:=private.workspace_stay_cleaning_fee(r); if cfee is null and r.channel in ('airbnb','booking_com','vrbo') then flags:=flags||to_jsonb('levy_cleaning_fee_unknown:'||r.id);end if; stay_levy_nights:=least(w_n,coalesce(levy_cap,w_n)); stay_levy:=private.workspace_levy_minor(gross-coalesce(cfee,0),stay_levy_nights,w_n,levy_bps); end if;$q$,
   $q$cfee:=private.workspace_stay_cleaning_fee(r)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$gross_total:=gross_total+share_gross;$q$,
   $q$if took and stay_levy<>0 and stay_levy_nights>0 then share_levy:=case when full_share then stay_levy else private.workspace_prorate(stay_levy,least(bef,stay_levy_nights),least(thr,stay_levy_nights),stay_levy_nights) end;end if; if share_levy<>0 then levy_lines:=levy_lines||jsonb_build_array(jsonb_build_object('kind','visitor_levy','date',r.check_in,'label','Visitor levy','amountMinor',share_levy,'refId',r.id));levy_total:=levy_total+share_levy;end if; gross_total:=gross_total+share_gross;$q$,
   $q$levy_lines:=levy_lines||jsonb_build_array$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee);$q$,
   $q$'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee,'levyMinor',share_levy);$q$,
   $q$'amountMinor',share_gross-share_fee,'levyMinor',share_levy)$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'stayCheckIn',w_in,'stayCheckOut',w_out,'wholeStay',full_share);$q$,
   $q$'stayCheckIn',w_in,'stayCheckOut',w_out,'wholeStay',full_share,'stayLevyMinor',stay_levy,'stayLevyNights',stay_levy_nights);$q$,
   $q$'stayLevyMinor',stay_levy$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$base:=gross_total-ota_total-clean_total;$q$,
   $q$base:=gross_total-ota_total-clean_total-case when private.workspace_statement_fee_after_levy() then levy_total else 0 end;$q$,
   $q$case when private.workspace_statement_fee_after_levy() then levy_total else 0 end$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'cleanChargeMode',mode,'feeBase',private.workspace_statement_fee_base()),$q$,
   $q$'cleanChargeMode',mode,'feeBase',private.workspace_statement_fee_base(),'visitorLevy',private.workspace_visitor_levy_terms(f)),$q$,
   $q$'visitorLevy',private.workspace_visitor_levy_terms(f)),$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'lines',ota_lines||clean_lines||fee_lines||vat_lines||payable_lines,$q$,
   $q$'lines',ota_lines||levy_lines||clean_lines||fee_lines||vat_lines||payable_lines,$q$,
   $q$ota_lines||levy_lines||clean_lines$q$],
  ['private.workspace_statement_compute(uuid,date,date,text,uuid)',
   $q$'payoutMinor',gross_total-ota_total-clean_total-fee_minor-vat_minor-pay_total,$q$,
   $q$'visitorLevyMinor',levy_total,'payoutMinor',gross_total-ota_total-levy_total-clean_total-fee_minor-vat_minor-pay_total,$q$,
   $q$'visitorLevyMinor',levy_total,$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   found_count:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if found_count<>1 then raise exception 'Patch anchor % found % times in %, expected once',i,found_count,fixes[i][1];end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch % did not take in %',i,fixes[i][1];end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_statement_fee_after_levy(),private.workspace_levy_minor(bigint,integer,integer,integer),
 private.workspace_stay_cleaning_fee(private.workspace_reservations),private.workspace_visitor_levy_terms(private.workspace_property_financials),
 private.workspace_set_visitor_levy(uuid,jsonb) from public,anon,authenticated;
