-- Clean outcomes from the app's own flags (owner Lee said yes on 15 October 2026; the rules are the lead's defaults).
-- Builds on requests for invoice (20261022000000): each clean on a request has an outcome, Completed, Partially successful
-- or Unsuccessful, set by management or the cleaner's cleaning manager while the request waits for approval. Now the
-- request also sets them itself, from flags the app already keeps on each clean:
--
-- 1. No clean form: the clean-form sweep (20261014100000) tagged the clean (data.warning = 'no_form' or
--    data.formWarningAt) and its form is still not in (private.workspace_clean_form_in, the same rule the approval gate
--    uses). Unsuccessful. When the form arrives late the flag clears and the clean goes back to Completed.
-- 2. Rejected and not redone: the cleaner's clean has a rejection that stands (private.workspace_cleaning_reviews, not
--    accepted, not overturned; 20261009180000) with nothing accepted after it. Unsuccessful.
-- 3. Rejected, then redo accepted: a rejection that stands, then a later review accepted it (or a later rejection was
--    overturned, which accepts the clean as sent). Partially successful.
-- 4. A dispute decided in the cleaner's favour: the dispute flow records it on the rejection itself (overturned_at,
--    overturned_by, overturn_note). When every rejection of the clean by this cleaner was overturned it is Completed.
-- Rule 1 comes first, then 2 to 4. The rules only look at the cleaner the request is for.
--
-- Cleans not done properly are on the request too (the lead, 15 October 2026: they appear as Unsuccessful at £0, they do
-- not silently drop off). When the run makes a cleaner's request for a period it also takes that cleaner's cleans dated
-- before the period's end that are not accepted and have settled (private.workspace_clean_failed_open):
--   (a) the sweep tagged it no-form and the form is still not in, or
--   (b) a rejection stands with nothing accepted after it, the clean was not sent again and its redo time (data.redoBy)
--       has passed.
-- Each is a line at the cleaner's rate at the time of the run, then Unsuccessful ('auto', reason no_form or rejected),
-- earning £0. A clean waiting for review, or in a redo still underway, stays off: it is picked up by a later request once
-- accepted (as before) or once it settles. A clean dated in a period already requested that settles later goes on the
-- cleaner's next request. A clean is never on two requests (the one-live-line-per-clean index, and both lists leave out
-- a clean already on a live line). A request whose lines are all Unsuccessful is still made, at £0. Only cleans dated
-- on or after the day this migration was installed (private.workspace_clean_outcome_settings), like earnings, which
-- start with 20261022000000: nothing older is asked about. Approving: the clean-form gate no longer counts a line that
-- is Unsuccessful (it is not paid), so a request with a no-form clean at £0 can still be approved; a no-form clean set
-- to anything else still blocks it.
--
-- Late redo or dispute (the lead, 15 October 2026): a cleaner must not lose pay because their redo was accepted, or their
-- dispute won, after the request was approved. A clean on an approved (or paid) request as Unsuccessful at £0, set by
-- the request itself ('auto'), whose redo is then accepted or whose dispute is then won, goes on the cleaner's NEXT
-- request as a follow-up line (private.workspace_clean_late_open, private.workspace_clean_late_attach): Partially
-- successful for a redo (late_redo_accepted), Completed for a dispute (late_dispute_won), at the earlier line's rate,
-- source 'auto', pointing at the earlier line (follows_line_id). It goes on the request for the period in which the
-- redo was accepted or the dispute decided (its latest review), or the next one made after that. The earlier line stays
-- on the approved request as it was (still shown, still £0) but is no longer the clean's live line, so the existing
-- one-live-line-per-clean index allows exactly this one follow-up. A guard trigger
-- (private.workspace_clean_follow_up_guard) and a unique index make sure a clean is never paid twice: a follow-up only
-- for an earlier line of the same clean that is not live, Unsuccessful, £0 and 'auto', at most one follow-up per clean,
-- and the earlier line can never be made live again or earn anything. An Unsuccessful a person set ('manual') means a
-- person decided: no follow-up. The app says "Auto: redo accepted after RC-RFI-... was approved"; the printed document
-- adds "Late redo, see RC-RFI-..." (or "Late dispute, see ...") to the outcome note.
--
-- How they apply:
-- * Only on a request the run made (generated) while it waits for approval (to_approve, not paid). Nothing changes
--   once it is approved, paid or rejected, and never on an invoice Accounts recorded by hand.
-- * Never over a person's choice. Each line records who set its outcome (outcome_source: 'auto' or 'manual', null when
--   nobody has) and why the request set it (outcome_reason). setPayLineOutcome (patched) marks the line 'manual', and the
--   rules leave a manual line alone for good, whatever the flags do later. A person can still change an automatic one.
-- * When the request is made (private.workspace_cleaner_invoice_run, patched): after it is issued, before the cleaner is
--   told, so "Request for invoice ... ready: £X" says the amount to invoice after the automatic outcomes.
-- * Whenever a flag changes while the request waits: the clean's details change the no-form flag (the sweep tags it,
--   the form arrives late), a review is added (a redo accepted) or a rejection is overturned (a dispute decided). Two
--   triggers, like the earnings trigger in 20261022000000.
-- * Once now, for the requests already waiting when this is installed (private.workspace_clean_outcomes_auto_all).
-- * Each automatic change re-totals the request, bumps its version (a person with an older copy is asked to refresh) and
--   writes an 'outcome' line in its history with no person on it and the reason: { auto: true, reason }. The app reads
--   "Set ... to Unsuccessful automatically: no clean form". Reasons: no_form, rejected, redo_accepted, dispute_won, and
--   form_in or cleared when the flag behind an automatic outcome goes away (back to Completed).
-- * No notice: the cleaner hears nothing new (phone only in any case, never email).
-- * The request's lines for the app carry outcomeSource and outcomeReason (patch on private.workspace_cleaner_pay_invoice),
--   shown under the outcome in the request sheet. The printed document is unchanged.
--
-- Patches read the latest definition, need their anchor exactly once and are skipped once their sentinel is present.
-- Nothing is dropped or deleted. Safe to run twice.

