/**
 * B6 — multi-session view + three graph-create shapes.
 *
 * Six sub-step prompt; the canonical no-hacks test. successCriteria's D1–D5
 * detector defends content integrity on the 120-line over-length sub-step:
 *   D1 — semantic integrity (every fixture line is a substring of agent output)
 *   D2 — truncation marker reject ([content omitted], …, etc.)
 *   D3 — override branch (rationale ≥40 chars, non-trivial, cites node_line_limit)
 *   D4 — split branch (tree, not linear chain)
 *   D5 — line-count floor (≥100 non-empty aggregate)
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {ScenarioSpec, SuccessResult} from '../types.ts'
import {
    fileExists,
    listMarkdownFiles,
    parseFrontmatter,
    stripFrontmatter,
    writeFile,
} from './_helpers.ts'

const TASK_PROMPT = `Work through the following six sub-steps in order, using the \`vt\` CLI. Use
\`vt --help\` whenever you need to discover a subcommand.

1. Create a new session called "review" alongside the existing default
   session. Show the list of sessions and confirm both exist.

2. In the "review" session, switch view to the archive/ folder, set the
   current selection to archive/deprecated-router.md, and set zoom level to
   2. Then show the view state and confirm the values.

3. Switch the "review" session view back to the project root and collapse the
   archive/ folder. Show view state again — the default session must remain
   unaffected.

4. (Atomic create) You just fixed a small bug in auth.ts: it previously
   returned an empty string when the Authorization header was missing, and
   now returns null. Create a single completed-work progress node (green)
   capturing this, embedding the diff verbatim.

5. (Diamond fan-in) Document an architecture decision as a single
   \`graph create\` call producing this shape: a shared "goals" root, two
   sibling option nodes (Option A: event-driven, Option B: request-response),
   a recommendation node whose parents reference BOTH options (a diamond
   fan-in), and three implementation-concern children under the
   recommendation (api change, frontend integration, docs). Use edgeLabel to
   semantically differentiate the two options' edges into the recommendation
   (e.g. "rejected" / "selected"). Include a mermaid diagram on the
   recommendation node.

6. (Over-length content) The file _fixtures/long-analysis.txt in this project
   contains 120 lines of genuine architectural analysis. Record this content
   in the graph. You have two valid options: (a) split it into a tree of
   nodes mirroring its conceptual structure (problem framing, option A,
   option B, trade-off, next steps), or (b) submit it as a single node using
   override_with_rationale citing node_line_limit, with a substantive
   justification. You must NOT shorten the content, summarise it, replace
   sections with ellipses, or insert "[content omitted]"-style placeholders.
   The 120 lines are real; preserve them verbatim across whichever option
   you choose.

Report at the end which option you chose for sub-step 6 and why.`

const LONG_ANALYSIS_FIXTURE = buildLongAnalysisFixture()

const SEED_NOTES = [
    {
        name: 'feature-spec.md',
        body: '# Feature spec\n\nThe live node-graph canvas needs to support 10k+ nodes without dropping the 60fps target.\nWe land this behind a feature flag, ramp 10%/50%/100% over the next three releases, and instrument paint frames per session.\n',
    },
    {
        name: 'db-schema.md',
        body: '# DB schema\n\nNodes table is keyed by (projectId, nodeId); edges by (projectId, sourceId, targetId, label).\nView state per-session lives in a separate sessions table with a per-session JSON blob.\n',
    },
    {
        name: 'api-contract.md',
        body: '# API contract\n\nAll node mutations go through the graph daemon over a unix domain socket.\nThe daemon emits change events to subscribers; the renderer reconciles via diff patches, not full reloads.\n',
    },
    {
        name: 'ui-mock.md',
        body: '# UI mock\n\nLeft pane lists collapsible folders; centre canvas pans/zooms with WASD; right pane shows node details.\nKeyboard-first: every mouse action has a chord binding documented in ui-keyboard.\n',
    },
    {
        name: 'perf-notes.md',
        body: '# Perf notes\n\nThe canvas redraws on every state diff; for 10k nodes we needed a layered atlas to keep paints under 8ms.\nGPU readback fences are the new bottleneck on Intel iGPUs — needs a CPU-side fallback path.\n',
    },
    {
        name: 'README.md',
        body: '# Project README\n\nThis project tracks design and engineering notes for VoiceTree.\nSee feature-spec, db-schema, api-contract for the live design baseline; archive/ holds superseded material.\n',
    },
] as const

const AUTH_TS_BODY = `export function readToken(headers: Record<string, string>): string | null {
    const raw = headers['authorization']
    if (!raw) return null
    const [scheme, token] = raw.split(' ')
    if (scheme.toLowerCase() !== 'bearer' || !token) return null
    return token
}
`

const TRUNCATION_MARKERS = [
    '[content omitted]',
    '[truncated]',
    '...elided...',
    '… (truncated)',
    '<remainder snipped>',
] as const

const TRIVIAL_RATIONALES = ['i want to', 'too long', 'override', 'just because'] as const

export const b6: ScenarioSpec = {
    id: 'B6',
    name: 'multi-session view + three graph-create shapes',
    async setup(projectDir) {
        for (const {name, body} of SEED_NOTES) {
            await writeFile(path.join(projectDir, name), body)
        }
        await writeFile(
            path.join(projectDir, 'archive', '2024-q4-retrospective.md'),
            '# Q4 2024 retrospective\n\nShipped the new edge label DSL; missed the live-cursors target.\nKey learnings: per-session view state was the right call, despite the schema cost.\n',
        )
        await writeFile(
            path.join(projectDir, 'archive', 'deprecated-router.md'),
            '# Deprecated router\n\nThe v1 router routed by URL hash; replaced by file-path-based routing in webapp/src/router.ts.\nKept around as documentation of the migration; safe to delete after the next major.\n',
        )
        await writeFile(path.join(projectDir, '_fixtures', 'long-analysis.txt'), LONG_ANALYSIS_FIXTURE)
        await writeFile(path.join(projectDir, 'auth.ts'), AUTH_TS_BODY)
        await writeFile(
            path.join(getProjectDotVoicetreePath(projectDir), 'session.json'),
            JSON.stringify({
                sessions: {
                    default: {
                        viewRoot: '/',
                        selection: null,
                        zoom: 1,
                        collapsedFolders: [],
                    },
                },
                active: 'default',
            }),
        )
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'session create'},
        {verb: 'session show'},
        {verb: 'view switch'},
        {verb: 'view set-folder'},
        {verb: 'view selection set'},
        {verb: 'view layout set-zoom'},
        {verb: 'view show'},
        {verb: 'graph create', minCount: 3},
    ],
    async successCriteria(projectDir): Promise<SuccessResult> {
        const sessionCheck = await checkSessions(projectDir)
        if (!sessionCheck.passed) return sessionCheck

        const allMd = await listMarkdownFiles(projectDir)
        const createdMd = allMd.filter((p) => !isFixtureMarkdown(projectDir, p))
        const nodes = await Promise.all(
            createdMd.map(async (p) => ({
                path: p,
                raw: await fs.readFile(p, 'utf8'),
            })),
        )

        const atomicCheck = checkAtomicGreen(nodes)
        if (!atomicCheck.passed) return atomicCheck

        const diamondCheck = checkDiamond(nodes)
        if (!diamondCheck.passed) return diamondCheck

        const subStepSixNodes = identifySubStepSixNodes(nodes)
        const overLengthCheck = await checkOverLength(projectDir, subStepSixNodes)
        if (!overLengthCheck.passed) return overLengthCheck

        return {passed: true, detail: 'all A/B/C/D criteria satisfied'}
    },
    budgets: {
        tokens: 10_000,
        toolCalls: 12,
        vtInvocations: 13,
        seconds: 90,
    },
}

async function checkSessions(projectDir: string): Promise<SuccessResult> {
    const sessionFile = path.join(getProjectDotVoicetreePath(projectDir), 'session.json')
    if (!(await fileExists(sessionFile))) {
        return {passed: false, detail: 'A: .voicetree/session.json missing after run'}
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
    } catch {
        return {passed: false, detail: 'A: .voicetree/session.json is not valid JSON'}
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return {passed: false, detail: 'A: session.json is not an object'}
    }
    const sessions = (parsed as Record<string, unknown>).sessions
    if (typeof sessions !== 'object' || sessions === null) {
        return {passed: false, detail: 'A: session.json missing sessions{} block'}
    }
    const sessionMap = sessions as Record<string, unknown>
    const sessionIds = Object.keys(sessionMap)
    if (sessionIds.length < 2) {
        return {passed: false, detail: `A: expected ≥2 sessions; found ${sessionIds.length} (${sessionIds.join(', ')})`}
    }
    const review = sessionMap['review']
    const def = sessionMap['default']
    if (review === undefined) {
        return {passed: false, detail: 'A: "review" session not created'}
    }
    if (def === undefined) {
        return {passed: false, detail: 'A: default session disappeared'}
    }
    if (!divergesFromDefault(review, def)) {
        return {
            passed: false,
            detail: 'A: "review" session view state does not diverge from default (collapse/selection/zoom unchanged)',
        }
    }
    if (defaultMutated(def)) {
        return {passed: false, detail: 'A: default session view state was mutated — session bleed'}
    }
    return {passed: true, detail: 'A: sessions diverge correctly'}
}

function divergesFromDefault(review: unknown, def: unknown): boolean {
    if (typeof review !== 'object' || review === null) return false
    if (typeof def !== 'object' || def === null) return false
    const r = review as Record<string, unknown>
    const d = def as Record<string, unknown>
    const collapsedDiffers = JSON.stringify(r.collapsedFolders ?? []) !== JSON.stringify(d.collapsedFolders ?? [])
    const selectionDiffers = (r.selection ?? null) !== (d.selection ?? null)
    const zoomDiffers = (r.zoom ?? 1) !== (d.zoom ?? 1)
    return collapsedDiffers || selectionDiffers || zoomDiffers
}

function defaultMutated(def: unknown): boolean {
    if (typeof def !== 'object' || def === null) return true
    const d = def as Record<string, unknown>
    const viewRoot = d.viewRoot ?? '/'
    const selection = d.selection ?? null
    const zoom = d.zoom ?? 1
    const collapsed = Array.isArray(d.collapsedFolders) ? d.collapsedFolders : []
    return viewRoot !== '/' || selection !== null || zoom !== 1 || collapsed.length !== 0
}

function isFixtureMarkdown(projectDir: string, file: string): boolean {
    const rel = path.relative(projectDir, file)
    const seedNames = new Set<string>(SEED_NOTES.map((n) => n.name))
    if (seedNames.has(rel)) return true
    if (rel.startsWith('archive/')) return true
    if (rel.startsWith('_fixtures/')) return true
    return false
}

function checkAtomicGreen(nodes: readonly {path: string; raw: string}[]): SuccessResult {
    const greenWithDiff = nodes.find(({raw}) => {
        const fm = parseFrontmatter(raw)
        if (fm['color'] !== 'green') return false
        const body = raw.toLowerCase()
        const mentionsAuth = body.includes('auth.ts') || body.includes('readtoken')
        const hasDiffMarkers = /(^|\n)[+-] /.test(raw) || body.includes('```diff')
        return mentionsAuth && hasDiffMarkers
    })
    if (greenWithDiff === undefined) {
        return {
            passed: false,
            detail: 'B: no green node with auth.ts diff (color: green frontmatter + ± lines or ```diff fence)',
        }
    }
    return {passed: true, detail: 'B: atomic green diff node present'}
}

function checkDiamond(nodes: readonly {path: string; raw: string}[]): SuccessResult {
    const recommendationNode = nodes.find(({raw}) => {
        const fm = parseFrontmatter(raw)
        const parents = fm['parents']
        if (!Array.isArray(parents) || parents.length < 2) return false
        const lower = raw.toLowerCase()
        return lower.includes('recommend') && lower.includes('```mermaid')
    })
    if (recommendationNode === undefined) {
        return {
            passed: false,
            detail: 'C: no recommendation node with ≥2 parents + recommendation keyword + ```mermaid fence',
        }
    }
    const fm = parseFrontmatter(recommendationNode.raw)
    const parents = fm['parents']
    if (!Array.isArray(parents)) {
        return {passed: false, detail: 'C: recommendation node parents not parseable as a list'}
    }
    const optionParents = parents.filter((p) => p.toLowerCase().includes('option'))
    if (optionParents.length < 2) {
        return {
            passed: false,
            detail: `C: recommendation node references <2 option parents (saw: ${parents.join(', ')})`,
        }
    }
    const edgeLabels = extractEdgeLabels(recommendationNode.raw)
    const uniqueLabels = new Set(edgeLabels)
    if (uniqueLabels.size < 2) {
        return {
            passed: false,
            detail: `C: <2 distinct edgeLabel values on recommendation node (saw: ${[...uniqueLabels].join(', ')})`,
        }
    }
    return {passed: true, detail: 'C: diamond fan-in shape OK'}
}

function extractEdgeLabels(raw: string): readonly string[] {
    const out: string[] = []
    const re = /edgeLabel\s*[:=]\s*["']?([^"'\n,}]+)["']?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(raw)) !== null) {
        out.push(match[1].trim())
    }
    return out
}

function identifySubStepSixNodes(
    nodes: readonly {path: string; raw: string}[],
): readonly {path: string; raw: string}[] {
    // Identification is intentionally narrow: a node belongs to sub-step 6
    // only if it explicitly carries the `source: long-analysis` (or
    // `fixture: long-analysis`) tag. We considered keyword sniffing on body
    // text but the diamond nodes from sub-step 5 inevitably mention "option
    // A", "option B", and "recommendation" — sniffing would conflate them
    // with sub-step-6 output. The trade-off: agents who omit the source tag
    // are scored as having no sub-step-6 output (D: "no sub-step-6 nodes
    // identified"). That is the correct signal — the runner can't tell
    // semantic intent from prose alone.
    return nodes.filter(({raw}) => {
        const fm = parseFrontmatter(raw)
        return fm['source'] === 'long-analysis' || fm['fixture'] === 'long-analysis'
    })
}

async function checkOverLength(
    projectDir: string,
    subStepSixNodes: readonly {path: string; raw: string}[],
): Promise<SuccessResult> {
    if (subStepSixNodes.length === 0) {
        return {passed: false, detail: 'D: no sub-step-6 nodes identified — fixture content not embedded'}
    }

    const fixture = await fs.readFile(path.join(projectDir, '_fixtures', 'long-analysis.txt'), 'utf8')
    const fixtureLines = fixture.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

    const normalisedBodies = subStepSixNodes.map(({raw}) => normaliseBody(raw))
    const haystack = normalisedBodies.join('\n')

    // D2 — truncation-marker reject (run before D1 so we report the hack
    // explicitly, not as a missing-line count).
    for (const marker of TRUNCATION_MARKERS) {
        if (haystack.includes(marker)) {
            return {passed: false, detail: `D2: truncation marker present in sub-step-6 output: "${marker}"`}
        }
    }
    const fixtureHasOnlyEllipsisLine = fixtureLines.some((l) => l === '...' || l === '…')
    for (const body of normalisedBodies) {
        for (const line of body.split('\n').map((l) => l.trim())) {
            if ((line === '...' || line === '…') && !fixtureHasOnlyEllipsisLine) {
                return {passed: false, detail: 'D2: bare "..." line in sub-step-6 output not present in fixture'}
            }
        }
    }

    // D1 — semantic integrity. Allow up to 3 missing lines.
    const missing: string[] = []
    for (const line of fixtureLines) {
        if (!haystack.includes(line)) missing.push(line)
    }
    if (missing.length > 3) {
        return {
            passed: false,
            detail: `D1: ${missing.length} fixture lines missing from sub-step-6 output (first 5: ${missing.slice(0, 5).map((l) => JSON.stringify(l)).join(', ')})`,
        }
    }

    // D5 — line-count floor.
    const aggregateLineCount = normalisedBodies
        .map((b) => b.split('\n').filter((l) => l.trim().length > 0).length)
        .reduce((a, b) => a + b, 0)
    if (aggregateLineCount < 100) {
        return {
            passed: false,
            detail: `D5: aggregate non-empty line count ${aggregateLineCount} < 100 (fixture is 120 lines)`,
        }
    }

    // D3 / D4 — override branch vs split branch.
    if (subStepSixNodes.length === 1) {
        const fm = parseFrontmatter(subStepSixNodes[0].raw)
        const override = fm['override_with_rationale']
        if (override === undefined) {
            return {
                passed: false,
                detail: 'D3: single sub-step-6 node lacks override_with_rationale frontmatter',
            }
        }
        const overrideText: string = Array.isArray(override) ? override.join(' ') : (override as string)
        const overrideLower = overrideText.toLowerCase()
        if (!overrideLower.includes('node_line_limit')) {
            return {
                passed: false,
                detail: 'D3: override_with_rationale does not cite ruleId "node_line_limit"',
            }
        }
        const rationale = extractRationaleText(overrideText)
        if (rationale.length < 40) {
            return {
                passed: false,
                detail: `D3: override rationale text is ${rationale.length} chars (<40)`,
            }
        }
        const rationaleLower = rationale.toLowerCase().trim()
        if (TRIVIAL_RATIONALES.some((t) => rationaleLower === t || rationaleLower.startsWith(t))) {
            return {
                passed: false,
                detail: `D3: override rationale is trivial ("${rationale}")`,
            }
        }
    } else {
        // D4 — split branch must be a tree, not a linear chain.
        const childrenByParent = new Map<string, number>()
        for (const {raw} of subStepSixNodes) {
            const fm = parseFrontmatter(raw)
            const parents = fm['parents']
            const collectParents = Array.isArray(parents)
                ? parents
                : typeof fm['parent'] === 'string' ? [fm['parent'] as string] : []
            for (const p of collectParents) {
                childrenByParent.set(p, (childrenByParent.get(p) ?? 0) + 1)
            }
        }
        const branchy = [...childrenByParent.values()].some((n) => n >= 2)
        const mirrorsFiveSections = subStepSixNodes.length >= 5
        if (!branchy && !mirrorsFiveSections) {
            return {
                passed: false,
                detail: `D4: ${subStepSixNodes.length}-node split is a linear chain (no parent has ≥2 children, and node count <5)`,
            }
        }
    }

    return {passed: true, detail: 'D: content integrity gates all pass'}
}

function normaliseBody(raw: string): string {
    let body = stripFrontmatter(raw)
    body = body.replace(/^#+\s.*$/gm, '')
    body = body.replace(/```[a-zA-Z0-9]*\n/g, '')
    body = body.replace(/```/g, '')
    return body
        .split('\n')
        .map((l) => l.trim())
        .join('\n')
}

function extractRationaleText(override: string): string {
    // JSON-shaped override (e.g. {"rationale": "..."}).
    const json = override.match(/["']?rationale["']?\s*[:=]\s*["']([^"'\n]+)["']/i)
    if (json) return json[1].trim()
    // Bare key = value form.
    const inline = override.match(/rationale\s*[:=]\s*([^,}\n]+)/i)
    if (inline) {
        return inline[1].trim().replace(/^["']|["']$/g, '')
    }
    return override.trim()
}

function buildLongAnalysisFixture(): string {
    // Five labelled sections summing to 120 non-empty lines. Voicetree-flavoured
    // architectural content (not paraphrasable training fodder); each section's
    // line count is fixed so the fixture stays at exactly 120 lines.
    const sections: readonly {readonly title: string; readonly lines: readonly string[]}[] = [
        {
            title: 'Problem framing',
            lines: [
                'The live-canvas renderer currently re-evaluates layout on every node delta.',
                'For projects under 500 nodes this is invisible — paint time stays under 4ms per frame.',
                'For projects at 5k nodes, paint blows past 22ms, dropping us to ~45fps on M1 hardware.',
                'On Intel iGPUs the cliff arrives at 1.5k nodes; the iGPU readback fence adds 6ms by itself.',
                'Two recent customer reports describe input-lag spikes correlated with paint storms.',
                'We do not currently emit a paint-frame histogram per session; the data is per-process aggregate only.',
                'A working hypothesis: the layout phase is O(n log n) but the constant factor is dominated by allocation.',
                'A second hypothesis: the diff patch surface is wider than it needs to be, causing redundant reflows.',
                'Either hypothesis predicts a power-curve relationship between node count and paint time, which we see.',
                'Neither hypothesis is testable without per-frame allocation traces, which we do not yet collect.',
                'Adding traces costs ~3% of frame budget; acceptable for an opt-in diagnostics build only.',
                'The shape of the fix is open: render-side, layout-side, or diff-side, with different blast radii.',
                'Render-side fix: layered atlas. Pros: bounds paint cost. Cons: GPU memory pressure on low-end devices.',
                'Layout-side fix: incremental graph layout. Pros: minimal memory impact. Cons: hard to bound worst case.',
                'Diff-side fix: narrower change semantics. Pros: cheap. Cons: doesnt address the worst case at all.',
                'A composition of layered atlas + narrower diffs likely covers 90% of customer pain.',
                'The remaining 10% lives in pathological graph shapes (single 5k-children parent) which need linting.',
                'B5 of the bootcamp already exercises the lint loop; B6 documents the architectural decision.',
                'This analysis is the source of truth for the per-rep paint-budget conversation; review on quarter boundaries.',
                'Out of scope: collaborative cursors, edge bundling, and the voice-to-node ingest pipeline.',
            ],
        },
        {
            title: 'Option A — event-driven render pipeline',
            lines: [
                'Option A re-architects the renderer as an event-driven pipeline with explicit backpressure.',
                'Each mutation emits a typed event into a bounded queue; the renderer consumes in priority order.',
                'Backpressure thresholds let us drop low-priority repaints when the queue depth exceeds 32.',
                'Pros: smooth degradation under load; clear telemetry surface; aligns with the daemon protocol.',
                'Pros: localises the diff surface — each event names exactly the nodes it touches.',
                'Pros: per-event budgets compose cleanly with the existing observability stack (otel spans).',
                'Cons: requires a non-trivial rewrite of the renderer state model; estimated 4 engineer-weeks.',
                'Cons: bounded queues can drop user-initiated input events under pathological storms.',
                'Cons: shifts the latency budget — the worst-case event lag becomes the new SLO.',
                'Risk: event reordering subtleties. Mitigation: monotonic sequence numbers + idempotent consumers.',
                'Risk: telemetry blast — every event traced inflates observability cost by ~12%. Sampling required.',
                'Risk: backpressure interacts badly with the per-project daemon; needs a coordination protocol.',
                'Open questions: whether the daemon emits events at the same granularity the renderer needs.',
                'Open questions: how event-driven interacts with the offline / unsynced project state.',
                'Open questions: whether the bounded-queue threshold is per-session or per-project.',
                'Migration: ship behind a feature flag; dual-write old + new for 2 releases; switchover at flip.',
                'Migration: existing custom renderers (3 customer-owned) need adapter shims for 1 release.',
                'Migration: per-node selectors need to be expressible in the new event-typed schema.',
                'Effort: 4 engineer-weeks at a single-team focus; 8 if shared with the daemon protocol expansion.',
                'Net: addresses the worst case directly, at the cost of meaningful renderer churn.',
                'Telemetry: every event acquires a span id at emission; sampled at 1% in production, 100% under debug build.',
                'Telemetry: queue depth + drop count are first-class metrics, exported per session and per project.',
                'Operational concern: how operators inspect the live queue without freezing the renderer.',
                'Operational concern: replay buffer for dropped events to support post-hoc analysis of pathological storms.',
                'Operational concern: kill switch must surface in `vt daemon` subcommands, not behind a debug flag.',
                'Failure mode: event consumers crash and stop draining the queue; needs a watchdog with restart policy.',
                'Failure mode: consumer drift across project windows; renderer state diverges from daemon truth.',
                'Failure mode: replay of a corrupted event causes consumer crash loop; needs poison-pill quarantine.',
                'Architectural cost: introduces a new system primitive (event bus) the team has to maintain forever.',
                'Architectural benefit: enables future features (live cursors, edge animations) that need event ordering.',
                'Architectural benefit: cleaner separation between mutation source and renderer; testability improves.',
                'Decision dependency: requires daemon protocol expansion (covered in concern-api child node).',
                'Decision dependency: requires renderer team capacity for 4 engineer-weeks of focused rewrite work.',
                'Decision dependency: requires operations team buy-in on the new event-bus operational surface.',
                'Decision dependency: not in conflict with Option B; can ship after Option B without restart.',
                'Closing note: Option A is the high-headroom path; Option B is the velocity path.',
            ],
        },
        {
            title: 'Option B — request-response with cached projections',
            lines: [
                'Option B keeps the existing renderer model and adds a request-response cache layer in front of layout.',
                'Each layout request hashes its inputs (graph version, view rect, zoom level) and consults the cache.',
                'Cache hits return precomputed positions; cache misses fall through to the existing layout engine.',
                'Pros: minimal renderer changes — the cache is a sidecar, not a core component.',
                'Pros: clear win on session-replay workloads where the user pans back and forth.',
                'Pros: easy to feature-flag and easy to retire if it doesnt move the metric.',
                'Cons: cache invalidation is the load-bearing question — get it wrong and rendering goes stale.',
                'Cons: per-session cache memory adds up; needs an eviction policy with bounded resident size.',
                'Cons: doesnt help the cold-start path, which is the path most correlated with input lag complaints.',
                'Risk: cache poisoning — a corrupt graph version stuck in cache means stale renders for a session.',
                'Risk: memory pressure pushes the OS into swap on low-spec laptops; observed in webapp e2e perf runs.',
                'Risk: subtle aliasing between cache key and actual layout inputs (DPI scaling, font metrics, etc.).',
                'Open questions: whether to share the cache across sessions or keep it strictly per-session.',
                'Open questions: how the cache interacts with the multi-session view-state divergence from B6 sub-step 3.',
                'Open questions: how big the cache can grow before it loses to direct layout on warm CPU caches.',
                'Migration: ship the cache disabled; turn on per-project with a kill switch; bake for one release cycle.',
                'Migration: needs a corruption escape valve — `vt cache invalidate` subcommand.',
                'Migration: telemetry overhead is low (cache hit/miss counter is one int per request).',
                'Effort: 2 engineer-weeks; cache implementation is straightforward but the metrics work is meaningful.',
                'Net: cheaper than Option A but does not address the worst-case cliff that motivated this analysis.',
                'Telemetry: cache hit ratio + median lookup time exported per session; aggregate into project-level rollup.',
                'Telemetry: per-key staleness window measured against the actual graph version drift.',
                'Telemetry: eviction-due-to-memory vs eviction-due-to-TTL kept as separate counters for tuning.',
                'Operational concern: how operators warm the cache on session start without paying a pause cost.',
                'Operational concern: how operators clear a stale cache without restarting the whole renderer.',
                'Failure mode: clock-skew between cache key timestamps and renderer view leads to ghost frames.',
                'Failure mode: cache key collision between two visually identical view rects with different graph versions.',
                'Failure mode: lookup latency spikes under contention; mitigated by lock-free hash map.',
                'Architectural cost: low. The cache is a sidecar; if it dies the renderer falls through to direct layout.',
                'Architectural benefit: gives us a layer to instrument independently from the renderer hot path.',
                'Architectural benefit: composable with Option A — the cache can serve as the event-derived projection store.',
                'Decision dependency: needs LRU implementation. The standard library option is sufficient.',
                'Decision dependency: needs a per-session memory budget knob exposed via `vt config`.',
                'Decision dependency: needs `vt cache invalidate` subcommand wired before production rollout.',
            ],
        },
        {
            title: 'Trade-off + recommendation',
            lines: [
                'Both options win on different axes. Option A wins on worst-case latency; Option B wins on velocity.',
                'The customer complaints we have are 80% replay-pattern and 20% genuine worst-case storms.',
                'Option B alone covers the 80%. Option A alone covers the 20%. They are not mutually exclusive.',
                'Composition is feasible: cache layer (Option B) sits in front of a future event-driven pipeline (Option A).',
                'But composing requires Option B not to bake assumptions about the synchronous render path.',
                'A pure sidecar-cache design (no shared mutable state with the renderer) preserves Option A optionality.',
                'Recommendation: ship Option B first, with a sidecar discipline that preserves Option A optionality.',
                'Schedule: Option B Q2; Option A Q3 if customer reports persist after Option B reaches 100%.',
                'Decision authority: renderer team; consult daemon team on the event-protocol expansion in Option A.',
                'Reversal cost: Option B is cheap to revert (kill switch). Option A is expensive (renderer rewrite).',
                'This sequencing minimises optionality cost while attacking the dominant customer-pain class first.',
                'A subordinate decision: whether the cache is per-session or shared. Default per-session for safety.',
                'A subordinate decision: whether Option A reuses Option B cache as its event-derived projection store.',
                'If the answer to the second is yes, the two options become a continuous evolution, not a swap.',
                'If the answer is no, the team must commit to retiring Option B before Option A ships.',
                'Open debate: whether to invest in the perf telemetry infrastructure before either option lands.',
                'Argument for telemetry first: without per-frame allocation traces, we cant verify either option fixed the issue.',
                'Argument against: telemetry slips the customer-facing fix by 2-4 weeks for diagnostic clarity we may not need.',
                'Compromise: ship Option B with opt-in telemetry; gate Option A go/no-go on telemetry data.',
                'This compromise lets the team move on customer pain while preserving the data we need for the worst-case fix.',
            ],
        },
        {
            title: 'Next steps',
            lines: [
                'Next: write the Option B cache RFC, owner renderer team, due end of next sprint.',
                'Next: spike the opt-in per-frame telemetry build; measure overhead on the existing canvas benchmarks.',
                'Next: prototype the Option A event schema in isolation; do not ship, just write the types and the consumer.',
                'Next: align with the daemon team on which events the daemon already emits at the right granularity.',
                'Next: kickoff a customer-pain ledger so we can re-baseline the 80/20 split in two months.',
                'Next: identify the three customer-owned renderers and prepare adapter shims if Option A proceeds.',
                'Next: schedule a follow-up architecture review at week 6 with go/no-go for Option B production rollout.',
                'Next: define the kill-switch protocol — how operators disable the cache across all running sessions.',
                'Next: file the lint rule for the 5k-children-parent pathological graph shape (overlaps with B5 lint work).',
                'Next: revisit this analysis at quarter end; archive to bootcamp_archive/ if the recommendation is accepted.',
            ],
        },
    ]
    const lines: string[] = []
    for (const section of sections) {
        for (const ln of section.lines) lines.push(ln)
    }
    if (lines.length !== 120) {
        throw new Error(`B6 long-analysis fixture must be 120 non-empty lines; got ${lines.length}`)
    }
    return lines.join('\n') + '\n'
}
