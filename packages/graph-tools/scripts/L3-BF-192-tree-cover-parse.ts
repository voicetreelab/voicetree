#!/usr/bin/env node --import tsx
/**
 * L3-BF-192: tree-cover roundtrip parser + fidelity scorer.
 *
 * Reads tree-cover ASCII (output of L3-BF-192-tree-cover-render.ts) and the ground-truth
 * state.json. Reconstructs (source @id → target @id) edge set from the ASCII by extracting
 * @relative-path identifiers from ● source blocks and their ⇢ children.
 *
 * Reports:
 *   — node-fidelity %  (unique @id set in ASCII vs JSON nodes)
 *   — edge-fidelity %  (reconstructed directed edges ⊇ ground-truth edges?)
 *   — lossless pass/fail
 *
 * Run:
 *   npx tsx packages/graph-tools/scripts/L3-BF-192-tree-cover-parse.ts /tmp/wm-tree-cover.txt /tmp/wm-state.json [<vault-root>]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

type JsonNode = {
    readonly outgoingEdges: ReadonlyArray<{targetId: string; label?: string}>
    readonly absoluteFilePathIsID: string
}
type JsonState = {readonly graph: {readonly nodes: Record<string, JsonNode>}}

// ── Identifier extraction ────────────────────────────────────────────────────

// Matches the @relative-path id at the end of a line. The path is everything after
// the LAST ` @` in the line up to an optional label suffix " [label]".
// Match the FIRST @[id] marker on the line. Edge labels (appended as " [label]")
// can contain nested brackets from wikilinks like "[[foo]]", so we key off the
// "@[" prefix which is reserved for node IDs only.
const ID_RE: RegExp = /\s@\[([^\]]+)\]/
const SOURCE_MARK: RegExp = /^●\s/
const TARGET_MARK: RegExp = /^(?:├──|└──)\s⇢\s/
const SPINE_FILE_MARK: RegExp = /^(?:│\s{3}|\s{4})*(?:├──|└──)\s·\s/

function extractIdFromLine(line: string): string | null {
    const m: RegExpMatchArray | null = line.match(ID_RE)
    return m?.[1] ?? null
}

type Parsed = {
    readonly spineFileIds: Set<string>
    readonly edges: ReadonlyArray<{src: string; tgt: string}>
    readonly droppedLines: readonly string[]
}

function parseTreeCover(text: string): Parsed {
    const lines: string[] = text.split('\n')
    const spineFileIds: Set<string> = new Set()
    const edges: Array<{src: string; tgt: string}> = []
    const dropped: string[] = []
    let currentSource: string | null = null
    let inSpine: boolean = false
    let inCover: boolean = false
    for (const raw of lines) {
        const line: string = raw
        if (line.startsWith('═══ SPINE')) {inSpine = true; inCover = false; currentSource = null; continue}
        if (line.startsWith('═══ COVER FOREST')) {inSpine = false; inCover = true; currentSource = null; continue}
        if (line.trim() === '') continue

        if (inSpine) {
            if (SPINE_FILE_MARK.test(line)) {
                const id: string | null = extractIdFromLine(line)
                if (id) spineFileIds.add(id)
                else dropped.push(`spine-no-id:${line}`)
            }
            continue
        }

        if (inCover) {
            if (SOURCE_MARK.test(line)) {
                const id: string | null = extractIdFromLine(line)
                if (!id) {dropped.push(`source-no-id:${line}`); currentSource = null; continue}
                currentSource = id
                continue
            }
            if (TARGET_MARK.test(line)) {
                if (!currentSource) {dropped.push(`target-without-source:${line}`); continue}
                const id: string | null = extractIdFromLine(line)
                if (!id) {dropped.push(`target-no-id:${line}`); continue}
                edges.push({src: currentSource, tgt: id})
                continue
            }
            // Blank lines already skipped. Anything else in cover section is unexpected.
            dropped.push(`cover-unknown:${line}`)
        }
    }
    return {spineFileIds, edges, droppedLines: dropped}
}

// ── JSON ground-truth derivation ─────────────────────────────────────────────

function lcpOfIds(ids: readonly string[]): string {
    if (ids.length === 0) return ''
    let lcp: string = ids[0]!
    for (const id of ids) {
        while (!id.startsWith(lcp)) {
            lcp = lcp.slice(0, lcp.lastIndexOf('/'))
            if (lcp === '') return ''
        }
    }
    return lcp
}

function relId(absPath: string, vaultRoot: string): string {
    return absPath.startsWith(vaultRoot + '/') ? absPath.slice(vaultRoot.length + 1) : absPath
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
    const asciiPath: string | undefined = process.argv[2]
    const jsonPath: string | undefined = process.argv[3]
    const vaultArg: string | undefined = process.argv[4]
    if (!asciiPath || !jsonPath) {
        console.error('Usage: L3-BF-192-tree-cover-parse.ts <tree-cover.txt> <state.json> [<vault-root>]')
        process.exit(2)
    }
    const ascii: string = fs.readFileSync(asciiPath, 'utf8')
    const state: JsonState = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const ids: string[] = Object.keys(state.graph.nodes)
    const vaultRoot: string = vaultArg ? path.resolve(vaultArg) : lcpOfIds(ids)

    const parsed: Parsed = parseTreeCover(ascii)

    // Ground-truth node set: unique relative ids
    const jsonNodeIds: Set<string> = new Set(ids.map(id => relId(id, vaultRoot)))

    // Ground-truth edge set: (src-rel, tgt-rel) pairs, skip self-loops
    const jsonEdges: Set<string> = new Set()
    for (const [srcAbs, node] of Object.entries(state.graph.nodes)) {
        const src: string = relId(srcAbs, vaultRoot)
        for (const e of node.outgoingEdges) {
            if (e.targetId === srcAbs) continue
            const tgt: string = relId(e.targetId, vaultRoot)
            jsonEdges.add(`${src}|${tgt}`)
        }
    }

    // Reconstructed
    const reconstructedEdges: Set<string> = new Set(parsed.edges.map(e => `${e.src}|${e.tgt}`))
    const reconstructedNodes: Set<string> = new Set<string>()
    for (const id of parsed.spineFileIds) reconstructedNodes.add(id)
    for (const e of parsed.edges) {reconstructedNodes.add(e.src); reconstructedNodes.add(e.tgt)}

    // Node fidelity
    let nodesCovered: number = 0
    for (const id of jsonNodeIds) if (reconstructedNodes.has(id)) nodesCovered++
    const ghostNodes: string[] = [...reconstructedNodes].filter(n => !jsonNodeIds.has(n))

    // Edge fidelity
    let edgesCovered: number = 0
    const missingEdges: string[] = []
    for (const k of jsonEdges) {
        if (reconstructedEdges.has(k)) edgesCovered++
        else missingEdges.push(k)
    }
    const ghostEdges: string[] = [...reconstructedEdges].filter(k => !jsonEdges.has(k))

    const nodeFidelity: number = jsonNodeIds.size > 0 ? nodesCovered / jsonNodeIds.size : 1
    const edgeFidelity: number = jsonEdges.size > 0 ? edgesCovered / jsonEdges.size : 1
    // Unresolved wikilink targets in the source graph appear as edge endpoints
    // with no corresponding node entry. These legitimately produce "ghost" IDs
    // in the reconstruction — the renderer is not hallucinating. Count ghosts
    // that also appear as JSON edge targets as expected.
    const jsonEdgeTargets: Set<string> = new Set()
    for (const k of jsonEdges) jsonEdgeTargets.add(k.split('|')[1]!)
    const unexpectedGhostNodes: string[] = ghostNodes.filter(n => !jsonEdgeTargets.has(n))
    const lossless: boolean = missingEdges.length === 0 && ghostEdges.length === 0
        && unexpectedGhostNodes.length === 0 && nodesCovered === jsonNodeIds.size

    console.log('=== L3-BF-192 tree-cover roundtrip fidelity ===')
    console.log(`vault_root: ${vaultRoot}`)
    console.log()
    console.log(`| metric                        | value |`)
    console.log(`|-------------------------------|-------|`)
    console.log(`| JSON unique nodes             | ${jsonNodeIds.size} |`)
    console.log(`| Reconstructed unique nodes    | ${reconstructedNodes.size} |`)
    console.log(`| Nodes covered                 | ${nodesCovered} |`)
    console.log(`| Ghost nodes (in ASCII only)   | ${ghostNodes.length} |`)
    console.log(`| **Node fidelity**             | **${(nodeFidelity * 100).toFixed(1)}%** |`)
    console.log(`|                               |       |`)
    console.log(`| JSON edges (directed, non-self)| ${jsonEdges.size} |`)
    console.log(`| Reconstructed edges           | ${reconstructedEdges.size} |`)
    console.log(`| Edges covered                 | ${edgesCovered} |`)
    console.log(`| Missing edges                 | ${missingEdges.length} |`)
    console.log(`| Ghost edges                   | ${ghostEdges.length} |`)
    console.log(`| **Edge fidelity**             | **${(edgeFidelity * 100).toFixed(1)}%** |`)
    console.log(`|                               |       |`)
    console.log(`| Dropped parser lines          | ${parsed.droppedLines.length} |`)
    console.log()
    console.log(`LOSSLESS ROUNDTRIP: ${lossless ? 'YES ✅' : 'NO ❌'}`)
    if (ghostNodes.length > 0) {
        console.log(`  note: ${ghostNodes.length} "ghost" node IDs are unresolved wikilink targets from the source graph (${ghostNodes.length - unexpectedGhostNodes.length} match JSON edge targets → legit; ${unexpectedGhostNodes.length} unexplained).`)
    }
    if (missingEdges.length > 0 && missingEdges.length <= 10) {
        console.log('Missing edges:')
        for (const m of missingEdges) console.log(`  - ${m}`)
    } else if (missingEdges.length > 10) {
        console.log(`Missing edges (first 10 of ${missingEdges.length}):`)
        for (const m of missingEdges.slice(0, 10)) console.log(`  - ${m}`)
    }
    if (ghostEdges.length > 0 && ghostEdges.length <= 10) {
        console.log('Ghost edges:')
        for (const g of ghostEdges) console.log(`  - ${g}`)
    }
    if (ghostNodes.length > 0 && ghostNodes.length <= 10) {
        console.log('Ghost nodes:')
        for (const g of ghostNodes) console.log(`  - ${g}`)
    }
    if (parsed.droppedLines.length > 0 && parsed.droppedLines.length <= 20) {
        console.log('Dropped parser lines:')
        for (const d of parsed.droppedLines) console.log(`  - ${d}`)
    }
    process.exit(lossless ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export {parseTreeCover, extractIdFromLine}
