#!/usr/bin/env bash
set -euo pipefail

# Start a virtual desktop, expose it via noVNC at :6080, then run VoiceTree
# inside it. Signals propagate through tini (PID 1) -> this script -> child
# processes; we forward SIGTERM explicitly to give VoiceTree a chance to
# shutdown cleanly.

VNC_PORT=${VNC_PORT:-5900}
NOVNC_PORT=${NOVNC_PORT:-6080}
SCREEN_GEOMETRY=${SCREEN_GEOMETRY:-1600x1000x24}
APPDIR=/opt/voicetree
VOICETREE_BIN=$APPDIR/voicetree-webapp

# Replicates what the AppImage's AppRun script does, without its broken
# AppDir auto-detection (which mis-parses --no-sandbox as a filename).
export APPDIR
export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export XDG_DATA_DIRS="$APPDIR/usr/share/:${XDG_DATA_DIRS:-/usr/share:/usr/local/share}"
export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:$GSETTINGS_SCHEMA_DIR}"

pids=()
cleanup() {
    for pid in "${pids[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    wait
}
trap cleanup EXIT TERM INT

# Virtual X server.
Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp -ac &
pids+=($!)

# Wait for Xvfb to accept connections (max ~5s).
for _ in $(seq 1 50); do
    if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
    sleep 0.1
done

openbox --config-file /etc/xdg/openbox/rc.xml &
pids+=($!)

# VNC server attached to the virtual display.
x11vnc -display "$DISPLAY" -nopw -forever -shared -rfbport "$VNC_PORT" -quiet &
pids+=($!)

# Browser-accessible VNC. websockify ships novnc's vnc.html as the web root,
# so visiting http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1 works.
websockify --web=/usr/share/novnc "$NOVNC_PORT" "localhost:$VNC_PORT" &
pids+=($!)

echo "[entrypoint] desktop ready at http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=remote"
echo "[entrypoint] project: $VOICETREE_PROJECT"

# Electron in a container requires --no-sandbox unless we set up user
# namespaces; the outer container already provides the sandbox boundary that
# matters here.
exec "$VOICETREE_BIN" --no-sandbox "$@"
