/**
 * S9 · Atomic progress node (single concept, completed work).
 *
 * Tests the simplest shape of `vt graph create`: one node, completed-work
 * conventions (green color, codeDiff with complexityScore + explanation).
 *
 * This is the Phase 1 proving scenario — minimum complexity to exercise the
 * full harness loop (setup → agent → shim → score → success check).
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {ScenarioSpec, SuccessResult} from '../types.ts'

const AUTH_TS_FIXTURE = `export function readToken(headers: Record<string, string>): string | null {
    const raw = headers['authorization']
    if (!raw) return null
    return raw.replace(/^Bearer /, '')
}
`

export const s9AtomicCreate: ScenarioSpec = {
    id: 'S9',
    name: 'Atomic progress node (single concept, completed work)',
    setup: async (vaultDir) => {
        await fs.writeFile(path.join(vaultDir, 'auth.ts'), AUTH_TS_FIXTURE)
    },
    taskPrompt: [
        'You just fixed a small bug in `auth.ts` in this directory: the function previously',
        'returned an empty string when the Authorization header was missing; you changed it',
        'to return null instead, so callers can distinguish "missing" from "present but empty".',
        '',
        'Document this completion using the `vt` CLI by creating a single progress node.',
        'Include the diff verbatim. Use the completed-work convention (green color).',
        '',
        'Run `vt --help` if you need to discover the right subcommand.',
    ].join('\n'),
    expectedCommands: [
        {verb: 'graph create'},
    ],
    successCriteria: async (vaultDir) => checkAtomicCreateSuccess(vaultDir),
}

async function checkAtomicCreateSuccess(vaultDir: string): Promise<SuccessResult> {
    const files = await fs.readdir(vaultDir)
    const markdownFiles = files.filter((f) => f.endsWith('.md'))
    if (markdownFiles.length === 0) {
        return {passed: false, detail: 'no .md files created in vault'}
    }

    for (const file of markdownFiles) {
        const content = await fs.readFile(path.join(vaultDir, file), 'utf8')
        if (hasGreenFrontmatter(content) && content.length > 100) {
            return {passed: true, detail: `progress node created: ${file}`}
        }
    }

    return {
        passed: false,
        detail: `markdown files exist but none match completed-work shape (need color: green frontmatter + non-trivial content). Found: ${markdownFiles.join(', ')}`,
    }
}

function hasGreenFrontmatter(content: string): boolean {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return false
    return /\bcolor:\s*green\b/.test(match[1])
}
