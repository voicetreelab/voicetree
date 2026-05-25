import {OVERRIDABLE_RULE_IDS, type OverridableRuleId} from '@vt/graph-validation'
import {error} from '../cliDeps'
import type {OverrideSpec} from './types'
import {isRecord} from './util'

function assertOverridableRuleId(ruleId: string, locator: string): OverridableRuleId {
    if (!(OVERRIDABLE_RULE_IDS as readonly string[]).includes(ruleId)) {
        error(`${locator} ruleId "${ruleId}" is not overridable. Valid: ${OVERRIDABLE_RULE_IDS.join(', ')}`)
    }
    return ruleId as OverridableRuleId
}

/**
 * Parse a CLI `--override` value of the form `ruleId:rationale`. Both halves
 * must be non-empty; the ruleId must be a member of OVERRIDABLE_RULE_IDS.
 */
export function parseOverrideSpec(value: string): OverrideSpec {
    const sep: number = value.indexOf(':')
    const ruleId: string = sep > 0 ? value.slice(0, sep).trim() : ''
    const rationale: string = sep > 0 ? value.slice(sep + 1).trim() : ''
    if (!ruleId || !rationale) {
        error(`--override value "${value}" must be ruleId:rationale (non-empty both sides of ':')`)
    }
    return {ruleId: assertOverridableRuleId(ruleId, '--override'), rationale}
}

/**
 * Validate an arbitrary JSON-shaped override entry (typically read from
 * stdin). Enforces object shape, string fields, non-empty rationale, and
 * ruleId membership — same trust model as the CLI string form.
 */
export function parseOverrideEntry(raw: unknown, locator: string): OverrideSpec {
    if (!isRecord(raw)) {
        error(`${locator} must be an object with {ruleId, rationale}`)
    }
    const {ruleId, rationale} = raw
    if (typeof ruleId !== 'string' || ruleId.length === 0) {
        error(`${locator} ruleId must be a non-empty string`)
    }
    if (typeof rationale !== 'string' || rationale.length === 0) {
        error(`${locator} rationale must be a non-empty string`)
    }
    return {ruleId: assertOverridableRuleId(ruleId, locator), rationale}
}

/**
 * Merge two override-spec arrays with last-wins-by-ruleId semantics: later
 * entries (typically CLI `--override` flags) replace earlier entries (typically
 * stdin) sharing the same ruleId. The output contains at most one entry per
 * ruleId; entry order matches first-occurrence order in the input streams.
 */
export function mergeOverrideSpecs(
    earlier: readonly OverrideSpec[],
    later: readonly OverrideSpec[],
): readonly OverrideSpec[] {
    const byRuleId: Map<OverridableRuleId, OverrideSpec> = new Map()
    for (const entry of [...earlier, ...later]) {
        byRuleId.set(entry.ruleId, entry)
    }
    return [...byRuleId.values()]
}
