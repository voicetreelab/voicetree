# Styling Bug Investigation - Theme Colors Not Applying

## Problem
Text colors in Cytoscape graph don't change when toggling dark/light mode. The text stays light grey (`#dcddde`) in both modes instead of changing to dark grey (`#2a2a2a`) in light mode.

## Root Cause Found
`StyleService.isDarkMode()` is detecting dark mode **even when the app is in light mode**.

Evidence from console logs:
```
[StyleService] getGraphColors - isDark: true textColor: #dcddde
```
This appears even when in light mode, meaning `isDarkMode()` always returns `true`.

## What Was Attempted

### 1. Fixed Color Values
- Changed light mode color from debug red (`#ff0000`) to dark grey (`#2a2a2a`)
- Dark mode stays light grey (`#dcddde`)
- **Result:** Colors are correct in StyleService, but wrong value is being selected

### 2. Fixed Timing of DOM Class Updates
- Changed `toggleDarkMode()` to set DOM class BEFORE state update
- Changed init useEffect to set DOM class BEFORE setState
- **Result:** Didn't help - StyleService still reading wrong value

### 3. Added useEffect to Re-apply Styles
- Created useEffect that watches `isDarkMode` state
- Recreates StyleService and applies new stylesheet when toggling
- **Result:** StyleService recreates but still detects `isDark: true` even in light mode

## Why It Didn't Work

The real bug is in `StyleService.isDarkMode()` at line 67-94. It's checking:
1. `document.documentElement.classList.contains('dark')`
2. `window.matchMedia('(prefers-color-scheme: dark)')`

**The bug:** One of these checks is returning true when it shouldn't. Most likely:
- The `dark` class is persisting on the DOM even after removal
- OR `matchMedia` is returning dark mode from OS settings
- OR there's a timing issue where StyleService reads before DOM updates

## Next Steps

1. **Debug `StyleService.isDarkMode()`**
   - Add console.log at line 67 to see what each check returns:
     ```typescript
     console.log('isDarkMode checks:', {
       htmlHasDark: document.documentElement?.classList.contains('dark'),
       bodyHasDark: document.body?.classList.contains('dark'),
       prefersColorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches
     });
     ```

2. **Fix the detection logic**
   - If `matchMedia` is the problem: Only check DOM classes, ignore OS preference
   - If DOM class is the problem: Ensure removal happens synchronously before StyleService reads

3. **Alternative: Pass theme explicitly**
   - Instead of StyleService reading DOM, pass theme as constructor param:
     ```typescript
     constructor(isDark?: boolean) {
       if (isDark !== undefined) {
         this.textColor = isDark ? '#dcddde' : '#2a2a2a';
       } else {
         // fallback to current detection
       }
     }
     ```
   - Then in voice-tree-graph-viz-layout: `new StyleService(isDarkMode)`

## Test Status
- ✅ Unit tests pass (StyleService correctly returns right colors when detection works)
- ❌ E2E tests fail (Electron app not loading - separate pre-existing issue)
- ❌ Visual behavior fails (colors don't change on toggle)

## Files Modified
- `src/graph-core/services/StyleService.ts` - Fixed color values
- `src/components/voice-tree-graph-viz-layout.tsx` - Added re-apply styles useEffect
- `src/graph-core/graphviz/CytoscapeCore.ts` - Added `updateTheme()` method (unused)
