import { actorOf, json, jsonError, withUser } from '@/lib/api';
import { config } from '@/lib/config';
import { parseCsv } from '@/lib/csv';
import { importRows } from '@/lib/sheet-store';

export const runtime = 'nodejs';

/** Import rows from a CSV export of the sheet. Body: the CSV text (text/csv). ?mode=replace|append */
export async function POST(req: Request) {
  return withUser(req, 'admin', async (u) => {
    if (!config().standalone) return jsonError(422, 'Import is only available in standalone mode.');
    const mode = new URL(req.url).searchParams.get('mode') === 'append' ? 'append' : 'replace';
    const text = await req.text();
    if (text.length > 10 * 1024 * 1024) return jsonError(413, 'The file is larger than 10 MB.');
    const r = await importRows(parseCsv(text.replace(/^﻿/, '')), mode, actorOf(u));
    return json(r);
  });
}