alter table private.workspace_cleaner_invoice_lines add column if not exists outcome_source text check(outcome_source in ('auto','manual'));
alter table private.workspace_cleaner_invoice_lines add column if not exists outcome_reason text check(outcome_reason in ('no_form','rejected','redo_accepted','dispute_won','form_in','cleared','late_redo_accepted','late_dispute_won'));
-- A follow-up line: the earlier line of the same clean, Unsuccessful at £0 on an approved request, that it makes good.
alter table private.workspace_cleaner_invoice_lines add column if not exists follows_line_id uuid references private.workspace_cleaner_invoice_lines(id);
-- At most one follow-up per clean, ever.
create unique index if not exists workspace_cleaner_invoice_lines_follow_up_idx on private.workspace_cleaner_invoice_lines(work_id) where follows_line_id is not null;

-- Never paid twice: a follow-up only makes good an earlier line of the same clean that is not live, Unsuccessful, £0 and
-- set by the request, and is not itself a follow-up; an earlier line that has a follow-up never becomes live again and
-- never earns anything.
create or replace function private.workspace_clean_follow_up_guard() returns trigger language plpgsql security definer set search_path='' as $fn$
declare p private.workspace_cleaner_invoice_lines;
begin
 if new.follows_line_id is not null then
  select * into p from private.workspace_cleaner_invoice_lines x where x.id=new.follows_line_id;
  if p.id is null or p.id=new.id or p.work_id<>new.work_id or p.follows_line_id is not null or p.live or coalesce(p.pay_minor,p.amount_minor)<>0
   or p.outcome is distinct from 'unsuccessful' or p.outcome_source is distinct from 'auto' then
   raise exception 'A follow-up line is only for a clean that was Unsuccessful at £0, set automatically' using errcode='23514';
  end if;
 end if;
 if tg_op='UPDATE' and (new.live or coalesce(new.pay_minor,new.amount_minor)<>0)
  and exists(select 1 from private.workspace_cleaner_invoice_lines f where f.follows_line_id=new.id) then
  raise exception 'This clean is already made good on a later request: it cannot be paid twice' using errcode='23514';
 end if;
 return new;
