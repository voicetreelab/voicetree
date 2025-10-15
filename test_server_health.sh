#!/bin/bash
# Quick test to verify Python server starts with Electron app

set -e

echo "======================================"
echo "Testing Python Server Integration"
echo "======================================"
echo ""

# Check if server is built
if [ ! -f "dist/resources/server/voicetree-server" ]; then
    echo "❌ Server not built. Run ./build_server.sh first"
    exit 1
fi

echo "✅ Server executable found"

# Build electron quietly
echo "Building Electron app..."
cd frontend/webapp
npm run electron:build > /dev/null 2>&1 || {
    echo "❌ Electron build failed"
    exit 1
}
echo "✅ Electron built"

# Start Electron in background, capture both stdout and stderr
echo "Starting Electron app with integrated server..."
npm run electron:prod > /tmp/electron_test.log 2>&1 &
ELECTRON_PID=$!

echo "Waiting for server to start (PID: $ELECTRON_PID)..."

# Try health check multiple times
MAX_ATTEMPTS=10
ATTEMPT=1
SUCCESS=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo -n "  Attempt $ATTEMPT/$MAX_ATTEMPTS: "

    if curl -s http://localhost:8001/health > /dev/null 2>&1; then
        HEALTH_RESPONSE=$(curl -s http://localhost:8001/health)
        echo "✅ Server responded!"
        echo "    Response: $HEALTH_RESPONSE"
        SUCCESS=true
        break
    else
        echo "⏳ Not ready yet..."
        sleep 2
    fi

    ATTEMPT=$((ATTEMPT + 1))
done

# Clean up
echo ""
echo "Shutting down..."
kill $ELECTRON_PID 2>/dev/null || true

# Wait for graceful shutdown
sleep 2

# Force kill if still running
pkill -f "electron.*voicetree" 2>/dev/null || true
pkill -f "voicetree-server" 2>/dev/null || true

cd ../..

# Show results
echo ""
if [ "$SUCCESS" = true ]; then
    echo "======================================"
    echo "✅ SUCCESS - Python server is working!"
    echo "======================================"
    echo ""
    echo "The integrated server started and responded to health checks."
    exit 0
else
    echo "======================================"
    echo "❌ FAILED - Server didn't respond"
    echo "======================================"
    echo ""
    echo "Last 30 lines of Electron log:"
    echo "------------------------------"
    tail -30 /tmp/electron_test.log
    exit 1
fi