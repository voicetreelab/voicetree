# Distributed dev architecture

Mac-owned source:
- `~/repos/vtrepo` -> `/root/vtrepo-synced`
- `~/repos/vt-wts` -> `/root/vt-wts-synced`

VM-owned source:
- `/root/vtrepo`
- `/root/vt-wts-remote`

Rules:
- `*-synced` is owned by Mac + Mutagen; do not edit as source of truth.
- VM agents that own their work use `/root/vtrepo` and `/root/vt-wts-remote`.
- Mac-created worktrees install deps locally and in `/root/vt-wts-synced`.
- VM-created worktrees install deps only in `/root/vt-wts-remote`.
