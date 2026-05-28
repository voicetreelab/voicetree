#!/bin/bash
# vt-mac.sh — wrapper for reaching the Mac from Onidel via the reverse SSH tunnel.
# Mirror of vt-remote.sh, but in the opposite direction.
#
# Topology:
#   Onidel ──► localhost:2222 ──reverse tunnel──► Mac:22
#
# Usage:
#   vt-mac.sh ssh             # interactive shell on Mac
#   vt-mac.sh run <cmd...>    # run a command on Mac
#
# Env overrides:
#   MAC_USER   target user on Mac (default: bobbobby)
#   MAC_PORT   tunnel port on Onidel loopback (default: 2222)
#   MAC_KEY    SSH private key to use (default: /root/.ssh/id_ed25519_mac)
#   MAC_HOST   tunnel host (default: localhost)

set -euo pipefail

MAC_USER="${MAC_USER:-bobbobby}"
MAC_PORT="${MAC_PORT:-2222}"
MAC_KEY="${MAC_KEY:-/root/.ssh/id_ed25519_mac}"
MAC_HOST="${MAC_HOST:-localhost}"

SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o BatchMode=yes
  -o ConnectTimeout=10
  -i "$MAC_KEY"
  -p "$MAC_PORT"
)

case "${1:-}" in
  ssh)
    exec ssh "${SSH_OPTS[@]}" -t "${MAC_USER}@${MAC_HOST}"
    ;;
  run)
    shift
    [ $# -eq 0 ] && { echo "usage: vt-mac.sh run <cmd...>" >&2; exit 2; }
    exec ssh "${SSH_OPTS[@]}" "${MAC_USER}@${MAC_HOST}" "$*"
    ;;
  *)
    cat <<EOF
vt-mac.sh — reach Mac from Onidel (${MAC_USER}@${MAC_HOST}:${MAC_PORT})

  ssh                 interactive shell on Mac
  run <cmd...>        run a command on Mac

Env: MAC_USER, MAC_PORT, MAC_KEY, MAC_HOST.
EOF
    exit ${1:+1}
    ;;
esac
