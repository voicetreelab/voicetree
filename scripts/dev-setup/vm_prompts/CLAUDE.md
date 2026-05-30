# Claude Code — Server Notes

## SSH to Mac (bobbobby's machine)

```bash
ssh -i ~/.ssh/id_ed25519_mac -p 2222 bobbobby@localhost
```

- Port 2222 on localhost (reverse tunnel from Mac)
- Passwordless auth set up (server key in Mac's authorized_keys)
- Mac public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMoI+zoCn1wM87rmFoWeqEZoSl31uUOQassVdja98McH orbstack`

## Running `vt` from this Linux box

`/usr/local/bin/vt` is a symlink to `scripts/dev-setup/remote/vt-mac.sh`
(installed by `scripts/dev-setup/remote/install.sh`). It transparently forwards
every `vt` invocation to the Mac's `vt` over the reverse tunnel above — just type
`vt <anything>`. It re-quotes argv (`printf %q`), forwards **stdin** (`-T`, no
`-n`), and forwards every `VOICETREE_*` env var, so your `VOICETREE_TERMINAL_ID`
carries through and the Mac's `vt` attributes nodes to you (no manual `-t`).
Connection knobs (env → default): `VT_MAC_SSH`=`bobbobby@localhost`,
`VT_MAC_SSH_PORT`=`2222`, `VT_MAC_SSH_KEY`=`~/.ssh/id_ed25519_mac`,
`VT_MAC_VT`=`/usr/local/bin/vt`, `VT_MAC_PROJECT`=`/Users/bobbobby/brain`.

Write a progress node in ONE command via live-mode stdin — no file copied to the Mac.
`graph create` reads `{nodes:[{filename,title,summary,content?,color?}], parentNodeId?}`;
live-mode root nodes need an explicit `parentNodeId` (your `$TASK_NODE_PATH`); declare
other parents with `- parent [[other-filename]]` lines inside `content`:

```bash
python3 -c '
import json,sys
payload={"parentNodeId":"<TASK_NODE_PATH>","nodes":[
  {"filename":"my-node","title":"…","summary":"…","color":"green","content":open("body.md").read()}]}
sys.stdout.write(json.dumps(payload))' | vt graph create
```

(Node limit is 80 lines — split into a parent+child tree rather than overriding.)
