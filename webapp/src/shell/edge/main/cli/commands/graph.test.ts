import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const mocks = vi.hoisted(() => ({
    callMcpToolMock: vi.fn(),
    outputMock: vi.fn(),
    errorMock: vi.fn((message: string): never => {
        throw new Error(message)
    }),
    jsonMode: false,
    stdinPayload: undefined as string | undefined,
}))

vi.mock('../mcp-client.ts', () => ({
    callMcpTool: mocks.callMcpToolMock,
}))

vi.mock('../output.ts', () => ({
    error: mocks.errorMock,
    output: mocks.outputMock,
    isJsonMode: () => mocks.jsonMode,
}))

vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs')

    return {
        ...actual,
        readFileSync(path: Parameters<typeof actual.readFileSync>[0], options?: Parameters<typeof actual.readFileSync>[1]) {
            if (path === 0 && mocks.stdinPayload !== undefined) {
                return mocks.stdinPayload
            }

            return actual.readFileSync(path, options)
        },
    }
})

import {graphCreate, setGraphFilesystemOpsForTest} from './graph.ts'

function setStdinIsTTY(value: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', {
        value,
        configurable: true,
    })
}

describe('graphCreate mode selection', () => {
    const originalCwd: string = process.cwd()
    const stdinDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const tempDirs: string[] = []

    beforeEach(() => {
        mocks.jsonMode = false
        mocks.stdinPayload = undefined
        setStdinIsTTY(true)
        setGraphFilesystemOpsForTest()
        mocks.callMcpToolMock.mockReset()
        mocks.outputMock.mockReset()
        mocks.errorMock.mockClear()
    })

    afterEach(() => {
        process.chdir(originalCwd)

        if (stdinDescriptor) {
            Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
        } else {
            setStdinIsTTY(true)
        }

        setGraphFilesystemOpsForTest()

        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    it('selects filesystem-native mode before terminal enforcement for markdown file inputs', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        writeFileSync('existing-node.md', '# Existing Node\n\nParent summary\n', 'utf8')
        writeFileSync('test-node.md', '# Test Node\n\nChild summary\n', 'utf8')

        await expect(
            graphCreate(3002, undefined, ['./test-node.md', '--parent', 'existing-node.md'])
        ).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).not.toHaveBeenCalled()
        expect(mocks.errorMock).not.toHaveBeenCalledWith('This command requires --terminal or VOICETREE_TERMINAL_ID')
    })

    it('routes non-TTY markdown inputs to filesystem mode instead of the stdin JSON path', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)
        setStdinIsTTY(false)
        mocks.stdinPayload = ''

        writeFileSync('test-node.md', '# Test Node\n\nChild summary\n', 'utf8')

        await expect(graphCreate(3002, undefined, ['./test-node.md'])).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).not.toHaveBeenCalled()
        expect(mocks.outputMock).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                mode: 'filesystem',
            }),
            expect.any(Function)
        )
    })

    it('keeps stdin JSON create_graph requests on the MCP-backed live path', async () => {
        setStdinIsTTY(false)
        mocks.stdinPayload = JSON.stringify({
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
        mocks.callMcpToolMock.mockResolvedValue({
            success: true,
            nodes: [],
        })

        await expect(graphCreate(3002, undefined, [])).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).toHaveBeenCalledWith(3002, 'create_graph', {
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
    })

    it('keeps inline --node creation on the explicit live MCP-backed path', async () => {
        mocks.callMcpToolMock.mockResolvedValue({
            success: true,
            nodes: [],
        })

        await expect(
            graphCreate(3002, 'term-123', ['--node', 'Progress::Short update'])
        ).resolves.toBeUndefined()

        expect(mocks.callMcpToolMock).toHaveBeenCalledWith(3002, 'create_graph', {
            callerTerminalId: 'term-123',
            nodes: [
                {
                    filename: 'progress',
                    title: 'Progress',
                    summary: 'Short update',
                },
            ],
        })
    })

    it('rolls back earlier filesystem mutations when a later staged write fails', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        writeFileSync('first-node.md', '# First Node\n\nFirst summary\n', 'utf8')
        writeFileSync('second-node.md', '# Second Node\n\nSecond summary\n', 'utf8')

        const originalFirst: string = readFileSync('first-node.md', 'utf8')
        const originalSecond: string = readFileSync('second-node.md', 'utf8')
        let stagedRenameCount = 0

        setGraphFilesystemOpsForTest({
            renameSync(oldPath: Parameters<typeof renameSync>[0], newPath: Parameters<typeof renameSync>[1]): void {
                const oldPathString: string = String(oldPath)
                if (oldPathString.includes('.vt-graph-create-stage-')) {
                    stagedRenameCount += 1
                }

                if (oldPathString.includes('.vt-graph-create-stage-') && stagedRenameCount === 2) {
                    throw new Error('simulated rename failure')
                }

                renameSync(oldPath, newPath)
            },
        })
        await expect(
            graphCreate(3002, undefined, ['./first-node.md', './second-node.md'])
        ).rejects.toThrow('Failed to apply filesystem authoring plan: simulated rename failure')
        expect(readFileSync('first-node.md', 'utf8')).toBe(originalFirst)
        expect(readFileSync('second-node.md', 'utf8')).toBe(originalSecond)
        expect(readdirSync(tempDir).sort()).toEqual(['first-node.md', 'second-node.md'])
    })

    it('includes applied filesystem fixes in the success output payload and human formatter', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        writeFileSync('rough-capture.md', '# Rough Capture\n\nCaptured summary\n', 'utf8')

        await expect(graphCreate(3002, undefined, ['./rough-capture.md'])).resolves.toBeUndefined()

        const [result, formatter] = mocks.outputMock.mock.calls.at(-1) as [
            {
                success: true
                mode: 'filesystem'
                nodes: Array<{
                    path: string
                    fixes?: Array<{code: string; message: string}>
                }>
            },
            (data: unknown) => string,
        ]

        expect(result).toMatchObject({
            success: true,
            mode: 'filesystem',
            nodes: [
                {
                    path: 'rough-capture.md',
                    fixes: [
                        {
                            code: 'added_frontmatter',
                        },
                    ],
                },
            ],
        })
        expect(formatter(result)).toContain('fixed:')
        expect(formatter(result)).toContain('Added frontmatter')
    })

    it('validates filesystem inputs without writing files when --validate-only is set', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        const originalMarkdown = '# Test Node\n\nChild summary\n'
        writeFileSync('test-node.md', originalMarkdown, 'utf8')

        await expect(graphCreate(3002, undefined, ['./test-node.md', '--validate-only'])).resolves.toBeUndefined()

        const [result, formatter] = mocks.outputMock.mock.calls.at(-1) as [
            {
                success: true
                mode: 'filesystem'
                validateOnly: true
                nodes: Array<{path: string; status: 'ok'}>
            },
            (data: unknown) => string,
        ]

        expect(result).toMatchObject({
            success: true,
            mode: 'filesystem',
            validateOnly: true,
            nodes: [
                {
                    path: 'test-node.md',
                    status: 'ok',
                },
            ],
        })
        expect(readFileSync('test-node.md', 'utf8')).toBe(originalMarkdown)
        expect(readdirSync(tempDir)).toEqual(['test-node.md'])
        expect(formatter(result)).toContain('Validated 1 node in filesystem mode (no files written):')
    })

    it('preserves actionable filesystem validation errors during --validate-only runs', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        const oversizedMarkdown: string = [
            '# Oversized Brief',
            '',
            ...Array.from({length: 36}, (_, index) => `Intro line ${index + 1}`),
            '## Evidence',
            ...Array.from({length: 22}, (_, index) => `Evidence line ${index + 1}`),
            '## Implications',
            ...Array.from({length: 22}, (_, index) => `Implication line ${index + 1}`),
        ].join('\n')
        writeFileSync('oversized-brief.md', oversizedMarkdown, 'utf8')

        await expect(
            graphCreate(3002, undefined, ['./oversized-brief.md', '--validate-only'])
        ).rejects.toThrow(/Split at ## headings: "Evidence" \(\d+ lines\), "Implications" \(\d+ lines\)\./)

        expect(readFileSync('oversized-brief.md', 'utf8')).toBe(oversizedMarkdown)
        expect(readdirSync(tempDir)).toEqual(['oversized-brief.md'])
    })

    it('rejects --validate-only on explicit live graph-create paths', async () => {
        await expect(
            graphCreate(3002, 'term-123', ['--node', 'Progress::Short update', '--validate-only'])
        ).rejects.toThrow('The --validate-only flag is only supported for filesystem markdown inputs')

        expect(mocks.callMcpToolMock).not.toHaveBeenCalled()
    })

    it('preserves actionable split suggestions in filesystem rejection output', async () => {
        const tempDir: string = mkdtempSync(join(tmpdir(), 'vt-graph-create-'))
        tempDirs.push(tempDir)
        process.chdir(tempDir)

        const oversizedMarkdown: string = [
            '# Oversized Brief',
            '',
            ...Array.from({length: 36}, (_, index) => `Intro line ${index + 1}`),
            '## Evidence',
            ...Array.from({length: 22}, (_, index) => `Evidence line ${index + 1}`),
            '## Implications',
            ...Array.from({length: 22}, (_, index) => `Implication line ${index + 1}`),
        ].join('\n')
        writeFileSync('oversized-brief.md', oversizedMarkdown, 'utf8')

        await expect(graphCreate(3002, undefined, ['./oversized-brief.md'])).rejects.toThrow(
            /Split at ## headings: "Evidence" \(\d+ lines\), "Implications" \(\d+ lines\)\./
        )
    })
})
