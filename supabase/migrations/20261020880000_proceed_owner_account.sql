-- Proceed makes the owner's app account (Lee and Alex, client meeting). When a client presses Proceed on the estimate
-- page (the private link, migration 20261019520000), the server makes them an owner account if their email has none,
-- gives it the property, and emails a secure link to choose their password (no temporary password). If the email
-- already has an owner account, the property is added to it and the email says so, with a sign-in link.
--  * private.workspace_owner_accounts: one row per property, what was done and whether the email went (pending,
--    sending, sent, failed, or skipped with the reason). The team sees it on the property and can send it again.
--  * private.workspace_owner_account(input): the steps the server takes, in order: prepare (who, and whether an
--    account exists), link (make the account an active owner with the usual owner tools, give it the property and
--    claim the email so only one is sent at a time) and markEmail. From the estimate page the server calls it with the
--    link's token hash and the service key; the team (stays with the onboarding tool, admins) call it for a property
--    they can see, to send the email again or to make the account when they recorded Proceed for the owner.
--  * Never two accounts: the sign-in service allows one per email, and the database links an existing one. Never two
--    emails: the email is claimed ("sending") before it is sent, and a retry finds it sent.
--  * An existing account whose email was never confirmed gets the "choose your password" email, never the "sign in"
--    one, so nobody who signed up with someone else's email can use it.
--  * Skipped, with the reason shown to the team: no email on the enquiry, the email belongs to a team member or a
--    blocked account, or owner accounts are switched off (the team beta, private.workspace_beta_mode).
--  * The estimate link keeps working after Proceed for that client (private.workspace_estimate_public refused it once
--    the property had an owner account).
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_estimate_public (the link check) and
-- private.workspace_journey_view (the team sees the account and its email).
-- Safe to run twice.

