# Terminal Scroll & Flickering Fix Report

## Problem Statement
The terminal component was experiencing severe issues:
1. **Viewport jumping to position 0** - Unable to scroll, viewport resets constantly
2. **Visual flickering** - Screen flashing during output
3. **Lost scroll position** - When trying to scroll up, position would reset

## Root Causes Discovered

### 1. Claude CLI Behavior (Primary Issue)
Claude CLI is sending problematic ANSI escape sequences **repeatedly** during output:
- `\x1b[2J` (CSI 2J) - Clear entire screen
- `\x1b[3J` (CSI 3J) - Clear scrollback buffer
- `\x1b[H` (CSI H) - Move cursor to home position
- `\x1b[?1049h/l` - Alternate screen buffer (enter/exit)

**Evidence from stack traces:**
- `eraseInDisplay @ xterm.js` - Screen clearing
- Buffer height collapsing: 301 lines → 30 lines
- Position resets: 1909 → 1903, 301 → 1

### 2. Configuration Issues
- `scrollOnUserInput: true` with comment saying "Don't auto-scroll" - **backwards!**
- `smoothScrollDuration: 125` - Caused conflicts with rapid output
- Missing `scrollOnEraseInDisplay` flag (requires xterm 5.6.0-beta)

### 3. Version Mismatch
- Had xterm 5.5.0 (stable)
- Needed 5.6.0-beta for `scrollOnEraseInDisplay` support
- VS Code uses 5.6.0-beta.119 for this exact reason

## Solutions Implemented

### 1. Upgraded to Beta Versions
```json
"@xterm/xterm": "5.6.0-beta.131"
"@xterm/addon-fit": "0.11.0-beta.131"
"@xterm/addon-webgl": "0.19.0-beta.131"
```

### 2. Fixed Configuration
```typescript
const term = new XTerm({
  cursorBlink: true,
  smoothScrollDuration: 0,        // Disabled (was 125)
  scrollback: 10000,
  scrollOnUserInput: false,        // Fixed (was true with wrong comment)
  scrollOnEraseInDisplay: true,    // NEW: Handle clears intelligently
  fastScrollModifier: 'shift',     // NEW: Better scroll control
  fastScrollSensitivity: 5,        // NEW: Faster scrolling
});
```

### 3. Data Sanitization (Fallback)
Created `sanitizeTerminalData()` function that strips:
```typescript
const pattern = /\x1b\[([0-3]?J|[0-9;]*[Hr]|\?(?:1049|1047|47)[hl])/g;
```
- Clear screen/scrollback sequences
- Cursor home sequences
- Alternate buffer sequences

### 4. Parser Handlers (Attempted)
Registered CSI handlers to block alternate buffer:
```typescript
term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
  if ([1049, 1047, 47].includes(params.params[0])) {
    return true; // Block
  }
  return false;
});
```

### 5. Data Buffering (Latest)
Added 10ms buffering to reduce flicker from rapid writes:
```typescript
bufferTimeout = setTimeout(() => {
  const sanitizedData = sanitizeTerminalData(buffer);
  term.write(sanitizedData);
  buffer = '';
}, 10);
```

## What VS Code Does
VS Code's approach (from research):
1. Uses `scrollOnEraseInDisplay: true` (5.6.0-beta feature)
2. No custom sequence filtering
3. No sanitization
4. Works perfectly with same xterm version

**Key file**: `/Users/bobbobby/repos/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts:200-242`

## Current State

### ✅ Fixed
- Scrollbar no longer jumping to position 0
- Can scroll up without viewport reset
- Mouse wheel scrolling works
- Typing doesn't cause jump to bottom

### ⚠️ Remaining Issues
- Visual flickering when Claude sends output
- Claude still spamming clear sequences (not normal CLI behavior)
- TypeScript type error for `scrollOnEraseInDisplay` (IDE cache issue)

## Why Claude is Misbehaving
Claude appears to be:
1. In some kind of "watch" or refresh mode
2. Thinking it's in a full-screen TUI environment
3. Experiencing terminal size detection issues

This is **not normal** - most CLI tools don't repeatedly clear the screen during regular output.

## Recommendations

### Short Term
1. Keep sanitization active - it's working
2. Use buffering to reduce flicker
3. Restart TypeScript server to fix type errors

### Long Term
1. Investigate why Claude is sending these sequences
2. Check Claude CLI flags/environment variables
3. Consider setting `TERM=dumb` or `NO_COLOR=1` environment variables
4. File issue with Claude CLI team about excessive clear sequences

## Technical Details

### Stack Traces Analyzed
1. **Initial issue**: `eraseInDisplay` → viewport reset
2. **After first fix**: `lineFeed` + `scroll` → alternate buffer issue
3. **Current**: `_onMouseWheel` → small jumps (5 lines) from scrolling

### Files Modified
- `/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/components/floating-windows/editors/Terminal.tsx`
- `/Users/bobbobby/repos/VoiceTree/frontend/webapp/package.json`

### Research Documents Created
- `README_XTERM_RESEARCH.md`
- `TERMINAL_VIEWPORT_FIX.md`
- `XTERM_VIEWPORT_RESEARCH.md`
- `IMPLEMENTATION_CHECKLIST.md`

## Testing Commands
```bash
# Check xterm version
npm list @xterm/xterm

# Verify property exists
grep -r "scrollOnEraseInDisplay" node_modules/@xterm/xterm --include="*.d.ts"

# Run tests
npm run test
npx playwright test tests/e2e/full-electron/electron-real-folder.spec.ts --config=playwright-electron.config.ts
```

## References
- [VS Code Terminal Implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts)
- [xterm.js 5.6.0-beta Release Notes](https://github.com/xtermjs/xterm.js/releases)
- [ANSI Escape Codes Reference](https://en.wikipedia.org/wiki/ANSI_escape_code)

## Summary
The core issue is Claude CLI's unusual behavior of repeatedly sending screen-clear sequences. While we've mitigated the symptoms through sanitization and configuration fixes, the root cause appears to be with Claude's output generation. The terminal now maintains scroll position correctly, but visual flickering remains due to the constant clear/redraw cycle Claude is performing.