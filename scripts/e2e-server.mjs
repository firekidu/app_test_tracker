// Starts the standalone build for the Playwright suite (copies static files next to server.js first).
import { cpSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

if (!existsSync('.next/standalone/server.js')) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
cpSync('public', '.next/standalone/public', { recursive: true });
const p = spawn(process.execPath, ['server.js'], { cwd: '.next/standalone', stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
p.on('exit', (c) => process.exit(c ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => p.kill(s));
