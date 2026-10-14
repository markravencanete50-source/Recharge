-- Email tabs: the 1 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261020600000%') then raise exception 'Email tabs is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261020600000_email_tabs =====
-- Messages gets two email tabs (Lee, 14 October): Guests, Clients, Guest emails, Client emails, Team. Every email lives in an email
-- tab; Guests and Clients keep the platform and app messages. Guest email already has its own conversations (source 'email'),
-- so the guest side is the screen only. Client email changes here, for new email from now on (old conversations stay where they are;
-- on 14 October live had none mixed):
--  * Email from an owner's address no longer goes into the owner's conversation with Recharge. It starts or joins a client email
--    conversation, linked to that owner, and is answered from ownerrelations@ like any other client email.
--  * "Assign to owner" becomes "Link to owner": the conversation stays in Client emails, takes the owner's name, and the address is
--    remembered. Nothing moves into the owner's app conversation any more.
--  * Each client email conversation says which owner it belongs to (ownerId, ownerName).
-- Replaced whole: private.workspace_email_owner_ingest (defined in 20261016500000, replaced whole in 20261019500000; nothing patches it).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_client_email_json, private.workspace_client_email_action.
-- Safe to run twice.

create or replace function private.workspace_email_owner_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];owner uuid;n integer;body text;th uuid;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','from','fromName','subject','text','receivedAt','messageId','inReplyTo','references','attachments'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or char_length(coalesce(input->>'emailId',''))=0 then raise exception 'Invalid email' using errcode='22023';end if;
 eid:=left(input->>'emailId',200);sender:=private.workspace_email_clean(input->>'from');
 if sender is null or not private.workspace_email_valid(sender) then raise exception 'Invalid sender' using errcode='22023';end if;
 sname:=nullif(left(btrim(coalesce(input->>'fromName','')),200),'');subj:=left(btrim(coalesce(input->>'subject','')),300);
 txt:=btrim(coalesce(input->>'text',''));at:=coalesce((input->>'receivedAt')::timestamptz,now());
 if at>now()+interval '5 minutes' then at:=now();end if;
 mid:=private.workspace_email_msgid(input->>'messageId');irt:=private.workspace_email_msgid(input->>'inReplyTo');
 refs:=coalesce((select array_agg(distinct r) from (select private.workspace_email_msgid(x) r from jsonb_array_elements_text(case when jsonb_typeof(input->'references')='array' then input->'references' else '[]'::jsonb end) x limit 50) q where r is not null),'{}');
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,from_address,received_at) values(eid,'owner','stored',sender,at) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('duplicate',true);end if;
 -- Every email is a client email conversation; one from an owner's address is linked to that owner.
 owner:=private.workspace_email_owner_find(sender);
 body:=case when btrim(txt)='' then '(no text)' else txt end;
 th:=private.workspace_client_email_in(eid,sender,sname,subj,body,at,mid,irt,refs,input);
 if owner is not null then update private.workspace_client_email_threads set owner_id=owner where id=th and owner_id is null;end if;
 return jsonb_build_object('stored',true,'matched',case when owner is null then 'unknown' else 'owner' end,'threadId',th);
end $$;

do $patch$
declare
 fixes text[][]:=array[
  -- Which owner a client email conversation belongs to.
  ['private.workspace_client_email_json(private.workspace_client_email_threads)',
   $q$'messages',(select count(*) from msgs))$q$,
   $q$'messages',(select count(*) from msgs),'ownerId',t.owner_id,'ownerName',(select p.full_name from public.workspace_profiles p where p.user_id=t.owner_id))$q$,
   $q$'ownerName',(select p.full_name from public.workspace_profiles p where p.user_id=t.owner_id)$q$],
  -- Link to owner: the conversation stays a client email conversation (Lee: every email in the email tabs).
  ['private.workspace_client_email_action(jsonb)',
   $q$if owner is null or not exists(select 1 from public.workspace_profiles where user_id=owner and role='client' and status='active') or not private.chat_owner_team(owner,me) then raise exception 'Owner not found' using errcode='42501';end if;$q$,
   $q$if owner is null or not exists(select 1 from public.workspace_profiles where user_id=owner and role='client' and status='active') or not private.chat_owner_team(owner,me) then raise exception 'Owner not found' using errcode='42501';end if;
  -- Email tabs: link the owner and remember the address; the conversation stays in Client emails.
  insert into private.workspace_email_owner_addresses(address,owner_id,added_by) values(th.address,owner,me) on conflict(address) do nothing;
  update private.workspace_client_email_threads set owner_id=owner where id=th.id;
  return jsonb_build_object('ok',true,'thread',private.workspace_client_email_json((select t from private.workspace_client_email_threads t where t.id=th.id)));$q$,
   $q$-- Email tabs: link the owner and remember the address$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_email_owner_ingest(jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('20261020600000','email_tabs');

commit;
