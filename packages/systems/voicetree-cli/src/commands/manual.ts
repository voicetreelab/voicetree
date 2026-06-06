/**
 * `vt manual` — prints the canonical CLI manual rendered from the
 * single-source `MANUAL_SPECS` data in `@vt/vt-daemon-protocol`
 * (daemon-dispatched `TOOL_SPECS` plus CLI-local doc-only specs). With
 * no args, prints the whole document. With a selector, prints just
 * the matching tool section — so `vt manual <cli-local-verb>` resolves
 * even though that verb never dispatches to a daemon RPC.
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
 * The daemon-side RPC tool name (e.g. `spawn_agent`) is intentionally NOT
 * a valid selector: the CLI surface is canonical. To discover the RPC
 * parameter shape from a CLI verb, run `vt <verb> --help` — every flag's
 * `(RPC: <param>)` annotation makes the mapping explicit.
 *
 * No filesystem I/O: the manual is rendered from `MANUAL_SPECS` at
 * runtime. The daemon-dispatched subset (`TOOL_SPECS`) is also the
 * single source of truth for the daemon's catalog descriptions.
 */

import * as daemonProtocol from '@vt/vt-daemon-protocol'
import type {ToolSpec} from '@vt/vt-daemon-protocol'
import {error} from './output.ts'

export function runManualCommand(args: readonly string[]): void {
    process.stdout.write(resolveManualCommand(daemonProtocol.MANUAL_SPECS, args))
}

/**
 * Pure core of `vt manual` — given the spec set and CLI args, return
 * the bytes that should be written to stdout, or throw `CliError` with
 * the user-facing not-found message. All I/O stays in
 * `runManualCommand`.
 */
export function resolveManualCommand(specs: readonly ToolSpec[], args: readonly string[]): string {
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
        return daemonProtocol.renderManual(specs)
    }

    const selector: string = normalizeSelector(args)
    const match: ToolSpec | undefined = daemonProtocol.findSpecByCliVerb(specs, selector)
    if (!match) {
        error(buildNotFoundMessage(specs, selector))
    }

    return ensureTrailingNewline(daemonProtocol.renderManualSection(match))
}

/**
 * Compose the error body shown when no tool matches the user's
 * selector. Returns the suggestions (closest matches) followed by the
 * full list as a fallback browsing aid.
 */
function buildNotFoundMessage(specs: readonly ToolSpec[], selector: string): string {
    if (specs.length === 0) {
        return `vt manual: no tool specs loaded (likely an upstream import bug). Run \`vt --help\` for the CLI top-level surface.`
    }
    const suggestions: readonly ToolSpec[] = rankSuggestions(specs, selector)
    const lines: string[] = [`vt manual: no tool matches \`${selector}\`.`, 'Did you mean:']
    for (const suggestion of suggestions) lines.push(`  ${suggestion.cliVerb}`)
    lines.push('Or pick from the full list:')
    for (const spec of specs) lines.push(`  ${spec.cliVerb}`)
    return lines.join('\n')
}

/**
 * Pick up to three cliVerb candidates closest to the user's selector
 * using Levenshtein distance over a normalized form (strip leading
 * `vt`, fold `.`/`_`/`-` to spaces, collapse whitespace). The
 * normalization is what makes `agent.spawn` and `vt agent spawn`
 * collapse to the same token.
 */
function rankSuggestions(specs: readonly ToolSpec[], selector: string): readonly ToolSpec[] {
    const normalizedSelector: string = normalizeForFuzzy(selector)
    const scored: Array<{spec: ToolSpec; distance: number}> = specs.map((spec: ToolSpec): {spec: ToolSpec; distance: number} => ({
        spec,
        distance: levenshtein(normalizeForFuzzy(spec.cliVerb), normalizedSelector),
    }))
    scored.sort((a: {spec: ToolSpec; distance: number}, b: {spec: ToolSpec; distance: number}): number => a.distance - b.distance)
    return scored.slice(0, 3).map((entry: {spec: ToolSpec; distance: number}): ToolSpec => entry.spec)
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

/**
 * Collapse whitespace between argv tokens so that `agent spawn`,
 * `'agent spawn'`, and `vt agent spawn` all normalize to the same
 * selector that `findSpecByCliVerb` compares against `cliVerb` values.
 */
function normalizeSelector(args: readonly string[]): string {
    return args.join(' ').trim().replace(/\s+/g, ' ')
}

function ensureTrailingNewline(content: string): string {
    return content.endsWith('\n') ? content : `${content}\n`
}
