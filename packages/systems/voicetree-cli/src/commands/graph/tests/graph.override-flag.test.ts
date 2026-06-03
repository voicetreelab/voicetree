import {describe, expect, it, vi} from 'vitest'
import {parseGraphCreateArgs} from '../core/args'
import {mergeOverrideSpecs, parseOverrideEntry} from '../core/overrideSpec'
import {rewriteOverrideHintForCli} from '../actions/batchEmit'
import type {OverrideSpec, ParsedLiveCreateArgs} from '../core/types'
import {CliError} from '@voicetree/cli/commands/output'
import {SUBGRAPH_SIZE_LIMIT_GUIDANCE} from '@vt/vt-daemon-protocol'

class ExitCalled extends Error {
    constructor(public readonly code: number) { super(`process.exit(${code})`) }
}

function captureParse(args: string[]): {parsed?: unknown; stderr: string; exitCode: number | null} {
    const msgs: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...v: unknown[]) => { msgs.push(v.join(' ')) })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
        throw new ExitCalled(c ?? 0)
    }) as typeof process.exit)
    try {
        return {parsed: parseGraphCreateArgs(args), stderr: msgs.join('\n'), exitCode: null}
    } catch (err) {
        if (err instanceof ExitCalled) return {exitCode: err.code, stderr: msgs.join('\n')}
        if (err instanceof CliError) {
            msgs.push(`error: ${err.message}`)
            return {exitCode: 1, stderr: msgs.join('\n')}
        }
        throw err
    } finally {
        errSpy.mockRestore()
        exitSpy.mockRestore()
    }
}

describe('parseGraphCreateArgs --override', () => {
    it('accepts graph validation rule overrides, accumulating multiple', () => {
        const result = captureParse([
            '--node', 'T::S',
            '--override', 'node_line_limit:large diff',
            '--override', 'grandparent_attachment:cross-team context',
            '--override', 'node_must_have_edge:intentional parking lot',
        ])
        expect(result.exitCode).toBeNull()
        expect((result.parsed as ParsedLiveCreateArgs).overrides).toEqual([
            {ruleId: 'node_line_limit', rationale: 'large diff'},
            {ruleId: 'grandparent_attachment', rationale: 'cross-team context'},
            {ruleId: 'node_must_have_edge', rationale: 'intentional parking lot'},
        ])
    })

    it('rejects an unknown ruleId', () => {
        const result = captureParse(['--node', 'T::S', '--override', 'unknown_rule:reason'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not overridable')
    })

    it('rejects malformed values (missing rationale)', () => {
        const result = captureParse(['--node', 'T::S', '--override', 'node_line_limit:'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--override')
    })

    it('accepts --override in filesystem mode for graph validation rules', () => {
        const result = captureParse(['some-file.md', '--override', 'node_line_limit:reason'])
        expect(result.exitCode).toBeNull()
        expect((result.parsed as {overrides: readonly OverrideSpec[]}).overrides).toEqual([
            {ruleId: 'node_line_limit', rationale: 'reason'},
        ])
    })
})

function captureParseEntry(raw: unknown, locator: string): {value?: OverrideSpec; stderr: string; exitCode: number | null} {
    const msgs: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...v: unknown[]) => { msgs.push(v.join(' ')) })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
        throw new ExitCalled(c ?? 0)
    }) as typeof process.exit)
    try {
        return {value: parseOverrideEntry(raw, locator), stderr: msgs.join('\n'), exitCode: null}
    } catch (err) {
        if (err instanceof ExitCalled) return {exitCode: err.code, stderr: msgs.join('\n')}
        if (err instanceof CliError) {
            msgs.push(`error: ${err.message}`)
            return {exitCode: 1, stderr: msgs.join('\n')}
        }
        throw err
    } finally {
        errSpy.mockRestore()
        exitSpy.mockRestore()
    }
}

describe('parseOverrideEntry (stdin shape)', () => {
    it('accepts a well-formed object', () => {
        const result = captureParseEntry({ruleId: 'node_line_limit', rationale: 'huge code block'}, 'stdin[0]')
        expect(result.exitCode).toBeNull()
        expect(result.value).toEqual({ruleId: 'node_line_limit', rationale: 'huge code block'})
    })

    it('rejects non-string ruleId', () => {
        const result = captureParseEntry({ruleId: 1, rationale: 'r'}, 'stdin[0]')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('ruleId must be a non-empty string')
    })

    it('rejects unknown ruleId', () => {
        const result = captureParseEntry({ruleId: 'unknown_rule', rationale: 'r'}, 'stdin[0]')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not overridable')
    })

    it('rejects null rationale', () => {
        const result = captureParseEntry({ruleId: 'node_line_limit', rationale: null}, 'stdin[0]')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('rationale must be a non-empty string')
    })
})

