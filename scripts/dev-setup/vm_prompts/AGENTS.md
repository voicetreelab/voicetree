# VoiceTree Devbox — Agent Instructions

## Directory Layout

| Path | Purpose |
|------|---------|
| `/root/vtrepo` | Direct git clone (non-synced), use for git operations |
| `/root/vtrepo-synced` | Mutagen one-way replica from Mac — **do not git commit here** |
| `/root/vt-wts/` | Worktree directory (branches off `/root/vtrepo`) |
| `/root/brain-real` | Standalone brain repo clone |
| `/root/brain` | Symlink → `/root/brain-real` |

## SSH to Mac (reverse tunnel)

```bash
ssh -i ~/.ssh/id_ed25519_mac -p 2222 bobbobby@localhost
```

Requires the reverse tunnel to be active (started from the Mac side).

## GitHub

Authenticated via `gh` CLI (HTTPS). Git is configured to rewrite `git@github.com:` → `https://github.com/`.

## Key Rules

1. **Never commit in `/root/vtrepo-synced`** — it is a one-way mutagen replica from the Mac.
2. **Use `/root/vtrepo` or worktrees in `/root/vt-wts/`** for any git operations.
3. **pnpm** is the package manager (via corepack). Use `pnpm install --frozen-lockfile`.
4. **earlyoom** is active — protects against OOM on runaway processes.
5. **Node.js 22** is installed via nodesource.

## Discovering Machine Specs

Run `lscpu`, `free -h`, `lsblk`, `hostname -I` to discover this machine's hardware.
