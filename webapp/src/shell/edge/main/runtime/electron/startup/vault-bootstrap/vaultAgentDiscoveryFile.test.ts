/**
 * Black-box tests for the vault-open AGENTS.md / CLAUDE.md discovery
 * write.
 *
 * The function exists so user-launched coding agents — those that open
 * the vault directly rather than going through `vt agent spawn` — still
 * find out about the `vt` CLI. Tests use a real temp directory and
 * assert on file contents; no internal mocks.
 *
 * The manual content is rendered from a tiny synthetic spec set so the
 * assertions stay focused on splice / idempotency behavior rather than
 * coupling to the canonical TOOL_SPECS payload.
 */

import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {ToolSpec} from '@vt/vt-daemon-protocol'
import {
    spliceVoicetreeDiscoverySection,
    writeVaultAgentDiscoveryFile,
} from './vaultAgentDiscoveryFile'

const MANUAL_BODY: string = '# vt CLI Manual\n\nAvailable verbs: `vt agent spawn`, `vt graph create`.\n'

const FIXTURE_SPECS: readonly [ToolSpec, ToolSpec] = [
    {
        rpcName: 'spawn_thing',
        cliVerb: 'vt agent spawn',
        tier: 'essentials',
        summary: 'Spawn an agent.',
        description: 'Spawn an agent.',
        inputs: [],
    },
    {
        rpcName: 'create_graph_thing',
        cliVerb: 'vt graph create',
        tier: 'essentials',
        summary: 'Create a node.',
        description: 'Create a node.',
        inputs: [],
    },
]

let vaultDir: string

beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-vault-discovery-'))
})

afterEach(async () => {
    await fs.rm(vaultDir, {recursive: true, force: true})
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

describe('writeVaultAgentDiscoveryFile — CLAUDE.md exists', () => {
    it('appends a VoiceTree section to existing CLAUDE.md', async () => {
        const claudeMdPath: string = path.join(vaultDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# My CLAUDE.md\n\nProject notes.\n', 'utf-8')

        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)

        const result: string = await fs.readFile(claudeMdPath, 'utf-8')
        expect(result).toMatch(/^# My CLAUDE\.md/)
        expect(result).toContain('Project notes.')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_END')
    })

    it('is idempotent — repeat calls replace the section in place', async () => {
        const claudeMdPath: string = path.join(vaultDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# header\n', 'utf-8')

        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)
        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)

        const result: string = await fs.readFile(claudeMdPath, 'utf-8')
        const matches: number = (result.match(/VOICETREE_AGENT_DISCOVERY_START/g) ?? []).length
        expect(matches).toBe(1)
    })

    it('does not also create AGENTS.md when CLAUDE.md is present', async () => {
        const claudeMdPath: string = path.join(vaultDir, 'CLAUDE.md')
        await fs.writeFile(claudeMdPath, '# header\n', 'utf-8')

        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)

        const agentsExists: boolean = await fs.stat(path.join(vaultDir, '.voicetree', 'AGENTS.md'))
            .then(() => true, () => false)
        expect(agentsExists).toBe(false)
    })
})

describe('writeVaultAgentDiscoveryFile — no CLAUDE.md', () => {
    it('creates .voicetree/AGENTS.md with the discovery section', async () => {
        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)

        const agentsMdPath: string = path.join(vaultDir, '.voicetree', 'AGENTS.md')
        const result: string = await fs.readFile(agentsMdPath, 'utf-8')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_START')
        expect(result).toContain('vt agent spawn')
        expect(result).toContain('VOICETREE_AGENT_DISCOVERY_END')
    })

    it('does not touch CLAUDE.md if it does not exist', async () => {
        await writeVaultAgentDiscoveryFile(vaultDir, FIXTURE_SPECS)

        const claudeExists: boolean = await fs.stat(path.join(vaultDir, 'CLAUDE.md'))
            .then(() => true, () => false)
        expect(claudeExists).toBe(false)
    })
})