describe('mergeOverrideSpecs (last-wins by ruleId)', () => {
    it('CLI args override stdin entries with the same ruleId', () => {
        const stdin: readonly OverrideSpec[] = [{ruleId: 'node_line_limit', rationale: 'from stdin'}]
        const cli: readonly OverrideSpec[] = [{ruleId: 'node_line_limit', rationale: 'from CLI'}]
        expect(mergeOverrideSpecs(stdin, cli)).toEqual([{ruleId: 'node_line_limit', rationale: 'from CLI'}])
    })

    it('keeps distinct ruleIds from both sides', () => {
        const stdin: readonly OverrideSpec[] = [{ruleId: 'node_line_limit', rationale: 'stdin'}]
        const cli: readonly OverrideSpec[] = [{ruleId: 'grandparent_attachment', rationale: 'cli'}]
        expect(mergeOverrideSpecs(stdin, cli)).toEqual([
            {ruleId: 'node_line_limit', rationale: 'stdin'},
            {ruleId: 'grandparent_attachment', rationale: 'cli'},
        ])
    })

    it('dedups duplicates within a single source (later wins)', () => {
        const cli: readonly OverrideSpec[] = [
            {ruleId: 'node_line_limit', rationale: 'first'},
            {ruleId: 'node_line_limit', rationale: 'second'},
        ]
        expect(mergeOverrideSpecs([], cli)).toEqual([{ruleId: 'node_line_limit', rationale: 'second'}])
    })
})

describe('rewriteOverrideHintForCli', () => {
    it('rewrites the daemon override hint into a --override flag suggestion', () => {
        const toolErrorMessage: string = [
            'Validation failed. The following rules were violated:',
            '',
            '  • [node_line_limit] Node is too long (node: "x.md")',
            '  • [grandparent_attachment] Target parent is an ancestor (node: "__graph_root__")',
            '  • [node_must_have_edge] Node has no parent edge (node: "lonely.md")',
            '',
            'To override, add "override_with_rationale" to your create_graph call:',
            '[{"ruleId":"node_line_limit","rationale":"<explain>"}]',
        ].join('\n')
        const rewritten: string = rewriteOverrideHintForCli(toolErrorMessage)
        expect(rewritten).toContain('To override non-gardening rule(s), re-run with:')
        expect(rewritten).toContain("--override 'node_line_limit:<rationale>'")
        expect(rewritten).toContain("--override 'grandparent_attachment:<rationale>'")
        expect(rewritten).toContain("--override 'node_must_have_edge:<rationale>'")
        expect(rewritten).not.toContain('override_with_rationale')
    })

    it('does not suggest --override for subgraph_size_limit-only failures', () => {
        const toolErrorMessage: string = [
            'Validation failed. The following rules were violated:',
            '',
            `  • [${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}] Folder "work" is too large (node: "__graph_root__")`,
            '',
            'To override, add "override_with_rationale" to your create_graph call:',
            `[{"ruleId":"${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}","rationale":"<explain>"}]`,
        ].join('\n')
        const rewritten: string = rewriteOverrideHintForCli(toolErrorMessage)
        expect(rewritten).toContain(SUBGRAPH_SIZE_LIMIT_GUIDANCE.gardeningInstruction)
        expect(rewritten).not.toContain(`--override '${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}:`)
        expect(rewritten).not.toContain('override_with_rationale')
    })

    it('filters subgraph_size_limit out of mixed override suggestions', () => {
        const toolErrorMessage: string = [
            'Validation failed. The following rules were violated:',
            '',
            `  • [${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}] Folder "work" is too large (node: "__graph_root__")`,
            '  • [node_line_limit] Node is too long (node: "x.md")',
            '',
            'To override, add "override_with_rationale" to your create_graph call:',
            `[{"ruleId":"${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}","rationale":"<explain>"}]`,
        ].join('\n')
        const rewritten: string = rewriteOverrideHintForCli(toolErrorMessage)
        expect(rewritten).toContain('To override non-gardening rule(s), re-run with:')
        expect(rewritten).toContain("--override 'node_line_limit:<rationale>'")
        expect(rewritten).not.toContain(`--override '${SUBGRAPH_SIZE_LIMIT_GUIDANCE.ruleId}:`)
        expect(rewritten).not.toContain('override_with_rationale')
    })

    it('passes the input through unchanged when the marker is absent', () => {
        const noMarker: string = 'Validation failed: unrelated error'
        expect(rewriteOverrideHintForCli(noMarker)).toBe(noMarker)
    })
})
