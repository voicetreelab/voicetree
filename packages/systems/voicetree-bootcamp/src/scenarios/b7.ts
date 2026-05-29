/**
 * B7 — knowledge gardening: bulk-create → regroup → folder-note.
 *
 * 135 Gen-3 Pokémon leaves are pre-populated at the vault root by setup(). The
 * agent walks three ordered sub-tasks:
 *   1. Register every leaf via `vt graph create` (filesystem mode).
 *   2. Regroup the leaves into ~10 thematic folders via `vt graph group`.
 *   3. Write a folder note for each folder that wikilinks every leaf inside it
 *      (the brain folder-note pattern: `<folder>/<folder>.md`).
 *
 * Each sub-task is graded independently and surfaced as a CheckpointResult.
 * The scenario `passed` is the conjunction; `detail` summarises the three.
 *
 * "Lossless" is operationalised as STRUCTURAL REACHABILITY: every leaf still
 * on disk, and every leaf wikilinked from exactly one folder note. No
 * LLM-as-judge — every check is a deterministic disk walk.
 *
 * Fixture: `fixtures/pokemon-gen3/` (135 files matching `\d{3}-[a-z0-9-]+\.md`).
 * Populated by a peer scraper agent — this scenario only consumes it.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {CheckpointResult, ScenarioSpec, SuccessResult} from '../types.ts'
import {listMarkdownFiles, parseWikilinks, stripMdExt} from './_helpers.ts'

const FIXTURE_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'fixtures',
    'pokemon-gen3',
)

const LEAF_BASENAME = /^\d{3}-[a-z0-9-]+\.md$/

const MIN_FOLDERS = 5
const MAX_FOLDERS = 15

const TASK_PROMPT = `You have a fresh VoiceTree vault containing 135 Gen-3 Pokémon notes at the
root (one markdown file per Pokémon, named like \`252-treecko.md\`). Each note
has frontmatter (\`types\`, stats, etc.) and a short body.

Your job is to organise these 135 leaves into a CONNECTED graph: every node
must be reachable from a single root via wikilinks. The leaves currently
have no edges between them — that's the starting condition. At the end the
graph must look like:

    index (root)
       ├── grass/grass         ← folder note
       │     ├── 252-treecko   ← leaves wikilinked from folder note
       │     ├── 253-grovyle
       │     └── ...
       ├── fire/fire
       │     └── ...
       └── ...

Work through these four ordered sub-tasks. They are graded independently —
finish each before moving on.

--- SUB-TASK 1: register every leaf ---

The 135 markdown files are on disk but not yet known to the graph. Run
\`vt graph create\` on every leaf so the vault index picks them up. (This is
filesystem mode — no daemon, one call per leaf.) Confirm with
\`vt graph structure\` that all 135 leaves are registered.

--- SUB-TASK 2: regroup into thematic folders ---

Group the 135 leaves into between ${MIN_FOLDERS} and ${MAX_FOLDERS} folders by a coherent
theme (Pokémon type is the obvious choice — \`grass/\`, \`fire/\`, \`water/\`,
etc., reading the \`types:\` frontmatter — but you may pick another theme if
you prefer). Use \`vt graph group <folder> <node1> <node2>...\` — it moves
the nodes and updates references atomically. Do NOT delete any leaves.

--- SUB-TASK 3: write AND REGISTER a folder note for each folder ---

For each folder you created in sub-task 2, write a folder note at
\`<folder>/<folder>.md\` (e.g. \`grass/grass.md\`). Each folder note must:
  - have frontmatter \`type: folder-note\`,
  - contain a short prose summary of what the folder holds,
  - include a \`## Contents\` section that wikilinks EVERY leaf inside the
    folder (e.g. \`- [[252-treecko]]\`).

After writing each folder note, register it with
\`vt graph create -f <folder>/<folder>.md\` so it appears as a graph node.
Do NOT rely on the file watcher — explicit registration is required.

Every leaf must be reachable from exactly one folder note.

--- SUB-TASK 4: write AND REGISTER a root index that ties the folders together ---

Write \`index.md\` at the vault root. It must:
  - have frontmatter \`type: index\`,
  - contain a \`## Folders\` section that wikilinks every folder note from
    sub-task 3 (e.g. \`- [[grass/grass]]\`, \`- [[fire/fire]]\`, ...).

Then register it: \`vt graph create -f index.md\`.

This is the root of the graph — every folder note must be one wikilink away
from \`index\`, and every leaf must be one wikilink away from its folder
note. The whole graph must be connected, with index as the entry point.

Use \`vt --help\`, \`vt graph --help\`, and \`vt manual\` whenever you need to
discover a subcommand. Report the folder list and leaf counts at the end.`

export const b7: ScenarioSpec = {
    id: 'B7',
    name: 'knowledge gardening: bulk-create + regroup + folder-note',
    async setup(vaultDir) {
        await fs.mkdir(path.join(vaultDir, '.voicetree'), {recursive: true})
        await copyDir(FIXTURE_DIR, vaultDir)
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        // Coverage is "did the agent reach for this verb at all" — outcome
        // gates live in successCriteria. Don't penalise batching: a single
        // `vt graph create` against the directory is preferable to 135
        // separate invocations, and either should clear coverage.
        {verb: 'graph create'},
        {verb: 'graph group', minCount: MIN_FOLDERS},
        {verb: 'graph structure'},
    ],
    async successCriteria(vaultDir): Promise<SuccessResult> {
        const checkpoints: readonly CheckpointResult[] = [
            await checkAllLeavesRegistered(vaultDir),
            await checkRegroupedIntoFolders(vaultDir),
            await checkFolderNoteCoverage(vaultDir),
            await checkRootIndexConnectsFolders(vaultDir),
        ]
        const allPassed = checkpoints.every((c) => c.passed)
        const passedCount = checkpoints.filter((c) => c.passed).length
        const detail = `${passedCount}/${checkpoints.length} checkpoints passed — ${checkpoints
            .map((c) => `[${c.name}: ${c.passed ? 'OK' : 'FAIL'} — ${c.detail}]`)
            .join(' ')}`
        return {passed: allPassed, detail, checkpoints}
    },
    budgets: {
        tokens: 120_000,
        toolCalls: 200,
        vtInvocations: 160,
        seconds: 600,
    },
}

/**
 * C1 — every fixture leaf is still on disk somewhere in the vault. We don't
 * require leaves at the vault root because C2 deliberately moves them; the
 * gate here is "no leaf was lost".
 */
