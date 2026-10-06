-- Push registration must remain bounded when called directly through REST RPC.
alter table private.workspace_device_tokens add constraint workspace_push_token_size
  check (char_length(push_token) between 20 and 200);
create function private.workspace_limit_devices() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('workspace-devices:'||new.user_id::text,0));
  if (select count(*) from private.workspace_device_tokens where user_id=new.user_id)>=10 then
    raise exception 'Remove an old device before registering another' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.workspace_limit_devices() from public,anon,authenticated;
create trigger device_count_limit before insert on private.workspace_device_tokens for each row execute function private.workspace_limit_devices();
create trigger device_write_limit before insert on private.workspace_device_tokens for each row execute function private.workspace_enforce_write_limit();
notify pgrst,'reload schema';
