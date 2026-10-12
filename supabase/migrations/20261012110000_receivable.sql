-- Accounts receivable (WP-G): invoices to send and invoices sent but not yet paid, each optionally for a
-- stay or a client, plus direct bookings that still need an invoice.
--
-- 1. Hub items gain two nullable links: reservation_id (private.workspace_reservations, the stays table)
--    and client_id (public.workspace_profiles.user_id of a client profile: the owner, the same key the
--    property assignments and statements use). The invoice reference is the existing `reference` column.
--    Only invoices and AirCover claims link to a stay; only invoices link to a client.
-- 2. The hub view returns reservationId and clientId, saveHubItem accepts them (checked: the stay exists
--    and the caller can see its property, the client is an active client profile on that property, and an
--    invoice moved to another property keeps its client only when that client is on the new property), and
--    moveHubItem records a payment on an invoice: settledMinor is the total received so far, paying the
--    whole amount (or marking it paid with no figure) settles it, and a payment cannot exceed the invoice.
-- 3. private.workspace_report_receivable(target_property, target_id, from_on, to_on, filters), reached
--    through public.workspace_finance_report('receivable', ...): finance roles only, no staff names.
--      toSend      invoice items at 'to_send'
--      toSettle    invoice items at 'sent' (outstanding = amount - settled)
--      needsInvoice confirmed direct stays checking in from `from_on` (default 30 days ago) onwards with no
--                  invoice item linked, with the stay's total where it is known
--      totals      toSendMinor, toSettleMinor, counts
--      options     active clients and recent stays, for the Record invoice sheet
--    Dates: invoices are listed whatever their date (money outstanding stays outstanding); from_on only
--    starts the direct-booking suggestions, which have no upper bound because later stays still need one.
--    target_property narrows everything to a property; target_id to one stay. Filters: region (the
--    property's), channel (the linked stay's; 'direct' is the only channel that has suggestions).
--
-- Safe to run more than once: columns, indexes and constraints are guarded, and every patch of an
-- existing function is skipped once its sentinel is present. Each anchor must occur exactly once.
alter table private.workspace_hub_items
 add column if not exists reservation_id uuid references private.workspace_reservations(id) on delete set null,
 add column if not exists client_id uuid references public.workspace_profiles(user_id) on delete set null;
create index if not exists workspace_hub_items_reservation_idx on private.workspace_hub_items(reservation_id) where reservation_id is not null;
create index if not exists workspace_hub_items_client_idx on private.workspace_hub_items(client_id) where client_id is not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_stay_link_kind' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_stay_link_kind check(reservation_id is null or kind in ('invoice','aircover'));
 end if;
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_client_link_kind' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_client_link_kind check(client_id is null or kind='invoice');
 end if;
end $$;

