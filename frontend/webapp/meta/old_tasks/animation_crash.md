# Cytoscape Animation Crash Analysis

## The Problem

Cytoscape.js crashes with `Uncaught TypeError: Cannot read properties of undefined (reading 'name')` when animating node styles, specifically during breathing animations for new nodes.

### Error Location
```
at step$1 (cytoscape.js:12585:48)
at stepOne (cytoscape.js:12652:7)
at stepAll (cytoscape.js:12677:26)
at Object.rendererAnimationStep [as fn] (cytoscape.js:12728:9)
```

The crash happens in Cytoscape's internal animation engine when it tries to read `.name` from a style property that is `undefined`.

### Root Cause
`border-style` property is `undefined` when Cytoscape's animation system tries to animate it, causing the internal `step$1` function to crash when accessing `property.name`.

## What We Tried

### Attempt 1: Add Missing `border-style` to Contract Animation
**What we did:** Added `'border-style': 'solid'` to the contract phase of breathing animation
**Result:** Still crashed - only fixed one animation, not the root cause

### Attempt 2: Safe Animation Wrapper
**What we did:** Created `safeAnimate()` wrapper to validate and filter undefined properties
**Result:** Partially successful - catches errors but warnings still appear, crashes still happen
**Why it didn't fully work:** Cytoscape reads properties internally before our wrapper can intervene

### Attempt 3: Ensure Style Defaults Before Animation
**What we did:** Created `ensureStyleDefaults()` to set all required properties before animating
**Result:** Failed - reading current values triggers Cytoscape warnings, and values get cleared between animation phases

### Attempt 4: Unconditional Default Setting
**What we did:** Set defaults unconditionally without reading current values
**Result:** Still crashed - Cytoscape clears styles between animation phases (expand → contract → repeat)

### Attempt 5: Re-ensure Defaults Before Each Animation Phase
**What we did:** Call `ensureStyleDefaults()` before expand AND contract animations
**Result:** Not yet tested, but likely still has issues...

## Constraints & What Makes This Hard

### 1. **Cytoscape's Black Box Animation System**
- Internal animation engine (`step$1`, `stepOne`, etc.) is not exposed
- No hooks to intercept before property access
- Animation system expects ALL properties to be defined

### 2. **Property Lifecycle Issues**
- Properties get cleared/reset between animation phases
- No way to know when Cytoscape will clear them
- Complete callbacks run in Cytoscape's internal context

### 3. **Timing Problems**
- Animations are chained: expand → (complete) → contract → (complete) → repeat
- Properties must be defined at EVERY step, but Cytoscape may clear them at ANY step
- Race conditions between our code setting values and Cytoscape reading them

### 4. **Type System Limitations**
- Cytoscape's TypeScript types are incomplete
- `AnimateOptions` type doesn't properly include `style` and `position`
- Had to use `any` casts, losing type safety

### 5. **Multiple Animation Sources**
- BreathingAnimationService (style animations)
- LayoutManager (position animations)
- Both can run simultaneously on same node

## Why Current Approach Is Failing

The fundamental issue: **We're fighting Cytoscape's internal state management**

1. We set `border-style: solid`
2. Cytoscape starts animation
3. Animation completes
4. **Cytoscape internally clears/resets styles**
5. Next animation phase starts
6. `border-style` is undefined again
7. CRASH

## Proposed Next Steps

### Option A: Disable Breathing Animations (Quick Fix)
**Pros:**
- Immediate fix
- No crashes
- Still have layout animations

**Cons:**
- Lose visual feedback for new/updated nodes
- User experience degradation

### Option B: Use CSS Classes Instead of Style Animations
**Approach:**
```typescript
// Instead of animating styles directly
node.animate({ style: { 'border-style': 'solid' } })

// Use CSS classes with predefined animations
node.addClass('breathing-animation')
```

**Pros:**
- CSS handles property lifecycle
- No undefined property issues
- Better performance
- Declarative animations

**Cons:**
- Requires restructuring animation system
- May not support all animation types

### Option C: Patch Cytoscape Core (Nuclear Option)
**Approach:** Fork Cytoscape and add null checks in `step$1`

**Pros:**
- Fixes root cause

**Cons:**
- Maintenance burden
- May break with updates
- Not recommended

## Recommended Long-term Solution

