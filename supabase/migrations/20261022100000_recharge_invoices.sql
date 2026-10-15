-- Recharge's own invoices as a branded document, and the invoice maker (owner Lee, 15 October 2026: "go ahead everything").
-- The document itself is drawn by the app (lib/recharge-invoice.ts); this migration gives it the data it needs and adds
-- the maker. Nothing existing changes shape: no existing function is patched, nothing is dropped or deleted.
--
-- Part 1. Bills Recharge already issues, as a document.
--   public.workspace_invoices rows that are bills to an owner: the onboarding invoice ('onboarding-invoices'), the
--   direct-booking invoice ('owner-statements') and the repair invoice ('maintenance-reconciliation'). The rows for
--   'cleans-invoices' (addressed to the cleaner for their own clean) and 'purchase-order-*' (a supplier's invoice to us)
--   are not bills from Recharge and get no document. Read through public.workspace_documents_read:
--     'invoice'  one invoice with the owner's name, the property and the work or stay behind it. Who may read it is
--                exactly who may read the row today (policies invoices_scoped and invoices_direct_booking): an owner
--                only their own, staff by the invoice's tool on the property, a cleaner only one addressed to them.
--     'mine'     the caller's own: those invoices addressed to them, and issued maker documents addressed to them.
--   The hub's invoices (Receivable) already carry everything the document needs in the 'receivable' finance report.
--
-- Part 2. The invoice maker. Accounts, admins and super admins (private.workspace_finance_role(), the same people who
--   issue the invoices above through the issueInvoice form) make a document from scratch:
--     kind 'invoice' (Recharge bills someone) or 'request' (a Request for Invoice: Recharge asks someone to invoice us);
--     a recipient picked from the app's people (owners and team) or typed (name, email, address);
--     lines (description, quantity, rate; the amount is worked out here), GBP or USD, issue and due dates, an optional
--     period and note, and the terms text.
--   Drafts are saved and edited; Issue locks the document and numbers it RC-INV-YYYY-NNNN or RC-RFI-YYYY-NNNN from a
--   counter per prefix and year that only goes up (private.workspace_document_numbers). An issued document is marked
--   paid with the paid-on date or voided with a reason; a draft can be voided too. Nothing is ever deleted: a draft's
--   lines are kept per revision, and every change is in private.workspace_document_history with who and when.
--   Every change is checked against the document's version.
--   Sending (private.workspace_document_sends, each with who sent it, when and to whom):
--     in_app    to someone with an account: a notice through the existing notice system (private.workspace_clean_notify,
--               no property, so never on an owner's property feed); a cleaner's notices are phone only (20261021900000);
--     email     from ownerrelations@ by the server (lib/invoice-maker-server.ts), never to a cleaner (refused here,
--               also when a typed address is a cleaner's sign-in email); the server records the outcome through
--               public.workspace_document_send_result (service role only);
--     download  the document was downloaded to be shared by hand.
--   The recipient reads an issued document addressed to them ('mine', 'document'); drafts never leave Accounts.
--
-- Tables have RLS on and no grants: everything goes through the private security-definer functions below and their
-- public security-invoker wrappers. Safe to run twice.

-- Tables -------------------------------------------------------------------------------------------------------------
create table if not exists private.workspace_documents (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('invoice','request')),
 status text not null default 'draft' check(status in ('draft','issued','paid','void')),
 number text check(number ~ '^RC-(INV|RFI)-\d{4}-\d{4,}$'),
 recipient_id uuid references public.workspace_profiles(user_id),
 recipient_name text not null check(length(btrim(recipient_name)) between 2 and 200),
 recipient_email text check(recipient_email is null or (length(recipient_email)<=320 and recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
 recipient_address text not null default '' check(length(recipient_address)<=500),
 currency text not null default 'GBP' check(currency in ('GBP','USD')),
 issue_on date not null,
 due_on date not null,
 period_start date,
 period_end date,
 note text not null default '' check(length(note)<=2000),
 terms text not null default '' check(length(terms)<=2000),
 total_minor bigint not null default 0 check(total_minor between 0 and 100000000000),
 line_revision integer not null default 1 check(line_revision>0),
 paid_on date,
 void_reason text check(void_reason is null or length(void_reason)<=1000),
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.workspace_profiles(user_id),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 issued_by uuid references public.workspace_profiles(user_id),
 issued_at timestamptz,
 paid_by uuid references public.workspace_profiles(user_id),
 paid_at timestamptz,
 voided_by uuid references public.workspace_profiles(user_id),
 voided_at timestamptz,
 unique(created_by,request_id),
 constraint workspace_documents_due check(due_on>=issue_on),
 constraint workspace_documents_period check((period_start is null)=(period_end is null) and (period_end is null or period_end>=period_start)),
 constraint workspace_documents_numbered check((status='draft' and number is null) or status='void' or (status in ('issued','paid') and number is not null)),
 constraint workspace_documents_paid check((status='paid')=(paid_on is not null))
);
create unique index if not exists workspace_documents_number_idx on private.workspace_documents(number) where number is not null;
create index if not exists workspace_documents_recipient_idx on private.workspace_documents(recipient_id,issue_on desc) where recipient_id is not null;
create index if not exists workspace_documents_status_idx on private.workspace_documents(status,updated_at desc);
alter table private.workspace_documents enable row level security;
revoke all on private.workspace_documents from public,anon,authenticated;

-- A draft's lines are replaced by saving a new revision; earlier revisions stay.
create table if not exists private.workspace_document_lines (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references private.workspace_documents(id),
 revision integer not null check(revision>0),
 position integer not null check(position between 1 and 100),
 description text not null check(length(btrim(description)) between 1 and 500),
 quantity numeric(10,2) not null check(quantity>0 and quantity<=100000),
 rate_minor bigint not null check(rate_minor between 0 and 100000000),
 amount_minor bigint not null check(amount_minor>=0),
 unique(document_id,revision,position)
);
alter table private.workspace_document_lines enable row level security;
revoke all on private.workspace_document_lines from public,anon,authenticated;

-- TODO(lead, at merge): RC-RFI numbers are shared with the cleaner requests in 20261022000000. Until the numbering is
-- unified, the maker keeps its own counter per prefix and year here.
create table if not exists private.workspace_document_numbers (
 prefix text not null check(prefix in ('RC-INV','RC-RFI')),
 year integer not null check(year between 2000 and 2999),
 last_number integer not null default 0 check(last_number>=0),
 primary key(prefix,year)
);
alter table private.workspace_document_numbers enable row level security;
revoke all on private.workspace_document_numbers from public,anon,authenticated;

create table if not exists private.workspace_document_history (
 id bigint generated always as identity primary key,
 document_id uuid not null references private.workspace_documents(id),
 actor_id uuid references public.workspace_profiles(user_id),
 action text not null check(action in ('created','saved','issued','paid','voided','sent_in_app','emailed','email_failed','email_started','downloaded')),
 from_status text,
 to_status text,
 version integer not null,
 detail jsonb not null default '{}'::jsonb,
 at timestamptz not null default now()
);
create index if not exists workspace_document_history_document_idx on private.workspace_document_history(document_id,id);
alter table private.workspace_document_history enable row level security;
revoke all on private.workspace_document_history from public,anon,authenticated;

create table if not exists private.workspace_document_sends (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references private.workspace_documents(id),
 request_id uuid not null,
 channel text not null check(channel in ('in_app','email','download')),
 to_user uuid references public.workspace_profiles(user_id),
 to_name text not null,
 to_email text,
 status text not null check(status in ('pending','sent','failed')),
 message_id text,
 error text check(error is null or length(error)<=300),
 sent_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(sent_by,request_id)
);
create index if not exists workspace_document_sends_document_idx on private.workspace_document_sends(document_id,created_at);
alter table private.workspace_document_sends enable row level security;
revoke all on private.workspace_document_sends from public,anon,authenticated;

-- Part 1: Recharge's bills in public.workspace_invoices -------------------------------------------------------------
create or replace function private.workspace_owner_bill_module(module text) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(module in ('onboarding-invoices','owner-statements','maintenance-reconciliation'),false)
$fn$;
-- The same rule as the row's select policies (invoices_scoped, invoices_direct_booking), for the caller.
create or replace function private.workspace_invoice_visible(i public.workspace_invoices) returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(
  (private.workspace_actor_role()='client' and i.recipient_id=auth.uid() and private.workspace_can_property(i.property_id,'client-dashboard'))
  or (private.workspace_actor_role()<>'client' and private.workspace_can_property(i.property_id,i.module_id) and (private.workspace_actor_role()<>'cleans' or i.recipient_id=auth.uid()))
  or private.workspace_direct_booking_invoice_visible(i.work_id,i.property_id),false)
$fn$;
create or replace function private.workspace_invoice_document(i public.workspace_invoices) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('source','workspace','id',i.id,'module',i.module_id,'reference',i.reference,'status',i.status,'issueOn',i.issued_on,
  'paidOn',case when i.status='paid' and i.paid_at is not null then (i.paid_at at time zone 'Europe/London')::date end,
  'amountMinor',i.amount_minor,'currency',i.currency,'version',i.version,
  'recipientName',coalesce((select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=i.recipient_id),'Owner'),
  'propertyName',(select pr.name from public.workspace_properties pr where pr.id=i.property_id),
  'propertyAddress',(select pr.address from public.workspace_properties pr where pr.id=i.property_id),
  'workTitle',(select w.title from public.workspace_work_items w where w.id=i.work_id),
  'stay',(select jsonb_build_object('reference',r.reference,'checkIn',r.check_in,'checkOut',r.check_out)
   from private.workspace_domain_details d join private.workspace_reservations r on r.id::text=d.data->>'reservationId'
   where d.work_id=i.work_id and d.kind='direct_booking' limit 1))
$fn$;

-- Part 2: the maker ------------------------------------------------------------------------------------------------
create or replace function private.workspace_document_money(minor bigint,currency text) returns text language sql immutable set search_path='' as $fn$
 select case when currency='USD' then '$' else '£' end||to_char(coalesce(minor,0)/100.0,'FM999,999,999,990.00')
$fn$;
create or replace function private.workspace_document_label(d private.workspace_documents) returns text language sql immutable set search_path='' as $fn$
 select case when d.kind='request' then 'Request for invoice' else 'Invoice' end||coalesce(' '||d.number,'')
$fn$;

-- One document as the screens and the template show it. `full` adds the lines; `staff` adds the email, the history and
-- the sends (Accounts only).
create or replace function private.workspace_document_json(d private.workspace_documents,full_view boolean,staff boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('source','maker','id',d.id,'kind',d.kind,'status',d.status,'number',d.number,
  'recipient',jsonb_build_object('userId',d.recipient_id,'name',d.recipient_name,'address',d.recipient_address,
   'email',case when staff then d.recipient_email end,
   'role',(select p.role from public.workspace_profiles p where p.user_id=d.recipient_id),
   'hasEmail',case when staff then d.recipient_email is not null or exists(select 1 from auth.users u where u.id=d.recipient_id and coalesce(u.email,'')<>'') end),
  'currency',d.currency,'issueOn',d.issue_on,'dueOn',d.due_on,'periodStart',d.period_start,'periodEnd',d.period_end,'note',d.note,'terms',d.terms,
  'totalMinor',d.total_minor,'paidOn',d.paid_on,'voidReason',d.void_reason,'version',d.version,'createdAt',d.created_at,'updatedAt',d.updated_at,'issuedAt',d.issued_at,
  'lineCount',(select count(*) from private.workspace_document_lines l where l.document_id=d.id and l.revision=d.line_revision),
  'lastSentAt',(select max(coalesce(s.finished_at,s.created_at)) from private.workspace_document_sends s where s.document_id=d.id and s.status='sent'))
 ||case when full_view then jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('position',l.position,'description',l.description,
   'quantity',l.quantity,'rateMinor',l.rate_minor,'amountMinor',l.amount_minor) order by l.position)
   from private.workspace_document_lines l where l.document_id=d.id and l.revision=d.line_revision),'[]'::jsonb)) else '{}'::jsonb end
 ||case when full_view and staff then jsonb_build_object(
   'history',coalesce((select jsonb_agg(jsonb_build_object('action',h.action,'fromStatus',h.from_status,'toStatus',h.to_status,'version',h.version,'at',h.at,'detail',h.detail,
     'by',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=h.actor_id)) order by h.id)
    from private.workspace_document_history h where h.document_id=d.id),'[]'::jsonb),
   'sends',coalesce((select jsonb_agg(jsonb_build_object('channel',s.channel,'toName',s.to_name,'toEmail',s.to_email,'status',s.status,'at',coalesce(s.finished_at,s.created_at),
     'by',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=s.sent_by)) order by s.created_at)
    from private.workspace_document_sends s where s.document_id=d.id),'[]'::jsonb)) else '{}'::jsonb end
