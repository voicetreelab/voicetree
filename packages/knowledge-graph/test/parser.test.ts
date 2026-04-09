import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseVault } from '../src/lib/parser.js';

const FIXTURE_VAULT = join(import.meta.dirname, 'fixtures', 'vault');

describe('parseVault', () => {
  it('finds all .md files and skips excluded directories', async () => {
    const { nodes } = await parseVault(FIXTURE_VAULT);
    const ids = nodes.map(n => n.id);
    expect(ids).toContain('People/Alice Smith.md');
    expect(ids).toContain('People/Bob Jones.md');
    expect(ids).toContain('Concepts/Widget Theory.md');
    expect(ids).toContain('orphan.md');
    // Should NOT include .obsidian or attachments
    expect(ids.every(id => !id.startsWith('.obsidian/'))).toBe(true);
    expect(ids.every(id => !id.startsWith('attachments/'))).toBe(true);
  });

  it('parses frontmatter correctly', async () => {
    const { nodes } = await parseVault(FIXTURE_VAULT);
    const alice = nodes.find(n => n.id === 'People/Alice Smith.md')!;
    expect(alice.title).toBe('Alice Smith');
    expect(alice.frontmatter.type).toBe('person');
    expect(alice.frontmatter.aliases).toContain('A. Smith');
  });

  it('falls back to filename when no title in frontmatter', async () => {
    const { nodes } = await parseVault(FIXTURE_VAULT);
    const noTitle = nodes.find(n => n.id === 'no-title.md')!;
    expect(noTitle.title).toBe('no-title');
  });

  it('extracts resolved edges with context', async () => {
    const { edges } = await parseVault(FIXTURE_VAULT);
    const aliceToWidget = edges.find(
      e => e.sourceId === 'People/Alice Smith.md'
        && e.targetId === 'Concepts/Widget Theory.md'
    );
    expect(aliceToWidget).toBeDefined();
    expect(aliceToWidget!.context).toContain('Widget Theory');
  });

  it('creates stub edges for nonexistent targets', async () => {
    const { edges, stubIds } = await parseVault(FIXTURE_VAULT);
    const stubEdge = edges.find(e => e.targetId.includes('Nonexistent Page'));
    expect(stubEdge).toBeDefined();
    expect(stubIds.size).toBeGreaterThan(0);
  });

  it('extracts inline tags', async () => {
    const { nodes } = await parseVault(FIXTURE_VAULT);
    const bob = nodes.find(n => n.id === 'People/Bob Jones.md')!;
    expect(bob.frontmatter.inline_tags).toContain('research');
    expect(bob.frontmatter.inline_tags).toContain('published');
  });
});
