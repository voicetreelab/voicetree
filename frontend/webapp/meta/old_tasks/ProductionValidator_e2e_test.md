# Subtask: Production MarkdownEditor E2E Validation

**Agent Name:** ProductionValidator
**Color:** green

## PRIMARY OBJECTIVE

Validate that floating windows with MarkdownEditor work in the **REAL production application**, not just isolated tests. This is the PRIMARY REQUIREMENT validation.

## Spec Requirement

From `floatingWindowSpec.md`:

```
## Phase 5: Production MarkdownEditor End-to-End Test

PRIMARY REQUIREMENT VALIDATION: Test real MarkdownEditor in actual production application.

Requirements:
- E2E test that launches real app (not isolated harness)
- Opens actual MarkdownEditor in floating window
- Validates ALL editor functionality
- Tests real useFloatingWindows hook integration
- Validates production component registry setup
- Confirms no event conflicts in production environment
```

## Current Situation

**What Works:**
- ✅ Extension registered in production (`voice-tree-graph-viz-layout.tsx`)
- ✅ Isolated tests pass with mock MarkdownEditor
- ✅ Extension integrated and CSS loaded

**What's Missing:**
- ❌ Production E2E test with real Electron app
- ❌ Real MarkdownEditor component in floating window (production)
- ❌ Component registry setup for production
- ❌ Validation that all works end-to-end in real app

## Your Component

**What:** Production E2E test + component registry setup

**Input:** Real Electron app + MarkdownEditor component

**Output:** Passing E2E test validating production usage

**Files Involved:**
1. `tests/e2e/full-electron/floating-window-production.spec.ts` (created)
2. Possibly: Component registry setup in production

## System Architecture

```
┌─────────────────────────────────────────┐
│  Electron App Launch                    │
│  (real production build)                │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Cytoscape Instance                     │
│  (cy.addFloatingWindow available)       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Component Registry                     │
│  (MarkdownEditor registered)            │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Floating Window with MarkdownEditor    │
│  (fully functional in production)       │
└─────────────────────────────────────────┘
```

## Requirements

### 1. Component Registry Setup

The production app needs a component registry for MarkdownEditor:

```typescript
// In production app initialization (e.g., voice-tree-graph-viz-layout.tsx or App.tsx)
import { MarkdownEditor } from '@/components/floating-windows/editors/MarkdownEditor';

// Set up global registry
(window as any).componentRegistry = {
  MarkdownEditor: MarkdownEditor
};
```

### 2. E2E Test Requirements

Test must:
- Launch real Electron app (using existing pattern from `electron-sys-e2e.spec.ts`)
- Verify extension registered: `cy.addFloatingWindow` exists
- Create floating window with MarkdownEditor
- Validate full editor functionality:
  - Can type markdown
  - Save button clickable
  - Text selection works
  - No graph pan/zoom interference
- Take screenshots for visual verification

### 3. Real MarkdownEditor Integration

Options:
- **Option A:** Set up component registry in production code
- **Option B:** Inject MarkdownEditor in test setup
- **Option C:** Use simplified editor for E2E (test component, not real MarkdownEditor)

**Recommended:** Start with Option C (simplified editor) to validate the floating window system works in production, then upgrade to real MarkdownEditor if needed.

## Critical Implementation Details

### Electron App Launch Pattern
```typescript
const electronApp = await electron.launch({
  args: [path.join(PROJECT_ROOT, '.vite/build/electron/main.js')],
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
});
const window = await electronApp.firstWindow();
```

### Cytoscape Access
```typescript
const cy = await window.evaluate(() => {
  return (window as any).cytoscapeInstance;
});
```

### Event Isolation Verification
```typescript
// Click/type in window
await textarea.fill('test');

// Verify graph didn't pan
const panAfter = await window.evaluate(() => cy.pan());
expect(panAfter).toEqual({ x: 0, y: 0 });
```

## What NOT to Do

- ❌ Don't duplicate extension code
- ❌ Don't create a fake production environment
- ❌ Don't skip event conflict testing
- ❌ Don't test without launching real Electron app

## Verification Steps

1. **Run test:**
   ```bash
   npx playwright test tests/e2e/full-electron/floating-window-production.spec.ts
   ```

2. **Verify:**
   - Test passes ✅
   - Window appears in screenshot
   - Can type in editor
   - No graph interference
   - All assertions pass

3. **Manual validation:**
   - Run `npm run electron`
   - Open DevTools console
   - Run: `cy.addFloatingWindow({ id: 'test', component: '<div>Test</div>', position: { x: 100, y: 100 } })`
   - Verify window appears

## Success Criteria

- [ ] Production E2E test created
- [ ] Test launches real Electron app
- [ ] Floating window created successfully
- [ ] Editor is interactive (can type)
- [ ] Save button works
- [ ] Text selection doesn't pan graph
- [ ] Window persists during pan/zoom
- [ ] All test assertions pass
- [ ] Screenshot shows working window

## TDD Approach

1. **Run test** - confirm it fails (app might not be built yet)
2. **Build app** - `npm run build` if needed
3. **Set up registry** - Add component registry to production
4. **Run test** - verify specific failures
5. **Fix issues** - Address each failure
6. **Run test** - all pass ✅

## Alternative: Simplified Validation

If real MarkdownEditor integration is complex:

1. Test with simple HTML component (already in test file)
2. Validate floating window system works in production
3. Document how to add MarkdownEditor separately

This proves the infrastructure works, making MarkdownEditor integration straightforward.

Report back: test results, component registry approach, any production issues found.
