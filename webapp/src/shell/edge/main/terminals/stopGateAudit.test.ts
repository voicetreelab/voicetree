/**
 * Unit tests for stop gate audit — BF-042 redesign
 *
 * Tests pure functions: parseObligations, resolveSkillPathFromContent,
 * buildDeficiencyPrompt, detectCliType, buildResumeCommand.
 * These have no external dependencies (no graph store, no FS reads) so no mocks needed.
 */

import {describe, it, expect} from 'vitest'
import {parseObligations, resolveSkillPathFromContent, buildDeficiencyPrompt, type ComplianceResult, type Obligation} from './stopGateAudit'
import {detectCliType, buildHeadlessCommand} from './spawnTerminalWithContextNode'
import {buildResumeCommand} from './headlessAgentManager'

// ─── parseObligations ───────────────────────────────────────────────────────

describe('parseObligations', () => {
    it('parses hard edges (double brackets)', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0]).toEqual({
            workflowPath: '~/brain/workflows/meta/promote/SKILL.md',
            type: 'hard',
            workflowName: 'promote'
        })
    })

    it('parses soft edges (single brackets)', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows
[~/brain/workflows/meta/gardening/SKILL.md]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0]).toEqual({
            workflowPath: '~/brain/workflows/meta/gardening/SKILL.md',
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
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(4)

        const hard: Obligation[] = obligations.filter(e => e.type === 'hard')
        const soft: Obligation[] = obligations.filter(e => e.type === 'soft')
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
        expect(parseObligations(content)).toEqual([])
    })

    it('returns empty array when Outgoing Workflows section is empty', () => {
        const content: string = `# Some SKILL
## Outgoing Workflows

## Next Section
`
        expect(parseObligations(content)).toEqual([])
    })

    it('stops at next heading', () => {
        const content: string = `# SKILL
## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
## Key References
[[~/brain/workflows/unrelated/SKILL.md]]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0].workflowName).toBe('promote')
    })

    it('stops at YAML frontmatter delimiter', () => {
        const content: string = `## Outgoing Workflows
[~/brain/workflows/meta/gardening/SKILL.md]
---
more: content
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
    })

    it('does not match double brackets as soft edges', () => {
        const content: string = `## Outgoing Workflows
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0].type).toBe('hard')
    })

    it('ignores markdown links that happen to mention SKILL.md in text', () => {
        const content: string = `## Outgoing Workflows
See [this guide](https://example.com) for reference.
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0].type).toBe('hard')
    })

    it('ignores paths not ending with /SKILL.md', () => {
        const content: string = `## Outgoing Workflows
[[~/brain/workflows/meta/promote/README.md]]
[~/brain/workflows/meta/gardening/index.md]
[[~/brain/workflows/meta/promote/SKILL.md]]
`
        const obligations: Obligation[] = parseObligations(content)
        expect(obligations).toHaveLength(1)
        expect(obligations[0].workflowName).toBe('promote')
    })
})

// ─── resolveSkillPathFromContent ────────────────────────────────────────────

