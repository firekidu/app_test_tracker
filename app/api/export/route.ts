import { withUser } from '@/lib/api';
import { toCsv } from '@/lib/csv';
import { todayIso } from '@/lib/dates';
import { exportGrid } from '@/lib/sheet-store';

export const runtime = 'nodejs';

/** Download all rows as CSV (opens in Excel / Google Sheets). */
export async function GET(req: Request) {
  return withUser(req, 'viewer', async () => {
    const csv = '﻿' + toCsv(await exportGrid());
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="smprd-error-log-${todayIso()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
