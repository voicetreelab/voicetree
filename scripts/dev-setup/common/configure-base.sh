#!/usr/bin/env bash
# configure-base.sh — turn a checkout into a read-only fast-forward cache of
# origin (the "base"), the per-machine half of the single-source dev model.
# Shared by setup-devbox-env.sh (VM) and setup-laptop-env.sh (Mac); the only
# platform difference is the sync timer (systemd vs launchd), handled here.
#
# It (idempotently):
#   D4  refuses if the base has unpushed commits or uncommitted edits (no data loss)
#   D1  pins a real local branch ($VT_BASE_BRANCH, default dev-manu) at origin and
#       fast-forwards it (NOT detached HEAD)
#   D9  creates a blessed daily-driver worktree (daily-mac / daily-vm) as the
#       stable "local dev" home
#       + installs the dev-flow commands (vt-land/vt-sync/vt-pr/vt-worktree)
#       + installs the ~10s sync timer (systemd on Linux / launchd on macOS)
#
# Run AFTER git-gate is on PATH. This script supplies VT_SYNC=1 to its own
# gated git calls (checkout/merge in the base) so the read-only guard lets the
# pin through (D3); the worktree-add is left ungated so git-gate does placement
# + dependency bootstrap.
#
# Config (env):
#   VT_BASE_DIR        base checkout to configure        (REQUIRED)
#   VT_BASE_BRANCH     pinned branch                     (default: dev-manu)
#   VT_WORKTREE_ROOT   worktree placement root           (default: per platform)
#   VT_SYNC_INTERVAL   timer cadence, seconds            (default: 10)
#   VT_DAILY_BRANCH    daily-driver branch name          (default: daily-<role>)
#   VT_ALERT_PARENT_NODE  VoiceTree node id the daemon attaches alert nodes under.
#                      STRONGLY recommended on a headless VM: there OS notifications
#                      are silent (no DISPLAY for notify-send; wall reaches no one),
#                      so the graph node is the primary alert channel — but a root
#                      `vt graph create` with no parent may be refused. Threaded into
#                      the timer unit so timer-detected dirty/divergence alerts land.
#   VT_SKIP_TIMER=1    configure base but do NOT install the live timer
#
# Sync cadence (VT_SYNC_INTERVAL, default 10s): a `git fetch` with no new commits
# is one cheap negotiation, so a 10s tick is the PRIMARY cross-machine propagation
# path — a change landed on one machine reaches the other's base within ~10s with
# zero user action. The explicit `vt-land` cross-machine nudge (nudge_both) is now
# an OPTIONAL latency optimisation (instant instead of <=10s), NOT a correctness
# requirement; if the nudge ssh fails, the timer still converges within one tick.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_FLOW_INSTALL="$(cd "$SCRIPT_DIR/../dev-flow" && pwd)/install.sh"
SYNC_BASE="$(cd "$SCRIPT_DIR/../remote" && pwd)/vt-sync-base.sh"

BASE="${VT_BASE_DIR:?configure-base: set VT_BASE_DIR to the base checkout}"
BRANCH="${VT_BASE_BRANCH:-dev-manu}"
INTERVAL="${VT_SYNC_INTERVAL:-10}"
ALERT_PARENT_NODE="${VT_ALERT_PARENT_NODE:-}"

[ -d "$BASE/.git" ] || { echo "configure-base: $BASE is not a git repository" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) ROLE="mac"; WT_ROOT_DEFAULT="$HOME/repos/vt-wts-synced" ;;
  *)      ROLE="vm";  WT_ROOT_DEFAULT="$HOME/vt-wts" ;;
esac
WT_ROOT="${VT_WORKTREE_ROOT:-$WT_ROOT_DEFAULT}"
DAILY_BRANCH="${VT_DAILY_BRANCH:-daily-$ROLE}"

base_git()  { git -C "$BASE" "$@"; }
# A git call that the read-only guard would block (run by the configurer, not a user).
gated_git() { VT_SYNC=1 git -C "$BASE" "$@"; }

echo "→ configure-base: $BASE  branch=$BRANCH  role=$ROLE  worktree-root=$WT_ROOT"

# --- fetch (own git is gate-exempt for consistency) -------------------------
VT_SYNC=1 base_git fetch origin --prune

base_git show-ref --verify --quiet "refs/remotes/origin/$BRANCH" \
  || { echo "configure-base: origin/$BRANCH does not exist — cannot pin the base to it" >&2; exit 1; }

# --- D4 migration guard: never strand local work ----------------------------
if ! base_git diff --quiet || ! base_git diff --cached --quiet; then
  echo "configure-base: REFUSING — $BASE has uncommitted changes." >&2
  echo "  Move them into a worktree (or commit + push), then re-run." >&2
  exit 1
fi

guard_unpushed() { # $1 = ref; refuse if it has commits not on origin/$BRANCH
  local ref="$1" n
  base_git rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || return 0
  n="$(base_git rev-list --count "origin/$BRANCH..$ref" 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt 0 ]; then
    echo "configure-base: REFUSING — '$ref' has $n commit(s) not on origin/$BRANCH:" >&2
    base_git log --oneline "origin/$BRANCH..$ref" >&2
    echo "  Push or PR them first — re-pointing the base would orphan them (D4)." >&2
    exit 1
  fi
}
guard_unpushed "refs/heads/$BRANCH"
cur="$(base_git symbolic-ref --quiet --short HEAD || true)"
[ "$cur" = "$BRANCH" ] && guard_unpushed HEAD

# --- D1 pin a real local branch at origin and fast-forward it ---------------
if base_git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  [ "$cur" = "$BRANCH" ] || gated_git checkout "$BRANCH"
  gated_git merge --ff-only "origin/$BRANCH"
