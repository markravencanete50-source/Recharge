-- Client email conversations, round 2 (Lee: one conversation per person, but show each new subject).
-- A new email from the same person on a different subject joins their open conversation as before, and now:
--   * the message starts with its "Subject: ..." line, like the first email of a conversation;
--   * the conversation takes the newest subject, so the Clients row and the pane header show it and the reply goes out as "Re: <it>".
-- Replies (matched by In-Reply-To / References) and "Re: / Fwd:" of the same subject change nothing.
-- Replaced whole: private.workspace_client_email_in (only 20261019500000 defines it). New: private.workspace_client_email_topic.
-- Safe to run twice (create or replace only; no data change).

-- The subject without "Re:" / "Fwd:" prefixes, lower case, for comparing.
create or replace function private.workspace_client_email_topic(s text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(regexp_replace(coalesce(s,''),'^(\s*(re|fwd?|aw|sv|wg)\s*(\[\d+\])?\s*:\s*)+','','i'))),'')
$$;
revoke all on function private.workspace_client_email_topic(text) from public,anon,authenticated,service_role;

create or replace function private.workspace_client_email_in(eid text,sender text,sname text,subj text,body text,at timestamptz,mid text,irt text,refs text[],input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare th private.workspace_client_email_threads;ids text[]:=array_remove(array[irt]||refs,null);msg uuid;ev bigint;fresh boolean:=false;by_address boolean:=false;new_topic boolean:=false;topic text:=nullif(btrim(coalesce(subj,'')),'');begin
 if cardinality(ids)>0 then
  select t.* into th from private.workspace_client_email_messages m join private.workspace_client_email_threads t on t.id=m.thread_id
   where lower(m.rfc_message_id)=any(ids) and t.status<>'assigned' order by t.last_message_at desc limit 1;
 end if;
 if th.id is null then
  select * into th from private.workspace_client_email_threads t where t.address=sender and t.status<>'assigned' order by t.last_message_at desc limit 1;
  by_address:=th.id is not null;
 end if;
 if th.id is null then
  insert into private.workspace_client_email_threads(address,name,subject,last_message_at) values(sender,sname,topic,at) returning * into th;
  fresh:=true;
 end if;
 -- One conversation per person. A new email (not a reply) on another subject joins it, starts with its subject as written, and becomes
 -- the conversation's subject: the row and header show it and the team's reply is "Re: <it>". An older one arriving late shows its line
 -- but leaves the conversation's subject alone.
 new_topic:=by_address and topic is not null and private.workspace_client_email_topic(topic) is distinct from private.workspace_client_email_topic(th.subject);
 if (fresh or new_topic) and topic is not null and body not like 'Subject: %' then body:='Subject: '||topic||E'\n\n'||body;end if;
 insert into private.workspace_client_email_messages(thread_id,direction,email_id,body,sent_at,rfc_message_id,in_reply_to,refs)
  values(th.id,'in',eid,left(body,5000),at,mid,irt,refs) on conflict do nothing returning id into msg;
 if msg is null then return th.id;end if;
 update private.workspace_client_email_threads set status='open',closed_at=null,closed_by=null,last_message_at=greatest(last_message_at,at),
  name=coalesce(name,sname),subject=case when new_topic and at>=th.last_message_at then topic else coalesce(subject,topic) end where id=th.id;
 if jsonb_typeof(input->'attachments')='array' then
  insert into private.workspace_email_attachments(client_email_message_id,path,filename,mime,bytes)
   select msg,a->>'path',left(coalesce(nullif(a->>'filename',''),'attachment'),200),a->>'mime',(a->>'bytes')::integer from jsonb_array_elements(input->'attachments') a limit 10
   on conflict(path) do nothing;
 end if;
 begin
  insert into public.workspace_activity(actor_id,property_id,event_type) values(null,null,'client.email') returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id) select u,ev from private.workspace_client_email_team() u on conflict do nothing;
 exception when others then raise warning 'Client email notices skipped: %',sqlerrm;
 end;
 return th.id;
end $$;

revoke all on function private.workspace_client_email_in(text,text,text,text,text,timestamptz,text,text,text[],jsonb) from public,anon,authenticated,service_role;
