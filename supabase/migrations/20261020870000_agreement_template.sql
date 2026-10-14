-- Management agreement from an uploaded contract (Lee: "an option to import the contract so that will be the template
-- moving forward"). Admins upload the contract once (Management centre, Onboarding settings); every agreement published
-- from then on can be made from it. A new upload replaces it for future agreements only.
--  * private.workspace_agreement_templates keeps every contract uploaded, never changed or removed: a Word document's text
--    (headings, paragraphs and lists, read on the server) or a PDF kept as it is, with the file's size and SHA-256.
--  * private.workspace_onboarding_settings (one row): the contract in use, Recharge's own details for the agreement, and
--    the "Your own costs" categories for the estimate (used from 20261020890000).
--  * Placeholders such as {{Owner name}} in a Word contract are filled in from the property, the owner or enquiry and the
--    estimate when the agreement is published. Without placeholders, or for a PDF, the owner's, the property's and
--    Recharge's details go in a block at the top (for a PDF, as a cover page beside the PDF).
--  * publishAgreement takes templateId instead of agreement: the database fills the text in and keeps it on the journey with
--    the template it came from, so a published or signed agreement never changes when a new contract is uploaded.
--    Typed agreements work as before.
--  * The journey view adds the agreement's format and template, and for the team at the agreement step a preview of the
--    agreement the contract in use would make, with any details still missing.
--  * Files are kept in the private "agreement-templates" bucket (5 MB, Word or PDF); only the server opens it, with a
--    10-minute link: admins any contract, everyone else only the contract their own agreement was made from.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_journey_action (the declarations and
-- publishAgreement) and private.workspace_journey_view (its fields).
-- Safe to run twice.

create table if not exists private.workspace_agreement_templates (
 id uuid primary key,
 version integer not null unique check(version>0),
 kind text not null check(kind in ('docx','pdf')),
 file_name text not null check(length(file_name) between 1 and 200),
 file_path text not null unique check(file_path ~ '^agreements/[0-9a-f-]{36}\.(docx|pdf)$'),
 file_bytes integer not null check(file_bytes between 1 and 5242880),
 file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
 body text not null default '' check(length(body)<=200000),
 uploaded_by uuid not null references public.workspace_profiles(user_id),
 uploaded_at timestamptz not null default now(),
 check((kind='pdf')=(body=''))
);
alter table private.workspace_agreement_templates enable row level security;
revoke all on private.workspace_agreement_templates from public,anon,authenticated;

create table if not exists private.workspace_onboarding_settings (
 singleton boolean primary key default true check(singleton),
 agreement_template_id uuid references private.workspace_agreement_templates(id),
 company_details text not null default '' check(length(company_details)<=2000),
 own_cost_categories jsonb not null default '["Mortgage","Insurance","Utilities","Council tax","Other"]'::jsonb
  check(jsonb_typeof(own_cost_categories)='array' and jsonb_array_length(own_cost_categories) between 1 and 12),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
insert into private.workspace_onboarding_settings(singleton) values(true) on conflict do nothing;
alter table private.workspace_onboarding_settings enable row level security;
revoke all on private.workspace_onboarding_settings from public,anon,authenticated;

alter table private.workspace_journeys add column if not exists agreement_template_id uuid references private.workspace_agreement_templates(id);
alter table private.workspace_journeys add column if not exists agreement_format text not null default 'text';
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_journeys'::regclass and conname='workspace_journeys_agreement_format') then
  alter table private.workspace_journeys add constraint workspace_journeys_agreement_format check(agreement_format in ('text','outline'));
 end if;
end $$;

do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('agreement-templates','agreement-templates',false,5242880,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
   on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- The placeholders a contract can use, as shown to admins (lib/agreement-template.ts lists the same, checked by its test).
create or replace function private.workspace_agreement_placeholders() returns text[] language sql immutable set search_path='' as $$
 select array['Owner name','Owner email','Company name','Property name','Property address','Management fee','Start date']
$$;
-- "{{ owner  Name }}" and "{{Owner name}}" are the same placeholder.
create or replace function private.workspace_agreement_key(token text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(regexp_replace(token,'^\{\{|\}\}$','','g')),'\s+',' ','g'))
$$;
-- Every placeholder in a contract's text, once each, as written.
create or replace function private.workspace_agreement_tokens(body text) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct m[1]),'{}') from regexp_matches(coalesce(body,''),'(\{\{[^{}]{1,60}\}\})','g') m
$$;

