/**
 * Parity lint — `tools/prompts/cli-manual.md` vs the MCP server's zod
 * descriptions registered by `registerAllTools` (in
 * `packages/systems/voicetree-mcp/src/tools/agent-control/mcp-server.ts`).
 *
 * The test installs a stub MCP server that captures every `registerTool` call,
 * runs `registerAllTools(stub)`, then introspects each tool's input-schema
 * zod types via `extractZodDescriptions`. The result is compared byte-for-byte
 * with the on-disk manual parsed by `parseManual`. Any drift fails the test
 * with a specific tool/parameter and the mismatched strings.
 *
 * Step 7 removes the MCP wire — this test is the gate that prevents the
 * manual from drifting before that demolition.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {registerAllTools} from '@vt/voicetree-mcp/tools/mcp-server'
import {extractZodDescriptions, type ZodInputSchema} from './extractZodDescriptions.ts'
import {parseManual, type ManualTool} from './parseManual.ts'

type CapturedTool = {
    readonly name: string
    readonly description: string
    readonly params: Map<string, string>
}

function captureRegisteredTools(): readonly CapturedTool[] {
    const captured: CapturedTool[] = []
    const stub: Pick<McpServer, 'registerTool'> = {
        registerTool: ((name: string, definition: {description: string; inputSchema?: ZodInputSchema}): unknown => {
            captured.push({
                name,
                description: definition.description,
                params: extractZodDescriptions(definition.inputSchema ?? {}),
            })
            return {} as unknown
        }) as McpServer['registerTool'],
    }
    registerAllTools(stub as McpServer)
    return captured
}

const MANUAL_PATH: string = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../../../tools/prompts/cli-manual.md',
)

function loadManualTools(): readonly ManualTool[] {
    const markdown: string = readFileSync(MANUAL_PATH, 'utf8')
    return parseManual(markdown)
}

const REGISTERED_TOOLS: readonly CapturedTool[] = captureRegisteredTools()
const MANUAL_TOOLS: readonly ManualTool[] = loadManualTools()

describe('cli-manual parity with mcp-server zod descriptions', () => {
    it('covers every registered MCP tool', () => {
        const registeredNames: readonly string[] = REGISTERED_TOOLS
            .map((tool: CapturedTool): string => tool.name)
            .slice()
            .sort()
        const manualNames: readonly string[] = MANUAL_TOOLS
            .map((tool: ManualTool): string => tool.mcpToolName)
            .slice()
            .sort()
        expect(manualNames).toEqual(registeredNames)
    })

    it.each(REGISTERED_TOOLS)('matches description verbatim for $name', (registeredTool: CapturedTool) => {
        const manualTool: ManualTool | undefined = MANUAL_TOOLS.find(
            (tool: ManualTool): boolean => tool.mcpToolName === registeredTool.name,
        )
        expect(manualTool, `manual missing section for ${registeredTool.name}`).toBeDefined()
        expect(manualTool?.description, `${registeredTool.name} description drift`).toBe(registeredTool.description)
    })

    it.each(REGISTERED_TOOLS)('matches parameter descriptions verbatim for $name', (registeredTool: CapturedTool) => {
        const manualTool: ManualTool | undefined = MANUAL_TOOLS.find(
            (tool: ManualTool): boolean => tool.mcpToolName === registeredTool.name,
        )
        expect(manualTool, `manual missing section for ${registeredTool.name}`).toBeDefined()
        if (!manualTool) return

        const registeredPaths: readonly string[] = Array.from(registeredTool.params.keys()).sort()
        const manualPaths: readonly string[] = manualTool.params
            .map((param): string => param.name)
            .slice()
            .sort()
        expect(manualPaths, `${registeredTool.name}: parameter set mismatch`).toEqual(registeredPaths)

        for (const [path, expectedDescription] of registeredTool.params) {
            const manualParam = manualTool.params.find((param): boolean => param.name === path)
            expect(manualParam?.description, `${registeredTool.name}.${path} description drift`).toBe(expectedDescription)
        }
    })
})
