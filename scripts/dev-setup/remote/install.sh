#!/usr/bin/env bash
# install.sh — one-shot setup for routing dev commands to a remote dev box.
#
# Wires up the laptop side: writes VT_REMOTE_HOST to .env, verifies SSH,
# (optionally) pre-seeds the devbox with a fresh GitHub clone so the first
# mutagen sync reconciles by hash instead of streaming the whole working
# tree over the laptop uplink, creates the mutagen vt-remote session, and
# routes git hooks through scripts/hooks.
#
# Prereqs (on this laptop, before running):
#   - voicetree-public cloned locally (you are here)
#   - mutagen installed:  brew install mutagen-io/mutagen/mutagen
#   - passwordless SSH:   your public key in /root/.ssh/authorized_keys on the box
#
# Usage:
#   VT_REMOTE_HOST=root@1.2.3.4 bash scripts/dev-setup/remote/install.sh
#   VT_REMOTE_HOST=root@1.2.3.4 bash scripts/dev-setup/remote/install.sh --skip-pre-seed
#
# Flags:
#   --skip-pre-seed   skip the devbox-side `git clone` optimization
#                     (mutagen will then push the entire working tree on first sync)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

SKIP_PRE_SEED=0
for arg in "$@"; do
  case "$arg" in
    --skip-pre-seed) SKIP_PRE_SEED=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "install.sh: unknown flag: $arg" >&2; exit 64 ;;
  esac
done

: "${VT_REMOTE_HOST:?set VT_REMOTE_HOST=root@<your-devbox-host> before running (see --help)}"

REMOTE_DIR="/root/voicetree-public"
REPO_URL="${REPO_URL:-https://github.com/voicetreelab/voicetree-public.git}"
ENV_FILE="$REPO_ROOT/.env"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

step() { printf '\n→ %s\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

step "checking prereqs"
command -v mutagen >/dev/null || fail "mutagen not installed (brew install mutagen-io/mutagen/mutagen)"
mutagen daemon start >/dev/null 2>&1 || true
ok "mutagen present"

step "writing VT_REMOTE_HOST to $ENV_FILE"
if [ -f "$ENV_FILE" ] && grep -q '^VT_REMOTE_HOST=' "$ENV_FILE"; then
  current="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$ENV_FILE")"
  if [ "$current" = "$VT_REMOTE_HOST" ]; then
    ok ".env already pins VT_REMOTE_HOST=$VT_REMOTE_HOST"
  else
    fail ".env already has VT_REMOTE_HOST=$current — refusing to overwrite. Edit by hand."
  fi
else
  printf 'VT_REMOTE_HOST=%s\n' "$VT_REMOTE_HOST" >> "$ENV_FILE"
  ok "appended VT_REMOTE_HOST=$VT_REMOTE_HOST"
fi

step "verifying passwordless SSH to $VT_REMOTE_HOST"
ssh -o BatchMode=yes -o ConnectTimeout=5 "$VT_REMOTE_HOST" 'hostname' \
  || fail "SSH failed. Add your public key to /root/.ssh/authorized_keys on the devbox."
ok "SSH works"

if [ "$SKIP_PRE_SEED" -eq 1 ]; then
  step "skipping devbox pre-seed (--skip-pre-seed); first mutagen sync will transfer the full working tree"
else
  step "pre-seeding $VT_REMOTE_HOST:$REMOTE_DIR at branch $BRANCH"
  ssh "$VT_REMOTE_HOST" "
    set -e
    if [ -d $REMOTE_DIR/.git ]; then
      echo '  (devbox already has a clone — fetching + checkout $BRANCH)'
      cd $REMOTE_DIR
      git fetch origin
      git checkout $BRANCH
      git pull --ff-only origin $BRANCH || true
    else
      git clone $REPO_URL $REMOTE_DIR
      cd $REMOTE_DIR
      git checkout $BRANCH
    fi
    git submodule update --init
  " || fail "pre-seed failed. Re-run with --skip-pre-seed to push via mutagen instead."
  ok "devbox at $BRANCH with submodules initialised"
fi

step "provisioning pnpm on $VT_REMOTE_HOST via corepack"
# corepack ships with Node 16.10+. `prepare --activate` reads the version
# from the cloned repo's package.json `packageManager` field, so the
# devbox ends up on the exact same pnpm as the laptop. Gated on
# pnpm-workspace.yaml so this is a no-op on npm-only branches.
ssh "$VT_REMOTE_HOST" "
  set -e
  cd $REMOTE_DIR
  if [ ! -f pnpm-workspace.yaml ]; then
    echo '  (branch is not on pnpm — skipping)'
    exit 0
  fi
  command -v corepack >/dev/null || { echo 'corepack missing on devbox (need Node 16.10+)'; exit 1; }
  corepack enable
  corepack prepare pnpm --activate
  pnpm --version
" || fail "pnpm provisioning failed"
ok "pnpm available on devbox"

step "creating mutagen vt-remote session"
if mutagen sync list vt-remote >/dev/null 2>&1; then
  ok "session already exists (skip create)"
else
  bash "$SCRIPT_DIR/vt-remote.sh" sync-create &
  create_pid=$!
  wait "$create_pid" || fail "mutagen sync create failed"
  ok "session created"
fi

step "routing git hooks through scripts/hooks"
git -C "$REPO_ROOT" config core.hooksPath scripts/hooks
ok "core.hooksPath = scripts/hooks"

cat <<MSG

✔ remote routing installed.

Next:
  - wait for steady state:   mutagen sync list vt-remote   # expect 'Status: Watching for changes'
  - smoke test routing:      npm run test                  # expect '[run-remote] ...' lines
  - optional safety:         bash scripts/dev-setup/git-gate/install.sh

MSG
