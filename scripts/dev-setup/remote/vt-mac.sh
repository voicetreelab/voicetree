#!/usr/bin/env bash
# vt-mac.sh — run `vt` against the Mac's VoiceTree daemon from the remote dev box.
#
# Topology: the dev box (this Linux host) is pure compute — code is mirrored
# here Mac→box via mutagen, but the VoiceTree daemon and the graph (~/brain)
# live on the Mac. So a bare `vt` here has no daemon to talk to. This shim is
# the mirror image of vt-remote.sh: where vt-remote.sh lets the Mac drive the
# box, vt-mac.sh lets the box drive the Mac's `vt` over the reverse SSH tunnel.
#
# Installed on the box as `vt` (see install on the box), so an agent can just:
#   echo '{"nodes":[...]}' | vt graph create
#   vt graph unseen
#   vt agent list
# and it transparently executes on the Mac, attributing work to the caller's
# VOICETREE_TERMINAL_ID.
#
# Argv is re-quoted (printf %q) so spaces / globs / quotes survive the remote
# shell verbatim; stdin is forwarded (no -n) with no TTY (-T) so piped JSON
# stays byte-clean. Every VOICETREE_* var set in the caller's environment is
# forwarded, so the agent's identity (VOICETREE_TERMINAL_ID) and write target
# (VOICETREE_WRITE_PATH) carry through to the Mac daemon.
#
# Connection config (env override → default, defaults match /root/CLAUDE.md):
#   VT_MAC_SSH        bobbobby@localhost        Mac reverse-tunnel endpoint
#   VT_MAC_SSH_PORT   2222                      reverse tunnel port
#   VT_MAC_SSH_KEY    ~/.ssh/id_ed25519_mac     key authorized on the Mac
#   VT_MAC_VT         /usr/local/bin/vt         absolute path to vt on the Mac
#   VT_MAC_PROJECT    /Users/bobbobby/brain     default VOICETREE_PROJECT_PATH

set -euo pipefail

VT_MAC_SSH="${VT_MAC_SSH:-bobbobby@localhost}"
VT_MAC_SSH_PORT="${VT_MAC_SSH_PORT:-2222}"
VT_MAC_SSH_KEY="${VT_MAC_SSH_KEY:-$HOME/.ssh/id_ed25519_mac}"
VT_MAC_VT="${VT_MAC_VT:-/usr/local/bin/vt}"
VT_MAC_PROJECT="${VT_MAC_PROJECT:-/Users/bobbobby/brain}"

# Build the env prefix for the remote shell. Default VOICETREE_PROJECT_PATH so
# the daemon resolves even when the caller did not export it, then forward every
# VOICETREE_* the caller did set (TERMINAL_ID, WRITE_PATH, …) — caller wins.
declare -A remote_env=( [VOICETREE_PROJECT_PATH]="$VT_MAC_PROJECT" )
while IFS='=' read -r name value; do
  [[ "$name" == VOICETREE_* ]] && remote_env["$name"]="$value"
done < <(env)

remote_cmd="env"
for name in "${!remote_env[@]}"; do
  remote_cmd+=" $(printf '%q' "$name=${remote_env[$name]}")"
done
remote_cmd+=" $(printf '%q' "$VT_MAC_VT")"
for arg in "$@"; do
  remote_cmd+=" $(printf '%q' "$arg")"
done

exec ssh -T \
  -i "$VT_MAC_SSH_KEY" \
  -p "$VT_MAC_SSH_PORT" \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=15 \
  "$VT_MAC_SSH" \
  "$remote_cmd"
