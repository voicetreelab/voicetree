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
    VOICETREE_VAULT=/home/vt/vault

# System dependencies: virtual X stack, Electron runtime libs, VNC, Node (for
# agent CLIs that ship as npm packages), git, curl. libasound2t64 is the
# renamed-in-24.04 successor to libasound2.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget git tini sudo \
        xvfb x11vnc openbox xterm \
        novnc websockify \
        fonts-liberation fonts-noto-core \
        firefox-esr \
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
RUN useradd --create-home --shell /bin/bash --uid 1000 vt \
    && mkdir -p /home/vt/vault /home/vt/.config/claude "$XDG_RUNTIME_DIR" \
    && chown -R vt:vt /home/vt "$XDG_RUNTIME_DIR" \
    && chmod 700 "$XDG_RUNTIME_DIR"

# Fetch and extract the AppImage at build time, so the image is self-contained
# and tagged with a known VoiceTree version. --appimage-extract avoids needing
# FUSE in the running container.
WORKDIR /opt
RUN set -eux; \
    if [ "$VOICETREE_VERSION" = "latest" ]; then \
        URL="https://github.com/voicetreelab/voicetree/releases/latest/download/voicetree.AppImage"; \
    else \
        URL="https://github.com/voicetreelab/voicetree/releases/download/${VOICETREE_VERSION}/voicetree.AppImage"; \
    fi; \
    curl -fL --retry 3 -o voicetree.AppImage "$URL"; \
    chmod +x voicetree.AppImage; \
    ./voicetree.AppImage --appimage-extract >/dev/null; \
    mv squashfs-root voicetree; \
    rm voicetree.AppImage; \
    chown -R vt:vt /opt/voicetree

COPY --chown=vt:vt docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=vt:vt docker/install-agents.sh /usr/local/bin/install-agents.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/install-agents.sh

USER vt
WORKDIR /home/vt
VOLUME ["/home/vt/vault", "/home/vt/.config/claude"]
EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
