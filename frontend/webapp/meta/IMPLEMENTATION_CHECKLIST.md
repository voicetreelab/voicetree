# VoiceTree Terminal Viewport Fix - Action Checklist

## Research Complete
- [x] Analyzed VS Code xterm implementation
- [x] Identified root cause: `scrollOnEraseInDisplay` configuration
- [x] Documented 357-line technical research
- [x] Created implementation guide with debugging tips
- [x] Verified xterm version and configuration requirements

## Documents Created

### 1. XTERM_VIEWPORT_RESEARCH.md (357 lines)
Location: `/Users/bobbobby/repos/VoiceTree/frontend/webapp/`

Includes:
- VS Code xterm initialization details (lines 200-242 of xtermTerminal.ts)
- Control sequence handling strategy (no filtering)
- Viewport management techniques
- Addon architecture (MarkNavigationAddon, DecorationAddon, ShellIntegrationAddon)
- Key insights and recommendations
- Practical implementation patterns

### 2. TERMINAL_VIEWPORT_FIX.md (162 lines)
Location: `/Users/bobbobby/repos/VoiceTree/frontend/webapp/`

Includes:
- Problem/solution overview
- Configuration checklist
- Files to check/modify
- Debugging tips
- Test procedures
- Why the fix works

## Next Steps: Implementation

### Phase 1: Code Review (15 min)
- [ ] Read `TERMINAL_VIEWPORT_FIX.md` - Quick 5-minute overview
- [ ] Review Terminal.tsx initialization code
- [ ] Check terminal-manager.ts for any sequence filtering
- [ ] Verify xterm version in package.json

### Phase 2: Configuration Update (10 min)
- [ ] Find xterm Terminal constructor in Terminal.tsx
- [ ] Add `scrollOnEraseInDisplay: true`
- [ ] Add `allowProposedApi: true`
- [ ] Verify `scrollback` is configured
- [ ] Remove any sequence filtering code

### Phase 3: Testing (20 min)
- [ ] Test clear scrollback: `\x1b[3J` (should NOT jump to top)
- [ ] Test clear screen: `\x1b[2J` (should NOT reset)
- [ ] Test alternate buffer: `\x1b[?1049h` / `\x1b[?1049l`
- [ ] Test normal output flow
- [ ] Monitor viewport position during operations

### Phase 4: Verification (10 min)
- [ ] Confirm: `term.options.scrollOnEraseInDisplay === true`
- [ ] Confirm: `term.options.allowProposedApi === true`
- [ ] Monitor console for viewport changes
- [ ] Test with backend output

## Key Code Pattern to Implement

```typescript
// In Terminal.tsx (xterm initialization)
const terminal = new Terminal({
    // Critical settings
    allowProposedApi: true,                    // Enable internal APIs
    scrollOnEraseInDisplay: true,              // PRIMARY FIX
    scrollback: 1000,                          // Configurable buffer
    
    // Standard settings
    cols: 80,
    rows: 24,
    cursorBlink: true,
    cursorStyle: 'block',
    // ... other options
});
```

## Verification Checklist

- [ ] Terminal initializes with `scrollOnEraseInDisplay: true`
- [ ] No sequence filtering code in terminal-manager.ts
- [ ] Xterm version is 5.3.0 or higher
- [ ] CSI 3J (clear scrollback) does NOT reset viewport
- [ ] CSI 2J (clear screen) does NOT reset viewport
- [ ] Alternate buffer toggles work smoothly
- [ ] File updates don't cause viewport resets
- [ ] Scrolling behavior is smooth and predictable

## Files to Check

- [ ] `src/components/floating-windows/editors/Terminal.tsx`
- [ ] `electron/terminal-manager.ts`
- [ ] `src/hooks/useFileWatcher.ts`
- [ ] `src/graph-core/extensions/cytoscape-floating-windows.ts`
- [ ] `package.json` (xterm version)

## Debugging Commands

```typescript
// Check current settings
console.log('scrollOnEraseInDisplay:', term.options.scrollOnEraseInDisplay);
console.log('allowProposedApi:', term.options.allowProposedApi);
console.log('scrollback:', term.options.scrollback);

// Monitor viewport changes
term.buffer.active.onScroll?.(() => {
    console.log('Viewport Y changed:', term.buffer.active.viewportY);
});

// Test sequences
term.write('\x1b[3J');  // Clear scrollback
term.write('\x1b[2J');  // Clear screen
```

## Expected Outcome

After implementing the fix:
- Viewport position maintained during all operations
- No jumping to top of scrollback
- Smooth terminal experience
- Buffer clearing works without disruption
- Alternate buffer mode functions correctly
- Matches VS Code terminal behavior

## Related Documentation

**Internal:**
- `/Users/bobbobby/repos/VoiceTree/CLAUDE.md` - Project principles
- Project instructions in webapp/CLAUDE.md

**External:**
- xterm.js documentation: https://xtermjs.org/
- xterm.js options: https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- VS Code terminal code: `/Users/bobbobby/repos/vscode/src/vs/workbench/contrib/terminal/`

## Time Estimate

- Initial review: 5 min
- Implementation: 10 min
- Testing: 15 min
- Total: 30 minutes

## Success Criteria

1. Terminal viewport stays at correct position when receiving CSI sequences
2. No console warnings or errors related to viewport
3. Terminal output appears smooth without jumping
4. User can interact with terminal normally
5. File updates don't cause visual disruption
6. Matches VS Code terminal behavior

---

## Questions to Answer During Implementation

1. Is `scrollOnEraseInDisplay` already set? (If yes, check why it's not working)
2. Is there sequence filtering code? (Remove it if found)
3. What xterm version is installed? (Update if < 5.3.0)
4. Are there any custom viewport reset calls? (Remove them)
5. Do file updates trigger sequence processing? (Ensure proper flow)

---

Start with Phase 1 (Code Review) to understand current state, then proceed with Phases 2-4.
