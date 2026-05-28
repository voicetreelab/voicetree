// Renderer-side editor-instance accessor for window.__vtDebug__.
// Electron tests need a public hook because the bundled renderer cannot
// dynamic-import /src/... paths (no dev server). The store itself is the
// existing source of truth — this helper only re-exposes it through the
// well-known debug namespace so tests can call public CodeMirrorEditorView
// methods (getValue / focus / focusAtEnd) without reaching for the
// CodeMirror-internal `.cmView` DOM property that 6.43 renamed to `.cmTile`.

import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState'

export type EditorInstanceDebugApi = {
  readonly getValue?: () => string
  readonly focus?: () => void
  readonly focusAtEnd?: () => void
  readonly dispose?: () => void
}

export function getEditorInstanceForDebug(editorId: string): EditorInstanceDebugApi | undefined {
  return vanillaFloatingWindowInstances.get(editorId)
}
