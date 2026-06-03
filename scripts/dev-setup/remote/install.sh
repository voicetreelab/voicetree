#!/usr/bin/env bash
# install.sh — one-shot setup for routing dev commands to a remote dev box.
#
# Wires up the laptop side: writes VT_REMOTE_HOST to .env and ~/.env,
# marks this machine as the Mac dev role, verifies SSH, bootstraps the VM's
# checkout (a real GitHub clone), provisions tooling on it, and puts that
# checkout on its own writable machine branch. Also routes git hooks.
#
# Per-machine-branch model: each machine owns ONE writable branch ($VT_DEV_BRANCH,
# set in ~/.env; default the safe non-shared `dev-new`); integration is a PR to the
# shared `dev` branch. There is no read-only base, no branch pinning, no sync daemon.
#
# The old vt-remote full-repo mutagen session is retired; the kept syncs (vt-wts-synced
# worktree mirror + the health-dashboard data) are created separately via
# scripts/dev-setup/remote/vt-remote.sh.
#
# Prereqs (on this laptop, before running):
#   - voicetree-public cloned locally at ~/repos/vtrepo (you are here)
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

# The VM gets its own normal writable checkout at $REMOTE_DIR (no more
# /root/vtrepo-synced full-repo mutagen replica). Provision into it.
REMOTE_DIR="${VT_BASE_DIR:-/root/vtrepo}"
REPO_URL="${REPO_URL:-https://github.com/voicetreelab/voicetree-public.git}"
ENV_FILE="$REPO_ROOT/.env"
HOME_ENV_FILE="$HOME/.env"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