async function checkAllLeavesRegistered(vaultDir: string): Promise<CheckpointResult> {
    const expectedLeaves = await listExpectedLeafBasenames(FIXTURE_DIR)
    const onDisk = await collectLeafBasenamesInVault(vaultDir)
    const missing = expectedLeaves.filter((name) => !onDisk.has(name))
    if (missing.length > 0) {
        return {
            name: 'C1-leaves-on-disk',
            passed: false,
            detail: `${missing.length}/${expectedLeaves.length} fixture leaves missing (first 3: ${missing.slice(0, 3).join(', ')})`,
        }
    }
    return {
        name: 'C1-leaves-on-disk',
        passed: true,
        detail: `all ${expectedLeaves.length} fixture leaves present`,
    }
}

/**
 * C2 — leaves regrouped into MIN..MAX folders, none left at vault root.
 * A "leaf folder" is any subdirectory directly containing at least one leaf
 * file. Nested layouts (grass/starter/252-treecko.md) count the deepest
 * containing directory only.
 */
async function checkRegroupedIntoFolders(vaultDir: string): Promise<CheckpointResult> {
    const leafLocations = await collectLeafLocations(vaultDir)
    const leavesAtRoot = leafLocations.filter(({relDir}) => relDir === '').length
    if (leavesAtRoot > 0) {
        return {
            name: 'C2-regrouped',
            passed: false,
            detail: `${leavesAtRoot} leaves still at vault root (expected all under subdirectories)`,
        }
    }
    const folders = new Set(leafLocations.map(({relDir}) => relDir))
    if (folders.size < MIN_FOLDERS) {
        return {
            name: 'C2-regrouped',
            passed: false,
            detail: `only ${folders.size} folders contain leaves (expected ≥${MIN_FOLDERS})`,
        }
    }
    if (folders.size > MAX_FOLDERS) {
        return {
            name: 'C2-regrouped',
            passed: false,
            detail: `${folders.size} folders contain leaves (expected ≤${MAX_FOLDERS})`,
        }
    }
    return {
        name: 'C2-regrouped',
        passed: true,
        detail: `${leafLocations.length} leaves spread across ${folders.size} folders`,
    }
}

