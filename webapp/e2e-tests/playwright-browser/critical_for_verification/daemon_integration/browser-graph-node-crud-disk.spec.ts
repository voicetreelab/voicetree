/**
 * Browser VoiceTree — node CRUD proven on DISK (daemon round-trip).
 *
 * The headline gap the older suite left open: node create/edit/delete was only
 * ever read back through the same in-memory API that wrote it, so a graph that
 * never reached the filesystem would still pass. Here every step is asserted
 * against the REAL markdown file under the daemon's project dir, read straight
 * from the Playwright worker (Node) — the daemon and the worker share the host
 * filesystem, so `cfg.projectPath` is the same bytes the browser's writes land in.
 *
 *   create → file exists on disk with the written body
 *   edit   → file body on disk changes (writeMarkdownFile)
 *   delete → file is removed from disk AND getNode returns null
 *
 * Black-box: the observable side effect is the file, not any internal call.
 */

import {test, expect} from '@playwright/test'
import {readFile, access} from 'node:fs/promises'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
} from './vt-e2e-helpers.ts'

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Poll the disk until `predicate(contentOrNull)` holds or the deadline passes. */
async function pollDisk(
  path: string,
  predicate: (content: string | null) => boolean,
  timeoutMs = 8000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  let last: string | null = null
  while (Date.now() < deadline) {
    last = (await fileExists(path)) ? await readFile(path, 'utf8') : null
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  return last
}

test.describe('Browser VoiceTree — node CRUD on disk', () => {

  test('create → edit → delete round-trips through the real markdown file', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const writeFolder = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {getWriteFolderPath?: () => Promise<{_tag?: string; value?: string}>}}}).hostAPI
      const opt = await api?.main?.getWriteFolderPath?.()
      return opt?._tag === 'Some' ? opt.value ?? null : null
    })
    expect(typeof writeFolder, 'browser must resolve a write folder under the project').toBe('string')

    const marker = `VT_CRUD_${Date.now()}`
    const filePath = `${writeFolder}/browser-crud-${marker}.md`
    const createdBody = `# ${marker}\nfirst body written by applyGraphDelta`

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.evaluate(async ({filePath, body}) => {
      const api = (window as unknown as {hostAPI?: {main?: {applyGraphDeltaToDBThroughMemAndUIExposed?: (d: unknown) => Promise<void>}}}).hostAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([{
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          absoluteFilePathIsID: filePath,
          contentWithoutYamlOrLinks: body,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: {_tag: 'None'},
            position: {_tag: 'Some', value: {x: 100, y: 100}},
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        previousNode: {_tag: 'None'},
      }])
    }, {filePath, body: createdBody})

    const afterCreate = await pollDisk(filePath, (c) => c !== null && c.includes(marker))
    expect(afterCreate, 'create must write the node to disk under the project').not.toBeNull()
    expect(afterCreate, 'on-disk body must contain the written content').toContain('first body written by applyGraphDelta')

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const editedSentinel = `edited body ${marker}`
    await page.evaluate(async ({filePath, body}) => {
      const api = (window as unknown as {hostAPI?: {main?: {writeMarkdownFile?: (p: string, b: string, e: string) => Promise<unknown>}}}).hostAPI
      await api?.main?.writeMarkdownFile?.(filePath, `# ${'edit'}\n${body}\n`, 'browser-crud-test-editor')
    }, {filePath, body: editedSentinel})

    const afterEdit = await pollDisk(filePath, (c) => c !== null && c.includes(editedSentinel))
    expect(afterEdit, 'edit must rewrite the file body on disk').toContain(editedSentinel)
    expect(afterEdit, 'edit must replace the original create body').not.toContain('first body written by applyGraphDelta')

    // ── DELETE ────────────────────────────────────────────────────────────────
    await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {applyGraphDeltaToDBThroughMemAndUIExposed?: (d: unknown) => Promise<void>}}}).hostAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([{type: 'DeleteNode', nodeId: filePath, deletedNode: {_tag: 'None'}}])
    }, {filePath})

    const afterDelete = await pollDisk(filePath, (c) => c === null)
    expect(afterDelete, 'delete must remove the markdown file from disk').toBeNull()

    const getNodeResult = await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {getNode?: (id: string) => Promise<unknown>}}}).hostAPI
      return api?.main?.getNode?.(filePath)
    }, {filePath})
    expect(getNodeResult, 'deleted node must be absent from the graph too').toBeNull()
  })

})
