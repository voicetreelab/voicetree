# Docker smoke tests

`smoke.sh` exercises a built VoiceTree image to confirm it actually boots.

## Run locally

```bash
docker build --platform=linux/amd64 -f docker/Dockerfile -t voicetree:smoke .
IMAGE=voicetree:smoke bash docker/test/smoke.sh
```

`--platform=linux/amd64` is required on Apple Silicon (the AppImage is
x86_64). The build runs under Rosetta emulation — slower but correct.

What it checks:

1. Container stays running for ≥5 seconds (catches immediate Electron crashes
   from missing libs).
2. All four background daemons are up: `Xvfb`, `openbox`, `x11vnc`,
   `websockify`.
3. `http://localhost:16080/vnc.html` returns 200 and the body mentions
   noVNC.
4. The VoiceTree main process (`/opt/voicetree/voicetree`) is alive.
5. `claude --version` succeeds inside the container.

Failure dumps the last 80 lines of container logs.

## Useful overrides

| Env var          | Default            | Purpose                                   |
|------------------|--------------------|-------------------------------------------|
| `IMAGE`          | `voicetree:smoke`  | image tag under test                      |
| `HOST_PORT`      | `16080`            | host port to map; bump if 16080 is taken  |
| `BOOT_TIMEOUT`   | `90`               | seconds to wait for daemons / processes   |
| `KEEP_CONTAINER` | unset              | set to `1` to leave the container running for manual inspection |

## CI

This script is invoked from `.github/workflows/docker.yml` on every PR to
`dev` that touches docker paths. PRs build the image (no push) and run
this smoke against it.
