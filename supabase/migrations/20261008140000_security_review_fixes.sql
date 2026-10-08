-- Security review (8 October 2026).
-- 1. Onboarding gate: tools already close until a team member has signed their contract and
--    finished required training, but two table policies only checked for an active role, so an
--    approved team member could still read the properties they are assigned to directly.
--    Both now require a finished onboarding too (admins and owners are never gated).
-- 2. Indexes for foreign keys the app joins on (performance advisor).
grant execute on function private.workspace_onboarded() to authenticated;

alter policy properties_assigned on public.workspace_properties using (
 (select private.workspace_actor_role()) is not null and (select private.workspace_onboarded()) and
 ((select private.workspace_actor_role()) in ('admin','super_admin','accounts') or exists(select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())))
);
alter policy assignments_admin_or_self on public.workspace_property_assignments using (
 (select private.workspace_actor_role()) in ('admin','super_admin') or
 ((select private.workspace_actor_role()) is not null and (select private.workspace_onboarded()) and user_id=(select auth.uid()))
);

create index if not exists workspace_guest_messages_property_idx on private.workspace_guest_messages(property_id);
create index if not exists workspace_guest_messages_author_idx on private.workspace_guest_messages(author_user_id);
create index if not exists workspace_shifts_closed_by_idx on private.workspace_shifts(closed_by);
create index if not exists workspace_contract_versions_published_by_idx on private.workspace_contract_versions(published_by);
create index if not exists workspace_cleaning_reviews_work_idx on private.workspace_cleaning_reviews(work_id);
create index if not exists workspace_cleaning_reviews_reviewer_idx on private.workspace_cleaning_reviews(reviewer_id);
create index if not exists workspace_media_evidence_work_idx on private.workspace_media_evidence(work_id);
create index if not exists workspace_media_evidence_property_idx on private.workspace_media_evidence(property_id);
create index if not exists workspace_media_evidence_owner_idx on private.workspace_media_evidence(owner_id);
create index if not exists workspace_expense_evidence_work_idx on private.workspace_expense_evidence(work_id);
create index if not exists workspace_expense_evidence_media_idx on private.workspace_expense_evidence(media_id);
create index if not exists workspace_journeys_invoice_idx on private.workspace_journeys(invoice_id);
create index if not exists workspace_routine_plans_assignee_idx on private.workspace_routine_plans(assignee_id);
create index if not exists workspace_invoices_module_idx on public.workspace_invoices(module_id);
create index if not exists workspace_reservations_created_by_idx on private.workspace_reservations(created_by);
