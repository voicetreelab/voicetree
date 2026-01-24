import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findFileByName } from './findFileByName';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('findFileByName', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a test directory with various markdown files
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ripgrep-test-'));

    // Create root level files
    await fs.writeFile(path.join(testDir, 'introduction.md'), '# Introduction');
    await fs.writeFile(path.join(testDir, 'readme.md'), '# README');

    // Create nested directory with files
    const subDir: string = path.join(testDir, 'nested');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, 'deep-introduction.md'), '# Deep Intro');
    await fs.writeFile(path.join(subDir, 'other-note.md'), '# Other');

    // Create deeper nested directory
    const deepDir: string = path.join(subDir, 'deeper');
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(path.join(deepDir, 'very-deep.md'), '# Very Deep');
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should find files matching suffix pattern', async () => {
    const result: string[] = await findFileByName('introduction', testDir);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(f => f.includes('introduction'))).toBe(true);
  });

  it('should return empty array for non-existent pattern', async () => {
    const result: string[] = await findFileByName('xyznonexistent123', testDir);

    expect(result).toEqual([]);
  });

  it('should respect maxDepth parameter (depth 1 - root only)', async () => {
    const result: string[] = await findFileByName('', testDir, 1);

    // Should find root files only
    const hasVeryDeep: boolean = result.some(f => f.includes('very-deep'));
    expect(hasVeryDeep).toBe(false);

    // Should have root-level introduction.md
    const hasRootIntro: boolean = result.some(f => f.endsWith('introduction.md') && !f.includes('deep-introduction'));
    expect(hasRootIntro).toBe(true);
  });

  it('should find files in nested directories with sufficient depth', async () => {
    const result: string[] = await findFileByName('very-deep', testDir);

    expect(result.length).toBe(1);
    expect(result[0]).toContain('very-deep.md');
  });

  it('should only match exact filenames, not partial matches', async () => {
    // Exact matching: 'introduction' should only match 'introduction.md'
    // NOT 'deep-introduction.md' (prevents fuzzy matching bugs like [object Object])
    const result: string[] = await findFileByName('introduction', testDir);

    expect(result.length).toBe(1);
    expect(result[0]).toContain('introduction.md');
    expect(result[0]).not.toContain('deep-introduction.md');
  });

  it('should find files in any directory with exact name', async () => {
    // 'deep-introduction' should still be findable with exact name
    const result: string[] = await findFileByName('deep-introduction', testDir);

    expect(result.length).toBe(1);
    expect(result[0]).toContain('deep-introduction.md');
  });
});
