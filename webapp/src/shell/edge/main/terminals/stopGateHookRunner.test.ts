/**
 * Integration tests for stopGateHookRunner.ts
 *
 * Uses REAL hook runner modules. Mocks only external/UI leaf dependencies.
 * Tests: default config fallback, shell command hooks, legacy builtin passthrough,
 * aggregation, and context building.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'

// ─── Mock external/UI leaf dependencies (must be before real imports) ────────

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }))
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn().mockResolvedValue({success: true})
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {syncTerminals: vi.fn()}
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({autoNotifyUnseenNodes: false})
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))

// ─── Import real modules (after mocks) ──────────────────────────────────────

import {runStopHooks, type StopHookResult} from './stopGateHookRunner'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from './terminal-registry'
import type {Graph} from '@/pure/graph'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(id: string, opts?: {
    parentId?: string
    agentName?: string
    isHeadless?: boolean
    anchoredToNodeId?: string
    initialEnvVars?: Record<string, string>
    isDone?: boolean
    status?: 'running' | 'exited'
    exitCode?: number | null
    spawnedAt?: number
}): TerminalRecord {
    const terminalData: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${id}.md`,
        terminalCount: 0,
        title: id,
        agentName: opts?.agentName ?? id,
        isHeadless: opts?.isHeadless ?? false,
        parentTerminalId: (opts?.parentId ?? null) as TerminalId | null,
        anchoredToNodeId: opts?.anchoredToNodeId,
        initialEnvVars: opts?.initialEnvVars,
    })
    return {
        terminalId: id,
        terminalData: {...terminalData, isDone: opts?.isDone ?? false},
        status: opts?.status ?? 'running',
        exitCode: opts?.exitCode ?? null,
        auditRetryCount: 0,
        spawnedAt: opts?.spawnedAt ?? Date.now()
    }
}

const emptyGraph: Graph = {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map()
}

// ─── HOME management (shared across all describe blocks) ────────────────────

let tempHome: string
let originalHome: string | undefined

beforeEach(() => {
    originalHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hooktest-'))
    fs.mkdirSync(path.join(tempHome, 'brain', 'automation'), {recursive: true})
    process.env.HOME = tempHome
})

afterEach(() => {
    fs.rmSync(tempHome, {recursive: true, force: true})
    process.env.HOME = originalHome ?? ''
})

function writeHooks(hooks: unknown): void {
    fs.writeFileSync(
        path.join(tempHome, 'brain', 'automation', 'hooks.json'),
        JSON.stringify(hooks)
    )
}

function writeDefaultAuditScript(source: string): void {
    fs.writeFileSync(path.join(tempHome, 'brain', 'automation', 'stop-gate-audit.ts'), source)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('runStopHooks with default config', () => {
    it('uses the default standalone audit command and passes stdin context', async () => {
        const ctxFile: string = path.join(os.tmpdir(), `default-hook-stdin-${Date.now()}.json`)
        writeDefaultAuditScript(`
import * as fs from 'fs'

const input = fs.readFileSync(0, 'utf-8')
fs.writeFileSync(${JSON.stringify(ctxFile)}, input)
process.exit(0)
`)

        const record: TerminalRecord = makeRecord('test-agent')
        const result: StopHookResult = await runStopHooks('test-agent', emptyGraph, [record])
        expect(result.passed).toBe(true)

        const written: string = fs.readFileSync(ctxFile, 'utf-8')
        const ctx: Record<string, unknown> = JSON.parse(written) as Record<string, unknown>
        expect(ctx.terminalId).toBe('test-agent')
        expect(ctx.agentName).toBe('test-agent')

        fs.rmSync(ctxFile, {force: true})
    })

    it('blocks when the default standalone audit exits 2', async () => {
        writeDefaultAuditScript(`
process.stderr.write('default audit blocked stop\\n')
process.exit(2)
`)

        const record: TerminalRecord = makeRecord('test-agent')
        const result: StopHookResult = await runStopHooks('test-agent', emptyGraph, [record])
        expect(result.passed).toBe(false)
        expect(result.message).toContain('default audit blocked stop')
    })
})

describe('shell command hooks', () => {
    it('shell hook exit 0 passes', async () => {
        writeHooks({Stop: [{type: 'command', command: 'exit 0'}]})
        const record: TerminalRecord = makeRecord('shell-agent')
        const result: StopHookResult = await runStopHooks('shell-agent', emptyGraph, [record])
        expect(result.passed).toBe(true)
    })

    it('shell hook exit 2 blocks with stderr message', async () => {
        writeHooks({Stop: [{type: 'command', command: "echo 'hook failed: missing X' >&2; exit 2"}]})
        const record: TerminalRecord = makeRecord('shell-agent')
        const result: StopHookResult = await runStopHooks('shell-agent', emptyGraph, [record])
        expect(result.passed).toBe(false)
        expect(result.message).toContain('hook failed: missing X')
    })

    it('shell hook exit 1 passes (tolerant)', async () => {
        writeHooks({Stop: [{type: 'command', command: 'exit 1'}]})
        const record: TerminalRecord = makeRecord('shell-agent')
        const result: StopHookResult = await runStopHooks('shell-agent', emptyGraph, [record])
        expect(result.passed).toBe(true)
    })

    it('shell hook receives context as stdin JSON', async () => {
        const ctxFile: string = path.join(os.tmpdir(), `hook-stdin-${Date.now()}.json`)
        writeHooks({Stop: [{type: 'command', command: `cat > ${ctxFile}; exit 0`}]})
        const record: TerminalRecord = makeRecord('ctx-agent', {
            initialEnvVars: {VOICETREE_VAULT_PATH: '/my/vault'}
        })
        await runStopHooks('ctx-agent', emptyGraph, [record])

        const written: string = fs.readFileSync(ctxFile, 'utf-8')
        const ctx: Record<string, unknown> = JSON.parse(written) as Record<string, unknown>
        expect(ctx.terminalId).toBe('ctx-agent')
        expect(ctx.agentName).toBe('ctx-agent')
        expect(ctx.vaultPath).toBe('/my/vault')

        fs.rmSync(ctxFile, {force: true})
    })
})

describe('hook aggregation', () => {
    it('legacy builtin hooks warn, pass, and still allow later command failures to aggregate', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        writeHooks({
            Stop: [
                {type: 'builtin', name: 'progress-node-check'},
                {type: 'command', command: "echo 'shell hook error' >&2; exit 2"}
            ]
        })
        const record: TerminalRecord = makeRecord('agg-agent')
        const result: StopHookResult = await runStopHooks('agg-agent', emptyGraph, [record])
        expect(result.passed).toBe(false)
        expect(result.message).toContain('shell hook error')
        expect(warnSpy).toHaveBeenCalledWith(
            '[stopGateHookRunner] builtin hook "progress-node-check" is no longer supported; skipping.'
        )
        warnSpy.mockRestore()
    })

    it('all pass = overall pass', async () => {
        writeHooks({
            Stop: [
                {type: 'command', command: 'exit 0'},
                {type: 'command', command: 'exit 0'}
            ]
        })
        const record: TerminalRecord = makeRecord('agg-agent')
        const result: StopHookResult = await runStopHooks('agg-agent', emptyGraph, [record])
        expect(result.passed).toBe(true)
    })
})

describe('context building', () => {
    it('child agents are included in context', async () => {
        const ctxFile: string = path.join(os.tmpdir(), `hook-ctx-children-${Date.now()}.json`)
        writeHooks({Stop: [{type: 'command', command: `cat > ${ctxFile}; exit 0`}]})

        const parentRecord: TerminalRecord = makeRecord('parent-agent')
        const child1Record: TerminalRecord = makeRecord('child-1', {parentId: 'parent-agent'})
        const child2Record: TerminalRecord = makeRecord('child-2', {parentId: 'parent-agent'})

        await runStopHooks('parent-agent', emptyGraph, [parentRecord, child1Record, child2Record])

        const written: string = fs.readFileSync(ctxFile, 'utf-8')
        const ctx: {childAgents: unknown[]} = JSON.parse(written) as {childAgents: unknown[]}
        expect(ctx.childAgents).toHaveLength(2)

        fs.rmSync(ctxFile, {force: true})
    })
})
