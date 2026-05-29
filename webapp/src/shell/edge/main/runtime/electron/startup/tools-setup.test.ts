/**
 * Black-box tests for mirrorDirAsSymlinks — the single-source-of-truth prompt
 * provisioning. Asserts on the observable filesystem result (symlink targets,
 * preserved overrides, pruned dangles), not on internal calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// tools-setup imports build-config which imports electron at module load.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', isPackaged: false } }));

import { mirrorDirAsSymlinks } from '@/shell/edge/main/runtime/electron/startup/tools-setup';

let root: string;
let source: string;
let dest: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-mirror-'));
  source = path.join(root, 'source');
  dest = path.join(root, 'dest');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'a.md'), 'AAA');
  await fs.writeFile(path.join(source, 'b.md'), 'BBB');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('mirrorDirAsSymlinks', () => {
  it('creates symlinks to the source so source edits propagate without re-copy', async () => {
    await mirrorDirAsSymlinks(source, dest);

    expect((await fs.lstat(path.join(dest, 'a.md'))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(dest, 'a.md'))).toBe(path.join(source, 'a.md'));
    // Reading through the link returns source content...
    expect(await fs.readFile(path.join(dest, 'a.md'), 'utf-8')).toBe('AAA');
    // ...and a later source edit is visible immediately (no drift).
    await fs.writeFile(path.join(source, 'a.md'), 'AAA-edited');
    expect(await fs.readFile(path.join(dest, 'a.md'), 'utf-8')).toBe('AAA-edited');
  });

  it('repoints a stale symlink at the current source', async () => {
    await fs.mkdir(dest, { recursive: true });
    const elsewhere: string = path.join(root, 'elsewhere.md');
    await fs.writeFile(elsewhere, 'OLD');
    await fs.symlink(elsewhere, path.join(dest, 'a.md'));

    await mirrorDirAsSymlinks(source, dest);

    expect(await fs.readlink(path.join(dest, 'a.md'))).toBe(path.join(source, 'a.md'));
    expect(await fs.readFile(path.join(dest, 'a.md'), 'utf-8')).toBe('AAA');
  });

  it('preserves a real file as a per-project override', async () => {
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'a.md'), 'OVERRIDE');

    await mirrorDirAsSymlinks(source, dest);

    expect((await fs.lstat(path.join(dest, 'a.md'))).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(dest, 'a.md'), 'utf-8')).toBe('OVERRIDE');
    // Sibling without an override is still linked.
    expect((await fs.lstat(path.join(dest, 'b.md'))).isSymbolicLink()).toBe(true);
  });

  it('prunes a dangling symlink whose source file was removed', async () => {
    await mirrorDirAsSymlinks(source, dest);
    await fs.rm(path.join(source, 'b.md'));

    await mirrorDirAsSymlinks(source, dest);

    await expect(fs.lstat(path.join(dest, 'b.md'))).rejects.toThrow();
    expect((await fs.lstat(path.join(dest, 'a.md'))).isSymbolicLink()).toBe(true);
  });

  it('is a silent no-op when the source dir is absent', async () => {
    await expect(mirrorDirAsSymlinks(path.join(root, 'nope'), dest)).resolves.toBeUndefined();
  });
});
