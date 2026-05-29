# Claude Code — Server Notes

## SSH to Mac (bobbobby's machine)

```bash
ssh -i ~/.ssh/id_ed25519_mac -p 2222 bobbobby@localhost
```

- Port 2222 on localhost (reverse tunnel from Mac)
- Passwordless auth set up (server key in Mac's authorized_keys)
- Mac public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMoI+zoCn1wM87rmFoWeqEZoSl31uUOQassVdja98McH orbstack`
