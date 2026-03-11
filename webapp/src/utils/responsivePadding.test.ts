import { afterEach, describe, expect, it, vi } from 'vitest';
import { cyFitIntoVisibleViewport, cyFitWithRelativeZoom, getResponsivePadding } from '@/utils/responsivePadding';

type MockCollection = {
  length: number;
  boundingBox: () => { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  nodes: () => MockCollection;
  forEach: (callback: (node: MockCollection) => void) => void;
};

type MockCy = {
  width: () => number;
  height: () => number;
  minZoom: () => number;
  maxZoom: () => number;
  zoom: ReturnType<typeof vi.fn>;
  pan: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  animate: ReturnType<typeof vi.fn>;
  elements: () => MockCollection;
};

function createCollection(bb: { x1: number; y1: number; w: number; h: number }): MockCollection {
  return {
    length: 1,
    boundingBox: () => ({
      ...bb,
      x2: bb.x1 + bb.w,
      y2: bb.y1 + bb.h,
    }),
    nodes: function nodes(): MockCollection {
      return this;
    },
    forEach(callback: (node: MockCollection) => void): void {
      callback(this);
    },
  };
}

function createCy(eles: MockCollection, zoomLevel: number = 1): MockCy {
  let currentZoom: number = zoomLevel;
  let currentPan: { x: number; y: number } = { x: 0, y: 0 };

  return {
    width: () => 800,
    height: () => 600,
    minZoom: () => 0.1,
    maxZoom: () => 10,
    zoom: vi.fn((value?: number) => {
      if (typeof value === 'number') {
        currentZoom = value;
      }
      return currentZoom;
    }),
    pan: vi.fn((value?: { x: number; y: number }) => {
      if (value) {
        currentPan = value;
      }
      return currentPan;
    }),
    stop: vi.fn(),
    animate: vi.fn(),
    elements: () => eles,
  };
}

function appendSidebar(className: string, width: number): void {
  const element: HTMLDivElement = document.createElement('div');
  element.className = className;
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width,
  });
  element.getBoundingClientRect = () => ({
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(element);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('responsivePadding viewport-aware math', () => {
  it('shrinks responsive padding to the visible graph area', () => {
    const collection: MockCollection = createCollection({ x1: 100, y1: 100, w: 100, h: 100 });
    const cy: MockCy = createCy(collection);

    appendSidebar('terminal-tree-sidebar', 180);
    appendSidebar('folder-tree-sidebar', 220);

    expect(getResponsivePadding(cy as never, 10)).toBe(40);
  });

  it('centers relative zoom targets in the visible viewport, not under the sidebars', () => {
    const collection: MockCollection = createCollection({ x1: 100, y1: 100, w: 100, h: 100 });
    const cy: MockCy = createCy(collection);

    appendSidebar('terminal-tree-sidebar', 180);
    appendSidebar('folder-tree-sidebar', 220);

    cyFitWithRelativeZoom(cy as never, collection as never, 0.1);

    const animation: {
      zoom: number;
      pan: { x: number; y: number };
      __vtTargetEles: MockCollection;
    } = cy.animate.mock.calls[0][0] as {
      zoom: number;
      pan: { x: number; y: number };
      __vtTargetEles: MockCollection;
    };

    expect(animation.zoom).toBeCloseTo(0.4);
    expect(animation.pan.x).toBeCloseTo(540);
    expect(animation.pan.y).toBeCloseTo(240);
    expect(animation.__vtTargetEles).toBe(collection);
  });

  it('fits collections inside the visible viewport width when sidebars are open', () => {
    const collection: MockCollection = createCollection({ x1: 100, y1: 100, w: 100, h: 100 });
    const cy: MockCy = createCy(collection);

    appendSidebar('terminal-tree-sidebar', 180);
    appendSidebar('folder-tree-sidebar', 220);

    cyFitIntoVisibleViewport(cy as never, collection as never, 20);

    expect(cy.stop).toHaveBeenCalled();
    expect(cy.zoom).toHaveBeenCalledWith(3.6);
    expect(cy.pan).toHaveBeenCalledWith({ x: 60, y: -240 });
  });
});
