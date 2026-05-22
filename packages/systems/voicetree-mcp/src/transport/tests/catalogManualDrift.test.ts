/**
 * Drift check between `tools/catalog.ts` (load-bearing data; consumed by the
 * UDS server for input validation + dispatch) and `tools/prompts/cli-manual.md`
 * (load-bearing canonical docs; spawn-prompt injection source).
 *
 * Replaces the deleted byte-for-byte parity lint
 * (`cliManualParity.test.ts` + `extractZodDescriptions.ts`). The old lint ran
 * before the MCP wire was removed and asserted equality between the manual
 * and the MCP server's zod registrations — that surface is gone in 7f, so
 * the strict mechanism dies with it. This substring check is the lightweight
 * replacement called out in design doc §9.3: it catches outright deletion
 * drift between the two without re-introducing a parser for the manual.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

import {TOOL_CATALOG, type CatalogEntry} from '../../tools/catalog'

const MANUAL_PATH: string = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../../tools/prompts/cli-manual.md',
)

function loadManual(): string {
    return readFileSync(MANUAL_PATH, 'utf8')
}

describe('catalog ↔ cli-manual drift', () => {
    const manual: string = loadManual()

    it.each(TOOL_CATALOG)('manual contains a section header for $name', (entry: CatalogEntry) => {
        // Each entry must show up as `### \`<name>\`` in the manual.
        expect(manual, `manual is missing the section for ${entry.name}`)
            .toContain(`\`${entry.name}\``)
    })

    it.each(TOOL_CATALOG)('manual contains the description leader for $name', (entry: CatalogEntry) => {
        // The first non-empty line of each description must appear verbatim
        // somewhere in the manual. We compare against the leader rather than
        // the full description because the manual is allowed to wrap or split
        // bullets — but the opening sentence is load-bearing for discovery
        // and must not silently rot.
        const leader: string = entry.description.split('\n')[0].trim()
        expect(leader.length, `${entry.name} has an empty description`).toBeGreaterThan(0)
        expect(manual, `manual is missing description leader for ${entry.name}: "${leader}"`)
            .toContain(leader)
    })
})
