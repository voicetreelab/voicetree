#!/bin/bash
# vt-remote.sh — wrapper for your remote dev box
# Usage:
#   vt-remote.sh ssh                  # interactive shell
#   vt-remote.sh run <cmd...>         # run a command in /root/voicetree-public
#   vt-remote.sh sync-status          # show Mutagen sync state
#   vt-remote.sh sync-recreate        # recreate vt-remote from repo config
#   vt-remote.sh artifacts-pull <id>  # copy explicit Onidel artifacts to Mac
#   vt-remote.sh htop                 # remote htop
#   vt-remote.sh ip                   # print public IP
#
# Host resolution (high → low precedence):
#   VT_REMOTE_HOST env var                      e.g. root@1.2.3.4
#   VT_REMOTE_HOST in <repo-root>/.env          (matches scripts/run-remote.mjs)
#   REMOTE_USER + DROPLET_IP env vars (legacy escape hatch)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

resolve_remote() {
  if [ -n "${VT_REMOTE_HOST:-}" ]; then
    printf '%s\n' "$VT_REMOTE_HOST"; return 0
  fi
  if [ -f "$REPO_ROOT/.env" ]; then
    local v
    v="$(awk -F= '/^VT_REMOTE_HOST=/{sub(/^VT_REMOTE_HOST=/,""); print; exit}' "$REPO_ROOT/.env")"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    if [ -n "$v" ]; then printf '%s\n' "$v"; return 0; fi
  fi
  if [ -n "${DROPLET_IP:-}" ]; then
    printf '%s@%s\n' "${REMOTE_USER:-root}" "$DROPLET_IP"; return 0
  fi
  echo "vt-remote.sh: VT_REMOTE_HOST not set (env or .env). See scripts/dev-setup/remote/install.sh" >&2
  exit 1
}

REMOTE="$(resolve_remote)"
REMOTE_USER="${REMOTE%%@*}"
DROPLET_IP="${REMOTE##*@}"
REMOTE_DIR="${REMOTE_DIR:-/root/voicetree-public}"
MUTAGEN_CONFIG="$SCRIPT_DIR/mutagen-vt-remote.yml"
CSV_HISTORY_CONFIG="$SCRIPT_DIR/mutagen-vt-csv-history.yml"
CSV_HISTORY_LOCAL="$REPO_ROOT/health-dashboard/reports/scores-history"
CSV_HISTORY_REMOTE="${REMOTE_DIR}/health-dashboard/reports/scores-history"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-/root/.voicetree/artifacts}"

create_sync() {
  exec mutagen sync create \
    --name vt-remote \
    --configuration-file "$MUTAGEN_CONFIG" \
    "$REPO_ROOT" \
    "${REMOTE}:${REMOTE_DIR}"
}

create_csv_history_sync() {
  ssh -o StrictHostKeyChecking=no "$REMOTE" "mkdir -p '$CSV_HISTORY_REMOTE'"
  mkdir -p "$CSV_HISTORY_LOCAL"
  exec mutagen sync create \
    --name vt-csv-history \
    --configuration-file "$CSV_HISTORY_CONFIG" \
    "$CSV_HISTORY_LOCAL" \
    "${REMOTE}:${CSV_HISTORY_REMOTE}"
}

case "${1:-}" in
  ssh)
    exec ssh -o StrictHostKeyChecking=no -t "$REMOTE" "cd ${REMOTE_DIR} && exec bash --login"
    ;;
  run)
    shift
    [ $# -eq 0 ] && { echo "usage: vt-remote.sh run <cmd...>"; exit 2; }
    exec ssh -o StrictHostKeyChecking=no -t "$REMOTE" "cd ${REMOTE_DIR} && $*"
    ;;
  sync-create)
    create_sync
    ;;
  sync-recreate)
    mutagen sync terminate vt-remote >/dev/null 2>&1 || true
    create_sync
    ;;
  sync-status)
    exec mutagen sync list vt-remote
    ;;
  sync-flush)
    exec mutagen sync flush vt-remote
    ;;
  sync-pause)
    exec mutagen sync pause vt-remote
    ;;
  sync-resume)
    exec mutagen sync resume vt-remote
    ;;
  sync-monitor)
    exec mutagen sync monitor vt-remote
    ;;
  csv-history-create)
    create_csv_history_sync
    ;;
  csv-history-recreate)
    mutagen sync terminate vt-csv-history >/dev/null 2>&1 || true
    create_csv_history_sync
    ;;
  csv-history-status)
    exec mutagen sync list vt-csv-history
    ;;
  csv-history-flush)
    exec mutagen sync flush vt-csv-history
    ;;
  csv-history-terminate)
    exec mutagen sync terminate vt-csv-history
    ;;
  artifacts-list)
    exec ssh -o StrictHostKeyChecking=no "$REMOTE" \
      "find '$ARTIFACT_ROOT' -mindepth 1 -maxdepth 1 -type d -printf '%TY-%Tm-%Td %TH:%TM %f\n' 2>/dev/null | sort"
    ;;
  artifacts-pull)
    shift
    run_id="${1:-}"
    dest="${2:-$REPO_ROOT/artifacts/$run_id}"
    if [[ ! "$run_id" =~ ^[A-Za-z0-9_.-]+$ ]]; then
      echo "usage: vt-remote.sh artifacts-pull <artifact-id> [dest]" >&2
      echo "artifact-id must be a single path segment: letters, numbers, dot, underscore, dash" >&2
      exit 2
    fi
    mkdir -p "$dest"
    exec rsync -av "${REMOTE}:${ARTIFACT_ROOT}/${run_id}/" "$dest/"
    ;;
  htop)
    exec ssh -o StrictHostKeyChecking=no -t "$REMOTE" "htop"
    ;;
  ip)
    echo "$DROPLET_IP"
    ;;
  *)
    cat <<EOF
vt-remote.sh — remote dev box ($REMOTE)

  ssh                interactive shell, cwd = $REMOTE_DIR
  run <cmd...>       run a command remotely (e.g. ./vt-remote.sh run npm run test:brain)
  sync-status        mutagen sync list vt-remote
  sync-create        create vt-remote from scripts/dev-setup/remote/mutagen-vt-remote.yml
  sync-recreate      terminate any existing vt-remote and recreate it from repo config
  sync-flush         force a sync now (mutagen flushes on its own, but useful)
  sync-pause         pause syncing
  sync-resume        resume syncing
  sync-monitor       live sync activity view
  csv-history-create     create vt-csv-history two-way sync for scores-history/
  csv-history-recreate   terminate any existing vt-csv-history and recreate
  csv-history-status     mutagen sync list vt-csv-history
  csv-history-flush      force a sync now
  csv-history-terminate  stop the two-way sync session
  artifacts-list     list explicit artifact directories on Onidel
  artifacts-pull ID  copy /root/.voicetree/artifacts/ID back to ./artifacts/ID
  htop               remote htop (use 'q' to quit)
  ip                 print public IP

Host resolution: VT_REMOTE_HOST env > <repo>/.env > REMOTE_USER+DROPLET_IP.
Other env overrides: REMOTE_DIR, ARTIFACT_ROOT.
EOF
    exit ${1:+1}
    ;;
esac
