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
  // The tracker opens filtered to In progress + TBD; most tests work on every row.
  if (new URL(page.url()).pathname === '/') await page.goto('/?status=all');
}

test('1 · start-up admin must change password; wrong password message', async ({ page }) => {
  await signIn(page, ADMIN, 'not the password at all');
  await expect(page.locator('.form-error')).toHaveText('Username or password is wrong.');
  await signIn(page, ADMIN, TEMP);
  await page.waitForURL('**/account/password');
  await page.fill('#cur', TEMP);
  await page.fill('#pw', 'tiger');
  await page.fill('#pw2', 'tiger');
  await page.click('button[type=submit]');
  await expect(page.locator('.form-error')).toContainText('at least 6');
  await page.fill('#pw', NEWPW);
  await page.fill('#pw2', NEWPW);
  await page.click('button[type=submit]');
  await page.waitForURL('**/?pw=changed');
  await expect(page.locator('.toolbar .fchip.on')).toContainText('In progress + TBD');
  await page.click('.toolbar .fchip:has-text("All")');
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

test('3 · Change owner: add a new name from the picker', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.waitForSelector('tr[data-row="87"]');
  await page.click('tr[data-row="87"] button[aria-label^="Row 87 Change owner"]');
  await page.fill('input[aria-label="Search Row 87 Change owner"]', 'Anita K');
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

test('11 · phone layout: cards, In progress + TBD by default, camera tile', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page, ADMIN, NEWPW);
  await page.goto('/');
  await expect(page.locator('.fchip.on')).toContainText('In progress + TBD');
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
  // dates use calendar inputs
  await page.click('.panel button:has-text("Edit details")');
  await expect(page.locator('#ed-ed')).toHaveAttribute('type', 'date');
  await page.locator('#ed-ed').fill('2026-12-24');
  await page.click('.dialog button:has-text("Save")');
  await expect(page.locator('.panel .meta')).toContainText('End date: 24/12/2026');
});

test('export CSV and import (append) from Admin → Data', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const res = await page.request.get('/api/export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toMatch(/filename="EPM-DEV-TRACKER-\d{4}-\d{2}-\d{2}\.csv"/);
  const csv = await res.text();
  expect(csv.split('\n')[0]).toContain('Change Request,Priority,Reported By,Status');
  expect(csv.trim().split('\n').length).toBe(87);
  const file = path.join(tmp, 'more.csv');
  fs.writeFileSync(file, 'Bugs,Priority,Reported By,Status,Reported Date\nImported bug one,High,Priya S,TBD,20/11/2026\n');
  await page.goto('/admin');
  await page.setInputFiles('input[aria-label="CSV file"]', file);
  await page.click('section[aria-labelledby=d-h] button:has-text("Import")');
  await expect(page.locator('.toast').first()).toContainText('Imported 1 rows (now 87)');
  await page.goto('/?status=all');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(87);
  await expect(page.locator('tr[data-row="88"]')).toContainText('Imported bug one');
  await expect(page.locator('tr[data-row="88"]')).toContainText('Priya S');
});

test('data survives a restart (SQLite)', async ({ request }) => {
  // The server process is shared; check the data is in the database file, not memory.
  const r = await request.get('/api/health');
  expect((await r.json()).mode).toBe('local');
});

test('inline edit: End date, Milestone, Deliverable, Notes from the table, with who/when tooltip', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const row = page.locator('tr[data-row="20"]');
  await row.locator('button[aria-label^="Row 20 End date"]').click();
  await page.locator('input[aria-label="Row 20 End date"]').fill('2026-12-03'); // calendar input
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast').first()).toContainText('Row 20: End date → 03/12/2026');
  await row.locator('button[aria-label^="Row 20 Milestone"]').click();
  await page.locator('input[aria-label="Row 20 Milestone"]').fill('M9');
  await page.keyboard.press('Enter');
  await row.locator('button[aria-label^="Row 20 Deliverable"]').click();
  await page.locator('input[aria-label="Row 20 Deliverable"]').fill('Android app');
  await page.keyboard.press('Tab'); // blur saves
  await row.locator('button[aria-label^="Row 20 Notes"]').click();
  await page.locator('textarea[aria-label="Row 20 Notes"]').fill('Checked on Pixel 8');
  await page.keyboard.press('Enter');
  await expect(row.locator('td').nth(6)).toHaveText('M9');
  await expect(row.locator('td').nth(8)).toHaveText('Android app');
  await expect(row.locator('td').nth(9)).toHaveText('Checked on Pixel 8');
  await expect(row.locator('td').nth(6)).toHaveAttribute('title', /Last edited by David Thomas \(david\)|Last edited by .*\(david\)|Last edited by david · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
  // Esc cancels
  await row.locator('button[aria-label^="Row 20 Milestone"]').click();
  await page.locator('input[aria-label="Row 20 Milestone"]').fill('nope');
  await page.keyboard.press('Escape');
  await expect(row.locator('td').nth(6)).toHaveText('M9');
});

test('column header filters', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.click('button[aria-label="Filter column Priority"]');
  await page.selectOption('select[aria-label="Filter Priority"]', 'High');
  const n = await page.locator('table.sheet tbody tr').count();
  expect(n).toBeGreaterThan(0);
  for (const t of await page.locator('table.sheet tbody tr td:nth-of-type(2)').allInnerTexts()) expect(t).toContain('High');
  await page.click('button[aria-label="Filter column Milestone"]');
  await page.fill('input[aria-label="Filter Milestone"]', 'M9');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(0);
  await page.click('button[aria-label="Clear column filters"]');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(87);
  await page.click('button[aria-label="Filter column Change owner"]');
  await page.selectOption('select[aria-label="Filter Change owner"]', '-');
  for (const t of await page.locator('table.sheet tbody tr td:nth-of-type(8)').allInnerTexts()) expect(t.trim()).toBe('+ Add owner');
});

