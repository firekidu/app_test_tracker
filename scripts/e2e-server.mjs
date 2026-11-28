// Starts the standalone build for the Playwright suite (copies static files next to server.js first).
// It runs from a copy OUTSIDE the project folder, like the Docker image: otherwise Node would find
// packages missing from the standalone output in the project's node_modules and the tests would pass.
import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

if (!existsSync('.next/standalone/server.js')) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
const dir = mkdtempSync(path.join(os.tmpdir(), 'smprd-standalone-'));
cpSync('.next/standalone', dir, { recursive: true, verbatimSymlinks: true });
cpSync('.next/static', path.join(dir, '.next/static'), { recursive: true });
cpSync('public', path.join(dir, 'public'), { recursive: true });
const p = spawn(process.execPath, ['server.js'], { cwd: dir, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
p.on('exit', (c) => process.exit(c ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => p.kill(s));