$fn$;

create or replace function private.workspace_documents_read(section text,target_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();staff boolean:=private.workspace_finance_role();d private.workspace_documents;i public.workspace_invoices;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='documents' then
  if not staff then raise exception 'Only Accounts and management make documents' using errcode='42501';end if;
  return coalesce((select jsonb_agg(private.workspace_document_json(x,false,true) order by x.updated_at desc,x.id)
   from (select * from private.workspace_documents order by updated_at desc,id limit 500) x),'[]'::jsonb);
 elsif section='document' then
  select * into d from private.workspace_documents where id=target_id;
  if d.id is null or not (staff or (d.status<>'draft' and d.recipient_id=auth.uid())) then raise exception 'Document not found' using errcode='P0002';end if;
  return private.workspace_document_json(d,true,staff);
 elsif section='invoice' then
  select * into i from public.workspace_invoices where id=target_id;
  if i.id is null or not private.workspace_owner_bill_module(i.module_id) or not private.workspace_invoice_visible(i) then raise exception 'Invoice not found' using errcode='P0002';end if;
  return private.workspace_invoice_document(i);
 elsif section='mine' then
  return jsonb_build_object(
   'documents',coalesce((select jsonb_agg(private.workspace_document_json(x,false,false) order by x.issue_on desc,x.id)
    from (select * from private.workspace_documents where recipient_id=auth.uid() and status<>'draft' order by issue_on desc,id limit 200) x),'[]'::jsonb),
   'invoices',coalesce((select jsonb_agg(private.workspace_invoice_document(x) order by x.issued_on desc,x.id)
    from (select * from public.workspace_invoices v where v.recipient_id=auth.uid() and private.workspace_owner_bill_module(v.module_id) and v.status<>'void'
     and private.workspace_invoice_visible(v) order by v.issued_on desc,v.id limit 200) x),'[]'::jsonb));
 elsif section='recipients' then
  if not staff then raise exception 'Only Accounts and management make documents' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'name',coalesce(nullif(btrim(p.full_name),''),'Unnamed'),'role',p.role,
    'canEmail',p.role<>'cleans' and coalesce(u.email,'')<>'') order by p.full_name,p.user_id)
   from public.workspace_profiles p left join auth.users u on u.id=p.user_id where p.status='active'),'[]'::jsonb);
 end if;
 raise exception 'Unknown documents section' using errcode='22023';
