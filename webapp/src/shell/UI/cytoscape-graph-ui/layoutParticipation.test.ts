import { beforeEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';
import {
  isLayoutParticipantEdge,
  isLayoutParticipantElement,
  isLayoutParticipantNode,
} from './layoutParticipation';

describe('layoutParticipation', () => {
  let cy: Core;

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
        { data: { id: 'edge-synthetic', source: 'regular', target: 'folder-collapsed', isSyntheticEdge: true } },
        { data: { id: 'edge-indicator', source: 'regular', target: 'folder-collapsed', isIndicatorEdge: true } },
      ],
    });
  });

  it('includes folder nodes in layout regardless of collapsed state', () => {
    expect(isLayoutParticipantNode(cy.$id('regular') as NodeSingular)).toBe(true);
    expect(isLayoutParticipantNode(cy.$id('context') as NodeSingular)).toBe(false);
    expect(isLayoutParticipantNode(cy.$id('folder-expanded') as NodeSingular)).toBe(true);
    expect(isLayoutParticipantNode(cy.$id('folder-collapsed') as NodeSingular)).toBe(true);
  });

  it('only includes edges whose endpoints both participate', () => {
    expect(isLayoutParticipantEdge(cy.$id('edge-ok') as EdgeSingular)).toBe(true);
    expect(isLayoutParticipantEdge(cy.$id('edge-blocked') as EdgeSingular)).toBe(true);
    expect(isLayoutParticipantEdge(cy.$id('edge-synthetic') as EdgeSingular)).toBe(false);
    expect(isLayoutParticipantEdge(cy.$id('edge-indicator') as EdgeSingular)).toBe(false);
    expect(isLayoutParticipantElement(cy.$id('folder-collapsed') as NodeSingular)).toBe(true);
    expect(isLayoutParticipantElement(cy.$id('edge-blocked') as EdgeSingular)).toBe(true);
    expect(isLayoutParticipantElement(cy.$id('edge-synthetic') as EdgeSingular)).toBe(false);
  });

  it('treats expanded folder compounds as layout participants (B5)', () => {
    expect(isLayoutParticipantNode(cy.$id('folder-expanded') as NodeSingular)).toBe(true);
    expect(isLayoutParticipantNode(cy.$id('folder-collapsed') as NodeSingular)).toBe(true);
    expect(isLayoutParticipantNode(cy.$id('context') as NodeSingular)).toBe(false);
  });
});
