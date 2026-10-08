-- Gap nights become tickets on their own: every live property with an empty night in the coming
-- week that has no pricing decision yet gets one open "Price the empty nights" ticket, kept up to
-- date and closed once every night is booked or priced. Run by the backend on its schedule.
create function private.workspace_open_pricing_gaps() returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Europe/London')::date;prop record;gaps jsonb;open_id uuid;opened integer:=0;updated integer:=0;closed integer:=0;begin
 for prop in select p.id from public.workspace_properties p where p.status='active' loop
  select coalesce(jsonb_agg(n::date::text order by n),'[]') into gaps from generate_series(today::timestamp,(today+6)::timestamp,interval '1 day') n
   where not exists(select 1 from private.workspace_reservations r where r.property_id=prop.id and r.status='confirmed' and r.check_in<=n::date and r.check_out>n::date)
     and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=prop.id and d.kind='daily_pricing' and d.data->>'night'=n::date::text);
  select w.id into open_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where w.property_id=prop.id and d.kind='pricing_gap' and w.status not in ('completed','cancelled') order by w.created_at desc limit 1;
  if jsonb_array_length(gaps)>0 and open_id is null then
   perform private.workspace_handover(prop.id,'daily-pricing','Price the empty nights this week','pricing_gap',jsonb_build_object('nights',gaps,'checkedOn',today,'workStatus','waiting'));
   opened:=opened+1;
  elsif jsonb_array_length(gaps)>0 then
   update private.workspace_domain_details set data=data||jsonb_build_object('nights',gaps,'checkedOn',today),updated_at=now() where work_id=open_id and data->'nights' is distinct from gaps;
   if found then updated:=updated+1;end if;
  elsif open_id is not null then
   update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=open_id;
   update private.workspace_domain_details set data=data||jsonb_build_object('nights','[]'::jsonb,'workStatus','completed'),updated_at=now() where work_id=open_id;
   closed:=closed+1;
  end if;
 end loop;
 return jsonb_build_object('opened',opened,'updated',updated,'closed',closed);
end $$;
create function public.workspace_open_pricing_gaps() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_open_pricing_gaps() $$;
revoke all on function private.workspace_open_pricing_gaps(),public.workspace_open_pricing_gaps() from public,anon,authenticated;
grant execute on function private.workspace_open_pricing_gaps(),public.workspace_open_pricing_gaps() to service_role;
