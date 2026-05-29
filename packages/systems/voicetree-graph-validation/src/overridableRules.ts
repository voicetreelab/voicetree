/**
 * Soft, overridable validation rule taxonomy for create_graph.
 *
 * Single source of truth for the rule IDs the create_graph tool may emit
 * (via @vt/vt-daemon) and the override-spec entries that the CLI parses
 * (via @voicetree/cli). Adding a rule here is the only place needed.
 *
 * Pure types + a frozen const literal — no runtime dependencies.
 */

export const OVERRIDABLE_RULE_IDS = ['grandparent_attachment', 'node_line_limit', 'node_must_have_edge'] as const
export type OverridableRuleId = typeof OVERRIDABLE_RULE_IDS[number]

export interface OverrideEntry {
    readonly ruleId: OverridableRuleId
    readonly rationale: string
}