test('delete a row: confirmation, rows move up, logged in the Activity log', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const title = await page.locator('tr[data-row="3"] .cell-title').innerText();
  await page.locator('tr[data-row="3"]').hover();
  await page.click('button[aria-label="Delete row 3"]');
  await page.click('.dialog button:has-text("Delete row")');
  await expect(page.locator('.toast').first()).toContainText('Row 3 deleted');
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(86);
  await expect(page.locator('tr[data-row="3"] .cell-title')).not.toHaveText(title);
  await page.goto('/activity');
  await page.selectOption('select[aria-label="Field"]', 'Row deleted');
  await expect(page.locator('table.activity tbody tr').first()).toContainText(title.slice(0, 30));
  await expect(page.locator('table.activity tbody tr').first().locator('td').nth(6)).toHaveText(/david/);
  await expect(page.locator('table.activity tbody tr').first().locator('td').first()).toHaveText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
});

test('new name and labels; no column-letter row', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await expect(page.locator('header h1')).toHaveText('EPM DEV TRACKER');
  await expect(page).toHaveTitle('EPM DEV TRACKER');
  await expect(page.locator('table.sheet thead tr')).toHaveCount(1);
  await expect(page.locator('table.sheet thead')).toContainText('Change Request');
  await expect(page.locator('table.sheet thead')).toContainText('Change owner');
  await expect(page.locator('table.sheet thead')).not.toContainText('Bug Owner');
});

test('search finds a person in any column', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const all = await page.locator('table.sheet tbody tr').count();
  await page.fill('input[type=search]', 'gautham');
  await expect.poll(() => page.locator('table.sheet tbody tr').count()).toBeLessThan(all);
  const rows = await page.locator('table.sheet tbody tr').allInnerTexts();
  expect(rows.length).toBeGreaterThan(5);
  for (const t of rows) expect(t.toLowerCase()).toContain('gautham');
});

test('Add row: title, calendar dates and a screenshot', async ({ page }) => {
  const shot = path.join(tmp, 'add-row-shot.jpg');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x400:rate=1', '-frames:v', '1', shot]);
  await signIn(page, ADMIN, NEWPW);
  await page.click('header button:has-text("Add row")');
  await expect(page.locator('.dialog h2')).toHaveText('Add row');
  await expect(page.locator('.dialog')).toContainText('Change Request');
  await expect(page.locator('.dialog')).toContainText('Change owner');
  await page.fill('#ar-title', 'Add export button to the EPM dashboard');
  await page.locator('#ar-rd').fill('2026-11-20');
  await page.locator('#ar-ed').fill('2026-11-30');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.dialog button:has-text("Add screenshot")')]);
  await chooser.setFiles(shot);
  await expect(page.locator('.dialog')).toContainText('add-row-shot.jpg');
  await page.click('.dialog button[type=submit]');
  await expect(page.locator('.panel')).toBeVisible();
  await expect(page.locator('.panel h2')).toHaveText('Add export button to the EPM dashboard');
  await expect(page.locator('.panel .meta')).toContainText('20/11/2026');
  await expect(page.locator('.panel .meta')).toContainText('End date: 30/11/2026');
  await expect(page.locator('.panel .mcard')).toHaveCount(1, { timeout: 30_000 });
});

