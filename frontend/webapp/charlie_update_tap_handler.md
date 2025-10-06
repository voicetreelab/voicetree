---
color: purple
title: Charlie update tap handler (1_3)
agent: charlie
---

# Task: Update Node Tap Handler to Use New Extension

## Your Identity
You are Charlie, a specialized agent working on updating the node tap handler to use the new floating window extension instead of the legacy system.

## Context
We are migrating from a legacy floating window system to a new Cytoscape extension-based system. Alice is making the extension accept proper dependencies, Bob is registering components. You need to update the actual application to use `cy.addFloatingWindow()` when users tap on nodes.

## Original Spec Reference
See: `/Users/bobbobby/repos/VoiceTree/frontend/webapp/floatingWindowSpec.md`

Key requirement: When users tap/click on a node, it should open a MarkdownEditor as a floating window that behaves correctly with all graph interactions.

## Your Specific Task

### What TO DO:
1. **Modify the tap handler in `webapp/src/components/voice-tree-graph-viz-layout.tsx`:**
   - Find the existing tap event handler (around line 482)
   - Replace the `openMarkdownEditor()` call with `cy.addFloatingWindow()`:
     ```typescript
     cy.addFloatingWindow({
       id: `editor-${nodeId}`,
       component: 'MarkdownEditor', // String reference to registered component
       position: {
         x: event.target.position().x,
         y: event.target.position().y + 50 // Offset below node
       },
       nodeData: {
         isFloatingWindow: true,
         parentNodeId: nodeId
       },
       resizable: true,
       initialContent: content,
       onSave: async (newContent: string) => {
         // Implement save logic here
       }
     });
     ```

2. **Remove legacy code:**
   - Remove the `openMarkdownEditor` function (lines ~59-102)
   - Remove position tracking refs and callbacks:
     - `windowsRef`
     - `positionUpdateCallbackRef`
     - Position update callback logic

3. **Ensure save functionality:**
   - The save handler should still work with `window.electronAPI.saveFileContent`
   - Pass the file path and content correctly

### What NOT TO DO:
- DO NOT remove `FloatingWindowContainer` component from the JSX yet (keep it for now)
- DO NOT delete the actual component files in `floating-windows/editors/`
- DO NOT modify the extension implementation
- DO NOT remove the FloatingWindowManagerProvider from App.tsx yet

### Test Requirements
The main E2E test should pass: `webapp/tests/e2e/full-electron/electron-node-tap-floating-editor.spec.ts`

This test verifies:
1. Tapping a node opens a MarkdownEditor window
2. User can type and edit content
3. Save button works
4. Window moves with graph pan/zoom
5. Text selection doesn't trigger graph panning
6. Multiple windows can be opened

### Success Criteria
- [ ] Tap handler uses `cy.addFloatingWindow()` instead of `openMarkdownEditor()`
- [ ] Windows open when nodes are tapped
- [ ] Save functionality works
- [ ] Legacy position tracking code is removed
- [ ] E2E test passes

### Files You Will Modify
- `webapp/src/components/voice-tree-graph-viz-layout.tsx`

### Dependencies
**IMPORTANT**: You depend on both Alice and Bob's work:
- Alice must update the extension API
- Bob must register the components
Without these, `cy.addFloatingWindow()` won't work properly. You can start preparing the changes but testing requires their work to be complete.

## Progress Tracking
Please update this checklist as you work:
- [ ] Verify Alice and Bob's changes are ready
- [ ] Run E2E test to confirm it fails (TDD)
- [ ] Update tap handler to use cy.addFloatingWindow
- [ ] Implement save handler
- [ ] Remove openMarkdownEditor function
- [ ] Remove position tracking code
- [ ] Run E2E test to verify it passes
- [ ] Test manually in the application