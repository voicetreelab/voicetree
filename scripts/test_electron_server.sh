#!/bin/bash
# Quick test script to verify Electron app can start server and health check passes

set -e

echo "======================================"
echo "Quick Electron Server Integration Test"
echo "======================================"
echo ""

# Check if server is built
if [ ! -f "out/resources/server/voicetree-server" ]; then
    echo "❌ Server not built. Run ./scripts/build_server.sh first"
    exit 1
fi

echo "✅ Server executable found"

# Build electron (fast, no server rebuild)
echo "Building Electron app..."
cd frontend/webapp
npm run electron:build > /dev/null 2>&1 || {
    echo "❌ Electron build failed"
    exit 1
}

echo "✅ Electron built"

# Start Electron in background
echo "Starting Electron app with server..."
npm run electron:prod > /tmp/electron_test.log 2>&1 &
ELECTRON_PID=$!

# Give it time to start
echo "Waiting for server to start..."
sleep 5

# Test health endpoint
echo "Testing server health endpoint..."
if curl -s http://localhost:8001/health > /dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s http://localhost:8001/health)
    echo "✅ Server health check PASSED!"
    echo "   Response: $HEALTH_RESPONSE"
    RESULT=0
else
    echo "❌ Server health check FAILED"
    echo ""
    echo "Electron logs:"
    cat /tmp/electron_test.log | tail -20
    RESULT=1
fi

# Clean up
echo ""
echo "Cleaning up..."
kill $ELECTRON_PID 2>/dev/null || true

# Wait a bit for process to die
sleep 2

# Force kill if still running
pkill -f "electron.*voicetree" 2>/dev/null || true

cd ../..

if [ $RESULT -eq 0 ]; then
    echo ""
    echo "======================================"
    echo "✅ TEST PASSED - Server integration works!"
    echo "======================================"
else
    echo ""
    echo "======================================"
    echo "❌ TEST FAILED - Check the logs above"
    echo "======================================"
fi

exit $RESULT