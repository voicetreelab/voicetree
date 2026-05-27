/**
 * Drift check between `tools/catalog.ts` (load-bearing data; consumed by the
 * HTTP daemon for input validation + dispatch) and the CLI manual now shipped
 * inside @voicetree/cli (`packages/systems/voicetree-cli/prompts/cli-manual.md`,
 * load-bearing canonical docs; spawn-prompt injection source).
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
    '../../../../voicetree-cli/prompts/cli-manual.md',
)

// Mapping from the catalog's MCP-style tool name to the user-facing `vt`
// CLI verb that appears as the manual's H3 header. Step 7 deleted the MCP
// server; the manual is now CLI-flavored. Catalog entries still carry their
// historical `name` (used for HTTP dispatch keys) until a later milestone
// renames the catalog itself — until then this table is the bridge.
const CLI_VERBS: Readonly<Record<string, string>> = {
    spawn_agent: 'vt agent spawn',
    list_agents: 'vt agent list',
    wait_for_agents: 'vt agent wait',
    get_unseen_nodes_nearby: 'vt graph unseen',
    close_agent: 'vt agent close',
    send_message: 'vt agent send',
    read_terminal_output: 'vt agent output',
    create_graph: 'vt graph create',
    graph_structure: 'vt graph structure',
    search_nodes: 'vt search',
    vt_get_live_state: 'vt graph live state dump',
    vt_dispatch_live_command: 'vt graph live apply',
    'metrics.getSessions': 'vt agent metrics sessions',
    'metrics.appendSession': 'vt agent metrics append',
}

function loadManual(): string {
    return readFileSync(MANUAL_PATH, 'utf8')
}

describe('catalog ↔ cli-manual drift', () => {
    const manual: string = loadManual()

    it.each(TOOL_CATALOG)('manual contains a section header for $name', (entry: CatalogEntry) => {
        // Each entry must show up as `### \`<vt cli verb>\`` in the manual.
        const verb: string | undefined = CLI_VERBS[entry.name]
        expect(verb, `no CLI_VERBS mapping for catalog entry "${entry.name}"`).toBeDefined()
        expect(manual, `manual is missing the section header for ${entry.name} (\`${verb}\`)`)
            .toContain(`\`${verb}\``)
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
