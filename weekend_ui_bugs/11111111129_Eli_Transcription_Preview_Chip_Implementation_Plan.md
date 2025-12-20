---
position:
  x: -596.1033930482402
  y: 5376.217460199645
isContextNode: false
created_at: "2025-12-13T23:44:27.230001"
modified_at: "2025-12-13T23:55:47.233075"
node_id: 4
---
# Eli: Transcription Preview Chip - Implementation Plan

### Summary

Implement a minimal inline chip that appears when recording speech into editors OR terminals. User confirms with Enter or dismisses with Escape. Simple floating HTML approach - no CodeMirror extension needed.

## UI Design

```
┌─────────────────────────────────────────┐
│ "transcribed text here..."   ↵ · Esc  │
└─────────────────────────────────────────┘
                    ↑
            cursor position
```

- Single line, compact chip
- Text left-aligned, truncated with `...` if long (full text on hover)
- Keyboard hints right-aligned, muted gray
- Rounded corners (8px), subtle shadow, backdrop-blur
- Positioned directly above cursor (editors) or input line (terminals)

## Behavior

| Trigger | Action |
|---------|--------|
| Enter | Insert text, dismiss chip |
| Escape | Dismiss without inserting |
| Click outside | Dismiss without inserting |
| Start typing | Dismiss without inserting |
| 10s timeout | Auto-dismiss |

## Files to Modify

### 1. `frontend/webapp/src/shell/edge/UI-edge/floating-windows/speech-to-focused.ts`

Add new functions:

```typescript
// State for active preview
let activePreview: { element: HTMLElement; cleanup: () => void } | null = null;

/**
 * Show transcription preview chip above cursor
 * Returns promise that resolves to true (inserted) or false (dismissed)
 */
export function showTranscriptionPreview(
  text: string,
  target: { type: 'editor'; view: EditorView } | { type: 'terminal'; id: string }
): Promise<boolean> {
  // 1. Dismiss any existing preview
  dismissTranscriptionPreview();
  
  // 2. Get position
  //    - Editor: view.coordsAtPos(selection.head)
  //    - Terminal: getBoundingClientRect() of terminal element
  
  // 3. Create chip element
  const chip = document.createElement('div');
  chip.className = 'transcription-preview-chip';
  chip.innerHTML = `
    <span class="preview-text" title="${escapeHtml(text)}">${truncate(text, 50)}</span>
    <span class="preview-hints">↵ · Esc</span>
  `;
  
  // 4. Position above cursor/input
  // 5. Add to document.body (or floating overlay)
  
  // 6. Setup keyboard listener
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertText(text, target);
      dismissTranscriptionPreview();
      resolve(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissTranscriptionPreview();
      resolve(false);
    }
  };
  
  // 7. Setup click-outside listener
  // 8. Setup timeout (10s)
  // 9. Return cleanup in activePreview
}

export function dismissTranscriptionPreview(): void {
  if (activePreview) {
    activePreview.cleanup();
    activePreview.element.remove();
    activePreview = null;
  }
}
```

### 2. `frontend/webapp/src/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender.ts`

Modify `sendToBackend` to use preview instead of direct insertion:

```typescript
// Before (direct insert):
routeSpeechToFocused(text);

// After (show preview):
const focused = getFocusedFloatingWindow();
if (focused) {
  const inserted = await showTranscriptionPreview(text, focused);
  if (!inserted) return; // User dismissed, don't send to server either
}
```

### 3. `frontend/webapp/src/shell/UI/cytoscape-graph-ui/styles/floating-windows.css`

Add styles:

```css
.transcription-preview-chip {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  backdrop-filter: blur(8px);
  z-index: 10000;
  max-width: 400px;
  font-size: 14px;
}

.transcription-preview-chip .preview-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--foreground);
}

.transcription-preview-chip .preview-hints {
  color: var(--muted-foreground);
  font-size: 12px;
  white-space: nowrap;
}
```

## Terminal-Specific Considerations

For terminals, we need to:
1. Get terminal element position via `document.querySelector('[data-floating-window-id="${id}"] .xterm')`
2. Position chip above the terminal input area (bottom of terminal)
3. On Enter: call `electronAPI.terminal.write(id, text)` (existing pattern)

## Implementation Order

1. Add CSS styles
2. Implement `showTranscriptionPreview()` for editors first
3. Test with editors
4. Add terminal support
5. Modify `useTranscriptionSender` to use new flow

## No New Files

All changes fit in existing files - follows "minimize complexity" principle.

-----------------
_Links:_

- [[weekend_ui_bugs/1765627819039JDW.md]]
[[weekend_ui_bugs/ctx-nodes/11111111129_Eli_Transcription_Preview_Chip_Implementation_Plan_context_1765629311483.md]]
