/**
 * Black-box tests for ensureProjectDotVoicetree. Asserts on the observable
 * filesystem: prompts are NO LONGER provisioned per-project (they live solely at
 * ~/.voicetree/prompts — see ensureHomePrompts), while hooks/.version/.gitignore
 * are still set up. The home-prompts mirror+backup is covered by
 * vt-daemon's ensureHomePrompts.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// tools-setup imports build-config (which imports electron) and @vt/vt-daemon's
// ensureHomePrompts. Stub electron's app and the build config so getBuildConfig()
// returns hook sources under a temp dir with no dependence on cwd/packaging.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', isPackaged: false } }));

const stub = vi.hoisted(() => ({ hookScriptsSource: '' as string }));
vi.mock('@/shell/edge/main/runtime/electron/app/build-config', () => ({
  getBuildConfig: () => ({ hookScriptsSource: stub.hookScriptsSource }),
}));

import { ensureProjectDotVoicetree } from '@/shell/edge/main/runtime/electron/startup/tools-setup';

let root: string;
let projectRoot: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-tools-setup-'));
  projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  // An (empty) hook source dir is enough — copySpecificFiles skips missing files.
  stub.hookScriptsSource = path.join(root, 'scripts');
  await fs.mkdir(stub.hookScriptsSource, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('ensureProjectDotVoicetree', () => {
  it('does NOT create a per-project prompts dir', async () => {
    await ensureProjectDotVoicetree(projectRoot);

    await expect(fs.access(path.join(projectRoot, '.voicetree', 'prompts'))).rejects.toThrow();
  });

  it('still sets up hooks, .version, and .gitignore', async () => {
    await ensureProjectDotVoicetree(projectRoot);

    const dotVoicetree: string = path.join(projectRoot, '.voicetree');
    expect((await fs.lstat(path.join(dotVoicetree, 'hooks'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dotVoicetree, '.version'), 'utf-8')).toBe('0.0.0-test');
    expect(await fs.readFile(path.join(dotVoicetree, '.gitignore'), 'utf-8')).toContain('positions.json');
  });

  it('preserves a user-customized .gitignore on re-open', async () => {
    const dotVoicetree: string = path.join(projectRoot, '.voicetree');
    await fs.mkdir(dotVoicetree, { recursive: true });
    await fs.writeFile(path.join(dotVoicetree, '.gitignore'), 'custom-entry\n');

    await ensureProjectDotVoicetree(projectRoot);

    expect(await fs.readFile(path.join(dotVoicetree, '.gitignore'), 'utf-8')).toBe('custom-entry\n');
  });
});
