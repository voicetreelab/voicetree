# Distributed dev architecture

## Per-machine branches: one writer per branch, integrate via `dev`

Each machine works on its **own** branch and owns it outright. Manu's two
machines use `dev-mac` (laptop) and `dev-remote` (devbox); the branch name is
**machine-local config** (`VT_DEV_BRANCH` in `~/.env`), never a literal in the
repo. When unset it defaults to the safe, non-shared sentinel `dev-new` — a
misconfigured machine must never check out or push straight to the shared
integration branch. Integration happens through pull requests to the shared
**`dev`** branch.

```
                         origin/dev  ◀── shared integration branch (PRs land here)
                         ▲    │
                  vt-pr  │    │  vt-sync  (merge origin/dev into your branch)
                   (PR)  │    ▼
   ┌─────────────────────┴──────────────────────┐
   │                                              │
 Mac checkout  ── branch dev-mac    (writable)  VM checkout ── branch dev-remote (writable)
   edit + commit directly here                    edit + commit directly here
   (worktrees optional)                           (worktrees optional)
```

Because exactly one machine owns each branch, there is **nothing to reconcile**:
no two writers can disagree on a branch, so the entire read-only-base apparatus
that used to make a *shared* base branch safe across two machines is gone — no
read-only cache, no branch pinning, no `git-gate` shim, no sync daemon, no timer.

- **Checkout** (`~/repos/vtrepo` on Mac, `/root/vtrepo` on the VM) = a normal,
  fully-writable clone sitting on this machine's `$VT_DEV_BRANCH`. Edit and commit
  directly.
- **Worktrees** = optional. Use them for parallel tasks; they branch off the
  integration branch (`origin/dev`) by default.
- A change reaches the team only via a PR to `dev`. Your machine branch stays
  local (or is pushed only as the PR head).

The one rule to hold, identical on Mac and VM:
**edit your own branch; integrate with a PR to `dev`.**

## Dev flow (same on either machine)

```
# work directly on your machine branch (the common case):
edit + git commit            # the checkout is writable; no worktree needed
vt-sync                      # fetch origin + merge origin/dev into your branch (catch up)
vt-pr "msg"                  # commit (if msg) + push your branch --no-verify + gh pr create --base dev

# or, for an isolated parallel task:
vt-worktree feat             # writable worktree off origin/dev under <parent>/vt-wts (deps installed)
cd <printed path>            # edit + run the app here
vt-pr "msg"                  # PR it to dev
```

- **`vt-sync`** — `git fetch origin` + `git merge --no-edit origin/dev` into your
  current branch. No daemon keeps you current anymore; this is the on-demand
  "catch up to dev". `--onto <branch>` to merge a different upstream.
- **`vt-pr`** — stages + commits (if given a message), pushes the current branch
  `--no-verify`, and opens a PR with `--base dev`. The gate for reviewed work is
  the PR's CI (`measures-budget-gate` on `pull_request`), not the local pre-push
  hook (which ships the tree to the VM via `run-remote` and is unreliable from a
  mutagen-mirrored worktree). `--onto <branch>` to target a different base.
- **`vt-worktree`** — optional. Creates a writable worktree off `origin/dev`,
  placed under this machine's sibling worktree root, with deps bootstrapped. It is
  the single owner of worktree placement now that `git-gate` is gone (see below).

`vt-land` is **deleted**: with a writable checkout it was just `git commit && git
push`; there is no read-only base to fast-forward and no other machine's cache to
nudge. Use plain git for local commits and `vt-pr` to integrate.

These helpers are **machine-LOCAL commands, not `vt` subverbs** — on the VM `vt`
forwards to the Mac, so a `vt sync` would run on the wrong machine. They act on
the local checkout/worktree only.

## Worktree placement (owned by `vt-worktree` + the app)

There is no `git` wrapper intercepting `git worktree add` anymore, so the two
real creators of worktrees own placement directly and identically:

- **`vt-worktree`** (CLI) resolves the base checkout, fetches `origin/<branch>`,
  and creates the worktree at an **absolute** destination under the machine's
  sibling worktree root (never a bare name, which git would nest inside the main
  checkout). It then runs `git worktree repair --relative-paths` (host-portable
  pointers for cross-host mutagen sync; falls back to a plain repair on git <
  2.48) and the async dependency bootstrap.
- **The VoiceTree app** (`webapp/.../gitWorktreeCommands.ts`) does the same: when
  no `git` wrapper is on PATH it owns placement, creating the worktree at an
  absolute path under `VT_WORKTREE_ROOT` and normalizing the same pointers.

| Machine        | Worktree root (`VT_WORKTREE_ROOT`) | Mirrored? |
| -------------- | ---------------------------------- | --------- |
| macOS          | `$HOME/vt-wts`                     | yes (`vt-wts` mutagen session) |
| Linux / remote | `$HOME/vt-wts`  (= `/root/vt-wts`) | no        |

Dependency install is routed by `VT_DEV_ROLE` (`mac` vs `remote`) in the worktree
async hook; `VT_DEV_ROLE` is used ONLY for dep routing, never to compute a path.
See `worktree-readme.md`.

## Setup

Per machine, one opt-in step puts the checkout on its branch and installs the
dev-flow commands:

```sh
# in ~/.env:  VT_DEV_BRANCH=dev-mac   (or dev-remote, etc.)
bash scripts/dev-setup/remote/setup-laptop-env.sh  --configure-checkout   # Mac
bash scripts/dev-setup/remote/setup-devbox-env.sh  --configure-checkout   # VM
```

`common/configure-checkout.sh` switches the checkout to `$VT_DEV_BRANCH` (creating
it off `origin/dev` if it does not exist), refuses to run over uncommitted work,
and installs `vt-sync` / `vt-pr` / `vt-worktree` on PATH. The full laptop→devbox
provisioning (clone, tooling, brain checkouts, ssh-mux) lives in
`remote/install.sh`.

## Components

| Component | Where | Does |
|-----------|-------|------|
| checkout config | `common/configure-checkout.sh` (via `setup-{devbox,laptop}-env.sh --configure-checkout`) | put the checkout on `$VT_DEV_BRANCH`, install dev-flow commands |
| `vt-sync` | `dev-flow/vt-sync` | merge `origin/dev` into your branch |
| `vt-pr` | `dev-flow/vt-pr` | push branch + open a PR to `dev` |
| `vt-worktree` | `dev-flow/vt-worktree` | optional writable worktree off `origin/dev` |
| branch resolution | `common/env.sh` (`dev_setup_resolve_dev_branch`) | `$VT_DEV_BRANCH` → `~/.env` → `dev-new` |

Kept mutagen sessions (created via `vt-remote.sh`, orthogonal to this model and
unchanged): `vt-wts` (Mac→VM worktree mirror) and the health-dashboard data syncs
(`vt-csv-history`, `vt-reports`).

`vt-remote` (the `/root/vtrepo-synced` full-repo replica) is **retired in code**
but **the live session is not yet terminated**, because `scripts/run-remote.mjs`
still hard-codes `/root/vtrepo-synced` as the git-admin home for worktree remote
test runs. Until `run-remote` resolves worktree git against a non-replica base,
terminating `vt-remote` breaks remote `pnpm test` from a worktree. Teardown when
that is reworked or no agent needs remote test runs: `mutagen sync terminate
vt-remote`.
