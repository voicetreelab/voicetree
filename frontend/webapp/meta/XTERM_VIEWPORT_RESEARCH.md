# VS Code xterm Implementation Research: Viewport Reset Prevention

## Summary
VS Code has implemented a sophisticated approach to xterm terminal management that prevents viewport position resets during control sequence processing. The key difference is NOT about filtering or overriding CSI sequences, but rather careful configuration, architectural choices, and strategic use of xterm's internal APIs.

---

## 1. XTERM INITIALIZATION AND CONFIGURATION

### Location
`/Users/bobbobby/repos/vscode/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` lines 200-242

### Key Configuration Options

```typescript
this.raw = this._register(new xtermCtor({
    allowProposedApi: true,                    // Enables access to internal APIs
    cols: options.cols,
    rows: options.rows,
    documentOverride: layoutService.mainContainer.ownerDocument,
    scrollback: config.scrollback,             // Configurable scrollback buffer
    theme: this.getXtermTheme(),
    scrollOnEraseInDisplay: true,              // CRITICAL: Allows scrolling during erase ops
    minimumContrastRatio: config.minimumContrastRatio,
    tabStopWidth: config.tabStopWidth,
    wordSeparator: config.wordSeparators,
    overviewRuler: {
        width: 14,
        showTopBorder: true,
    },
}));
```

### Critical Setting: `scrollOnEraseInDisplay: true`

This is the PRIMARY mechanism preventing viewport resets. When set to `true`, xterm.js:
- Does NOT reset the viewport position to 0 when receiving CSI 2J or CSI 3J (erase display/scrollback)
- Instead, it scrolls the viewport to keep visible content in view
- This is the default desired behavior for most terminal applications

**Without this setting**, CSI sequences like:
- `CSI 3J` (clear scrollback) - Would reset viewport to 0
- `CSI 2J` (clear screen) - Could cause unexpected scrolling
- Alternate buffer toggles - Would reset position

---

## 2. CONTROL SEQUENCE HANDLING

### NO Custom Filtering of CSI/OSC Sequences

VS Code does NOT intercept or filter problematic control sequences. Instead:

#### A. Minimal CSI Handler Registration
Only registered for specific platform-dependent scenarios:

**lineDataEventAddon.ts** (lines 60-64):
```typescript
// Windows-specific: CSI H (Cursor Position)
this._register(xterm.parser.registerCsiHandler({ final: 'H' }, () => {
    const buffer = xterm.buffer;
    this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
    return false;  // Let xterm handle the sequence normally
}));
```

**terminalInstance.ts** (lines 859-865):
```typescript
// ConPTY specific: CSI c (Device Attributes / DA1)
this._register(xterm.raw.parser.registerCsiHandler({ final: 'c' }, params => {
    if (params.length === 0 || params.length === 1 && params[0] === 0) {
        this._processManager.write('\x1b[?61;4c');
        return true;  // Consume the sequence
    }
    return false;    // Let xterm handle it
}));
```

#### B. No Filtering or Override of Problematic Sequences

VS Code does NOT:
- Block CSI 3J or CSI 2J sequences
- Override alternate buffer toggle (CSI ?1049h/l)
- Intercept cursor position sequences
- Filter or rewrite escape sequences

The sequences are allowed to be processed normally by xterm's parser.

---

## 3. VIEWPORT AND SCROLLING MANAGEMENT

### Internal API Access

**xterm-private.d.ts** (lines 10-14):
```typescript
export interface IXtermCore {
    viewport?: {
        readonly scrollBarWidth: number;
        _innerRefresh(): void;    // Force viewport refresh
    };
}
```

### Viewport Manipulation Methods

**xtermTerminal.ts** provides these scroll/viewport management methods:

