---
name: playwright-debug
description: This skill should be used when the user asks to "debug the electron app", "connect playwright to VoiceTree", "take screenshots of the running app", "interact with the live UI", "inspect the running application", or "test UI elements live". Provides step-by-step instructions for connecting Playwright MCP to a running Electron app for live debugging and automation.
---

# Playwright MCP Live Debugging

Connect to a running VoiceTree Electron app for live debugging via browser automation.

## Prerequisites

1. **CDP enabled in main.ts** (already configured):
```typescript
// frontend/webapp/src/shell/edge/main/electron/main.ts
if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
    app.commandLine.appendSwitch('remote-debugging-port', '9222');
}
```

2. **MCP configuration** in `.mcp.json`:
```json
"playwright": {
  "command": "npx",
  "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
}
```

## Connection Steps

### 1. Start Electron with Debug Flag

```bash
cd frontend/webapp
ENABLE_PLAYWRIGHT_DEBUG=1 npm run electron
```

### 2. Verify CDP is Running

```bash
curl -s http://localhost:9222/json/version
```

Should return JSON with `"Browser": "Chrome/..."`.

### 3. Connect via Playwright MCP

Use `browser_snapshot` to connect. First attempt may timeout - retry once.

**Important**: MCP initially connects to DevTools tab. Switch to VoiceTree:
```
browser_tabs action=select index=1
```

### 4. Open a Project

If on project selector screen:

**Option A**: Click "+ Add" button on a project row

**Option B**: Use JavaScript:
```javascript
await window.electronAPI.main.initializeProject('/path/to/folder');
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `browser_snapshot` | Get accessibility tree of current page |
| `browser_click` | Click elements by ref |
| `browser_hover` | Hover over elements |
| `browser_type` | Type into inputs |
| `browser_evaluate` | Run JavaScript in page context |
| `browser_tabs` | Switch between tabs |
| `browser_wait_for` | Wait for text/elements |
| `browser_take_screenshot` | Capture visual screenshot |

## Quick Setup: Spawn Debug Terminals

After connecting to a project, call `prettySetupAppForElectronDebugging()` to instantly spawn 3 terminals with tree-style hierarchy:

```javascript
// Via browser_evaluate
const result = await window.electronAPI.main.prettySetupAppForElectronDebugging();
// Returns: { terminalsSpawned: ['term-0', 'term-1', 'term-2'], nodeCount: 5 }
```

This creates:
```
Terminal Tree Sidebar
├── parent (depth=0)     ← "hello from parent"
│   └── child (depth=1)  ← "hello from child" (indented!)
└── sibling (depth=0)    ← "hello from sibling"
```

The child terminal has `parentTerminalId` set, demonstrating tree-style tabs indentation.

## Accessing App APIs

The app exposes `window.electronAPI` with useful methods:

```javascript
// Via browser_evaluate
Object.keys(window.electronAPI.main)

// Key methods:
window.electronAPI.main.prettySetupAppForElectronDebugging()  // Spawn debug terminals
window.electronAPI.main.initializeProject(path)  // Open a folder
window.electronAPI.main.getGraph()               // Get graph data
window.electronAPI.main.getNode(id)              // Get node details
window.electronAPI.main.loadSettings()           // App settings
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure Electron started with `ENABLE_PLAYWRIGHT_DEBUG=1` |
| Timeout on first connect | Retry - first connection can be slow |
| Wrong tab selected | `browser_tabs action=select index=1` |
| Native dialog opened | Use JavaScript APIs instead - native dialogs can't be automated |

## Architecture

```
Claude Code → @playwright/mcp → CDP:9222 → Electron App → VoiceTree Webapp
```

## Notes

- CDP only accesses renderer process, not Electron main process
- Hot reload works - no restart needed on code changes
- Native file dialogs cannot be automated - use `electronAPI.main.initializeProject()` instead
