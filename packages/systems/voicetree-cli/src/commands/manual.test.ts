import {describe, expect, it} from 'vitest'
import type {ToolSpec} from '@vt/vt-daemon-protocol'
import {resolveManualCommand} from './manual.ts'
import {CliError} from './output.ts'

const SAMPLE_SPECS: readonly ToolSpec[] = [
    {
        rpcName: 'spawn_thing',
        cliVerb: 'vt agent spawn',
        tier: 'essentials',
        summary: 'Spawn an agent.',
        description: 'Spawn an agent.',
        inputs: [
            {
                rpcName: 'task',
                cliBulletLabel: '--task VALUE',
                annotation: 'RPC: task',
                description: 'A task.',
            },
        ],
    },
    {
        rpcName: 'send_thing',
        cliVerb: 'vt agent send',
        tier: 'reference',
        summary: 'Send a message.',
        description: 'Send a message.',
        inputs: [],
    },
    {
        rpcName: 'close_thing',
        cliVerb: 'vt agent close',
        tier: 'reference',
        summary: 'Close an agent.',
        description: 'Close an agent.',
        inputs: [],
    },
    {
        rpcName: 'create_graph_thing',
        cliVerb: 'vt graph create',
        tier: 'essentials',
        summary: 'Create a node.',
        description: 'Create a node.',
        inputs: [],
    },
]

function captureNotFound(specs: readonly ToolSpec[], args: readonly string[]): string {
    try {
        resolveManualCommand(specs, args)
    } catch (err: unknown) {
        if (err instanceof CliError) return err.message
        throw err
    }
    throw new Error('expected resolveManualCommand to throw CliError')
}

describe('resolveManualCommand', () => {
    it('returns the full rendered manual when invoked with no args', () => {
        const output: string = resolveManualCommand(SAMPLE_SPECS, [])

        expect(output.startsWith('# vt CLI Manual')).toBe(true)
        expect(output.endsWith('\n')).toBe(true)
        expect(output).toContain('vt agent spawn')
        expect(output).toContain('vt graph create')
    })

    it('returns the rendered section for an exact match', () => {
        const output: string = resolveManualCommand(SAMPLE_SPECS, ['agent', 'spawn'])

        expect(output).toContain('### `vt agent spawn`')
        expect(output).toContain('Spawn an agent.')
        expect(output).toContain('- `--task VALUE` (RPC: task): A task.')
    })

    it('suggests close matches with "Did you mean:" when a typo is given', () => {
        // `findSpecByCliVerb` normalizes `.` `_` `-` to spaces, so a "real"
        // typo means a misspelled token — not a separator variation.
        const message: string = captureNotFound(SAMPLE_SPECS, ['agent', 'spwn'])

        expect(message).toContain('no tool matches `agent spwn`')
        expect(message).toContain('Did you mean:')
        const lines: readonly string[] = message.split('\n')
        const didYouMeanIndex: number = lines.indexOf('Did you mean:')
        const fullListIndex: number = lines.indexOf('Or pick from the full list:')
        expect(didYouMeanIndex).toBeGreaterThanOrEqual(0)
        expect(fullListIndex).toBeGreaterThan(didYouMeanIndex)
        const suggestions: readonly string[] = lines.slice(didYouMeanIndex + 1, fullListIndex)
        expect(suggestions[0].trim()).toBe('vt agent spawn')
    })

    it('treats `.` `_` `-` as separator variants of the canonical verb', () => {
        // Helpful for callers who type `vt manual agent.spawn` rather than
        // `vt manual agent spawn` — both should resolve to the same spec.
        const output: string = resolveManualCommand(SAMPLE_SPECS, ['agent.spawn'])
        expect(output).toContain('### `vt agent spawn`')
    })

    it('still includes the full tool list under the suggestions', () => {
        const message: string = captureNotFound(SAMPLE_SPECS, ['totally-fake-verb'])

        expect(message).toContain('Or pick from the full list:')
        expect(message).toContain('  vt agent spawn')
        expect(message).toContain('  vt agent send')
        expect(message).toContain('  vt agent close')
        expect(message).toContain('  vt graph create')
    })

    it('caps suggestions at 3 tools', () => {
        const message: string = captureNotFound(SAMPLE_SPECS, ['xyz'])

        const lines: readonly string[] = message.split('\n')
        const didYouMeanIndex: number = lines.indexOf('Did you mean:')
        const fullListIndex: number = lines.indexOf('Or pick from the full list:')
        expect(fullListIndex - didYouMeanIndex - 1).toBeLessThanOrEqual(3)
    })

    it('flags an upstream bug when zero specs are loaded', () => {
        const message: string = captureNotFound([], ['agent', 'spawn'])

        expect(message).toContain('no tool specs loaded')
    })
})
