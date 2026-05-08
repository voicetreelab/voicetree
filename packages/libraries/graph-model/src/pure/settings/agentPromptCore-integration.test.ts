/**
 * Integration tests for AGENT_PROMPT_CORE feature.
 *
 * Tests the full flow:
 * 1. Migration: existing settings.json → adds AGENT_PROMPT_CORE, updates AGENT_PROMPT
 * 2. End-to-end expansion: resolveEnvVars → merge → expandEnvVarsInValues produces correct AGENT_PROMPT
 */
import { describe, it, expect } from 'vitest';
import { resolveEnvVars, expandEnvVarsInValues } from './resolve-environment-variable';
import { DEFAULT_SETTINGS } from './DEFAULT_SETTINGS';
import type { EnvVarValue } from './types';

// ── Realistic test data ─────────────────────────────────────────────────────

/** Simulates the AGENT_PROMPT value currently stored in a real user's settings.json
 *  (before the AGENT_PROMPT_CORE migration). This is the OLD default that was
 *  previously auto-written by migrateAgentPromptIfNeeded. */
const OLD_STYLE_AGENT_PROMPT = `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
<HANDLING_AMBIGUITY>
If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.
</HANDLING_AMBIGUITY>
<ORCHESTRATION>
Before starting work, answer: Does this task have 2+ distinct concerns or phases?

YES \u2192 Decompose into nodes and spawn voicetree agents first (mcp__voicetree__spawn_agent). Users get visibility into subagent work this way\u2014built-in subagents are a black box.
NO \u2192 Proceed directly.

See decompose_subtask_dependency_graph.md for decomposition / dependency graph patterns.
</ORCHESTRATION>
<TASK_NODES_INSTRUCTION>
For the entire duration of this session, before you report completion to the user for any query, task, sub-task, proposal, or other form of non-trivial progress, you MUST create progress node(s) documenting your work.

Add to your todolist now to read addProgressTree.md and create progress node(s).

Primary method: Use the \`create_graph\` MCP tool with VOICETREE_TERMINAL_ID=$VOICETREE_TERMINAL_ID. Supports 1+ nodes per call \u2014 single concept nodes or multi-node trees.
Before creating your first progress node, read $VOICETREE_PROJECT_DIR/prompts/addProgressTree.md for composition guidance (when to split, scope rules, what to embed).

You must create a progress node before reporting completion to the user. You must continue to do this for any follow-ups by either updating existing progress nodes, or creating new ones.
</TASK_NODES_INSTRUCTION>
<YOUR_ENV_VARS>
VOICETREE_TERMINAL_ID = $VOICETREE_TERMINAL_ID
AGENT_NAME = $AGENT_NAME
CONTEXT_NODE_PATH = $CONTEXT_NODE_PATH
TASK_NODE_PATH = $TASK_NODE_PATH
VOICETREE_VAULT_PATH = $VOICETREE_VAULT_PATH
VOICETREE_APP_SUPPORT = $VOICETREE_APP_SUPPORT
VOICETREE_PROJECT_DIR = $VOICETREE_PROJECT_DIR
VOICETREE_MCP_PORT = $VOICETREE_MCP_PORT
</YOUR_ENV_VARS>`;

/** A user-customized AGENT_PROMPT (differs from old default) */
const CUSTOMIZED_AGENT_PROMPT = OLD_STYLE_AGENT_PROMPT + '\n\nYOU MUST FOLLOW THE BRAINFOREST SELF IMPROVING SYSTEM in ~/voicetree, read this first.';

// ── Migration tests ─────────────────────────────────────────────────────────

describe('AGENT_PROMPT_CORE migration', () => {
  const defaultCore: string = DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT_CORE as string;

  it('old-style AGENT_PROMPT should differ from current AGENT_PROMPT_CORE (ORCHESTRATION tag was strengthened)', () => {
    // OLD_STYLE_AGENT_PROMPT is what pre-migration users had in settings.json.
    // AGENT_PROMPT_CORE was updated with a stronger ORCHESTRATION gate (2026-03-09).
    // Users who already migrated (AGENT_PROMPT = '$AGENT_PROMPT_CORE') get the new text automatically.
    // Pre-migration users with the old inline text won't match — they keep their old prompt.
    expect(OLD_STYLE_AGENT_PROMPT).not.toBe(defaultCore);
  });

  it('DEFAULT_SETTINGS.AGENT_PROMPT should be the reference string', () => {
    expect(DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT).toBe('$AGENT_PROMPT_CORE');
  });

  it('first migration: unmodified user with old ORCHESTRATION tag is NOT auto-migrated (prompt changed)', () => {
    // After ORCHESTRATION tag was strengthened, old default no longer matches new default.
    // Users who already migrated (AGENT_PROMPT = '$AGENT_PROMPT_CORE') get new text automatically.
    const currentAgentPrompt: string = OLD_STYLE_AGENT_PROMPT;
    const shouldUpdateAgentPrompt: boolean = currentAgentPrompt === defaultCore;
    expect(shouldUpdateAgentPrompt).toBe(false);
  });

  it('first migration: customized user keeps their AGENT_PROMPT unchanged', () => {
    const currentAgentPrompt: string = CUSTOMIZED_AGENT_PROMPT;
    const shouldUpdateAgentPrompt: boolean = currentAgentPrompt === defaultCore;
    expect(shouldUpdateAgentPrompt).toBe(false);
  });
});

// ── End-to-end expansion tests ──────────────────────────────────────────────

