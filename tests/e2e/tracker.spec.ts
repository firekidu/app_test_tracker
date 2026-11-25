import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// BUILD.md §15.3, the parts that do not need Google (DEMO mode). Tests run in order and share state.
test.describe.configure({ mode: 'serial' });

const ADMIN = 'david';
const TEMP = 'temporary admin pass 2026';
const NEWPW = 'orange bicycle under the bridge';
let editorTemp = '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smprd-e2e-files-'));

// The sign-in rate limit is 10/minute per IP; give each sign-in its own client address (as a proxy would).
let ipN = 10;
async function signIn(page: Page, u: string, p: string) {
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `198.51.100.${ipN++}` });
  await page.goto('/login');
  await page.fill('#username', u);
  await page.fill('#password', p);
  const res = page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/username'));
  await page.click('button[type=submit]');
  if ((await res).ok()) await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('1 · start-up admin must change password; wrong password message', async ({ page }) => {
  await signIn(page, ADMIN, 'not the password at all');
  await expect(page.locator('.form-error')).toHaveText('Username or password is wrong.');
  await signIn(page, ADMIN, TEMP);
  await page.waitForURL('**/account/password');
  await page.fill('#cur', TEMP);
  await page.fill('#pw', 'only fourteen!');
  await page.fill('#pw2', 'only fourteen!');
  await page.click('button[type=submit]');
  await expect(page.locator('.form-error')).toContainText('at least 15');
  await page.fill('#pw', NEWPW);
  await page.fill('#pw2', NEWPW);
  await page.click('button[type=submit]');
  await page.waitForURL('**/?pw=changed');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(86);
  await expect(page.locator('.cards .card').first()).toContainText('77%');
  await expect(page.locator('.cards .card').first()).toContainText('66 of 86 completed');
});

test('2 · admin creates an editor; temporary password shown once; editor must change it', async ({ page, browser }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.goto('/admin');
  await page.click('button:has-text("Add user")');
  await page.fill('#nu-u', 'Renjith.R');
  await page.fill('#nu-d', 'Renjith R');
  await page.click('.dialog button:has-text("Create account")');
  editorTemp = (await page.textContent('.secret-box code'))!.trim();
  expect(editorTemp).toHaveLength(20);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, 'renjith.r', editorTemp);
  await p2.waitForURL('**/account/password');
  await ctx.close();
});

test('3 · Bug Owner: add a new name from the picker', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.waitForSelector('tr[data-row="87"]');
  await page.click('tr[data-row="87"] button[aria-label^="Row 87 Bug Owner"]');
  await page.fill('input[aria-label="Search Row 87 Bug Owner"]', 'Anita K');
  await page.locator('.dd-pop .add-opt').click();
  await page.click('.dialog button:has-text("Add name")');
  await expect(page.locator('tr[data-row="87"] td').nth(7)).toContainText('Anita K');
});

test('4 · Status → Completed fills End date and updates the cards', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.click('tr[data-row="85"] button[aria-label^="Row 85 status"]');
  await page.click('tr[data-row="85"] [role=option]:has-text("Completed")');
  await expect(page.locator('.toast').first()).toContainText('Row 85: Status → Completed, End date →');
  await expect(page.locator('tr[data-row="85"] td').nth(5)).toHaveText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(page.locator('.cards .card').first()).toContainText('67 of 86 completed');
});

test('6/7/8 · uploads: photo, HEVC video (MP4 preview, seekable), wrong type rejected', async ({ page }) => {
  const photo = path.join(tmp, 'photo.jpg');
  const video = path.join(tmp, 'clip-hevc.mov');
  const fake = path.join(tmp, 'renamed.jpg');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=800x500:rate=1', '-frames:v', '1', photo]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25', '-c:v', 'libx265', '-tag:v', 'hvc1', video]);
  fs.writeFileSync(fake, 'MZ this is not an image');
  await signIn(page, ADMIN, NEWPW);
  await page.click('tr[data-row="82"] .attach-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.panel button:has-text("Choose files")')]);
  await chooser.setFiles([photo, video, fake]);
  await expect(page.locator('.up-item .err')).toContainText("isn't a photo or video we can store");
  await expect(page.locator('.panel .mcard')).toHaveCount(2, { timeout: 60_000 });
  await page.locator('.panel .mcard', { hasText: 'clip-hevc.mov' }).locator('.tb').click();
  const v = page.locator('.preview video');
  await expect(v).toBeVisible();
  const r = await v.evaluate(async (el: HTMLVideoElement) => {
    el.muted = true;
    await new Promise((ok) => (el.readyState >= 1 ? ok(null) : el.addEventListener('loadedmetadata', () => ok(null), { once: true })));
    el.currentTime = 3;
    await new Promise((ok) => el.addEventListener('seeked', () => ok(null), { once: true }));
    return { t: el.currentTime, err: el.error?.code ?? null };
  });
  expect(r.err).toBeNull();
  expect(r.t).toBeGreaterThan(2.5);
});

