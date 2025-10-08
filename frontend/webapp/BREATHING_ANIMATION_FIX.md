# Breathing Animation Architecture Fix

## The Problem

Cytoscape.js crashed with `Cannot read properties of undefined (reading 'name')` when animating node borders. The crash occurred because:

1. **Undefined style properties**: `node.animate({ style: { 'border-color': '...' }})` without `'border-style': 'solid'` caused Cytoscape's internal animation engine to encounter `undefined` when reading property metadata
2. **Animation state corruption**: Multiple concurrent animations (breathing + layout) on the same node corrupted Cytoscape's hidden internal state
3. **No single source of truth**: Inline styles, CSS files, and JS animations all competed for control

## Why Previous Approaches Failed

### Attempt 1: Add missing `border-style`
- Only fixed one animation phase, didn't address root cause
- Still had inline style conflicts

### Attempt 2-5: Defensive wrappers (`safeAnimate`, `ensureStyleDefaults`)
- **Violated development principles**: Added complexity, fallbacks, and defensive checks
- **Fought Cytoscape's design**: Tried to control internal state we can't access
- **Race conditions**: Properties cleared between animation phases despite our efforts

## The Solution: Class-Based Animations

### Architecture

**Single Source of Truth**: `StyleService.ts` (TypeScript JSON)
```typescript
{
  selector: 'node.breathing-new-expand',
  style: {
    'border-width': 4,
    'border-color': 'rgba(0, 255, 0, 0.9)',
    'border-style': 'solid',  // Always defined
    'transition-property': 'border-width, border-color, border-opacity',
    'transition-duration': '1000ms',
    'transition-timing-function': 'ease-in-out',
  }
}
```

**Simple Animation**: `BreathingAnimationService.ts`
```typescript
// Just toggle classes with setInterval
setInterval(() => {
  node.removeClass(expandClass).addClass(contractClass);
  // or vice versa
}, duration);
```

**Clean Cleanup**
```typescript
// Remove classes, let stylesheet cascade handle the rest
node.removeClass([expandClass, contractClass]);
// No inline styles - preserves pinned/frontmatter/other class styles
```

### Why This Works

1. **Type safety**: TypeScript catches typos at compile time
2. **No undefined properties**: Base stylesheet defines all defaults, classes only override
3. **Smooth transitions**: Cytoscape's built-in `transition-*` properties handle easing
4. **No animation conflicts**: Classes don't interfere with Cytoscape's internal animation engine
5. **Stylesheet cascade**: Removing classes naturally restores other styles (pinned, frontmatter)
6. **Single solution**: No defensive wrappers, no fallbacks, no complexity

### Files Changed

- `src/graph-core/services/StyleService.ts` - Added 6 breathing animation class selectors with transitions
- `src/graph-core/services/BreathingAnimationService.ts` - Rewritten to toggle classes instead of calling `node.animate()`
- `src/graph-core/styles/graph.css` - Removed Cytoscape styles, kept only DOM styles
- `tests/unit/services/BreathingAnimationService.test.ts` - Updated to verify class toggling

### Deleted

- `src/graph-core/utils/safeAnimate.ts` - Defensive wrapper no longer needed
- `src/graph-core/styles/styles.css` - Duplicate/conflicting CSS removed

## Principles Upheld

✅ **Single Solution Principle**: Stylesheet is the only source of styling truth
✅ **Minimize Complexity**: No wrappers, no defensive checks, just class toggles
✅ **Fail Fast**: TypeScript errors at compile time vs runtime crashes
✅ **Quality Testing**: All 29 tests pass, behavior-focused

## Result

No more crashes. Smooth breathing animations. Clean architecture.
