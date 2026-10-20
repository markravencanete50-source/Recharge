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
  'chat.reported': copy('A message was reported', 'Someone has reported a message in Messages. Open Reported messages to read it, then remove it or dismiss the report.'),
  'chat.report_reviewed': copy('Your report was reviewed', 'An admin reviewed the message you reported and left it in place.'),
  'chat.report_removed': copy('Your report was reviewed', 'An admin removed the message you reported. Thanks for letting us know.'),
  'chat.message_removed': copy('An admin removed one of your messages', 'It broke the team\'s acceptable use rules. Contact an admin if you think this was a mistake.'),
  // Session C, round 5: every guest message tells Stays on the property and the admins (migration 20261015310000).
  'guest.message': copy('New guest message', 'A guest has sent a message. Open Messages to reply.'),
  // Session F, round 7: email to ownerrelations@ from someone who is not an owner yet (migration 20261019500000).
  'client.email': copy('New client email', 'Someone has emailed client relations. Open Messages, Clients to reply.'),
  // Session C: a guest or client message reported by the team (migration 20261020300000), to admins, then to whoever reported it.
  'inbox.reported': copy('A guest or client message was reported', 'Someone has reported a message from a guest or client. Open Reported messages to read it, then hide it in the app or dismiss the report.'),
  'inbox.report_hidden': copy('Your report was reviewed', 'An admin hid the message you reported in the app. Thanks for letting us know.'),
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
  'operations.updateOperation.reviseQuote': copy('Repair quote updated', 'The quote for a repair has changed. If it needs your approval, we will ask you before the work goes ahead.'),
  'operations.updateOperation.completeRepair': copy('Repair completed', 'A repair has been completed.'),
  'operations.updateOperation.declineBudget': copy('Owner declined a repair cost', 'An owner has declined the cost of a repair and said why. It can be re-quoted or closed.'),
  'operations.updateOperation.approveManagement': copy('Repair cost approved by management', 'Management has approved the cost of a repair. If the owner needs to approve it too, it is now waiting for them; otherwise the work can go ahead.'),
  'operations.updateOperation.declineManagement': copy('Repair cost declined by management', 'Management has declined the cost of a repair. It can be re-quoted or closed.'),
  'operations.updateOperation.closeRepair': copy('Repair closed', 'A repair has been closed without the work going ahead.'),
  // Repairs with contractors (migration 20261021200000): the team reviewed a contractor's estimate, the contractor can book,
  // and an estimate approved because a property's repair limit changed (Limit Changer).
  'operations.updateOperation.reviewDone': copy('Contractor estimate reviewed', 'Management have checked a contractor’s estimate. Within the owner’s limit it is approved straight away; above it, the owner is asked.'),
  'operations.updateOperation.approvedToBook': copy('Approved, please book the visit', 'Your estimate is approved. Choose the day and time for the visit.'),
  'operations.repairLimit.autoApproved': copy('Repair estimate approved', 'A repair estimate is now within the property’s repair limit, so it was approved automatically and the visit can be booked.'),
  'finance.repair_limit_updated': copy('Repair approval limit changed', 'The repair approval limit has changed. Repairs under it are approved automatically; at or over it, management approve first, then the owner.'),
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
  // The cleaner flow (migration 20261021500000): to the cleaner, each with the property, day and times in the pop-up.
  'cleaning.assigned': copy('New clean for you', 'A clean has been added to your list. Open Cleans to see the day, the checkout time and when the next guests arrive.'),
  'cleaning.unassigned': copy('Clean taken off your list', 'A clean you had has been given to someone else or taken off your list. You do not need to do it.'),
  'cleaning.moved': copy('Clean moved', 'One of your cleans has moved to another day. Open Cleans to see the new day.'),
  'cleaning.cancelled': copy('Clean cancelled', 'One of your cleans has been cancelled, usually because the stay was cancelled. You do not need to do it.'),
  'cleaning.redo': copy('Please redo a clean', 'One of your cleans was not accepted. Please redo it by the time shown, then send the form again. You can give your side too.'),
  'cleaning.morning': copy('Your cleans today', 'Good morning. Open Cleans to see today\'s cleans, with the checkout times and when the next guests arrive.'),
  // The invoice maker (migration 20261022100000): an invoice or a request for invoice sent to someone in the app; the number and amount in the pop-up only.
  'finance.document_sent': copy('A document from Recharge Group', 'You have been sent an invoice or a request for an invoice. Open Home, Documents for you to see it.'),
  // Requests for invoice (migration 20261022000000): to the cleaner, with the number and the amount in the pop-up only.
  'cleaning.invoice_ready': copy('Your request for invoice is ready', 'Your accepted cleans for the period are on a new request for invoice. Open Cleans, Your pay to see it and send us your invoice.'),
  'cleaning.invoice_approved': copy('Request approved', 'Accounts approved one of your requests for invoice. It will be paid by its due date.'),
  'cleaning.invoice_queried': copy('A question about your request', 'Accounts have a question about one of your requests for invoice. Open Cleans, Your pay to read it.'),
  'cleaning.invoice_paid': copy('Request paid', 'One of your requests for invoice has been paid. Open Cleans, Your pay to see it.'),
  // VA pay (migration 20261022200000): to the VA, in the app only, with the number and the amount in the row's detail.
  'vapay.request_approved': copy('Request for invoice approved', 'Management approved your request for invoice. Please send us your invoice for the amount shown. Open My performance, Your requests for invoice to see it.'),
  'vapay.request_queried': copy('Request for invoice queried', 'Management has a question about your request for invoice. Open My performance, Your requests for invoice to see their note.'),
  'vapay.request_rejected': copy('Request for invoice rejected', 'Management rejected your request for invoice. Open My performance, Your requests for invoice to see the reason.'),
  'vapay.request_paid': copy('Request for invoice paid', 'Your request for invoice has been paid. Open My performance, Your requests for invoice to see it.'),
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
  'hub.todo_updated': copy('New comment on a to-do', 'Someone has commented on a to-do you are part of.'),
  'hub.todo_mentioned': copy('You were mentioned on a to-do', 'Someone mentioned you in a comment on a to-do.'),
  'hub.approval_added': copy('Approval needed', 'Someone on the team has asked management to approve a cost.'),
  'hub.approval_approved': copy('Approved', 'Management has approved your request.'),
  'hub.approval_declined': copy('Not approved', 'Management has declined your request and said why.'),
  // Who does what and when.
  'team.responsibility_given': copy('A responsibility is yours', 'You have been made responsible for something, or its backup, in the responsibilities register.'),
  'team.rota_planned': copy('Your rota has changed', 'Management has planned or changed your shifts. Check the rota for your days.'),
  'team.shift_corrected': copy('Your timesheet was corrected', 'Management has corrected or added one of your shifts, with a note of why.'),
  'enquiry.received': copy('A client enquiry is back', 'A landlord has filled in the property enquiry form. Their details are in Leads, ready to value.'),
  // The same people, when that form is a possible duplicate (migration 20261020800000).
  // The landlord made their account with the email from their enquiry, so the property moved onto it (20261025200000).
  'enquiry.owner_linked': copy('An enquiry now has an owner account', 'A landlord created their Recharge account with the email from their enquiry. Their property is on their account now, and they follow the onboarding in the app.'),
  'enquiry.duplicate': copy('An enquiry may be a duplicate', 'A returned enquiry form matches a property at the same address, an owner we already work with, or another enquiry. Check it in Leads before valuing.'),
  // A comment on a lead (migration 20261025300000): whoever sent or valued it and everyone who commented on it.
  'enquiry.lead_comment': copy('New comment on a lead', 'Someone on the team has commented on a lead you are part of. Open Leads to read it.'),
  'feedback.received': copy('New team feedback', 'Someone on the team has sent feedback. Read it in Feedback, mark it seen or done, and reply if you like.'),
  'feedback.replied': copy('A reply to your feedback', 'A super admin has replied to feedback you sent. Open Feedback to read it.'),
  'team.shift_not_clocked_out': copy('Shift not clocked out', 'A shift has been open for more than 16 hours with no clock out. It counts up to 16 hours until a manager corrects it in Productivity.'),
  'team.emergency': copy('Emergency on shift', 'A team member has paused their shift for an emergency. Open Access control or Productivity to see who, and check in with them.'),
  'team.shift_change_requested': copy('Timesheet change to approve', 'An admin has asked to change someone\'s clock in or clock out. It reaches their hours only once you approve it.'),
  'team.shift_change_approved': copy('Timesheet change approved', 'A super admin has approved your change to someone\'s hours. It now counts in their timesheet and productivity.'),
  'team.shift_change_declined': copy('Timesheet change declined', 'A super admin has declined your change to someone\'s hours and said why. Their hours stay as they were.'),
  // Flags for management: raised by the team, decided by admins.
  'management.flag_raised': copy('Flagged for management', 'Someone on the team has flagged something for management. Open Approvals to read why and decide.'),
  'management.flag_resolved': copy('Your flag was resolved', 'Management has looked at what you flagged and resolved it.'),
  'management.flag_declined': copy('Your flag was declined', 'Management has declined what you flagged and said why.'),
  'management.flag_withdrawn': copy('A flag was withdrawn', 'The person who flagged this has withdrawn it.'),
  'cleaning.form_missing': copy('Clean form missing', 'A clean still has no form the morning after, so it has been flagged for management. The cleaner can still send the form, and their invoice for it cannot be approved until they do.'),
  // Session A: the 18:00 reminder to the cleaner (client answer 8).
  'cleaning.form_reminder': copy('Send your clean form', 'Your form for today\'s clean was due by 18:00 and is not in yet. Send it now; if it is still missing in the morning, management is told.'),
  // Day reflections, daily to-dos, AirCover, direct bookings and the team calendar.
  'reflection.saved': copy('Day reflection sent', 'A team member has written their end-of-day reflection. Open Reflections to read it.'),
  'reflection.reviewed': copy('Your reflection was read', 'Management has read your end-of-day reflection.'),
  'todo.daily_created': copy('Today’s to-dos are ready', 'Your daily to-dos have been added to your list.'),
  'aircover.flagged': copy('Possible AirCover claim', 'A maintenance issue has been flagged as a possible AirCover claim. Open AirCover claims to take it on.'),
  'stays.direct_booking_follow_up': copy('Direct booking to follow up', 'A long stay booked through a booking site is ready for a direct-booking follow-up.'),
  'team.event_added': copy('Team calendar updated', 'An absence or meeting has been added to the team calendar.'),
  'team.event_set': copy('Your calendar was changed', 'Someone has added or changed an entry on your calendar.'),
  'team.event_cancelled': copy('Team calendar entry cancelled', 'An absence or meeting on the team calendar has been cancelled.'),
  'operations.updateOperation.resolveRepair': copy('Repair resolved', 'A repair has been resolved without a visit.'),
  'routine.visit_form_recorded': copy('Visit form recorded', 'The form for a preventative maintenance visit has been filled in.'),
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
  ['management.', copy('Management update', 'There is an update on something flagged for management.')],
  ['reflection.', copy('Reflection update', 'There is an update on a day reflection.')],
  ['aircover.', copy('AirCover update', 'There is an update on an AirCover claim.')],
  ['team.', copy('Team update', 'There is an update to the team’s rota or responsibilities.')],
  ['property_details.', copy('Property details updated', 'A property’s details have been updated.')],
  ['vapay.', copy('Request for invoice update', 'There is an update on your request for invoice.')],
];
const FALLBACK = copy('Update in Recharge', 'There is an update in your Recharge workspace.');

export function noticeCopy(eventType: string | null | undefined): NoticeCopy {
  if (!eventType) return FALLBACK;
  return EXACT[eventType] ?? BY_AREA.find(([prefix]) => eventType.startsWith(prefix))?.[1] ?? FALLBACK;
}
