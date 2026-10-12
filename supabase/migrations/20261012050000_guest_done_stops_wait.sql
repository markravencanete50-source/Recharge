-- Marking a Guest inbox conversation Done stops the wait. A guest message nobody replied to (a final
-- "Thanks!") no longer counts against reply times once the conversation was marked Done after it.
-- Each time a conversation is marked Done a mark is kept (history stays; reopening deletes nothing):
-- a mark ends a wait like a team reply does, but a wait ended by a mark is not timed or counted at all.

create table if not exists private.workspace_guest_thread_marks (
  id uuid primary key default gen_random_uuid(), source text not null, thread_ref text not null,
  marked_at timestamptz not null default now(), marked_by uuid references public.workspace_profiles(user_id)
);
create index if not exists workspace_guest_thread_marks_thread_idx on private.workspace_guest_thread_marks(source,thread_ref,marked_at);
alter table private.workspace_guest_thread_marks enable row level security;
revoke all on private.workspace_guest_thread_marks from public,anon,authenticated;

-- Conversations already Done count as marked now.
insert into private.workspace_guest_thread_marks(source,thread_ref)
 select t.source,t.thread_ref from private.workspace_guest_threads t where t.status='done'
  and not exists(select 1 from private.workspace_guest_thread_marks k where k.source=t.source and k.thread_ref=t.thread_ref);

-- Every guest message that starts a wait (the first in a thread, or the first after a team reply or a
-- Done mark), graded by how long the reply took and credited to whoever was on guest relations at the
-- time. A message still waiting counts once it is past the amber limit. A wait ended by a Done mark
-- before any team reply is left out. A message the channel manager delivered after the mark, though
-- sent before it, was not seen when Done was pressed: it counts as arriving after the mark.
create or replace function private.workspace_response_rows(lower_at timestamptz,upper_at timestamptz) returns table(message_id uuid,sent_at timestamptz,minutes numeric,grade text,user_id uuid)
language sql stable security definer set search_path='' as $$
 with t as (select * from private.workspace_performance_targets where singleton),
 m as (select e.id,e.source,e.thread_ref,e.direction,e.sent_at,e.eff_at,lag(e.direction) over(partition by e.source,e.thread_ref order by e.eff_at,e.id) prev
  from (select g.id,g.source,g.thread_ref,g.direction,g.sent_at,
    case when g.direction='guest' and exists(select 1 from private.workspace_guest_thread_marks k where k.source=g.source and k.thread_ref=g.thread_ref and k.marked_at>=g.sent_at and k.marked_at<g.created_at) then g.created_at else g.sent_at end eff_at
   from private.workspace_guest_messages g where g.sent_at<upper_at and g.sent_at>=lower_at-interval '1 day'
   union all select k.id,k.source,k.thread_ref,'mark',k.marked_at,k.marked_at from private.workspace_guest_thread_marks k where k.marked_at<upper_at and k.marked_at>=lower_at-interval '1 day') e),
 asks as (select m.id,m.sent_at,e.at ended_at,e.kind ended_by from m
  left join lateral (select x.at,x.kind from (
    select r.sent_at at,'team' kind from private.workspace_guest_messages r where r.source=m.source and r.thread_ref=m.thread_ref and r.direction='team' and r.sent_at>=m.sent_at
    union all select k.marked_at,'mark' from private.workspace_guest_thread_marks k where k.source=m.source and k.thread_ref=m.thread_ref and k.marked_at>=m.eff_at) x
   order by x.at,x.kind desc limit 1) e on true
  where m.direction='guest' and (m.prev is null or m.prev in ('team','mark')) and m.sent_at>=lower_at),
 timed as (select a.id,a.sent_at,a.ended_by,extract(epoch from coalesce(a.ended_at,now())-a.sent_at)/60 mins from asks a)
 select x.id,x.sent_at,round(x.mins::numeric,1),
  case when x.mins<=t.green_minutes then 'green' when x.mins<=t.amber_minutes then 'amber' else 'red' end,s.user_id
 from timed x cross join t
 left join private.workspace_shifts s on s.department='guest_relations' and s.clocked_in_at<=x.sent_at and (s.clocked_out_at is null or s.clocked_out_at>x.sent_at)
 where x.ended_by='team' or (x.ended_by is null and x.mins>t.amber_minutes);
$$;
revoke all on function private.workspace_response_rows(timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- Patched by anchor: marking Done keeps a mark (only when it really changes from open to done), the
-- Hostaway import's "starts as Done" keeps one too, and a conversation's wait starts after the later
-- of the last team reply and the last mark (a message that only arrived after the mark still waits).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_guest_inbox_action(jsonb)',
   $q$update private.workspace_guest_threads set status=input->>'status' where id=th.id;$q$,
   $q$with moved as (update private.workspace_guest_threads set status=input->>'status' where id=th.id and status<>input->>'status' returning source,thread_ref)
   insert into private.workspace_guest_thread_marks(source,thread_ref,marked_by) select source,thread_ref,me from moved where input->>'status'='done';$q$,
   'workspace_guest_thread_marks'],
  ['private.workspace_hostaway_messages_ingest(jsonb)',
   $q$update private.workspace_guest_threads set status='done' where source='hostaway' and thread_ref=c->>'id' and last_message_at<now()-interval '24 hours';$q$,
   $q$with moved as (update private.workspace_guest_threads set status='done' where source='hostaway' and thread_ref=c->>'id' and last_message_at<now()-interval '24 hours' and status<>'done' returning source,thread_ref)
    insert into private.workspace_guest_thread_marks(source,thread_ref) select source,thread_ref from moved;$q$,
   'workspace_guest_thread_marks'],
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$msgs as (select m.direction,m.body,m.sent_at,m.id from$q$,
   $q$msgs as (select m.direction,m.body,m.sent_at,m.id,m.created_at from$q$,
   $q$m.id,m.created_at from$q$],
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$replied as (select max(sent_at) v from msgs where direction='team')$q$,
   $q$replied as (select max(sent_at) filter(where direction='team') v,(select max(k.marked_at) from private.workspace_guest_thread_marks k where k.source=t.source and k.thread_ref=t.thread_ref) mk from msgs)$q$,
   'workspace_guest_thread_marks'],
  ['private.guest_thread_json(private.workspace_guest_threads)',
   $q$m.sent_at>coalesce((select v from replied),'-infinity'::timestamptz)$q$,
   $q$m.sent_at>coalesce((select v from replied),'-infinity'::timestamptz) and (m.sent_at>coalesce((select mk from replied),'-infinity'::timestamptz) or m.created_at>(select mk from replied))$q$,
   $q$m.created_at>(select mk from replied)$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
