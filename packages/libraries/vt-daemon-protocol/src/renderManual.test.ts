/**
 * Black-box tests for the manual renderer. Exercise the rendering with
 * small synthetic spec sets so the assertions stay focused on shape
 * rather than coupling to the canonical TOOL_SPECS payload. A separate
 * "full TOOL_SPECS render" test catches integration regressions across
 * the real data set.
 */

import {describe, expect, it} from 'vitest'
import {findSpecByCliVerb, renderManual, renderManualSection} from './renderManual'
import {TOOL_SPECS} from './tool-specs'
import type {ToolSpec} from './tool-spec-types'

const ESSENTIAL_FIXTURE: ToolSpec = {
    rpcName: 'spawn_thing',
    cliVerb: 'vt agent fake-spawn',
    tier: 'essentials',
    summary: 'Spawn a fake thing.',
    description: 'Spawn a fake thing in the graph.\n\n**When to use:** never.',
    inputs: [
        {
            rpcName: 'callerTerminalId',
            cliBulletLabel: '--terminal / -t',
            annotation: 'RPC: callerTerminalId',
            description: 'Your terminal id.',
        },
        {
            rpcName: 'task',
            cliBulletLabel: '--task VALUE',
            annotation: 'RPC: task',
            description: 'What to do.',
        },
    ],
}

const REFERENCE_FIXTURE: ToolSpec = {
    rpcName: 'close_thing',
    cliVerb: 'vt agent fake-close',
    tier: 'reference',
    summary: 'Close a thing.',
    description: 'Close a thing.',
    inputs: [],
}

describe('renderManualSection', () => {
    it('emits a level-3 header for the cliVerb', () => {
        const output: string = renderManualSection(ESSENTIAL_FIXTURE)
        expect(output).toContain('### `vt agent fake-spawn`')
    })

    it('emits the description verbatim under the header', () => {
        const output: string = renderManualSection(ESSENTIAL_FIXTURE)
        expect(output).toContain('Spawn a fake thing in the graph.')
        expect(output).toContain('**When to use:** never.')
    })

    it('renders the **Parameters:** section when inputs are present', () => {
        const output: string = renderManualSection(ESSENTIAL_FIXTURE)
        expect(output).toContain('**Parameters:**')
        expect(output).toContain('- `--terminal / -t` (RPC: callerTerminalId): Your terminal id.')
        expect(output).toContain('- `--task VALUE` (RPC: task): What to do.')
    })

    it('omits the **Parameters:** block when the spec has no inputs', () => {
        const output: string = renderManualSection(REFERENCE_FIXTURE)
        expect(output).not.toContain('**Parameters:**')
    })

    it('omits the annotation parens when annotation is empty', () => {
        const noAnnotationSpec: ToolSpec = {
            ...REFERENCE_FIXTURE,
            inputs: [{
                rpcName: 'foo',
                cliBulletLabel: '--foo VALUE',
                annotation: '',
                description: 'No annotation.',
            }],
        }
        const output: string = renderManualSection(noAnnotationSpec)
        expect(output).toContain('- `--foo VALUE`: No annotation.')
        expect(output).not.toContain('- `--foo VALUE` (): No annotation.')
    })
})

describe('renderManual', () => {
    const FIXTURES: readonly ToolSpec[] = [ESSENTIAL_FIXTURE, REFERENCE_FIXTURE]

    it('emits the preamble + both tier headers in full mode', () => {
        const output: string = renderManual(FIXTURES)
        expect(output).toContain('# vt CLI Manual')
        expect(output).toContain('## Essentials')
        expect(output).toContain('## Reference')
    })

    it('groups specs under their tier header', () => {
        const output: string = renderManual(FIXTURES)
        const essentialsAt: number = output.indexOf('## Essentials')
        const referenceAt: number = output.indexOf('## Reference')
        const fakeSpawnAt: number = output.indexOf('vt agent fake-spawn')
        const fakeCloseAt: number = output.indexOf('vt agent fake-close')
        expect(essentialsAt).toBeLessThan(fakeSpawnAt)
        expect(fakeSpawnAt).toBeLessThan(referenceAt)
        expect(referenceAt).toBeLessThan(fakeCloseAt)
    })

    it('emits only the essentials slice when tier is "essentials"', () => {
        const output: string = renderManual(FIXTURES, {tier: 'essentials'})
        expect(output).toContain('vt agent fake-spawn')
        expect(output).not.toContain('vt agent fake-close')
        expect(output).not.toContain('## Essentials')
        expect(output).not.toContain('## Reference')
    })

    it('emits preamble + Essentials but no Reference dump when tier is "overview"', () => {
        const output: string = renderManual(FIXTURES, {tier: 'overview'})
        // Preamble + Essentials header (with the vt manual <verb> pointer) + the essentials verb...
        expect(output).toContain('# vt CLI Manual')
        expect(output).toContain('## Essentials')
        expect(output).toContain('vt manual <verb>')
        expect(output).toContain('vt agent fake-spawn')
        // ...but NOT the Reference section or any reference-tier verb.
        expect(output).not.toContain('## Reference')
        expect(output).not.toContain('vt agent fake-close')
    })

    it('renders the real TOOL_SPECS without throwing and includes every cliVerb', () => {
        const output: string = renderManual(TOOL_SPECS)
        for (const spec of TOOL_SPECS) {
            expect(output, `expected header for ${spec.cliVerb}`).toContain(`### \`${spec.cliVerb}\``)
        }
    })
})

describe('findSpecByCliVerb', () => {
    it('matches the canonical verb form', () => {
        const match: ToolSpec | undefined = findSpecByCliVerb(TOOL_SPECS, 'vt agent send')
        expect(match?.rpcName).toBe('send_message')
    })

    it('matches without the leading "vt "', () => {
        const match: ToolSpec | undefined = findSpecByCliVerb(TOOL_SPECS, 'agent send')
        expect(match?.rpcName).toBe('send_message')
    })

    it('matches with dot/underscore/dash separators (fuzzy normalization)', () => {
        const match: ToolSpec | undefined = findSpecByCliVerb(TOOL_SPECS, 'agent.send')
        expect(match?.rpcName).toBe('send_message')
    })

    it('returns undefined for an unknown verb', () => {
        expect(findSpecByCliVerb(TOOL_SPECS, 'agent fake-spawn')).toBeUndefined()
    })
})
