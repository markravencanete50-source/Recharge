-- Notifications in the browser and on phones without the app stores (web push). Each browser a
-- person allows is kept here; the backend sends every in-app notice to them within a minute,
-- encrypted so only that browser can read it. Safe to run more than once.

create table if not exists private.workspace_web_push (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{20,24}$'),
 created_at timestamptz not null default now()
);
create index if not exists workspace_web_push_user_idx on private.workspace_web_push(user_id);
create table if not exists private.workspace_web_push_sent (
 outbox_id bigint not null references private.workspace_notification_outbox(id) on delete cascade,
 subscription_id uuid not null references private.workspace_web_push(id) on delete cascade,
 sent_at timestamptz not null default now(),
 primary key(outbox_id,subscription_id)
);
alter table private.workspace_web_push enable row level security;
alter table private.workspace_web_push_sent enable row level security;
revoke all on private.workspace_web_push,private.workspace_web_push_sent from public,anon,authenticated;

create or replace function private.workspace_web_push_subscribe(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['endpoint','p256dh','auth']);
 if coalesce(input->>'endpoint','') !~ '^https://' or char_length(input->>'endpoint')>1000 or coalesce(input->>'p256dh','') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(input->>'auth','') !~ '^[A-Za-z0-9_-]{20,24}$' then
  raise exception 'Check the notification subscription' using errcode='22023';
 end if;
 -- A browser belongs to whoever signed in on it last; each person keeps their 10 newest.
 delete from private.workspace_web_push where endpoint=input->>'endpoint';
 insert into private.workspace_web_push(user_id,endpoint,p256dh,auth) values(auth.uid(),input->>'endpoint',input->>'p256dh',input->>'auth');
 delete from private.workspace_web_push where user_id=auth.uid() and id not in (select id from private.workspace_web_push where user_id=auth.uid() order by created_at desc limit 10);
 return jsonb_build_object('subscribed',true,'devices',(select count(*) from private.workspace_web_push where user_id=auth.uid()));
end $$;
create or replace function private.workspace_web_push_unsubscribe(target_endpoint text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 delete from private.workspace_web_push where user_id=auth.uid() and endpoint=target_endpoint;
 return jsonb_build_object('subscribed',false);
end $$;

-- Backend only: the next notices to send, each to every browser of its person. A notice is sent
-- at most once to each browser, never older than a day, and never from before the browser was
-- added. Access is rechecked, so someone who lost access to a job is not told about it.
create or replace function private.integration_claim_web_push() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- One claim at a time, so two runs never pick the same notice.
 perform pg_advisory_xact_lock(hashtextextended('recharge-web-push-claim',0));
 result:=(select coalesce(jsonb_agg(jsonb_build_object('outboxId',c.outbox_id,'subscriptionId',c.subscription_id,'endpoint',c.endpoint,'p256dh',c.p256dh,'auth',c.auth,'eventType',c.event_type) order by c.created_at),'[]')
  from (select o.id outbox_id,s.id subscription_id,s.endpoint,s.p256dh,s.auth,a.event_type,a.created_at
   from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
   join private.workspace_web_push s on s.user_id=o.user_id join public.workspace_profiles p on p.user_id=o.user_id and p.status='active'
   where a.created_at>now()-interval '1 day' and a.created_at>=s.created_at-interval '1 minute'
    and not exists(select 1 from private.workspace_web_push_sent x where x.outbox_id=o.id and x.subscription_id=s.id)
    and (o.work_id is null or private.integration_can_work(o.user_id,o.work_id))
   order by a.created_at limit 50) c);
 insert into private.workspace_web_push_sent(outbox_id,subscription_id)
  select (j->>'outboxId')::bigint,(j->>'subscriptionId')::uuid from jsonb_array_elements(result) j on conflict do nothing;
 delete from private.workspace_web_push_sent where sent_at<now()-interval '3 days';
 return result;
end $$;
-- Backend only: a browser that no longer accepts notifications is forgotten.
create or replace function private.integration_remove_web_push(target_endpoint text) returns void language sql security definer set search_path='' as $$
 delete from private.workspace_web_push where endpoint=target_endpoint;
$$;

create or replace function public.workspace_web_push_subscribe(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_web_push_subscribe(input);$$;
create or replace function public.workspace_web_push_unsubscribe(target_endpoint text) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_web_push_unsubscribe(target_endpoint);$$;
create or replace function public.integration_claim_web_push() returns jsonb language sql security invoker set search_path='' as $$select private.integration_claim_web_push();$$;
create or replace function public.integration_remove_web_push(target_endpoint text) returns void language sql security invoker set search_path='' as $$select private.integration_remove_web_push(target_endpoint);$$;

revoke all on function private.workspace_web_push_subscribe(jsonb),private.workspace_web_push_unsubscribe(text),private.integration_claim_web_push(),private.integration_remove_web_push(text),
 public.workspace_web_push_subscribe(jsonb),public.workspace_web_push_unsubscribe(text),public.integration_claim_web_push(),public.integration_remove_web_push(text) from public,anon,authenticated,service_role;
grant execute on function private.workspace_web_push_subscribe(jsonb),private.workspace_web_push_unsubscribe(text),public.workspace_web_push_subscribe(jsonb),public.workspace_web_push_unsubscribe(text) to authenticated;
grant execute on function private.integration_claim_web_push(),private.integration_remove_web_push(text),public.integration_claim_web_push(),public.integration_remove_web_push(text) to service_role;
