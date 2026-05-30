/**
 * Pure markdown renderer for `ToolSpec` data.
 *
 * Replaces the static `cli-manual.md` file plus its `parseManual.ts`
 * parser: the manual is generated on demand from the spec data. Three
 * consumers call into here:
 *
 *   - `vt manual` (and `vt manual <verb>`) — renders the full manual
 *     or a single section so users can pull tool docs without leaving
 *     the terminal.
 *   - Spawn-time injection (`@vt/vt-daemon` → `cliManualInjection.ts`)
 *     renders the `essentials` slice and splices it into the spawned
 *     agent's AGENT_PROMPT.
 *   - Webapp project-bootstrap (`projectAgentDiscoveryFile.ts`) renders
 *     the `overview` slice (preamble + Essentials + a pointer to
 *     `vt manual <verb>`, no full Reference dump) to advertise the `vt`
 *     CLI inside CLAUDE.md / AGENTS.md for user-launched coding agents.
 *     That block is injected into every agent's context on every run, so
 *     it stays lean; the full per-verb reference is one `vt manual <verb>`
 *     away.
 *
 * Pure: no I/O, no env reads. Deterministic for a given spec set so
 * tests can compare against literal expected output.
 */

import type {ToolSpec, ToolInputSpec, ToolTier} from './tool-spec-types'
import {MANUAL_SPECS} from './manual-specs.ts'

export type RenderTier = 'essentials' | 'overview' | 'all'

export interface RenderManualOptions {
    /**
     * - `'essentials'` emits only the essentials-tier specs — no
     *   preamble, no Reference section, no Essentials wrapper headers.
     *   Used by spawn-time AGENT_PROMPT injection, where compactness is
     *   paramount.
     * - `'overview'` emits the preamble + the Essentials section (whose
     *   header points readers at `vt manual <verb>` for anything else)
     *   but omits the full Reference dump. Used for the always-on
     *   CLAUDE.md / AGENTS.md discovery block: enough to orient an agent,
     *   lean enough to inject into every context.
     * - `'all'` emits the full manual (preamble + Essentials +
     *   Reference). Used by `vt manual` for complete, on-demand lookup.
     */
    readonly tier?: RenderTier
}

const PREAMBLE: string = [
    '# vt CLI Manual',
    '',
    'This is the canonical reference for the `vt` CLI surface. Generated from',
    '`@vt/vt-daemon-protocol` (TOOL_SPECS + CLI-local specs) — do not edit by',
    'hand. Run `vt manual` to print the full document or `vt manual <verb>` for',
    'a single section.',
    '',
    '## Format',
    '',
    'Each tool section starts with an H3 header of the shape:',
    '',
    '    ### `<vt cli verb>`',
    '',
    'The text between the header and `**Parameters:**` is the tool description.',
    'The bullet list under `**Parameters:**` enumerates each CLI flag or',
    'positional argument and — where it dispatches to a daemon tool — the JSON',
    'RPC parameter name it maps to in the form `(RPC: rpcParam)`. Tools with',
    'no parameters omit the `**Parameters:**` block.',
    '',
].join('\n')

const ESSENTIALS_HEADER: string = '## Essentials\n\nThese are the core verbs every spawning agent needs. For any other tool, run `vt manual <verb>` (or `vt --help` for the full list).\n'

const REFERENCE_HEADER: string = '## Reference\n'

/**
 * Render the manual at one of three breadths (see `RenderTier`):
 *   - `'essentials'`: the bare essentials slice, no headers.
 *   - `'overview'`: preamble + Essentials section only.
 *   - `'all'` (default): the full manual — Essentials then Reference.
 * Specs are emitted in input order; in `'overview'`/`'all'` modes the
 * essentials are listed first under an "## Essentials" header, and in
 * `'all'` mode everything else follows under "## Reference".
 */
export function renderManual(
    specs: readonly ToolSpec[],
    opts: RenderManualOptions = {},
): string {
    const tier: RenderTier = opts.tier ?? 'all'
    if (tier === 'essentials') return renderTierBlock(specs, 'essentials')

    const body: string[] = [
        PREAMBLE,
        ESSENTIALS_HEADER,
        renderTierBlock(specs, 'essentials'),
    ]
    if (tier === 'all') {
        body.push(REFERENCE_HEADER, renderTierBlock(specs, 'reference'))
    }
    return body.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * Convenience for callers that render from the full documented spec
 * set — `MANUAL_SPECS`, i.e. the daemon-dispatched `TOOL_SPECS` plus the
 * CLI-local doc-only `CLI_LOCAL_SPECS`. The `tier` opt still selects the
 * breadth: `vt manual` calls this with the default `'all'`; webapp
 * project-bootstrap calls it with `{tier: 'overview'}` for the lean
 * CLAUDE.md / AGENTS.md block. Exists so sibling packages don't need to
 * import `MANUAL_SPECS` as a separate symbol alongside the renderer.
 *
 * Spawn-time injection deliberately renders the essentials slice of
 * `TOOL_SPECS` directly (not this set), since essentials are
 * daemon-dispatched only.
 *
 * Tests that need a different spec set call `renderManual(specs, opts)`
 * directly; the no-arg form deliberately doesn't expose injection.
 */
export function renderFullManual(opts: RenderManualOptions = {}): string {
    return renderManual(MANUAL_SPECS, opts)
}

/**
 * Render a single tool section. Used by `vt manual <verb>` and by
 * callers that want to splice one tool's docs into a larger document.
 * Trailing newline included for buffer-friendly stdout writes.
 */
export function renderManualSection(spec: ToolSpec): string {
    const lines: string[] = [`### \`${spec.cliVerb}\``, '']
    if (spec.description.length > 0) {
        lines.push(spec.description.trimEnd())
        lines.push('')
    }
    if (spec.inputs.length > 0) {
        lines.push('**Parameters:**')
        lines.push('')
        for (const input of spec.inputs) {
            lines.push(renderInputBullet(input))
        }
        lines.push('')
    }
    return lines.join('\n')
}

function renderTierBlock(specs: readonly ToolSpec[], tier: ToolTier): string {
    const tierSpecs: readonly ToolSpec[] = specs.filter(
        (spec: ToolSpec): boolean => spec.tier === tier,
    )
    return tierSpecs.map(renderManualSection).join('\n')
}

function renderInputBullet(input: ToolInputSpec): string {
    const tokenAndAnnotation: string = input.annotation.length > 0
        ? `\`${input.cliBulletLabel}\` (${input.annotation})`
        : `\`${input.cliBulletLabel}\``
    return `- ${tokenAndAnnotation}: ${input.description}`
}

/**
 * Look up a tool spec by CLI verb. Accepts the canonical form
 * (`'vt agent send'`), the no-prefix form (`'agent send'`), and any
 * whitespace normalization the caller produced (extra spaces, `.`
 * separators).
 *
 * Returns the matching spec, or undefined if no spec matches. Callers
 * compose their own "did you mean X" / not-found surfaces; this stays
 * a pure lookup.
 */
export function findSpecByCliVerb(
    specs: readonly ToolSpec[],
    selector: string,
): ToolSpec | undefined {
    const normalized: string = normalizeVerb(selector)
    return specs.find(
        (spec: ToolSpec): boolean => normalizeVerb(spec.cliVerb) === normalized,
    )
}

function normalizeVerb(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/^vt\s+/, '')
        .replace(/[._\-]+/g, ' ')
        .replace(/\s+/g, ' ')
}