end $fn$;

-- A date from the input, or null when the key is absent or null.
create or replace function private.workspace_document_day(input jsonb,k text,label text) returns date language plpgsql immutable set search_path='' as $fn$
declare v date;
begin
 if input->k is null or jsonb_typeof(input->k)='null' then return null;end if;
 if jsonb_typeof(input->k)<>'string' or input->>k!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the % as year-month-day',label using errcode='22023';end if;
 begin v:=(input->>k)::date; exception when others then raise exception 'Enter the % as year-month-day',label using errcode='22023'; end;
 if to_char(v,'YYYY-MM-DD')<>input->>k then raise exception 'Enter the % as year-month-day',label using errcode='22023';end if;
 return v;
end $fn$;

-- The cleaner rule: a cleaner has the app on their phone and is never emailed, also not at an address typed by hand.
create or replace function private.workspace_document_cleaner_address(address text) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from auth.users u join public.workspace_profiles p on p.user_id=u.id where p.role='cleans' and lower(btrim(u.email))=lower(btrim(address)))
$fn$;

create or replace function private.workspace_documents_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;d private.workspace_documents;
 today date:=(now() at time zone 'Europe/London')::date;
 k text;who uuid;who_name text;email text;address text;cur text;issue date;due date;p_start date;p_end date;note_text text;terms_text text;
 line jsonb;n integer;qty numeric;rate bigint;amount bigint;total bigint;rev integer;descr text;paid date;reason text;num integer;yr integer;pfx text;
 channel text;send private.workspace_document_sends;to_email text;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=coalesce(input->>'action','');
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if not private.workspace_finance_role() then raise exception 'Only Accounts and management make documents' using errcode='42501';end if;
 if a='saveDocumentDraft' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','kind','recipientId','recipientName','recipientEmail','recipientAddress','currency',
   'issueOn','dueOn','periodStart','periodEnd','note','terms','lines'],120000);
 elsif a='issueDocument' then perform private.workspace_json_keys(input,array['action','requestId','id','version'],2000);
 elsif a='markDocumentPaid' then perform private.workspace_json_keys(input,array['action','requestId','id','version','paidOn'],2000);
 elsif a='voidDocument' then perform private.workspace_json_keys(input,array['action','requestId','id','version','reason'],4000);
 elsif a='sendDocument' then perform private.workspace_json_keys(input,array['action','requestId','id','channel'],2000);
 else raise exception 'Unknown documents action' using errcode='22023';end if;
 if input ? 'id' and coalesce(input->>'id','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Document not found' using errcode='P0002';end if;
 if a<>'saveDocumentDraft' and not (input ? 'id') then raise exception 'Document not found' using errcode='P0002';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));

 -- Sending: the same request is the same send. A pending email may be tried again (the server's idempotency key makes it
 -- the same email); one that went out, or failed, is not sent again under the same request.
 if a='sendDocument' then
  select * into send from private.workspace_document_sends s where s.sent_by=auth.uid() and s.request_id=req;
  if send.id is not null then
   select * into d from private.workspace_documents where id=send.document_id;
   if send.channel='email' and send.status='pending' then
    return jsonb_build_object('send',true,'requestId',req,'email',jsonb_build_object('to',send.to_email,'name',send.to_name),'document',private.workspace_document_json(d,true,true));
   end if;
   return jsonb_build_object('send',false,'status',send.status,'document',private.workspace_document_json(d,true,true));
  end if;
 else
  select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
  if found then
   if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
   if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
   return prior.result;
  end if;
 end if;

 if input ? 'id' then
  select * into d from private.workspace_documents where id=(input->>'id')::uuid for update;
  if d.id is null then raise exception 'Document not found' using errcode='P0002';end if;
  if a<>'sendDocument' and (jsonb_typeof(input->'version') is distinct from 'number' or d.version is distinct from (input->>'version')::integer) then
   raise exception 'The document was changed by someone else. Refresh and try again' using errcode='40001';
  end if;
 end if;

 if a='saveDocumentDraft' then
  if d.id is not null and d.status<>'draft' then raise exception 'Only a draft can be edited. An issued document is locked' using errcode='42501';end if;
  k:=coalesce(input->>'kind','');
  if k not in ('invoice','request') then raise exception 'Choose Invoice or Request for invoice' using errcode='22023';end if;
  -- The recipient: someone in the app, or a name typed by hand (with an email and an address when known).
  address:=btrim(coalesce(input->>'recipientAddress',''));
  if length(address)>500 then raise exception 'The address is too long' using errcode='22023';end if;
  if jsonb_typeof(input->'recipientId')='string' then
   if input->>'recipientId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Choose who it is for' using errcode='22023';end if;
   who:=(input->>'recipientId')::uuid;
   select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(input->>'recipientName'),'')) into who_name from public.workspace_profiles p where p.user_id=who and p.status='active';
   if not found then raise exception 'Choose someone with an active account' using errcode='22023';end if;
   if who_name is null or length(who_name)<2 then raise exception 'Type the name to show on the document' using errcode='22023';end if;
   email:=null;
  else
   who:=null;who_name:=btrim(coalesce(input->>'recipientName',''));
   if length(who_name)<2 or length(who_name)>200 then raise exception 'Type who it is for' using errcode='22023';end if;
   email:=nullif(btrim(coalesce(input->>'recipientEmail','')),'');
   if email is not null and (length(email)>320 or email!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Check the email address' using errcode='22023';end if;
  end if;
  cur:=coalesce(input->>'currency','GBP');
  if cur not in ('GBP','USD') then raise exception 'Choose pounds or dollars' using errcode='22023';end if;
  issue:=coalesce(private.workspace_document_day(input,'issueOn','issue date'),today);
  due:=coalesce(private.workspace_document_day(input,'dueOn','due date'),issue+7);
  if due<issue then raise exception 'The due date cannot be before the issue date' using errcode='22023';end if;
  p_start:=private.workspace_document_day(input,'periodStart','period start');p_end:=private.workspace_document_day(input,'periodEnd','period end');
  if (p_start is null)<>(p_end is null) or p_end<p_start then raise exception 'Give the period a start and an end, in order' using errcode='22023';end if;
  note_text:=btrim(coalesce(input->>'note',''));terms_text:=btrim(coalesce(input->>'terms',''));
  if length(note_text)>2000 or length(terms_text)>2000 then raise exception 'The note and the terms can be up to 2,000 characters' using errcode='22023';end if;
  if input->'lines' is not null and jsonb_typeof(input->'lines')<>'array' then raise exception 'Check the lines' using errcode='22023';end if;
  if jsonb_array_length(coalesce(input->'lines','[]'::jsonb))>100 then raise exception 'A document can have up to 100 lines' using errcode='22023';end if;
  if d.id is null then
   insert into private.workspace_documents(kind,recipient_id,recipient_name,recipient_email,recipient_address,currency,issue_on,due_on,period_start,period_end,note,terms,created_by,request_id,updated_by)
    values(k,who,left(who_name,200),email,address,cur,issue,due,p_start,p_end,note_text,terms_text,auth.uid(),req,auth.uid()) returning * into d;
   rev:=1;
  else
   rev:=d.line_revision+1;
   update private.workspace_documents set kind=k,recipient_id=who,recipient_name=left(who_name,200),recipient_email=email,recipient_address=address,currency=cur,issue_on=issue,due_on=due,
    period_start=p_start,period_end=p_end,note=note_text,terms=terms_text,line_revision=rev,version=version+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
  end if;
  total:=0;n:=0;
  for line in select value from jsonb_array_elements(coalesce(input->'lines','[]'::jsonb)) loop
   n:=n+1;
   if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) x where x not in ('description','quantity','rateMinor')) then raise exception 'Check line %',n using errcode='22023';end if;
   descr:=btrim(coalesce(line->>'description',''));
   if length(descr)<1 or length(descr)>500 then raise exception 'Describe line %',n using errcode='22023';end if;
   if coalesce(line->>'quantity','')!~'^\d{1,6}(\.\d{1,2})?$' then raise exception 'Check the quantity on line %',n using errcode='22023';end if;
   qty:=(line->>'quantity')::numeric;
   if qty<=0 or qty>100000 then raise exception 'Check the quantity on line %',n using errcode='22023';end if;
   if jsonb_typeof(line->'rateMinor') is distinct from 'number' or line->>'rateMinor'!~'^\d{1,9}$' or (line->>'rateMinor')::bigint>100000000 then raise exception 'Check the rate on line %',n using errcode='22023';end if;
   rate:=(line->>'rateMinor')::bigint;
   -- Quantity times rate, rounded to the penny (halves away from zero), the same as lib/invoice-maker.ts lineAmountMinor.
   amount:=round(qty*rate)::bigint;
   total:=total+amount;
   insert into private.workspace_document_lines(document_id,revision,position,description,quantity,rate_minor,amount_minor) values(d.id,rev,n,descr,qty,rate,amount);
  end loop;
  if total>100000000000 then raise exception 'The total is too large' using errcode='22023';end if;
  update private.workspace_documents set total_minor=total where id=d.id returning * into d;
  insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail)
   values(d.id,auth.uid(),case when rev=1 then 'created' else 'saved' end,null,'draft',d.version,jsonb_build_object('totalMinor',total,'lines',n));
 elsif a='issueDocument' then
  if d.status<>'draft' then raise exception 'Only a draft can be issued' using errcode='42501';end if;
  if not exists(select 1 from private.workspace_document_lines l where l.document_id=d.id and l.revision=d.line_revision) or d.total_minor<=0 then
   raise exception 'Add at least one line with an amount before issuing' using errcode='22023';
  end if;
  pfx:=case when d.kind='request' then 'RC-RFI' else 'RC-INV' end;yr:=extract(year from today)::integer;
  insert into private.workspace_document_numbers(prefix,year,last_number) values(pfx,yr,1)
   on conflict(prefix,year) do update set last_number=private.workspace_document_numbers.last_number+1 returning last_number into num;
  update private.workspace_documents set status='issued',number=pfx||'-'||yr||'-'||case when num<10000 then lpad(num::text,4,'0') else num::text end,
   issued_by=auth.uid(),issued_at=now(),version=version+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
  insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'issued','draft','issued',d.version,jsonb_build_object('number',d.number));
 elsif a='markDocumentPaid' then
  if d.status<>'issued' then raise exception 'Only an issued document can be marked paid' using errcode='42501';end if;
  paid:=private.workspace_document_day(input,'paidOn','paid date');
  if paid is null or paid>today or paid<d.issue_on then raise exception 'The paid date must be between the issue date and today' using errcode='22023';end if;
  update private.workspace_documents set status='paid',paid_on=paid,paid_by=auth.uid(),paid_at=now(),version=version+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
  insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'paid','issued','paid',d.version,jsonb_build_object('paidOn',paid));
 elsif a='voidDocument' then
  if d.status not in ('draft','issued') then raise exception 'Only a draft or an issued document can be voided' using errcode='42501';end if;
  reason:=btrim(coalesce(input->>'reason',''));
  if jsonb_typeof(input->'reason') is distinct from 'string' or length(reason)<5 or length(reason)>1000 then raise exception 'Say why it is void (at least 5 characters)' using errcode='22023';end if;
  insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'voided',d.status,'void',d.version+1,jsonb_build_object('reason',reason));
  update private.workspace_documents set status='void',void_reason=reason,voided_by=auth.uid(),voided_at=now(),version=version+1,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
 elsif a='sendDocument' then
  channel:=coalesce(input->>'channel','');
  if channel not in ('in_app','email','download') then raise exception 'Choose how to send it' using errcode='22023';end if;
  if d.status not in ('issued','paid') then raise exception 'Issue the document before sending it' using errcode='42501';end if;
  if channel='in_app' then
   if d.recipient_id is null or not exists(select 1 from public.workspace_profiles p where p.user_id=d.recipient_id and p.status='active') then raise exception 'Only someone with an account can get it in the app' using errcode='22023';end if;
   insert into private.workspace_document_sends(document_id,request_id,channel,to_user,to_name,status,sent_by,finished_at) values(d.id,req,'in_app',d.recipient_id,d.recipient_name,'sent',auth.uid(),now()) returning * into send;
   perform private.workspace_clean_notify(d.recipient_id,null,null,'finance.document_sent',
    private.workspace_document_label(d)||' from Recharge Group: '||private.workspace_document_money(d.total_minor,d.currency),false);
   insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'sent_in_app',d.status,d.status,d.version,jsonb_build_object('to',d.recipient_name));
   result:=jsonb_build_object('send',false,'status','sent','document',private.workspace_document_json(d,true,true));
  elsif channel='download' then
   insert into private.workspace_document_sends(document_id,request_id,channel,to_user,to_name,status,sent_by,finished_at) values(d.id,req,'download',d.recipient_id,d.recipient_name,'sent',auth.uid(),now()) returning * into send;
   insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'downloaded',d.status,d.status,d.version,jsonb_build_object('to',d.recipient_name));
   result:=jsonb_build_object('send',false,'status','sent','document',private.workspace_document_json(d,true,true));
  else
   -- Never a cleaner: by their account, or by their sign-in email typed by hand.
   if d.recipient_id is not null and exists(select 1 from public.workspace_profiles p where p.user_id=d.recipient_id and p.role='cleans') then
    raise exception 'Cleaners are never emailed. Send it in the app instead' using errcode='42501';
   end if;
   to_email:=coalesce(d.recipient_email,(select nullif(btrim(u.email),'') from auth.users u where u.id=d.recipient_id));
   if to_email is null then raise exception 'There is no email address for this recipient. Download it and share it instead' using errcode='22023';end if;
   if private.workspace_document_cleaner_address(to_email) then raise exception 'Cleaners are never emailed. Send it in the app instead' using errcode='42501';end if;
   insert into private.workspace_document_sends(document_id,request_id,channel,to_user,to_name,to_email,status,sent_by) values(d.id,req,'email',d.recipient_id,d.recipient_name,to_email,'pending',auth.uid()) returning * into send;
   insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail) values(d.id,auth.uid(),'email_started',d.status,d.status,d.version,jsonb_build_object('to',to_email));
   result:=jsonb_build_object('send',true,'requestId',req,'email',jsonb_build_object('to',to_email,'name',d.recipient_name),'document',private.workspace_document_json(d,true,true));
  end if;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.document_'||channel);
  return result;
 end if;
 -- No property: a document is between Recharge and one person, never on an owner's feed.
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.document_'||case a when 'saveDocumentDraft' then 'saved' when 'issueDocument' then 'issued' when 'markDocumentPaid' then 'paid' else 'voided' end);
 result:=private.workspace_document_json(d,true,true);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- What happened to an email: called by the server (service role) once Resend answered.
