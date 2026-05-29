/**
 * B3 — Reorganize 5 flat notes (rename / mv / group).
 *
 * Filesystem-only verification: existence of expected paths + every wikilink
 * resolves to some file in the vault.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import type {ScenarioSpec, SuccessResult} from '../types.ts'
import {fileExists, listMarkdownFiles, parseWikilinks, writeFile} from './_helpers.ts'

const TASK_PROMPT = `This vault has five flat notes (note-1.md … note-5.md) with wikilinks between
some of them. Reorganize as follows, using the \`vt\` CLI:

1. Rename \`note-1.md\` to \`intro.md\`.
2. Move \`note-3.md\` into a new \`chapters/\` subfolder.
3. Group \`note-2.md\` and \`note-4.md\` together into a new \`archive/\` folder.

After reorganizing, verify that every wikilink in the vault still resolves to
its target file. Run \`vt --help\` if you need to discover the right subcommand —
prefer the \`vt graph\` surface over raw shell commands.`

const EXPECTED_PATHS = [
    'intro.md',
    'chapters/note-3.md',
    'archive/note-2.md',
    'archive/note-4.md',
    'note-5.md',
] as const

export const b3: ScenarioSpec = {
    id: 'B3',
    name: 'reorganize 5 flat notes (rename / mv / group)',
    async setup(vaultDir) {
        await writeFile(path.join(vaultDir, 'note-1.md'), '# Note 1\n\nSee [[note-2]] and [[note-3]].\n')
        await writeFile(
            path.join(vaultDir, 'note-2.md'),
            '# Note 2\n\nReferenced by [[note-1]]. See also [[note-4]].\n',
        )
        await writeFile(path.join(vaultDir, 'note-3.md'), '# Note 3\n\nStandalone chapter content.\n')
        await writeFile(path.join(vaultDir, 'note-4.md'), '# Note 4\n\nLinked from [[note-2]].\n')
        await writeFile(path.join(vaultDir, 'note-5.md'), '# Note 5\n\nUnlinked draft.\n')
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'graph rename'},
        {verb: 'graph mv'},
        {verb: 'graph group'},
        {verb: 'graph structure'},
    ],
    async successCriteria(vaultDir): Promise<SuccessResult> {
        for (const rel of EXPECTED_PATHS) {
            const present = await fileExists(path.join(vaultDir, rel))
            if (!present) {
                return {passed: false, detail: `expected path missing: ${rel}`}
            }
        }
        if (await fileExists(path.join(vaultDir, 'note-1.md'))) {
            return {
                passed: false,
                detail: 'note-1.md still exists — rename produced a copy, not a rename',
            }
        }

        const mdFiles = await listMarkdownFiles(vaultDir)
        const basenamesLower = new Set(
            mdFiles.map((p) => path.basename(p, '.md').toLowerCase()),
        )

        for (const file of mdFiles) {
            const raw = await fs.readFile(file, 'utf8')
            for (const link of parseWikilinks(raw)) {
                const target = link.endsWith('.md') ? link.slice(0, -3) : link
                if (!basenamesLower.has(target.toLowerCase())) {
                    return {
                        passed: false,
                        detail: `dangling wikilink [[${link}]] in ${path.relative(vaultDir, file)}`,
                    }
                }
            }
        }

        return {passed: true, detail: 'all paths in place; all wikilinks resolve'}
    },
    budgets: {
        tokens: 5000,
        toolCalls: 6,
        vtInvocations: 6,
        seconds: 30,
    },
}