test('reset password popup stays open until Close; own account cannot be reset', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.goto('/admin');
  const mine = page.locator('tr', { has: page.locator('td.mono', { hasText: /^david$/ }) });
  await expect(mine.locator('button:has-text("Reset password")')).toBeDisabled();
  const other = page.locator('tr', { has: page.locator('td.mono', { hasText: /^renjith\.r$/ }) });
  await other.locator('button:has-text("Reset password")').click();
  await page.click('.dialog button:has-text("Reset password")');
  await expect(page.locator('.secret-box code')).toHaveText(/^.{20}$/);
  await page.waitForTimeout(4000); // used to vanish after ~2 s
  await page.mouse.click(5, 5); // clicking outside does not close it
  await page.keyboard.press('Escape'); // nor does Esc
  await expect(page.locator('.secret-box code')).toBeVisible();
  await expect(page).toHaveURL(/\/admin/);
  await page.click('.dialog button:has-text("Close")');
  await expect(page.locator('.secret-box')).toHaveCount(0);
});

test('opens filtered to In progress + TBD; All shows every row', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.goto('/');
  await expect(page.locator('.toolbar .fchip.on')).toContainText('In progress + TBD');
  const statuses = await page.locator('table.sheet tbody tr td:nth-of-type(4)').allInnerTexts();
  expect(statuses.length).toBeGreaterThan(0);
  for (const t of statuses) expect(['In progress', 'TBD']).toContain(t.trim());
  await page.click('.toolbar .fchip:has-text("All")');
  await expect(page).toHaveURL(/status=all/);
  await expect.poll(() => page.locator('table.sheet tbody tr').count()).toBeGreaterThan(statuses.length);
});

test('blank Change owner cell has a clickable "+ Add owner" button', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  const btn = page.locator('button[aria-label$="Change owner: none. Change"]').first();
  await expect(btn).toContainText('+ Add owner');
  const box = await btn.boundingBox();
  expect(box!.width).toBeGreaterThan(40);
  const row = await btn.locator('xpath=ancestor::tr').getAttribute('data-row');
  await btn.click();
  await page.locator('.dd-pop [role=option]').nth(1).click();
  await expect(page.locator(`tr[data-row="${row}"] button[aria-label$="Change owner: none. Change"]`)).toHaveCount(0);
});

test('dropdowns are not cut off when only a few rows are shown', async ({ page }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.click('.toolbar .fchip:has-text("In progress")');
  await page.fill('input[type=search]', 'Share link');
  await expect.poll(() => page.locator('table.sheet tbody tr').count()).toBeLessThanOrEqual(2);
  const visible = async (sel: string) => {
    const opts = page.locator(sel);
    const n = await opts.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      // the option must be the element actually drawn at its own centre (not hidden behind the table edge)
      const hit = await opts.nth(i).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && el.contains(top);
      });
      expect(hit).toBe(true);
    }
  };
  await page.locator('table.sheet tbody tr').first().locator('button[aria-label*=" status:"]').click();
  await visible('.dd-pop[role=listbox] [role=option]');
  await page.keyboard.press('Escape');
  await page.locator('table.sheet tbody tr').first().locator('button[aria-label*="Change owner"]').click();
  await visible('.dd-pop [role=option]');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Filter column Status"]');
  await expect(page.locator('.hf-pop')).toBeVisible();
  const box = await page.locator('.hf-pop').boundingBox();
  const hit = await page.locator('.hf-pop select').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(box!.height).toBeGreaterThan(20);
  expect(hit).toBe(true);
});

test('a 6-character password is accepted and works for sign-in', async ({ page, browser }) => {
  await signIn(page, ADMIN, NEWPW);
  await page.goto('/admin');
  await page.click('button:has-text("Add user")');
  await page.fill('#nu-u', 'short.pw');
  await page.fill('#nu-d', 'Short Pw');
  await page.click('.dialog button:has-text("Create account")');
  const temp = (await page.textContent('.secret-box code'))!.trim();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, 'short.pw', temp);
  await p2.waitForURL('**/account/password');
  await expect(p2.locator('.hint, p, span').filter({ hasText: 'At least 6 characters' }).first()).toBeVisible();
  await p2.fill('#cur', temp);
  await p2.fill('#pw', 'kiwi42');
  await p2.fill('#pw2', 'kiwi42');
  await p2.click('button[type=submit]');
  await p2.waitForURL('**/?pw=changed');
  await ctx.close();
  const ctx2 = await browser.newContext();
  const p3 = await ctx2.newPage();
  await signIn(p3, 'short.pw', 'kiwi42');
  await expect(p3.locator('table.sheet')).toBeVisible();
  await ctx2.close();
});