else
  gated_git checkout -B "$BRANCH" "origin/$BRANCH"
fi
base_git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null
echo "→ configure-base: base pinned at origin/$BRANCH ($(base_git rev-parse --short HEAD))"

# --- D9 blessed daily-driver worktree ---------------------------------------
# Per-machine branch name (daily-mac / daily-vm): self-answers "which machine"
# and avoids cross-machine push collisions. Its upstream is origin/$BRANCH so a
# `vt-land` from it goes to the integration branch (its own name stays local).
if base_git show-ref --verify --quiet "refs/heads/$DAILY_BRANCH"; then
  echo "→ configure-base: daily worktree branch '$DAILY_BRANCH' already exists (skip)"
else
  mkdir -p "$WT_ROOT"
  # The blessed daily worktree is INFRASTRUCTURE, not a user feature worktree, so
  # it must NOT be subject to git-gate's worktree-admission-check (which exists to
  # limit accumulation of *user* worktrees). On a shared box with lingering
  # merged/idle worktrees that check refuses every \`worktree add\` — which would
  # make configure-base fail to create the one worktree the model depends on.
  # Create it via the whole-gate bypass (VT_SYNC=1 — the same lever our other
  # admin git calls above use). That bypass also skips git-gate's automatic
  # dependency bootstrap, so invoke the same async hook explicitly afterwards.
  VT_SYNC=1 VT_WORKTREE_ROOT="$WT_ROOT" git -C "$BASE" worktree add -b "$DAILY_BRANCH" "$WT_ROOT/daily" "origin/$BRANCH"
  git -C "$WT_ROOT/daily" branch --set-upstream-to="origin/$BRANCH" "$DAILY_BRANCH" >/dev/null 2>&1 || true
  async_hook="$BASE/scripts/git/worktree/on-created-async.sh"
  if [ -x "$async_hook" ]; then
    "$async_hook" "$WT_ROOT/daily" "daily" \
      || echo "→ configure-base: daily worktree dep bootstrap failed (non-fatal; the remote-command boundary retries before tests)" >&2
  fi
  echo "→ configure-base: created daily worktree $WT_ROOT/daily on $DAILY_BRANCH (falls behind origin until its next land/rebase)"
fi

# --- dev-flow commands on PATH ----------------------------------------------
bash "$DEV_FLOW_INSTALL"

# --- ~10s sync timer (the backstop for GitHub-web PR merges + the primary
#     cross-machine propagation path; cadence = VT_SYNC_INTERVAL) ------------
install_timer_systemd() {
  local svc=/etc/systemd/system/vt-sync-base.service
  local tmr=/etc/systemd/system/vt-sync-base.timer
  if ! { [ -w /etc/systemd/system ] || [ "$(id -u)" = 0 ]; }; then
    echo "→ configure-base: no write access to /etc/systemd/system — skipping timer (run as root to install)" >&2
    return 0
  fi
  # On the headless VM, the graph node is the primary alert channel (OS notifs
  # are silent there) — thread the parent node through so the daemon can attach.
  local alert_env=""
  [ -n "$ALERT_PARENT_NODE" ] && alert_env="Environment=VT_ALERT_PARENT_NODE=$ALERT_PARENT_NODE"
  cat > "$svc" <<EOF
[Unit]
Description=VoiceTree single-source base fast-forward (vt-sync-base)
After=network-online.target

[Service]
Type=oneshot
Environment=HOME=$HOME
Environment=VT_BASE_DIR=$BASE
Environment=VT_BASE_BRANCH=$BRANCH
${alert_env}
ExecStart=$SYNC_BASE
EOF
  # AccuracySec=1s is required: systemd's default accuracy (1min) would batch a
  # 10s timer up to ~1min, defeating the fast cadence. Keep it tight.
  cat > "$tmr" <<EOF
[Unit]
Description=Run vt-sync-base every ${INTERVAL}s (single-source base cache)

[Timer]
OnBootSec=60
OnUnitActiveSec=${INTERVAL}s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now vt-sync-base.timer
  echo "→ configure-base: installed + started systemd timer vt-sync-base.timer (${INTERVAL}s)"
}

install_timer_launchd() {
  local label=com.voicetree.vt-sync-base
  local plist="$HOME/Library/LaunchAgents/$label.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  local alert_kv=""
  [ -n "$ALERT_PARENT_NODE" ] && alert_kv="    <key>VT_ALERT_PARENT_NODE</key><string>$ALERT_PARENT_NODE</string>"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$SYNC_BASE</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VT_BASE_DIR</key><string>$BASE</string>
    <key>VT_BASE_BRANCH</key><string>$BRANCH</string>
${alert_kv}
  </dict>
  <key>StartInterval</key><integer>${INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$HOME/.cache/vt-sync-base/launchd.err</string>
  <key>StandardOutPath</key><string>$HOME/.cache/vt-sync-base/launchd.out</string>
</dict>
</plist>
EOF
  mkdir -p "$HOME/.cache/vt-sync-base"
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist"
  echo "→ configure-base: installed + loaded launchd agent $label (${INTERVAL}s)"
}

if [ "${VT_SKIP_TIMER:-0}" = "1" ]; then
  echo "→ configure-base: VT_SKIP_TIMER=1 — base configured, timer NOT installed"
else
  if [ "$ROLE" = "mac" ]; then install_timer_launchd; else install_timer_systemd; fi
fi

echo "✔ configure-base: $BASE is a read-only ff cache of origin/$BRANCH. Edit in worktrees; land via origin."
