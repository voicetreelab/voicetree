import type { BoundingBox, Core, Position } from 'cytoscape';

const LEFT_OCCLUSION_SELECTORS: readonly string[] = [
  '.terminal-tree-sidebar',
  '.folder-tree-sidebar',
];

export interface VisibleViewportMetrics {
  readonly width: number;
  readonly height: number;
  readonly leftInset: number;
  readonly centerX: number;
  readonly centerY: number;
}

function getVisibleElementWidth(selector: string): number {
  if (typeof document === 'undefined') {
    return 0;
  }

  const element: Element | null = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    return 0;
  }

  const computedStyle: CSSStyleDeclaration = window.getComputedStyle(element);
  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
    return 0;
  }

  return Math.max(element.getBoundingClientRect().width, element.clientWidth, 0);
}

function getLeftOcclusionWidth(): number {
  return LEFT_OCCLUSION_SELECTORS.reduce((total: number, selector: string): number => {
    return total + getVisibleElementWidth(selector);
  }, 0);
}

export function getVisibleViewportMetrics(cy: Core): VisibleViewportMetrics {
  const fullWidth: number = Math.max(cy.width(), 1);
  const fullHeight: number = Math.max(cy.height(), 1);
  const leftInset: number = Math.min(getLeftOcclusionWidth(), Math.max(fullWidth - 1, 0));
  const width: number = Math.max(fullWidth - leftInset, 1);

  return {
    width,
    height: fullHeight,
    leftInset,
    centerX: leftInset + width / 2,
    centerY: fullHeight / 2,
  };
}

export function getVisibleViewportCenterInGraph(cy: Core): Position {
  const zoom: number = cy.zoom() || 1;
  const pan: Position = cy.pan();
  const viewport: VisibleViewportMetrics = getVisibleViewportMetrics(cy);

  return {
    x: (viewport.centerX - pan.x) / zoom,
    y: (viewport.centerY - pan.y) / zoom,
  };
}

export function getVisibleViewportExtent(cy: Core): BoundingBox {
  const zoom: number = cy.zoom() || 1;
  const pan: Position = cy.pan();
  const viewport: VisibleViewportMetrics = getVisibleViewportMetrics(cy);
  const x1: number = (viewport.leftInset - pan.x) / zoom;
  const x2: number = (viewport.leftInset + viewport.width - pan.x) / zoom;
  const y1: number = -pan.y / zoom;
  const y2: number = (viewport.height - pan.y) / zoom;

  return {
    x1,
    y1,
    x2,
    y2,
    w: x2 - x1,
    h: y2 - y1,
  };
}
