/**
 * Claude Code Hooks Configuration
 *
 * Manages Claude Code hooks in the watched project directory so that
 * all agents — regardless of which project they run from — get VoiceTree
 * hooks (e.g., web-search diamond nodes) injected automatically.
 *
 * Follows the same pattern as mcp-client-config.ts: on startup and
 * folder-switch, VoiceTree writes the hook script and merges hook
 * settings into {projectRoot}/.claude/settings.local.json.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store';

// ─── Hook script (embedded) ─────────────────────────────────────────────────

const SEARCH_DIAMOND_HOOK_FILENAME: string = 'vt-search-diamond.cjs';

/**
 * PostToolUse hook that appends WebSearch/WebFetch entries to a JSONL
 * research trail file in the vault. The VoiceTree sidebar reads this.
 *
 * Built as a joined string array to avoid template-literal escaping issues.
 */
const SEARCH_DIAMOND_HOOK_SCRIPT: string = [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const path = require('path');",
    '',
    'async function main() {',
    "  let inputData = '';",
    '  for await (const chunk of process.stdin) inputData += chunk;',
    "  if (!inputData.trim()) process.exit(0);",
    '',
    '  let input;',
    '  try { input = JSON.parse(inputData); } catch { process.exit(0); }',
    '',
    '  const vaultPath = process.env.VOICETREE_VAULT_PATH;',
    '  if (!vaultPath) process.exit(0);',
    '',
    "  const agent = process.env.AGENT_NAME || process.env.VOICETREE_TERMINAL_ID || 'unknown';",
    "  const time = new Date().toISOString().slice(11, 16);",
    '',
    "  const toolName = input.tool_name || '';",
    '  let entry;',
    '',
    "  if (toolName === 'WebSearch') {",
    '    const query = input.tool_input?.query;',
    '    if (!query) process.exit(0);',
    "    entry = { type: 'search', query: query, agent: agent, time: time };",
    "  } else if (toolName === 'WebFetch') {",
    '    const url = input.tool_input?.url;',
    '    if (!url) process.exit(0);',
    '    var domain;',
    "    try { domain = new URL(url).hostname.replace(/^www\\./, ''); } catch { domain = url; }",
    "    entry = { type: 'fetch', url: url, domain: domain, agent: agent, time: time };",
    '  } else {',
    '    process.exit(0);',
    '  }',
    '',
    "  var logPath = path.join(vaultPath, '.research-trail.jsonl');",
    "  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n');",
    '  process.exit(0);',
    '}',
    '',
    'main().catch(function() { process.exit(0); });',
    '',
].join('\n');

// ─── Settings merge ─────────────────────────────────────────────────────────

interface ClaudeSettings {
    hooks?: {
        PostToolUse?: Array<{
            matcher: string;
            hooks: Array<{ type: string; command: string }>;
        }>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

const VOICETREE_HOOK_MARKER: string = SEARCH_DIAMOND_HOOK_FILENAME;

function getClaudeSettingsPath(): string | null {
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return null;
    return path.join(watchedDir, '.claude', 'settings.local.json');
}

function getHookScriptPath(): string | null {
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return null;
    return path.join(watchedDir, '.claude', 'hooks', SEARCH_DIAMOND_HOOK_FILENAME);
}

async function readClaudeSettings(): Promise<ClaudeSettings> {
    const settingsPath: string | null = getClaudeSettingsPath();
    if (!settingsPath) return {};
    try {
        const content: string = await fs.readFile(settingsPath, 'utf-8');
        return JSON.parse(content) as ClaudeSettings;
    } catch (_error) {
        return {};
    }
}

async function writeClaudeSettings(config: ClaudeSettings): Promise<void> {
    const settingsPath: string | null = getClaudeSettingsPath();
    if (!settingsPath) throw new Error('No watched directory — cannot write Claude settings');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Enable VoiceTree Claude Code hooks by:
 * 1. Writing the hook script to {projectRoot}/.claude/hooks/
 * 2. Merging the PostToolUse:WebSearch hook into settings.local.json
 */
export async function enableClaudeHooksIntegration(): Promise<void> {
    const scriptPath: string | null = getHookScriptPath();
    if (!scriptPath) throw new Error('No watched directory — cannot write hooks');

    // 1. Write hook script
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, SEARCH_DIAMOND_HOOK_SCRIPT, 'utf-8');

    // 2. Merge hook config into settings
    const config: ClaudeSettings = await readClaudeSettings();

    if (!config.hooks) config.hooks = {};
    if (!config.hooks.PostToolUse) config.hooks.PostToolUse = [];

    // Ensure both WebSearch and WebFetch hooks exist
    const hookCommand: string = `node ".claude/hooks/${SEARCH_DIAMOND_HOOK_FILENAME}"`;
    let changed: boolean = false;

    for (const matcher of ['WebSearch', 'WebFetch']) {
        const hasHook: boolean = config.hooks.PostToolUse.some(
            (entry) => entry.matcher === matcher &&
                entry.hooks?.some((h) => h.command.includes(VOICETREE_HOOK_MARKER))
        );
        if (!hasHook) {
            config.hooks.PostToolUse.push({
                matcher,
                hooks: [{ type: 'command', command: hookCommand }]
            });
            changed = true;
        }
    }

    if (changed) {
        await writeClaudeSettings(config);
    }
}

/**
 * Remove VoiceTree hooks from Claude settings and clean up the hook script.
 */
export async function disableClaudeHooksIntegration(): Promise<void> {
    const config: ClaudeSettings = await readClaudeSettings();

    if (config.hooks?.PostToolUse) {
        config.hooks.PostToolUse = config.hooks.PostToolUse.filter(
            (entry) => !(['WebSearch', 'WebFetch'].includes(entry.matcher) &&
                entry.hooks?.some((h) => h.command.includes(VOICETREE_HOOK_MARKER)))
        );
        if (config.hooks.PostToolUse.length === 0) delete config.hooks.PostToolUse;
        if (Object.keys(config.hooks).length === 0) delete config.hooks;
        await writeClaudeSettings(config);
    }

    // Remove hook script
    const scriptPath: string | null = getHookScriptPath();
    if (scriptPath) {
        try { await fs.unlink(scriptPath); } catch (_e) { /* ignore */ }
    }
}
