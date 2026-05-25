#!/bin/bash
# vt-remote.sh — wrapper for the DO syd1 dev box
# Usage:
#   vt-remote.sh ssh                  # interactive shell
#   vt-remote.sh run <cmd...>         # run a command in /root/voicetree-public
#   vt-remote.sh sync-status          # show Mutagen sync state
#   vt-remote.sh sync-recreate        # recreate vt-remote from repo config
#   vt-remote.sh artifacts-pull <id>  # copy explicit Onidel artifacts to Mac
#   vt-remote.sh htop                 # remote htop
#   vt-remote.sh ip                   # print public IP

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DROPLET_IP="${DROPLET_IP:-216.176.239.155}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/root/voicetree-public}"
REMOTE="${REMOTE_USER}@${DROPLET_IP}"
MUTAGEN_CONFIG="$REPO_ROOT/get_dev_healthy/mutagen-vt-remote.yml"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-/root/.voicetree/artifacts}"

create_sync() {
  exec mutagen sync create \
    --name vt-remote \
    --configuration-file "$MUTAGEN_CONFIG" \
    "$REPO_ROOT" \
    "${REMOTE}:${REMOTE_DIR}"
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
vt-remote.sh — DigitalOcean syd1 dev box ($DROPLET_IP)

  ssh                interactive shell, cwd = $REMOTE_DIR
  run <cmd...>       run a command remotely (e.g. ./vt-remote.sh run npm run test:brain)
  sync-status        mutagen sync list vt-remote
  sync-create        create vt-remote from get_dev_healthy/mutagen-vt-remote.yml
  sync-recreate      terminate any existing vt-remote and recreate it from repo config
  sync-flush         force a sync now (mutagen flushes on its own, but useful)
  sync-pause         pause syncing
  sync-resume        resume syncing
  sync-monitor       live sync activity view
  artifacts-list     list explicit artifact directories on Onidel
  artifacts-pull ID  copy /root/.voicetree/artifacts/ID back to ./artifacts/ID
  htop               remote htop (use 'q' to quit)
  ip                 print public IP

Environment overrides:
  DROPLET_IP, REMOTE_USER, REMOTE_DIR, ARTIFACT_ROOT
EOF
    exit ${1:+1}
    ;;
esac
