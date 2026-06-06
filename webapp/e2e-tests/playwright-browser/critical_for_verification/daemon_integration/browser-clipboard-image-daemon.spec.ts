/**
 * Browser VoiceTree — clipboard image I/O gateway (daemon round-trip).
 *
 * Proves the no-Electron clipboard image flow end-to-end against the REAL
 * daemons booted by globalSetup. The wired browser path is:
 *   OS clipboard → readClipboardImageBlob (Clipboard API)
 *     → hostAPI.main.saveClipboardImage → VTD POST /clipboard-image (writes file)
 *   hostAPI.main.readImageAsDataUrl → VTD GET /image → data URL.
 *
 * We put a known PNG on the OS clipboard via the async Clipboard API (granted
 * clipboard permissions), drive the REAL hostAPI methods, and assert the bytes
 * round-trip: the file VTD wrote on disk equals the source bytes, and the data
 * URL VTD streams back re-encodes to the same bytes. No mocks.
 */

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {test, expect} from '@playwright/test'
import {loadDaemonConfig, injectConfig, waitForHostApiReady} from './vt-e2e-helpers.ts'

// 1×1 PNG (opaque). Base64 is the on-the-wire form the data URL must echo back.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

interface ClipboardMain {
    readonly getGraph: () => Promise<{nodes?: Record<string, unknown>}>
    readonly saveClipboardImage: (nodeId: string) => Promise<string | null>
    readonly readImageAsDataUrl: (filePath: string) => Promise<string | null>
}
type ClipboardWindow = {hostAPI: {main: ClipboardMain}}

test.describe('Browser VoiceTree — clipboard image gateway (daemon round-trip)', () => {

    test('paste→save an image then reload it: bytes round-trip through VTD', async ({page, context}) => {
        const cfg = loadDaemonConfig()
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await injectConfig(page, cfg)
        await page.goto('/')
        await page.bringToFront() // clipboard write requires a focused document
        await waitForHostApiReady(page)

        const outcome = await page.evaluate(async ({pngBase64}) => {
            const main = (window as unknown as ClipboardWindow).hostAPI.main

            // Anchor the image to a REAL graph node so its dirname is inside the
            // project allowlist (VTD scopes the write there). The seeded leaf node's
            // id is its absolute markdown path.
            const graph = await main.getGraph()
            const nodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
            if (!nodeId) return {error: 'no leaf node in graph'}

            // Put the PNG on the OS clipboard via the async Clipboard API — the
            // exact source saveClipboardImage reads from.
            const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))
            const blob = new Blob([bytes], {type: 'image/png'})
            try {
                await navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
            } catch (e) {
                return {error: `clipboard write unsupported: ${(e as Error).message}`}
            }

            const filename = await main.saveClipboardImage(nodeId)
            if (filename === null) return {error: 'saveClipboardImage returned null (no image read back)'}

            // Reload via the read route using the absolute path (sibling of node).
            const slash = Math.max(nodeId.lastIndexOf('/'), nodeId.lastIndexOf('\\'))
            const absImagePath = `${nodeId.slice(0, slash)}/${filename}`
            const dataUrl = await main.readImageAsDataUrl(absImagePath)
            return {nodeId, filename, absImagePath, dataUrl}
        }, {pngBase64: PNG_BASE64})

        expect(outcome.error, `clipboard flow setup failed: ${outcome.error ?? ''}`).toBeUndefined()

        // SAVE: VTD wrote `pasted-<ts>.png` next to the node. The on-disk bytes are
        // a real PNG (Chromium normalizes/re-encodes the clipboard image, so they
        // need not be byte-identical to PNG_BASE64 — only a valid PNG).
        expect(outcome.filename!).toMatch(/^pasted-\d+\.png$/)
        const onDiskPath = join(outcome.nodeId!.slice(0, outcome.nodeId!.lastIndexOf('/')), outcome.filename!)
        expect(existsSync(onDiskPath), 'pasted image must exist on disk').toBe(true)
        const onDiskBase64 = readFileSync(onDiskPath).toString('base64')
        // PNG 8-byte signature (89 50 4E 47 0D 0A 1A 0A) → base64 prefix "iVBORw0KGgo".
        expect(onDiskBase64.startsWith('iVBORw0KGgo'), 'saved file must be a real PNG').toBe(true)

        // RELOAD round-trip: the bytes VTD streams back via /image must EQUAL the
        // bytes VTD wrote — this is the wired write→read integrity under test
        // (independent of the clipboard's own re-encoding).
        expect(outcome.dataUrl, 'readImageAsDataUrl must return a data URL').not.toBeNull()
        expect(outcome.dataUrl!.startsWith('data:image/png;base64,')).toBe(true)
        expect(
            outcome.dataUrl!.slice('data:image/png;base64,'.length),
            'data URL bytes must equal the on-disk bytes (VTD write→read round-trip)',
        ).toBe(onDiskBase64)
    })

    test('readImageAsDataUrl returns null for a missing image (404 → null)', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const dataUrl = await page.evaluate(
            (missing) => (window as unknown as ClipboardWindow).hostAPI.main.readImageAsDataUrl(missing),
            join(cfg.projectPath, 'definitely-absent.png'),
        )
        expect(dataUrl).toBeNull()
    })

})
