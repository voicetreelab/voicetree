import { afterEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import type { CollectionReturnValue, Core, Position } from 'cytoscape';
import ColaLayout from './cola';
import { DEFAULT_OPTIONS } from './autoLayoutTypes';

const TOLERANCE_PX: number = 5;
const START: Record<string, Position> = {
  folder: { x: 0, y: 0 },
  'child-a': { x: -240, y: -120 },
  'child-b': { x: 0, y: 80 },
  'child-c': { x: 260, y: -40 },
  'outside-left': { x: -820, y: 40 },
  'outside-right': { x: 820, y: 20 },
};
const LAYOUT_OPTIONS = {
  nodeSpacing: 120,
  convergenceThreshold: 0.4,
  unconstrIter: 15,
  userConstIter: DEFAULT_OPTIONS.userConstIter ?? 15,
  allConstIter: 25,
  handleDisconnected: true,
  edgeLength: 350,
  avoidOverlap: true,
  animate: false as const,
  maxSimulationTime: 4000,
};

type LayoutCtor = new (options: {
  cy: Core;
  eles: CollectionReturnValue;
  randomize: boolean;
  fit: false;
  centerGraph: false;
  nodeDimensionsIncludeLabels: true;
} & typeof LAYOUT_OPTIONS) => { run: () => void };

function scenario(withFolder: boolean): Core {
  const node = (id: keyof typeof START, data: Record<string, unknown> = {}) => ({ data: { id, label: id, ...data }, position: START[id] });
  const edge = (id: string, source: string, target: string) => ({ data: { id, source, target } });
  const cy: Core = cytoscape({ headless: true, styleEnabled: true, elements: [
    ...(withFolder ? [node('folder', { isFolderNode: true, folderLabel: 'folder' })] : []),
    node('child-a', withFolder ? { parent: 'folder' } : {}),
    node('child-b', withFolder ? { parent: 'folder' } : {}),
    node('child-c', withFolder ? { parent: 'folder' } : {}),
    node('outside-left'),
    node('outside-right'),
    edge('edge-child-a-b', 'child-a', 'child-b'),
    edge('edge-child-b-c', 'child-b', 'child-c'),
    edge('edge-outside', 'outside-left', 'outside-right'),
  ] });
  cy.resize();
  return cy;
}

function distanceMap(cy: Core): Record<string, number> {
  const distance = (a: string, b: string): number => {
    const source: Position = cy.getElementById(a).position();
    const target: Position = cy.getElementById(b).position();
    return Math.hypot(source.x - target.x, source.y - target.y);
  };
  return Object.fromEntries([['child-a', 'child-b'], ['child-b', 'child-c'], ['child-a', 'child-c']].map(
    ([a, b]) => [`${a}::${b}`, distance(a, b)],
  ));
}

function run(cy: Core): Record<string, number> {
  const layout: { run: () => void } = new (ColaLayout as unknown as LayoutCtor)({
    cy, eles: cy.elements(), randomize: false, fit: false, centerGraph: false, nodeDimensionsIncludeLabels: true, ...LAYOUT_OPTIONS,
  });
  layout.run();
  return distanceMap(cy);
}

describe('ColaLayout expanded folders', () => {
  const instances: Core[] = [];

  afterEach(() => { while (instances.length > 0) instances.pop()?.destroy(); });

  it('lays out expanded-folder children like the no-folder control', () => {
    const withFolder: Core = scenario(true);
    const withoutFolder: Core = scenario(false);
    instances.push(withFolder, withoutFolder);
    const withDistances: Record<string, number> = run(withFolder);
    const withoutDistances: Record<string, number> = run(withoutFolder);

    expect(Object.keys(withDistances)).toEqual(Object.keys(withoutDistances));
    for (const key of Object.keys(withDistances)) {
      expect(Math.abs(withDistances[key] - withoutDistances[key])).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });
});
