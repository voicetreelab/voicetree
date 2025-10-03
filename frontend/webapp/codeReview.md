# Code Review Log

## 2024-01-03 - Initial Review

### Files Changed:
- `src/graph-core/index.ts`
- `tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts`

### Issues Found:

1. **Missing Implementation File**  
   - `src/graph-core/index.ts` exports from `'./extensions/cytoscape-floating-windows'` but this file doesn't exist
   - Will cause build failure

2. **Test Anti-Pattern** =¨
   - Test contains entire implementation inline (100+ lines duplicated twice)
   - Violates TDD principle: tests should validate real implementation files, not contain implementation
   - Creates maintenance burden: any bug fixes need updating in multiple places

### Recommendations:
- Extract inline implementation to `src/graph-core/extensions/cytoscape-floating-windows.ts`
- Test should import and test the actual module
- Remove code duplication between test cases

### Positive Aspects:
- Implementation logic appears sound (overlay creation, transform sync, shadow nodes)
- Test coverage is comprehensive
- React component mounting handled correctly

---