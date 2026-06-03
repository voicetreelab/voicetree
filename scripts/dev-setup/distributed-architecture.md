# Distributed dev architecture

## Single source of truth: origin is the only writable copy

`dev-manu` (and every branch) used to exist as three independently-writable
copies — the Mac checkout, the VM checkout, and origin — so they drifted and you
held a 3-way "are Mac/VM/origin in sync?" diff in your head. Under the
single-source model there is exactly one writable copy of any branch — **origin**
— and each machine's base checkout is a **read-only fast-forward cache** of it.

```
        origin/<branch>        ◀──────────── the ONLY writable copy
         ▲   ▲      │   │
   push  │   │      │   │ ff (auto, can't conflict)
 feature │   │      ▼   ▼
   ┌─────┘   │   Mac base ── read-only ff cache (pinned local dev-manu @ origin)
   │         └── VM  base ── read-only ff cache (pinned local dev-manu @ origin)
   │                  │
   │  bases NEVER written locally → ff is always clean, never conflicts
   │
 worktrees (the only writable trees) branch off origin/<branch>, push to origin
```

- **Base checkout** (`~/repos/vtrepo` on Mac, `/root/vtrepo` on the VM) = a
  read-only cache. It keeps a **real pinned local branch** (`dev-manu`, override
  `$VT_BASE_BRANCH`) advanced ONLY by the sync daemon via `git merge --ff-only
  origin/<branch>` — a friendly branch name, not detached HEAD. It is also a
  full fetch-mirror of `origin/*`, so worktrees can branch off ANY branch.
- **Worktrees** = the only writable trees. One branch, one owner machine.
- A change reaches a branch ONLY via origin (PR merge or fast-forward push). The
  caches only follow. One writer can't disagree with itself → nothing to reconcile.

The one rule to hold, identical on Mac and VM:
**don't edit the base; work in a worktree; integration is a push to origin.**

## Dev flow (same on either machine)

```
git worktree add -b feat feat origin/dev-manu   # canonical — git-gate places + installs deps
# vt-worktree feat          # optional sugar: same thing, but works from any cwd + fetches first
cd <printed path>           # edit + run the app here (the base rejects commits)
# quick / solo:
vt-land "msg"               # commit → fetch → rebase origin/dev-manu → fast LOCAL check → push --no-verify HEAD:dev-manu → nudge both caches
# reviewed:
vt-pr  "msg"                # push feature branch --no-verify + gh pr create --base dev-manu → CI → merge
```

