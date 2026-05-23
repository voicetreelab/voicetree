import {describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {captureMissingNativeSessions, type CaptureMissingNativeSessionsDeps} from './captureNativeSessions'
import type {TerminalRecord} from '../terminals/terminal-registry'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import type {PersistRecoveryRequest, PersistRecoveryResult} from './resolvers/persistRecoveryNative'
import type {ResolveClaudeRequest, ResolveClaudeResult} from './resolvers/resolveClaudeNativeSession'
import type {ResolveCodexRequest, ResolveCodexResult} from './resolvers/resolveCodexNativeSession'

const VAULT_PATH = '/vault'

function terminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Alice' as TerminalId,
        attachedToContextNodeId: '/vault/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Alice',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'active',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Alice',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {
            VOICETREE_VAULT_PATH: VAULT_PATH,
            TASK_NODE_PATH: '/vault/task.md',
        },
        ...overrides,
    }
}

function makeRecord(data: TerminalData): TerminalRecord {
    return {
        terminalId: data.terminalId,
        terminalData: data,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: Date.now(),
    }
}

function metadataWithoutRecovery(name: string): TmuxTerminalMetadata {
    return {
        name,
        status: 'running',
        session: `vt-hash-${name}`,
    }
}

function metadataWithRecovery(name: string): TmuxTerminalMetadata {
    return {
        ...metadataWithoutRecovery(name),
        recovery: {
            native: {
                cli: 'claude',
                mode: 'interactive',
                sessionId: 'already-captured-id',
                capturedAt: '2026-05-22T10:00:00.000Z',
                source: 'claude-project-transcript',
            },
        },
    }
}

type Capture = {
    readonly writes: PersistRecoveryRequest[]
    readonly claudeCalls: ResolveClaudeRequest[]
    readonly codexCalls: ResolveCodexRequest[]
}

function buildDeps(opts: {
    readonly records: readonly TerminalRecord[]
    readonly metadataByPath: Readonly<Record<string, TmuxTerminalMetadata | null>>
    readonly claude?: (request: ResolveClaudeRequest) => ResolveClaudeResult
    readonly codex?: (request: ResolveCodexRequest) => ResolveCodexResult
}): {readonly deps: CaptureMissingNativeSessionsDeps; readonly capture: Capture} {
    const capture: Capture = {writes: [], claudeCalls: [], codexCalls: []}
    const deps: CaptureMissingNativeSessionsDeps = {
        getTerminalRecords: () => opts.records,
        readMetadataAt: (p) => opts.metadataByPath[p] ?? null,
        resolveClaude: (request) => {
            capture.claudeCalls.push(request)
            return (opts.claude ?? ((): ResolveClaudeResult => ({kind: 'not-found'})))(request)
        },
        resolveCodex: (request) => {
            capture.codexCalls.push(request)
            return (opts.codex ?? ((): ResolveCodexResult => ({kind: 'not-found'})))(request)
        },
        persist: (request) => {
            capture.writes.push(request)
            return {kind: 'persisted', handle: {
                cli: request.cli,
                mode: request.mode,
                sessionId: request.sessionId,
                capturedAt: '2026-05-22T10:00:00.000Z',
                source: request.source,
                ...(request.providerStorePath ? {providerStorePath: request.providerStorePath} : {}),
            }} satisfies PersistRecoveryResult
        },
    }
    return {deps, capture}
}