end $fn$;
create or replace trigger clean_follow_up_guard before insert or update on private.workspace_cleaner_invoice_lines
 for each row execute function private.workspace_clean_follow_up_guard();

-- 1. The flags ------------------------------------------------------------------------------------------------------
-- The sweep tagged the clean as having no form, and the form is still not in.
create or replace function private.workspace_clean_form_flagged(item jsonb) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(item is not null and (coalesce(item->>'warning','')='no_form' or item ? 'formWarningAt') and not private.workspace_clean_form_in(item),false);
$fn$;

-- Which rule a clean falls under for one cleaner: no_form, rejected, redo_accepted, dispute_won, or null for none.
create or replace function private.workspace_clean_outcome_flag(work uuid,cleaner uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare last_upheld timestamptz;
begin
 if private.workspace_clean_form_flagged((select d.data from private.workspace_domain_details d where d.work_id=work and d.kind='cleaning')) then return 'no_form';end if;
 select max(r.created_at) into last_upheld from private.workspace_cleaning_reviews r where r.work_id=work and r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null;
 if last_upheld is null then
  if exists(select 1 from private.workspace_cleaning_reviews r where r.work_id=work and r.cleaner_id=cleaner and not r.accepted and r.overturned_at is not null) then return 'dispute_won';end if;
  return null;
 end if;
 if exists(select 1 from private.workspace_cleaning_reviews r where r.work_id=work and r.cleaner_id=cleaner and r.created_at>last_upheld and (r.accepted or r.overturned_at is not null)) then return 'redo_accepted';end if;
 return 'rejected';
end $fn$;

-- The outcome each reason gives.
create or replace function private.workspace_clean_outcome_for(reason text) returns text language sql immutable set search_path='' as $fn$
 select case reason when 'no_form' then 'unsuccessful' when 'rejected' then 'unsuccessful' when 'redo_accepted' then 'partial' when 'late_redo_accepted' then 'partial' else 'completed' end;
$fn$;

-- Since when a clean not done properly is put on a request: the day this migration was first installed (London).
create table if not exists private.workspace_clean_outcome_settings (
 id boolean primary key default true check(id),
 failed_since date not null
);
alter table private.workspace_clean_outcome_settings enable row level security;
revoke all on private.workspace_clean_outcome_settings from public,anon,authenticated;
insert into private.workspace_clean_outcome_settings(id,failed_since) values(true,(now() at time zone 'Europe/London')::date) on conflict (id) do nothing;

-- A clean not accepted that has settled as not done properly at a moment: (a) no form, or (b) a rejection that stands,
-- not sent again, its redo time passed. Waiting for review or a redo still underway: false.
create or replace function private.workspace_clean_failed_settled(item jsonb,work uuid,cleaner uuid,at_time timestamptz) returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare redo timestamptz;
begin
 if private.workspace_clean_form_flagged(item) then return true;end if;
 if coalesce(item->>'phase','assigned')<>'assigned' then return false;end if;
 if private.workspace_clean_outcome_flag(work,cleaner) is distinct from 'rejected' then return false;end if;
 begin redo:=nullif(item->>'redoBy','')::timestamptz; exception when others then redo:=null; end;
 return redo is null or redo<=coalesce(at_time,now());
end $fn$;

-- The cleans not done properly, not on a live line, dated before a day (null: any), for one cleaner (null: all), at the
-- cleaner's current rate (none: left off until they have one, like an unpriced accepted clean).
create or replace function private.workspace_clean_failed_open(cleaner uuid,before_day date,at_time timestamptz default now())
returns table(cleaner_id uuid,work_id uuid,property_id uuid,clean_on date,rate_minor integer) language sql stable security definer set search_path='' as $fn$
 select w.assignee_id,w.id,w.property_id,private.workspace_clean_form_day(w.due_on,d.data),r.rate_minor
 from public.workspace_work_items w
 join private.workspace_domain_details d on d.work_id=w.id and d.kind='cleaning'
 join public.workspace_profiles p on p.user_id=w.assignee_id and p.role='cleans'
 join private.workspace_cleaner_rates r on r.cleaner_id=w.assignee_id
 where (cleaner is null or w.assignee_id=cleaner) and w.property_id is not null
  and w.status not in ('cancelled','declined') and coalesce(d.data->>'phase','assigned')<>'accepted'
  and not exists(select 1 from private.workspace_clean_earnings e where e.work_id=w.id)
  and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=w.id and l.live)
  and private.workspace_clean_form_day(w.due_on,d.data)>=(select s.failed_since from private.workspace_clean_outcome_settings s where s.id)
  and (before_day is null or private.workspace_clean_form_day(w.due_on,d.data)<before_day)
  and private.workspace_clean_failed_settled(d.data,w.id,w.assignee_id,at_time)
