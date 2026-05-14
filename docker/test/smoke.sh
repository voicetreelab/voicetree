#!/usr/bin/env bash
# Smoke tests for the VoiceTree container image. Assumes the image is
# already built and present in the local docker daemon.
#
# Usage:
#   docker build -f docker/Dockerfile -t voicetree:smoke .
#   IMAGE=voicetree:smoke bash docker/test/smoke.sh
#
# Override with env vars:
#   IMAGE          tag of the image to test (default: voicetree:smoke)
#   HOST_PORT      port on the host to map to container's 6080 (default: 16080)
#   BOOT_TIMEOUT   seconds to wait for processes/HTTP to come up (default: 90)

set -uo pipefail

IMAGE=${IMAGE:-voicetree:smoke}
NAME=vt-smoke-$$
HOST_PORT=${HOST_PORT:-16080}
BOOT_TIMEOUT=${BOOT_TIMEOUT:-90}

PASS=0; FAIL=0
log()  { printf '\n--- %s ---\n' "$1"; }
ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS+1)); }
ng()   { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }

cleanup() {
    if [ "${KEEP_CONTAINER:-0}" = "1" ]; then
        echo "Leaving container $NAME running (KEEP_CONTAINER=1)"
        return
    fi
    echo
    echo "--- container logs (last 80 lines) ---"
    docker logs "$NAME" 2>&1 | tail -80 || true
    docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "ERROR: image '$IMAGE' not found locally. Build it first:"
    echo "  docker build -f docker/Dockerfile -t $IMAGE ."
    exit 2
fi

log "Starting container ($IMAGE -> :$HOST_PORT)"
docker run -d --name "$NAME" -p "${HOST_PORT}:6080" --shm-size=1g "$IMAGE" >/dev/null

# --- Test 1: container is running ----------------------------------------
log "1. Container is running after boot"
sleep 5
if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]; then
    ok "container is up"
else
    ng "container exited during startup"
    exit 1   # Nothing else can succeed if the container isn't running
fi

# --- Test 2: all background daemons running ------------------------------
log "2. Background daemons running (Xvfb / openbox / x11vnc / websockify)"
needed=(Xvfb openbox x11vnc websockify)
missing=()
deadline=$((SECONDS + BOOT_TIMEOUT))
while [ $SECONDS -lt $deadline ]; do
    missing=()
    for p in "${needed[@]}"; do
        docker exec "$NAME" pgrep -f "$p" >/dev/null 2>&1 || missing+=("$p")
    done
    [ ${#missing[@]} -eq 0 ] && break
    sleep 2
done
if [ ${#missing[@]} -eq 0 ]; then
    ok "Xvfb, openbox, x11vnc, websockify all present"
else
    ng "missing after ${BOOT_TIMEOUT}s: ${missing[*]}"
fi

# --- Test 3: noVNC HTTP responds -----------------------------------------
log "3. noVNC serves vnc.html on :$HOST_PORT"
status=000
deadline=$((SECONDS + 30))
while [ $SECONDS -lt $deadline ]; do
    status=$(curl -fsS -o /tmp/vncpage.$$ -w '%{http_code}' \
        "http://localhost:${HOST_PORT}/vnc.html" 2>/dev/null || echo 000)
    [ "$status" = "200" ] && break
    sleep 1
done
if [ "$status" = "200" ] && grep -qi "noVNC" /tmp/vncpage.$$; then
    ok "noVNC page reachable (HTTP 200, body mentions noVNC)"
else
    ng "noVNC unreachable (last status=$status)"
fi
rm -f /tmp/vncpage.$$

# --- Test 4: VoiceTree process is alive ----------------------------------
# Electron forks several helper processes; matching on the main binary path
# is the reliable signal.
log "4. VoiceTree process running inside container"
deadline=$((SECONDS + BOOT_TIMEOUT))
while [ $SECONDS -lt $deadline ]; do
    if docker exec "$NAME" pgrep -f /opt/voicetree/voicetree >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
if docker exec "$NAME" pgrep -f /opt/voicetree/voicetree >/dev/null 2>&1; then
    ok "voicetree process is running"
else
    ng "no voicetree process found after ${BOOT_TIMEOUT}s"
fi

# --- Test 5: claude-code CLI is available --------------------------------
log "5. Claude Code CLI is installed and reports a version"
if docker exec "$NAME" bash -lc 'command -v claude >/dev/null && claude --version' >/dev/null 2>&1; then
    ok "claude CLI present and runnable"
else
    ng "claude CLI not on PATH (or --version failed)"
fi

# --- summary -------------------------------------------------------------
echo
echo "=========================================="
printf "  %d passed, %d failed\n" "$PASS" "$FAIL"
echo "=========================================="
[ $FAIL -eq 0 ]
