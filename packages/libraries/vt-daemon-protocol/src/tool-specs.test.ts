/**
 * Structural invariants on the spec set. The renderer and consumers
 * rely on these being true; if a future contributor violates one, this
 * test surfaces the regression rather than the consumer crashing at
 * runtime.
 */

import {describe, expect, it} from 'vitest'
import {
    SEND_MESSAGE_SPEC,
    TOOL_SPECS,
} from './tool-specs'
import {buildFromPrefixedMessage} from './from-prefix-message'
import type {ToolSpec} from './tool-spec-types'

describe('TOOL_SPECS structural invariants', () => {
    it('has the expected 14 catalog entries', () => {
        expect(TOOL_SPECS.length).toBe(14)
    })

    it('has unique rpcName values', () => {
        const names: readonly string[] = TOOL_SPECS.map((spec: ToolSpec): string => spec.rpcName)
        const unique: Set<string> = new Set<string>(names)
        expect(unique.size).toBe(names.length)
    })

    it('has unique cliVerb values', () => {
        const verbs: readonly string[] = TOOL_SPECS.map((spec: ToolSpec): string => spec.cliVerb)
        const unique: Set<string> = new Set<string>(verbs)
        expect(unique.size).toBe(verbs.length)
    })

    it('every cliVerb starts with "vt "', () => {
        for (const spec of TOOL_SPECS) {
            expect(spec.cliVerb.startsWith('vt ')).toBe(true)
        }
    })

    it('every spec carries a non-empty summary and description', () => {
        for (const spec of TOOL_SPECS) {
            expect(spec.summary.length, `${spec.rpcName} summary`).toBeGreaterThan(0)
            expect(spec.description.length, `${spec.rpcName} description`).toBeGreaterThan(0)
        }
    })

    it('every input has a non-empty rpcName, cliBulletLabel, and description', () => {
        for (const spec of TOOL_SPECS) {
            for (const input of spec.inputs) {
                expect(input.rpcName.length, `${spec.rpcName}.${input.cliBulletLabel} rpcName`).toBeGreaterThan(0)
                expect(input.cliBulletLabel.length, `${spec.rpcName} cliBulletLabel`).toBeGreaterThan(0)
                expect(input.description.length, `${spec.rpcName}.${input.rpcName} description`).toBeGreaterThan(0)
            }
        }
    })

    it('tier value is either "essentials" or "reference" on every spec', () => {
        for (const spec of TOOL_SPECS) {
            expect(['essentials', 'reference']).toContain(spec.tier)
        }
    })

    it('has at least one essentials-tier spec', () => {
        const essentials: readonly ToolSpec[] = TOOL_SPECS.filter(
            (spec: ToolSpec): boolean => spec.tier === 'essentials',
        )
        expect(essentials.length).toBeGreaterThan(0)
    })
})

describe('SEND_MESSAGE_SPEC — [From:] format SSoT', () => {
    it('embeds the buildFromPrefixedMessage output verbatim in its description', () => {
        const placeholderWrap: string = buildFromPrefixedMessage(
            '<your-terminal-id>',
            '<your-message>',
        )
        // The description must contain the literal wrapper output for the
        // placeholder identifiers. Catching this in CI ensures the manual
        // and the runtime wrapper stay byte-identical.
        expect(SEND_MESSAGE_SPEC.description).toContain(placeholderWrap)
    })

    it('mentions the [From: prefix at least once', () => {
        expect(SEND_MESSAGE_SPEC.description).toContain('[From:')
    })
})
