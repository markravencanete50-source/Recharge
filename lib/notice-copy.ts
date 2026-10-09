// Plain-English wording for each kind of update: the title in the app's Updates list, and the
// subject and message of the email or phone notification. Messages never include property names,
// addresses, money, bank details, access codes or notes; the details stay behind sign-in.
export type NoticeCopy = { title: string; message: string };

const SIGN_IN = 'Sign in to Recharge to see the details.';
const copy = (title: string, message: string): NoticeCopy => ({ title, message: message + ' ' + SIGN_IN });

const EXACT: Record<string, NoticeCopy> = {
  // Property onboarding, in the order an owner meets it.
  'chat.message': copy('New message', 'You have a new message in Recharge.'),
  'chat.owner_message': copy('New message from an owner', 'An owner has sent Recharge a message.'),
  'journey.createEnquiry': copy('New property enquiry', 'A new property enquiry has been started.'),
  'journey.publishEstimate': copy('Your estimate is ready', 'Recharge has prepared an estimate for your property, with expected nightly rates and comparable listings. You can review it and choose how to go ahead.'),
  'journey.decideEstimate': copy('Estimate decision recorded', 'A decision has been recorded on a property estimate.'),
  'journey.publishAgreement': copy('Management agreement ready to sign', 'The management agreement for your property is ready to read and sign.'),
  'journey.signAgreement': copy('Management agreement signed', 'The management agreement has been signed. The next step is the property set-up form.'),
  'journey.submitForm': copy('Set-up form received', 'The property set-up form has been completed. The onboarding invoice comes next.'),
  'journey.linkInvoice': copy('Onboarding invoice issued', 'The onboarding invoice for your property has been issued.'),
  'journey.recordInvoiceOutside': copy('Onboarding invoice recorded', 'The onboarding invoice was handled outside the app.'),
  'journey.bookInspection': copy('Property inspection booked', 'The property inspection has been booked.'),
  'journey.completeInspection': copy('Property inspection completed', 'The property inspection is complete and the report is ready.'),
  'journey.makeLive': copy('Your property is live', 'Your property is now live and taking bookings.'),
  'journey.askQuestion': copy('New question about an onboarding', 'An owner has asked a question about their onboarding.'),
  'journey.answerQuestion': copy('Your question has been answered', 'Recharge has answered your question about your onboarding.'),
  // Owners, each Monday.
  'reports.weekly_ready': copy('Your weekly report is ready', 'This week’s report on your property is ready to view and download.'),
  // Repairs.
  'operations.updateOperation.approveBudget': copy('Repair approved', 'A repair has been approved and can go ahead.'),
  'operations.updateOperation.referReady': copy('Repair passed to Ready', 'A repair has been passed to the Ready team to arrange.'),
  'operations.updateOperation.bookRepair': copy('Repair booked', 'A repair has been booked in.'),
  'operations.updateOperation.reviseQuote': copy('Repair quote updated', 'The quote for a repair has changed. If it is above your approval limit, it needs your approval before the work goes ahead.'),
  'operations.updateOperation.completeRepair': copy('Repair completed', 'A repair has been completed.'),
  'operations.updateOperation.declineBudget': copy('Owner declined a repair cost', 'An owner has declined the cost of a repair and said why. It can be re-quoted or closed.'),
  'operations.updateOperation.approveManagement': copy('Repair cost approved by management', 'Management has approved the cost of a repair, so it can go ahead.'),
  'operations.updateOperation.declineManagement': copy('Repair cost declined by management', 'Management has declined the cost of a repair. It can be re-quoted or closed.'),
  'operations.updateOperation.closeRepair': copy('Repair closed', 'A repair has been closed without the work going ahead.'),
  'finance.repair_limit_updated': copy('Repair approval limit changed', 'The amount above which repairs need management approval has changed.'),
  // Approvals that have waited: the owner is reminded at 48 hours, client relations told at 96.
  'repairs.owner_reminder': copy('A repair is waiting for your approval', 'A repair at your property is waiting for you to approve its cost. Approving it, or asking us about it, lets the work go ahead.'),
  'repairs.owner_escalated': copy('An owner hasn’t approved a repair', 'A repair has waited four days for the owner’s approval. Please contact the owner so the work doesn’t stall.'),
  'journey.estimate_reminder': copy('Your estimate is waiting for you', 'The estimate for your property is ready and waiting for your decision. You can go ahead, ask for more time or ask us a question.'),
  'journey.estimate_escalated': copy('An owner hasn’t answered their estimate', 'An estimate has waited four days for the owner’s decision. Please contact the owner.'),
  // Purchases.
  'operations.updateOperation.approvePurchase': copy('Purchase approved', 'A purchase request has been approved.'),
  'operations.updateOperation.recordOrder': copy('Purchase ordered', 'A purchase has been ordered.'),
  'operations.updateOperation.recordDelivery': copy('Purchase delivered', 'A purchase has been delivered.'),
  'operations.updateOperation.reconcilePurchase': copy('Purchase closed', 'A purchase has been checked against its invoice and closed.'),
  // Cleans.
  'operations.updateOperation.submitCleaning': copy('Clean submitted', 'A clean has been submitted for review.'),
  'operations.updateOperation.reviewCleaning': copy('Clean reviewed', 'A clean has been reviewed.'),
  'cleaning.cleaner_responded': copy('Cleaner responded', 'A cleaner has responded to a complaint.'),
  'cleaning.accepted': copy('Clean accepted', 'One of your cleans has been checked and accepted.'),
  'cleaning.rejected': copy('Clean not accepted', 'One of your cleans was not accepted. You can see why, and give your side before management decides.'),
  'cleaning.dispute_upheld': copy('Rejection upheld', 'Management has looked at the rejected clean and your response. The rejection stands.'),
  'cleaning.dispute_overturned': copy('Rejection overturned', 'Management has overturned the rejection of your clean. It no longer counts against you.'),
  'cleaning.checklist_saved': copy('Clean checklist updated', 'A clean checklist, and which checks need photos, has been updated.'),
  'cleaning.checklist_removed': copy('Clean checklist removed', 'A clean checklist has been removed. Cleans use the checklist for every property instead.'),
  'operations.updateOperation.reportCleanProblem': copy('Problem reported from a clean', 'A cleaner has reported a problem at a property.'),
  // Stays.
  'operations.updateOperation.prepareQuote': copy('Direct-booking offer prepared', 'A direct-booking offer has been prepared for a guest.'),
  'operations.updateOperation.recordGuestAcceptance': copy('Guest accepted the offer', 'A guest has accepted a direct-booking offer.'),
  'operations.updateOperation.recordGuestDecline': copy('Guest declined the offer', 'A guest has declined a direct-booking offer.'),
  'operations.updateOperation.confirmBooking': copy('Direct booking confirmed', 'A direct booking has been confirmed.'),
  'operations.updateOperation.recordApplied': copy('Price change applied', 'A price change has been applied.'),
  'operations.updateOperation.submitApplication': copy('Licence application submitted', 'A licence application has been submitted.'),
  'operations.updateOperation.recordSafetyChecks': copy('Licensing safety checks done', 'The licensing safety checks have been recorded.'),
  'operations.updateOperation.recordGranted': copy('Licence granted', 'A licence has been granted.'),
  'operations.updateOperation.startRelisting': copy('Re-listing started', 'Work has started on re-listing a property.'),
  'operations.updateOperation.completeHandover': copy('Task completed', 'A task has been completed.'),
  'operations.createOperation': copy('New task', 'A new task has been added.'),
  'operations.recordReservation': copy('Stay recorded', 'A stay has been recorded.'),
  'stays.daily_signoff': copy('Day signed off', 'The daily Stays checks have been signed off.'),
  'stays.missed_yesterday': copy('Yesterday’s checks were missed', 'Some of yesterday’s Stays sign-offs or listing checks were not done. Open Management to see what was missed.'),
  'reservation.imported': copy('New booking', 'A new booking has come in.'),
  'reservation.updated': copy('Booking updated', 'A booking has changed.'),
  'reservation.cancelled': copy('Booking cancelled', 'A booking has been cancelled.'),
  // Accounts.
  'finance.statement_issued': copy('Owner statement issued', 'A new owner statement has been issued.'),
  'finance.owner_paid': copy('Owner payment made', 'A payment to the owner has been recorded.'),
  'finance.expense_drafted': copy('Repair cost ready to check', 'A completed repair has been added to Accounts as a draft expense, with its report and photos.'),
  'finance.expense_linked': copy('Expense linked to a job', 'An expense has been linked to the job it pays for.'),
  'finance.purchase_invoice_recorded': copy('Purchase invoice recorded', 'The supplier invoice for a purchase has been recorded.'),
  'finance.payout_approved': copy('Owner payout approved', 'Management has checked and approved an unusual owner payout.'),
  // Team.
  'handover.created': copy('New task for your team', 'A new task has been handed to your team.'),
  'routine.plan_saved': copy('Preventative maintenance updated', 'A preventative maintenance plan has been saved.'),
  'routine.visit_due': copy('Preventative maintenance due soon', 'A preventative maintenance visit is due in the next three days.'),
  'training.course_saved': copy('Training updated', 'A training course has been updated.'),
  'onboarding.contract_signed': copy('Staff contract signed', 'A staff contract has been signed.'),
  'onboarding.completed': copy('Onboarding finished', 'A new team member has signed their contract and finished their training. Their tools are open.'),
  'onboarding.action_needed': copy('Something to do before you carry on', 'There is a contract to sign or training to finish before your tools open again. Open Recharge to see what it is.'),
  'training.file_added': copy('Training updated', 'A file has been added to a training course.'),
  'message.sent': copy('New message', 'You have a new message.'),
  // The hub: to-dos and approval tickets.
  'hub.todo_added': copy('New to-do for you', 'A to-do has been added to your list or your department\'s.'),
  'hub.todo_changed': copy('To-do updated', 'A to-do on your list has been changed.'),
  'hub.todo_done': copy('To-do done', 'A to-do you set has been marked done.'),
  'hub.approval_added': copy('Approval needed', 'Someone on the team has asked management to approve a cost.'),
  'hub.approval_approved': copy('Approved', 'Management has approved your request.'),
  'hub.approval_declined': copy('Not approved', 'Management has declined your request and said why.'),
  // People who delete their own account (admins are told).
  'account.owner_deleted': copy('An owner deleted their account', 'An owner has deleted their Recharge account. Their properties stay with the business, no longer linked to a login. Check whether their management agreement should end.'),
  'account.staff_deleted': copy('A team member deleted their account', 'A team member has deleted their Recharge account. Their access has been removed and their work stays on record as “Deleted user”.'),
};
const BY_AREA: [string, NoticeCopy][] = [
  ['journey.', copy('Onboarding update', 'There is an update on a property onboarding.')],
  ['operations.', copy('Task updated', 'A task has been updated.')],
  ['finance.', copy('Accounts update', 'There is an update in Accounts.')],
  ['cleaning.', copy('Cleaning update', 'There is an update on a clean.')],
  ['reservation.', copy('Booking update', 'There is an update on a booking.')],
  ['hub.', copy('Hub update', 'There is an update in the hub.')],
  ['property_details.', copy('Property details updated', 'A property’s details have been updated.')],
];
const FALLBACK = copy('Update in Recharge', 'There is an update in your Recharge workspace.');

export function noticeCopy(eventType: string | null | undefined): NoticeCopy {
  if (!eventType) return FALLBACK;
  return EXACT[eventType] ?? BY_AREA.find(([prefix]) => eventType.startsWith(prefix))?.[1] ?? FALLBACK;
}
