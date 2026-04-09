import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cpSync } from 'fs';
import { VaultWriter } from '../src/lib/writer.js';
import { Store } from '../src/lib/store.js';

const FIXTURE_VAULT = join(import.meta.dirname, 'fixtures', 'vault');

describe('VaultWriter', () => {
  let tempVault: string;
  let store: Store;
  let writer: VaultWriter;

  beforeEach(() => {
    tempVault = mkdtempSync(join(tmpdir(), 'kg-writer-'));
    cpSync(FIXTURE_VAULT, tempVault, { recursive: true });
    store = new Store(':memory:');
    writer = new VaultWriter(tempVault, store);
  });

  afterEach(() => {
    store.close();
  });

  describe('createNode', () => {
    it('creates a new markdown file with frontmatter', () => {
      writer.createNode({
        title: 'New Concept',
        directory: 'Concepts',
        frontmatter: { type: 'concept', tags: ['test'] },
        content: 'This is a new concept about testing.',
      });

      const filePath = join(tempVault, 'Concepts', 'New Concept.md');
      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, 'utf-8');
      expect(raw).toContain('title: New Concept');
      expect(raw).toContain('type: concept');
      expect(raw).toContain('This is a new concept about testing.');
    });

    it('indexes the new node in the store', () => {
      writer.createNode({
        title: 'New Concept',
        directory: 'Concepts',
        frontmatter: { type: 'concept' },
        content: 'A test concept.',
      });

      const node = store.getNode('Concepts/New Concept.md');
      expect(node).toBeDefined();
      expect(node!.title).toBe('New Concept');
    });

    it('creates directories that do not exist', () => {
      writer.createNode({
        title: 'Fresh Note',
        directory: 'NewDir',
        frontmatter: {},
        content: 'In a new directory.',
      });

      const filePath = join(tempVault, 'NewDir', 'Fresh Note.md');
      expect(existsSync(filePath)).toBe(true);
    });

    it('creates at vault root when no directory specified', () => {
      writer.createNode({
        title: 'Root Note',
        frontmatter: {},
        content: 'At the root.',
      });

      const filePath = join(tempVault, 'Root Note.md');
      expect(existsSync(filePath)).toBe(true);
    });

    it('throws if the file already exists', () => {
      expect(() => writer.createNode({
        title: 'Alice Smith',
        directory: 'People',
        frontmatter: {},
        content: 'Duplicate.',
      })).toThrow(/already exists/);
    });
  });

  describe('annotateNode', () => {
    it('appends content to an existing file', () => {
      writer.annotateNode('People/Alice Smith.md', '\n## Agent Notes\nAlice is a key connector.');

      const raw = readFileSync(join(tempVault, 'People', 'Alice Smith.md'), 'utf-8');
      expect(raw).toContain('## Agent Notes');
      expect(raw).toContain('Alice is a key connector.');
    });

    it('re-indexes the node in the store after annotation', () => {
      // First index the original
      writer.createNode({
        title: 'Temp Note',
        frontmatter: {},
        content: 'Original content.',
      });
      const before = store.getNode('Temp Note.md');
      expect(before!.content).toContain('Original content.');

      writer.annotateNode('Temp Note.md', '\n\nAppended content.');
      const after = store.getNode('Temp Note.md');
      expect(after!.content).toContain('Appended content.');
    });

    it('throws if the node does not exist', () => {
      expect(() => writer.annotateNode('nonexistent.md', 'stuff')).toThrow(/not found/);
    });
  });

  describe('addLink', () => {
    it('appends a wiki link to the source file', () => {
      writer.createNode({
        title: 'Source',
        frontmatter: {},
        content: 'Some content.',
      });

      writer.addLink('Source.md', 'People/Alice Smith', 'Related to Alice.');

      const raw = readFileSync(join(tempVault, 'Source.md'), 'utf-8');
      expect(raw).toContain('[[People/Alice Smith]]');
      expect(raw).toContain('Related to Alice.');
    });

    it('creates an edge in the store', () => {
      writer.createNode({
        title: 'Source',
        frontmatter: {},
        content: 'Some content.',
      });

      writer.addLink('Source.md', 'People/Alice Smith', 'Related to Alice.');

      const edges = store.getEdgesFrom('Source.md');
      expect(edges.some(e => e.targetId === 'People/Alice Smith.md')).toBe(true);
    });
  });
});