$fn$;

-- 2. Applying them --------------------------------------------------------------------------------------------------
-- One line: true when its outcome or reason changed. Skips a line a person set, and a request that is not a generated
-- request waiting for approval.
create or replace function private.workspace_clean_outcome_auto(line_id uuid,at_time timestamptz default now()) returns boolean language plpgsql security definer set search_path='' as $fn$
declare l private.workspace_cleaner_invoice_lines;i private.workspace_cleaner_invoices;reason text;target text;current_outcome text;amount bigint;
begin
 select * into l from private.workspace_cleaner_invoice_lines x where x.id=line_id;
 if l.id is null or not l.live then return false;end if;
 select * into i from private.workspace_cleaner_invoices v where v.id=l.invoice_id for update;
 if i.id is null or not i.generated or i.status<>'to_approve' or i.paid_on is not null then return false;end if;
 select * into l from private.workspace_cleaner_invoice_lines x where x.id=line_id for update;
 if not l.live or coalesce(l.outcome_source,'')='manual' then return false;end if;
 current_outcome:=coalesce(l.outcome,'completed');
 reason:=private.workspace_clean_outcome_flag(l.work_id,i.cleaner_id);
 -- A follow-up only moves between a late redo and a late dispute.
 if l.follows_line_id is not null then
  if reason is null or reason not in ('redo_accepted','dispute_won') then return false;end if;
  reason:='late_'||reason;
 end if;
 if reason is null then
  -- No flag. A line the request never set stays as it is; an automatic one goes back to Completed.
  if l.outcome_source is null or (current_outcome='completed' and l.outcome_reason in ('dispute_won','form_in','cleared')) then return false;end if;
  reason:=case when l.outcome_reason='no_form' then 'form_in' else 'cleared' end;
 end if;
 target:=private.workspace_clean_outcome_for(reason);
 if target=current_outcome then
  -- Nothing to pay differently: a line never set is left alone; an automatic one only keeps the newer reason.
  if l.outcome_source is null or l.outcome_reason is not distinct from reason then return false;end if;
  update private.workspace_cleaner_invoice_lines set outcome_reason=reason where id=l.id;
  update private.workspace_cleaner_invoices set version=version+1,updated_at=now() where id=i.id;
  return true;
 end if;
 amount:=private.workspace_clean_outcome_minor(l.amount_minor,target);
 update private.workspace_cleaner_invoice_lines set outcome=target,pay_minor=amount,outcome_source='auto',outcome_reason=reason where id=l.id;
 -- Re-total: the amount to invoice is every live line at its outcome.
 update private.workspace_cleaner_invoices v set pay_minor=(select coalesce(sum(coalesce(x.pay_minor,x.amount_minor)),0) from private.workspace_cleaner_invoice_lines x where x.invoice_id=v.id and x.live),
  version=version+1,updated_at=now() where id=i.id returning * into i;
 insert into private.workspace_cleaner_invoice_history(invoice_id,event,actor_id,work_id,detail,at) values(i.id,'outcome',null,l.work_id,
  jsonb_build_object('from',current_outcome,'to',target,'amountMinor',amount,'totalMinor',i.pay_minor,'auto',true,'reason',reason,
   'propertyName',(select nullif(btrim(pr.name),'') from public.workspace_properties pr where pr.id=l.property_id),
   'cleanOn',coalesce((select e.clean_on from private.workspace_clean_earnings e where e.work_id=l.work_id),private.workspace_clean_day(l.work_id))),
  coalesce(at_time,now()));
 return true;