-- What fills each placeholder for a property, read when the agreement is published. Line breaks become commas, so a
-- value never starts a heading or a list.
create or replace function private.workspace_agreement_values(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'owner name',coalesce(nullif(btrim(pr.full_name),''),nullif(btrim(x.r->>'name'),''),''),
  'owner email',coalesce(nullif(lower(u.email),''),nullif(lower(btrim(x.r->>'email')),''),''),
  'company name',coalesce(nullif(btrim(j.enquiry->>'companyName'),''),
   (select nullif(btrim(e.answers->>'companyName'),'') from private.workspace_client_enquiries e where e.property_id=target order by e.sent_at desc limit 1),''),
  'property name',btrim(p.name),
  'property address',btrim(regexp_replace(p.address,'\s*[\r\n]+\s*',', ','g')),
  'management fee',case when coalesce(j.estimate->>'managementFeeBps','')~'^\d+$' then trim_scale(round((j.estimate->>'managementFeeBps')::numeric/100,2))::text||'%' else '' end,
  'start date',to_char((now() at time zone 'Europe/London')::date,'FMDD FMMonth YYYY'))
 from private.workspace_journeys j join public.workspace_properties p on p.id=j.property_id
 left join public.workspace_profiles pr on pr.user_id=j.client_id left join auth.users u on u.id=j.client_id
 cross join lateral (select private.workspace_estimate_recipient(target) r) x
 where j.property_id=target
$$;

-- The agreement a contract makes for a property, in the outline format lib/agreement-copy.ts shows ("# " a heading,
-- "## " a smaller one, "- " and "1. " lists, a blank line between blocks). Placeholders are filled in; without any, or
-- for a PDF, the details go in a block at the top.
create or replace function private.workspace_agreement_fill(target uuid,template uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare t private.workspace_agreement_templates;v jsonb:=private.workspace_agreement_values(target);body text;token text;k text;filled boolean:=false;
 company text;details text[];
begin
 select * into t from private.workspace_agreement_templates where id=template;
 if t.id is null or v is null then return null;end if;
 body:=t.body;
 foreach token in array private.workspace_agreement_tokens(body) loop
  k:=private.workspace_agreement_key(token);
  if v ? k then body:=replace(body,token,v->>k);filled:=true;end if;
 end loop;
 if filled then return body;end if;
 select btrim(s.company_details) into company from private.workspace_onboarding_settings s where s.singleton;
 details:=array['# Agreement details','## The owner',
  concat_ws(E'\n','Name: '||nullif(v->>'owner name',''),'Company: '||nullif(v->>'company name',''),'Email: '||nullif(v->>'owner email','')),
  '## The property',concat_ws(E'\n',v->>'property name',nullif(v->>'property address','')),
  '## Recharge',coalesce(nullif(company,''),'Recharge Property Management'),
  concat_ws(E'\n','Management fee: '||nullif(v->>'management fee',''),'Start date: '||(v->>'start date'))];
 return array_to_string(array_remove(details,''),E'\n\n')||E'\n\n'||case when t.kind='docx' then body
  else '## The agreement'||E'\n\n'||'The agreement is the attached document, '||t.file_name||'. Read it with this page; both together are the agreement.' end;
end $$;

-- The details a contract would leave blank for this property (shown to the team before publishing).
create or replace function private.workspace_agreement_missing(target uuid,template uuid) returns text[]
language sql stable security definer set search_path='' as $$
 with v as (select private.workspace_agreement_values(target) v),
 supported as (select u.n,lower(u.n) k,u.o from unnest(private.workspace_agreement_placeholders()) with ordinality u(n,o)),
 used as (select distinct private.workspace_agreement_key(x) k from private.workspace_agreement_templates t,unnest(private.workspace_agreement_tokens(t.body)) x where t.id=template)
 select coalesce(array_agg(s.n order by s.o),'{}') from supported s,v
 where coalesce(v.v->>s.k,'')='' and (s.k in (select k from used)
  or (not exists(select 1 from used join supported x on x.k=used.k) and s.k in ('owner name','management fee')))
$$;

create or replace function private.workspace_agreement_template_json(t private.workspace_agreement_templates) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'version',t.version,'kind',t.kind,'fileName',t.file_name,'bytes',t.file_bytes,'sha256',t.file_sha256,'uploadedAt',t.uploaded_at,
  'uploadedByName',(select p.full_name from public.workspace_profiles p where p.user_id=t.uploaded_by),
  'placeholders',coalesce((select jsonb_agg(n order by array_position(private.workspace_agreement_placeholders(),n)) from unnest(private.workspace_agreement_placeholders()) n
    where lower(n) in (select private.workspace_agreement_key(x) from unnest(private.workspace_agreement_tokens(t.body)) x)),'[]'),
  'unknown',coalesce((select jsonb_agg(distinct x order by x) from unnest(private.workspace_agreement_tokens(t.body)) x
    where private.workspace_agreement_key(x) not in (select lower(n) from unnest(private.workspace_agreement_placeholders()) n)),'[]'),
  'characters',length(t.body),
  'agreements',(select count(*) from private.workspace_journeys j where j.agreement_template_id=t.id))
