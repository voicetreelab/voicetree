import type { Core, CollectionReturnValue, SingularElementReturnValue, NodeSingular, EdgeSingular, EventObject } from 'cytoscape';
import { isLayoutParticipantElement, isLayoutParticipantNode, isLayoutParticipantEdge } from '@/shell/UI/cytoscape-graph-ui/layoutParticipation';

// Predicate-input audit (BF-075):
// isLayoutParticipantNode reads: data('isContextNode'), data('isFolderNode'), data('collapsed')
// isLayoutParticipantEdge reads: data('isIndicatorEdge') + endpoint participation
// No class accesses. ele.isNode() and edge.source()/target() are stable.
// Subscribed: add/remove on node+edge, data on node+edge.
// Node data change → re-evaluate node AND connected edges (endpoint participation may flip).

export type LayoutParticipantSet = {
  getCollection: () => CollectionReturnValue;
  dispose: () => void;
};

export function createLayoutParticipantSet(cy: Core): LayoutParticipantSet {
  const participants: Map<string, SingularElementReturnValue> = new Map<string, SingularElementReturnValue>();

  cy.elements().forEach((ele: SingularElementReturnValue) => {
    if (isLayoutParticipantElement(ele)) {
      participants.set(ele.id(), ele);
    }
  });

  function evaluateNode(node: NodeSingular): void {
    if (isLayoutParticipantNode(node)) {
      participants.set(node.id(), node);
    } else {
      participants.delete(node.id());
    }
    node.connectedEdges().forEach((edge: EdgeSingular) => evaluateEdge(edge));
  }

  function evaluateEdge(edge: EdgeSingular): void {
    if (isLayoutParticipantEdge(edge)) {
      participants.set(edge.id(), edge);
    } else {
      participants.delete(edge.id());
    }
  }

  function onNodeAdd(evt: EventObject): void { evaluateNode(evt.target as NodeSingular); }
  function onNodeRemove(evt: EventObject): void { participants.delete((evt.target as NodeSingular).id()); }
  function onEdgeAdd(evt: EventObject): void { evaluateEdge(evt.target as EdgeSingular); }
  function onEdgeRemove(evt: EventObject): void { participants.delete((evt.target as EdgeSingular).id()); }
  function onNodeData(evt: EventObject): void { evaluateNode(evt.target as NodeSingular); }
  function onEdgeData(evt: EventObject): void { evaluateEdge(evt.target as EdgeSingular); }

  cy.on('add', 'node', onNodeAdd);
  cy.on('remove', 'node', onNodeRemove);
  cy.on('add', 'edge', onEdgeAdd);
  cy.on('remove', 'edge', onEdgeRemove);
  cy.on('data', 'node', onNodeData);
  cy.on('data', 'edge', onEdgeData);

  let driftCheckInterval: ReturnType<typeof setInterval> | null = null;
  if (import.meta.env.DEV) {
    driftCheckInterval = setInterval(() => {
      const truth: Set<string> = new Set<string>();
      cy.elements().forEach((ele: SingularElementReturnValue) => {
        if (isLayoutParticipantElement(ele)) truth.add(ele.id());
      });
      const currentIds: Set<string> = new Set(participants.keys());
      const missing: string[] = [...truth].filter(id => !currentIds.has(id));
      const extra: string[] = [...currentIds].filter(id => !truth.has(id));
      if (missing.length > 0 || extra.length > 0) {
        console.error('[LayoutParticipantSet] DRIFT DETECTED', { missing, extra });
      }
    }, 5_000);
  }

  function getCollection(): CollectionReturnValue {
    const col: CollectionReturnValue = cy.collection();
    for (const ele of participants.values()) {
      if (!ele.removed()) {
        col.merge(ele);
      }
    }
    return col;
  }

  function dispose(): void {
    cy.off('add', 'node', onNodeAdd);
    cy.off('remove', 'node', onNodeRemove);
    cy.off('add', 'edge', onEdgeAdd);
    cy.off('remove', 'edge', onEdgeRemove);
    cy.off('data', 'node', onNodeData);
    cy.off('data', 'edge', onEdgeData);
    if (driftCheckInterval) clearInterval(driftCheckInterval);
    participants.clear();
  }

  return { getCollection, dispose };
}