**The gate (D8).** `vt-land`'s only gate is a FAST LOCAL check — the root
`typecheck` script (`pnpm --filter voicetree-webapp run check` = `tsc --noEmit`
+ e2e-taxonomy, exactly CI's `webapp-check` type job), run on this machine.
Override per-invocation with `VT_LAND_CHECK="<cmd>"` (empty = skip). Both helpers
commit AND push with `--no-verify`, bypassing the repo git hooks — pre-commit
(`tier<=0` + subgraph-health) and pre-push (`tier<=1`) — by design: `vt-land` is
the "no CI" quick path and `vt-pr`'s CI is the PR's. This is also load-bearing
for Mac-authored worktrees: both hooks run git INSIDE the worktree on the VM (via
`run-remote`), but the worktree's `.git` pointer is mirrored verbatim by the
`vt-wts` one-way-replica (it points at the Mac base) and mutagen continually
reverts any VM-side repair → git in the mirrored worktree fails. Bypassing the
hooks side-steps that; the full tiers still run in real CI on the PR (`vt-pr`).
Trade-off: the quick path no longer runs the pre-commit `pnpm-lock` sync check,
so add dependencies via `vt-pr` (CI catches lock drift), not `vt-land`.

The **daily-driver worktree** (`$VT_WORKTREE_ROOT/daily` on `daily-mac` /
`daily-vm`, created by the installer) is the stable "local dev" home so you never
reach back into the base. It falls behind origin until its next land/rebase.

These helpers are **machine-LOCAL commands, not `vt` subverbs** — on the VM `vt`
forwards to the Mac, so a `vt land` would run on the wrong machine. They act on
the local base/worktree and nudge the OTHER machine's cache by absolute path over
ssh (`ssh mac …` / `ssh $VT_REMOTE_HOST …`), never via the `vt` name.

## Enforcement — how "read-only" is real (2 layers + self-heal)

1. **Prevent (git-gate):** `scripts/dev-setup/git-gate/git-gate.sh` refuses
   `commit|merge|rebase|reset|cherry-pick|am|pull|revert|update-ref` (and a
   *mutating* `apply` — read-only `--check`/`--stat`/`--numstat`/`--summary`
   probes are allowed) in the **main worktree** of a voicetree clone (detected by
   `git-dir == git-common-dir` + origin URL). Linked worktrees are always
   writable. The daemon bypasses the whole gate with `VT_SYNC=1`.

   **This is a PATH-shim guardrail, not a hard boundary.** It only intercepts
   callers that resolve `git` through `$HOME/bin` — any actor invoking real git
   directly (`/usr/bin/git`, a shell alias, `gh`, the VoiceTree app / IDEs /
   language servers via libgit2/nodegit) edits the base freely. Because the base
   keeps a *real* pinned branch (below), such an out-of-band commit STICKS on the
   ref and the daemon then refuses to fast-forward over it → a persistent
   `diverged` alert until a manual re-pin. So the guard makes the *everyday*
   bypass hard; it does not make divergence impossible. (A daemon-installed
   `reference-transaction` / `pre-commit` hook in the base would catch all
   binaries and close the whole class — a possible future hardening, not built.)
2. **Pinned-branch ff-only (the base ref's only legitimate writer):** the base's
   `dev-manu` is advanced ONLY by the daemon's `merge --ff-only`. There is nothing
   for a user command to push that wouldn't be a no-op ff.
3. **Self-heal (the daemon, `vt-sync-base.sh`):** every ~10s (and on demand
   via `vt-sync` / `vt-land`) it runs `git fetch origin --prune` then
   `git merge --ff-only origin/$VT_BASE_BRANCH`. It NEVER resets over data: on a
   dirty / diverged / ff-collision base it raises an alert and retries
   idempotently. Alert delivery is best-effort on every path; the durable record
   is the daemon log (`~/.cache/vt-sync-base/vt-sync-base.log`). On the Mac the OS
   notification is the live channel; **on the headless VM the graph node is the
   primary channel** — there `notify-send` needs a `DISPLAY` and `wall` reaches no
   one, so set `VT_ALERT_PARENT_NODE` (configure-base threads it into the timer)
   for VM alerts to land. The VM's graph-create rides the `vt` forwarder over the
   reverse ssh tunnel to the Mac (where the graph lives), so VM alerting depends
   on that tunnel being up.

   _Verified 2026-05-31 (VM): a no-nudge push to origin/dev-manu reaches the
   other machine's base via the ~10s timer alone — confirmed cross-machine by
   the rollout orchestrator (VM→Mac ff in ~10s, self-heal in ~8s)._

## Components

| Component | Where | Runs on | Does |
|-----------|-------|---------|------|
| read-only guard | `git-gate/git-gate.sh` | both | refuse ref-moves in the base |
| base config | `common/configure-base.sh` (via `setup-{devbox,laptop}-env.sh --configure-base`) | both | pin branch ff, migration guard, daily worktree, timer |
| sync daemon | `remote/vt-sync-base.sh` | both | fetch + ff the base (self-heal + alert) |
| timer | systemd (VM) / launchd (Mac), written by configure-base | both | run the daemon every ~10s |
| `vt-sync` | `dev-flow/vt-sync` | both | ff this base now + nudge the other |
| `vt-land` / `vt-pr` | `dev-flow/` | both | the dev-flow one-liners above |
| `vt-worktree` | `dev-flow/vt-worktree` | both | thin sugar over `git worktree add` (from-any-cwd + fetch); placement/deps are git-gate's |

Kept mutagen sessions (created via `vt-remote.sh`): `vt-wts` (Mac→VM worktree
mirror) and the health-dashboard data syncs (`vt-csv-history`, `vt-reports`).

`vt-remote` (the `/root/vtrepo-synced` full-repo replica) is **retired in code**
— `install.sh` no longer creates it and `git-gate.sh` no longer references it —
but **the live session is not yet terminated**, because `scripts/run-remote.mjs`
still hard-codes `/root/vtrepo-synced` as the git-admin home for worktree remote
test runs (`REMOTE_ROOT`). Until `run-remote` is reworked to resolve worktree git
against a non-replica base, terminating `vt-remote` breaks `run-remote` from a
worktree. Since the dev-flow (`vt-land`/`vt-pr`) no longer touches `run-remote`
(it pushes `--no-verify` and checks locally), the only thing still depending on
the replica is `pnpm test`-style remote test runs. Teardown when that is reworked
or no agent needs remote test runs: `mutagen sync terminate vt-remote`.

**Deleting a PR branch under git-gate.** `gh pr close --delete-branch` shells
`git branch -D` with no TTY → git-gate blocks it (force-delete is a destructive
op the gate guards). For a **merged** PR the branch is fully merged, so the safe,
ungated `git branch -d <branch>` works — prefer it. For a closed-unmerged branch,
do the two steps explicitly (the force-delete is intentionally gated): close +
delete the remote branch with `gh pr close <pr>` then `git push origin --delete
<branch>`, and remove the local branch with an authorized `git branch -D` (the
gate prompts) only if you truly mean to discard unmerged work.

## Worktree placement (owned by the git wrapper, not the app)

The VoiceTree app is worktree-convention-free: it runs `git worktree add` with a
bare name and reads the resulting path back from git. ALL placement lives in the
machine-level git wrapper (`git-gate/git-gate.sh`), configured per machine via
`VT_WORKTREE_ROOT` (written by the git-gate installer):

| Machine        | Worktree root (`VT_WORKTREE_ROOT`) | Mirrored? |
| -------------- | ---------------------------------- | --------- |
| macOS          | `$HOME/repos/vt-wts-synced`        | yes (`vt-wts`) |
| Linux / remote | `$HOME/vt-wts`  (= `/root/vt-wts`) | no        |

Naming convention:
- `-synced` suffix = part of the mutagen mirror — the **same basename on both
  ends** of the sync.
- no suffix (`vt-wts`) = locally-authored, **not** mirrored.

Dependency install is routed by `VT_DEV_ROLE` (`mac` vs `remote`) in the worktree
async hook; `VT_DEV_ROLE` is used ONLY for dep routing, never to compute a path.

After a `worktree add`, git-gate normalizes the new worktree's admin pointers to
**relative** paths (host-portable, needed for cross-host mutagen sync) via
`git worktree repair --relative-paths`. That flag exists only on **git ≥ 2.48**;
on older git (e.g. the VM's 2.43) it falls back to a plain `worktree repair` and
the pointers stay absolute. That is harmless for VM-local `/root/vt-wts` trees
(they never sync across hosts), but the host-portable-pointer benefit for the
Mac's mirrored `vt-wts-synced` trees is unavailable until git is upgraded.
