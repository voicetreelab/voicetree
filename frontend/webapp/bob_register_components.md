---
color: green
title: Bob register components (1_2)
agent: bob
---

# Task: Register Components with React Dependencies

## Your Identity
You are Bob, a specialized agent working on updating the graph-core module to properly register floating window components with their React dependencies.

## Context
We are migrating from a legacy floating window system to a new Cytoscape extension-based system. Alice is modifying the extension API to accept React/ReactDOM/components as config. You need to update the registration call to provide these dependencies.

## Original Spec Reference
See: `/Users/bobbobby/repos/VoiceTree/frontend/webapp/floatingWindowSpec.md`

Key requirement: The system must work with the actual MarkdownEditor component for editing markdown files when nodes are clicked.

## Your Specific Task

### What TO DO:
1. **Modify `webapp/src/graph-core/index.ts`:**
   - Import React and ReactDOM at the top of the file:
     ```typescript
     import React from 'react';
     import ReactDOM from 'react-dom/client';
     ```
   - Import the actual component classes:
     ```typescript
     import { MarkdownEditor } from '@/components/floating-windows/editors/MarkdownEditor';
     import { Terminal } from '@/components/floating-windows/editors/Terminal';
     ```
   - Update the `registerFloatingWindows()` call to pass the config:
     ```typescript
     registerFloatingWindows(cytoscape, {
       React,
       ReactDOM,
       components: {
         MarkdownEditor,
         Terminal
       }
     });
     ```

2. **Ensure proper exports:**
   - Make sure the module still exports everything needed by the application

### What NOT TO DO:
- DO NOT modify the extension implementation in `cytoscape-floating-windows.ts` (that's Alice's job)
- DO NOT modify any tap handlers or application integration (that's Charlie's job)
- DO NOT modify the actual component implementations
- DO NOT remove any existing exports or functionality

### Test Requirements
Write an integration test that verifies:
1. Components are properly registered with the extension
2. The extension can access the registered components
3. React and ReactDOM are available to the extension
4. The registration happens at module initialization

The test should be added to: `webapp/tests/integration/graph-core-registration.test.ts`

### Success Criteria
- [ ] React and ReactDOM are imported
- [ ] MarkdownEditor and Terminal components are imported
- [ ] Config object is passed to `registerFloatingWindows()`
- [ ] Integration test passes
- [ ] Module continues to export all necessary functions

### Files You Will Modify
- `webapp/src/graph-core/index.ts`
- `webapp/tests/integration/graph-core-registration.test.ts` (create)

### Dependencies
**IMPORTANT**: You depend on Alice's work. The API for `registerFloatingWindows()` must accept the config parameter before you can pass it. Coordinate with Alice or wait for her changes to be complete.

## Progress Tracking
Please update this checklist as you work:
- [ ] Wait for/verify Alice's API is ready
- [ ] Write integration test (TDD)
- [ ] Import React and ReactDOM
- [ ] Import component classes
- [ ] Update registerFloatingWindows call
- [ ] Verify test passes
- [ ] Ensure module exports remain intact