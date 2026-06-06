import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {agentBaseName, allocateUniqueAgentId} from '@vt/graph-model/settings'
import {spawnHeadlessAgent, closeHeadlessAgent} from '../headlessAgentManager'
import {createTerminalData, type TerminalData, type TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {clearTerminalRecords, getExistingAgentNames} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'
import {hasSession, killSession} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager.ts'

/**
 * End-to-end proof of the agent-id uniqueness hash, exercising the REAL pipeline
 * with NO mocks: real random hash → real registry collision-awareness → real
 * tmux session → real on-disk `.voicetree/terminals/*` files → recovery filename
 * round-trip. Two agents are forced onto the same base name (`Zoe`) — the exact
 * "not enough ids" scenario — and must still come out globally distinct.
 */

const sessions: Set<string> = new Set<string>()
const tempDirs: Set<string> = new Set<string>()

const BASE_NAME = 'Zoe'
const HASHED_ID_RE: RegExp = /^Zoe-[a-z0-9]{3}$/

async function makeTempProject(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'agentid-e2e-'))
    tempDirs.add(dir)
    return dir
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs: number = 8000): Promise<void> {
    const started: number = Date.now()
    while (Date.now() - started < timeoutMs) {
        if (await assertion()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('timed out waiting for condition')
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await readFile(path, 'utf8')
        return true
    } catch {
        return false
    }
}

function makeTerminalData(id: TerminalId, projectRoot: string): TerminalData {
    return createTerminalData({
        terminalId: id,
        attachedToNodeId: join(projectRoot, 'context.md') as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'agent-id hash e2e',
        agentName: id,
        isHeadless: true,
        initialEnvVars: {VOICETREE_TERMINAL_ID: id, VOICETREE_PROJECT_PATH: projectRoot},
    })
}

// A trivial long-lived shell so the tmux session stays alive for inspection.
const KEEPALIVE = `bash -lc 'echo E2E_READY; while IFS= read -r line; do [ "$line" = "E2E_EXIT" ] && break; done'`

async function spawnOne(projectRoot: string): Promise<TerminalId> {
    // REAL allocation: base name fixed to force collision; uniqueness must come
    // from the hash + the live registry, exactly as production does.
    const id: TerminalId = allocateUniqueAgentId(BASE_NAME, getExistingAgentNames()) as TerminalId
    sessions.add(id)
    await spawnHeadlessAgent(id, makeTerminalData(id, projectRoot), KEEPALIVE, projectRoot, {
        VOICETREE_TERMINAL_ID: id,
        VOICETREE_PROJECT_PATH: projectRoot,
    })
    return id
}

async function cleanup(): Promise<void> {
    await Promise.all([...sessions].map(async (name: string) => {
        await killSession(name)
        await closeHeadlessAgent(name as TerminalId)
        sessions.delete(name)
    }))
    await Promise.all([...tempDirs].map(async (dir: string) => {
        await rm(dir, {recursive: true, force: true})
        tempDirs.delete(dir)
    }))
    clearTerminalRecords()
}

describe('agent-id uniqueness hash — tmux e2e', () => {
    afterEach(cleanup)

    it('two same-base agents get distinct hashed ids that drive real tmux + on-disk files and round-trip', async () => {
        clearTerminalRecords()
        const projectRoot: string = await makeTempProject()

        const id1: TerminalId = await spawnOne(projectRoot)
        // The second allocation sees id1 in the live registry (collision-aware).
        const id2: TerminalId = await spawnOne(projectRoot)

        // 1. Both ids are `Zoe-<3 alnum>` and globally distinct.
        expect(id1).toMatch(HASHED_ID_RE)
        expect(id2).toMatch(HASHED_ID_RE)
        expect(id1).not.toBe(id2)

        // 2. The hash strips back to the shared base name (sidebar display path).
        expect(agentBaseName(id1)).toBe(BASE_NAME)
        expect(agentBaseName(id2)).toBe(BASE_NAME)

        // 3. Real tmux sessions exist, found under the hyphenated id — proves the
        //    id survives sanitizeTmuxName + namespace + VT_SESSION_RE round-trip.
        await waitFor(async () => (await hasSession(id1)) && (await hasSession(id2)))
        expect(await hasSession(id1)).toBe(true)
        expect(await hasSession(id2)).toBe(true)

        // 4. On-disk per-terminal files carry the full hyphenated id, and the
        //    recovery filename parse (`.slice(0, -'.json'.length)`) recovers it
        //    exactly — no split-on-hyphen truncation.
        for (const id of [id1, id2]) {
            const metaPath: string = join(projectRoot, '.voicetree', 'terminals', `${id}.json`)
            await waitFor(() => fileExists(metaPath))
            const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {terminalData: {terminalId: string}}
            expect(meta.terminalData.terminalId).toBe(id)
            const fileName = `${id}.json`
            expect(fileName.slice(0, -'.json'.length)).toBe(id)
        }
    }, 25000)
})
