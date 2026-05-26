/**
 * `vt manual` — prints the canonical CLI manual from the package's
 * `prompts/cli-manual.md`. With no args, prints the whole document.
 *
 * Tool lookup accepts the CLI verb in either form:
 *
 *   - Multi-token, exactly as it appears on the command line:
 *       `vt manual agent spawn`
 *       `vt manual graph create`
 *   - Single-token, joined with spaces and optionally `vt`-prefixed:
 *       `vt manual "vt agent spawn"`
 *       `vt manual "agent spawn"`
 *
 * The MCP / RPC tool name (e.g. `spawn_agent`) is intentionally NOT a valid
 * selector: the CLI surface is canonical and the manual no longer carries
 * underscored daemon names in its section headers. To discover the RPC
 * parameter shape from a CLI verb, run `vt <verb> --help` — every flag's
 * `(RPC: <param>)` annotation makes the mapping explicit.
 *
 * The on-disk markdown file is the source of truth for client-facing
 * descriptions; the drift check in
 * `packages/systems/vt-daemon/src/transport/tests/catalogManualDrift.test.ts`
 * keeps it in lock-step with the daemon's tool catalog.
 */

import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {error} from './output.ts'
import {parseManual, type ManualTool} from '../manual/parseManual.ts'

// The manual lives at <package>/prompts/cli-manual.md. Locate it by walking up
// from this module until we hit the directory that contains `prompts/`. This
// keeps a single source of truth for the lookup across both the source layout
// (<package>/src/commands/manual.ts) and the bundled layout
// (<package>/dist/voicetree-cli.js).
const MANUAL_RELATIVE_PATH: string = join('prompts', 'cli-manual.md')

function findManualPath(startUrl: string): string | undefined {
    let current: string = dirname(fileURLToPath(startUrl))
    while (current !== dirname(current)) {
        const candidate: string = join(current, MANUAL_RELATIVE_PATH)
        if (existsSync(candidate)) return candidate
        current = dirname(current)
    }
    return undefined
}

export function runManualCommand(args: readonly string[]): void {
    const markdown: string = readManualFile()

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
        process.stdout.write(markdown)
        if (!markdown.endsWith('\n')) process.stdout.write('\n')
        return
    }

    const selector: string = normalizeSelector(args)
    const tools: readonly ManualTool[] = parseManual(markdown)
    const match: ManualTool | undefined = findToolBySelector(tools, selector)
    if (!match) {
        const known: string = tools
            .map((tool: ManualTool): string => `  ${tool.cliVerb}`)
            .join('\n')
        error(`vt manual: no tool matches \`${selector}\`. Known tools:\n${known}`)
    }

    renderTool(match)
}

function readManualFile(): string {
    const manualPath: string | undefined = findManualPath(import.meta.url)
    if (manualPath === undefined) {
        error(`vt manual: cannot locate ${MANUAL_RELATIVE_PATH} relative to ${fileURLToPath(import.meta.url)}`)
    }
    try {
        return readFileSync(manualPath, 'utf8')
    } catch (cause: unknown) {
        const message: string = cause instanceof Error ? cause.message : String(cause)
        error(`vt manual: cannot read ${manualPath}: ${message}`)
    }
}

/**
 * Collapse whitespace between argv tokens so that `agent spawn`,
 * `'agent spawn'`, and `vt agent spawn` all normalize to the same selector
 * the matcher then compares against `cliVerb` values from the manual.
 */
function normalizeSelector(args: readonly string[]): string {
    return args.join(' ').trim().replace(/\s+/g, ' ')
}

function findToolBySelector(tools: readonly ManualTool[], selector: string): ManualTool | undefined {
    const lowered: string = selector.toLowerCase()
    const withPrefix: string = lowered.startsWith('vt ') ? lowered : `vt ${lowered}`
    return tools.find((tool: ManualTool): boolean => tool.cliVerb.toLowerCase() === withPrefix)
}

function renderTool(tool: ManualTool): void {
    const lines: string[] = []
    lines.push(`### \`${tool.cliVerb}\``)
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
