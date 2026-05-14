# Sandboxed VoiceTree (Docker)

Runs the released VoiceTree AppImage inside a container with a virtual
desktop, accessible from your browser. Use this when you want Claude Code
(or other terminal agents) to work without any ability to touch your host
filesystem.

> **Architecture:** multi-arch (`linux/amd64` + `linux/arm64`). `docker pull`
> automatically selects the variant matching your host — Apple Silicon Macs
> get the native arm64 image, no Rosetta emulation.

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
    -v voicetree-vault:/home/vt/vault \
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
  - `voicetree-vault` → `/home/vt/vault` (your markdown graph; survives container recreates)
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
docker build -f docker/Dockerfile -t voicetree:dev .
# or pin a version:
docker build -f docker/Dockerfile \
    --build-arg VOICETREE_VERSION=v2.9.16 -t voicetree:2.9.16 .
```

The build picks up your host architecture automatically (amd64 or arm64).
To cross-build (e.g. produce both arches from one machine) use
`docker buildx build --platform=linux/amd64,linux/arm64 ...`.

## Performance knobs

- `SCREEN_GEOMETRY` env var: default `1600x1000x24`. Bump if your monitor is
  bigger.
- `--shm-size=1g`: Chromium/Electron writes a lot to `/dev/shm`. Smaller
  values cause renderer crashes.

## Known limits (MVP)

- Voice mode (microphone input) is not wired through; container has no
  audio device by default.
- GPU acceleration is off — Electron falls back to software rendering inside
  Xvfb. Fine for the graph; visible on heavy animations. Native arm64
  doesn't change this — Docker Desktop on macOS does not pass the host GPU
  into containers.
