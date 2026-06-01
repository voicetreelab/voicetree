import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { createLayoutParticipantSet, type LayoutParticipantSet } from './layoutParticipantSet';
import { isLayoutParticipantElement } from '@/shell/UI/cytoscape-graph-ui/layoutParticipation';

function groundTruthIds(cy: Core): Set<string> {
  const ids: Set<string> = new Set<string>();
  cy.elements().forEach(ele => {
    if (isLayoutParticipantElement(ele)) ids.add(ele.id());
  });
  return ids;
}

function collectionIds(set: LayoutParticipantSet): Set<string> {
  const ids: Set<string> = new Set<string>();
  set.getCollection().forEach(ele => ids.add(ele.id()));
  return ids;
}

describe('LayoutParticipantSet', () => {
  let cy: Core;
  let set: LayoutParticipantSet;

  beforeEach(() => {
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'regular' } },
        { data: { id: 'context', isContextNode: true } },
        { data: { id: 'folder-expanded', isFolderNode: true } },
        { data: { id: 'folder-collapsed', isFolderNode: true, collapsed: true } },
        { data: { id: 'edge-ok', source: 'regular', target: 'folder-collapsed' } },
        { data: { id: 'edge-blocked', source: 'regular', target: 'folder-expanded' } },
        { data: { id: 'edge-indicator', source: 'regular', target: 'folder-collapsed', isIndicatorEdge: true } },
        { data: { id: 'edge-synthetic', source: 'regular', target: 'folder-collapsed', isSyntheticEdge: true } },
      ],
    });
    set = createLayoutParticipantSet(cy);
  });

  afterEach(() => {
    set.dispose();
  });

  it('initializes matching ground truth', () => {
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
  });

  it('includes new participant node on add', () => {
    cy.add({ data: { id: 'new-node' } });
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('new-node')).toBe(true);
  });

  it('excludes non-participant node on add', () => {
    cy.add({ data: { id: 'new-ctx', isContextNode: true } });
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('new-ctx')).toBe(false);
  });

  it('removes node from set on remove', () => {
    cy.remove(cy.$id('regular'));
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('regular')).toBe(false);
  });

  it('removes connected edges when node is removed', () => {
    cy.remove(cy.$id('regular'));
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('edge-ok')).toBe(false);
  });

  it('flips node participation when data changes — folder collapse', () => {
    expect(collectionIds(set).has('folder-expanded')).toBe(false);
    cy.$id('folder-expanded').data('collapsed', true);
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('folder-expanded')).toBe(true);
  });

  it('flips node participation when data changes — becomes context node', () => {
    expect(collectionIds(set).has('regular')).toBe(true);
    cy.$id('regular').data('isContextNode', true);
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('regular')).toBe(false);
  });

  it('re-evaluates connected edges when node participation flips', () => {
    expect(collectionIds(set).has('edge-blocked')).toBe(false);
    cy.$id('folder-expanded').data('collapsed', true);
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('edge-blocked')).toBe(true);
  });

  it('flips edge participation when edge data changes — indicator flag removed', () => {
    expect(collectionIds(set).has('edge-indicator')).toBe(false);
    cy.$id('edge-indicator').data('isIndicatorEdge', false);
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('edge-indicator')).toBe(true);
  });

  it('includes new participant edge on add', () => {
    cy.add({ data: { id: 'new-edge', source: 'regular', target: 'folder-collapsed' } });
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('new-edge')).toBe(true);
  });

  it('includes new synthetic folder edge on add', () => {
    cy.add({ data: { id: 'new-synth', source: 'regular', target: 'folder-collapsed', isSyntheticEdge: true } });
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
    expect(collectionIds(set).has('new-synth')).toBe(true);
  });

  it('handles rapid sequence of operations consistently', () => {
    cy.add({ data: { id: 'a' } });
    cy.add({ data: { id: 'b', isContextNode: true } });
    cy.add({ data: { id: 'e1', source: 'a', target: 'regular' } });
    cy.$id('b').data('isContextNode', false);
    cy.remove(cy.$id('folder-collapsed'));
    cy.$id('folder-expanded').data('collapsed', true);
    expect(collectionIds(set)).toEqual(groundTruthIds(cy));
  });

  it('returns empty collection after dispose', () => {
    set.dispose();
    expect(set.getCollection().length).toBe(0);
  });
});