create table if not exists private.workspace_owner_accounts (
 property_id uuid primary key references public.workspace_properties(id) on delete cascade,
 email text not null default '' check(length(email)<=320),
 user_id uuid references public.workspace_profiles(user_id) on delete set null,
 created_account boolean not null default false,
 email_kind text check(email_kind in ('welcome','added')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','sent','failed','skipped')),
 skipped_reason text not null default '' check(skipped_reason in ('','no_email','team_account','blocked','owner_accounts_off')),
 attempts integer not null default 0,
 last_request_id uuid,
 last_attempt_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table private.workspace_owner_accounts enable row level security;
revoke all on private.workspace_owner_accounts from public,anon,authenticated;

create or replace function private.workspace_owner_account(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a text:=coalesce(input->>'action','');me uuid:=auth.uid();actor text;target uuid;l private.workspace_estimate_links;j private.workspace_journeys;
 who jsonb;address text;person uuid;confirmed boolean;made boolean;profile public.workspace_profiles;rec private.workspace_owner_accounts;prop text;
 team boolean:=false;reason text:='';beta boolean:=coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton),false);
begin
 -- Who is asking: the server for the estimate page (no signed-in user, the link's token hash), or the team.
 if me is null then
  if coalesce(input->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode='P0002';end if;
  select * into l from private.workspace_estimate_links where token_hash=input->>'tokenHash';
  if l.id is null or l.decision is distinct from 'proceed' then return jsonb_build_object('state','none');end if;
  target:=l.property_id;
 else
  actor:=private.workspace_actor_role();
  begin target:=(input->>'propertyId')::uuid;exception when others then target:=null;end;
  if coalesce(actor,'') not in ('stays','admin','super_admin') or target is null or not private.workspace_can_property(target,'property-onboarding') then raise exception 'Onboarding access denied' using errcode='42501';end if;
  team:=true;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('recharge-owner-account:'||target::text,0));
 select * into j from private.workspace_journeys where property_id=target;
 select * into rec from private.workspace_owner_accounts where property_id=target;
 prop:=(select p.name from public.workspace_properties p where p.id=target);
 who:=private.workspace_estimate_recipient(target);
 if j.property_id is null or j.stage in ('enquiry','estimate','reviewing','archived') then
  if team then raise exception 'The owner account is made once the owner chooses Proceed' using errcode='22023';end if;
  return jsonb_build_object('state','none');
 end if;

 if a='prepare' then
  perform private.workspace_json_keys(input,array['action','tokenHash','propertyId','requestId']);
  if rec.email_status='sent' and not team then return jsonb_build_object('state','done');end if;
  if j.client_id is not null then
   person:=j.client_id;
   address:=lower((select u.email from auth.users u where u.id=person));
  else
   address:=lower(btrim(coalesce(who->>'email','')));
   select u.id into person from auth.users u where lower(u.email)=address order by u.id limit 1;
  end if;
  select * into profile from public.workspace_profiles where user_id=person;
  if coalesce(address,'')!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
   insert into private.workspace_owner_accounts(property_id,email_status,skipped_reason) values(target,'skipped','no_email')
    on conflict(property_id) do update set email_status='skipped',skipped_reason='no_email',updated_at=now();
   return jsonb_build_object('state','skipped','reason','no_email');
  end if;
  insert into private.workspace_owner_accounts(property_id,email,user_id) values(target,address,person)
   on conflict(property_id) do update set email=excluded.email,user_id=coalesce(excluded.user_id,private.workspace_owner_accounts.user_id),updated_at=now();
  -- Never an owner account on a team member's or a blocked email, and no new one while owner accounts are switched off.
  if person is not null and profile.role is distinct from 'client' then reason:='team_account';
  elsif person is not null and profile.status='revoked' then reason:='blocked';
  elsif beta and (person is null or profile.status is distinct from 'active') then reason:='owner_accounts_off';
  end if;
  if reason<>'' then
   update private.workspace_owner_accounts set email_status='skipped',skipped_reason=reason,updated_at=now() where property_id=target;
   return jsonb_build_object('state','skipped','reason',reason);
  end if;
  update private.workspace_owner_accounts set email_status=case when email_status='skipped' then 'pending' else email_status end,skipped_reason='',updated_at=now() where property_id=target;
  return jsonb_build_object('state','ready','propertyId',target,'propertyName',prop,'email',address,'name',coalesce(nullif(btrim(who->>'name'),''),profile.full_name,''),'userId',person);

 elsif a='link' then
  perform private.workspace_json_keys(input,array['action','tokenHash','propertyId','requestId','userId','created']);
  begin person:=(input->>'userId')::uuid;exception when others then person:=null;end;
  made:=coalesce(input->'created'='true'::jsonb,false);
  select u.email_confirmed_at is not null into confirmed from auth.users u where u.id=person and lower(u.email)=rec.email;
  if rec.property_id is null or rec.email_status='skipped' or person is null or confirmed is null then raise exception 'That account does not match this enquiry' using errcode='22023';end if;
  if j.client_id is not null and j.client_id<>person then raise exception 'This property already has another owner account' using errcode='22023';end if;
  select * into profile from public.workspace_profiles where user_id=person for update;
  if profile.user_id is null or profile.role<>'client' or profile.status='revoked' then raise exception 'That account cannot be an owner account' using errcode='22023';end if;
  if profile.status<>'active' then
   if beta then
    update private.workspace_owner_accounts set email_status='skipped',skipped_reason='owner_accounts_off',updated_at=now() where property_id=target;
    return jsonb_build_object('send',false,'emailStatus','skipped');
   end if;
   update public.workspace_profiles set status='active',
    full_name=case when btrim(full_name)='' then left(coalesce(nullif(btrim(who->>'name'),''),''),200) else full_name end where user_id=person;
   insert into public.workspace_module_grants(user_id,module_id) select person,m from unnest(private.workspace_role_tools('client')) m on conflict do nothing;
  else
   insert into public.workspace_module_grants(user_id,module_id) values(person,'property-onboarding') on conflict do nothing;
  end if;
  if j.client_id is null then
   update private.workspace_journeys set client_id=person,version=version+1,updated_at=now() where property_id=target;
  end if;
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by)
   values(target,person,'client',coalesce(me,l.issued_by,(select x.issued_by from private.workspace_estimate_links x where x.property_id=target order by x.issued_at desc limit 1),
    (select p.created_by from public.workspace_properties p where p.id=target)))
   on conflict(property_id,user_id) do nothing;
  update private.workspace_owner_accounts set user_id=person,created_account=created_account or made,
   email_kind=case when email_kind='welcome' or made or not confirmed then 'welcome' else 'added' end,updated_at=now()
   where property_id=target returning * into rec;
  -- Claim the email: one at a time, and never again once sent unless the team asks (once per request of theirs).
  if team and rec.last_request_id is not null and rec.last_request_id::text=input->>'requestId' then return jsonb_build_object('send',false,'emailStatus',rec.email_status);end if;
  if rec.email_status in ('pending','failed') or (rec.email_status='sending' and rec.last_attempt_at<now()-interval '2 minutes') or (team and rec.email_status='sent') then
   update private.workspace_owner_accounts set email_status='sending',attempts=attempts+1,last_attempt_at=now(),updated_at=now(),
    last_request_id=case when team and input->>'requestId'~'^[0-9a-f-]{36}$' then (input->>'requestId')::uuid end where property_id=target returning * into rec;
   return jsonb_build_object('send',true,'kind',rec.email_kind,'email',rec.email,'name',coalesce(nullif(btrim(who->>'name'),''),nullif(btrim(profile.full_name),''),''),
    'propertyName',prop,'propertyId',target,'attempt',rec.attempts);
  end if;
  return jsonb_build_object('send',false,'emailStatus',rec.email_status);

 elsif a='markEmail' then
  perform private.workspace_json_keys(input,array['action','tokenHash','propertyId','requestId','emailStatus']);
  if coalesce(input->>'emailStatus','') not in ('sent','failed') then raise exception 'Invalid email status' using errcode='22023';end if;
  update private.workspace_owner_accounts set email_status=input->>'emailStatus',sent_at=case when input->>'emailStatus'='sent' then now() else sent_at end,updated_at=now()
   where property_id=target and email_status='sending' returning * into rec;
  return jsonb_build_object('emailStatus',coalesce(rec.email_status,(select o.email_status from private.workspace_owner_accounts o where o.property_id=target)));
 end if;
 raise exception 'Unknown owner account action' using errcode='22023';
end $$;

do $patch$
declare
 fixes constant text[][] := array[
  -- After Proceed the client's link still opens (as "proceeding"), now that the property has their account.
  ['private.workspace_estimate_public(jsonb)',
   $q$if j.property_id is null or j.client_id is not null or j.estimate is null then raise exception 'This link is not valid' using errcode='P0002';end if;$q$,
   $q$if j.property_id is null or (j.client_id is not null and l.decision is distinct from 'proceed') or j.estimate is null then raise exception 'This link is not valid' using errcode='P0002';end if;$q$,
   $q$l.decision is distinct from 'proceed')$q$],
  -- The team sees the owner account's email: sent, failed (send it again) or skipped and why.
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,$q$,
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,
 'ownerAccountEmail',(select jsonb_build_object('status',o.email_status,'kind',o.email_kind,'reason',o.skipped_reason,'email',o.email,'createdAccount',o.created_account,'attempts',o.attempts,'sentAt',o.sent_at,'lastAttemptAt',o.last_attempt_at)
   from private.workspace_owner_accounts o where o.property_id=j.property_id and coalesce(private.workspace_actor_role(),'') in ('stays','admin','super_admin')),$q$,
   $q$'ownerAccountEmail'$q$]
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

create or replace function public.workspace_owner_account(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_account(input);$$;
revoke all on function private.workspace_owner_account(jsonb),public.workspace_owner_account(jsonb) from public,anon;
grant execute on function private.workspace_owner_account(jsonb),public.workspace_owner_account(jsonb) to authenticated,service_role;