-- 2. The hub's view and its save and move actions, patched from their latest definitions.
do $$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'reference',item.reference,$q$,
   $q$'reference',item.reference,'reservationId',item.reservation_id,'clientId',item.client_id,$q$,
   $q$'reservationId',item.reservation_id$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$item private.workspace_hub_items;k text;$q$,
   $q$item private.workspace_hub_items;res private.workspace_reservations;link_res uuid;link_client uuid;link_prop uuid;k text;$q$,
   $q$link_prop uuid;$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$'dueOn','amountMinor','link','reference']);$q$,
   $q$'dueOn','amountMinor','link','reference','reservationId','clientId']);$q$,
   $q$'reference','reservationId','clientId']$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$then private.workspace_money(input,'amountMinor') end;$q$,
   $q$then private.workspace_money(input,'amountMinor') end;
  link_res:=case when input ? 'reservationId' then (input->>'reservationId')::uuid else item.reservation_id end;
  link_client:=case when input ? 'clientId' then (input->>'clientId')::uuid else item.client_id end;
  link_prop:=(input->>'propertyId')::uuid;
  if link_res is not null and k not in ('invoice','aircover') then raise exception 'Only invoices and AirCover claims link to a stay' using errcode='22023';end if;
  if link_client is not null and k<>'invoice' then raise exception 'Only an invoice is for a client' using errcode='22023';end if;
  if link_res is not null then
   select * into res from private.workspace_reservations r where r.id=link_res;
   if res.id is null or not private.workspace_can_property(res.property_id,'owner-statements') then raise exception 'Stay not found' using errcode='P0002';end if;
   if link_prop is not null and link_prop<>res.property_id then raise exception 'That stay belongs to another property' using errcode='22023';end if;
   link_prop:=res.property_id;
  end if;
  -- A client sent now must be an active client; the invoice's client (sent now or kept) must be linked to its
  -- property whenever either changes, so moving an invoice to another property checks its client too.
  if link_client is not null and (input ? 'clientId' or link_prop is distinct from item.property_id) then
   if input ? 'clientId' and not exists(select 1 from public.workspace_profiles c where c.user_id=link_client and c.role='client' and c.status='active') then raise exception 'Choose a client' using errcode='22023';end if;
   if link_prop is not null and not exists(select 1 from public.workspace_property_assignments a where a.property_id=link_prop and a.user_id=link_client and a.assignment='client') then raise exception 'That client is not linked to this property' using errcode='22023';end if;
  end if;$q$,
   $q$link_client:=case when input ? 'clientId'$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$amount_minor,link,reference,status,created_by)$q$,
   $q$amount_minor,link,reference,status,created_by,reservation_id,client_id)$q$,
   $q$created_by,reservation_id,client_id)$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$values(k,txt,coalesce(input->>'details',''),(input->>'propertyId')::uuid,$q$,
   $q$values(k,txt,coalesce(input->>'details',''),link_prop,$q$,
   $q$coalesce(input->>'details',''),link_prop,$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$else 'to_send' end,auth.uid())$q$,
   $q$else 'to_send' end,auth.uid(),link_res,link_client)$q$,
   $q$auth.uid(),link_res,link_client)$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$details=coalesce(input->>'details',details),property_id=(input->>'propertyId')::uuid,$q$,
   $q$details=coalesce(input->>'details',details),property_id=link_prop,reservation_id=link_res,client_id=link_client,$q$,
   $q$property_id=link_prop,reservation_id=link_res$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$st:=input->>'status';$q$,
   $q$st:=input->>'status';
  if item.kind='invoice' and input ? 'settledMinor' and item.amount_minor is not null and private.workspace_money(input,'settledMinor')>item.amount_minor then raise exception 'The payment is more than the invoice' using errcode='22023';end if;$q$,
   $q$The payment is more than the invoice$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$settled_minor=case when item.kind='aircover' and input ? 'settledMinor' then private.workspace_money(input,'settledMinor') else settled_minor end,$q$,
   $q$settled_minor=case when item.kind in ('aircover','invoice') and input ? 'settledMinor' then private.workspace_money(input,'settledMinor') when item.kind='invoice' and st='paid' and settled_minor is null then amount_minor else settled_minor end,$q$,
   $q$item.kind='invoice' and st='paid' and settled_minor is null$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;

