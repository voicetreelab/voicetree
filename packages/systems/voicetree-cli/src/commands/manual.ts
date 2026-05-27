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
    process.stdout.write(resolveManualCommand(readManualFile(), args))
}

/**
 * Pure core of `vt manual` — given the raw manual markdown and CLI args,
 * return the bytes that should be written to stdout, or throw CliError with
 * the user-facing not-found message. All IO stays in `runManualCommand`.
 */
export function resolveManualCommand(markdown: string, args: readonly string[]): string {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
        return markdown.endsWith('\n') ? markdown : `${markdown}\n`
    }

    const selector: string = normalizeSelector(args)
    const tools: readonly ManualTool[] = parseManual(markdown)
    const match: ManualTool | undefined = findToolBySelector(tools, selector)
    if (!match) {
        error(buildNotFoundMessage(tools, selector))
    }

    return renderTool(match)
}

/**
 * Compose the error body shown when no tool matches the user's selector.
 *
 * Two distinct cases:
 *   - `tools.length === 0` — parseManual returned nothing. This is almost
 *     always a parser bug (regression of the HTML-comment fix, or a new
 *     markdown construct the parser doesn't understand). Surface that
 *     hypothesis directly so the next operator can diagnose it instantly
 *     instead of staring at an empty "Known tools:" list.
 *   - `tools.length > 0` — the selector simply didn't hit. Compute a few
 *     close cliVerb suggestions ("Did you mean: …") and still print the
 *     full list as a fallback browsing aid.
 */
function buildNotFoundMessage(tools: readonly ManualTool[], selector: string): string {
    if (tools.length === 0) {
        return `vt manual: parser produced no tools (likely parseManual bug). Run \`vt manual\` for the full manual.`
    }
    const suggestions: readonly ManualTool[] = rankSuggestions(tools, selector)
    const lines: string[] = [`vt manual: no tool matches \`${selector}\`.`, 'Did you mean:']
    for (const suggestion of suggestions) lines.push(`  ${suggestion.cliVerb}`)
    lines.push('Or pick from the full list:')
    for (const tool of tools) lines.push(`  ${tool.cliVerb}`)
    return lines.join('\n')
}

/**
 * Pick up to three cliVerb candidates closest to the user's selector using
 * Levenshtein distance over a normalized form (strip the leading `vt`,
 * fold `.`/`_`/`-` to spaces, collapse whitespace). The normalization is
 * what makes `agent.spawn` and `vt agent spawn` collapse to the same token.
 */
function rankSuggestions(tools: readonly ManualTool[], selector: string): readonly ManualTool[] {
    const normalizedSelector: string = normalizeForFuzzy(selector)
    const scored: Array<{tool: ManualTool; distance: number}> = tools.map((tool: ManualTool): {tool: ManualTool; distance: number} => ({
        tool,
        distance: levenshtein(normalizeForFuzzy(tool.cliVerb), normalizedSelector),
    }))
    scored.sort((a: {tool: ManualTool; distance: number}, b: {tool: ManualTool; distance: number}): number => a.distance - b.distance)
    return scored.slice(0, 3).map((entry: {tool: ManualTool; distance: number}): ManualTool => entry.tool)
}

function normalizeForFuzzy(input: string): string {
    return input
        .toLowerCase()
        .replace(/^vt\s+/, '')
        .replace(/[._\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    let previous: number[] = []
    for (let column: number = 0; column <= b.length; column += 1) previous.push(column)
    for (let row: number = 1; row <= a.length; row += 1) {
        const current: number[] = [row]
        for (let column: number = 1; column <= b.length; column += 1) {
            const cost: number = a.charCodeAt(row - 1) === b.charCodeAt(column - 1) ? 0 : 1
            current.push(Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost,
            ))
        }
        previous = current
    }
    return previous[b.length]
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

function renderTool(tool: ManualTool): string {
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
    return `${lines.join('\n')}\n`
}
