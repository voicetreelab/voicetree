/**
 * Unit + integration tests for multi-CLI stop gate — BF-024 enforcement
 *
 * Tests pure functions: parseOutgoingEdges, resolveSkillPath, buildDeficiencyPrompt,
 * detectCliType, buildResumeCommand, shouldRunAudit.
 * These have no external dependencies (no graph store, no FS reads) so no mocks needed.
 */

import {describe, it, expect} from 'vitest'
import {parseOutgoingEdges, resolveSkillPath, buildDeficiencyPrompt, type AuditResult} from './stopGateAudit'
import {detectCliType} from './spawnTerminalWithContextNode'
import {buildResumeCommand, shouldRunAudit} from './headlessAgentManager'
import type {TerminalRecord} from './terminal-registry'

type OutgoingEdge = ReturnType<typeof parseOutgoingEdges>[number]

// ─── parseOutgoingEdges ──────────────────────────────────────────────────────

describe('parseOutgoingEdges', () => {
    it('parses hard edges (double brackets)', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0]).toEqual({
            path: '~/brain/workflows/meta/promote/SKILL.md',
            type: 'hard',
            workflowName: 'promote'
        })
    })

    it('parses soft edges (single brackets)', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows
[~/brain/workflows/meta/gardening/SKILL.md]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0]).toEqual({
            path: '~/brain/workflows/meta/gardening/SKILL.md',
            type: 'soft',
            workflowName: 'gardening'
        })
    })

    it('parses mixed hard and soft edges with inline comments', () => {
        const content: string = `# Root SKILL
## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]                          # hard: always check
[~/brain/workflows/meta/gardening/SKILL.md]                          # soft: reason about noise
[~/brain/workflows/tree-sleep/SKILL.md]                              # soft: tree sleep
[~/brain/workflows/meta/prediction-market-calibration/SKILL.md]      # soft: calibration
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(4)

        const hard: OutgoingEdge[] = edges.filter(e => e.type === 'hard')
        const soft: OutgoingEdge[] = edges.filter(e => e.type === 'soft')
        expect(hard).toHaveLength(1)
        expect(soft).toHaveLength(3)
        expect(hard[0].workflowName).toBe('promote')
        expect(soft.map(e => e.workflowName)).toEqual(['gardening', 'tree-sleep', 'prediction-market-calibration'])
    })

    it('returns empty array when no Outgoing Workflows section exists', () => {
        const content: string = `# Some SKILL
## Steps
1. Do something
`
        expect(parseOutgoingEdges(content)).toEqual([])
    })

    it('returns empty array when Outgoing Workflows section is empty', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows

## Next Section
`
        expect(parseOutgoingEdges(content)).toEqual([])
    })

    it('stops at next heading', () => {
        const content: string = `# SKILL
## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
## Key References
[[~/brain/workflows/unrelated/SKILL.md]]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0].workflowName).toBe('promote')
    })

    it('stops at YAML frontmatter delimiter', () => {
        const content: string = `## Outgoing Workflows
[~/brain/workflows/meta/gardening/SKILL.md]
---
more: content
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
    })

    it('does not match double brackets as soft edges', () => {
        const content: string = `## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0].type).toBe('hard')
    })

    it('ignores markdown links that happen to mention SKILL.md in text', () => {
        const content: string = `## Outgoing Workflows
See [this guide](https://example.com) for reference.
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0].type).toBe('hard')
    })

    it('ignores paths not ending with /SKILL.md', () => {
        const content: string = `## Outgoing Workflows
[[~/brain/workflows/meta/promote/README.md]]
[~/brain/workflows/meta/gardening/index.md]
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const edges: OutgoingEdge[] = parseOutgoingEdges(content)
        expect(edges).toHaveLength(1)
        expect(edges[0].workflowName).toBe('promote')
    })
})

// ─── resolveSkillPath ────────────────────────────────────────────────────────

describe('resolveSkillPath', () => {
    it('Case 1: returns ~/brain/ form when task node IS a SKILL.md under ~/brain/', () => {
        const home: string = process.env.HOME ?? ''
        const taskNodePath: string = `${home}/brain/workflows/meta/promote/SKILL.md`
        const result: string | null = resolveSkillPath(taskNodePath, '')
        expect(result).toBe('~/brain/workflows/meta/promote/SKILL.md')
    })

    it('Case 1: returns raw path for SKILL.md not under ~/brain/', () => {
        const result: string | null = resolveSkillPath('/some/other/path/SKILL.md', '')
        expect(result).toBe('/some/other/path/SKILL.md')
    })

    it('Case 2: extracts specific SKILL.md from task node content', () => {
        const content: string = 'Read ~/brain/SKILL.md first. Then read ~/brain/workflows/orchestration/SKILL.md — you are an orchestrator.'
        const result: string | null = resolveSkillPath('/vault/task_123.md', content)
        expect(result).toBe('~/brain/workflows/orchestration/SKILL.md')
    })

    it('Case 3: extracts root ~/brain/SKILL.md when no specific reference', () => {
        const content: string = 'Read ~/brain/SKILL.md first.'
        const result: string | null = resolveSkillPath('/vault/task_456.md', content)
        expect(result).toBe('~/brain/SKILL.md')
    })

    it('prefers specific SKILL.md over root when both present', () => {
        const content: string = 'Read ~/brain/SKILL.md first.\nThen ~/brain/workflows/analysis/proof-compression/SKILL.md'
        const result: string | null = resolveSkillPath('/vault/task_789.md', content)
        expect(result).toBe('~/brain/workflows/analysis/proof-compression/SKILL.md')
    })

    it('returns null when no SKILL.md referenced', () => {
        const content: string = 'Just a regular task with no skill reference.'
        const result: string | null = resolveSkillPath('/vault/task_000.md', content)
        expect(result).toBeNull()
    })

    it('handles SKILL.md path inside wikilinks in content', () => {
        const content: string = 'Follow [[~/brain/workflows/meta/promote/SKILL.md]] for guidance.'
        const result: string | null = resolveSkillPath('/vault/task_111.md', content)
        expect(result).toBe('~/brain/workflows/meta/promote/SKILL.md')
    })

    it('handles SKILL.md path inside single-bracket links in content', () => {
        const content: string = 'Follow [~/brain/workflows/meta/gardening/SKILL.md] for guidance.'
        const result: string | null = resolveSkillPath('/vault/task_222.md', content)
        expect(result).toBe('~/brain/workflows/meta/gardening/SKILL.md')
    })

    it('handles path with special directory names', () => {
        const content: string = 'Read ~/brain/workflows/tree-sleep/SKILL.md'
        const result: string | null = resolveSkillPath('/vault/task_333.md', content)
        expect(result).toBe('~/brain/workflows/tree-sleep/SKILL.md')
    })
})

// ─── buildDeficiencyPrompt ───────────────────────────────────────────────────

describe('buildDeficiencyPrompt', () => {
    it('formats a single violation', () => {
        const result: AuditResult = {
            passed: false,
            violations: [{
                edge: { path: '~/brain/workflows/meta/promote/SKILL.md', type: 'hard', workflowName: 'promote' },
                reason: 'Hard edge violation: did not spawn workflow "promote"'
            }],
            hasProgressNodes: true
        }
        const prompt: string = buildDeficiencyPrompt(result)
        expect(prompt).toContain('STOP GATE AUDIT FAILED')
        expect(prompt).toContain('Hard edge violation: did not spawn workflow "promote"')
        expect(prompt).toContain('Address each violation')
    })

    it('formats multiple violations', () => {
        const result: AuditResult = {
            passed: false,
            violations: [
                {
                    edge: { path: '~/brain/workflows/meta/promote/SKILL.md', type: 'hard', workflowName: 'promote' },
                    reason: 'Hard edge violation: did not spawn workflow "promote"'
                },
                {
                    edge: { path: '~/brain/workflows/meta/gardening/SKILL.md', type: 'soft', workflowName: 'gardening' },
                    reason: 'Soft edge violation: did not reason about "gardening" in any progress node'
                },
                {
                    edge: { path: '', type: 'hard', workflowName: 'progress-nodes' },
                    reason: 'No progress nodes created — agent produced no visible work'
                }
            ],
            hasProgressNodes: false
        }
        const prompt: string = buildDeficiencyPrompt(result)
        const lines: string[] = prompt.split('\n')
        const bulletLines: string[] = lines.filter(l => l.startsWith('- '))
        expect(bulletLines).toHaveLength(3)
    })

    it('includes closing instruction', () => {
        const result: AuditResult = {
            passed: false,
            violations: [{
                edge: { path: '', type: 'hard', workflowName: 'test' },
                reason: 'test violation'
            }],
            hasProgressNodes: true
        }
        const prompt: string = buildDeficiencyPrompt(result)
        expect(prompt).toMatch(/Address each violation.*exit normally/s)
    })
})

// ─── detectCliType ──────────────────────────────────────────────────────────

describe('detectCliType', () => {
    it('detects "claude" command', () => {
        expect(detectCliType('claude')).toBe('claude')
    })

    it('detects claude with flags', () => {
        expect(detectCliType('claude --model opus')).toBe('claude')
    })

    it('detects claude with multiple flags', () => {
        expect(detectCliType('claude --dangerously-skip-permissions -p "hello"')).toBe('claude')
    })

    it('detects "codex" command', () => {
        expect(detectCliType('codex')).toBe('codex')
    })

    it('detects codex with flags', () => {
        expect(detectCliType('codex exec --full-auto')).toBe('codex')
    })

    it('detects "gemini" command', () => {
        expect(detectCliType('gemini')).toBe('gemini')
    })

    it('detects gemini with flags', () => {
        expect(detectCliType('gemini --yolo')).toBe('gemini')
    })

    it('returns null for unknown CLI', () => {
        expect(detectCliType('unknown-cli')).toBeNull()
    })

    it('returns null for empty string', () => {
        expect(detectCliType('')).toBeNull()
    })

    it('returns null for "claudex" (prefix false positive)', () => {
        expect(detectCliType('claudex')).toBeNull()
    })

    it('returns null for "claude" embedded in another word', () => {
        expect(detectCliType('my-claude-wrapper')).toBeNull()
    })

    it('returns null for "codex-ai" (prefix false positive)', () => {
        expect(detectCliType('codex-ai')).toBeNull()
    })
})

// ─── buildResumeCommand ─────────────────────────────────────────────────────

/**
 * Helper to create a minimal TerminalRecord for buildResumeCommand tests.
 * Only populates fields that buildResumeCommand actually reads.
 */
function makeRecord(overrides: Partial<TerminalRecord>): TerminalRecord {
    return {
        terminalId: 'test-agent',
        terminalData: {} as TerminalRecord['terminalData'],
        status: 'exited',
        exitCode: 0,
        sessionId: null,
        cliType: null,
        auditRetryCount: 0,
        skillPath: null,
        ...overrides
    }
}

describe('buildResumeCommand', () => {
    it('builds Claude resume command with session ID using --prompt-file', () => {
        const record: TerminalRecord = makeRecord({ cliType: 'claude', sessionId: 'vt-Amy' })
        const cmd: string = buildResumeCommand(record, '/tmp/voicetree-resume-Amy.md')
        expect(cmd).toBe('claude --resume "vt-Amy" --prompt-file "/tmp/voicetree-resume-Amy.md" --dangerously-skip-permissions')
    })

    it('builds Codex resume command (uses --last) with --prompt-file', () => {
        const record: TerminalRecord = makeRecord({ cliType: 'codex' })
        const cmd: string = buildResumeCommand(record, '/tmp/voicetree-resume-Codex.md')
        expect(cmd).toBe('codex exec resume --last --prompt-file "/tmp/voicetree-resume-Codex.md" --full-auto')
    })

    it('builds Gemini resume command (uses latest) with --prompt-file', () => {
        const record: TerminalRecord = makeRecord({ cliType: 'gemini' })
        const cmd: string = buildResumeCommand(record, '/tmp/voicetree-resume-Gemini.md')
        expect(cmd).toBe('gemini --resume latest --prompt-file "/tmp/voicetree-resume-Gemini.md" --yolo')
    })

    it('uses --prompt-file (no inline prompt — special chars handled at write time)', () => {
        const record: TerminalRecord = makeRecord({ cliType: 'claude', sessionId: 'vt-Ben' })
        const cmd: string = buildResumeCommand(record, '/tmp/voicetree-resume-Ben.md')
        expect(cmd).toContain('--prompt-file')
        expect(cmd).not.toContain('-p "')
    })

    it('throws for null cliType', () => {
        const record: TerminalRecord = makeRecord({ cliType: null })
        expect(() => buildResumeCommand(record, '/tmp/voicetree-resume-null.md')).toThrow('unsupported CLI type')
    })

    it('embeds the file path verbatim in the command', () => {
        const record: TerminalRecord = makeRecord({ cliType: 'codex' })
        const cmd: string = buildResumeCommand(record, '/tmp/voicetree-resume-test-123.md')
        expect(cmd).toContain('/tmp/voicetree-resume-test-123.md')
    })
})

// ─── shouldRunAudit (integration: audit gate condition per CLI) ─────────────

describe('shouldRunAudit', () => {
    it('Claude with sessionId → audit runs', () => {
        expect(shouldRunAudit({ cliType: 'claude', sessionId: 'vt-Amy', skillPath: '~/brain/SKILL.md' })).toBe(true)
    })

    it('Claude without sessionId → audit skipped', () => {
        expect(shouldRunAudit({ cliType: 'claude', sessionId: null, skillPath: '~/brain/SKILL.md' })).toBe(false)
    })

    it('Codex without sessionId → audit still runs (uses --last)', () => {
        expect(shouldRunAudit({ cliType: 'codex', sessionId: null, skillPath: '~/brain/SKILL.md' })).toBe(true)
    })

    it('Gemini without sessionId → audit still runs (uses latest)', () => {
        expect(shouldRunAudit({ cliType: 'gemini', sessionId: null, skillPath: '~/brain/SKILL.md' })).toBe(true)
    })

    it('null cliType → audit skipped', () => {
        expect(shouldRunAudit({ cliType: null, sessionId: null, skillPath: '~/brain/SKILL.md' })).toBe(false)
    })

    it('null skillPath → audit skipped regardless of cliType', () => {
        expect(shouldRunAudit({ cliType: 'claude', sessionId: 'vt-Amy', skillPath: null })).toBe(false)
    })

    it('Codex with sessionId → audit runs', () => {
        expect(shouldRunAudit({ cliType: 'codex', sessionId: 'some-id', skillPath: '~/brain/SKILL.md' })).toBe(true)
    })

    it('both skillPath and cliType null → audit skipped', () => {
        expect(shouldRunAudit({ cliType: null, sessionId: null, skillPath: null })).toBe(false)
    })
})