describe('AGENT_PROMPT_CORE end-to-end expansion (simulates buildTerminalEnvVars)', () => {
  /** Simulates the full env var pipeline from buildTerminalEnvVars.ts */
  function simulateBuildTerminalEnvVars(
    injectEnvVars: Record<string, EnvVarValue>,
  ): Record<string, string> {
    // Step 1: resolveEnvVars (normalizes whitespace, picks from arrays)
    const resolvedEnvVars: Record<string, string> = resolveEnvVars(injectEnvVars);

    // Step 2: merge with system-provided vars (simulating buildTerminalEnvVars)
    const unexpandedEnvVars: Record<string, string> = {
      VOICETREE_PROJECT_DIR: '/Users/test/project/.voicetree',
      VOICETREE_APP_SUPPORT: '/Users/test/Library/Application Support/Voicetree',
      VOICETREE_VAULT_PATH: '/Users/test/project/vault',
      ALL_MARKDOWN_READ_PATHS: '/Users/test/project/vault',
      CONTEXT_NODE_PATH: '/Users/test/project/vault/task-123.md',
      TASK_NODE_PATH: '/Users/test/project/vault/task-123.md',
      VOICETREE_TERMINAL_ID: 'Ama',
      VOICETREE_CALLER_TERMINAL_ID: 'Ama',
      AGENT_NAME: 'Ama',
      VOICETREE_MCP_PORT: '3002',
      ...resolvedEnvVars,
    };

    // Step 3: expand $VAR references
    return expandEnvVarsInValues(unexpandedEnvVars);
  }

  it('new default settings: AGENT_PROMPT fully expands via AGENT_PROMPT_CORE', () => {
    const result: Record<string, string> = simulateBuildTerminalEnvVars(
      DEFAULT_SETTINGS.INJECT_ENV_VARS,
    );

    // AGENT_PROMPT should be fully expanded — no $VAR references remaining
    expect(result.AGENT_PROMPT).not.toContain('$AGENT_PROMPT_CORE');
    expect(result.AGENT_PROMPT).not.toContain('$CONTEXT_NODE_PATH');
    expect(result.AGENT_PROMPT).not.toContain('$VOICETREE_TERMINAL_ID');
    expect(result.AGENT_PROMPT).not.toContain('$AGENT_NAME');

    // Should contain the actual resolved values
    expect(result.AGENT_PROMPT).toContain('/Users/test/project/vault/task-123.md');
    expect(result.AGENT_PROMPT).toContain('Ama');
    expect(result.AGENT_PROMPT).toContain('3002');

    // AGENT_PROMPT should equal AGENT_PROMPT_CORE (since default is just '$AGENT_PROMPT_CORE')
    expect(result.AGENT_PROMPT).toBe(result.AGENT_PROMPT_CORE);
  });

  it('user-customized AGENT_PROMPT wrapping $AGENT_PROMPT_CORE also fully expands', () => {
    const customEnvVars: Record<string, EnvVarValue> = {
      ...DEFAULT_SETTINGS.INJECT_ENV_VARS,
      AGENT_PROMPT: 'Always use bun instead of npm. $AGENT_PROMPT_CORE Never auto-commit.',
    };

    const result: Record<string, string> = simulateBuildTerminalEnvVars(customEnvVars);

    // No unresolved references
    expect(result.AGENT_PROMPT).not.toContain('$AGENT_PROMPT_CORE');
    expect(result.AGENT_PROMPT).not.toContain('$CONTEXT_NODE_PATH');

    // User prefix and suffix preserved
    expect(result.AGENT_PROMPT).toMatch(/^Always use bun instead of npm\./);
    expect(result.AGENT_PROMPT).toMatch(/Never auto-commit\.$/);

    // Core content is in the middle
    expect(result.AGENT_PROMPT).toContain('/Users/test/project/vault/task-123.md');
  });

  it('user AGENT_PROMPT without $AGENT_PROMPT_CORE still works (fully custom)', () => {
    const customEnvVars: Record<string, EnvVarValue> = {
      ...DEFAULT_SETTINGS.INJECT_ENV_VARS,
      AGENT_PROMPT: 'Just read $CONTEXT_NODE_PATH and do your best, $AGENT_NAME.',
    };

    const result: Record<string, string> = simulateBuildTerminalEnvVars(customEnvVars);

    expect(result.AGENT_PROMPT).toBe(
      'Just read /Users/test/project/vault/task-123.md and do your best, Ama.',
    );
  });

  it('legacy user settings (old-style AGENT_PROMPT without AGENT_PROMPT_CORE) still expand correctly', () => {
    // Simulate a user who hasn't been migrated yet — they have the old full AGENT_PROMPT
    // and no AGENT_PROMPT_CORE at all
    const legacyEnvVars: Record<string, EnvVarValue> = {
      AGENT_PROMPT: OLD_STYLE_AGENT_PROMPT,
      // No AGENT_PROMPT_CORE — simulates pre-migration state
    };

    const result: Record<string, string> = simulateBuildTerminalEnvVars(legacyEnvVars);

    // Should still expand all $VAR references in AGENT_PROMPT directly
    expect(result.AGENT_PROMPT).not.toContain('$CONTEXT_NODE_PATH');
    expect(result.AGENT_PROMPT).not.toContain('$VOICETREE_TERMINAL_ID');
    expect(result.AGENT_PROMPT).toContain('/Users/test/project/vault/task-123.md');
    expect(result.AGENT_PROMPT).toContain('Ama');
  });
});