### Build a Robust Styling Architecture

#### 1. **Use Cytoscape Stylesheets for Static Styles**
```typescript
cy.style()
  .selector('node')
  .style({
    'border-width': 1,
    'border-color': '#666',
    'border-style': 'solid', // ALWAYS defined in base stylesheet
    'border-opacity': 1
  })
```

#### 2. **Use CSS Classes for Animations**
```css
/* Define animations in CSS */
.breathing-new-node {
  animation: breathing-glow 1s ease-in-out infinite;
}

@keyframes breathing-glow {
  0%, 100% { border-color: rgba(0, 255, 0, 0.5); border-width: 2px; }
  50% { border-color: rgba(0, 255, 0, 0.9); border-width: 4px; }
}
```

```typescript
// Apply via class
node.addClass('breathing-new-node');

// Remove when done
setTimeout(() => node.removeClass('breathing-new-node'), 5000);
```

#### 3. **Defensive Programming Principles**

**Always Validate Before Animating:**
```typescript
function canAnimate(node: NodeSingular): boolean {
  return node && !node.removed() && node.cy();
}

function safeAnimate(node: NodeSingular, options: AnimateOptions) {
  if (!canAnimate(node)) return;

  try {
    return node.animate(options);
  } catch (err) {
    console.error('Animation failed:', err);
    // Fallback: apply end state immediately
    if (options.complete) options.complete();
  }
}
```

**Never Assume Properties Exist:**
```typescript
// BAD
const currentWidth = node.style('border-width');

// GOOD
const currentWidth = node.style('border-width') ?? '1px';
```

#### 4. **Separation of Concerns**

```typescript
// StyleService: Manages static styles and themes
// AnimationService: Only triggers animations, doesn't manage state
// StateService: Tracks node states (new, updated, etc.)

class AnimationCoordinator {
  // Ensure only ONE animation per node at a time
  private activeAnimations = new Map<string, Animation>();

  animate(node: NodeSingular, options: AnimateOptions) {
    const nodeId = node.id();

    // Stop existing animation
    this.stop(nodeId);

    // Start new one
    const anim = safeAnimate(node, {
      ...options,
      complete: () => {
        this.activeAnimations.delete(nodeId);
        options.complete?.();
      }
    });

    if (anim) this.activeAnimations.set(nodeId, anim);
  }
}
```

#### 5. **Better Error Boundaries**

```typescript
// Wrap all Cytoscape operations
class CytoscapeOperations {
  private cy: Core;

  animate(selector: string, options: AnimateOptions) {
    try {
      const elements = this.cy.$(selector);
      if (elements.length === 0) {
        console.warn(`No elements match selector: ${selector}`);
        return;
      }

      elements.forEach(el => {
        // Ensure all required properties exist
        this.ensureRequiredStyles(el);

        // Animate
        el.animate(options);
      });
    } catch (err) {
      console.error('Animation error:', err);
      // Don't crash - gracefully degrade
    }
  }

  private ensureRequiredStyles(el: NodeSingular) {
    const required = {
      'border-style': 'solid',
      'border-width': 1,
      'border-color': '#666',
      'border-opacity': 1
    };

    Object.entries(required).forEach(([prop, val]) => {
      if (!el.style(prop)) {
        el.style(prop, val);
      }
    });
  }
}
```

## Immediate Action Items

1. **Test Option B (CSS Classes)** - Most promising short-term fix
2. **Document all animation types** - Understand full scope
3. **Create animation registry** - Track what's animating when
4. **Add comprehensive error handling** - Prevent UI freezes
5. **Consider disabling problematic animations** - User experience > fancy effects

## Key Lessons

1. **Don't fight the library** - Work with Cytoscape's patterns, not against them
2. **Defensive coding is essential** - Assume everything can be undefined
3. **Animations are hard** - Especially in libraries with hidden state
4. **Type safety matters** - `any` casts hide problems
5. **Graceful degradation** - Missing animation > crashed app

## References

- Cytoscape Animation Docs: https://js.cytoscape.org/#eles.animate
- Related GitHub Issues: Search for "animation undefined crash"
- Our error logs: See above

---

**Next Step:** Implement CSS-based animations (Option B) as a proof of concept to see if it resolves the crash while maintaining visual feedback.
