# Cytoscape.js Graph Core E2E Tests

End to end tests for cytoscape.js graphviz and floating window extension.

## Floating Window Extension Tests

### Test Architecture

Tests follow TDD best practices:
- Tests validate the **real implementation** from `src/graph-core/extensions/cytoscape-floating-windows.ts`
- NO inline extension code in test files
- Extension is bundled and loaded once in the test harness

### Files

- `cytoscape-react-harness.html` - Shared test harness that loads Cytoscape, React, and the extension
- `dist/floating-windows-extension.iife.js` - Bundled extension for browser testing
- `floating-window-extension.spec.ts` - Core extension tests (pan, zoom, resize)
- `floating-window-markdown-editor.spec.ts` - MarkdownEditor integration tests

### Building the Test Extension

The extension must be bundled before running tests:

```bash
npm run build:test-extension
```

This generates `dist/floating-windows-extension.iife.js` from the real implementation.

### Running Tests

```bash
# All floating window tests
npx playwright test tests/e2e/isolated-with-harness/graph-core/

# Specific test file
npx playwright test tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts

# With UI
npx playwright test tests/e2e/isolated-with-harness/graph-core/ --ui
```

### Architecture Benefits

**Before (Anti-Pattern):**
- 1,259 total lines across 2 test files
- 100+ lines of inline extension code **duplicated 3 times**
- Tests validated their own implementation, not production code
- Any bug fix required updating tests AND real code

**After (Clean TDD):**
- 723 total lines across 2 test files (**43% reduction**)
- Zero inline extension code
- Tests validate actual production implementation
- Single source of truth: `src/graph-core/extensions/cytoscape-floating-windows.ts`

### Maintenance

When modifying the extension:

1. Update `src/graph-core/extensions/cytoscape-floating-windows.ts`
2. Rebuild test bundle: `npm run build:test-extension`
3. Run tests to validate: `npx playwright test tests/e2e/isolated-with-harness/graph-core/`

No need to modify test files unless adding new test cases.

### Production Validation

The extension is registered in production at:
- `src/components/voice-tree-graph-viz-layout.tsx` (line 16)

To manually test in dev server:
1. Run `npm run dev`
2. Open browser console
3. Access cytoscape instance and call `cy.addFloatingWindow({ ... })`
