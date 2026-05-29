#!/usr/bin/env node --import tsx
/**
 * L3-BF-191: ASCII → State roundtrip parser + fidelity scorer.
 *
 * Reads `vt-graph view <root>` ASCII output and `vt-graph state dump <root>` JSON,
 * attempts to reconstruct the node+edge set from ASCII, and scores fidelity.
 *
 * Nodes are identified by (folder-path :: title) since ASCII does not expose filenames.
 * Legacy inline edges are identified by (src-title :: target-title) because inline arrows use titles.
 * Footer edges are identified by exact path IDs emitted in the `[Cross-Links]` section.
 *
 * Run:
 *   ./node_modules/.bin/vt-graph state dump <root> --no-pretty --out /tmp/state.json
 *   ./node_modules/.bin/vt-graph view <root> > /tmp/ascii.txt
 *   npx tsx packages/libraries/graph-tools/scripts/L3-BF-191-ascii-parser.ts /tmp/ascii.txt /tmp/state.json
 */

import {runAsciiParserCli} from './L3-BF-191-ascii-parser/cli'

export {parseAscii} from './L3-BF-191-ascii-parser/parser'
export type {
    ParsedFooterEdge,
    ParsedInlineEdge,
    ParsedNode,
    ParseResult,
} from './L3-BF-191-ascii-parser/parser'

if (process.argv[1]?.endsWith('L3-BF-191-ascii-parser.ts') === true && import.meta.url === `file://${process.argv[1]}`) {
    runAsciiParserCli(process.argv)
}
