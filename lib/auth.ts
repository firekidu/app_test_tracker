import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { nextCookies } from 'better-auth/next-js';
import { admin, username } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { config } from './config';
import { db } from './db';

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const normalizeUsername = (u: string) => String(u ?? '').trim().toLowerCase();

const ac = createAccessControl(defaultStatements);
const roles = {
  admin: ac.newRole(adminAc.statements),
  editor: ac.newRole(userAc.statements),
  viewer: ac.newRole(userAc.statements),
};

function createAuth() {
  const c = config();
  return betterAuth({
    appName: 'SMPRD Tracker',
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET || 'dev-only-secret-change-me-dev-only-secret',
    database: db(),
    trustedOrigins: [new URL(c.APP_URL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: Math.max(15, c.PASSWORD_MIN_LENGTH),
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      // Sliding idle timeout; the absolute maximum (SESSION_MAX_DAYS) is enforced in lib/session.ts.
      expiresIn: c.SESSION_IDLE_HOURS * 3600,
      updateAge: 5 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production',
      storage: 'memory',
      window: 60,
      max: 300,
      customRules: { '/sign-in/username': { window: 60, max: 10 } },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
      useSecureCookies: c.APP_URL.startsWith('https://'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    user: {
      additionalFields: {
        personName: { type: 'string', required: false, input: false, fieldName: 'person_name' },
        mustChangePassword: { type: 'boolean', required: false, input: false, defaultValue: true, fieldName: 'must_change_password' },
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameValidator: (u) => /^[a-zA-Z0-9._-]+$/.test(u),
      }),
      admin({
        ac,
        roles,
        defaultRole: 'viewer',
        adminRoles: ['admin'],
        bannedUserMessage: 'This account is disabled. Ask the admin.',
      }),
      nextCookies(),
    ],
    telemetry: { enabled: false },
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __smprdAuth?: Auth; __smprdAuthReady?: Promise<void> };

export function auth(): Auth {
  if (!g.__smprdAuth) g.__smprdAuth = createAuth();
  return g.__smprdAuth;
}

/** Creates/updates Better Auth tables and the first admin. Safe to call many times. */
export function authReady(): Promise<void> {
  if (!g.__smprdAuthReady) {
    g.__smprdAuthReady = (async () => {
      const a = auth();
      const { runMigrations } = await getMigrations(a.options);
      await runMigrations();
      await bootstrapFirstAdmin();
    })().catch((e) => {
      g.__smprdAuthReady = undefined;
      throw e;
    });
  }
  return g.__smprdAuthReady;
}

export async function createAccount(input: {
  username: string;
  displayName: string;
  personName: string;
  role: 'admin' | 'editor' | 'viewer';
  password: string;
  email?: string;
  mustChangePassword?: boolean;
}) {
  const ctx = await auth().$context;
  const u = normalizeUsername(input.username);
  const user = await ctx.internalAdapter.createUser({
    email: (input.email || `${u}@users.invalid`).toLowerCase(),
    name: input.displayName,
    emailVerified: true,
    username: u,
    displayUsername: u,
    role: input.role,
    personName: input.personName,
    mustChangePassword: input.mustChangePassword ?? true,
  }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return user;
}

export async function setPassword(userId: string, password: string, mustChange: boolean) {
  const ctx = await auth().$context;
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
  await ctx.internalAdapter.updateUser(userId, { mustChangePassword: mustChange });
}

export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const ctx = await auth().$context;
  const acc = (await ctx.internalAdapter.findAccounts(userId)).find((a) => a.providerId === 'credential');
  if (!acc?.password) return false;
  return ctx.password.verify({ hash: acc.password, password });
}

export async function revokeAllSessions(userId: string) {
  const ctx = await auth().$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}

async function bootstrapFirstAdmin() {
  const c = config();
  const n = (db().prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n;
  if (n > 0) return;
  if (!c.INITIAL_ADMIN_PASSWORD) {
    console.warn('[auth] No users exist and INITIAL_ADMIN_PASSWORD is not set; nobody can sign in yet.');
    return;
  }
  const u = normalizeUsername(c.INITIAL_ADMIN_USERNAME);
  await createAccount({ username: u, displayName: u, personName: '', role: 'admin', password: c.INITIAL_ADMIN_PASSWORD, mustChangePassword: true });
  db()
    .prepare('INSERT INTO auth_events(at, username, event, by_username, ip) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), u, 'account_created', 'setup', null);
  console.log(`[auth] Created the first admin "${u}". Sign in and change the password, then remove INITIAL_ADMIN_PASSWORD.`);
}
