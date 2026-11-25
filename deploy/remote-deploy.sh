#!/usr/bin/env bash
# Runs ON the VPS (Ubuntu 24.04), started by .github/workflows/deploy.yml.
# Idempotent: safe to run on every deploy.
#
# Inputs (from /tmp/smprd-deploy.env, written by the workflow and deleted here):
#   APP_DOMAIN, VPS_IP, ADMIN_USERNAME, ADMIN_PASSWORD (optional), GOOGLE_CLIENT_ID (optional),
#   GOOGLE_CLIENT_SECRET (optional), SUDO_PASSWORD (optional, only if sudo needs a password)
# Code: /tmp/smprd-src.tgz
set -euo pipefail

ENV_IN=/tmp/smprd-deploy.env
SRC_TGZ=/tmp/smprd-src.tgz
BASE=/opt/smprd

if [ -f "$ENV_IN" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_IN"; set +a
  rm -f "$ENV_IN"
fi

as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif sudo -n true 2>/dev/null; then sudo "$@"
  elif [ -n "${SUDO_PASSWORD:-}" ]; then printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@"
  else echo "ERROR: sudo needs a password; add the VPS_PASSWORD secret." >&2; exit 1
  fi
}

log() { printf '\n==> %s\n' "$*"; }

log "Server: $(hostname) · $(. /etc/os-release && echo "$PRETTY_NAME") · $(nproc) CPU · $(free -m | awk '/Mem:/{print $2}') MB RAM"

# ---------- 1. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  as_root apt-get update -y
  as_root apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  as_root sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi
as_root systemctl enable --now docker >/dev/null 2>&1 || true
DOCKER="as_root docker"

# ---------- 2. Swap (builds and ffmpeg need headroom) ----------
if [ "$(swapon --show --noheadings | wc -l)" = 0 ]; then
  log "Adding 4 GB swap"
  as_root fallocate -l 4G /swapfile || as_root dd if=/dev/zero of=/swapfile bs=1M count=4096
  as_root chmod 600 /swapfile
  as_root mkswap /swapfile >/dev/null
  as_root swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | as_root tee -a /etc/fstab >/dev/null
fi

# ---------- 3. Automatic security updates ----------
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  log "Enabling automatic security updates"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades >/dev/null
fi
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' | as_root tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null

# ---------- 4. Firewall (only if ufw is active) ----------
if command -v ufw >/dev/null 2>&1 && as_root ufw status | grep -q "Status: active"; then
  as_root ufw allow 22/tcp >/dev/null; as_root ufw allow 80/tcp >/dev/null; as_root ufw allow 443/tcp >/dev/null; as_root ufw allow 443/udp >/dev/null
fi

# ---------- 5. Code ----------
log "Unpacking the new release"
as_root mkdir -p "$BASE"
as_root rm -rf "$BASE/src.new"
as_root mkdir -p "$BASE/src.new"
as_root tar -xzf "$SRC_TGZ" -C "$BASE/src.new"
rm -f "$SRC_TGZ"

# ---------- 6. Settings (/opt/smprd/.env, kept between deploys, root-only) ----------
ENVF="$BASE/.env"
if ! as_root test -f "$ENVF"; then
  log "Creating $ENVF with new random secrets"
  as_root install -m 600 /dev/null "$ENVF"
  {
    echo "# SMPRD Tracker settings. Edit with: sudo nano $ENVF  then redeploy."
    echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
    echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "INITIAL_ADMIN_USERNAME=${ADMIN_USERNAME:-david}"
    echo "PASSWORD_MIN_LENGTH=15"
    echo "PWNED_CHECK=false"
    echo "LOCKOUT_ATTEMPTS=5"
    echo "LOCKOUT_MINUTES=15"
    echo "SESSION_IDLE_HOURS=12"
    echo "SESSION_MAX_DAYS=7"
    echo "SHEET_ID=16InGEU5x475zzJUBS0Emzsexneca9d3NwP3rT4lNcsY"
    echo "SHEET_TAB=Sheet1"
    echo "CHANGELOG_TAB=Change log"
    echo "PEOPLE_TAB=People"
    echo "DRIVE_ROOT_FOLDER_NAME=SMPRD Media"
    echo "OPEN_STATUSES=In progress,Feature is Coming soon,TBD"
    echo "STALL_DAYS=14"
    echo "SYNC_SECONDS=30"
    echo "MAX_UPLOAD_MB=100"
    echo "AUTO_END_DATE=true"
    echo "TZ=Europe/London"
    echo "DATA_DIR=/data"
  } | as_root tee -a "$ENVF" >/dev/null
