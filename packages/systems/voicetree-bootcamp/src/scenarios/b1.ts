/**
 * B1 — cold-start with daemon recovery.
 *
 * Cooldown breadcrumb parks the daemon; agent must clear it, then build a
 * 3-node espresso tree and print the structure.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {ScenarioSpec, SuccessResult} from '../types.ts'
import {fileExists, listMarkdownFiles, parseFrontmatter, parseWikilinks, stripMdExt, writeFile} from './_helpers.ts'

const COOLDOWN_FILENAME = 'graphd.cooldown.json'

const TASK_PROMPT = `You have a fresh VoiceTree project in this directory. Your first attempt to use
the project will likely fail because the previous session left it in a bad
state. Diagnose what is wrong, clear it, and then capture three short notes
about dialing in espresso: one about grind size, one about dose, one about
extraction time. The three notes should form a small tree (a parent and two
children, or a root with two siblings — your choice). When you are done,
print the resulting structure so I can see it.

Use \`vt --help\` to discover the CLI surface.`

const ESPRESSO_KEYWORDS = ['grind', 'dose', 'extraction'] as const

export const b1: ScenarioSpec = {
    id: 'B1',
    name: 'cold-start with daemon recovery',
    async setup(projectDir) {
        const cooldownPath = path.join(getProjectDotVoicetreePath(projectDir), COOLDOWN_FILENAME)
        await writeFile(
            cooldownPath,
            JSON.stringify({
                untilMs: Date.now() + 300_000,
                reason: 'previous spawn failed (synthetic)',
            }),
        )
        await writeFile(
            path.join(projectDir, 'README.md'),
            '# Espresso notes\n\nFresh project. Plan to capture how I dial in espresso.\n',
        )
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'serve'},
        {verb: 'project show'},
        {verb: 'graph create'},
        {verb: 'graph structure'},
    ],
    async successCriteria(projectDir): Promise<SuccessResult> {
        const cooldownExists = await fileExists(path.join(getProjectDotVoicetreePath(projectDir), COOLDOWN_FILENAME))
        if (cooldownExists) {
            return {passed: false, detail: 'cooldown breadcrumb still present at .voicetree/graphd.cooldown.json'}
        }

        const allMd = await listMarkdownFiles(projectDir)
        const notes = allMd.filter((p) => path.basename(p).toLowerCase() !== 'readme.md')
        if (notes.length < 3) {
            return {
                passed: false,
                detail: `expected ≥3 espresso notes (excluding README.md); found ${notes.length}`,
            }
        }

        const noteContents = await Promise.all(
            notes.map(async (p) => ({path: p, raw: await fs.readFile(p, 'utf8')})),
        )
        const keywordHits = noteContents.filter(({raw}) => {
            const lower = raw.toLowerCase()
            return ESPRESSO_KEYWORDS.some((kw) => lower.includes(kw))
        })
        if (keywordHits.length < 3) {
            return {
                passed: false,
                detail: `expected ≥3 notes mentioning {grind|dose|extraction}; found ${keywordHits.length}`,
            }
        }

        const edgeCount = countEdgesAmongNotes(noteContents)
        if (edgeCount < 2) {
            return {
                passed: false,
                detail: `expected ≥2 edges between espresso notes (via parent: frontmatter or [[wikilinks]]); found ${edgeCount}`,
            }
        }

        return {
            passed: true,
            detail: `cooldown cleared; ${notes.length} espresso notes with ${edgeCount} edges`,
        }
    },
    budgets: {
        tokens: 9000,
        toolCalls: 9,
        vtInvocations: 8,
        seconds: 60,
    },
}

function countEdgesAmongNotes(notes: readonly {path: string; raw: string}[]): number {
    const basenamesLower = new Set(notes.map(({path: p}) => path.basename(p, '.md').toLowerCase()))
    let edges = 0
    for (const {raw} of notes) {
        const fm = parseFrontmatter(raw)
        const parents = fm['parent'] ?? fm['parents']
        if (typeof parents === 'string' && basenamesLower.has(stripMdExt(parents).toLowerCase())) {
            edges += 1
        } else if (Array.isArray(parents)) {
            for (const p of parents) {
                if (basenamesLower.has(stripMdExt(p).toLowerCase())) edges += 1
            }
        }
        for (const link of parseWikilinks(raw)) {
            if (basenamesLower.has(stripMdExt(link).toLowerCase())) edges += 1
        }
    }
    return edges
}
