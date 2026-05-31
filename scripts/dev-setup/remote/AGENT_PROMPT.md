# Agent prompt: set up the Voicetree remote devbox

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

- `pwd` is the root of the local Mac checkout (normally `~/repos/vtrepo`; look for `package.json`
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
bash scripts/dev-setup/remote/vt-remote.sh brain-status
```

Poll until `vt-remote` contains `Status: Watching for changes`. Confirm
`brain-status` shows valid standalone Git checkouts for local `~/brain` and
remote `/root/brain`; brain is not Mutagen-synced.

## Smoke test

```bash
npm run test
```

Look for `[run-remote] ...` lines in the output proving the command actually
ran on the devbox. If you see no such lines, routing is broken — most
likely `VT_REMOTE_HOST` isn't being read from `.env`. Re-check the file.

## Verify code-search tools

`install.sh` installs the code-navigation tools CLAUDE.md / AGENTS.md tell
agents to prefer over grep. Confirm all three resolve on the devbox PATH:

```bash
ssh "$VT_REMOTE_HOST" 'for t in ast-grep ck cgcli; do command -v "$t" || echo "MISSING: $t"; done'
ssh "$VT_REMOTE_HOST" 'ast-grep --version && ck --version'
```

Expect a path for each (no `MISSING:` lines) and version strings for
`ast-grep` and `ck`. Notes:

- `ast-grep` is linked from an isolated prefix so it does **not** shadow the
  system `sg` (group) command — `command -v sg` should still be `/usr/bin/sg`.
- `cgcli` is a shim over the in-repo `@vt/code-graph-cli`; it runs under `tsx`,
  so it needs the worktree's `node_modules` installed. A bare `cgcli --help`
  proves the shim resolves; a `cgcli find-symbol <name>` proves deps are in
  place. If it reports `tsx missing`, run the package manager install in the
  repo first.
- `ck` on a non-x86_64 box has no prebuilt binary — the installer prints a
  manual-install note (`cargo install ck-search`) instead of failing.

## Optional: destructive-git prompt

```bash
bash scripts/dev-setup/git-gate/install.sh
```

Recommend it but don't push hard — it's a personal-safety preference.

## Report back to the user

In one short message:
- Devbox host (echo back so they can confirm)
- Mutagen session status for `vt-remote` and brain checkout status
- Smoke-test result (passed / failed + where it ran)
- Code-search tools present on PATH (`ast-grep`, `ck`, `cgcli`)
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
