# syntax=docker/dockerfile:1.7
#
# Sandboxed VoiceTree runtime.
#
# Runs the released voicetree.AppImage inside a virtual desktop (Xvfb +
# openbox), reachable from the host via a browser at http://localhost:6080
# (noVNC). Intended use: contain agent activity (Claude Code etc.) so it
# cannot touch the host filesystem.
#
# Architecture: linux/amd64 only. The published AppImage is x86_64.

FROM ubuntu:24.04

ARG VOICETREE_VERSION=latest
ARG NOVNC_VERSION=1.5.0
ARG WEBSOCKIFY_VERSION=0.12.0

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/runtime-vt \
    VOICETREE_PROJECT=/home/vt/project

# System dependencies: virtual X stack, Electron runtime libs, VNC, Node (for
# agent CLIs that ship as npm packages), git, curl. libasound2t64 is the
# renamed-in-24.04 successor to libasound2.
# No browser is installed in the base image; on Ubuntu 24.04 Firefox is
# distributed as a snap which doesn't work inside a plain container.
# Set ANTHROPIC_API_KEY in .env to skip Claude Code's OAuth-browser flow,
# or apt-install a browser yourself inside a running container.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget git tini sudo \
        squashfs-tools \
        xvfb x11vnc openbox xterm \
        novnc websockify \
        fonts-liberation fonts-noto-core \
        nodejs npm \
        # Electron runtime deps
        libnss3 libnspr4 libdbus-1-3 \
        libatk1.0-0t64 libatk-bridge2.0-0t64 \
        libcups2t64 libdrm2 libgbm1 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
        libxshmfence1 libxss1 libxtst6 \
        libgtk-3-0t64 libpango-1.0-0 libcairo2 \
        libasound2t64 libnotify4 \
    && rm -rf /var/lib/apt/lists/*

# Agent CLIs preinstalled. Claude Code is the priority; others (codex,
# opencode, gemini) can be added via docker/install-agents.sh inside the
# container.
RUN npm install -g @anthropic-ai/claude-code

# Non-root user. uid 1000 lines up with the default host user on most Linux
# distros, which makes bind-mounting feel natural if a user opts in.
# Ubuntu 24.04 ships a placeholder `ubuntu` user at uid 1000, so we remove
# it first to free the uid.
RUN userdel -r ubuntu 2>/dev/null || true \
    && useradd --create-home --shell /bin/bash --uid 1000 vt \
    && mkdir -p /home/vt/project /home/vt/.config/claude "$XDG_RUNTIME_DIR" \
    && chown -R vt:vt /home/vt "$XDG_RUNTIME_DIR" \
    && chmod 700 "$XDG_RUNTIME_DIR"

# Fetch and extract the AppImage at build time.
#
# We unpack the embedded SquashFS directly with unsquashfs rather than running
# ./voicetree.AppImage --appimage-extract, because the AppImage's prepended
# ELF runtime wrapper does not survive non-native execution (e.g. Rosetta or
# binfmt-misc emulation) — "exec format error". The SquashFS payload itself
# is architecture-neutral filesystem data; unsquashfs reads it directly.
#
# Offset of the squashfs payload = end of the ELF section header table:
#     e_shoff + e_shentsize * e_shnum
# all read straight from the 64-bit ELF header (LE on x86-64).
WORKDIR /opt
RUN set -eux; \
    if [ "$VOICETREE_VERSION" = "latest" ]; then \
        URL="https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.AppImage"; \
    else \
        URL="https://github.com/voicetreelab/voicetree/releases/download/${VOICETREE_VERSION}/voicetree.AppImage"; \
    fi; \
    curl -fL --retry 3 -o voicetree.AppImage "$URL"; \
    e_shoff=$(od -An -j40 -N8 -tu8 voicetree.AppImage | tr -d ' '); \
    e_shentsize=$(od -An -j58 -N2 -tu2 voicetree.AppImage | tr -d ' '); \
    e_shnum=$(od -An -j60 -N2 -tu2 voicetree.AppImage | tr -d ' '); \
    offset=$((e_shoff + e_shentsize * e_shnum)); \
    echo "squashfs offset: $offset"; \
    unsquashfs -no-progress -o "$offset" -d voicetree voicetree.AppImage; \
    rm voicetree.AppImage; \
    chown -R vt:vt /opt/voicetree

COPY --chown=vt:vt docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=vt:vt docker/install-agents.sh /usr/local/bin/install-agents.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/install-agents.sh

USER vt
WORKDIR /home/vt
VOLUME ["/home/vt/project", "/home/vt/.config/claude"]
EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
