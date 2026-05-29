import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  HealthResponseSchema,
  LiveStateSnapshotSchema,
  SessionCreateResponseSchema,
  startDaemon,
  type DaemonHandle,
} from '../src/daemon/index.ts'
import { clearWatchFolderState } from '../src/state/watch-folder-store.ts'
import { setGraph } from '../src/state/graph-store.ts'
import { createEmptyGraph } from '@vt/graph-model'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'

// Mulberry32 seeded PRNG for deterministic replay
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

const SEED = 42
const NUM_SEQUENCES = 100
const MIN_STEPS = 10
const MAX_STEPS = 20

type Action = 'createSession' | 'collapse' | 'expand' | 'setSelection' | 'setLayout' | 'getState'

const ACTIONS: Action[] = ['createSession', 'collapse', 'expand', 'setSelection', 'setLayout', 'getState']

describe('session-state fuzz', () => {
  let root: string
  let vault: string
  let handle: DaemonHandle
  let baseUrl: string
  let nodeIds: string[]
  let folderIds: string[]

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-fuzz-session-'))
    vault = path.join(root, 'vault')
    const voicetreeHomePath = path.join(root, 'app-support')
    process.env.VOICETREE_HOME_PATH = voicetreeHomePath
    await mkdir(vault, { recursive: true })

    const notes = path.join(vault, 'notes')
    const projects = path.join(vault, 'projects')
    const projectsSub = path.join(projects, 'alpha')
    await mkdir(notes, { recursive: true })
    await mkdir(projectsSub, { recursive: true })

    const files = [
      { dir: notes, name: 'one.md', content: '---\nposition:\n  x: 10\n  y: 20\n---\n# One\nContent.\n' },
      { dir: notes, name: 'two.md', content: '---\nposition:\n  x: 30\n  y: 40\n---\n# Two\nContent.\n' },
      { dir: projects, name: 'root.md', content: '---\nposition:\n  x: 50\n  y: 60\n---\n# Root\nProject root.\n' },
      { dir: projectsSub, name: 'task.md', content: '---\nposition:\n  x: 70\n  y: 80\n---\n# Task\nAlpha task.\n' },
    ]

    for (const f of files) {
      await writeFile(path.join(f.dir, f.name), f.content, 'utf8')
    }

    nodeIds = files.map((f) => path.join(f.dir, f.name))
    folderIds = [vault, notes, projects, projectsSub]

    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await saveVaultConfigForDirectory(vault, { writeFolder: '.' })

    handle = await startDaemon({
      vault,
      voicetreeHomePath,
      createStarterIfEmpty: false,
    })
    baseUrl = `http://127.0.0.1:${handle.port}`

    await waitFor(async () => {
      const body = (await (await fetch(`${baseUrl}/graph`)).json()) as { nodes: Record<string, unknown> }
      const foundAll = nodeIds.every((id) => body.nodes[id] !== undefined)
      return foundAll ? body : null
    }, 10000)
  }, 30000)

  afterAll(async () => {
    await handle?.stop().catch(() => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  it(`runs ${NUM_SEQUENCES} random session operation sequences`, async () => {
    const rng = mulberry32(SEED)
    const activeSessions: string[] = []
    let expectedSessionCount = 0

    for (let seq = 0; seq < NUM_SEQUENCES; seq++) {
      const steps = randInt(rng, MIN_STEPS, MAX_STEPS)

      if (activeSessions.length === 0) {
        const res = await fetch(`${baseUrl}/sessions`, { method: 'POST' })
        expect(res.status).toBe(201)
        const body = SessionCreateResponseSchema.parse(await res.json())
        activeSessions.push(body.sessionId)
        expectedSessionCount++
      }

      for (let step = 0; step < steps; step++) {
        const action = pick(rng, ACTIONS)
        const sessionId = pick(rng, activeSessions)

        switch (action) {
          case 'createSession': {
            const res = await fetch(`${baseUrl}/sessions`, { method: 'POST' })
            expect(res.status).toBe(201)
            const body = SessionCreateResponseSchema.parse(await res.json())
            activeSessions.push(body.sessionId)
            expectedSessionCount++

            const health = HealthResponseSchema.parse(
              await (await fetch(`${baseUrl}/health`)).json(),
            )
            expect(health.sessionCount).toBe(expectedSessionCount)
            break
          }

          case 'collapse': {
            const folderId = pick(rng, folderIds)
            const res = await fetch(
              `${baseUrl}/sessions/${sessionId}/folder-state/${encodeURIComponent(folderId)}`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ state: 'collapsed' }),
              },
            )
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body).toHaveProperty('folderState')
            expect(Array.isArray(body.folderState)).toBe(true)
            break
          }

          case 'expand': {
            const folderId = pick(rng, folderIds)
            const res = await fetch(
              `${baseUrl}/sessions/${sessionId}/folder-state/${encodeURIComponent(folderId)}`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ state: 'expanded' }),
              },
            )
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body).toHaveProperty('folderState')
            expect(Array.isArray(body.folderState)).toBe(true)
            break
          }

          case 'setSelection': {
            const count = randInt(rng, 0, nodeIds.length)
            const shuffled = [...nodeIds].sort(() => rng() - 0.5)
            const selected = shuffled.slice(0, count)
            const mode = pick(rng, ['replace', 'add', 'remove'] as const)

            const res = await fetch(`${baseUrl}/sessions/${sessionId}/selection`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ nodeIds: selected, mode }),
            })
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body).toHaveProperty('selection')
            expect(Array.isArray(body.selection)).toBe(true)
            for (const id of body.selection) {
              expect(nodeIds).toContain(id)
            }
            break
          }

          case 'setLayout': {
            const posCount = randInt(rng, 0, nodeIds.length)
            const posNodes = [...nodeIds].sort(() => rng() - 0.5).slice(0, posCount)
            const positions: Record<string, { x: number; y: number }> = {}
            for (const id of posNodes) {
              positions[id] = {
                x: (rng() - 0.5) * 10000,
                y: (rng() - 0.5) * 10000,
              }
            }

            const zoom = rng() * 9.5 + 0.5
            const pan = { x: (rng() - 0.5) * 2000, y: (rng() - 0.5) * 2000 }

            const res = await fetch(`${baseUrl}/sessions/${sessionId}/layout`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ positions, pan, zoom }),
            })
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body).toHaveProperty('layout')
            expect(body.layout.zoom).toBeGreaterThan(0)
            break
          }

          case 'getState': {
            const res = await fetch(`${baseUrl}/sessions/${sessionId}/state`)
            expect(res.status).toBe(200)
            const body = await res.json()
            const snapshot = LiveStateSnapshotSchema.parse(body)

            for (const id of snapshot.selection) {
              expect(nodeIds).toContain(id)
            }

            for (const [folder] of snapshot.folderState) {
              expect(folderIds).toContain(folder)
            }

            for (const [posId] of snapshot.layout.positions) {
              expect(nodeIds).toContain(posId)
            }

            if (snapshot.layout.zoom !== undefined) {
              expect(snapshot.layout.zoom).toBeGreaterThan(0)
            }
            break
          }
        }
      }
    }
  }, 120000)
})
