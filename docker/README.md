# Sandboxed VoiceTree (Docker)

Runs the released VoiceTree AppImage inside a container with a virtual
desktop, accessible from your browser. Use this when you want Claude Code
(or other terminal agents) to work without any ability to touch your host
filesystem.

> **Architecture:** `linux/amd64` only — the published AppImage is x86_64.
> Apple Silicon Macs run this image under emulation (Rosetta via Docker
> Desktop / OrbStack / Colima). It works, but slower than native. A native
> arm64 image (from source) is on the roadmap.

## Quick start

```bash
cp .env.example .env        # fill in ANTHROPIC_API_KEY (or leave blank + OAuth in-container)
docker compose up -d
open http://localhost:6080/vnc.html?autoconnect=1&resize=remote
```

Or without compose:

```bash
docker run -d --rm --name voicetree \
    -p 6080:6080 \
    -v voicetree-project:/home/vt/project \
    -v voicetree-claude:/home/vt/.config/claude \
    --shm-size=1g \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    ghcr.io/voicetreelab/voicetree:latest
```

Then open `http://localhost:6080/vnc.html?autoconnect=1&resize=remote`.

## What you get

- **VoiceTree desktop app** running on a virtual display, served over noVNC.
- **Claude Code** preinstalled. Run `claude` in any terminal VoiceTree spawns.
- **Persistent named volumes**:
  - `voicetree-project` → `/home/vt/project` (your markdown graph; survives container recreates)
  - `voicetree-claude` → `/home/vt/.config/claude` (auth tokens; log in once)
- **No browser** is preinstalled. Set `ANTHROPIC_API_KEY` to skip Claude Code's OAuth flow, or `apt-get install` a browser yourself inside a running container if you really need it.

## Isolation guarantees

The container only sees:
- its own filesystem (ephemeral except for the two named volumes above)
- outbound network
- inbound: `localhost:6080` from the host

It does **not** see your home directory, your projects, your SSH keys, or
anything else on the host. An agent doing `rm -rf /` inside the container
only destroys the container. Recreate it with `docker compose up -d`.

## Add more agents

```bash
docker exec -it voicetree bash -lc install-agents.sh
```

Installs `codex`, `opencode`, and `gemini` alongside Claude Code. Skipped by
default to keep the base image small.

## Build locally

```bash
docker build --platform=linux/amd64 -f docker/Dockerfile -t voicetree:dev .
# or pin a version:
docker build --platform=linux/amd64 -f docker/Dockerfile \
    --build-arg VOICETREE_VERSION=v2.9.16 -t voicetree:2.9.16 .
```

`--platform=linux/amd64` is required on Apple Silicon hosts — Docker
Desktop defaults to your native architecture (arm64) and the published
AppImage is x86_64-only. The build runs under Rosetta; it's slower but
produces the correct image.

## Performance knobs

- `SCREEN_GEOMETRY` env var: default `1600x1000x24`. Bump if your monitor is
  bigger.
- `--shm-size=1g`: Chromium/Electron writes a lot to `/dev/shm`. Smaller
  values cause renderer crashes.

## Known limits (MVP)

- amd64 only.
- Voice mode (microphone input) is not wired through; container has no
  audio device by default.
- GPU acceleration is off — Electron falls back to software rendering inside
  Xvfb. Fine for the graph; visible on heavy animations.
