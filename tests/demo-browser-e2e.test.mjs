import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, createReadStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// The interactive demo in a real browser: a super admin switches Demo on, the demo backend opens in the
// browser, and from then on not one request reaches /api, reads or saves alike. "Live" here is a stand-in
// that answers the signed-in account and records every /api request it gets.
//
// Needs the built web app with its demo files (npm run build: dist/client/workspace, or DEMO_WEB_DIR)
// and Playwright (installed globally in the dev container; PLAYWRIGHT_MODULE points elsewhere).
const WEB = path.resolve(process.env.DEMO_WEB_DIR ?? 'dist/client/workspace');
function playwright() {
  for (const from of [process.env.PLAYWRIGHT_MODULE, process.cwd()]) {
    try { return createRequire(path.join(from ?? '', 'x.js'))('playwright'); } catch { /* next */ }
  }
  try { return createRequire(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'x.js'))('playwright'); } catch { return null; }
}
const pw = existsSync(path.join(WEB, 'demo/manifest.json')) ? playwright() : null;
const skip = !pw ? 'needs the built web app (npm run build) and Playwright' : false;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

test('in Demo, nothing is sent to the live API, and every flow runs in the browser', { skip, timeout: 240_000 }, async () => {
  const recording = JSON.parse(readFileSync('mobile/web-static/demo-data.json', 'utf8'));
  const liveAccount = { ...recording.personas.super_admin.account, fullName: 'Live Admin', email: 'live.admin@recharge.example' };
  const apiCalls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      apiCalls.push(`${req.method} ${url.pathname}${url.search}`);
      res.writeHead(url.pathname === '/api/workspace/account' ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(url.pathname === '/api/workspace/account' ? { account: liveAccount } : { error: 'Live is not part of this test' }));
    }
    if (!url.pathname.startsWith('/workspace')) { res.writeHead(404); return res.end(); }
    let file = path.join(WEB, decodeURIComponent(url.pathname.replace(/^\/workspace\/?/, '')));
    if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) file = path.join(WEB, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => { try { localStorage.setItem('rc-welcomed', new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())); } catch { /* no storage */ } });
    const external = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.origin !== origin && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data')) external.push(request.url()); });
    const demoFiles = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/workspace/demo/')) demoFiles.push(request.url()); });
    await page.goto(origin + '/workspace/live');
    await page.getByRole('radio', { name: /Demo mode/ }).waitFor();
    await page.waitForTimeout(2000);
    assert.deepEqual(demoFiles, [], 'Live loads none of the demo files');
    await page.getByRole('radio', { name: /Demo mode/ }).click();
    const switched = Date.now(), before = apiCalls.length;
    // The interactive demo's controls are in one menu by the banner.
    const menu = page.getByRole('button', { name: 'Demo options' });
    await menu.waitFor({ timeout: 120_000 });
    await menu.click();
    await page.getByRole('menuitem', { name: 'Reset demo' }).waitFor({ timeout: 120_000 });
    await menu.click();
    const opened = Date.now() - switched;
    // A write through the real database function: a management decision on a contested clean.
    // (Home is still filling in as the demo's reads come back, so the card can move under the click.)
    const decision = page.getByRole('button', { name: 'Uphold the rejection' });
    for (let tries = 0; tries < 5 && !(await decision.isVisible()); tries++) {
      await page.getByRole('button', { name: 'Uphold' }).first().click().catch(() => undefined);
      await decision.waitFor({ timeout: 4000 }).catch(() => undefined);
    }
    await decision.click();
    await page.getByPlaceholder('What you checked and why').fill('Checked the photos with the cleaner.');
    await page.getByRole('button', { name: 'Record decision' }).click();
    await page.getByText('Rejected clean').waitFor({ state: 'hidden', timeout: 20_000 });
    // The scheduled sweeps, on demand.
    await menu.click();
    await page.getByRole('menuitem', { name: /Run today.s automatic jobs/ }).click();
    await page.getByText(/Today.s automatic jobs ran/).waitFor({ timeout: 60_000 });
    // Viewing as a cleaner signs in as the sample cleaner, still in the browser.
    await menu.click();
    await page.getByRole('menuitem', { name: 'View as someone' }).click();
    // People are one picker (round 6, Session D), listed as "Name · Role" (a search box appears only for a long list).
    await page.getByText('Ewan Stewart · Cleaner').first().click();
    await page.getByText(/viewing as Ewan Stewart/).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    assert.deepEqual(apiCalls.slice(before), [], 'no /api request while Demo is on');
    assert.deepEqual(external.filter(u => !u.includes('postcodes.io') && !u.includes('fonts.')), [], 'nothing else left the browser');
    console.log(`# demo opened in ${opened} ms`);
  } finally {
    await browser.close();
    server.close();
  }
});
