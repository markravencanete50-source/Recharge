-- Team feedback (11 October 2026).
--
-- Admins and the Stays team send feedback (an idea, a problem, praise or anything else) from the
-- app, always under their own name. It goes to the super admins only: they see every piece in
-- their Feedback inbox, mark it seen or done, and can reply. Senders see what they sent, its
-- status and any reply. Super admins hear about new feedback straight away, and the sender hears
-- when a super admin replies.

create table if not exists private.workspace_feedback (
 id uuid primary key default gen_random_uuid(),
 sent_by uuid not null references public.workspace_profiles(user_id),
 sender_role text not null check(sender_role in ('admin','stays')),
 category text not null check(category in ('idea','problem','praise','other')),
 message text not null check(char_length(btrim(message)) between 5 and 2000),
 status text not null default 'new' check(status in ('new','seen','done')),
 reply text not null default '' check(char_length(reply)<=1000),
 replied_by uuid references public.workspace_profiles(user_id),
 replied_at timestamptz,
 handled_by uuid references public.workspace_profiles(user_id),
 handled_at timestamptz,
 created_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index if not exists workspace_feedback_created_idx on private.workspace_feedback(created_at desc,id);
create index if not exists workspace_feedback_sender_idx on private.workspace_feedback(sent_by,created_at desc);
create index if not exists workspace_feedback_replier_idx on private.workspace_feedback(replied_by);
create index if not exists workspace_feedback_handler_idx on private.workspace_feedback(handled_by);
alter table private.workspace_feedback enable row level security;
revoke all on private.workspace_feedback from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_feedback for each row execute function private.workspace_enforce_write_limit();

create or replace function private.workspace_feedback_view(f private.workspace_feedback) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',f.id,'category',f.category,'message',f.message,'status',f.status,'createdAt',f.created_at,'version',f.version,
  'sentBy',f.sent_by,'senderRole',f.sender_role,'senderName',(select p.full_name from public.workspace_profiles p where p.user_id=f.sent_by),
  'reply',f.reply,'repliedAt',f.replied_at,'repliedByName',(select p.full_name from public.workspace_profiles p where p.user_id=f.replied_by),
  'handledAt',f.handled_at,'handledByName',(select p.full_name from public.workspace_profiles p where p.user_id=f.handled_by))
$fn$;

-- Super admins read the whole inbox; admins and Stays read what they sent; nobody else has it.
create or replace function private.workspace_feedback_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor='super_admin' then
  return jsonb_build_object('inbox',true,'canSend',false,
   'items',(select coalesce(jsonb_agg(private.workspace_feedback_view(f) order by f.created_at desc,f.id),'[]') from (
     select * from private.workspace_feedback x order by x.created_at desc,x.id limit 500) f));
 elsif actor in ('admin','stays') then
  return jsonb_build_object('inbox',false,'canSend',true,
   'items',(select coalesce(jsonb_agg(private.workspace_feedback_view(f) order by f.created_at desc,f.id),'[]') from (
     select * from private.workspace_feedback x where x.sent_by=auth.uid() order by x.created_at desc,x.id limit 200) f));
 end if;
 raise exception 'Feedback access required' using errcode='42501';
end $fn$;

create or replace function private.workspace_feedback_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 f private.workspace_feedback;event_id bigint;new_reply text;replied boolean;
begin
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='sendFeedback' then
  if coalesce(actor,'') not in ('admin','stays') then raise exception 'Only admins and the Stays team send feedback' using errcode='42501';end if;
  perform private.workspace_json_keys(input,array['action','requestId','category','message']);
  if coalesce(input->>'category','') not in ('idea','problem','praise','other') then raise exception 'Choose what kind of feedback it is' using errcode='22023';end if;
  if (select count(*) from private.workspace_feedback x where x.sent_by=auth.uid() and x.created_at>now()-interval '1 hour')>=10 then
   raise exception 'That is a lot of feedback in one hour. Try again a little later.' using errcode='P0001';
  end if;
  insert into private.workspace_feedback(sent_by,sender_role,category,message)
   values(auth.uid(),actor,input->>'category',private.workspace_required_text(input,'message',5,2000)) returning * into f;
  -- Every super admin hears about it.
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'feedback.received') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,event_id from public.workspace_profiles p where p.status='active' and p.role='super_admin' and p.user_id<>auth.uid() on conflict do nothing;
 elsif a='updateFeedback' then
  if coalesce(actor,'')<>'super_admin' then raise exception 'Only a super admin can handle feedback' using errcode='42501';end if;
  perform private.workspace_json_keys(input,array['action','requestId','feedbackId','version','status','reply']);
  select * into f from private.workspace_feedback x where x.id=(input->>'feedbackId')::uuid for update;
  if f.id is null then raise exception 'Feedback not found' using errcode='P0002';end if;
  if f.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if coalesce(input->>'status','') not in ('new','seen','done') then raise exception 'Choose a status' using errcode='22023';end if;
  if input ? 'reply' and jsonb_typeof(input->'reply')<>'string' then raise exception 'Invalid reply' using errcode='22023';end if;
  new_reply:=case when input ? 'reply' then btrim(input->>'reply') else f.reply end;
  if char_length(new_reply)>1000 then raise exception 'Keep the reply to 1000 characters' using errcode='22023';end if;
  replied:=new_reply<>f.reply and new_reply<>'';
  update private.workspace_feedback x set status=input->>'status',
   handled_by=case when input->>'status'<>f.status then auth.uid() else x.handled_by end,
   handled_at=case when input->>'status'<>f.status then now() else x.handled_at end,
   reply=new_reply,
   replied_by=case when new_reply='' then null when replied then auth.uid() else x.replied_by end,
   replied_at=case when new_reply='' then null when replied then now() else x.replied_at end,
   version=x.version+1
   where x.id=f.id returning x.* into f;
  -- The sender hears when there is a new reply.
  if replied then
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'feedback.replied') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.user_id=f.sent_by and p.status='active' on conflict do nothing;
  end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 result:=private.workspace_feedback_view(f);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_feedback_view(private.workspace_feedback),private.workspace_feedback_read(),private.workspace_feedback_action(jsonb)
 from public,anon,authenticated;

-- Routes: the feedback list in the team read, and the feedback actions.
do $$
declare
 fixes text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$ if input->>'action' in ('startPause','endPause','startOvertime','savePausePolicy') then return private.workspace_pause_action(input);end if;$q$,
   $q$ if input->>'action' in ('sendFeedback','updateFeedback') then return private.workspace_feedback_action(input);end if;
 if input->>'action' in ('startPause','endPause','startOvertime','savePausePolicy') then return private.workspace_pause_action(input);end if;$q$,
   $q$private.workspace_feedback_action(input)$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$ elsif section='clientEnquiries' then result:=private.workspace_client_enquiries_read();$q$,
   $q$ elsif section='clientEnquiries' then result:=private.workspace_client_enquiries_read();
 elsif section='feedback' then result:=private.workspace_feedback_read();$q$,
   $q$private.workspace_feedback_read()$q$]
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