describe('resolveSkillPathFromContent', () => {
    it('Case 1: returns ~/brain/ form when task node IS a SKILL.md under ~/brain/', () => {
        const home: string = process.env.HOME ?? ''
        const taskNodePath: string = `${home}/brain/workflows/meta/promote/SKILL.md`
        const result: string | null = resolveSkillPathFromContent(taskNodePath, '')
        expect(result).toBe('~/brain/workflows/meta/promote/SKILL.md')
    })

    it('Case 1: returns raw path for SKILL.md not under ~/brain/', () => {
        const result: string | null = resolveSkillPathFromContent('/some/other/path/SKILL.md', '')
        expect(result).toBe('/some/other/path/SKILL.md')
    })

    it('Case 2: extracts SKILL.md path from task node content', () => {
        const content: string = 'Read ~/brain/workflows/orchestration/SKILL.md — you are an orchestrator.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_123.md', content)
        expect(result).toBe('~/brain/workflows/orchestration/SKILL.md')
    })

    it('Case 3: extracts root ~/brain/SKILL.md when no specific reference', () => {
        const content: string = 'Read ~/brain/SKILL.md first.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_456.md', content)
        expect(result).toBe('~/brain/SKILL.md')
    })

    it('returns first SKILL.md path found in content', () => {
        const content: string = 'Read ~/brain/SKILL.md first.\nThen ~/brain/workflows/analysis/proof-compression/SKILL.md'
        const result: string | null = resolveSkillPathFromContent('/vault/task_789.md', content)
        expect(result).toBe('~/brain/SKILL.md')
    })

    it('returns null when no SKILL.md referenced', () => {
        const content: string = 'Just a regular task with no skill reference.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_000.md', content)
        expect(result).toBeNull()
    })

    it('handles SKILL.md path inside wikilinks in content', () => {
        const content: string = 'Follow [[~/brain/workflows/meta/promote/SKILL.md]] for guidance.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_111.md', content)
        expect(result).toBe('~/brain/workflows/meta/promote/SKILL.md')
    })

    it('handles SKILL.md path inside single-bracket links in content', () => {
        const content: string = 'Follow [~/brain/workflows/meta/gardening/SKILL.md] for guidance.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_222.md', content)
        expect(result).toBe('~/brain/workflows/meta/gardening/SKILL.md')
    })

    it('handles path with special directory names', () => {
        const content: string = 'Read ~/brain/workflows/tree-sleep/SKILL.md'
        const result: string | null = resolveSkillPathFromContent('/vault/task_333.md', content)
        expect(result).toBe('~/brain/workflows/tree-sleep/SKILL.md')
    })

    it('Case 1: matches case-insensitive SKILL.md filename (lowercase)', () => {
        const result: string | null = resolveSkillPathFromContent('/some/other/path/skill.md', '')
        expect(result).toBe('/some/other/path/skill.md')
    })

    it('Case 1: matches lowercase skill.md under brain dir and normalises to ~/brain/', () => {
        const home: string = process.env.HOME ?? ''
        const taskNodePath: string = `${home}/brain/workflows/meta/promote/skill.md`
        const result: string | null = resolveSkillPathFromContent(taskNodePath, '')
        expect(result).toBe('~/brain/workflows/meta/promote/skill.md')
    })

    it('Case 2: extracts absolute path SKILL.md from content', () => {
        const content: string = 'Read /Users/bobbobby/brain/workflows/orchestration/SKILL.md for guidance.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_123.md', content)
        expect(result).toBe('/Users/bobbobby/brain/workflows/orchestration/SKILL.md')
    })

    it('Case 2: matches case-insensitive skill.md in tilde content', () => {
        const content: string = 'Read ~/brain/workflows/orchestration/skill.md for guidance.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_123.md', content)
        expect(result).toBe('~/brain/workflows/orchestration/skill.md')
    })

    it('Case 3: extracts absolute root /brain/SKILL.md from content', () => {
        const content: string = 'Read /Users/bobbobby/brain/SKILL.md first.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_456.md', content)
        expect(result).toBe('/Users/bobbobby/brain/SKILL.md')
    })

    it('Case 3: matches case-insensitive root skill.md', () => {
        const content: string = 'Read ~/brain/skill.md first.'
        const result: string | null = resolveSkillPathFromContent('/vault/task_456.md', content)
        expect(result).toBe('~/brain/skill.md')
    })
})

// ─── buildDeficiencyPrompt ──────────────────────────────────────────────────

