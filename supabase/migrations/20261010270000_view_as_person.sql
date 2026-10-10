-- View as: a super admin sees the workspace exactly as one of their people does (their Home,
-- tools, properties, work, messages and numbers), to check each role's point of view.
--
-- How it works: the app sends the person's id in an "x-recharge-view-as" header on reads. Before
-- each request the Data API runs public.workspace_request_check(), which checks the real caller is
-- an active super admin who started viewing that person in the last 12 hours, then answers the
-- request as that person: auth.uid() and the cached role become theirs for that one request.
-- Every other request is untouched (one text search, nothing else).
--
-- While viewing: the request is read-only, so nothing can be changed; conversations the super
-- admin could not open themselves (private chats) stay hidden; personal data downloads are off;
-- and each start is recorded in Access history.

create table if not exists private.workspace_view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (viewer_id <> target_id)
);
create index if not exists workspace_view_as_sessions_viewer_idx on private.workspace_view_as_sessions(viewer_id, started_at desc);
alter table private.workspace_view_as_sessions enable row level security;
revoke all on table private.workspace_view_as_sessions from public, anon, authenticated;

-- The super admin behind this request while they view as someone else, otherwise null.
create or replace function private.workspace_viewer() returns uuid language sql stable set search_path='' as $$
  select case when current_setting('recharge.view_as', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then current_setting('recharge.view_as', true)::uuid end;
$$;

-- Who a super admin can view as: everyone active apart from super admins.
create or replace function private.workspace_view_as_people() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_viewer() is not null or not private.is_workspace_super_admin() then raise exception 'Only super admins can view as someone else' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',coalesce(nullif(btrim(p.full_name),''),'Unnamed person'),'role',p.role) order by p.role,p.full_name,p.user_id)
  from public.workspace_profiles p where p.status='active' and p.role<>'super_admin' and p.user_id<>auth.uid()),'[]');
end $$;

-- Start viewing as someone: recorded, and answered with the account the app shows.
create or replace function private.workspace_view_as_start(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); target uuid; person public.workspace_profiles;
begin
 if private.workspace_viewer() is not null or not private.is_workspace_super_admin() then raise exception 'Only super admins can view as someone else' using errcode='42501'; end if;
 if jsonb_typeof(input) is distinct from 'object' or (select count(*) from jsonb_object_keys(input) k where k not in ('action','userId'))>0
  or jsonb_typeof(input->'userId') is distinct from 'string' or input->>'userId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Choose someone to view as' using errcode='22023';
 end if;
 target:=(input->>'userId')::uuid;
 person:=(select p from public.workspace_profiles p where p.user_id=target);
 if target=me or person.user_id is null or person.status<>'active' or person.role='super_admin' then raise exception 'Choose an active person who is not a super admin' using errcode='22023'; end if;
 update private.workspace_view_as_sessions set ended_at=now() where viewer_id=me and ended_at is null;
 insert into private.workspace_view_as_sessions(viewer_id,target_id) values(me,target);
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access) values(target,me,'viewed_as',null,jsonb_build_object('role',person.role));
 return private.workspace_account_json(target)||jsonb_build_object('teamOnly',coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton),false));
end $$;

create or replace function private.workspace_view_as_stop(input jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode='42501'; end if;
 update private.workspace_view_as_sessions set ended_at=now() where viewer_id=auth.uid() and ended_at is null;
 return jsonb_build_object('ok',true);
end $$;

-- Whether the person signed in may view as this person now: an active super admin who started
-- viewing them in the last 12 hours. Answers with that person's id.
create or replace function private.workspace_view_as_target(wanted text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); target uuid;
begin
 if viewer is null or wanted is null or wanted !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not private.is_workspace_super_admin() then
  raise exception 'Only super admins can view as someone else' using errcode='42501';
 end if;
 target:=wanted::uuid;
 if not exists(select 1 from private.workspace_view_as_sessions s where s.viewer_id=viewer and s.target_id=target and s.ended_at is null and s.started_at>now()-interval '12 hours')
  or not exists(select 1 from public.workspace_profiles p where p.user_id=target and p.status='active' and p.role<>'super_admin') then
  raise exception 'Viewing as this person has ended. Choose them again to carry on.' using errcode='42501';
 end if;
 return target;
end $$;

-- Runs before every Data API request (see the end of this file).
create or replace function public.workspace_request_check() returns void language plpgsql security invoker set search_path='' as $$
declare headers text:=current_setting('request.headers', true); wanted text; viewer uuid; target uuid; claims jsonb;
begin
 -- Almost every request: no View as header, nothing to do.
 if headers is null or strpos(headers,'x-recharge-view-as')=0 then return; end if;
 wanted:=headers::jsonb->>'x-recharge-view-as';
 if wanted is null then return; end if;
 viewer:=auth.uid();
 if viewer is null then raise exception 'Only super admins can view as someone else' using errcode='42501'; end if;
 target:=private.workspace_view_as_target(wanted);
 -- Answer as them for this request only: these settings end with the request's transaction.
 claims:=coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb);
 claims:=(claims-'email'-'phone'-'user_metadata'-'app_metadata')||jsonb_build_object('sub',target::text,'viewed_by',viewer::text);
 perform set_config('request.jwt.claims',claims::text,true);
 perform set_config('request.jwt.claim.sub',target::text,true);
 -- Their sign-in is the super admin's checked one, under the person's id; their role is looked up afresh.
 perform set_config('recharge.workspace_session',target::text||':'||coalesce(claims->>'session_id',''),true);
 perform set_config('recharge.workspace_actor','',true);
 perform set_config('recharge.view_as',viewer::text,true);
 perform set_config('transaction_read_only','on',true);
