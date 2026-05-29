# Agent prompt: set up the voicetree-public remote devbox

You are configuring this laptop to route heavy dev commands (`npm run test`,
perf runs, e2e) to the user's own remote dev box via mutagen + ssh.
The scripts in `scripts/dev-setup/remote/` are the source of truth. Your job
is to gather the inputs, run the scripts, verify the result, and report cleanly.

## Inputs to gather from the user before doing anything

Ask the user for:

1. **`VT_REMOTE_HOST`** — the SSH target for their devbox, in
   `user@host` form, e.g. `root@1.2.3.4`.
2. Confirmation that their **SSH public key is already on the box**
   (`~/.ssh/authorized_keys` for that user). If not, stop and tell them
   to add it first; do not attempt password auth.

Do not assume or invent the IP. Do not share a box with another dev.

## Preconditions to verify before running the installer

- `pwd` is the root of a `voicetree-public` checkout (look for `package.json`
  with `"name": "voicetree-public"` and a `scripts/dev-setup/remote/` dir).
- `mutagen` is on PATH. If not: `brew install mutagen-io/mutagen/mutagen`
  (or the platform equivalent) and `mutagen daemon start`.
- `ssh -o BatchMode=yes -o ConnectTimeout=5 "$VT_REMOTE_HOST" 'hostname'`
  succeeds. If it fails, surface the error and stop — do not proceed.

## Run the installer

```bash
VT_REMOTE_HOST=<value-from-user> bash scripts/dev-setup/remote/install.sh
```

`install.sh` delegates environment setup to these scripts:

- `scripts/dev-setup/remote/setup-laptop-env.sh`
- `scripts/dev-setup/remote/setup-devbox-env.sh`
- `scripts/dev-setup/remote/write-env-value.sh`

Do not duplicate their internals in the prompt or in ad hoc shell commands.

If pre-seed fails (e.g. branch doesn't exist on origin), re-run with
`--skip-pre-seed`. Mutagen will then push the full working tree on first
sync — slower but always works.

## Wait for steady state

```bash
mutagen sync list vt-remote
```

Poll until the output contains `Status: Watching for changes`. First sync
with a pre-seeded devbox should take well under a minute; without pre-seed,
several minutes depending on uplink.

## Smoke test

```bash
npm run test
```

Look for `[run-remote] ...` lines in the output proving the command actually
ran on the devbox. If you see no such lines, routing is broken — most
likely `VT_REMOTE_HOST` isn't being read from `.env`. Re-check the file.

## Optional: destructive-git prompt

```bash
bash scripts/dev-setup/git-gate/install.sh
```

Recommend it but don't push hard — it's a personal-safety preference.

## Report back to the user

In one short message:
- Devbox host (echo back so they can confirm)
- Mutagen session status (`Watching for changes` or whatever it is)
- Smoke-test result (passed / failed + where it ran)
- Anything you skipped or that failed

## Gotchas to flag if relevant

- **Worktrees**: if they use VT worktrees later, the per-worktree
  `.env` symlink must exist for repo env compatibility. The worktree hooks and
  `scripts/dev-setup/git-gate/git-gate.sh` handle it when they create worktrees.
- **`VT_REMOTE_HOST` is read from process env, `~/.env`, or repo `.env`** —
  not from `~/.zshrc`. Don't suggest putting it there.
- **`.env` is gitignored** but **is** synced to the devbox by mutagen.
  Anything in `.env` lands on the remote box. Don't put secrets in it
  that shouldn't be on the devbox.
- **`VT_DEV_ROLE` belongs in `~/.env`, not repo `.env`**. Repo `.env` is
  synced to the devbox, but `VT_DEV_ROLE` must remain machine-local.

## Do not

- Auto-install Homebrew or any package manager. Ask first.
- Use `ssh -o StrictHostKeyChecking=no` outside what `install.sh` already
  does. If you hit a host-key prompt, surface it to the user.
- Run `mutagen sync terminate` or `--force` on existing sessions to "make
  it work". If something is in a bad state, report it and ask.
- Push, rebase, or modify any branches.
