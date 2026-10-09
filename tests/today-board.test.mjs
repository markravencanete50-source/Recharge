import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Home's Today / Tomorrow / Overdue board for cleaners, cleaning managers and Ready, and the clean
// checklist counter and Submit reasons. Pure functions, checked without a database.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const board = await vite.ssrLoadModule('/lib/today-board.ts');
const { boardJobs, boardRole, bucketJobs, byCleaner, jobAction, jobsFor, jobWindow, londonDay, nextUp, progressLabel, shiftDay } = board;
const { checklistProgress, progressCounter, submitBlockers, templateFor } = await vite.ssrLoadModule('/lib/clean-checklist-policy.ts');

const ME = '11111111-1111-4111-8111-111111111111', JO = '22222222-2222-4222-8222-222222222222', AL = '33333333-3333-4333-8333-333333333333';
let n = 0;
const row = (extra = {}) => ({ workId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, propertyId: 'p-' + n, propertyName: 'Property ' + n, title: 'Checkout clean', status: 'waiting', dueOn: '2026-10-09', assigneeId: ME, assigneeName: 'Me', kind: 'cleaning', ...extra });

test('days are Europe/London days, across midnight and the clocks going back', () => {
  assert.equal(londonDay(new Date('2026-10-09T23:30:00Z')), '2026-10-10', 'British Summer Time: 00:30 the next day');
  assert.equal(londonDay(new Date('2026-12-31T23:30:00Z')), '2026-12-31', 'Greenwich Mean Time in winter');
  assert.equal(londonDay(new Date('2026-10-24T23:30:00Z')), '2026-10-25', 'the night the clocks go back');
  assert.equal(londonDay(new Date('2026-10-25T23:30:00Z')), '2026-10-25', 'after the clocks go back');
  assert.equal(shiftDay('2026-10-24', 1), '2026-10-25');
  assert.equal(shiftDay('2026-10-25', 1), '2026-10-26');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('jobs fall into today, tomorrow and overdue; done jobs are never overdue', () => {
  const today = '2026-10-09';
  const jobs = boardJobs([
    row({ dueOn: today, propertyName: 'Birch' }),
    row({ dueOn: today, propertyName: 'Ash', status: 'in_review' }),
    row({ dueOn: '2026-10-10', propertyName: 'Cedar' }),
    row({ dueOn: '2026-10-07', propertyName: 'Late', status: 'waiting' }),
    row({ dueOn: '2026-10-06', propertyName: 'Later still', status: 'in_progress', kind: 'routine_visit' }),
    row({ dueOn: '2026-10-05', propertyName: 'Finished', status: 'completed' }),
    row({ dueOn: '2026-10-08', propertyName: 'Submitted', status: 'in_review' }),
    row({ dueOn: today, propertyName: 'Cancelled', status: 'cancelled' }),
    row({ dueOn: null, propertyName: 'No date' }),
    row({ dueOn: '2026-10-16', propertyName: 'Next week' }),
  ]);
  const b = bucketJobs(jobs, today);
  assert.deepEqual(b.today.map(j => j.propertyName), ['Ash', 'Birch'], 'cancelled and undated jobs are left out');
  assert.deepEqual(b.tomorrow.map(j => j.propertyName), ['Cedar']);
  assert.deepEqual(b.overdue.map(j => j.propertyName), ['Later still', 'Late'], 'oldest first; done, submitted and closed jobs are not overdue');
  assert.equal(b.next.propertyName, 'Cedar', 'the next job after today');
  assert.equal(nextUp(b.today).propertyName, 'Birch', 'the first job not done yet');
  assert.equal(progressLabel(b.today, 'today'), '1 of 2 done today');
  assert.equal(bucketJobs(jobs, '2026-10-12').next.propertyName, 'Next week', 'an empty day still points to the next job');
  assert.equal(bucketJobs(jobs, '2026-10-20').next, null);
});

test('a day runs in work order: same-day turnovers, cleans, repairs, then visits', () => {
  const today = '2026-10-09';
  const visit = row({ kind: 'routine_visit', propertyName: 'Alder', title: 'Bins and garden' });
  const repair = row({ kind: 'maintenance', propertyName: 'Alder', title: 'Fix the boiler', status: 'in_progress' });
  const clean = row({ propertyName: 'Alder' });
  const turnover = row({ propertyName: 'Zennor' });
  const marked = row({ propertyName: 'Yew', data: { sameDayTurnover: true } });
  const jobs = boardJobs([visit, repair, clean, turnover, marked], [], [
    { workId: turnover.workId, guestsLeaving: 4, nextArrivalOn: today, nextArrivalGuests: 2 },
    { workId: clean.workId, guestsLeaving: 3, nextArrivalOn: '2026-10-12', nextArrivalGuests: 5 },
  ]);
  const ordered = bucketJobs(jobs, today).today;
  assert.deepEqual(ordered.map(j => j.propertyName + ':' + j.type), ['Yew:clean', 'Zennor:clean', 'Alder:clean', 'Alder:repair', 'Alder:visit']);
  const zennor = ordered[1];
  assert.equal(zennor.sameDay, true); assert.equal(zennor.arrivingGuests, 2); assert.equal(zennor.guestsLeaving, 4);
  assert.equal(ordered[2].sameDay, false); assert.equal(ordered[2].arrivingGuests, null, 'guests arriving only counts a same-day turnover');
  assert.equal(jobWindow(zennor, today), 'Before arrival');
  assert.equal(jobWindow(ordered[2], today), 'After checkout');
  assert.equal(jobWindow(ordered[3], today), 'Booked');
  assert.equal(jobWindow({ ...ordered[4], dueOn: '2026-10-01' }, today), 'Overdue');
});

test('each person sees their own jobs; Ready also sees repairs and visits nobody has taken', () => {
  const jobs = boardJobs([
    row({ assigneeId: ME }), row({ assigneeId: JO }), row({ assigneeId: null }),
    row({ kind: 'maintenance', assigneeId: null }), row({ kind: 'routine_visit', assigneeId: JO }), row({ kind: 'routine_visit', assigneeId: ME }),
  ]);
  assert.deepEqual(jobsFor(jobs, 'cleans', ME).map(j => j.type), ['clean', 'visit']);
  assert.deepEqual(jobsFor(jobs, 'ready', ME).map(j => j.type + ':' + (j.assigneeId ? 'mine' : 'open')), ['clean:mine', 'repair:open', 'visit:mine']);
  assert.equal(jobsFor(jobs, 'cleaning_manager', ME).length, 3, 'cleaning managers see every clean, nothing else');
  assert.equal(boardRole('cleans'), 'cleans'); assert.equal(boardRole('ready'), 'ready'); assert.equal(boardRole('cleaning_manager'), 'cleaning_manager');
  assert.equal(boardRole('admin'), null); assert.equal(boardRole('client'), null); assert.equal(boardRole('stays'), null);
});

test('operations add the stage, and open jobs due before the schedule window', () => {
  const scheduled = row({ status: 'waiting' });
  const old = { ...row({ dueOn: '2026-08-01', propertyName: 'Old' }), data: {} };
  const closedOld = { ...row({ dueOn: '2026-08-02', status: 'completed' }), data: {} };
  const jobs = boardJobs([scheduled], [
    { ...scheduled, status: 'waiting', data: { phase: 'assigned', accepted: false } },
    old, closedOld,
  ]);
  assert.equal(jobs.length, 2, 'an open job from before the window is added; a closed one is not');
  assert.equal(jobs[0].redo, true, 'a clean the reviewer sent back');
  assert.equal(jobAction(jobs[0]), 'Continue');
  assert.deepEqual(bucketJobs(jobs, '2026-10-09').overdue.map(j => j.propertyName), ['Old']);
});

test('one button per job: Start, Continue or Open; managers Assign or Open', () => {
  const [waiting, going, visitGoing, repairBooked, submitted, unassigned] = boardJobs([
    row({ status: 'waiting' }), row({ status: 'in_progress' }), row({ kind: 'routine_visit', status: 'in_progress' }),
    row({ kind: 'maintenance', status: 'in_progress' }), row({ status: 'in_review' }), row({ assigneeId: null }),
  ]);
  assert.equal(jobAction(waiting), 'Start');
  assert.equal(jobAction(going), 'Continue');
  assert.equal(jobAction(visitGoing), 'Continue');
  assert.equal(jobAction(repairBooked), 'Start', 'a booked repair is still to start');
  assert.equal(jobAction(submitted), 'Open');
  assert.equal(jobAction(unassigned, true), 'Assign');
  assert.equal(jobAction(waiting, true), 'Open');
  assert.equal(jobAction(submitted, true), 'Open');
});

test('cleaning managers see the day by cleaner, with unassigned cleans first', () => {
  const jobs = boardJobs([
    row({ assigneeId: JO, assigneeName: 'Jo', propertyName: 'B' }),
    row({ assigneeId: AL, assigneeName: 'Alex', propertyName: 'C' }),
    row({ assigneeId: null, assigneeName: null, propertyName: 'D' }),
    row({ assigneeId: JO, assigneeName: 'Jo', propertyName: 'A', status: 'completed' }),
    row({ assigneeId: null, assigneeName: null, propertyName: 'A' }),
  ]);
  const groups = byCleaner(jobsFor(jobs, 'cleaning_manager', ME));
  assert.deepEqual(groups.map(g => g.name), ['Not assigned yet', 'Alex', 'Jo']);
  assert.deepEqual(groups[0].jobs.map(j => j.propertyName), ['A', 'D']);
  assert.deepEqual(groups[2].jobs.map(j => j.propertyName), ['A', 'B'], 'each cleaner in work order');
});

test('the clean checklist counter and why Submit is not ready yet', () => {
  const checklist = ['Kitchen', 'Bathroom', 'Hot tub', 'Bins'];
  const rules = [{ label: 'Hot tub', minPhotos: 2 }, { label: 'Bins', minPhotos: 1 }, { label: 'Not on this clean', minPhotos: 3 }];
  let progress = checklistProgress(checklist, ['Kitchen'], rules, { 'Hot tub': 1 });
  assert.equal(progressCounter(progress), '1 of 4 done · 2 photos needed');
  assert.deepEqual(progress.missing, [{ label: 'Hot tub', missing: 1 }, { label: 'Bins', missing: 1 }]);
  assert.deepEqual(submitBlockers(progress, { report: '', savedPhotos: 1, uploading: true }), ['Tick 3 more checks.', 'Add the photos for Hot tub and Bins.', 'Write a short report.', 'Wait for your photos to upload. They go by themselves when there is signal.']);
  progress = checklistProgress(checklist, checklist, rules, { 'Hot tub': 2, Bins: 1 });
  assert.equal(progressCounter(progress), '4 of 4 done');
  assert.deepEqual(submitBlockers(progress, { report: 'All done and checked', savedPhotos: 3, uploading: false }), []);
  // Without photo rules nothing changes: every tick, a photo and a report.
  progress = checklistProgress(checklist, ['Kitchen', 'Bathroom', 'Hot tub'], [], {});
  assert.equal(progress.photosNeeded, 0);
  assert.deepEqual(submitBlockers(progress, { report: 'Cleaned', savedPhotos: 0, uploading: false }), ['Tick the last check: Bins.', 'Add at least one photo of the clean.']);
  assert.deepEqual(submitBlockers(checklistProgress(['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D'], [{ label: 'A', minPhotos: 1 }, { label: 'B', minPhotos: 1 }, { label: 'C', minPhotos: 1 }, { label: 'D', minPhotos: 1 }], {}), { report: 'Done well', savedPhotos: 1, uploading: false }),
    ['Add the photos for A, B and 2 more checks.']);
  // A property's own checklist wins over the one for every property.
  const all = { propertyId: null, propertyName: null, items: [], version: 1, updatedAt: '' }, own = { ...all, propertyId: 'p1' };
  assert.equal(templateFor([all, own], 'p1'), own);
  assert.equal(templateFor([all, own], 'p2'), all);
  assert.equal(templateFor([own], 'p2'), null);
});
