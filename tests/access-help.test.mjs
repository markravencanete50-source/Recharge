import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { defaultModulesForRole } = await vite.ssrLoadModule('/lib/modules.ts');
const { faqsForAccess } = await vite.ssrLoadModule('/lib/access-faq.ts');
const { activityAllowed, parseActivity, appendActivity, activityText, ACTIVITY_LIMIT } = await vite.ssrLoadModule('/lib/recent-activity.ts');
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'client'];

test('FAQ guidance follows actual grants and separates cleaner, manager and privileged access', () => {
  for (const role of roles) {
    const modules = defaultModulesForRole(role);
    const faqs = faqsForAccess(role, modules);
    assert(faqs.length > 2);
    assert(faqs.every(faq => !faq.moduleId || modules.includes(faq.moduleId)));
    assert.equal(new Set(faqs.map(faq => faq.id)).size, faqs.length);
    assert(faqsForAccess(role, []).every(faq => !faq.moduleId));
    if (!['admin', 'super_admin'].includes(role)) assert(!faqs.some(faq => faq.topic === 'Administration'));
  }
  const ids = role => faqsForAccess(role, defaultModulesForRole(role)).map(faq => faq.id);
  assert(ids('cleans').includes('clean-jobs'));
  assert(!ids('cleans').includes('manager-team'));
  assert(ids('cleaning_manager').includes('manager-team'));
  assert(!ids('cleaning_manager').includes('clean-jobs'));
  assert(ids('admin').includes('admin-access'));
  assert(!ids('admin').includes('owner-access'));
  assert(ids('super_admin').includes('owner-access'));
  assert(ids('client').includes('onboard-start'));
  assert(!ids('client').includes('stays-response'));
});

test('Alex guidance preserves response thresholds, connected onboarding and pending integrations', () => {
  const faqs = faqsForAccess('super_admin', defaultModulesForRole('super_admin'));
  const answer = id => faqs.find(faq => faq.id === id).answer;
  assert.match(answer('stays-response'), /five minutes.*amber after five minutes.*red after ten minutes/);
  assert.match(answer('ready-inspection'), /After settlement.*access dates/);
  assert.match(answer('onboard-progress'), /depends on.*connections being active/);
  assert.match(answer('stays-shifts'), /still need confirmation/);
});

test('stored activity rejects corrupt entries and retains minimal metadata only', () => {
  assert.deepEqual(parseActivity('invalid json'), []);
  assert.deepEqual(parseActivity('{"items":[]}'), []);
  const list = parseActivity(JSON.stringify([
    { id:'good', at:10000, action:'open_tool', moduleId:'property-database', address:'private', password:'secret' },
    { id:'bad-action', at:10000, action:'approve_payment' },
    { id:'bad-tool', at:10000, action:'open_tool', moduleId:'unknown' },
    { id:'bad-date', at:1e30, action:'update_profile' },
    { id:'negative-date', at:-1, action:'update_profile' },
    null,
  ]));
  assert.deepEqual(list, [{ id:'good', at:10000, action:'open_tool', moduleId:'property-database' }]);
  assert(!JSON.stringify(list).includes('secret'));
});

test('history filters revoked tools and exports while avoiding claims of completed work', () => {
  const tool = { id:'1', at:10000, action:'open_tool', moduleId:'property-database' };
  assert(activityAllowed(tool, 'admin', ['property-database']));
  assert(!activityAllowed(tool, 'admin', []));
  const exported = { id:'2', at:11000, action:'export_report' };
  for (const role of roles) assert.equal(activityAllowed(exported, role, []), ['admin','super_admin'].includes(role));
  assert.equal(activityText(tool, 'Property Management Database'), 'Opened Property Management Database');
  assert.equal(activityText({ ...tool, action:'view_record' }, 'Clean Calendar'), 'Viewed a record in Clean Calendar');
});

test('activity caps storage, orders newest first and suppresses accidental double taps', () => {
  const events = Array.from({ length:75 }, (_, i) => ({ id:String(i), at:10000+i*3000, action:'update_profile' }));
  const parsed = parseActivity(JSON.stringify(events));
  assert.equal(parsed.length, ACTIVITY_LIMIT);
  assert.equal(parsed[0].id, '74');
  const duplicate = { ...parsed[0], id:'duplicate', at:parsed[0].at+1000 };
  assert.deepEqual(appendActivity(parsed, duplicate), parsed);
  const next = { ...duplicate, at:parsed[0].at+3000 };
  assert.equal(appendActivity(parsed, next).length, ACTIVITY_LIMIT);
  assert.equal(appendActivity(parsed, next)[0].id, 'duplicate');
});
