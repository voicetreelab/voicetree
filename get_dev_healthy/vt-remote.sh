#!/bin/bash
# vt-remote.sh — wrapper for the DO syd1 dev box
# Usage:
#   vt-remote.sh ssh                  # interactive shell
#   vt-remote.sh run <cmd...>         # run a command in /root/voicetree-public
#   vt-remote.sh sync-status          # show Mutagen sync state
#   vt-remote.sh htop                 # remote htop
#   vt-remote.sh ip                   # print public IP

set -euo pipefail

DROPLET_IP="${DROPLET_IP:-209.38.31.40}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/root/voicetree-public}"

case "${1:-}" in
  ssh)
    exec ssh -o StrictHostKeyChecking=no -t "${REMOTE_USER}@${DROPLET_IP}" "cd ${REMOTE_DIR} && exec bash --login"
    ;;
  run)
    shift
    [ $# -eq 0 ] && { echo "usage: vt-remote.sh run <cmd...>"; exit 2; }
    exec ssh -o StrictHostKeyChecking=no -t "${REMOTE_USER}@${DROPLET_IP}" "cd ${REMOTE_DIR} && $*"
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
  htop)
    exec ssh -o StrictHostKeyChecking=no -t "${REMOTE_USER}@${DROPLET_IP}" "htop"
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
  sync-flush         force a sync now (mutagen flushes on its own, but useful)
  sync-pause         pause syncing
  sync-resume        resume syncing
  sync-monitor       live sync activity view
  htop               remote htop (use 'q' to quit)
  ip                 print public IP

Environment overrides:
  DROPLET_IP, REMOTE_USER, REMOTE_DIR
EOF
    exit ${1:+1}
    ;;
esac
