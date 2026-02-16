---
name: playwright-debug
description: This skill should be used when the user asks to "debug the electron app", "connect playwright to VoiceTree", "take screenshots of the running app", "interact with the live UI", "inspect the running application", or "test UI elements live". Provides step-by-step instructions for connecting Playwright MCP to a running Electron app for live debugging and automation.
---

# Playwright MCP Live Debugging

Connect to a running VoiceTree Electron app for live debugging via browser automation.

## Prerequisites

1. **CDP enabled in environment-config.ts** (already configured):
```typescript
// webapp/src/shell/edge/main/electron/environment-config.ts
if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
    let cdpPort = '9222';
    const cdpEndpoint = process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
    if (cdpEndpoint) {
        try { cdpPort = new URL(cdpEndpoint).port || '9222'; } catch { /* default */ }
    }
    app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
}
```

2. **MCP configuration** in `.mcp.json` (already configured):
```json
"playwright": {
  "command": "npx",
  "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
}
```

**Limitation**: Only one Playwright debug session at a time. Port 9222 is hardcoded. Multi-worktree parallel debugging is not yet supported.

## Connection Steps

### 1. Start Electron with Debug Flag

```bash
cd webapp
ENABLE_PLAYWRIGHT_DEBUG=1 npm run electron
```

### 2. Verify CDP is Running

```bash
curl -s http://localhost:9222/json/version
```

Should return JSON with `"Browser": "Chrome/..."`.

### 3. Connect via Playwright MCP

Use `browser_snapshot` to connect. First attempt may timeout - retry once.

### 4. ALWAYS Use `prettySetupAppForElectronDebugging()`

**IMPORTANT: After connecting, ALWAYS call `prettySetupAppForElectronDebugging()` immediately.** Do NOT manually open a project or set up terminals yourself — this function handles everything:

- If no project is loaded, it **automatically loads** the `example_small` test fixture
- Spawns 3 terminals with tree-style hierarchy (parent, child, sibling)
- Returns terminal IDs and node count

```javascript
// Via browser_evaluate — this is ALL you need after connecting
const result = await window.electronAPI.main.prettySetupAppForElectronDebugging();
// Returns: { terminalsSpawned: ['term-0', 'term-1', 'term-2'], nodeCount: 5, projectLoaded: '/path/...' }
```

This creates:
```
Terminal Tree Sidebar
├── parent (depth=0)     ← "hello from parent"
│   └── child (depth=1)  ← "hello from child" (indented!)
└── sibling (depth=0)    ← "hello from sibling"
```

The child terminal has `parentTerminalId` set, demonstrating tree-style tabs indentation.

> **Do NOT** manually call `initializeProject()`, click project buttons, or try to set up terminals step-by-step. The pretty setup function does all of this for you in one call.

### Opening a specific project (optional, only if needed)

If you need a specific project instead of the test fixture, use:
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
| Connection refused | Ensure Electron started with `ENABLE_PLAYWRIGHT_DEBUG=1` |
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
