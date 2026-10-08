import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The property page: who sees which part, and how each part reads.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { profileAccess, setupAnswers, listingLinks, stayLines, maskAccount, ownerContacts } = await vite.ssrLoadModule('/lib/property-profile.ts');
after(() => vite.close());

const account = (role, modules) => ({ userId: '11111111-1111-4111-8111-111111111111', role, modules });

test('each part is offered only to the people the database allows', () => {
  const admin = profileAccess(account('admin', ['property-database', 'daily-pricing', 'owner-statements']));
  assert.deepEqual(admin, { owners: true, listings: true, stays: true, payout: true });
  assert.deepEqual(profileAccess(account('stays', ['property-database', 'daily-pricing'])), { owners: true, listings: true, stays: true, payout: false });
  assert.deepEqual(profileAccess(account('accounts', ['owner-statements'])), { owners: true, listings: false, stays: false, payout: false });
  assert.deepEqual(profileAccess(account('client', ['client-dashboard'])), { owners: false, listings: true, stays: false, payout: true });
  for (const role of ['ready', 'cleans', 'cleaning_manager']) assert.deepEqual(profileAccess(account(role, ['property-database', 'daily-pricing', 'owner-statements', 'client-dashboard'])), { owners: false, listings: false, stays: false, payout: false }, role);
  assert.equal(profileAccess(account('stays', [])).owners, false, 'Stays need the property database');
});

test('set-up answers read in plain words and skip what was not answered', () => {
  const answers = setupAnswers({ businessName: 'Test Owner Ltd', accessDate: '2026-11-02', utilitiesConnected: false, utilityInstallDate: '2026-10-20', broadbandConnected: true, broadbandInstallDate: '2026-10-01', hasGarden: true, mailPreference: 'open_and_photograph', repairLimitMinor: 15000, fullRepairPermission: false, furnishingChoice: 'recharge', licensingRequired: false, warrantyDetails: '', preferredRepairContact: 'Boiler: Test Heating 0131 000 0000' });
  const value = label => answers.find(a => a.label === label)?.value;
  assert.equal(value('Business or owner name'), 'Test Owner Ltd');
  assert.match(value('First access date'), /2 Nov/);
  assert.equal(value('Utilities connected'), 'No');
  assert.match(value('Utilities connection planned'), /20 Oct/);
  assert.equal(value('Broadband installation planned'), undefined, 'no plan needed once connected');
  assert.equal(value('Post'), 'Open and photograph the post');
  assert.equal(value('Repairs approved without asking, per job'), '£150.00');
  assert.equal(value('Furnishing'), 'Recharge furnishes');
  assert.equal(value('Licensing support'), 'No');
  assert.equal(value('Warranties'), undefined);
  assert.equal(value('Contact first for repairs'), 'Boiler: Test Heating 0131 000 0000');
  assert.equal(setupAnswers({ fullRepairPermission: true, repairLimitMinor: 100 }).find(a => a.group === 'repairs').value, 'Any amount');
  assert.deepEqual(setupAnswers(null), []);
});

test('set-up answers never show bank or access details, even if present', () => {
  const text = JSON.stringify(setupAnswers({ bankAccountNumber: '12345678', bankSortCode: '12-34-56', bankAccountName: 'Owner', accessInfo: 'Key safe 1234' }));
  for (const secret of ['12345678', '12-34-56', 'Key safe']) assert.ok(!text.includes(secret), secret);
});

test('listing links: HTTPS only, for the chosen property', () => {
  const data = { properties: [{ id: 'a', listingLinks: [{ platform: 'Airbnb', url: 'https://www.airbnb.co.uk/rooms/1' }, { platform: 'Bad', url: 'http://example.com' }, { platform: 'Broken', url: 'nope' }] }, { id: 'b', listingLinks: [{ platform: 'Direct', url: 'https://example.com' }] }] };
  assert.deepEqual(listingLinks(data, 'a'), [{ platform: 'Airbnb', url: 'https://www.airbnb.co.uk/rooms/1', listingId: '' }]);
  // A listing can be just its ID (for example in the channel manager); a bad ID is dropped.
  assert.deepEqual(listingLinks({ properties: [{ id: 'c', listingLinks: [{ platform: 'Channel manager', listingId: 'UPL-1' }, { platform: 'Vrbo', listingId: 'bad id!' }] }] }, 'c'), [{ platform: 'Channel manager', url: '', listingId: 'UPL-1' }]);
  assert.deepEqual(listingLinks(data, 'missing'), []);
  assert.deepEqual(listingLinks(null, 'a'), []);
});

test('stays: in house and upcoming first, then recent; cancelled left out', () => {
  const r = (id, check_in, check_out, status = 'confirmed') => ({ id, reference: 'REF-' + id, check_in, check_out, status, source: 'manual' });
  const lines = stayLines([r('past', '2026-09-01', '2026-09-04'), r('later', '2026-10-20', '2026-10-27'), r('now', '2026-10-06', '2026-10-10'), r('gone', '2026-10-12', '2026-10-14', 'cancelled'), r('older', '2026-08-01', '2026-08-02')], '2026-10-08');
  assert.deepEqual(lines.map(l => [l.id, l.when]), [['now', 'now'], ['later', 'upcoming'], ['past', 'past'], ['older', 'past']]);
  assert.equal(lines[1].nights, 7);
  assert.equal(lines[0].source, 'Added in Recharge');
  assert.equal(stayLines([r('a', '2026-10-08', '2026-10-09')], '2026-10-09')[0].when, 'past', 'checked out today');
});

test('account numbers show the last four digits only', () => {
  assert.equal(maskAccount('12345678'), '•••• 5678');
  assert.equal(maskAccount('123'), '123');
});

test('owner contacts leave the server as a name and an email only', () => {
  assert.deepEqual(ownerContacts([{ name: 'Test Owner', email: 'owner@example.com', phone: '07000', role: 'client' }, { name: 'No Email', email: null }, 'junk']), [{ name: 'Test Owner', email: 'owner@example.com' }, { name: 'No Email', email: '' }]);
  assert.deepEqual(ownerContacts(undefined), []);
});
