# Subtask: Clean Up Test Anti-Patterns & Validate Production

**Agent Name:** TestCleanup
**Color:** red

## PRIMARY OBJECTIVE

**CRITICAL ISSUE:** Tests currently contain 100+ lines of inline extension code (duplicated 3 times). This violates TDD principles - tests should validate real implementation files, not contain their own implementation.

**Fix:** Make tests load the ACTUAL extension from `src/graph-core/extensions/cytoscape-floating-windows.ts`

## Spec Requirement

From `floatingWindowSpec.md`:

```
## Phase 4: Production Validation & Test Cleanup

CRITICAL: Tests must validate actual implementation files, not contain inline duplicates.

Requirements:
- Remove ALL inline extension code from test files
- Tests should load/import the real extension from implementation files
- Bundle extension for browser test environment (if needed)
- Validate floating windows work in production application
- Verify real MarkdownEditor component integration in live app
```

## Current Problem

**Anti-Pattern in Tests:**
- `floating-window-extension.spec.ts` - 400+ lines with inline extension (duplicated 3x)
- `floating-window-markdown-editor.spec.ts` - 300+ lines with inline extension (duplicated 2x)

**Result:**
- Any bug fix requires updating test files AND implementation
- Tests don't validate actual production code
- Maintenance nightmare

## Your Component

**What:** Test refactoring + production validation

**Input:** Tests with inline code + real extension file

**Output:** Clean tests that import real extension + production validation

**Approach Options:**

### Option 1: Compiled Extension Injection (Recommended)
1. Build extension to browser-compatible JS
2. Inject compiled code in test harness
3. Tests load real compiled extension

### Option 2: Test Harness Import
1. Modify test harness to import from webpack/vite build
2. Tests rely on bundled extension
3. Load extension like production

### Option 3: Minimal Test-Specific Build
1. Create test-specific bundle of extension
2. Load in harness HTML
3. Tests use bundled version

## Files to Modify

### Test Files (Remove Inline Code)

1. **`tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts`**
   - Remove ALL inline extension code
   - Replace with: load real extension from built file
   - Keep only test assertions

2. **`tests/e2e/isolated-with-harness/graph-core/floating-window-markdown-editor.spec.ts`**
   - Remove ALL inline extension code
   - Replace with: load real extension
   - Keep MarkdownEditor component definition (that's OK, it's test-specific)

### Test Harness (Load Real Extension)

3. **`tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html`**
   - Add script tag to load compiled extension
   - Or add import if using module system

### Build/Bundle (If Needed)

4. **Possibly create:** Test bundle script or Vite config
   - Bundle extension for browser
   - Output to test-accessible location

## Implementation Strategy

### Step 1: Check Existing Build
Look at how the app is built:
```bash
# Check if extension is already bundled
ls dist/ or build/
```

If extension is in build output, tests can load from there.

### Step 2: Create Test Bundle (If Needed)
```typescript
// vite.config.test.ts or similar
export default {
  build: {
    lib: {
      entry: 'src/graph-core/extensions/cytoscape-floating-windows.ts',
      name: 'FloatingWindows',
      formats: ['iife'],
      fileName: 'floating-windows-extension'
    },
    outDir: 'tests/e2e/isolated-with-harness/graph-core/dist'
  }
}
```

### Step 3: Load in Test Harness
```html
<!-- cytoscape-react-harness.html -->
<script src="./dist/floating-windows-extension.js"></script>
<!-- Extension auto-registers when loaded -->
```

### Step 4: Simplify Tests
```typescript
// Before (BAD): 100+ lines of inline code
await page.evaluate(() => {
  // ... 100 lines of extension code ...
});

// After (GOOD): Load real extension
await page.addScriptTag({ path: './dist/floating-windows-extension.js' });
// Extension is now loaded, tests just use it
```

## Requirements

- [ ] Inline extension code removed from all test files
- [ ] Tests load real extension from built file
- [ ] All tests still pass
- [ ] Tests are <100 lines each (mostly assertions)
- [ ] No code duplication between tests and implementation
- [ ] Production validation: cy.addFloatingWindow() works in dev server

## What NOT to Do

- ❌ Don't keep ANY inline extension code in tests
- ❌ Don't create yet another version of the extension
- ❌ Don't modify the extension implementation
- ❌ Don't break existing test assertions

## Critical Success Factors

### Test Cleanliness
Tests should be ONLY:
1. Setup (navigate, configure)
2. Action (call cy.addFloatingWindow with real extension)
3. Assert (verify behavior)

NO implementation code in tests!

### Production Validation
After cleanup, verify:
1. Run `npm run dev`
2. Open browser console
3. Access cy instance
4. Call `cy.addFloatingWindow({ ... })`
5. Verify window appears and works

## Validation Steps

1. **Run tests:** `npx playwright test`
   - All should pass
   - Using real extension, not inline code

2. **Check test file sizes:**
   - Each test <150 lines (down from 400+)
   - No extension implementation in test files

3. **Production test:**
   - Start dev server
   - Open app
   - Call cy.addFloatingWindow() from console
   - Verify it works

## Success Criteria

- [ ] All inline extension code removed from tests
- [ ] Tests load compiled/bundled real extension
- [ ] Test file sizes reduced by 70%+
- [ ] All Playwright tests pass
- [ ] Extension works in production dev server
- [ ] Can manually test cy.addFloatingWindow() in browser

## TDD Principle Restored

Tests now properly:
1. **Test behavior** - not implementation
2. **Validate production code** - not test-specific code
3. **Maintainable** - one source of truth for extension
4. **Clean** - mostly assertions, minimal setup

Report back: approach taken, test file changes, production validation results.
