# Worktree setup

Worktree dependency setup depends on where the worktree is created.

The role is machine-local and is read from `VT_DEV_ROLE` first, then `~/.env`.
Do not put `VT_DEV_ROLE` in the repo `.env`; the repo `.env` is synced to the
remote VM.

## Local Mac worktree creation path

When a worktree is created on the local Mac:

- install dependencies on the Mac worktree
- install dependencies on the matching remote worktree

This is intentional. Agents run on the Mac, while tests run on the remote VM.
The marginal disk cost is small because pnpm reuses the machine-wide store.

Expected machine-local config:

```sh
VT_DEV_ROLE=mac
VT_REMOTE_HOST=root@<devbox-host>
```

## Remote worktree creation path

When a worktree is created directly on the remote VM:

- install dependencies only on the remote worktree

Agents run on the remote VM, and tests also run on the remote VM, so there is
no local Mac worktree dependency setup to perform.

Expected machine-local config:

```sh
VT_DEV_ROLE=remote
```