end $fn$;

-- Every live line of one request; answers how many changed.
create or replace function private.workspace_clean_outcomes_auto_invoice(invoice uuid,at_time timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $fn$
declare n integer:=0;l record;
begin
 for l in select x.id from private.workspace_cleaner_invoice_lines x left join private.workspace_clean_earnings e on e.work_id=x.work_id
  where x.invoice_id=invoice and x.live order by coalesce(e.clean_on,private.workspace_clean_day(x.work_id)),x.work_id
 loop
  if private.workspace_clean_outcome_auto(l.id,at_time) then n:=n+1;end if;
 end loop;
 return n;
end $fn$;

-- 2b. Late redo or dispute -----------------------------------------------------------------------------------------
-- Cleans Unsuccessful at £0 (set automatically) on an approved or paid request whose redo was since accepted or whose
-- dispute was since won, with no follow-up yet; for one cleaner (null: all), decided (latest review) before a moment.
create or replace function private.workspace_clean_late_open(cleaner uuid,before_at timestamptz)
returns table(cleaner_id uuid,line_id uuid,work_id uuid,property_id uuid,rate_minor bigint,reason text,moment timestamptz) language sql stable security definer set search_path='' as $fn$
 select v.cleaner_id,l.id,l.work_id,l.property_id,l.amount_minor,'late_'||f.flag,m.moment
 from private.workspace_cleaner_invoice_lines l
 join private.workspace_cleaner_invoices v on v.id=l.invoice_id
 cross join lateral (select private.workspace_clean_outcome_flag(l.work_id,v.cleaner_id) flag) f
 cross join lateral (select max(greatest(r.created_at,coalesce(r.overturned_at,r.created_at))) moment from private.workspace_cleaning_reviews r where r.work_id=l.work_id and r.cleaner_id=v.cleaner_id) m
 where l.live and l.follows_line_id is null and v.generated and v.status='approved'
  and l.outcome='unsuccessful' and l.outcome_source='auto' and coalesce(l.pay_minor,l.amount_minor)=0
  and f.flag in ('redo_accepted','dispute_won')
  and (cleaner is null or v.cleaner_id=cleaner) and (before_at is null or m.moment<before_at)
  and not exists(select 1 from private.workspace_cleaner_invoice_lines x where x.follows_line_id=l.id)
  and exists(select 1 from public.workspace_work_items w where w.id=l.work_id and w.status not in ('cancelled','declined'))
$fn$;

-- Puts them on a new request: the earlier line stops being the clean's live line, the follow-up takes its place.
create or replace function private.workspace_clean_late_attach(invoice uuid,cleaner uuid,before_at timestamptz) returns integer language plpgsql security definer set search_path='' as $fn$
declare r record;n integer:=0;target text;
begin
 for r in select * from private.workspace_clean_late_open(cleaner,before_at) o order by o.moment,o.work_id loop
  target:=private.workspace_clean_outcome_for(r.reason);
  update private.workspace_cleaner_invoice_lines set live=false where id=r.line_id;
  insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor,outcome,outcome_source,outcome_reason,follows_line_id)
   values(invoice,r.work_id,r.property_id,r.rate_minor,private.workspace_clean_outcome_minor(r.rate_minor,target),target,'auto',r.reason,r.line_id);
  n:=n+1;
 end loop;
 return n;
end $fn$;

