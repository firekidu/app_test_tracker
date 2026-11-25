# SMPRD Tracker

A web app for the **SMPRD ERROR LOG** Google Sheet. It shows the sheet in its own column format (A–J, plus a new **K "Media"**), adds **progress cards**, lets the team edit Status / Priority / Reported By / Bug Owner (written back to the sheet and logged), and attach, preview and play **photos and videos** on each row. Media is stored in Google Drive.

- **Next.js 16** (App Router, TypeScript), one container, Node 26
- **Better Auth** username + password sign-in (admin-created accounts, 15+ character passwords, lock-out, roles admin / editor / viewer)
- **SQLite** on a persistent volume (`/data`): accounts, sessions, upload state, media index, encrypted Google token
- **Google Sheets + Drive** via the admin's one-time "Connect Google" (OAuth, scopes `spreadsheets` + `drive.file`)
- **Chunked uploads** (4 MiB), HEIC → JPEG, HEVC/MOV → H.264 preview with ffmpeg, HTTP Range streaming
- Deployed to a VPS with **Docker Compose + Caddy** (automatic HTTPS), by **GitHub Actions**

## Run it locally

```bash
npm install
cp .env.example .env.local          # then edit values
npm run dev                         # http://localhost:3000
```

Without Google credentials you can try everything with the demo sheet:

```bash
DEMO_SHEET_CSV=tests/fixtures/sheet-2026-11-24.csv INITIAL_ADMIN_PASSWORD='a temporary password' npm run dev
```

Sign in as `admin` (or `INITIAL_ADMIN_USERNAME`) with that password; you'll be asked to choose a new one.

Checks: `npm run lint && npm test` (Vitest unit tests for mapping, stats, row identity, password policy, lock-out, names, upload maths).

## Deploy (GitHub Actions → VPS)

Every push to `main` (or the current working branch) runs lint, tests and a build, then deploys:

1. copies the code to the VPS over SSH;
2. installs Docker, adds swap and automatic security updates (first run only);
3. creates `/opt/smprd/.env` with random `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` (first run only, root-only file);
4. builds the image and starts `app` + `caddy` (`docker compose`), waits for `/api/health`;
5. Caddy gets a Let's Encrypt certificate for `APP_DOMAIN`.

### Repository secrets and variables (Settings → Secrets and variables → Actions)

| Name | Kind | Needed | What |
|---|---|---|---|
| `VPS_PASSWORD` | secret | yes (or `VPS_SSH_KEY`) | password of the VPS user (also used for `sudo` if it asks) |
| `VPS_SSH_KEY` | secret | alternative | a private key whose public key is in `~/.ssh/authorized_keys` on the VPS |
| `VPS_HOST` | secret/variable | no | server IP (default set in the workflow) |
| `VPS_USER` | secret/variable | no | default `ubuntu` |
| `ADMIN_PASSWORD` | secret | recommended | first admin's temporary password (first start only; must be changed at first sign-in). If missing, one is generated and saved on the server in `/opt/smprd/INITIAL_ADMIN_PASSWORD.txt` |
| `ADMIN_USERNAME` | variable | no | default `david` |
| `APP_DOMAIN` | variable | no | e.g. `tracker.yourdomain.co.uk` (DNS A record → VPS). Default: `<ip-with-dashes>.sslip.io` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | for Google | OAuth web client (redirect URI `https://APP_DOMAIN/api/admin/google/callback`) |
| `VPS_HOST_KEY` | secret | optional | pin the server's SSH host key (`ssh-keyscan <ip>` output) |

Then **Actions → Test and deploy → Run workflow**.

### First run

1. Open `https://APP_DOMAIN`, sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, choose your own password (15+ characters).
2. **Admin → Connect Google** (Google shows "unverified app" → Advanced → continue). Publish the OAuth app ("In production") or the token expires after 7 days.
3. **Admin → Setup checks**: fix K1 header, Change log tab, People tab, Drive folders.
4. **Admin → People**: merge duplicate spellings. **Admin → Users**: add the team (temporary passwords are shown once).

### Day-to-day on the server

```bash
cd /opt/smprd/src && sudo docker compose logs -f app       # logs
sudo nano /opt/smprd/.env && cd /opt/smprd/src && sudo docker compose up -d   # change settings
sudo docker exec -it smprd-app-1 node scripts/reset-admin.mjs david             # locked-out admin
```

Back up the `smprd_smprd-data` Docker volume (accounts, encrypted Google token) and keep `/opt/smprd/.env` in a password manager.