$$;

-- Onboarding settings, for admins: the contract in use and the ones before it, Recharge's details, the supported
-- placeholders and the "Your own costs" categories.
create or replace function private.workspace_onboarding_settings_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s private.workspace_onboarding_settings;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 select * into s from private.workspace_onboarding_settings where singleton;
 return jsonb_build_object(
  'template',(select private.workspace_agreement_template_json(t) from private.workspace_agreement_templates t where t.id=s.agreement_template_id),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version,'kind',t.kind,'fileName',t.file_name,'uploadedAt',t.uploaded_at,'inUse',t.id is not distinct from s.agreement_template_id,
    'agreements',(select count(*) from private.workspace_journeys j where j.agreement_template_id=t.id)) order by t.version desc)
    from (select * from private.workspace_agreement_templates order by version desc limit 20) t),'[]'),
  'supported',to_jsonb(private.workspace_agreement_placeholders()),
  'companyDetails',s.company_details,'ownCostCategories',s.own_cost_categories,'updatedAt',s.updated_at);
end $$;

-- Admins: a contract uploaded (from the server, after the file is stored), stop using the contract, or Recharge's details.
create or replace function private.workspace_onboarding_settings_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a text:=coalesce(input->>'action','');t private.workspace_agreement_templates;tid uuid;cats jsonb;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('recharge-onboarding-settings',0));
 if a='addTemplate' then
  perform private.workspace_json_keys(input,array['action','templateId','kind','fileName','bytes','sha256','body']);
  begin tid:=(input->>'templateId')::uuid;exception when others then tid:=null;end;
  if tid is null or coalesce(input->>'kind','') not in ('docx','pdf') then raise exception 'Upload a Word document (.docx) or a PDF' using errcode='22023';end if;
  select * into t from private.workspace_agreement_templates where id=tid;
  if t.id is null then
   if coalesce(input->>'bytes','')!~'^\d{1,7}$' or (input->>'bytes')::int not between 1 and 5242880 then raise exception 'Contracts can be up to 5 MB' using errcode='22023';end if;
   if coalesce(input->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid file' using errcode='22023';end if;
   if input->>'kind'='docx' and length(btrim(coalesce(input->>'body','')))<20 then raise exception 'No text was found in this document' using errcode='22023';end if;
   if length(coalesce(input->>'body',''))>200000 then raise exception 'This contract is too long. Keep it under 200,000 characters.' using errcode='22023';end if;
   insert into private.workspace_agreement_templates(id,version,kind,file_name,file_path,file_bytes,file_sha256,body,uploaded_by)
    values(tid,coalesce((select max(version) from private.workspace_agreement_templates),0)+1,input->>'kind',private.workspace_required_text(input,'fileName',1,200),
     'agreements/'||tid||'.'||(input->>'kind'),(input->>'bytes')::int,input->>'sha256',case when input->>'kind'='docx' then input->>'body' else '' end,auth.uid()) returning * into t;
   update private.workspace_onboarding_settings set agreement_template_id=t.id,updated_by=auth.uid(),updated_at=now() where singleton;
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'onboarding.agreementTemplate');
  elsif t.uploaded_by<>auth.uid() then raise exception 'Request identifier reused' using errcode='23505';
  end if;
 elsif a='stopTemplate' then
  perform private.workspace_json_keys(input,array['action']);
  update private.workspace_onboarding_settings set agreement_template_id=null,updated_by=auth.uid(),updated_at=now() where singleton;
 elsif a='useTemplate' then
  perform private.workspace_json_keys(input,array['action','templateId']);
  begin tid:=(input->>'templateId')::uuid;exception when others then tid:=null;end;
  if not exists(select 1 from private.workspace_agreement_templates where id=tid) then raise exception 'Contract not found' using errcode='P0002';end if;
  update private.workspace_onboarding_settings set agreement_template_id=tid,updated_by=auth.uid(),updated_at=now() where singleton;
 elsif a='saveCompanyDetails' then
  perform private.workspace_json_keys(input,array['action','companyDetails']);
  if jsonb_typeof(input->'companyDetails') is distinct from 'string' or length(input->>'companyDetails')>2000 then raise exception 'Recharge''s details can be up to 2,000 characters' using errcode='22023';end if;
  update private.workspace_onboarding_settings set company_details=btrim(input->>'companyDetails'),updated_by=auth.uid(),updated_at=now() where singleton;
 elsif a='saveCostCategories' then
  perform private.workspace_json_keys(input,array['action','categories']);
  if jsonb_typeof(input->'categories') is distinct from 'array' or jsonb_array_length(input->'categories') not between 1 and 12
   or exists(select 1 from jsonb_array_elements(input->'categories') c where jsonb_typeof(c)<>'string' or length(btrim(c#>>'{}')) not between 1 and 60) then
   raise exception 'Add between 1 and 12 categories, each up to 60 characters' using errcode='22023';end if;
  select jsonb_agg(x order by o) into cats from (select distinct on (lower(btrim(c#>>'{}'))) btrim(c#>>'{}') x,o from jsonb_array_elements(input->'categories') with ordinality e(c,o) order by lower(btrim(c#>>'{}')),o) d;
  if jsonb_array_length(cats)<>jsonb_array_length(input->'categories') then raise exception 'Each category once' using errcode='22023';end if;
  update private.workspace_onboarding_settings set own_cost_categories=cats,updated_by=auth.uid(),updated_at=now() where singleton;
 else raise exception 'Unknown settings action' using errcode='22023';
 end if;
 return private.workspace_onboarding_settings_read();
end $$;

-- Where a contract's file is kept, for a 10-minute link: admins any contract; anyone else only the contract the
-- agreement on a property they can see was made from (an owner, their own agreement).
create or replace function private.workspace_agreement_file(template uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t private.workspace_agreement_templates;role text:=private.workspace_actor_role();begin
 if role is null then raise exception 'Active access required' using errcode='42501';end if;
 select * into t from private.workspace_agreement_templates where id=template;
 if t.id is null or not (role in ('admin','super_admin') or (target is not null and private.workspace_can_property(target,'property-onboarding')
   and exists(select 1 from private.workspace_journeys j where j.property_id=target and j.agreement_template_id=t.id))) then
  raise exception 'Contract not found' using errcode='P0002';end if;
 return jsonb_build_object('path',t.file_path,'name',t.file_name,'kind',t.kind,'mime',case t.kind when 'pdf' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end);
end $$;

do $patch$
declare
 fixes constant text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$task uuid; invoice public.workspace_invoices; entry jsonb;$q$,
   $q$task uuid; invoice public.workspace_invoices; entry jsonb; agreement_template uuid;$q$,
   $q$agreement_template uuid;$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement','templateId']);$q$,
   $q$'agreement','templateId']$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$update private.workspace_journeys set agreement=private.workspace_required_text(input,'agreement',20,10000),agreement_revision=agreement_revision+1 where property_id=target;$q$,
   $q$-- From the contract in use (20261020870000): filled in here and kept, with the contract it came from.
   if input ? 'templateId' then
    if input ? 'agreement' then raise exception 'Use the contract or your own wording, not both' using errcode='22023'; end if;
    begin agreement_template:=(input->>'templateId')::uuid; exception when others then agreement_template:=null; end;
    if agreement_template is null or agreement_template is distinct from (select s.agreement_template_id from private.workspace_onboarding_settings s where s.singleton) then
     raise exception 'The contract has changed since you opened this. Open the agreement again.' using errcode='40001'; end if;
    update private.workspace_journeys set agreement=private.workspace_agreement_fill(target,agreement_template),agreement_template_id=agreement_template,agreement_format='outline',agreement_revision=agreement_revision+1 where property_id=target;
   else
    update private.workspace_journeys set agreement=private.workspace_required_text(input,'agreement',20,10000),agreement_template_id=null,agreement_format='text',agreement_revision=agreement_revision+1 where property_id=target;
   end if;$q$,
   $q$agreement_format='outline'$q$],
  ['private.workspace_journey_view(private.workspace_journeys)',
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,$q$,
   $q$'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,
 'agreementFormat',j.agreement_format,'agreementTemplate',(select jsonb_build_object('id',t.id,'version',t.version,'kind',t.kind,'fileName',t.file_name,'bytes',t.file_bytes,'sha256',t.file_sha256)
   from private.workspace_agreement_templates t where t.id=j.agreement_template_id),
 'agreementDraft',(select jsonb_build_object('templateId',t.id,'version',t.version,'kind',t.kind,'fileName',t.file_name,'text',private.workspace_agreement_fill(j.property_id,t.id),'missing',to_jsonb(private.workspace_agreement_missing(j.property_id,t.id)))
   from private.workspace_onboarding_settings s join private.workspace_agreement_templates t on t.id=s.agreement_template_id
   where s.singleton and j.stage='agreement' and j.signed_at is null and coalesce(private.workspace_actor_role(),'') in ('stays','admin','super_admin')),$q$,
   $q$'agreementDraft'$q$]
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

create or replace function public.workspace_onboarding_settings_read() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_onboarding_settings_read();$$;
create or replace function public.workspace_onboarding_settings_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_onboarding_settings_action(input);$$;
create or replace function public.workspace_agreement_file(template uuid,target uuid) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_agreement_file(template,target);$$;
revoke all on function private.workspace_agreement_placeholders(),private.workspace_agreement_key(text),private.workspace_agreement_tokens(text),
 private.workspace_agreement_values(uuid),private.workspace_agreement_fill(uuid,uuid),private.workspace_agreement_missing(uuid,uuid),
 private.workspace_agreement_template_json(private.workspace_agreement_templates) from public,anon,authenticated;
revoke all on function private.workspace_onboarding_settings_read(),private.workspace_onboarding_settings_action(jsonb),private.workspace_agreement_file(uuid,uuid),
 public.workspace_onboarding_settings_read(),public.workspace_onboarding_settings_action(jsonb),public.workspace_agreement_file(uuid,uuid) from public,anon;
grant execute on function private.workspace_onboarding_settings_read(),private.workspace_onboarding_settings_action(jsonb),private.workspace_agreement_file(uuid,uuid),
 public.workspace_onboarding_settings_read(),public.workspace_onboarding_settings_action(jsonb),public.workspace_agreement_file(uuid,uuid) to authenticated;
