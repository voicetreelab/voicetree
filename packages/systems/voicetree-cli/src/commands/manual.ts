/**
 * `vt manual` — prints the canonical CLI manual from the package's
 * `prompts/cli-manual.md`. With no args, prints the whole document.
 * With one or two args, looks up a tool section by MCP tool name (e.g.
 * `vt manual spawn_agent`) or by CLI verb (e.g. `vt manual agent spawn`,
 * `vt manual graph create`).
 *
 * The on-disk markdown file is the source of truth for client-facing
 * descriptions; the drift check in
 * `packages/systems/voicetree-mcp/src/transport/tests/catalogManualDrift.test.ts`
 * keeps it in lock-step with the daemon's tool catalog.
 */

import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {error} from '../output.ts'
import {parseManual, type ManualTool} from '../manual/parseManual.ts'

// This file lives at <package>/src/commands/manual.ts; the manual lives at
// <package>/prompts/cli-manual.md. Resolve relative to the file so the lookup
// works regardless of CWD or repo-root vs. installed-package layout.
const PACKAGE_DIR: string = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const MANUAL_PATH: string = join(PACKAGE_DIR, 'prompts', 'cli-manual.md')

export function runManualCommand(args: readonly string[]): void {
    const markdown: string = readManualFile()

    if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
        process.stdout.write(markdown)
        if (!markdown.endsWith('\n')) process.stdout.write('\n')
        return
    }

    const selector: string = normalizeSelector(args)
    const tools: readonly ManualTool[] = parseManual(markdown)
    const match: ManualTool | undefined = findToolBySelector(tools, selector)
    if (!match) {
        const known: string = tools
            .map((tool: ManualTool): string => `  ${tool.mcpToolName} (${tool.cliVerb})`)
            .join('\n')
        error(`vt manual: no tool matches \`${selector}\`. Known tools:\n${known}`)
    }

    renderTool(match)
}

function readManualFile(): string {
    try {
        return readFileSync(MANUAL_PATH, 'utf8')
    } catch (cause: unknown) {
        const message: string = cause instanceof Error ? cause.message : String(cause)
        error(`vt manual: cannot read ${MANUAL_PATH}: ${message}`)
    }
}

function normalizeSelector(args: readonly string[]): string {
    return args.join(' ').trim()
}

function findToolBySelector(tools: readonly ManualTool[], selector: string): ManualTool | undefined {
    const lowered: string = selector.toLowerCase()
    return tools.find((tool: ManualTool): boolean => {
        if (tool.mcpToolName.toLowerCase() === lowered) return true
        if (tool.cliVerb.toLowerCase() === lowered) return true
        if (tool.cliVerb.toLowerCase() === `vt ${lowered}`) return true
        return false
    })
}

function renderTool(tool: ManualTool): void {
    const lines: string[] = []
    lines.push(`### \`${tool.mcpToolName}\` — \`${tool.cliVerb}\``)
    lines.push('')
    if (tool.description.length > 0) {
        lines.push(tool.description)
        lines.push('')
    }
    if (tool.params.length > 0) {
        lines.push('**Parameters:**')
        lines.push('')
        for (const param of tool.params) {
            const descriptionLines: readonly string[] = param.description.split('\n')
            lines.push(`- \`${param.name}\`: ${descriptionLines[0]}`)
            for (const continuation of descriptionLines.slice(1)) {
                lines.push(`  ${continuation}`)
            }
        }
    }
    process.stdout.write(`${lines.join('\n')}\n`)
}
