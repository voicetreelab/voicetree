import {describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {TerminalData, TerminalId} from '@vt/vt-daemon-protocol'
import {uiLaunchEventForRecoveryResult} from './recoveryRoutes.ts'

// Black-box test for the pure result→event mapping that closes the
// resume/fork "invisible in browser-mode" gap: the normal spawn path emits
// `terminal-ui-launch`, the recovery functions did not. The route fires this
// event; here we pin the mapping (in/out, no side effects).

const ctxNode = '/proj/voicetree-x/ctx-nodes/node_abc_context.md' as NodeIdAndFilePath
const terminalData = {terminalId: 'Kai' as TerminalId, attachedToContextNodeId: ctxNode} as TerminalData

describe('uiLaunchEventForRecoveryResult', () => {
    it('maps a spawned resume result to a terminal-ui-launch event anchored at the context node', () => {
        const event = uiLaunchEventForRecoveryResult({kind: 'spawned', pid: 4242, command: 'claude --resume x', terminalData})
        expect(event).toEqual({
            type: 'terminal-ui-launch',
            nodeId: ctxNode,
            terminalData,
            skipFitAnimation: true,
        })
    })

    it('maps a spawned fork result the same way (forkedTerminalId does not affect the launch)', () => {
        const event = uiLaunchEventForRecoveryResult({
            kind: 'spawned',
            forkedTerminalId: 'Kai-fork' as TerminalId,
            pid: 7,
            command: 'claude --resume y',
            terminalData,
        })
        expect(event?.type).toBe('terminal-ui-launch')
        expect(event?.nodeId).toBe(ctxNode)
        expect(event?.terminalData).toBe(terminalData)
    })

    it('returns null for a stale (not-in-discovery) result — nothing to launch', () => {
        expect(uiLaunchEventForRecoveryResult({kind: 'stale', reason: 'not-in-discovery'})).toBeNull()
    })

    it('returns null for a spawn-failed result', () => {
        expect(uiLaunchEventForRecoveryResult({kind: 'spawn-failed', error: 'boom'})).toBeNull()
    })

    it('returns null for a no-native-session result', () => {
        expect(
            uiLaunchEventForRecoveryResult({kind: 'no-native-session', cliType: 'claude', reason: 'not-found'}),
        ).toBeNull()
    })
})