/**
 * C3 — every leaf is wikilinked from exactly one folder note. The folder
 * note for folder F is the markdown file at `F/F.md` (basename matches dir
 * name — brain's folder-note convention).
 *
 * "Exactly one" is the operationalised meaning of lossless: every leaf has
 * a unique home in the navigable summary; no orphans, no duplicates.
 */
async function checkFolderNoteCoverage(vaultDir: string): Promise<CheckpointResult> {
    const leafLocations = await collectLeafLocations(vaultDir)
    if (leafLocations.length === 0) {
        return {name: 'C3-folder-notes', passed: false, detail: 'no leaves found to check'}
    }
    const leavesByDir = groupBy(leafLocations, ({relDir}) => relDir)

    // Build the set of folder notes — one per leaf-containing directory.
    const folderNotePaths: {readonly relDir: string; readonly absPath: string}[] = []
    for (const relDir of leavesByDir.keys()) {
        const folderBase = path.basename(relDir)
        const folderNoteAbs = path.join(vaultDir, relDir, `${folderBase}.md`)
        folderNotePaths.push({relDir, absPath: folderNoteAbs})
    }

    const missingNotes: string[] = []
    const wikilinksPerLeaf = new Map<string, number>()
    for (const leaf of leafLocations) {
        wikilinksPerLeaf.set(leaf.basenameNoExt, 0)
    }

    for (const {relDir, absPath} of folderNotePaths) {
        let raw: string
        try {
            raw = await fs.readFile(absPath, 'utf8')
        } catch {
            missingNotes.push(relDir)
            continue
        }
        const links = parseWikilinks(raw)
        for (const link of links) {
            const target = stripMdExt(link)
            if (wikilinksPerLeaf.has(target)) {
                wikilinksPerLeaf.set(target, (wikilinksPerLeaf.get(target) ?? 0) + 1)
            }
        }
    }

    if (missingNotes.length > 0) {
        return {
            name: 'C3-folder-notes',
            passed: false,
            detail: `${missingNotes.length} folder note(s) missing (e.g. ${missingNotes[0]}/${path.basename(missingNotes[0])}.md)`,
        }
    }

    const orphans: string[] = []
    const duplicates: string[] = []
    for (const [leaf, count] of wikilinksPerLeaf.entries()) {
        if (count === 0) orphans.push(leaf)
        else if (count > 1) duplicates.push(leaf)
    }
    if (orphans.length > 0) {
        return {
            name: 'C3-folder-notes',
            passed: false,
            detail: `${orphans.length} leaves unreachable from any folder note (first 3: ${orphans.slice(0, 3).join(', ')})`,
        }
    }
    if (duplicates.length > 0) {
        return {
            name: 'C3-folder-notes',
            passed: false,
            detail: `${duplicates.length} leaves wikilinked from multiple folder notes (first 3: ${duplicates.slice(0, 3).join(', ')})`,
        }
    }
    return {
        name: 'C3-folder-notes',
        passed: true,
        detail: `${wikilinksPerLeaf.size} leaves each wikilinked from exactly one folder note`,
    }
}