-- When a request is made, after it is issued: the follow-ups in its history, then the automatic outcomes, then the amount
-- to invoice from its lines.
create or replace function private.workspace_clean_outcomes_issue(invoice uuid,at_time timestamptz default now()) returns void language plpgsql security definer set search_path='' as $fn$
begin
 insert into private.workspace_cleaner_invoice_history(invoice_id,event,actor_id,work_id,detail,at)
  select invoice,'outcome',null,l.work_id,jsonb_build_object('from','unsuccessful','to',l.outcome,'amountMinor',l.pay_minor,'auto',true,'reason',l.outcome_reason,
    'afterNumber',(select coalesce(v.number,v.reference) from private.workspace_cleaner_invoice_lines p join private.workspace_cleaner_invoices v on v.id=p.invoice_id where p.id=l.follows_line_id),
    'propertyName',(select nullif(btrim(pr.name),'') from public.workspace_properties pr where pr.id=l.property_id),
    'cleanOn',coalesce((select e.clean_on from private.workspace_clean_earnings e where e.work_id=l.work_id),private.workspace_clean_day(l.work_id))),coalesce(at_time,now())
  from private.workspace_cleaner_invoice_lines l where l.invoice_id=invoice and l.live and l.follows_line_id is not null order by coalesce(private.workspace_clean_day(l.work_id),current_date),l.work_id;
 perform private.workspace_clean_outcomes_auto_invoice(invoice,at_time);
 update private.workspace_cleaner_invoices v set pay_minor=(select coalesce(sum(coalesce(x.pay_minor,x.amount_minor)),0) from private.workspace_cleaner_invoice_lines x where x.invoice_id=v.id and x.live)
  where v.id=invoice;
end $fn$;

-- Every request waiting for approval (for the backend, and once below).
create or replace function private.workspace_clean_outcomes_auto_all() returns jsonb language plpgsql security definer set search_path='' as $fn$
declare n integer:=0;r record;
begin
 for r in select v.id from private.workspace_cleaner_invoices v where v.generated and v.status='to_approve' and v.paid_on is null order by v.created_at,v.id loop
  n:=n+private.workspace_clean_outcomes_auto_invoice(r.id);
 end loop;
 return jsonb_build_object('changed',n);
end $fn$;
create or replace function public.workspace_clean_outcomes_auto_all() returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_clean_outcomes_auto_all() $fn$;

-- 3. When a flag changes ------------------------------------------------------------------------------------------
-- The clean's details: the sweep tags it, or the form arrives late.
create or replace function private.workspace_clean_outcome_form_changed() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if private.workspace_clean_form_flagged(old.data)=private.workspace_clean_form_flagged(new.data) then return null;end if;
 perform private.workspace_clean_outcome_auto(l.id) from private.workspace_cleaner_invoice_lines l where l.work_id=new.work_id and l.live;
 return null;
end $fn$;
create or replace trigger clean_outcome_form_flag after update of data on private.workspace_domain_details
 for each row when (new.kind='cleaning' and old.data is distinct from new.data) execute function private.workspace_clean_outcome_form_changed();

-- The clean's reviews: a review added (a redo accepted, or a rejection) or a rejection overturned on dispute.
create or replace function private.workspace_clean_outcome_review_changed() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 perform private.workspace_clean_outcome_auto(l.id) from private.workspace_cleaner_invoice_lines l where l.work_id=new.work_id and l.live;
 return null;
end $fn$;
create or replace trigger clean_outcome_review_flag after insert or update of accepted,overturned_at on private.workspace_cleaning_reviews
 for each row execute function private.workspace_clean_outcome_review_changed();

