# Zoom Broken During Terminal Output Spam

## Problem
Graph zoom functionality breaks when a terminal is actively spamming output (e.g., continuous logging).

## Root Cause
The scroll preservation hack in `Terminal.tsx` is causing the zoom to break:

1. **Upstream xterm.js bug**: Same auto-scroll-to-top bug affecting Claude Code (https://github.com/anthropics/claude-code/issues/826)
   - xterm.js with FitAddon + ResizeObserver causes terminal to randomly scroll to top during output
   - Known issue with xterm.js fit addon interaction

2. **Workaround causing new issues** (`Terminal.tsx:82-85`)
   - Added `scrollToLine(scrollY)` in ResizeObserver to prevent auto-scroll-to-top
   - During terminal output spam, ResizeObserver fires continuously (even on content changes, not just size changes)
   - Each `scrollToLine()` call triggers internal scroll events that block the event loop
   - This prevents wheel events from being processed → zoom breaks

3. **Additional issue** (`cytoscape-floating-windows.ts:118-120`)
   - Floating windows have blanket `wheel` event listener with `stopPropagation()`
   - Prevents wheel events from reaching cytoscape graph (though this alone might be acceptable)

## Proposed Solution

### Option 1: Remove the hack, accept upstream bug
Remove scroll preservation entirely and wait for xterm.js/Claude Code to fix upstream:

```typescript
// Terminal.tsx - ResizeObserver callback
// Remove scroll preservation:
fitAddonRef.current?.fit();
// (No scrollToLine() - accept the auto-scroll-to-top bug for now)
```

**Pros**: Zoom works, simpler code
**Cons**: Auto-scroll-to-top bug returns

### Option 2: Fix ResizeObserver to only fire on actual size changes
Prevent ResizeObserver from firing on content changes:

```typescript
// Terminal.tsx
// Add more aggressive size change detection
// Only call fit() when container actually resizes, not when xterm content changes
```

**Pros**: Keeps scroll preservation, zoom works
**Cons**: Complex, may not fully solve the issue

## Recommendation
Go with **Option 1** - remove the hack. The scroll preservation is creating worse UX (broken zoom) than the bug it's trying to fix. Let upstream fix it properly.