step() { printf '\n→ %s\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

step "checking prereqs"
command -v mutagen >/dev/null || fail "mutagen not installed (brew install mutagen-io/mutagen/mutagen)"
mutagen daemon start >/dev/null 2>&1 || true
ok "mutagen present"

step "configuring laptop env"
VT_REMOTE_HOST="$VT_REMOTE_HOST" bash "$SCRIPT_DIR/setup-laptop-env.sh" \
  || fail "failed to configure laptop env"
ok "$ENV_FILE and $HOME_ENV_FILE configured"

step "verifying passwordless SSH to $VT_REMOTE_HOST"
ssh -o BatchMode=yes -o ConnectTimeout=5 "$VT_REMOTE_HOST" 'hostname' \
  || fail "SSH failed. Add your public key to /root/.ssh/authorized_keys on the devbox."
ok "SSH works"

step "writing remote machine dev role to $VT_REMOTE_HOST:~/.env"
ssh "$VT_REMOTE_HOST" "mkdir -p /tmp/vt-dev-setup-remote" \
  || fail "failed to create remote setup temp dir"
scp "$SCRIPT_DIR/write-env-value.sh" "$SCRIPT_DIR/setup-devbox-env.sh" \
  "$VT_REMOTE_HOST:/tmp/vt-dev-setup-remote/" >/dev/null \
  || fail "failed to copy remote setup scripts"
ssh "$VT_REMOTE_HOST" "bash /tmp/vt-dev-setup-remote/setup-devbox-env.sh" \
  || fail "failed to write remote VT_DEV_ROLE"
ok "remote ~/.env pins VT_DEV_ROLE=remote"

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

step "installing vt shim on $VT_REMOTE_HOST (box → Mac vt forwarder)"
# The box has no VoiceTree daemon — the daemon + graph live on the Mac. This
# symlinks `vt` on the box to vt-mac.sh, which forwards every invocation back to
# the Mac's vt over the reverse SSH tunnel. Creating the link needs neither the
# tunnel nor the key (only *using* vt does), so this never blocks install.
ssh "$VT_REMOTE_HOST" "ln -sfn '$REMOTE_DIR/scripts/dev-setup/remote/vt-mac.sh' /usr/local/bin/vt" \
  || fail "failed to install vt shim on devbox"
ok "/usr/local/bin/vt -> vt-mac.sh (requires reverse tunnel + key; see /root/CLAUDE.md on the box)"

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
  if [ -x scripts/dev-setup/common/ensure-pnpm.sh ]; then
    bash scripts/dev-setup/common/ensure-pnpm.sh .
  else
    command -v corepack >/dev/null || { echo 'corepack missing on devbox (need Node 16.10+)'; exit 1; }
    corepack enable
    corepack prepare pnpm --activate
  fi
  pnpm --version
" || fail "pnpm provisioning failed"
ok "pnpm available on devbox"

step "installing earlyoom on $VT_REMOTE_HOST"
# Userspace OOM daemon. When memory pressure climbs it kills the fattest
# user process *before* the kernel goes nuclear and starts reaping systemd.
# Without this, a runaway test pool can take the box down (see incident:
# 14 vitest workers × 1.3GB on a 15GB-RAM, 0-swap box → systemd OOM cascade).
ssh "$VT_REMOTE_HOST" "
  set -e
  if ! command -v earlyoom >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq earlyoom
  fi
  systemctl enable --now earlyoom
  systemctl is-active earlyoom >/dev/null
" || fail "earlyoom install failed"
ok "earlyoom active (kills heaviest user proc before kernel-OOM)"

step "installing agent code-search tools on $VT_REMOTE_HOST (ast-grep, ck, cgcli)"
# The code-navigation tools CLAUDE.md / AGENTS.md tell agents to prefer over grep:
#   - ast-grep : AST-precise structural search/rewrite (npm @ast-grep/cli)
#   - ck       : local semantic / BM25 code search (prebuilt GitHub release binary)
#   - cgcli    : in-repo symbol-resolved call-graph CLI, exposed via a PATH shim
# ast-grep installs into an isolated prefix and we link ONLY its `ast-grep`
# binary into PATH — its bundled `sg` alias would otherwise clobber the
# shadow-utils `sg` (group) command at /usr/bin/sg. ck ships a prebuilt
# x86_64-linux binary, so no Rust toolchain is needed; other arches get a
# clear manual-install note rather than a silent failure. All three are
# idempotent (guarded by `command -v` / `ln -sfn`).
CK_VERSION="0.7.11"
ssh "$VT_REMOTE_HOST" "
  set -e
  # ast-grep — isolated prefix, expose only the ast-grep binary
  if ! command -v ast-grep >/dev/null; then
    npm install -g --prefix /usr/local/ast-grep @ast-grep/cli
  fi
  ln -sfn /usr/local/ast-grep/bin/ast-grep /usr/local/bin/ast-grep
  # ck — prebuilt linux x86_64 release binary (avoids a Rust build)
  if ! command -v ck >/dev/null; then
    arch=\$(uname -m)
    if [ \"\$arch\" = x86_64 ]; then
      tmp=\$(mktemp -d)
      curl -fsSL -o \"\$tmp/ck.tgz\" \
        https://github.com/BeaconBay/ck/releases/download/$CK_VERSION/ck-$CK_VERSION-x86_64-unknown-linux-gnu.tar.gz
      tar xzf \"\$tmp/ck.tgz\" -C \"\$tmp\"
      install -m 0755 \"\$tmp/ck\" /usr/local/bin/ck
      rm -rf \"\$tmp\"
    else
      echo \"  (ck: no prebuilt linux binary for \$arch — install manually: cargo install ck-search)\" >&2
    fi
  fi
  # cgcli — PATH shim to the in-repo @vt/code-graph-cli (runs under tsx)
  ln -sfn $REMOTE_DIR/scripts/dev-setup/remote/cgcli.sh /usr/local/bin/cgcli
  ast-grep --version
  command -v ck >/dev/null && ck --version || true
" || fail "code-search tools install failed"
ok "ast-grep, ck, cgcli on PATH (cgcli needs node_modules; resolves per-worktree)"

# NOTE: the vt-remote full-repo mutagen session is RETIRED — the VM checkout
# ($REMOTE_DIR) is a normal writable clone on its own machine branch, configured
# below. The kept syncs (vt-wts-synced + the two health-dashboard data sessions)
# are created on demand via vt-remote.sh, not here.

step "setting up standalone brain checkouts"
bash "$SCRIPT_DIR/vt-remote.sh" brain-setup \
  || fail "brain checkout setup failed"
ok "local ~/brain and remote /root/brain point at standalone clones"

step "symlinking CLAUDE.md and AGENTS.md on devbox"
ssh "$VT_REMOTE_HOST" "bash $REMOTE_DIR/scripts/dev-setup/vm_prompts/install.sh $REMOTE_DIR" \
  || fail "vm_prompts symlink failed"
ok "~/CLAUDE.md and ~/AGENTS.md symlinked"

step "routing git hooks through scripts/hooks"
git -C "$REPO_ROOT" config core.hooksPath scripts/hooks
ok "core.hooksPath = scripts/hooks"

# --- put the VM checkout on its own writable machine branch ------------------
# Switch $REMOTE_DIR to $VT_DEV_BRANCH (machine-local, set in ~/.env; default the
# safe non-shared `dev-new`) and install the dev-flow commands (vt-sync / vt-pr /
# vt-worktree). Skip with VT_SKIP_CHECKOUT_CONFIG=1.
if [ "${VT_SKIP_CHECKOUT_CONFIG:-0}" = "1" ]; then
  ok "VM checkout branch configuration skipped (VT_SKIP_CHECKOUT_CONFIG=1)"
else
  step "putting VM checkout $REMOTE_DIR on its own writable machine branch"
  ssh "$VT_REMOTE_HOST" "VT_BASE_DIR=$(printf %q "$REMOTE_DIR") bash $REMOTE_DIR/scripts/dev-setup/remote/setup-devbox-env.sh --configure-checkout" \
    || fail "VM checkout configuration failed (commit/stash changes on $REMOTE_DIR, then re-run)"
  ok "VM checkout on its machine branch; dev-flow commands installed"
fi

cat <<MSG

✔ remote routing installed (per-machine-branch model).

Next:
  - check brain checkout:    bash scripts/dev-setup/remote/vt-remote.sh brain-status
  - configure THIS Mac:      bash scripts/dev-setup/remote/setup-laptop-env.sh --configure-checkout
  - kept syncs (create as needed):
      bash scripts/dev-setup/remote/vt-remote.sh vt-wts-create
      bash scripts/dev-setup/remote/vt-remote.sh csv-history-create
      bash scripts/dev-setup/remote/vt-remote.sh reports-create

One-time teardown of the retired full-repo replica (run on the Mac, once):
  mutagen sync terminate vt-remote     # stop the old /root/vtrepo-synced mirror
  # then, on the VM, the old replica dir /root/vtrepo-synced can be removed once
  # you have confirmed /root/vtrepo is the live checkout.

MSG
