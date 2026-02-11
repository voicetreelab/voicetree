---
name: playwright-debug
description: This skill should be used when the user asks to "debug the electron app", "connect playwright to VoiceTree", "take screenshots of the running app", "interact with the live UI", "inspect the running application", or "test UI elements live". Provides step-by-step instructions for connecting Playwright MCP to a running Electron app for live debugging and automation.
---

# Playwright MCP Live Debugging

Connect to a running VoiceTree Electron app for live debugging via browser automation.

## Prerequisites

1. **CDP enabled in main.ts** (already configured):
```typescript
// webapp/src/shell/edge/main/electron/main.ts
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
  "args": ["@playwright/mcp@latest"]
}
```
The Playwright MCP server natively reads `PLAYWRIGHT_MCP_CDP_ENDPOINT` from its environment. No `--cdp-endpoint` flag needed.

## IMPORTANT: Port Configuration and Multi-Agent Collisions

### How the CDP port works

Both the Electron app and the Playwright MCP server read the same env var `PLAYWRIGHT_MCP_CDP_ENDPOINT` (e.g. `http://localhost:9223`). If unset, both default to port 9222.

**The env var is read at process startup.** The Playwright MCP server is spawned when Claude Code starts, so the env var must be set in your shell *before* launching Claude Code:

```bash
# Set before starting Claude Code to use a non-default port
PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9223 claude
```

You **cannot** change the Playwright MCP's port mid-session by exporting the env var in a Bash tool call — that only affects the bash subprocess, not the already-running MCP server.

### Multi-agent workaround: spawn a new agent

If you're already in a session and need a different CDP port, use `spawn_agent` to create a new agent. The new agent starts a fresh Claude Code process, so you can set the env var in its environment and it will pick up the new port:

1. Check which ports are in use:
```bash
lsof -iTCP:9222-9230 -sTCP:LISTEN -P 2>/dev/null
```

2. Start Electron on a free port (you CAN control this from bash since you're launching the process):
```bash
PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9223 ENABLE_PLAYWRIGHT_DEBUG=1 npm run electron
```

3. Spawn a new agent with the matching port. The spawned agent will be a fresh Claude Code process that reads `PLAYWRIGHT_MCP_CDP_ENDPOINT` at startup.

### Default single-agent usage

If you're the only agent debugging, port 9222 (the default) is fine. Just launch Electron:
```bash
cd webapp
ENABLE_PLAYWRIGHT_DEBUG=1 npm run electron
```

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

DevTools won't auto-open when `PLAYWRIGHT_CDP_PORT` is set, so you'll connect directly to VoiceTree.

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

### Cytoscape Instance

Access the graph directly via `window.cytoscapeInstance`:

```javascript
// Get all nodes in the graph
const cy = window.cytoscapeInstance;
cy.nodes().map(n => ({ id: n.id(), isContext: n.data('isContextNode') }));

// Get node count
cy.nodes().length;
```

## Cleanup

Kill all Electron processes before restarting:

```bash
killall -9 Electron "Electron Helper" "Electron Helper (GPU)" "Electron Helper (Renderer)" 2>/dev/null
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure Electron started with `ENABLE_PLAYWRIGHT_DEBUG=1` |
| Another agent hijacked session | You're sharing CDP port 9222. Start Electron on a different port and spawn a new agent with `PLAYWRIGHT_MCP_CDP_ENDPOINT` set |
| Timeout on first connect | Retry - first connection can be slow |
| Wrong tab selected | `browser_tabs action=select index=1` |
| Native dialog opened | Use JavaScript APIs instead - native dialogs can't be automated |
| Old Electron still running | Run the cleanup command above |

## Architecture

```
Claude Code → @playwright/mcp (reads PLAYWRIGHT_MCP_CDP_ENDPOINT) → CDP → Electron App → VoiceTree Webapp
```

## Notes

- CDP only accesses renderer process, not Electron main process
- Hot reload works - no restart needed on code changes
- Native file dialogs cannot be automated - use `electronAPI.main.initializeProject()` instead
- `PLAYWRIGHT_MCP_CDP_ENDPOINT` is the official env var from `@playwright/mcp` — both the MCP server and Electron's main.ts read it
- To use a non-default port, set the env var **before** starting Claude Code, or spawn a new agent