-- 4. Patches ------------------------------------------------------------------------------------------------------
do $patch$
declare
 fixes constant text[][] := array[
  -- The run: the automatic outcomes once the request is issued; the cleaner's notice then gives the amount to invoice.
  ['private.workspace_cleaner_invoice_run(timestamptz)',
   $q$insert into private.workspace_cleaner_invoice_history(invoice_id,event,detail,at) values(inv.id,'issued',jsonb_build_object('totalMinor',total,'cleans',cleans),stamp);$q$,
   $q$insert into private.workspace_cleaner_invoice_history(invoice_id,event,detail,at) values(inv.id,'issued',jsonb_build_object('totalMinor',total,'cleans',cleans),stamp);
    -- Clean outcome flags (20261022050000): automatic outcomes (late follow-ups first), then the notice says the amount to invoice.
    perform private.workspace_clean_outcomes_issue(inv.id,stamp);
    total:=coalesce((select v.pay_minor from private.workspace_cleaner_invoices v where v.id=inv.id),total);$q$,
   $q$Clean outcome flags (20261022050000): automatic outcomes$q$],
  -- The run also takes the cleans not done properly: which cleaners have something to request, from when ...
  ['private.workspace_cleaner_invoice_run(timestamptz)',
   $q$for c in select e.cleaner_id,min(e.accepted_at) first_at from private.workspace_clean_earnings e$q$,
   $q$for c in select e.cleaner_id,min(e.accepted_at) first_at from (select x.cleaner_id,x.accepted_at,x.work_id,x.rate_minor from private.workspace_clean_earnings x
   union all select f.cleaner_id,(f.clean_on::timestamp at time zone 'Europe/London'),f.work_id,f.rate_minor from private.workspace_clean_failed_open(null,null,stamp) f /* Clean outcome flags (20261022050000): failed cleaners */
   union all select g.cleaner_id,g.moment,null::uuid,g.rate_minor from private.workspace_clean_late_open(null,null) g) e$q$,
   $q$Clean outcome flags (20261022050000): failed cleaners$q$],
  -- ... how much and how many for a period ...
  ['private.workspace_cleaner_invoice_run(timestamptz)',
   $q$select coalesce(sum(o.rate_minor),0),count(*) into total,cleans from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) o;$q$,
   $q$select coalesce(sum(o.rate_minor),0),count(*) into total,cleans from (select x.work_id,x.rate_minor from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) x
     union all select f.work_id,f.rate_minor from private.workspace_clean_failed_open(c.cleaner_id,p_after,stamp) f /* Clean outcome flags (20261022050000): failed count */
     union all select g.work_id,g.rate_minor from private.workspace_clean_late_open(c.cleaner_id,until_at) g) o;$q$,
   $q$Clean outcome flags (20261022050000): failed count$q$],
  -- ... the follow-ups for a late redo or dispute ...
  ['private.workspace_cleaner_invoice_run(timestamptz)',
   $q$insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor)$q$,
   $q$perform private.workspace_clean_late_attach(inv.id,c.cleaner_id,until_at) /* Clean outcome flags (20261022050000): late follow-ups */;
    insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,pay_minor)$q$,
   $q$Clean outcome flags (20261022050000): late follow-ups$q$],
  -- ... and their lines (the rules then make them Unsuccessful).
  ['private.workspace_cleaner_invoice_run(timestamptz)',
   $q$select inv.id,o.work_id,o.property_id,o.rate_minor,o.rate_minor from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) o;$q$,
   $q$select inv.id,o.work_id,o.property_id,o.rate_minor,o.rate_minor from (select x.work_id,x.property_id,x.rate_minor from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) x
     union all select f.work_id,f.property_id,f.rate_minor from private.workspace_clean_failed_open(c.cleaner_id,p_after,stamp) f /* Clean outcome flags (20261022050000): failed lines */) o;$q$,
   $q$Clean outcome flags (20261022050000): failed lines$q$],
  -- Approving: an Unsuccessful clean is not paid, so its missing form no longer holds the request up.
  ['private.workspace_cleaner_pay_action(jsonb)',
   $q$l.live and d.kind='cleaning' and not private.workspace_clean_form_in(d.data)) then$q$,
   $q$l.live and coalesce(l.outcome,'completed')<>'unsuccessful' /* Clean outcome flags (20261022050000): gate */ and d.kind='cleaning' and not private.workspace_clean_form_in(d.data)) then$q$,
   $q$Clean outcome flags (20261022050000): gate$q$],
  -- A person's outcome is theirs: the rules never change it again.
  ['private.workspace_cleaner_pay_action(jsonb)',
   $q$update private.workspace_cleaner_invoice_lines set outcome=chosen,pay_minor=amount where id=line.id;$q$,
   $q$update private.workspace_cleaner_invoice_lines set outcome=chosen,pay_minor=amount,outcome_source='manual',outcome_reason=null /* Clean outcome flags (20261022050000): manual */ where id=line.id;$q$,
   $q$Clean outcome flags (20261022050000): manual$q$],
  -- The lines say who set the outcome and why.
  ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)',
   $q$'outcome',coalesce(l.outcome,'completed'),'amountMinor',coalesce(l.pay_minor,l.amount_minor))$q$,
   $q$'outcome',coalesce(l.outcome,'completed'),'amountMinor',coalesce(l.pay_minor,l.amount_minor),'outcomeSource',l.outcome_source,'outcomeReason',l.outcome_reason /* Clean outcome flags (20261022050000): source */)$q$,
   $q$Clean outcome flags (20261022050000): source$q$],
  ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)',
   $q$'outcomeReason',l.outcome_reason /* Clean outcome flags (20261022050000): source */)$q$,
   $q$'outcomeReason',l.outcome_reason /* Clean outcome flags (20261022050000): source */,'followsNumber',(select coalesce(fv.number,fv.reference) from private.workspace_cleaner_invoice_lines fp join private.workspace_cleaner_invoices fv on fv.id=fp.invoice_id where fp.id=l.follows_line_id) /* Clean outcome flags (20261022050000): follows */)$q$,
   $q$Clean outcome flags (20261022050000): follows$q$],
  ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)',
   $q$l.invoice_id=i.id and (l.live or i.status='rejected')))$q$,
   $q$l.invoice_id=i.id and (l.live or i.status='rejected' or exists(select 1 from private.workspace_cleaner_invoice_lines fc where fc.follows_line_id=l.id) /* Clean outcome flags (20261022050000): made good, counted */)))$q$,
   $q$Clean outcome flags (20261022050000): made good, counted$q$],
  ['private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean)',
   $q$l.invoice_id=i.id and (l.live or i.status='rejected')),'[]'::jsonb)$q$,
   $q$l.invoice_id=i.id and (l.live or i.status='rejected' or exists(select 1 from private.workspace_cleaner_invoice_lines fs where fs.follows_line_id=l.id) /* Clean outcome flags (20261022050000): made good, shown */)),'[]'::jsonb)$q$,
   $q$Clean outcome flags (20261022050000): made good, shown$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Clean outcome flags patch %: anchor found % times in %',i,hits,fixes[i][1];end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Clean outcome flags patch % did not take in %',i,fixes[i][1];end if;
  end if;
 end loop;
