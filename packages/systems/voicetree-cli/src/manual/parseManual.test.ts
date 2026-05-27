import {describe, expect, it} from 'vitest'
import {parseManual, type ManualTool} from './parseManual.ts'

describe('parseManual', () => {
    it('extracts a tool with description and parameters', () => {
        const markdown: string = [
            '### `vt foo`',
            '',
            'Does foo things.',
            '',
            '**Parameters:**',
            '',
            '- `bar`: a single-line param',
            '- `baz`: first line',
            '  continuation line joined back with newline',
            '',
        ].join('\n')

        const tools: readonly ManualTool[] = parseManual(markdown)

        expect(tools).toHaveLength(1)
        expect(tools[0].cliVerb).toBe('vt foo')
        expect(tools[0].description).toBe('Does foo things.')
        expect(tools[0].params).toEqual([
            {name: 'bar', annotation: '', description: 'a single-line param'},
            {name: 'baz', annotation: '', description: 'first line\ncontinuation line joined back with newline'},
        ])
    })

    it('extracts annotated bullets such as `name` (RPC: …): description', () => {
        const markdown: string = [
            '### `vt foo`',
            '',
            'Does foo things.',
            '',
            '**Parameters:**',
            '',
            '- `--name VALUE` (RPC: agentName): the agent name',
            '- `<terminalId>...` (positional, RPC: terminalIds): one or more ids',
            '- `--bare`: still parses with no annotation',
            '',
        ].join('\n')

        const tools: readonly ManualTool[] = parseManual(markdown)

        expect(tools[0].params).toEqual([
            {name: '--name VALUE', annotation: 'RPC: agentName', description: 'the agent name'},
            {name: '<terminalId>...', annotation: 'positional, RPC: terminalIds', description: 'one or more ids'},
            {name: '--bare', annotation: '', description: 'still parses with no annotation'},
        ])
    })

    it('skips single-line HTML comments wrapping a section without crashing', () => {
        const markdown: string = [
            '<!-- BEGIN_REGION -->',
            '## Essentials',
            '',
            '### `vt foo`',
            '',
            'Does foo things.',
            '',
            '**Parameters:**',
            '',
            '- `bar`: a param',
            '<!-- END_REGION -->',
            '',
            '## Reference',
            '',
            '### `vt qux`',
            '',
            'Does qux things.',
            '',
        ].join('\n')

        const tools: readonly ManualTool[] = parseManual(markdown)

        expect(tools.map((tool: ManualTool): string => tool.cliVerb)).toEqual(['vt foo', 'vt qux'])
        const foo: ManualTool = tools[0]
        expect(foo.description).toBe('Does foo things.')
        expect(foo.params).toEqual([{name: 'bar', annotation: '', description: 'a param'}])
    })

    it('skips multi-line HTML comment blocks', () => {
        const markdown: string = [
            '### `vt foo`',
            '',
            'Foo description.',
            '<!--',
            'this is a multi-line comment',
            'spanning several lines',
            '-->',
            '',
            '**Parameters:**',
            '',
            '- `bar`: a param',
            '',
        ].join('\n')

        const tools: readonly ManualTool[] = parseManual(markdown)

        expect(tools).toHaveLength(1)
        expect(tools[0].description).toBe('Foo description.')
        expect(tools[0].params).toEqual([{name: 'bar', annotation: '', description: 'a param'}])
    })

    it('skips HTML comments that interrupt the parameter bullet list', () => {
        const markdown: string = [
            '### `vt foo`',
            '',
            '**Parameters:**',
            '',
            '- `a`: alpha',
            '<!-- divider comment -->',
            '- `b`: beta',
            '',
        ].join('\n')

        const tools: readonly ManualTool[] = parseManual(markdown)

        expect(tools).toHaveLength(1)
        expect(tools[0].params).toEqual([
            {name: 'a', annotation: '', description: 'alpha'},
            {name: 'b', annotation: '', description: 'beta'},
        ])
    })
})
