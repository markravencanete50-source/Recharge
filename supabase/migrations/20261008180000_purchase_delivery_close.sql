-- Ready's "Evidence ordered purchase delivery" ticket has no steps of its own: delivery is recorded on
-- the purchase itself. Close the ticket when its purchase is delivered (or reconciled), and cancel it
-- when its purchase is cancelled or declined, so it never sits open for ever.
create function private.workspace_close_purchase_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='purchase' and new.data->>'phase' in ('delivered','reconciled') and old.data->>'phase' is distinct from new.data->>'phase' then
  update public.workspace_work_items w set status='completed',completed_at=now(),version=w.version+1
   from private.workspace_domain_details d
   where d.work_id=w.id and d.kind='purchase_delivery' and d.data->>'sourceWorkId'=new.work_id::text and w.status not in ('completed','cancelled');
  update private.workspace_domain_details set data=data||'{"workStatus":"completed"}',updated_at=now()
   where kind='purchase_delivery' and data->>'sourceWorkId'=new.work_id::text and coalesce(data->>'workStatus','waiting') not in ('completed','cancelled');
 end if;
 return new;
end $$;
create trigger purchase_delivery_closed after update of data on private.workspace_domain_details for each row execute function private.workspace_close_purchase_delivery();

create function private.workspace_cancel_purchase_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('cancelled','declined') and old.status is distinct from new.status and exists(select 1 from private.workspace_domain_details where work_id=new.id and kind='purchase') then
  update public.workspace_work_items w set status='cancelled',version=w.version+1
   from private.workspace_domain_details d
   where d.work_id=w.id and d.kind='purchase_delivery' and d.data->>'sourceWorkId'=new.id::text and w.status not in ('completed','cancelled');
  update private.workspace_domain_details set data=data||'{"workStatus":"cancelled"}',updated_at=now()
   where kind='purchase_delivery' and data->>'sourceWorkId'=new.id::text and coalesce(data->>'workStatus','waiting') not in ('completed','cancelled');
 end if;
 return new;
end $$;
create trigger purchase_delivery_cancelled after update of status on public.workspace_work_items for each row execute function private.workspace_cancel_purchase_delivery();

revoke all on function private.workspace_close_purchase_delivery(),private.workspace_cancel_purchase_delivery() from public,anon,authenticated;

-- Tickets already left open behind a delivered, reconciled or stopped purchase.
update public.workspace_work_items w set status=case when s.status in ('cancelled','declined') then 'cancelled' else 'completed' end,
  completed_at=case when s.status in ('cancelled','declined') then w.completed_at else now() end,version=w.version+1
 from private.workspace_domain_details d, private.workspace_domain_details sd, public.workspace_work_items s
 where d.work_id=w.id and d.kind='purchase_delivery' and w.status not in ('completed','cancelled')
  and sd.work_id::text=d.data->>'sourceWorkId' and sd.kind='purchase' and s.id=sd.work_id
  and (sd.data->>'phase' in ('delivered','reconciled') or s.status in ('cancelled','declined'));
update private.workspace_domain_details d set data=d.data||jsonb_build_object('workStatus',w.status),updated_at=now()
 from public.workspace_work_items w
 where d.work_id=w.id and d.kind='purchase_delivery' and w.status in ('completed','cancelled') and coalesce(d.data->>'workStatus','waiting') is distinct from w.status;