/**
 * C4 — every folder note is wikilinked from a single root `index.md` at the
 * vault root. This is the "graph is connected" gate: after C3 confirms each
 * leaf has an edge to its folder note, C4 confirms each folder note has an
 * edge back to a common root, so every node in the graph is reachable from
 * `index`.
 *
 * We resolve folder-note targets relative to the index's directory (the
 * vault root), so links written as `grass/grass`, `grass/grass.md`,
 * or `[[grass/grass|Grass]]` all match. Anchors and aliases are already
 * stripped by `parseWikilinks`.
 */
async function checkRootIndexConnectsFolders(vaultDir: string): Promise<CheckpointResult> {
    const indexPath = path.join(vaultDir, 'index.md')
    let raw: string
    try {
        raw = await fs.readFile(indexPath, 'utf8')
    } catch {
        return {
            name: 'C4-root-index',
            passed: false,
            detail: 'index.md is missing at the vault root',
        }
    }

    const leafLocations = await collectLeafLocations(vaultDir)
    const leafDirs = new Set(leafLocations.map(({relDir}) => relDir).filter((d) => d.length > 0))
    if (leafDirs.size === 0) {
        return {
            name: 'C4-root-index',
            passed: false,
            detail: 'no leaf folders to connect (sub-task 2 incomplete)',
        }
    }

    const expectedTargets = new Set<string>()
    for (const relDir of leafDirs) {
        const base = path.basename(relDir)
        expectedTargets.add(path.posix.join(relDir, base))
    }

    const linkedTargets = new Set<string>()
    for (const link of parseWikilinks(raw)) {
        linkedTargets.add(stripMdExt(link))
    }

    const missing: string[] = []
    for (const target of expectedTargets) {
        if (!linkedTargets.has(target)) missing.push(target)
    }

    if (missing.length > 0) {
        return {
            name: 'C4-root-index',
            passed: false,
            detail: `index.md missing wikilinks to ${missing.length}/${expectedTargets.size} folder note(s) (first 3: ${missing.slice(0, 3).join(', ')})`,
        }
    }

    return {
        name: 'C4-root-index',
        passed: true,
        detail: `index.md wikilinks all ${expectedTargets.size} folder notes`,
    }
}

async function listExpectedLeafBasenames(fixtureDir: string): Promise<readonly string[]> {
    const entries = await fs.readdir(fixtureDir, {withFileTypes: true})
    return entries
        .filter((e) => e.isFile() && LEAF_BASENAME.test(e.name))
        .map((e) => e.name)
        .sort()
}

async function collectLeafBasenamesInVault(vaultDir: string): Promise<ReadonlySet<string>> {
    const all = await listMarkdownFiles(vaultDir)
    return new Set(all.map((p) => path.basename(p)).filter((b) => LEAF_BASENAME.test(b)))
}

type LeafLocation = {
    readonly absPath: string
    readonly relDir: string
    readonly basenameNoExt: string
}

async function collectLeafLocations(vaultDir: string): Promise<readonly LeafLocation[]> {
    const all = await listMarkdownFiles(vaultDir)
    return all
        .filter((p) => LEAF_BASENAME.test(path.basename(p)))
        .map((absPath) => ({
            absPath,
            relDir: path.relative(vaultDir, path.dirname(absPath)),
            basenameNoExt: path.basename(absPath, '.md'),
        }))
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, readonly T[]> {
    const out = new Map<K, T[]>()
    for (const item of items) {
        const k = key(item)
        const arr = out.get(k) ?? []
        arr.push(item)
        out.set(k, arr)
    }
    return out as Map<K, readonly T[]>
}


async function copyDir(src: string, dst: string): Promise<void> {
    await fs.mkdir(dst, {recursive: true})
    const entries = await fs.readdir(src, {withFileTypes: true})
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name)
        const dstPath = path.join(dst, entry.name)
        if (entry.isDirectory()) {
            await copyDir(srcPath, dstPath)
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, dstPath)
        }
    }
}