describe('buildDeficiencyPrompt', () => {
    it('formats a single violation', () => {
        const result: ComplianceResult = {
            passed: false,
            violations: [{
                obligation: { workflowPath: '~/brain/workflows/meta/promote/SKILL.md', type: 'hard', workflowName: 'promote' },
                reason: 'Hard edge violation: did not spawn workflow "promote"'
            }]
        }
        const prompt: string = buildDeficiencyPrompt(result)
        expect(prompt).toContain('STOP GATE AUDIT FAILED')
        expect(prompt).toContain('Hard edge violation: did not spawn workflow "promote"')
        expect(prompt).toContain('Address each violation')
    })

    it('formats multiple violations', () => {
        const result: ComplianceResult = {
            passed: false,
            violations: [
                {
                    obligation: { workflowPath: '~/brain/workflows/meta/promote/SKILL.md', type: 'hard', workflowName: 'promote' },
                    reason: 'Hard edge violation: did not spawn workflow "promote"'
                },
                {
                    obligation: { workflowPath: '~/brain/workflows/meta/gardening/SKILL.md', type: 'soft', workflowName: 'gardening' },
                    reason: 'Soft edge violation: did not reason about "gardening" in any progress node'
                },
                {
                    obligation: { workflowPath: '', type: 'hard', workflowName: 'progress-nodes' },
                    reason: 'No progress nodes created — agent produced no visible work'
                }
            ]
        }
        const prompt: string = buildDeficiencyPrompt(result)
        const lines: string[] = prompt.split('\n')
        const bulletLines: string[] = lines.filter(l => l.startsWith('- '))
        expect(bulletLines).toHaveLength(3)
    })

    it('includes closing instruction', () => {
        const result: ComplianceResult = {
            passed: false,
            violations: [{
                obligation: { workflowPath: '', type: 'hard', workflowName: 'test' },
                reason: 'test violation'
            }]
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

// ─── buildResumeCommand ────────────────────────────────────────────────────

describe('buildResumeCommand', () => {
    it('builds Claude resume command with --continue using env var', () => {
        const cmd: string = buildResumeCommand('claude')
        expect(cmd).toBe('claude --continue -p "$RESUME_PROMPT" --dangerously-skip-permissions')
    })

    it('builds Codex resume command (uses --last) with env var', () => {
        const cmd: string = buildResumeCommand('codex')
        expect(cmd).toBe('codex exec resume --last -p "$RESUME_PROMPT" --full-auto')
    })

    it('builds Gemini resume command (uses latest) with env var', () => {
        const cmd: string = buildResumeCommand('gemini')
        expect(cmd).toBe('gemini --resume latest -p "$RESUME_PROMPT" --yolo')
    })

    it('uses env var expansion (no --prompt-file)', () => {
        const cmd: string = buildResumeCommand('claude')
        expect(cmd).not.toContain('--prompt-file')
        expect(cmd).toContain('-p "$RESUME_PROMPT"')
    })
})

// ─── buildHeadlessCommand ──────────────────────────────────────────────────

describe('buildHeadlessCommand', () => {
    it('builds Claude headless command with -p flag', () => {
        const cmd: string = buildHeadlessCommand('claude --dangerously-skip-permissions "$AGENT_PROMPT"')
        expect(cmd).toBe('claude --dangerously-skip-permissions -p "$AGENT_PROMPT"')
    })

    it('does not include --session-id', () => {
        const cmd: string = buildHeadlessCommand('claude --dangerously-skip-permissions "$AGENT_PROMPT"')
        expect(cmd).not.toContain('--session-id')
    })

    it('builds Codex headless command with exec --full-auto', () => {
        const cmd: string = buildHeadlessCommand('codex "$AGENT_PROMPT"')
        expect(cmd).toBe('codex exec --full-auto "$AGENT_PROMPT"')
    })

    it('builds Codex headless command even when input already has exec --full-auto', () => {
        const cmd: string = buildHeadlessCommand('codex exec --full-auto "$AGENT_PROMPT"')
        expect(cmd).toBe('codex exec --full-auto "$AGENT_PROMPT"')
    })

    it('builds Gemini headless command with -p flag', () => {
        const cmd: string = buildHeadlessCommand('gemini --yolo "$AGENT_PROMPT"')
        expect(cmd).toBe('gemini --yolo -p "$AGENT_PROMPT"')
    })

    it('handles single-quoted $AGENT_PROMPT', () => {
        const cmd: string = buildHeadlessCommand("claude --dangerously-skip-permissions '$AGENT_PROMPT'")
        expect(cmd).toBe('claude --dangerously-skip-permissions -p "$AGENT_PROMPT"')
    })
})