```typescript
// Line 502: Force viewport refresh (called when needed)
forceRefresh() {
    this._core.viewport?._innerRefresh();
}

// Lines 602-628: Scroll control methods
scrollDownLine(): void { this.raw.scrollLines(1); }
scrollDownPage(): void { this.raw.scrollPages(1); }
scrollToBottom(): void { this.raw.scrollToBottom(); }
scrollUpLine(): void { this.raw.scrollLines(-1); }
scrollUpPage(): void { this.raw.scrollPages(-1); }
scrollToTop(): void { this.raw.scrollToTop(); }
scrollToLine(line: number, position: ScrollPosition = ScrollPosition.Top): void {
    this.markTracker.scrollToLine(line, position);
}

// Line 630: Clear buffer (xterm's clear(), does not reset viewport)
clearBuffer(): void {
    this.raw.clear();
    // ...
}
```

### Scroll State Preservation

**markNavigationAddon.ts** (lines 344-352) demonstrates how VS Code preserves scroll state:

```typescript
private _scrollState: { viewportY: number } | undefined;

private _saveScrollState(): void {
    this._scrollState = { viewportY: this._terminal?.buffer.active.viewportY ?? 0 };
}

private _restoreScrollState(): void {
    if (this._scrollState) {
        this._terminal.scrollToLine(this._scrollState.viewportY);
    }
}
```

---

## 4. ADDON ARCHITECTURE

### Always-Loaded Addons

VS Code loads three addons by default:
1. **MarkNavigationAddon** - Tracks scroll position and manages mark navigation
2. **DecorationAddon** - Manages visual decorations and command markers
3. **ShellIntegrationAddon** - Handles shell integration sequences

**xtermTerminal.ts** (lines 278-285):
```typescript
this._markNavigationAddon = this._instantiationService.createInstance(
    MarkNavigationAddon, options.capabilities
);
this.raw.loadAddon(this._markNavigationAddon);

this._decorationAddon = this._instantiationService.createInstance(
    DecorationAddon, this._capabilities
);
this.raw.loadAddon(this._decorationAddon);

this._shellIntegrationAddon = new ShellIntegrationAddon(
    options.shellIntegrationNonce ?? '', 
    options.disableShellIntegrationReporting,
    this._onDidExecuteText,
    this._telemetryService,
    this._logService
);
this.raw.loadAddon(this._shellIntegrationAddon);
```

### Dynamically Loaded Addons

Other addons (Search, Unicode11, WebGL, Serialize, Image, Clipboard, Progress) are loaded on-demand and do NOT interfere with viewport management.

---

## 5. DATA WRITING AND PROCESSING

### Simple Pass-Through Model

**xtermTerminal.ts** (lines 438-440):
```typescript
write(data: string | Uint8Array, callback?: () => void): void {
    this.raw.write(data, callback);
}
```

Data is written directly to xterm with NO intermediate processing or filtering.

### Binary Data Handling

**terminalInstance.ts** (line 851):
```typescript
this._register(xterm.raw.onBinary(data => this._processManager.processBinary(data)));
```

Binary data is forwarded to the process manager for PTY communication, not for terminal rendering.

---

## 6. XTERM VERSION AND CONFIGURATION

### Xterm Version
VS Code uses: **@xterm/xterm@^5.6.0-beta.119**

This modern version has robust CSI sequence handling and proper viewport management.

### Complete Xterm Configuration Summary

**What VS Code sets:**
- `allowProposedApi: true` - Access to `_core` internal APIs
- `scrollOnEraseInDisplay: true` - Critical for preventing viewport resets
- `scrollback: config.scrollback` - User-configurable buffer size
- `smoothScrollDuration: 0 or 125` - Based on device (trackpad vs mouse)
- Standard rendering, theme, font, and interaction options

**What VS Code does NOT set (defaults used):**
- No custom parser hooks
- No sequence filtering
- No viewport override handlers
- Standard xterm erase, clear, and alternate buffer behavior

---

## 7. KEY INSIGHTS: WHY VS CODE DOESN'T EXPERIENCE VIEWPORT RESETS

### Root Cause Analysis
When xterm receives CSI sequences like CSI 3J (clear scrollback):

