/**
 * Black-box tests for the project-open AGENTS.md / CLAUDE.md discovery
 * write.
 *
 * The function exists so user-launched coding agents — those that open
 * the project directly rather than going through `vt agent spawn` — still
 * find out about the `vt` CLI. Tests use a real temp directory and
 * assert on file contents; no internal mocks.
 *
 * Tests pass a literal manual-body string so assertions stay focused
 * on splice / idempotency behavior rather than coupling to the
 * canonical TOOL_SPECS payload. The end-to-end render is verified in
 * `@vt/vt-daemon-protocol/renderManual.test.ts`.
 */

import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
    spliceVoicetreeDiscoverySection,
    writeProjectAgentDiscoveryFile,
    VT_CLI_DISCOVERY_POINTER,
} from './projectAgentDiscoveryFile'

const MANUAL_BODY: string = '# vt CLI Manual\n\nAvailable verbs: `vt agent spawn`, `vt graph create`.\n'

let projectDir: string

beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-project-discovery-'))
})

afterEach(async () => {
    await fs.rm(projectDir, {recursive: true, force: true})
})

describe('spliceVoicetreeDiscoverySection (pure)', () => {
    it('returns a fresh section when no existing content', () => {
        const result: string = spliceVoicetreeDiscoverySection(null, MANUAL_BODY)
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_END')
    })

    it('appends to non-empty existing content', () => {
        const result: string = spliceVoicetreeDiscoverySection('# My CLAUDE.md\n\nProject notes.\n', MANUAL_BODY)
        expect(result).toMatch(/^# My CLAUDE\.md/)
        expect(result).toContain('Project notes.')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
    })

    it('replaces an existing section in place (idempotent)', () => {
        const initial: string = spliceVoicetreeDiscoverySection('# header\n', MANUAL_BODY)
        const updated: string = spliceVoicetreeDiscoverySection(initial, MANUAL_BODY)
        const matches: number = (updated.match(/VOICETREE_AGENT_DISCOVERY_START/g) ?? []).length
        expect(matches).toBe(1)
        expect(updated).toContain('# header')
    })

    it('replaces section when manual content changes', () => {
        const initial: string = spliceVoicetreeDiscoverySection('# header\n', 'OLD MANUAL\n')
        const updated: string = spliceVoicetreeDiscoverySection(initial, 'NEW MANUAL\n')
        expect(updated).toContain('NEW MANUAL')
        expect(updated).not.toContain('OLD MANUAL')
    })
})

describe('writeProjectAgentDiscoveryFile — CLAUDE.md exists', () => {
    it('appends a VoiceTree section to existing CLAUDE.md', async () => {
        const claudeMdPath: string = path.join(projectDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# My CLAUDE.md\n\nProject notes.\n', 'utf-8')

        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)

        const result: string = await fs.readFile(claudeMdPath, 'utf-8')
        expect(result).toMatch(/^# My CLAUDE\.md/)
        expect(result).toContain('Project notes.')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_END')
    })

    it('is idempotent — repeat calls replace the section in place', async () => {
        const claudeMdPath: string = path.join(projectDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# header\n', 'utf-8')

        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)
        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)

        const result: string = await fs.readFile(claudeMdPath, 'utf-8')
        const matches: number = (result.match(/VOICETREE_AGENT_DISCOVERY_START/g) ?? []).length
        expect(matches).toBe(1)
    })

    it('does not also create AGENTS.md when CLAUDE.md is present', async () => {
        const claudeMdPath: string = path.join(projectDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# header\n', 'utf-8')

        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)

        const agentsExists: boolean = await fs.stat(path.join(projectDir, '.voicetree', 'AGENTS.md'))
            .then(() => true, () => false)
        expect(agentsExists).toBe(false)
    })
})

describe('default injected content is a one-line pointer, NOT the manual', () => {
    it('is a single line pointing at `vt manual`', () => {
        expect(VT_CLI_DISCOVERY_POINTER).toContain('vt manual')
        expect(VT_CLI_DISCOVERY_POINTER.split('\n')).toHaveLength(1)
    })

    it('injects the pointer (and no rendered per-verb manual) by default', async () => {
        const claudeMdPath: string = path.join(projectDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# header\n', 'utf-8')

        await writeProjectAgentDiscoveryFile(projectDir)

        const result: string = await fs.readFile(claudeMdPath, 'utf-8')
        expect(result).toContain('vt manual')
        // The full manual is intentionally NOT inlined — agents fetch it on demand.
        expect(result).not.toContain('**Parameters:**')
        expect(result).not.toContain('vt agent spawn')
    })
})

describe('writeProjectAgentDiscoveryFile — no CLAUDE.md', () => {
    it('creates .voicetree/AGENTS.md with the discovery section', async () => {
        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)

        const agentsMdPath: string = path.join(projectDir, '.voicetree', 'AGENTS.md')
        const result: string = await fs.readFile(agentsMdPath, 'utf-8')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_END')
    })

    it('does not touch CLAUDE.md if it does not exist', async () => {
        await writeProjectAgentDiscoveryFile(projectDir, MANUAL_BODY)

        const claudeExists: boolean = await fs.stat(path.join(projectDir, 'CLAUDE.md'))
            .then(() => true, () => false)
        expect(claudeExists).toBe(false)
    })
})