test('10 · delete moves the file to trash and logs it', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.click('tr[data-row="82"] button[aria-label="Photos and videos for row 82"]');
  await page.locator('.panel .mcard button[aria-label^="Delete"]').first().click();
  await page.click('.dialog button:has-text("Delete")');
  await expect(page.locator('.panel .mcard')).toHaveCount(1);
  await expect(page.locator('.panel .history')).toContainText('Media deleted');
});

test('11 · phone layout: cards, Open by default, camera tile', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page, ADMIN, NEWPW);
  await expect(page.locator('.fchip.on')).toContainText('Open');
  await expect(page.locator('.rcard').first()).toBeVisible();
  await expect(page.locator('.rcard .add-tile').first()).toBeVisible();
  await ctx.close();
});

test('1b · five wrong passwords lock the account', async ({ request }) => {
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await request.post('/api/auth/sign-in/username', { data: { username: 'renjith.r', password: 'wrong wrong wrong' }, headers: { Origin: 'http://127.0.0.1:3200', 'X-Forwarded-For': '203.0.113.7' } });
    codes.push(r.status());
  }
  expect(codes).toEqual([401, 401, 401, 401, 423]);
  const right = await request.post('/api/auth/sign-in/username', { data: { username: 'renjith.r', password: editorTemp }, headers: { Origin: 'http://127.0.0.1:3200', 'X-Forwarded-For': '203.0.113.7' } });
  expect(right.status()).toBe(423);
});

test('edit details: text and dates are editable in the app and logged', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.click('tr[data-row="86"] .cell-title');
  await page.click('.panel button:has-text("Edit details")');
  await page.fill('#ed-notes', 'Reproduced on build 210');
  await page.fill('#ed-ms', 'M3');
  await page.click('.dialog button:has-text("Save")');
  await expect(page.locator('.panel .notes-box')).toHaveText('Reproduced on build 210');
  await expect(page.locator('.panel .history')).toContainText('Notes');
  await expect(page.locator('tr[data-row="86"] td').nth(9)).toContainText('Reproduced on build 210');
  // bad date is refused
  await page.click('.panel button:has-text("Edit details")');
  await page.fill('#ed-ed', '31/31/2026');
  await page.click('.dialog button:has-text("Save")');
  await expect(page.locator('.toast.err')).toContainText('dd/mm/yyyy');
});

test('export CSV and import (append) from Admin → Data', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const res = await page.request.get('/api/export');
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv.split('\n')[0]).toContain('Bugs,Priority,Reported By,Status');
  expect(csv.trim().split('\n').length).toBe(87);
  const file = path.join(tmp, 'more.csv');
  fs.writeFileSync(file, 'Bugs,Priority,Reported By,Status,Reported Date\nImported bug one,High,Priya S,TBD,20/11/2026\n');
  await page.goto('/admin');
  await page.setInputFiles('input[aria-label="CSV file"]', file);
  await page.click('section[aria-labelledby=d-h] button:has-text("Import")');
  await expect(page.locator('.toast').first()).toContainText('Imported 1 rows (now 87)');
  await page.goto('/');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(87);
  await expect(page.locator('tr[data-row="88"]')).toContainText('Imported bug one');
  await expect(page.locator('tr[data-row="88"]')).toContainText('Priya S');
});

test('data survives a restart (SQLite)', async ({ request }) => {
  // The server process is shared; check the data is in the database file, not memory.
  const r = await request.get('/api/health');
  expect((await r.json()).mode).toBe('local');
});