**With `scrollOnEraseInDisplay: false` (Default in older xterm configs):**
1. Scrollback buffer is cleared
2. Viewport is reset to bottom (line 0)
3. User sees sudden jump to top of scrollback

**With `scrollOnEraseInDisplay: true` (VS Code's Configuration):**
1. Scrollback buffer is cleared
2. Viewport position is intelligently adjusted to keep visible content in view
3. User sees smooth transition or no visible change

### The Architectural Approach

VS Code's approach is:
1. **Configuration-First**: Use xterm's built-in options correctly
2. **No Workarounds**: Don't filter or block sequences
3. **Minimal Intervention**: Let xterm handle sequences natively
4. **Scroll Preservation**: Use mark navigation for intentional scroll management
5. **Modern Version**: Use recent xterm that handles these cases well

### What Makes It Different from Default Xterm Usage

Most projects use xterm.js with default configuration, which has:
- `scrollOnEraseInDisplay: false` (or not explicitly set)
- No handling of CSI 3J side effects
- Basic scroll management

VS Code explicitly enables the right features and uses modern xterm capabilities.

---

## 8. ALTERNATE BUFFER HANDLING (CSI ?1049h/l)

### VS Code Approach
1. Allows sequences to pass through normally
2. No interception or override
3. Xterm handles buffer switching natively
4. Viewport maintained by xterm's buffer switching logic

### Why It Works
With `allowProposedApi: true`, VS Code has access to the `buffer` object:
```typescript
const buffer = this.raw.buffer.active;  // Active buffer (main or alternate)
const viewportY = buffer.viewportY;      // Viewport position in active buffer
```

This allows tracking viewport position across buffer switches, but VS Code doesn't actively reset it—xterm maintains it automatically.

---

## 9. PRACTICAL RECOMMENDATIONS FOR YOUR IMPLEMENTATION

Based on VS Code's approach:

### 1. Enable scrollOnEraseInDisplay
```javascript
const term = new Terminal({
    scrollOnEraseInDisplay: true,
    allowProposedApi: true,
    scrollback: 1000,
    // ... other options
});
```

### 2. Let Sequences Pass Through
Do NOT filter CSI sequences. Allow xterm to handle them natively.

### 3. Use mark/scroll preservation for edge cases
If you need to preserve scroll position during specific operations:
```javascript
const scrollPos = term.buffer.active.viewportY;
// ... do something that might change viewport
term.scrollToLine(scrollPos);
```

### 4. Consider Using Modern Xterm
Ensure you're using recent xterm.js (5.x) which has improved CSI handling.

### 5. Test with Real Sequences
Test with actual sequences from your backend:
- CSI 3J (clear scrollback)
- CSI 2J (clear screen)
- CSI ?1049h/l (alternate buffer)
- CSI H (cursor positioning)

---

## 10. VS CODE FILE REFERENCES

Key files to review:
1. **xtermTerminal.ts** - Core xterm wrapper and initialization
2. **markNavigationAddon.ts** - Scroll state management
3. **terminalInstance.ts** - Terminal lifecycle and data handling
4. **xterm-private.d.ts** - Internal API definitions
5. **decorationAddon.ts** - Visual markup and command tracking

---

## Conclusion

VS Code does NOT prevent viewport resets through sequence filtering or complex workarounds. Instead, it:

1. **Configures xterm correctly** with `scrollOnEraseInDisplay: true`
2. **Uses modern xterm version** that handles these cases properly
3. **Leverages xterm's native capabilities** without intervention
4. **Accesses internal APIs sparingly** only for mark navigation and decoration
5. **Trusts xterm's implementation** of CSI sequence handling

The viewport reset issue in your terminal is likely due to:
- Using `scrollOnEraseInDisplay: false` or not setting it
- Using an older xterm version with poor CSI handling
- Custom filtering that interferes with xterm's sequence processing
- Manually resetting viewport in response to certain sequences

The solution is to enable proper xterm configuration and let it handle the sequences natively.

