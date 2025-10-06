---
color: blue
title: Alice modify extension API (1_1)
agent: alice
---

# Task: Modify Cytoscape Floating Windows Extension API

## Your Identity
You are Alice, a specialized agent working on modifying the cytoscape-floating-windows extension API to accept React dependencies properly.

## Context
We are migrating from a legacy floating window system to a new Cytoscape extension-based system. The extension currently relies on global window objects (window.React, window.ReactDOM, window.componentRegistry) which is hacky. We need to make it accept these dependencies as parameters instead.

## Original Spec Reference
See: `/Users/bobbobby/repos/VoiceTree/frontend/webapp/floatingWindowSpec.md`

Key requirement: When users tap/click on a node in the graph, it should open a MarkdownEditor as a floating window that moves with graph interactions (pan/zoom).

## Your Specific Task

### What TO DO:
1. **Modify `webapp/src/graph-core/extensions/cytoscape-floating-windows.ts`:**
   - Change `registerFloatingWindows()` function signature to accept a config parameter:
     ```typescript
     registerFloatingWindows(cytoscape: typeof import('cytoscape'), config: {
       React: typeof React;
       ReactDOM: typeof ReactDOM;
       components: Record<string, React.ComponentType<any>>;
     })
     ```
   - Store the config in module scope for later use
   - Update `mountComponent()` function to use the stored config instead of `window.componentRegistry`, `window.React`, `window.ReactDOM`
   - Remove all references to window globals
   - Add proper TypeScript types for the config

2. **Ensure backwards compatibility:**
   - The extension should throw clear error messages if used without proper initialization

### What NOT TO DO:
- DO NOT update any calling code in `graph-core/index.ts` (that's Bob's job)
- DO NOT modify the tap handler in `voice-tree-graph-viz-layout.tsx` (that's Charlie's job)
- DO NOT delete or modify any React components in `floating-windows/editors/`
- DO NOT remove the old FloatingWindowContainer system yet

### Test Requirements
Write a unit test that verifies:
1. The extension accepts the config parameter correctly
2. The config is stored and accessible when mounting components
3. `mountComponent()` uses the stored config instead of window globals
4. Appropriate errors are thrown if extension is used without initialization

The test should be added to or create: `webapp/tests/unit/extensions/cytoscape-floating-windows.test.ts`

### Success Criteria
- [ ] `registerFloatingWindows()` accepts config parameter
- [ ] Config is stored in module scope
- [ ] `mountComponent()` uses stored config, not window globals
- [ ] TypeScript types are properly defined
- [ ] Unit test passes
- [ ] No references to `window.React`, `window.ReactDOM`, or `window.componentRegistry` remain in the extension

### Files You Will Modify
- `webapp/src/graph-core/extensions/cytoscape-floating-windows.ts`
- `webapp/tests/unit/extensions/cytoscape-floating-windows.test.ts` (create if needed)

### Dependencies
Your work is independent and can be done in parallel with Charlie. Bob depends on your API being defined.

## Progress Tracking
Please update this checklist as you work:
- [ ] Read and understand current extension code
- [ ] Write unit test (TDD)
- [ ] Modify registerFloatingWindows signature
- [ ] Add config storage
- [ ] Update mountComponent
- [ ] Remove window global references
- [ ] Verify test passes