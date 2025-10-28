import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import PositionManager from '../../electron/position-manager';

describe('PositionManager', () => {
  const testDir = path.join(__dirname, '../fixtures/test-positions');
  const voicetreeDir = path.join(testDir, '.voicetree');
  const graphDataPath = path.join(voicetreeDir, 'graph_data.json');
  let positionManager: PositionManager;

  beforeEach(async () => {
    positionManager = new PositionManager();
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should save positions to .voicetree/graph_data.json', async () => {
    const positions = {
      'introduction.md': { x: 100, y: 200 },
      'concepts/overview.md': { x: 300, y: 400 }
    };

    await positionManager.savePositions(testDir, positions);

    // Verify file was created
    const exists = await fs.access(graphDataPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Verify content
    const content = await fs.readFile(graphDataPath, 'utf8');
    const savedData = JSON.parse(content);
    expect(savedData).toEqual(positions);
  });

  it('should load positions from .voicetree/graph_data.json', async () => {
    const positions = {
      'introduction.md': { x: 100, y: 200 },
      'concepts/overview.md': { x: 300, y: 400 }
    };

    // Save first
    await positionManager.savePositions(testDir, positions);

    // Load and verify
    const loadedPositions = await positionManager.loadPositions(testDir);
    expect(loadedPositions).toEqual(positions);
  });

  it('should return empty object when no positions file exists', async () => {
    const loadedPositions = await positionManager.loadPositions(testDir);
    expect(loadedPositions).toEqual({});
  });

  it('should handle multiple save/load cycles', async () => {
    const positions1 = {
      'file1.md': { x: 100, y: 200 }
    };

    const positions2 = {
      'file1.md': { x: 150, y: 250 },
      'file2.md': { x: 300, y: 400 }
    };

    // Save first set
    await positionManager.savePositions(testDir, positions1);
    let loaded = await positionManager.loadPositions(testDir);
    expect(loaded).toEqual(positions1);

    // Save second set (overwrite)
    await positionManager.savePositions(testDir, positions2);
    loaded = await positionManager.loadPositions(testDir);
    expect(loaded).toEqual(positions2);
  });

  it('should create .voicetree directory if it does not exist', async () => {
    const positions = {
      'test.md': { x: 50, y: 100 }
    };

    await positionManager.savePositions(testDir, positions);

    // Verify .voicetree directory exists
    const dirExists = await fs.access(voicetreeDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(true);
  });
});
