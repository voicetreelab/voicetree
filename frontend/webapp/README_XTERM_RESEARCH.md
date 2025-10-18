# VoiceTree xterm Terminal Viewport Reset Research

## Quick Links

- **TERMINAL_VIEWPORT_FIX.md** - Start here! Quick overview and action items
- **XTERM_VIEWPORT_RESEARCH.md** - Deep technical analysis
- **IMPLEMENTATION_CHECKLIST.md** - Step-by-step implementation guide

## TL;DR

Your terminal viewport resets because xterm's `scrollOnEraseInDisplay` option is not enabled.

**Fix:** Add one line to Terminal.tsx:
```typescript
scrollOnEraseInDisplay: true
```

That's it.

## The Problem

When your terminal receives control sequences like:
- `CSI 3J` (clear scrollback)
- `CSI 2J` (clear screen) 
- `CSI ?1049h/l` (alternate buffer toggle)

The viewport position resets to 0, causing a jarring jump to the top of the scrollback.

## Why It Happens

xterm.js has a configuration option `scrollOnEraseInDisplay` that defaults to `false`. When disabled:
1. Erase sequences clear the buffer
2. Viewport resets to position 0
3. User sees jump to top

## The Solution

VS Code uses ONE configuration option:
```typescript
scrollOnEraseInDisplay: true
```

When enabled:
1. Erase sequences clear the buffer
2. Viewport position is intelligently maintained
3. User sees smooth operation

## Key Insights

- VS Code does NOT filter or intercept control sequences
- VS Code does NOT use complex workarounds
- VS Code uses modern xterm (5.6.0+) which handles this correctly
- The solution is pure configuration, not code architecture

## Implementation (10 minutes)

1. Open `src/components/floating-windows/editors/Terminal.tsx`
2. Find xterm Terminal initialization
3. Add/verify:
   ```typescript
   const terminal = new Terminal({
       allowProposedApi: true,
       scrollOnEraseInDisplay: true,  // <- Add this
       scrollback: 1000,
       // ... other options
   });
   ```
4. Test with: `printf '\x1b[3J'` (should NOT jump to top)

## Next Steps

1. Read **TERMINAL_VIEWPORT_FIX.md** (5 min) - Overview and checklist
2. Review **XTERM_VIEWPORT_RESEARCH.md** (10 min) - Technical details
3. Follow **IMPLEMENTATION_CHECKLIST.md** - Phase-by-phase implementation

## Reference

- VS Code source: `/Users/bobbobby/repos/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` (line 229)
- xterm.js docs: https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/

## Questions?

1. "Is scrollOnEraseInDisplay already set?" 
   - Check Terminal.tsx constructor options
   - If yes, check why it's not working (might be overridden)

2. "Do I need to filter sequences?"
   - No. Let xterm handle them natively.

3. "What xterm version should I use?"
   - 5.3.0 or higher (5.6.0 recommended like VS Code)

4. "Will this break anything?"
   - No. This is standard xterm behavior and matches VS Code.

---

**Status:** Research Complete, Documentation Ready, Implementation Guide Provided

**Estimated Fix Time:** 30 minutes (including testing)

**Complexity:** Low - Single configuration option

**Risk:** Minimal - Proper xterm configuration
