import { z } from 'zod';

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const int = (d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const schema = z.object({
  APP_URL: z.string().default('http://localhost:3000'),
  BETTER_AUTH_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  ENCRYPTION_KEY: z.string().default(''),
  INITIAL_ADMIN_USERNAME: z.string().default('admin'),
  INITIAL_ADMIN_PASSWORD: z.string().default(''),
  PASSWORD_MIN_LENGTH: int(15).transform((n) => Math.max(15, n)),
  PWNED_CHECK: bool(false),
  LOCKOUT_ATTEMPTS: int(5),
  LOCKOUT_MINUTES: int(15),
  SESSION_IDLE_HOURS: int(12),
  SESSION_MAX_DAYS: int(7),
  SHEET_ID: z.string().default('16InGEU5x475zzJUBS0Emzsexneca9d3NwP3rT4lNcsY'),
  SHEET_TAB: z.string().default('Sheet1'),
  CHANGELOG_TAB: z.string().default('Change log'),
  PEOPLE_TAB: z.string().default('People'),
  DRIVE_ROOT_FOLDER_NAME: z.string().default('SMPRD Media'),
  OPEN_STATUSES: z.string().default('In progress,Feature is Coming soon,TBD'),
  STALL_DAYS: int(14),
  SYNC_SECONDS: int(30),
  MAX_UPLOAD_MB: int(100),
  AUTO_END_DATE: bool(true),
  TZ: z.string().default('Europe/London'),
  DATA_DIR: z.string().default('./.data'),
  /** Where rows and media live. "local" (default): SQLite + server disk, no Google. "google": Google Sheets + Drive. */
  DATA_SOURCE: z.enum(['local', 'google']).default('local'),
  /** Local mode: import this CSV (Sheet1 export) on first start when there are no rows yet. */
  SEED_CSV: z.string().default(''),
  /** Local mode: load a small sample data set (rows + a few photos/videos) when the tracker is empty. */
  SAMPLE_DATA: bool(true),
  /** Development / demo only: use an in-memory sheet seeded from this CSV and a local-disk "Drive". */
  DEMO_SHEET_CSV: z.string().default(''),
});

export type AppConfig = ReturnType<typeof loadConfig>;

function loadConfig() {
  const env = schema.parse(process.env);
  return {
    ...env,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL || env.APP_URL,
    openStatuses: env.OPEN_STATUSES.split(',').map((s) => s.trim()).filter(Boolean),
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    demo: env.DEMO_SHEET_CSV !== '',
    /** True when Google is not used at all (local database or demo). */
    standalone: env.DEMO_SHEET_CSV !== '' || env.DATA_SOURCE === 'local',
    mode: (env.DEMO_SHEET_CSV !== '' ? 'demo' : env.DATA_SOURCE) as 'demo' | 'local' | 'google',
  };
}

const g = globalThis as unknown as { __smprdConfig?: AppConfig };
export function config(): AppConfig {
  if (!g.__smprdConfig) g.__smprdConfig = loadConfig();
  return g.__smprdConfig;
}
