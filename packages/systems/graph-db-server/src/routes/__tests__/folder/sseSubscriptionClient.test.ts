import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'

async function withTempVault(): Promise<string> {
    return await mkdtemp(join(tmpdir(), 'sse-client-test-'))
}

async function createAppSupport(vault: string): Promise<string> {
    const appSupport = await mkdtemp(join(tmpdir(), 'sse-client-appsupport-'))
    const config = {
        vaultConfig: {
            [vault]: { writeFolder: vault },
        },
    }
    await writeFile(join(appSupport, 'voicetree-config.json'), JSON.stringify(config))
    return appSupport
}

function parseSSEGraphBlock(block: string): ProjectedGraph | null {
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) return null
    try {
        return JSON.parse(dataLine.slice('data:'.length).trim())
    } catch {
        return null
    }
}

type ForwardedGraph = { channel: string; data: unknown }

function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'AbortError'
}

async function subscribeAndCollect(
    baseUrl: string,
    sessionId: string,
    controller: AbortController,
    forwarded: ForwardedGraph[],
): Promise<void> {
    const response = await fetch(`${baseUrl}/sessions/${sessionId}/events`, {
        signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''

    try {
        while (!controller.signal.aborted) {
            const { done, value } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            const blocks = buffered.split('\n\n')
            buffered = blocks.pop() ?? ''
            for (const block of blocks) {
                const graph = parseSSEGraphBlock(block)
                if (graph) {
                    forwarded.push({ channel: 'graph:projectedGraphUpdate', data: graph })
                }
            }
        }
    } catch (error) {
        if (!(controller.signal.aborted && isAbortError(error))) {
            throw error
        }
    }
}

describe('SSE subscription client round-trip', () => {
    let vault: string
    let appSupport: string
    let handles: DaemonHandle[]
    let sseController: AbortController | null

    beforeEach(async () => {
        vault = await withTempVault()
        appSupport = await createAppSupport(vault)
        handles = []
        sseController = null
    })

    afterEach(async () => {
        sseController?.abort()
        await new Promise(r => setTimeout(r, 50))
        for (const handle of handles) {
            await handle.stop().catch(() => {})
        }
        await rm(vault, { recursive: true, force: true })
        await rm(appSupport, { recursive: true, force: true })
    }, 15000)

    test('client receives and can forward HTTP-posted deltas via SSE as ProjectedGraph', async () => {
        const handle = await startDaemon({ vault, voicetreeHomePath: appSupport })
        handles.push(handle)
        const base = `http://127.0.0.1:${handle.port}`

        const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
        expect(createRes.status).toBe(201)
        const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

        sseController = new AbortController()
        const forwarded: ForwardedGraph[] = []
        void subscribeAndCollect(base, sessionId, sseController, forwarded)

        await new Promise(r => setTimeout(r, 200))

        const testNodePath = join(vault, 'sse-client-test.md')
        const delta = [
            {
                type: 'UpsertNode',
                nodeToUpsert: {
                    kind: 'leaf',
                    outgoingEdges: [],
                    absoluteFilePathIsID: testNodePath,
                    contentWithoutYamlOrLinks: '# SSE Client Test\nRound-trip',
                    nodeUIMetadata: {
                        color: { _tag: 'None' },
                        position: { _tag: 'None' },
                        additionalYAMLProps: {},
                    },
                },
                previousNode: { _tag: 'None' },
            },
        ]

        const deltaRes = await fetch(`${base}/graph/delta`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': sessionId,
            },
            body: JSON.stringify(delta),
        })
        expect(deltaRes.status).toBe(200)

        const deadline = Date.now() + 5000
        while (Date.now() < deadline && forwarded.length === 0) {
            await new Promise(r => setTimeout(r, 100))
        }

        const match = forwarded.find(f => f.channel === 'graph:projectedGraphUpdate')
        expect(match).toBeDefined()
        const graph = match!.data as ProjectedGraph
        expect(graph.nodes).toBeDefined()
        expect(graph.edges).toBeDefined()
        const node = graph.nodes.find(n => n.id === testNodePath)
        expect(node).toBeDefined()
    }, 20000)
})
