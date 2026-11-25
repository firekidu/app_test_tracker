import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { db, nowIso } from './db';
import { isoToUk, todayIso } from './dates';
import { enqueueUpload } from './media-jobs';
import { snapshot } from './sheet-store';
import { tempPath } from './uploads';

// A small, made-up data set so the cards, filters and statistics have something to show.
// Replace it with real rows via Admin → Data → Import CSV ("Replace all rows"), or Clear all rows.
const ROWS: [title: string, priority: string, reporter: string, status: string, ageDays: number, doneAfter: number | null, milestone: string, owner: string, deliverable: string, notes: string][] = [
  ['SAMPLE – Login button does not respond on Android 14', 'High', 'Priya S', 'Completed', 60, 3, 'M1', 'Alex M', 'App', 'Fixed in build 1.4.2'],
  ['SAMPLE – Checkout total ignores the discount code', 'High', 'Alex M', 'Completed', 55, 2, 'M1', 'Sam K', 'Web', ''],
  ['SAMPLE – Search returns no results for product codes', 'Medium', 'Sam K', 'Completed', 50, 6, 'M1', 'Priya S', 'Web', 'Index rebuilt'],
  ['SAMPLE – Profile photo upload rotates iPhone images', 'Medium', 'Priya S', 'Completed', 46, 4, 'M1', 'Alex M', 'App', ''],
  ['SAMPLE – Order history shows the wrong currency', 'Low', 'Alex M', 'Completed', 41, 9, 'M1', 'Sam K', 'Web', ''],
  ['SAMPLE – Seller onboarding pop-up overlaps the header', 'Medium', 'Sam K', 'Completed', 35, 5, 'M2', 'Priya S', 'Web', ''],
  ['SAMPLE – Push notification opens the wrong screen', 'High', 'Priya S', 'Completed', 30, 2, 'M2', 'Alex M', 'App', ''],
  ['SAMPLE – Wishlist already has a "Move to cart" option', 'Low', 'Alex M', 'Feature existing', 28, null, 'M2', 'Sam K', 'App', 'Shown in the item menu'],
  ['SAMPLE – Dark mode for the seller dashboard', 'Low', 'Sam K', 'Feature is Coming soon', 24, null, 'M3', 'Priya S', 'Web', 'Planned for next quarter'],
  ['SAMPLE – Export orders to Excel', 'Medium', 'Priya S', 'Feature is Coming soon', 20, null, 'M3', '', 'Web', ''],
  ['SAMPLE – Fax confirmation for orders', 'Low', 'Alex M', 'Feature not needed', 18, null, 'M2', '', 'Web', 'Agreed with the client'],
  ['SAMPLE – Share link opens the wrong product', 'Medium', 'Sam K', 'In progress', 40, null, 'M2', '', 'App', 'Repro attached'],
  ['SAMPLE – Try-on camera freezes after 30 seconds', 'High', 'Priya S', 'In progress', 9, null, 'M3', 'Alex M', 'App', ''],
  ['SAMPLE – Address form rejects UK postcodes with spaces', 'Medium', 'Alex M', 'In progress', 4, null, 'M3', 'Sam K', 'Web', ''],
  ['SAMPLE – Decide the wording for the refund e-mail', 'Low', 'Sam K', 'TBD', 2, null, 'M3', '', 'Web', ''],
];

const isoMinus = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

export function sampleGrid(tz: string): string[][] {
  const today = todayIso(tz);
  return [
    ['Bugs', 'Priority', 'Reported By', 'Status', 'Reported Date', 'End date', 'Milestone', 'Bug Owner', 'Deliverable', 'Notes'],
    ...ROWS.map(([title, pri, rep, st, age, done, ms, own, del, notes]) => [
      title, pri, rep, st, isoToUk(isoMinus(today, age)), done !== null ? isoToUk(isoMinus(today, age - done)) : '', ms, own, del, notes,
    ]),
  ];
}

const run = (cmd: string, args: string[]) => new Promise<void>((ok, bad) => execFile(cmd, args, (e) => (e ? bad(e) : ok())));

function svg(w: number, h: number, a: string, b: string, text: string) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="60" y="${h / 2}" font-family="sans-serif" font-size="64" font-weight="700" fill="#fff">${text}</text>
  <text x="60" y="${h / 2 + 70}" font-family="sans-serif" font-size="32" fill="#ffffffcc">Sample screenshot</text></svg>`);
}

/** Queue a few generated photos and one short video, using the normal upload pipeline. */
export async function queueSampleMedia() {
  const snap = await snapshot();
  const pick = (needle: string) => snap.rows.find((r) => r.title.includes(needle));
  const items: { row: ReturnType<typeof pick>; name: string; make: (out: string) => Promise<void>; mime: string }[] = [
    { row: pick('Search returns'), name: 'search-no-results.jpg', mime: 'image/jpeg', make: (o) => sharp(svg(1280, 800, '#1F4FD8', '#8D74E6', 'No results for SKU-1042')).jpeg({ quality: 85 }).toFile(o).then(() => undefined) },
    { row: pick('Try-on camera'), name: 'try-on-repro.mp4', mime: 'video/mp4', make: (o) => run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=6:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-f', 'mp4', o]) },
    { row: pick('Try-on camera'), name: 'try-on-freeze.jpg', mime: 'image/jpeg', make: (o) => sharp(svg(1080, 1350, '#0B6267', '#3BA3A8', 'Camera frozen')).jpeg({ quality: 85 }).toFile(o).then(() => undefined) },
    { row: pick('Checkout total'), name: 'checkout-discount.png', mime: 'image/png', make: (o) => sharp(svg(1280, 720, '#B42318', '#D9961E', 'Discount ignored')).png().toFile(o).then(() => undefined) },
  ];
  for (const it of items) {
    if (!it.row) continue;
    const id = crypto.randomUUID();
    try {
      await it.make(tempPath(id));
    } catch {
      continue; // e.g. ffmpeg missing in local dev
    }
    const size = (await fs.stat(tempPath(id))).size;
    const now = nowIso();
    db()
      .prepare(
        `INSERT INTO uploads(id, row_number, row_key, file_name, mime_type, size, chunk_size, chunks_total, chunks_received, status, uploader_username, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, '[0]', 'queued', 'sample', ?, ?)`,
      )
      .run(id, it.row.rowNumber, it.row.rowKey, it.name, it.mime, size, size, now, now);
    enqueueUpload(id, it.mime.startsWith('video/') ? 'video' : 'photo');
  }
}