fi

set_kv() { # set_kv KEY VALUE  (replace or append, value written verbatim)
  local k="$1" v="$2" tmp
  tmp=$(mktemp)
  as_root cat "$ENVF" | grep -v "^${k}=" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  as_root install -m 600 "$tmp" "$ENVF"
  rm -f "$tmp"
}
has_kv() { as_root grep -q "^$1=." "$ENVF"; }

APP_DOMAIN="${APP_DOMAIN:-$(echo "${VPS_IP:-127.0.0.1}" | tr . -).sslip.io}"
set_kv APP_DOMAIN "$APP_DOMAIN"
set_kv VPS_IP "${VPS_IP:-127.0.0.1}"
set_kv APP_URL "https://$APP_DOMAIN"
set_kv BETTER_AUTH_URL "https://$APP_DOMAIN"
[ -n "${GOOGLE_CLIENT_ID:-}" ] && set_kv GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
[ -n "${GOOGLE_CLIENT_SECRET:-}" ] && set_kv GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"

# First admin password: only matters while no users exist (the app ignores it afterwards).
FIRST_RUN=0
if ! $DOCKER volume inspect smprd_smprd-data >/dev/null 2>&1; then FIRST_RUN=1; fi
if [ "$FIRST_RUN" = 1 ] && ! has_kv INITIAL_ADMIN_PASSWORD; then
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    set_kv INITIAL_ADMIN_PASSWORD "$ADMIN_PASSWORD"
  else
    GEN=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
    set_kv INITIAL_ADMIN_PASSWORD "$GEN"
    echo "$GEN" | as_root install -m 600 /dev/stdin "$BASE/INITIAL_ADMIN_PASSWORD.txt"
    echo "First admin password saved on the server: sudo cat $BASE/INITIAL_ADMIN_PASSWORD.txt"
  fi
fi

# ---------- 7. Swap in the new code and start ----------
as_root rm -rf "$BASE/src.old"
if as_root test -d "$BASE/src"; then as_root mv "$BASE/src" "$BASE/src.old"; fi
as_root mv "$BASE/src.new" "$BASE/src"
as_root ln -sf "$ENVF" "$BASE/src/.env"

cd "$BASE/src"
log "Building and starting containers (first build takes a few minutes)"
$DOCKER compose --env-file "$ENVF" up -d --build --remove-orphans

# ---------- 8. Wait for health ----------
log "Waiting for the app to report healthy"
for i in $(seq 1 60); do
  STATE=$($DOCKER inspect -f '{{.State.Health.Status}}' smprd-app-1 2>/dev/null || echo starting)
  if [ "$STATE" = healthy ]; then break; fi
  sleep 5
done
$DOCKER compose ps
if [ "$STATE" != healthy ]; then
  echo "App did not become healthy. Recent logs:"; $DOCKER compose logs --tail 80 app; exit 1
fi
$DOCKER exec smprd-app-1 node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log('health:',t))"

log "Recent proxy log (certificate status)"
$DOCKER compose logs --tail 15 caddy | grep -iE "certificate|obtain|error" || true

$DOCKER image prune -f >/dev/null 2>&1 || true
log "Deployed: https://$APP_DOMAIN"
