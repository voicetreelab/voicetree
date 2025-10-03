# Subtask: Integrate Floating Window Extension into Application

**Agent Name:** AppIntegrator
**Color:** purple

## PRIMARY OBJECTIVE

Wire the floating window extension into the actual application so it's available for real use, not just in isolated tests.

## Spec Requirement

From `floatingWindowSpec.md`:

```
## Phase 3: Application Integration

The floating window system must be integrated into the actual application:
- Extension registered in main graph component (`voice-tree-graph-viz-layout.tsx`)
- CSS styles properly loaded and applied
- Extension exported from `graph-core/index.ts`
- Works in the real application, not just isolated tests
- No duplication between test code and implementation code
```

## Current Situation

**What Exists:**
- ✅ Extension implementation: `src/graph-core/extensions/cytoscape-floating-windows.ts`
- ✅ Isolated tests pass

**What's Missing:**
- ❌ CSS file: `src/graph-core/styles/floating-windows.css`
- ❌ Export from `src/graph-core/index.ts`
- ❌ Registration in `src/components/voice-tree-graph-viz-layout.tsx`
- ❌ Integration test that validates real app usage

## Your Component

**What:** Application integration layer

**Input:** Existing extension file + graph component

**Output:** Fully integrated floating window system in production app

**Files to Create/Modify:**
1. Create `src/graph-core/styles/floating-windows.css`
2. Modify `src/graph-core/index.ts` (add export)
3. Modify `src/components/voice-tree-graph-viz-layout.tsx` (register extension)

## System Architecture

```
┌─────────────────────────────────────────┐
│  voice-tree-graph-viz-layout.tsx        │
│  (main graph component)                 │
│  - imports registerFloatingWindows      │
│  - calls it during init                 │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  graph-core/index.ts                    │
│  - exports registerFloatingWindows      │
│  - imports CSS                          │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  graph-core/extensions/                 │
│  cytoscape-floating-windows.ts          │
│  (already exists)                       │
└─────────────────────────────────────────┘
                    +
┌─────────────────────────────────────────┐
│  graph-core/styles/                     │
│  floating-windows.css                   │
│  (to be created)                        │
└─────────────────────────────────────────┘
```

## Requirements

### 1. Create CSS File

**File:** `src/graph-core/styles/floating-windows.css`

**Required Styles:**
```css
/* Overlay container - sibling to cytoscape container */
.cy-floating-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1000;
  transform-origin: top left;
}

/* Individual floating windows */
.cy-floating-window {
  position: absolute;
  pointer-events: auto;
  min-width: 300px;
  min-height: 200px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

/* Resizable windows */
.cy-floating-window.resizable {
  resize: both;
  overflow: auto;
}

/* Shadow nodes (invisible) */
.floating-window-node {
  opacity: 0;
}
```

### 2. Export from graph-core

**File:** `src/graph-core/index.ts`

Add:
```typescript
export { registerFloatingWindows } from './extensions/cytoscape-floating-windows';
```

And import CSS if not already:
```typescript
import './styles/floating-windows.css';
```

### 3. Register in Main Graph Component

**File:** `src/components/voice-tree-graph-viz-layout.tsx`

Find where Cytoscape is initialized and add:
```typescript
import { registerFloatingWindows } from '@/graph-core';
import cytoscape from 'cytoscape';

// During initialization (one-time)
registerFloatingWindows(cytoscape);

// Then create cy instance as usual
const cy = cytoscape({ ... });
```

**IMPORTANT:** Only register ONCE during app initialization, before creating any cy instances.

## Critical Implementation Details

### CSS Import Strategy
Check how other CSS is imported in graph-core. Likely one of:
- Direct import in index.ts
- Import in the component that uses it
- Webpack/Vite auto-includes from styles folder

### Registration Timing
Extension MUST be registered before creating cy instances:
```typescript
// ✅ CORRECT
registerFloatingWindows(cytoscape);
const cy = cytoscape({ container: el });

// ❌ WRONG
const cy = cytoscape({ container: el });
registerFloatingWindows(cytoscape); // Too late!
```

### Check Existing Patterns
Look at voice-tree-graph-viz-layout.tsx to see:
- Where cytoscape is imported
- Where cy instance is created
- If other extensions are registered
- Follow the same pattern

## What NOT to Do

- ❌ Don't duplicate extension code
- ❌ Don't modify the extension implementation
- ❌ Don't add CSS inline styles (use CSS file)
- ❌ Don't register extension multiple times

## Verification Steps

After integration, verify:

1. **Check exports:**
   ```typescript
   import { registerFloatingWindows } from '@/graph-core';
   // Should not error
   ```

2. **Check cy instance:**
   ```typescript
   cy.addFloatingWindow({ ... });
   // Should exist as a method
   ```

3. **Check CSS loaded:**
   - Inspect element in DevTools
   - .cy-floating-overlay should have styles from CSS file

4. **Functional test:**
   - Call cy.addFloatingWindow() in the real app
   - Verify window appears
   - Verify pan/zoom works

## Test Strategy

No new test file needed - instead:
1. Verify build succeeds: `npm run build`
2. Verify dev server runs: `npm run dev`
3. Manual test: Open app, call cy.addFloatingWindow() from console
4. Existing isolated tests continue to pass

## Success Criteria

- [ ] CSS file created with proper styles
- [ ] Extension exported from graph-core/index.ts
- [ ] Extension registered in voice-tree-graph-viz-layout.tsx
- [ ] Build completes without errors
- [ ] Dev server starts without errors
- [ ] cy.addFloatingWindow() available in browser console
- [ ] Existing tests still pass

## TDD Approach

This is more integration than TDD, so:
1. **Create CSS file** - provides visual styles
2. **Add export** - makes extension importable
3. **Register extension** - makes it available
4. **Build and verify** - confirms no errors
5. **Manual test** - validates real usage

Report back: files modified, build status, any integration issues.