-- 3. The receivable report. Finance roles only; staff names are never returned.
create or replace function private.workspace_report_receivable(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare today date:=(now() at time zone 'Europe/London')::date;f_region text;f_channel text;result jsonb;
begin
 if not private.workspace_finance_role() then raise exception 'Accounts access required' using errcode='42501';end if;
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('region','channel')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  f_region:=nullif(trim(filters->>'region'),'');f_channel:=filters->>'channel';
  if length(coalesce(f_region,''))>80 or (f_channel is not null and f_channel not in ('airbnb','booking_com','vrbo','direct','other')) then raise exception 'Invalid report filters' using errcode='22023';end if;
 end if;
 with inv as (
  select i.id,i.version,i.title,i.reference,i.details,i.status,i.property_id,i.amount_minor,coalesce(i.settled_minor,0) settled,i.due_on,i.link,i.created_at,i.updated_at,
   i.reservation_id,i.client_id,p.name pname,p.address paddr,r.reference stay_ref,r.check_in,r.check_out,c.full_name client_name,
   case i.status when 'sent' then (coalesce(i.decided_at,i.updated_at) at time zone 'Europe/London')::date else (i.created_at at time zone 'Europe/London')::date end since,
   case i.status when 'sent' then greatest(coalesce(i.amount_minor,0)-coalesce(i.settled_minor,0),0) else coalesce(i.amount_minor,0) end outstanding
  from private.workspace_hub_items i
  left join public.workspace_properties p on p.id=i.property_id
  left join private.workspace_reservations r on r.id=i.reservation_id
  left join public.workspace_profiles c on c.user_id=i.client_id
  where i.kind='invoice' and i.status in ('to_send','sent')
   and (target_property is null or i.property_id=target_property) and (target_id is null or i.reservation_id=target_id)
   and (f_region is null or lower(trim(p.region))=lower(f_region)) and (f_channel is null or r.channel=f_channel)
   and (i.property_id is null or private.workspace_can_property(i.property_id,'owner-statements'))
 ), shaped as (
  select inv.*,jsonb_build_object('itemId',id,'version',version,'title',title,'reference',reference,'details',details,'status',status,
   'propertyId',property_id,'propertyName',pname,'address',paddr,'amountMinor',amount_minor,'settledMinor',settled,'outstandingMinor',outstanding,
   'createdAt',created_at,'updatedAt',updated_at,'dueOn',due_on,'overdue',due_on is not null and due_on<today,'ageDays',today-since,'sentOn',case when status='sent' then since end,'link',link,
   'reservationId',reservation_id,'stayReference',stay_ref,'checkIn',check_in,'checkOut',check_out,'clientId',client_id,'clientName',client_name) j
  from inv
 ), need as (
  select r.id,r.property_id,r.reference,r.check_in,r.check_out,r.guests,r.payout_minor,p.name pname,p.address paddr
  from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
  where r.status='confirmed' and r.channel='direct' and r.check_in>=coalesce(from_on,today-30)
   and (target_property is null or r.property_id=target_property) and (target_id is null or r.id=target_id)
   and (f_region is null or lower(trim(p.region))=lower(f_region)) and (f_channel is null or f_channel='direct')
   and not exists(select 1 from private.workspace_hub_items i where i.kind='invoice' and i.reservation_id=r.id)
   and private.workspace_can_property(r.property_id,'owner-statements')
 )
 select jsonb_build_object('section','receivable',
  'toSend',coalesce((select jsonb_agg(x.j order by x.due_on nulls last,x.created_at,x.id) from (select * from shaped where status='to_send' order by due_on nulls last,created_at,id limit 500) x),'[]'::jsonb),
  'toSettle',coalesce((select jsonb_agg(x.j order by x.due_on nulls last,x.since,x.id) from (select * from shaped where status='sent' order by due_on nulls last,since,id limit 500) x),'[]'::jsonb),
  'needsInvoice',coalesce((select jsonb_agg(jsonb_build_object('reservationId',x.id,'propertyId',x.property_id,'propertyName',x.pname,'address',x.paddr,
     'stayReference',x.reference,'checkIn',x.check_in,'checkOut',x.check_out,'guests',x.guests,'totalMinor',x.payout_minor) order by x.check_in,x.id)
     from (select * from need order by check_in,id limit 200) x),'[]'::jsonb),
  'totals',jsonb_build_object(
   'toSendMinor',(select coalesce(sum(outstanding),0) from shaped where status='to_send'),'toSettleMinor',(select coalesce(sum(outstanding),0) from shaped where status='sent'),
   'toSendCount',(select count(*) from shaped where status='to_send'),'toSettleCount',(select count(*) from shaped where status='sent'),
   'needsInvoiceCount',(select count(*) from need)),
  'options',jsonb_build_object(
   'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',c.user_id,'name',c.full_name,
      'propertyIds',coalesce((select jsonb_agg(a.property_id order by a.property_id) from public.workspace_property_assignments a where a.user_id=c.user_id and a.assignment='client'),'[]'::jsonb)) order by c.full_name,c.user_id)
     from (select * from public.workspace_profiles c where c.role='client' and c.status='active' order by c.full_name,c.user_id limit 500) c),'[]'::jsonb),
   'stays',coalesce((select jsonb_agg(jsonb_build_object('reservationId',x.id,'propertyId',x.property_id,'propertyName',x.pname,'stayReference',x.reference,'channel',x.channel,
      'checkIn',x.check_in,'checkOut',x.check_out,'invoiced',x.invoiced) order by x.check_in,x.id)
     from (select r.id,r.property_id,r.reference,r.channel,r.check_in,r.check_out,p.name pname,
       exists(select 1 from private.workspace_hub_items i where i.kind='invoice' and i.reservation_id=r.id) invoiced
      from private.workspace_reservations r join public.workspace_properties p on p.id=r.property_id
      where r.status='confirmed' and r.check_out>=today-60 and r.check_in<=today+180 and (target_property is null or r.property_id=target_property)
       and private.workspace_can_property(r.property_id,'owner-statements')
      order by r.check_in,r.id limit 300) x),'[]'::jsonb))
 ) into result;
 return result;
end $fn$;
revoke all on function private.workspace_report_receivable(uuid,uuid,date,date,jsonb) from public,anon,authenticated;
