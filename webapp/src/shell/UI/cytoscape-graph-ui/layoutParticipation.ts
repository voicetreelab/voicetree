import type { EdgeSingular, NodeSingular, SingularElementReturnValue } from 'cytoscape';

export function isLayoutParticipantNode(node: NodeSingular): boolean {
  if (node.data('isContextNode')) return false;
  return true;
}

export function isLayoutParticipantEdge(edge: EdgeSingular): boolean {
  if (edge.data('isIndicatorEdge') || edge.data('isSyntheticEdge')) return false;
  return isLayoutParticipantNode(edge.source()) && isLayoutParticipantNode(edge.target());
}

export function isLayoutParticipantElement(ele: SingularElementReturnValue): boolean {
  return ele.isNode() ? isLayoutParticipantNode(ele) : isLayoutParticipantEdge(ele);
}
