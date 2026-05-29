/**
 * Shared shape descriptions for VoiceTree tools — the single source of
 * truth that powers (a) the daemon's RPC catalog (`@vt/vt-daemon`'s
 * `catalog.ts`), (b) the user-facing manual rendered for `vt manual` and
 * spawn-time prompt injection, and (c) the cross-shell vault discovery
 * file written into CLAUDE.md / AGENTS.md.
 *
 * The actual spec data + renderer live in this package (`tool-specs.ts`
 * and `renderManual.ts`). Putting types and data in `@vt/vt-daemon-protocol`
 * — not in `@vt/vt-daemon` — keeps the SSoT importable by the CLI and the
 * webapp main process without inverting the dep direction (CLI → daemon
 * internals).
 */

/**
 * Two-tier classification used by spawn-time injection to keep the
 * spawned agent's AGENT_PROMPT short. The `essentials` block is injected
 * verbatim; the rest is discoverable via `vt manual <verb>`.
 */
export type ToolTier = 'essentials' | 'reference'

/**
 * One CLI-visible parameter (positional argument or flag) on a tool.
 *
 * `description` is the single source for two surfaces:
 *   - the manual bullet — what `vt manual <verb>` prints under
 *     `**Parameters:**` and what spawn-prompt injection shows agents;
 *   - the daemon's zod `.describe()` text for the matching input field,
 *     which the catalog uses for input-validation error messages.
 *
 * Sourcing both from the same string makes drift between "what the
 * manual says the parameter means" and "what the daemon's validator
 * documents about it" structurally impossible.
 */
export interface ToolInputSpec {
    /**
     * Wire-level parameter name as it appears in the RPC payload, e.g.
     * `terminalId`, `task`, `callerTerminalId`. This is what catalog.ts
     * uses as the zod input shape key.
     */
    readonly rpcName: string

    /**
     * The token printed inside backticks in the manual's parameter
     * bullet, e.g. `<terminalId>` (positional), `--task VALUE` (value
     * flag), `--terminal / -t` (caller flag), `--force VALUE`
     * (optional value flag), `--headless` (boolean flag).
     */
    readonly cliBulletLabel: string

    /**
     * The parenthesized annotation rendered after the bullet's token,
     * e.g. `positional, RPC: terminalId`, `RPC: task`, `RPC: headless`,
     * or empty when no annotation is rendered. Convention: include the
     * `RPC: <rpcName>` mapping for any flag whose CLI surface differs
     * from the wire name.
     */
    readonly annotation: string

    /**
     * Single-source description used by both the manual and the
     * catalog's zod `.describe()` for this input. Markdown-light: plain
     * sentences, may include backticked identifiers but no headers or
     * multi-line markdown blocks.
     */
    readonly description: string
}

/**
 * One tool — both its CLI verb and its wire (RPC) name — paired with the
 * documentation surfaces that should never drift.
 *
 * Conventions:
 *   - `rpcName` matches the catalog dispatch key.
 *   - `cliVerb` matches the manual's H3 header and the verb that
 *     `vt manual <verb>` accepts (full form, including the `vt ` prefix).
 *   - `summary` is the one-line description shown by `vt <verb> --help`
 *     and the catalog's RPC handshake. Must be plain text (no markdown).
 *   - `description` is the full multi-paragraph markdown rendered in
 *     the manual. May embed bold subsection headers, code fences, lists.
 *     `summary` should be a subset / paraphrase of the first paragraph.
 *   - `inputs` lists every CLI-visible parameter in display order.
 */
export interface ToolSpec {
    readonly rpcName: string
    readonly cliVerb: string
    readonly tier: ToolTier
    readonly summary: string
    readonly description: string
    readonly inputs: readonly ToolInputSpec[]
}
