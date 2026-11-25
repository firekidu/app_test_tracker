# SMPRD Tracker
The full specification is docs/BUILD.md (kept out of this public repo; ask David for it) and the approved visuals are in docs/design/.
Follow the stack, data model, API and Dockerfile in docs/BUILD.md exactly; ask before changing any of them.
Build ONE milestone at a time (section 14). At the end of each milestone:
run lint and tests, list what you built, list what David must check, and stop.
Never commit secrets. Keep .env.example up to date.

## Notes for this repository
- Deploys run from `.github/workflows/deploy.yml` (GitHub Actions → SSH → `deploy/remote-deploy.sh` → Docker Compose + Caddy on the VPS).
- `npm run lint && npm test` must pass; the workflow refuses to deploy otherwise.
- Local run without Google: set `DEMO_SHEET_CSV=tests/fixtures/sheet-2026-11-24.csv` (in-memory sheet + local-disk "Drive").
