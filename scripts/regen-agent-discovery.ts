/**
 * Regenerate the VoiceTree CLI discovery block in the repo-root
 * CLAUDE.md, then mirror it to AGENTS.md.
 *
 * This is the reproducible form of the one-off "regenerate the manual
 * block" step. It drives the SAME pure functions the Electron main
 * process runs at project-open (`spliceVoicetreeDiscoverySection` +
 * `renderFullManual`), so the committed file is byte-identical to what
 * opening this repo in VoiceTree would write — no drift, no surprise
 * diff on next project open.
 *
 * Run: `pnpm run gen:agent-discovery`
 * (= `node --import tsx scripts/regen-agent-discovery.ts`)
 *
 * After running, the tier-0 `agent-instructions-sync` gate (CLAUDE.md ≡
 * AGENTS.md, byte-identical) is satisfied because this script writes both.
 */

import {promises as fs} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {renderFullManual} from '@vt/vt-daemon-protocol'
import {spliceVoicetreeDiscoverySection} from '../webapp/src/shell/edge/main/runtime/electron/startup/project-bootstrap/projectAgentDiscoveryFile.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLAUDE_MD = resolve(REPO_ROOT, 'CLAUDE.md')
const AGENTS_MD = resolve(REPO_ROOT, 'AGENTS.md')

async function main(): Promise<void> {
    const existing: string = await fs.readFile(CLAUDE_MD, 'utf-8')
    const manualBody: string = renderFullManual({tier: 'overview'}).trimEnd()
    const next: string = spliceVoicetreeDiscoverySection(existing, manualBody)

    await fs.writeFile(CLAUDE_MD, next, 'utf-8')
    await fs.writeFile(AGENTS_MD, next, 'utf-8')

    const lineCount: number = next.endsWith('\n')
        ? next.slice(0, -1).split('\n').length
        : next.split('\n').length
    process.stdout.write(`Regenerated CLAUDE.md + AGENTS.md (${next.length} bytes, ${lineCount} lines)\n`)
}

main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
})
