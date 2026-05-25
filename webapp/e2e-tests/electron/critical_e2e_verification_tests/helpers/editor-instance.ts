// Shared electron-test access to the live CodeMirror editor instance via the
// production `vanillaFloatingWindowInstances` store. Exposed in the renderer
// through `window.__vtDebug__.editorInstance(id)` so the bundled (no dev
// server) Electron renderer can be driven without touching CodeMirror's
// internal `.cmView` DOM property (renamed to `.cmTile` in @codemirror/view
// 6.43, which permanently broke the older `editorElement.cmView?.view…`
// pattern).
//
// Use `getEditorInstanceId(nodeId)` to derive the lookup key — it mirrors
// `getEditorId()` in `@/shell/edge/UI-edge/floating-windows/anchoring/types`.

import type { Page } from '@playwright/test'

type EditorInstanceDebugApi = {
  getValue?: () => string
  focus?: () => void
  focusAtEnd?: () => void
  dispose?: () => void
}

type WindowWithDebug = Window & {
  __vtDebug__?: {
    editorInstance?: (editorId: string) => EditorInstanceDebugApi | undefined
  }
}

export function getEditorInstanceId(nodeId: string): string {
  return `${nodeId}-editor`
}

export async function waitForEditorInstance(
  page: Page,
  editorInstanceId: string,
  timeoutMs: number = 5_000,
): Promise<void> {
  await page.waitForFunction((id) => {
    const debug = (window as WindowWithDebug).__vtDebug__
    if (!debug?.editorInstance) return false
    const instance = debug.editorInstance(id)
    return Boolean(instance && typeof instance.getValue === 'function')
  }, editorInstanceId, { timeout: timeoutMs })
}

export async function readEditorValue(page: Page, editorInstanceId: string): Promise<string> {
  return page.evaluate((id) => {
    const debug = (window as WindowWithDebug).__vtDebug__
    if (!debug?.editorInstance) throw new Error('window.__vtDebug__.editorInstance is unavailable')
    const instance = debug.editorInstance(id)
    if (!instance) throw new Error(`Editor instance not registered: ${id}`)
    if (typeof instance.getValue !== 'function') throw new Error(`Editor instance ${id} lacks getValue`)
    return instance.getValue()
  }, editorInstanceId)
}

export async function tryReadEditorValue(page: Page, editorInstanceId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const debug = (window as WindowWithDebug).__vtDebug__
    const instance = debug?.editorInstance?.(id)
    if (!instance || typeof instance.getValue !== 'function') return null
    return instance.getValue()
  }, editorInstanceId)
}

export async function focusEditorInstance(page: Page, editorInstanceId: string): Promise<void> {
  await page.evaluate((id) => {
    const debug = (window as WindowWithDebug).__vtDebug__
    if (!debug?.editorInstance) throw new Error('window.__vtDebug__.editorInstance is unavailable')
    const instance = debug.editorInstance(id)
    if (!instance) throw new Error(`Editor instance not registered: ${id}`)
    if (typeof instance.focus !== 'function') throw new Error(`Editor instance ${id} lacks focus`)
    instance.focus()
  }, editorInstanceId)
}

export async function focusEditorInstanceAtEnd(page: Page, editorInstanceId: string): Promise<void> {
  await page.evaluate((id) => {
    const debug = (window as WindowWithDebug).__vtDebug__
    if (!debug?.editorInstance) throw new Error('window.__vtDebug__.editorInstance is unavailable')
    const instance = debug.editorInstance(id)
    if (!instance) throw new Error(`Editor instance not registered: ${id}`)
    if (typeof instance.focusAtEnd !== 'function') throw new Error(`Editor instance ${id} lacks focusAtEnd`)
    instance.focusAtEnd()
  }, editorInstanceId)
}
