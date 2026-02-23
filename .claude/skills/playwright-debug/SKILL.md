---
name: playwright-debug
description: This skill should be used when the user asks to "debug the electron app", "connect playwright to VoiceTree", "take screenshots of the running app", "interact with the live UI", "inspect the running application", or "test UI elements live". Provides step-by-step instructions for connecting Playwright MCP to a running Electron app for live debugging and automation.
---

# Playwright MCP Live Debugging

Connect to a running VoiceTree Electron app for live debugging via browser automation.

## Quick Start (3 steps)

### 1. Start Electron in debug mode

```bash
cd webapp && npm run electron:debug
```

This starts Electron with CDP enabled on port 9222 **and** automatically calls `prettySetupAppForElectronDebugging()` once the renderer is ready — loading the `example_small` project and spawning 3 debug terminals.

> Run with a bash timeout (e.g. 30s) since this is a long-running dev server.

### 2. Verify CDP is ready

```bash
curl -s http://localhost:9222/json/version
```

Should return JSON with `"Browser": "Chrome/..."`.

### 3. Connect via Playwright MCP

Use `browser_snapshot` to connect. First attempt may timeout — retry once. The project and terminals are already loaded, so you should see the graph view immediately.

### Opening a specific project (optional)

If you need a specific project instead of the test fixture:
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

### Cytoscape Instance

Access the graph directly via `window.cytoscapeInstance`:

```javascript
// Get all nodes in the graph
const cy = window.cytoscapeInstance;
cy.nodes().map(n => ({ id: n.id(), isContext: n.data('isContextNode') }));

// Get node count
cy.nodes().length;
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure Electron started with `npm run electron:debug` |
| Timeout on first connect | Retry - first connection can be slow |
| Wrong tab selected | `browser_tabs action=select index=1` |
| Native dialog opened | Use JavaScript APIs instead - native dialogs can't be automated |
| Old Electron still running | `pkill -f "electron.*remote-debugging-port"` |

## Architecture

```
Claude Code → @playwright/mcp --cdp-endpoint http://localhost:9222 → CDP → Electron App → VoiceTree Webapp
```

## Notes

- CDP only accesses renderer process, not Electron main process
- Hot reload works - no restart needed on code changes
- Native file dialogs cannot be automated - use `electronAPI.main.initializeProject()` instead
- Only one debug session at a time (port 9222 hardcoded)