create or replace function private.workspace_document_send_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare send private.workspace_document_sends;d private.workspace_documents;ok boolean;
begin
 perform private.workspace_json_keys(input,array['requestId','sentBy','ok','messageId','error'],4000);
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  or coalesce(input->>'sentBy','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or jsonb_typeof(input->'ok') is distinct from 'boolean' then
  raise exception 'Invalid send result' using errcode='22023';
 end if;
 ok:=(input->>'ok')::boolean;
 select * into send from private.workspace_document_sends s where s.sent_by=(input->>'sentBy')::uuid and s.request_id=(input->>'requestId')::uuid and s.channel='email' for update;
 if send.id is null then raise exception 'Send not found' using errcode='P0002';end if;
 if send.status<>'pending' then return jsonb_build_object('recorded',false,'status',send.status);end if;
 update private.workspace_document_sends set status=case when ok then 'sent' else 'failed' end,message_id=left(input->>'messageId',300),
  error=case when ok then null else left(coalesce(input->>'error','Not sent'),300) end,finished_at=now() where id=send.id returning * into send;
 select * into d from private.workspace_documents where id=send.document_id;
 insert into private.workspace_document_history(document_id,actor_id,action,from_status,to_status,version,detail)
  values(d.id,send.sent_by,case when ok then 'emailed' else 'email_failed' end,d.status,d.status,d.version,jsonb_build_object('to',send.to_email)||case when ok then '{}'::jsonb else jsonb_build_object('error',send.error) end);
 return jsonb_build_object('recorded',true,'status',send.status);
end $fn$;

create or replace function public.workspace_documents_read(section text,target_id uuid default null) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_documents_read(section,target_id) $fn$;
create or replace function public.workspace_documents_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_documents_action(input) $fn$;
create or replace function public.workspace_document_send_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_document_send_result(input) $fn$;

-- Who may call what. The reads and actions are for signed-in people (checked inside); the send result for the backend.
revoke all on function private.workspace_owner_bill_module(text),private.workspace_invoice_visible(public.workspace_invoices),private.workspace_invoice_document(public.workspace_invoices),
 private.workspace_document_money(bigint,text),private.workspace_document_label(private.workspace_documents),private.workspace_document_json(private.workspace_documents,boolean,boolean),
 private.workspace_documents_read(text,uuid),public.workspace_documents_read(text,uuid),private.workspace_document_day(jsonb,text,text),private.workspace_document_cleaner_address(text),
 private.workspace_documents_action(jsonb),public.workspace_documents_action(jsonb),private.workspace_document_send_result(jsonb),public.workspace_document_send_result(jsonb)
 from public,anon,authenticated;
-- The public wrappers run as the caller, so the caller may execute the private function they call.
grant execute on function private.workspace_documents_read(text,uuid),public.workspace_documents_read(text,uuid),
 private.workspace_documents_action(jsonb),public.workspace_documents_action(jsonb) to authenticated;
grant execute on function private.workspace_document_send_result(jsonb),public.workspace_document_send_result(jsonb) to service_role;
