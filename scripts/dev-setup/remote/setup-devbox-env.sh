#!/usr/bin/env bash
# Configure machine-local env on the remote devbox.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_ENV_FILE="$HOME/.env"

bash "$SCRIPT_DIR/write-env-value.sh" "$HOME_ENV_FILE" VT_DEV_ROLE remote

echo "setup-devbox-env: $HOME_ENV_FILE has VT_DEV_ROLE=remote"

# --- SSH connection multiplexing to the Mac (reverse tunnel) ---
# Every ssh to the Mac — and every `vt`, which shells out to ssh — otherwise pays
# a full ~3s handshake (no connection reuse). ControlMaster keeps one connection
# warm so only the first call per ControlPersist window handshakes; the rest are
# ~instant. Also defines a `mac` host alias so `ssh mac` works with no flags.
# Written as a marked, self-managed block so re-running this script is idempotent.
setup_ssh_mux() {
  local cfg="$HOME/.ssh/config" sockets="$HOME/.ssh/sockets"
  local begin="# >>> vt-devbox ssh-mux >>>" end="# <<< vt-devbox ssh-mux <<<"
  mkdir -p "$sockets"
  chmod 700 "$HOME/.ssh" "$sockets"
  if [ -f "$cfg" ] && grep -qF "$begin" "$cfg"; then
    sed -i "/$begin/,/$end/d" "$cfg"
  fi
  cat >> "$cfg" <<EOF
$begin
# Managed by scripts/dev-setup/remote/setup-devbox-env.sh — edits here are overwritten.
Host mac
    HostName localhost
    Port ${VT_MAC_SSH_PORT:-2222}
    User ${VT_MAC_SSH_USER:-bobbobby}
    IdentityFile ${VT_MAC_SSH_KEY:-~/.ssh/id_ed25519_mac}
    IdentitiesOnly yes
    StrictHostKeyChecking no
Host mac localhost 127.0.0.1
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%C
    ControlPersist 10m
    GSSAPIAuthentication no
$end
EOF
  chmod 600 "$cfg"
  echo "setup-devbox-env: $cfg has ssh multiplexing + 'mac' host alias"
}
setup_ssh_mux