end $patch$;

-- Who may call what: the backend may re-apply the rules to every waiting request; the rest runs inside the database.
revoke all on function private.workspace_clean_follow_up_guard(),private.workspace_clean_late_open(uuid,timestamptz),private.workspace_clean_late_attach(uuid,uuid,timestamptz),
 private.workspace_clean_outcomes_issue(uuid,timestamptz),private.workspace_clean_failed_settled(jsonb,uuid,uuid,timestamptz),private.workspace_clean_failed_open(uuid,date,timestamptz),
 private.workspace_clean_form_flagged(jsonb),private.workspace_clean_outcome_flag(uuid,uuid),private.workspace_clean_outcome_for(text),
 private.workspace_clean_outcome_auto(uuid,timestamptz),private.workspace_clean_outcomes_auto_invoice(uuid,timestamptz),private.workspace_clean_outcomes_auto_all(),
 public.workspace_clean_outcomes_auto_all(),private.workspace_clean_outcome_form_changed(),private.workspace_clean_outcome_review_changed() from public,anon,authenticated;
grant execute on function private.workspace_clean_outcomes_auto_all(),public.workspace_clean_outcomes_auto_all() to service_role;

-- 5. The requests already waiting ----------------------------------------------------------------------------------
select private.workspace_clean_outcomes_auto_all();
