# VoiceTree Terminal: Fixing Viewport Reset Issue

## Problem
Your xterm terminal viewport resets to position 0 repeatedly when receiving control sequences (CSI 3J - clear scrollback, alternate buffer toggles, etc.).

## Root Cause
Based on VS Code research, the issue is **configuration**, not code architecture. The terminal is likely initialized with:
- `scrollOnEraseInDisplay: false` (default, causing viewport resets)
- Older xterm version
- Missing `allowProposedApi: true`

## Solution

### 1. Update Terminal Configuration
Find your xterm initialization in `/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/components/floating-windows/editors/Terminal.tsx`

Add/verify these options:
```typescript
const term = new Terminal({
    allowProposedApi: true,           // Critical: Enable internal APIs
    scrollOnEraseInDisplay: true,      // Critical: Prevent viewport resets
    scrollback: 1000,                  // Configurable buffer size
    // ... other options
});
```

### 2. Ensure Modern Xterm Version
Check package.json for xterm version:
- Required: `@xterm/xterm@^5.3.0` or higher
- Recommended: `@xterm/xterm@^5.6.0` (same as VS Code)

### 3. Do NOT Filter CSI Sequences
Remove any code that:
- Filters or intercepts CSI 2J, CSI 3J
- Blocks alternate buffer toggles (CSI ?1049h/l)
- Rewrites escape sequences

Let xterm handle them natively.

### 4. Preserve Viewport When Necessary (Optional)
If you need to maintain scroll position during specific operations:

```typescript
// Save current position
const currentScrollPos = term.buffer.active.viewportY;

// ... perform operation that might change viewport (e.g., call backend)

// Restore position if needed
term.scrollToLine(currentScrollPos);
```

### 5. Test the Fix
Test with sequences from your backend:
```bash
# Send clear scrollback (should NOT jump to top)
printf '\x1b[3J'

# Send clear screen (should NOT jump)
printf '\x1b[2J'

# Toggle alternate buffer (should NOT reset position)
printf '\x1b[?1049h'  # Enter alternate buffer
printf '\x1b[?1049l'  # Exit alternate buffer
```

---

## Files to Check/Modify

1. **Terminal.tsx** - Xterm initialization
   - Check xterm Terminal constructor options
   - Verify `scrollOnEraseInDisplay: true` is set

2. **terminal-manager.ts** - Terminal data handling
   - Verify no sequence filtering happens
   - Ensure write() passes data directly to xterm

3. **useFileWatcher.ts** - File update handling
   - Verify it doesn't reset viewport on file changes

4. **package.json** - Dependencies
   - Update xterm if needed

---

## Key Configuration Pattern (from VS Code)

```typescript
// Pattern to follow from VS Code's xtermTerminal.ts
const xterm = new Terminal({
    allowProposedApi: true,
    cols: 80,
    rows: 24,
    scrollback: userConfig.scrollback,
    theme: {
        background: '#000000',
        foreground: '#ffffff',
        // ... colors
    },
    scrollOnEraseInDisplay: true,  // The key setting!
    cursorBlink: true,
    cursorStyle: 'block',
    wordSeparator: ' ()[]{}',\'"`',
    // ... other options
});
```

---

## Why This Works

When `scrollOnEraseInDisplay: true`:

| Sequence | Behavior |
|----------|----------|
| CSI 3J (clear scrollback) | Clears buffer, viewport adjusts intelligently |
| CSI 2J (clear screen) | Clears display, maintains relative position |
| CSI ?1049h (enter alt buffer) | Switches buffer, viewport stays valid |
| CSI ?1049l (exit alt buffer) | Switches back, viewport restored |

Without this setting, all these sequences reset viewport to 0.

---

## Expected Results After Fix

- Viewport position maintained during output
- No jumping to top of scrollback
- Smooth terminal experience during backend operations
- Buffer clearing works without disruption
- Alternate buffer mode works correctly

---

## Debugging Tips

1. **Check if scrollOnEraseInDisplay is actually applied:**
   ```javascript
   console.log(term.options.scrollOnEraseInDisplay); // Should be true
   ```

2. **Monitor viewport changes:**
   ```javascript
   term.buffer.active.onScroll(() => {
       console.log('Viewport Y:', term.buffer.active.viewportY);
   });
   ```

3. **Log incoming sequences:**
   ```javascript
   term.parser.registerCsiHandler({ final: 'J' }, (params) => {
       console.log('Erase sequence:', params);
       return false; // Let xterm handle it
   });
   ```

4. **Test with raw sequences:**
   ```javascript
   term.write('\x1b[3J'); // Should not cause jump
   ```

