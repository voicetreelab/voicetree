import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {RECOVERY_MARKER_KEYS} from './recovery-markers'

/**
 * Load-bearing contract between the agent prompt templates and session recovery.
 *
 * Both native-session matchers (Claude transcript, Codex thread) fingerprint an
 * orphaned agent by the `KEY = VALUE` env lines the spawn prompt echoes into the
 * agent's first user message. If a template stops printing any recovery marker
 * key, the line never reaches the transcript and EVERY resume silently fails
 * with `marker-mismatch` — exactly the regression that shipped when
 * VOICETREE_PROJECT_PATH was dropped from the `<YOUR_ENV_VARS>` block.
 *
 * This test reads the canonical shipped templates (the single source of truth
 * mirrored into ~/.voicetree/prompts) and asserts every marker key is still
 * echoed, so any future reword that breaks recovery fails here loudly instead.
 */
const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const CANONICAL_PROMPTS_DIR: string = join(
    TEST_FILE_DIR,
    '..', '..', '..', '..', '..',
    'voicetree-cli', 'prompts',
)

const TEMPLATES: readonly string[] = ['AGENT_PROMPT_CORE.md', 'AGENT_PROMPT_LIGHTWEIGHT.md']

describe('agent prompt templates echo every recovery marker key', () => {
    for (const template of TEMPLATES) {
        const body: string = readFileSync(join(CANONICAL_PROMPTS_DIR, template), 'utf8')
        for (const key of RECOVERY_MARKER_KEYS) {
            it(`${template} prints "${key} = " (recovery fingerprint)`, () => {
                expect(body).toContain(`${key} = `)
            })
        }
    }
})
