import { TidyCoordinator } from './src/graph-core/graphviz/layout/TidyCoordinator';
import type { NodeInfo } from './src/graph-core/graphviz/layout/types';

const coordinator = new TidyCoordinator();

console.log('=== STEP 1: fullBuild with parent and child1 ===');
const initialNodes: NodeInfo[] = [
  { id: 'parent', position: { x: 0, y: 0 }, size: { width: 100, height: 50 } },
  { id: 'child1', position: { x: 0, y: 0 }, size: { width: 80, height: 40 }, parentId: 'parent' }
];

const positions1 = coordinator.fullBuild(initialNodes);
console.log('After fullBuild - positions returned:', positions1.size, 'nodes:', Array.from(positions1.keys()));

console.log('\n=== STEP 2: addNodes with child2 ===');
const newNode: NodeInfo = {
  id: 'child2',
  position: { x: 0, y: 0 },
  size: { width: 80, height: 40 },
  parentId: 'parent'
};

const positions2 = coordinator.addNodes([newNode]);
console.log('After addNodes - positions returned:', positions2.size, 'nodes:', Array.from(positions2.keys()));
console.log('Expected: 3 nodes (parent, child1, child2)');
console.log('Has parent?', positions2.has('parent'));
console.log('Has child1?', positions2.has('child1'));
console.log('Has child2?', positions2.has('child2'));
