# Distributed dev architecture

## Worktree placement (owned by the git wrapper, not the app)

The VoiceTree app is worktree-convention-free: it runs `git worktree add` with a
bare name and reads the resulting path back from git. ALL placement lives in the
machine-level git wrapper (`scripts/dev-setup/git-gate/git-gate.sh`), configured
per machine via `VT_WORKTREE_ROOT` (written by the git-gate installer):

| Machine        | Worktree root (`VT_WORKTREE_ROOT`) | Mirrored? |
| -------------- | ---------------------------------- | --------- |
| macOS          | `$HOME/repos/vt-wts-synced`        | yes       |
| Linux / remote | `$HOME/vt-wts`  (= `/root/vt-wts`) | no        |

Naming convention:
- `-synced` suffix = "part of the mutagen mirror" — the **same basename on both
  ends** of the sync.
- no suffix (`vt-wts`) = locally-authored, **not** mirrored.

## Source trees

Mac-owned source (mirrored to the remote via mutagen):
- `~/repos/vtrepo`          ↔ `/root/vtrepo-synced`
- `~/repos/vt-wts-synced`   ↔ `/root/vt-wts-synced`

Remote-owned source (lives only on the dev box, not mirrored):
- `/root/vtrepo`
- `/root/vt-wts`

## Placement map

- Mac authors a worktree  → `~/repos/vt-wts-synced/<name>` → mutagen →
  remote `/root/vt-wts-synced/<name>`.
- Remote authors a worktree → `/root/vt-wts/<name>` (local, not mirrored).

## Rules

- `*-synced` is owned by Mac + mutagen; do not edit it as source of truth on the
  remote.
- Remote agents that own their work use `/root/vtrepo` and `/root/vt-wts`.
- Dependency install is routed by `VT_DEV_ROLE` (`mac` vs `remote`) in the
  worktree async hook — Mac-created worktrees install deps locally and in the
  synced root; remote-created worktrees install deps only in `/root/vt-wts`.
  `VT_DEV_ROLE` is used ONLY for dep routing, never to compute a worktree path.
