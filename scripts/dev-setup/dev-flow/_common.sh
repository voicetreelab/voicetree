#!/usr/bin/env bash
# _common.sh — shared helpers for the machine-LOCAL dev-flow commands
# (vt-sync / vt-pr / vt-worktree). Sourced, never executed.
#
# Model: each machine works on its OWN branch ($VT_DEV_BRANCH, e.g. dev-mac on
# the Mac, dev-remote on the VM) in a NORMAL writable checkout. There is no
# read-only base and no shared branch to keep in sync, so these commands no
# longer nudge caches or guard the checkout — they are thin wrappers over git +
# gh. Integration is a PR to the shared `dev` branch.
#
# Branch names are machine-local config: $VT_DEV_BRANCH lives in ~/.env and is
# NEVER a literal in this repo. When unset it defaults to the safe, non-shared
# `dev-new` (never `dev`, so a misconfigured machine can't push straight to the
# integration branch).

vt_uname="$(uname -s)"

# Repo path for THIS machine (used by vt-worktree to resolve the checkout from
# any cwd). Overridable per machine.
VT_MAC_REPO="${VT_MAC_REPO:-/Users/bobbobby/repos/vtrepo}"
VT_VM_REPO="${VT_VM_REPO:-/root/vtrepo}"
self_repo() {
  if [ "$vt_uname" = "Darwin" ]; then printf '%s' "$VT_MAC_REPO"; else printf '%s' "$VT_VM_REPO"; fi
}

# This machine's working branch (machine-local; default dev-new, never dev).
self_dev_branch() { printf '%s' "${VT_DEV_BRANCH:-dev-new}"; }

# The shared integration branch a PR targets. `dev` is a team branch (not a
# personal name), so it is referenced directly; override with VT_INTEGRATION_BRANCH.
integration_branch() { printf '%s' "${VT_INTEGRATION_BRANCH:-dev}"; }