describe('captureMissingNativeSessions', () => {
    it('captures a missing sessionId for a live Claude terminal and persists with claude-project-transcript source', () => {
        const record = makeRecord(terminalData({terminalId: 'Alice' as TerminalId, agentName: 'Alice'}))
        const metadataPath = '/vault/.voicetree/terminals/Alice.json'
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {[metadataPath]: metadataWithoutRecovery('Alice')},
            claude: () => ({kind: 'found', sessionId: 'sess-claude-alice', providerStorePath: '/Users/u/.claude/projects/foo.jsonl'}),
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(1)
        expect(capture.writes).toHaveLength(1)
        expect(capture.writes[0]).toMatchObject({
            metadataPath,
            cli: 'claude',
            mode: 'interactive',
            sessionId: 'sess-claude-alice',
            source: 'claude-project-transcript',
            providerStorePath: '/Users/u/.claude/projects/foo.jsonl',
        })
    })

    it('captures Codex sessionId and persists with codex-state-index source and headless mode preserved', () => {
        const record = makeRecord(terminalData({
            terminalId: 'Bea' as TerminalId,
            agentName: 'Bea',
            initialCommand: 'codex',
            isHeadless: true,
        }))
        const metadataPath = '/vault/.voicetree/terminals/Bea.json'
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {[metadataPath]: metadataWithoutRecovery('Bea')},
            codex: () => ({kind: 'found', sessionId: 'thread-codex-bea'}),
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(1)
        expect(capture.writes[0]).toMatchObject({
            cli: 'codex',
            mode: 'headless',
            sessionId: 'thread-codex-bea',
            source: 'codex-state-index',
        })
        expect(capture.writes[0]?.providerStorePath).toBeUndefined()
    })

    it('skips terminals that already have recovery.native.sessionId (no resolver call, no persist)', () => {
        const record = makeRecord(terminalData({terminalId: 'Cy' as TerminalId, agentName: 'Cy'}))
        const metadataPath = '/vault/.voicetree/terminals/Cy.json'
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {[metadataPath]: metadataWithRecovery('Cy')},
            claude: () => {
                throw new Error('resolveClaude must not be called when sessionId already present')
            },
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.claudeCalls).toHaveLength(0)
        expect(capture.writes).toHaveLength(0)
    })

    it('skips non-Claude/Codex terminals (plain shells, gemini, custom CLIs)', () => {
        const records: TerminalRecord[] = [
            makeRecord(terminalData({terminalId: 'D' as TerminalId, agentName: 'D', initialCommand: 'bash'})),
            makeRecord(terminalData({terminalId: 'E' as TerminalId, agentName: 'E', initialCommand: 'gemini'})),
            makeRecord(terminalData({terminalId: 'F' as TerminalId, agentName: 'F', initialCommand: 'my-custom-cli'})),
        ]
        const {deps, capture} = buildDeps({
            records,
            metadataByPath: {
                '/vault/.voicetree/terminals/D.json': metadataWithoutRecovery('D'),
                '/vault/.voicetree/terminals/E.json': metadataWithoutRecovery('E'),
                '/vault/.voicetree/terminals/F.json': metadataWithoutRecovery('F'),
            },
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.claudeCalls).toHaveLength(0)
        expect(capture.codexCalls).toHaveLength(0)
        expect(capture.writes).toHaveLength(0)
    })

    it('skips terminals whose metadata file is missing (no resolver call)', () => {
        const record = makeRecord(terminalData({terminalId: 'Gone' as TerminalId, agentName: 'Gone'}))
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {}, // no metadata at all
            claude: () => {
                throw new Error('resolveClaude must not be called when metadata file missing')
            },
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.writes).toHaveLength(0)
    })

    it('does not persist when the resolver returns not-found (leaves metadata untouched for next tick to retry)', () => {
        const record = makeRecord(terminalData({terminalId: 'Hal' as TerminalId, agentName: 'Hal'}))
        const metadataPath = '/vault/.voicetree/terminals/Hal.json'
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {[metadataPath]: metadataWithoutRecovery('Hal')},
            claude: () => ({kind: 'not-found'}),
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.claudeCalls).toHaveLength(1) // tried, but no match
        expect(capture.writes).toHaveLength(0)
    })

    it('processes multiple terminals per call; mixed captured + skipped is reported as the captured count', () => {
        const records: TerminalRecord[] = [
            makeRecord(terminalData({terminalId: 'P' as TerminalId, agentName: 'P'})),
            makeRecord(terminalData({terminalId: 'Q' as TerminalId, agentName: 'Q', initialCommand: 'codex'})),
            makeRecord(terminalData({terminalId: 'R' as TerminalId, agentName: 'R'})),
        ]
        const {deps, capture} = buildDeps({
            records,
            metadataByPath: {
                '/vault/.voicetree/terminals/P.json': metadataWithoutRecovery('P'),
                '/vault/.voicetree/terminals/Q.json': metadataWithoutRecovery('Q'),
                '/vault/.voicetree/terminals/R.json': metadataWithRecovery('R'), // already captured
            },
            claude: (req) => req.terminalId === 'P' ? {kind: 'found', sessionId: 'sess-P'} : {kind: 'not-found'},
            codex: (req) => req.terminalId === 'Q' ? {kind: 'found', sessionId: 'thread-Q'} : {kind: 'not-found'},
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(2)
        const writtenIds: string[] = capture.writes.map((w) => w.sessionId)
        expect(writtenIds).toEqual(expect.arrayContaining(['sess-P', 'thread-Q']))
    })

    it('skips terminals whose initialCommand is undefined (e.g., plain shells that never set one)', () => {
        const record = makeRecord(terminalData({
            terminalId: 'Shell' as TerminalId,
            agentName: 'Shell',
            initialCommand: undefined,
        }))
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {'/vault/.voicetree/terminals/Shell.json': metadataWithoutRecovery('Shell')},
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.claudeCalls).toHaveLength(0)
        expect(capture.codexCalls).toHaveLength(0)
    })

    it('skips terminals without VOICETREE_VAULT_PATH in env (no metadata path to read)', () => {
        const record = makeRecord(terminalData({
            terminalId: 'Vagrant' as TerminalId,
            agentName: 'Vagrant',
            initialEnvVars: {}, // no VOICETREE_VAULT_PATH
        }))
        const {deps, capture} = buildDeps({
            records: [record],
            metadataByPath: {},
        })

        const captured: number = captureMissingNativeSessions(deps)

        expect(captured).toBe(0)
        expect(capture.claudeCalls).toHaveLength(0)
    })
})
