import type {ClassifierInput, MetadataRecord} from './classifier'
import type {TerminalData} from '@vt/agent-runtime/terminals/terminal-registry/types'
import {buildTmuxNamespaceHash} from '@vt/agent-runtime/terminals/tmux/tmux-session-manager'
import type {UnclaimedTmuxSession} from '@vt/agent-runtime/terminals/tmux/unclaimed-tmux'
import type {ResumeCapability} from '../types'
import * as O from 'fp-ts/lib/Option.js'

// VAULT_PATH is used consistently so that computed session names (via
// buildTmuxSessionName) match SESSION_A in tests that omit the session field.
export const VAULT_PATH = '/vault'
export const VAULT_HASH = buildTmuxNamespaceHash(VAULT_PATH)
export const FOREIGN_HASH = 'f6e7d8c9b0'
export const TERMINAL_A = 'A'
export const SESSION_A = `vt-${VAULT_HASH}-${TERMINAL_A}`
export const METADATA_PATH_A = '/vault/.voicetree/terminals/A.json'

export function makeTerminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: TERMINAL_A as TerminalData['terminalId'],
        attachedToContextNodeId: '/vault/node.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Agent A',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Ari',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: TERMINAL_A,
            VOICETREE_VAULT_PATH: VAULT_PATH,
        },
        ...overrides,
    }
}

export function makeRunningClaudeMetadata(overrides: Record<string, unknown> = {}): unknown {
    return {
        name: TERMINAL_A,
        status: 'running',
        session: SESSION_A,
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        ...overrides,
    }
}

export function makeExitedClaudeMetadata(overrides: Record<string, unknown> = {}): unknown {
    return {
        name: TERMINAL_A,
        status: 'exited',
        session: SESSION_A,
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        ...overrides,
    }
}

export function makeKilledClaudeMetadata(overrides: Record<string, unknown> = {}): unknown {
    return {
        name: TERMINAL_A,
        status: 'killed',
        session: SESSION_A,
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        ...overrides,
    }
}

export function makeRunningCodexMetadata(overrides: Record<string, unknown> = {}): unknown {
    return {
        name: 'B',
        status: 'running',
        session: `vt-${VAULT_HASH}-B`,
        terminalData: makeTerminalData({
            terminalId: 'B' as TerminalData['terminalId'],
            initialCommand: 'codex',
            agentName: 'Bea',
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: 'B',
                VOICETREE_VAULT_PATH: VAULT_PATH,
            },
        }),
        ...overrides,
    }
}

export function makeLiveSession(sessionName: string, overrides: Partial<UnclaimedTmuxSession> = {}): UnclaimedTmuxSession {
    return {
        sessionName,
        terminalId: TERMINAL_A,
        hash: VAULT_HASH,
        agentName: 'Ari',
        panePid: 12345,
        createdAt: 0,
        classification: 'this-vault',
        attachable: true,
        projectRoot: VAULT_PATH,
        contextNodePath: '/vault/node.md',
        ...overrides,
    }
}

export function baseInput(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
    return {
        metadataRecords: [],
        liveTmuxSessionsByName: new Map<string, UnclaimedTmuxSession>(),
        registryTerminalIds: new Set(),
        currentNamespaceHash: VAULT_HASH,
        resumeHandleByTerminalId: new Map<string, ResumeCapability>(),
        ...overrides,
    }
}

export function record(data: unknown, path = METADATA_PATH_A): MetadataRecord {
    return {path, data}
}
