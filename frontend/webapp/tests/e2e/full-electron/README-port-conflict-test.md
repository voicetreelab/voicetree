# Port Conflict Resolution E2E Test

## Overview

This test validates the complete e2e flow of backend port discovery and API integration:

1. **Port Blocking**: Port 8001 is artificially blocked before Electron starts
2. **Dynamic Port Discovery**: Electron server manager finds port 8002
3. **IPC Port Communication**: Main process exposes port 8002 to renderer
4. **Lazy Backend Initialization**: Frontend auto-initializes backend connection on first API call
5. **API Call Verification**: Confirms `/load-directory` is called on correct port (8002)

## Prerequisites

### Build the Python Backend Server

The test requires the VoiceTree Python backend server to be built as a standalone executable:

```bash
# From the VoiceTree/backend directory
# TODO: Add build command here once build_server.sh is created
# For now, the server is started by Electron's ServerManager
```

### Build the Electron App

```bash
# From frontend/webapp directory
npm run electron:build
# or
npx electron-vite build
```

## Running the Test

```bash
# Run only the port conflict test
npx playwright test electron-port-conflict-resolution.spec.ts --config=playwright-electron.config.ts

# Run with UI mode for debugging
npx playwright test electron-port-conflict-resolution.spec.ts --config=playwright-electron.config.ts --ui

# Run in headed mode (see the Electron window)
MINIMIZE_TEST=0 npx playwright test electron-port-conflict-resolution.spec.ts --config=playwright-electron.config.ts
```

## Test Flow

```
┌─────────────────────────────────────────┐
│ 1. Test Setup: Block Port 8001         │
│    net.Server listening on 0.0.0.0:8001│
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 2. Electron Starts                      │
│    ServerManager.start()                │
│    → findAvailablePort(8001)            │
│    → Port 8001 blocked                  │
│    → Try port 8002 ✓                    │
│    → Spawn Python server on 8002        │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 3. IPC Port Exposure                    │
│    ipcMain.handle('get-backend-port')   │
│    → returns 8002                       │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 4. User Opens Folder (UI Action)       │
│    useFolderWatcher.startWatching()      │
│    → IPC: startFileWatching()           │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 5. File Watch Manager Calls Backend    │
│    FileWatchHandler.notifyBackend()     │
│    → loadDirectory(directoryPath)      │
│    → backend-api.ts invoked             │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 6. Lazy Backend Initialization          │
│    getBackendBaseUrl()                  │
│    → if (!backendPort)                  │
│    →   initializeBackendConnection()    │
│    →   IPC: getBackendPort() → 8002     │
│    → return http://localhost:8002       │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 7. HTTP Request to Backend              │
│    fetch('http://localhost:8002/...')   │
│    ✓ POST /load-directory               │
│    ✓ GET /health (multiple times)       │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 8. Test Assertions                      │
│    ✓ backendPort === 8002               │
│    ✓ /load-directory called on 8002     │
│    ✓ /health called on 8002             │
│    ✓ Graph loaded with nodes            │
└─────────────────────────────────────────┘
```

## Key Test Points

### 1. Port Blocking is Effective
- Test fixture creates `net.Server` on `0.0.0.0:8001`
- Matches Python server binding behavior (uvicorn binds to 0.0.0.0)
- Forces ServerManager to find alternative port

### 2. IPC Communication
- `electronAPI.getBackendPort()` returns correct port (8002)
- Renderer receives port via IPC before making API calls

### 3. Lazy Initialization
- Backend connection NOT initialized at app startup (no blocking)
- Auto-initializes on first `getBackendBaseUrl()` call
- Happens when `FileWatchHandler` calls `loadDirectory()`

### 4. Network Request Interception
- Test intercepts `window.fetch` to capture requests
- Verifies URL, method, and port for each request
- Ensures `/load-directory` POST and `/health` GET use port 8002

### 5. End-to-End Verification
- Graph actually loads (proves backend responded correctly)
- No crashes or timeout errors
- Clean teardown (port released, app closed)

## Troubleshooting

### Test Times Out
- Check if Python server binary is built: `ls dist/resources/server/voicetree-server`
- Verify server starts: Look for `[Server] Started with PID:` in logs
- Check server logs: `~/Library/Application Support/Electron/server-debug.log`

### Port Already in Use
- Test should handle this automatically (finds next port)
- If test fails, check for zombie processes: `lsof -i :8001 -i :8002`

### Backend API Errors
- Check backend server health manually: `curl http://localhost:8002/health`
- Verify test fixture vault exists: `tests/fixtures/example_real_large`
- Check file permissions on fixture folder

## Related Files

- **Test**: `tests/e2e/full-electron/electron-port-conflict-resolution.spec.ts`
- **Port Utils**: `electron/port-utils.ts` - Port discovery logic
- **Server Manager**: `electron/server-manager.ts` - Python server lifecycle
- **Backend API**: `src/utils/backend-api.ts` - HTTP client with lazy init
- **File Watch Manager**: `electron/file-watch-handler.ts` - Calls backend API
- **Main Process**: `electron/main.ts` - IPC handlers and startup
- **Preload**: `electron/preload.ts` - IPC bridge to renderer