end $$;

-- Messages while viewing: only conversations the super admin could open themselves.
create or replace function private.workspace_chat_read_shown(section text, target uuid default null, before_at timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.workspace_viewer(); shown jsonb;
begin
 if viewer is null then return private.workspace_chat_read(section,target,before_at); end if;
 if section='messages' and (target is null or not private.chat_can(target,viewer)) then
  raise exception 'This conversation is private to the people in it' using errcode='42501';
 end if;
 if section in ('list','unread') then
  shown:=coalesce((select jsonb_agg(e.item order by e.ord) from jsonb_array_elements(private.workspace_chat_read('list',null,null)) with ordinality e(item,ord)
   where private.chat_can((e.item->>'id')::uuid,viewer)),'[]');
  if section='unread' then return to_jsonb((select coalesce(sum((i->>'unread')::bigint),0)::bigint from jsonb_array_elements(shown) i)); end if;
  return shown;
 end if;
 return private.workspace_chat_read(section,target,before_at);
end $$;
create or replace function public.workspace_chat_read(section text, target uuid default null, before_at timestamptz default null) returns jsonb language sql set search_path='' as $$select private.workspace_chat_read_shown(section,target,before_at);$$;

-- A person's own data download is theirs alone.
create or replace function private.workspace_privacy_read_shown(section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_viewer() is not null then raise exception 'Personal data is not shown while you view as someone else' using errcode='42501'; end if;
 return private.workspace_privacy_read(section);
end $$;
create or replace function public.workspace_privacy_read(section text) returns jsonb language sql set search_path='' as $$ select private.workspace_privacy_read_shown(section); $$;

create or replace function public.workspace_view_as_people() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_view_as_people();$$;
create or replace function public.workspace_view_as_start(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_view_as_start(input);$$;
create or replace function public.workspace_view_as_stop(input jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_view_as_stop(input);$$;

revoke all on function private.workspace_viewer(), private.workspace_view_as_target(text), private.workspace_view_as_people(), private.workspace_view_as_start(jsonb), private.workspace_view_as_stop(jsonb),
 private.workspace_chat_read_shown(text,uuid,timestamptz), private.workspace_privacy_read_shown(text),
 public.workspace_view_as_people(), public.workspace_view_as_start(jsonb), public.workspace_view_as_stop(jsonb) from public, anon;
grant execute on function private.workspace_viewer(), private.workspace_view_as_target(text), private.workspace_view_as_people(), private.workspace_view_as_start(jsonb), private.workspace_view_as_stop(jsonb),
 private.workspace_chat_read_shown(text,uuid,timestamptz), private.workspace_privacy_read_shown(text),
 public.workspace_view_as_people(), public.workspace_view_as_start(jsonb), public.workspace_view_as_stop(jsonb) to authenticated;
-- The check runs for every caller (signed in or not), so everyone may run it; without the header it does nothing.
grant execute on function public.workspace_request_check() to public;

-- Switch the check on for the Data API (on Supabase; skipped where there is no Data API role).
do $$ begin
 if exists(select 1 from pg_roles where rolname='authenticator') then
  execute 'alter role authenticator set pgrst.db_pre_request to ''public.workspace_request_check''';
  perform pg_notify('pgrst','reload config');
 end if;
end $$;
