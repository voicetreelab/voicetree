# Terminal Dimensions Synchronization

## Problem

When using dynamic terminal sizing with xterm.js `FitAddon`, the frontend terminal UI and backend PTY process had mismatched dimensions, causing text to wrap incorrectly and characters to appear on separate lines.

### Symptoms
- Each typed character appeared on a new line with a new prompt
- Example: typing "write" would show:
  ```
  > w
  > wr
  > wri
  > writ
  > write
  ```
- Terminal text didn't wrap at the correct column boundaries

## Root Cause

When commit `8b2a985` added `FitAddon` for dynamic terminal resizing:

1. **Removed fixed dimensions**: Deleted `cols: 80, rows: 24` from XTerm constructor
2. **Added FitAddon**: Calls `fitAddon.fit()` to resize xterm.js UI to container size
3. **Missing sync**: Never notified backend PTY process of the new dimensions

**Result**: Frontend might be 120x30, but backend PTY still thinks it's 80x24 (default from `electron/main.ts:219-220`). This dimension mismatch breaks text wrapping.

## Solution

Synchronize frontend and backend dimensions at two critical points:

### 1. After Terminal Spawns
When backend creates PTY and frontend initializes xterm.js:

```typescript
// Terminal.tsx:113-119
if (result.success && result.terminalId) {
  // Resize backend PTY to match frontend dimensions
  const cols = term.cols;
  const rows = term.rows;
  console.log(`[Terminal] Syncing backend size to ${cols}x${rows}`);
  window.electronAPI.terminal.resize(result.terminalId, cols, rows);
}
```

### 2. When Terminal Resizes
When ResizeObserver detects container size changes:

```typescript
// Terminal.tsx:94-100
fitAddonRef.current?.fit();
lastSizeRef.current = { width, height };

// Notify backend of new dimensions
if (terminalIdRef.current && xtermRef.current) {
  const cols = xtermRef.current.cols;
  const rows = xtermRef.current.rows;
  window.electronAPI.terminal.resize(terminalIdRef.current, cols, rows);
}
```

## Implementation Details

### Flow
1. **Frontend**: `fitAddon.fit()` → calculates `term.cols` and `term.rows` based on container size
2. **Sync**: `electronAPI.terminal.resize(terminalId, cols, rows)` → IPC call to backend
3. **Backend**: `electron/main.ts:289-308` → `ptyProcess.resize(cols, rows)`
4. **Result**: PTY and xterm.js have matching dimensions

### Why This Works
- `node-pty` provides `ptyProcess.resize()` to change PTY dimensions at runtime
- xterm.js calculates dimensions automatically via FitAddon
- We bridge the gap by calling backend resize whenever frontend dimensions change

## Testing

Behavioral test in `tests/e2e/full-electron/electron-terminal-dimensions.spec.ts`:

### Test 1: Text Wrapping
Verifies that typed characters appear on the **same line**, not character-by-character on separate lines.

```typescript
// Types "write me a poem" and checks:
expect(commandEchoCheck.hasCharByCharBug).toBe(false);
```

### Test 2: Resize Behavior
Resizes terminal window and verifies text still wraps correctly at new dimensions.

## Related Files

- **Frontend**: `src/components/floating-windows/editors/Terminal.tsx`
- **Backend**: `electron/main.ts` (terminal IPC handlers)
- **Test**: `tests/e2e/full-electron/electron-terminal-dimensions.spec.ts`

## Git History

- **Introduced**: commit `8b2a985` (added FitAddon, removed fixed dimensions)
- **Fixed**: Added backend resize calls in two locations
- **Related**: `scrollOnUserInput` bug fix (different issue, same file)
