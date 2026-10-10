-- Favorites: each person's saved places (pages, tools, properties, work), so the same list
-- follows them from the desktop to their phone. Only the person themselves reads or changes it.
-- Each item is a key the app resolves against what the person can open now, plus the label
-- shown if it is no longer available.
create table if not exists private.workspace_favorites (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40 and octet_length(items::text) <= 16000),
  updated_at timestamptz not null default now()
);
alter table private.workspace_favorites enable row level security;
revoke all on table private.workspace_favorites from public, anon, authenticated;

create or replace function private.workspace_favorites() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
 return coalesce((select f.items from private.workspace_favorites f where f.user_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function private.workspace_save_favorites(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb := input->'items'; item jsonb;
begin
 if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) > 40 then raise exception 'Keep up to 40 favorites' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item) k where k not in ('key','label')) > 0
   or jsonb_typeof(item->'key') <> 'string' or length(item->>'key') not between 3 and 160 or item->>'key' !~ '^[a-z]+:[A-Za-z0-9_.:-]+$'
   or jsonb_typeof(item->'label') <> 'string' or length(btrim(item->>'label')) not between 1 and 120 then
   raise exception 'Check the favorites' using errcode='22023';
  end if;
 end loop;
 if (select count(distinct value->>'key') from jsonb_array_elements(items)) <> jsonb_array_length(items) then raise exception 'Check the favorites' using errcode='22023'; end if;
 insert into private.workspace_favorites(user_id, items, updated_at) values (auth.uid(), items, now())
  on conflict (user_id) do update set items = excluded.items, updated_at = now();
 return items;
end $$;

create or replace function public.workspace_favorites() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_favorites();$$;
create or replace function public.workspace_save_favorites(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_save_favorites(input);$$;
revoke all on function private.workspace_favorites(), private.workspace_save_favorites(jsonb), public.workspace_favorites(), public.workspace_save_favorites(jsonb) from public, anon;
grant execute on function private.workspace_favorites(), private.workspace_save_favorites(jsonb), public.workspace_favorites(), public.workspace_save_favorites(jsonb) to authenticated;
