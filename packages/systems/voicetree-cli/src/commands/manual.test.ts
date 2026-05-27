import {describe, expect, it} from 'vitest'
import {resolveManualCommand} from './manual.ts'
import {CliError} from './output.ts'

const SAMPLE_MANUAL: string = [
    '# Manual',
    '',
    '## Reference',
    '',
    '### `vt agent spawn`',
    '',
    'Spawn an agent.',
    '',
    '**Parameters:**',
    '',
    '- `task`: a task',
    '',
    '### `vt agent send`',
    '',
    'Send a message.',
    '',
    '### `vt agent close`',
    '',
    'Close an agent.',
    '',
    '### `vt graph create`',
    '',
    'Create a node.',
    '',
].join('\n')

function captureNotFound(markdown: string, args: readonly string[]): string {
    try {
        resolveManualCommand(markdown, args)
    } catch (err: unknown) {
        if (err instanceof CliError) return err.message
        throw err
    }
    throw new Error('expected resolveManualCommand to throw CliError')
}

describe('resolveManualCommand', () => {
    it('returns the full markdown when invoked with no args', () => {
        const output: string = resolveManualCommand(SAMPLE_MANUAL, [])

        expect(output.startsWith('# Manual')).toBe(true)
        expect(output.endsWith('\n')).toBe(true)
    })

    it('returns the rendered section for an exact match', () => {
        const output: string = resolveManualCommand(SAMPLE_MANUAL, ['agent', 'spawn'])

        expect(output).toContain('### `vt agent spawn`')
        expect(output).toContain('Spawn an agent.')
        expect(output).toContain('- `task`: a task')
    })

    it('flags a parser bug when zero tools are produced from the markdown', () => {
        const emptyManual: string = '# Manual\n\nNo tool headers in here at all.\n'

        const message: string = captureNotFound(emptyManual, ['agent', 'spawn'])

        expect(message).toContain('parser produced no tools')
        expect(message).toContain('parseManual')
    })

    it('suggests close matches with "Did you mean:" when a typo is given', () => {
        const message: string = captureNotFound(SAMPLE_MANUAL, ['agent.spawn'])

        expect(message).toContain('no tool matches `agent.spawn`')
        expect(message).toContain('Did you mean:')
        const lines: readonly string[] = message.split('\n')
        const didYouMeanIndex: number = lines.indexOf('Did you mean:')
        const fullListIndex: number = lines.indexOf('Or pick from the full list:')
        expect(didYouMeanIndex).toBeGreaterThanOrEqual(0)
        expect(fullListIndex).toBeGreaterThan(didYouMeanIndex)
        const suggestions: readonly string[] = lines.slice(didYouMeanIndex + 1, fullListIndex)
        expect(suggestions[0].trim()).toBe('vt agent spawn')
    })

    it('still includes the full tool list under the suggestions', () => {
        const message: string = captureNotFound(SAMPLE_MANUAL, ['totally-fake-verb'])

        expect(message).toContain('Or pick from the full list:')
        expect(message).toContain('  vt agent spawn')
        expect(message).toContain('  vt agent send')
        expect(message).toContain('  vt agent close')
        expect(message).toContain('  vt graph create')
    })

    it('caps suggestions at 3 tools', () => {
        const message: string = captureNotFound(SAMPLE_MANUAL, ['xyz'])

        const lines: readonly string[] = message.split('\n')
        const didYouMeanIndex: number = lines.indexOf('Did you mean:')
        const fullListIndex: number = lines.indexOf('Or pick from the full list:')
        expect(fullListIndex - didYouMeanIndex - 1).toBeLessThanOrEqual(3)
    })
})
