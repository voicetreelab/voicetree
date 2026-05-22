/**
 * Pure diagnostic capture functions for pan/zoom e2e tests.
 * All functions run page.evaluate() to extract cytoscape viewport state.
 */

import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
  voiceTreeGraphView?: { navigateToNodeAndTrack: (nodeId: string) => void };
}

export interface VisibleViewportInfo {
  width: number;
  height: number;
  leftInset: number;
  centerX: number;
  centerY: number;
}

export interface ViewportDiagnostic {
  zoom: number;
  pan: { x: number; y: number };
  cyWidth: number;
  cyHeight: number;
  totalNodes: number;
  folderNodeCount: number;
  folderNodeIds: string[];
  visibleViewport: VisibleViewportInfo;
}

export interface NavigationDiagnostic extends ViewportDiagnostic {
  targetNodeBB: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  targetNodeRenderedSize: { renderedW: number; renderedH: number };
  nodeFractionOfViewport: { widthFraction: number; heightFraction: number };
  targetNodeVisibleInExtent: boolean;
  neighborhoodInfo: {
    neighborCount: number;
    neighborIds: string[];
    neighborhoodBB: { w: number; h: number };
    includesFolderNodes: boolean;
    folderNodeIdsInNeighborhood: string[];
  };
}

export interface TerminalDiagnostic {
  zoom: number;
  shadowNodeId: string;
  shadowNodeBB: { w: number; h: number };
  parentNodeId: string | undefined;
  combinedBB: { w: number; h: number };
  requiredZoomForBoth: number;
  wouldFallbackToShadowOnly: boolean;
  renderedShadowW: number;
  renderedShadowH: number;
  shadowFractionOfViewport: { w: number; h: number };
  shadowVisibleInExtent: boolean;
  visibleViewport: { width: number; height: number; leftInset: number };
}

export interface FolderAnalysis {
  allNodesBB: { w: number; h: number };
  nonFolderNodesBB: { w: number; h: number };
  folderNodes: { id: string; bbW: number; bbH: number; isParent: boolean; childCount: number }[];
  bbExpansionFromFolders: { widthDiff: number; heightDiff: number; significant: boolean };
}


export async function captureViewportDiagnostic(page: Page): Promise<ViewportDiagnostic> {
  return page.evaluate(() => {
    const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance;
    if (!cy) throw new Error('No cytoscape');
    const folderNodes = cy.nodes().filter((n: NodeSingular) => n.data('isFolderNode'));
    const fullWidth = Math.max(cy.width(), 1);
    const fullHeight = Math.max(cy.height(), 1);
    const sidebar = document.querySelector('.terminal-tree-sidebar');
    const folderSidebar = document.querySelector('.folder-tree-sidebar');
    let leftInset = 0;
    if (sidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(sidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += sidebar.getBoundingClientRect().width;
    }
    if (folderSidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(folderSidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += folderSidebar.getBoundingClientRect().width;
    }
    const visibleWidth = Math.max(fullWidth - leftInset, 1);
    return {
      zoom: cy.zoom(), pan: cy.pan(), cyWidth: fullWidth, cyHeight: fullHeight,
      totalNodes: cy.nodes().length,
      folderNodeCount: folderNodes.length,
      folderNodeIds: folderNodes.map((n: NodeSingular) => n.id()),
      visibleViewport: { width: visibleWidth, height: fullHeight, leftInset, centerX: leftInset + visibleWidth / 2, centerY: fullHeight / 2 },
    };
  });
}

export async function captureNavigationDiagnostic(page: Page, nodeId: string): Promise<NavigationDiagnostic> {
  return page.evaluate((targetId: string) => {
    const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance;
    if (!cy) throw new Error('No cytoscape');
    const node = cy.getElementById(targetId);
    if (node.length === 0) throw new Error(`Node ${targetId} not found`);
    const bb = node.boundingBox();
    const zoom = cy.zoom();
    const neighborhood = node.closedNeighborhood().nodes();
    const folderNodesInNeighborhood = neighborhood.filter((n: NodeSingular) => n.data('isFolderNode'));
    const neighborhoodBB = neighborhood.boundingBox();
    const fullWidth = Math.max(cy.width(), 1);
    const fullHeight = Math.max(cy.height(), 1);
    const sidebar = document.querySelector('.terminal-tree-sidebar');
    const folderSidebar = document.querySelector('.folder-tree-sidebar');
    let leftInset = 0;
    if (sidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(sidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += sidebar.getBoundingClientRect().width;
    }
    if (folderSidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(folderSidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += folderSidebar.getBoundingClientRect().width;
    }
    const visibleWidth = Math.max(fullWidth - leftInset, 1);
    const renderedW = bb.w * zoom;
    const renderedH = bb.h * zoom;
    const extent = cy.extent();
    const folderNodes = cy.nodes().filter((n: NodeSingular) => n.data('isFolderNode'));
    return {
      zoom, pan: cy.pan(), cyWidth: fullWidth, cyHeight: fullHeight,
      totalNodes: cy.nodes().length,
      folderNodeCount: folderNodes.length,
      folderNodeIds: folderNodes.map((n: NodeSingular) => n.id()),
      visibleViewport: { width: visibleWidth, height: fullHeight, leftInset, centerX: leftInset + visibleWidth / 2, centerY: fullHeight / 2 },
      targetNodeBB: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, w: bb.w, h: bb.h },
      targetNodeRenderedSize: { renderedW, renderedH },
      nodeFractionOfViewport: { widthFraction: renderedW / visibleWidth, heightFraction: renderedH / fullHeight },
      targetNodeVisibleInExtent: bb.x2 >= extent.x1 && bb.x1 <= extent.x2 && bb.y2 >= extent.y1 && bb.y1 <= extent.y2,
      neighborhoodInfo: {
        neighborCount: neighborhood.length,
        neighborIds: neighborhood.map((n: NodeSingular) => n.id()),
        neighborhoodBB: { w: neighborhoodBB.w, h: neighborhoodBB.h },
        includesFolderNodes: folderNodesInNeighborhood.length > 0,
        folderNodeIdsInNeighborhood: folderNodesInNeighborhood.map((n: NodeSingular) => n.id()),
      }
    };
  }, nodeId);
}

export async function captureTerminalDiagnostic(page: Page): Promise<TerminalDiagnostic | { error: string }> {
  return page.evaluate(() => {
    const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance;
    if (!cy) throw new Error('No cytoscape');
    const shadowNodes = cy.nodes().filter((n: NodeSingular) => n.data('isShadowNode'));
    if (shadowNodes.length === 0) return { error: 'No shadow nodes found' };
    const zoom = cy.zoom();
    const fullWidth = Math.max(cy.width(), 1);
    const fullHeight = Math.max(cy.height(), 1);
    const sidebar = document.querySelector('.terminal-tree-sidebar');
    const folderSidebar = document.querySelector('.folder-tree-sidebar');
    let leftInset = 0;
    if (sidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(sidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += sidebar.getBoundingClientRect().width;
    }
    if (folderSidebar instanceof HTMLElement) {
      const cs = window.getComputedStyle(folderSidebar);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') leftInset += folderSidebar.getBoundingClientRect().width;
    }
    const visibleWidth = Math.max(fullWidth - leftInset, 1);
    const shadowNode = shadowNodes[0];
    const bb = shadowNode.boundingBox();
    const extent = cy.extent();
    const parentNodeId = shadowNode.data('parentNodeId') as string | undefined;
    const parentNode = parentNodeId ? cy.getElementById(parentNodeId) : cy.collection();
    let nodesToFit = cy.collection().union(shadowNode);
    if (parentNode.length > 0) nodesToFit = nodesToFit.union(parentNode);
    const fitBB = nodesToFit.boundingBox();
    const TARGET_FRACTION = 0.95;
    const MIN_ZOOM_THRESHOLD = 0.7;
    const requiredZoom = (fitBB.w > 0 && fitBB.h > 0)
      ? Math.min((visibleWidth * TARGET_FRACTION) / fitBB.w, (fullHeight * TARGET_FRACTION) / fitBB.h)
      : Infinity;
    return {
      zoom, shadowNodeId: shadowNode.id(),
      shadowNodeBB: { w: bb.w, h: bb.h }, parentNodeId,
      combinedBB: { w: fitBB.w, h: fitBB.h },
      requiredZoomForBoth: requiredZoom,
      wouldFallbackToShadowOnly: requiredZoom < MIN_ZOOM_THRESHOLD,
      renderedShadowW: bb.w * zoom, renderedShadowH: bb.h * zoom,
      shadowFractionOfViewport: { w: (bb.w * zoom) / visibleWidth, h: (bb.h * zoom) / fullHeight },
      shadowVisibleInExtent: bb.x2 >= extent.x1 && bb.x1 <= extent.x2 && bb.y2 >= extent.y1 && bb.y1 <= extent.y2,
      visibleViewport: { width: visibleWidth, height: fullHeight, leftInset },
    };
  });
}

export async function captureFolderAnalysis(page: Page): Promise<FolderAnalysis> {
  return page.evaluate(() => {
    const cy = (window as unknown as { cytoscapeInstance?: CytoscapeCore }).cytoscapeInstance;
    if (!cy) throw new Error('No cytoscape');
    const folderNodes = cy.nodes().filter((n: NodeSingular) => n.data('isFolderNode'));
    const allBB = cy.nodes().boundingBox();
    const nonFolderBB = cy.nodes().filter((n: NodeSingular) => !n.data('isFolderNode')).boundingBox();
    return {
      allNodesBB: { w: allBB.w, h: allBB.h },
      nonFolderNodesBB: { w: nonFolderBB.w, h: nonFolderBB.h },
      folderNodes: folderNodes.map((n: NodeSingular) => {
        const bb = n.boundingBox();
        return { id: n.id(), bbW: bb.w, bbH: bb.h, isParent: n.isParent(), childCount: n.children().length };
      }),
      bbExpansionFromFolders: {
        widthDiff: allBB.w - nonFolderBB.w,
        heightDiff: allBB.h - nonFolderBB.h,
        significant: (allBB.w - nonFolderBB.w) > 50 || (allBB.h - nonFolderBB.h) > 50,
      }
    };
  });
}

export function logNavigationDiag(label: string, diag: NavigationDiagnostic): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  Zoom: ${diag.zoom.toFixed(4)}`);
  console.log(`  Visible viewport: ${diag.visibleViewport.width.toFixed(0)}x${diag.visibleViewport.height.toFixed(0)} (left inset: ${diag.visibleViewport.leftInset.toFixed(0)})`);
  console.log(`  Target node model BB: ${diag.targetNodeBB.w.toFixed(0)}x${diag.targetNodeBB.h.toFixed(0)}`);
  console.log(`  Target node rendered: ${diag.targetNodeRenderedSize.renderedW.toFixed(0)}x${diag.targetNodeRenderedSize.renderedH.toFixed(0)} px`);
  console.log(`  Node fraction of viewport: ${(diag.nodeFractionOfViewport.widthFraction * 100).toFixed(1)}% W x ${(diag.nodeFractionOfViewport.heightFraction * 100).toFixed(1)}% H`);
  console.log(`  Target visible in extent: ${diag.targetNodeVisibleInExtent}`);
  console.log(`  Neighborhood: ${diag.neighborhoodInfo.neighborCount} nodes, BB: ${diag.neighborhoodInfo.neighborhoodBB.w.toFixed(0)}x${diag.neighborhoodInfo.neighborhoodBB.h.toFixed(0)}`);
  if (diag.neighborhoodInfo.includesFolderNodes) {
    console.log(`  WARNING: Folder nodes in neighborhood: ${diag.neighborhoodInfo.folderNodeIdsInNeighborhood.join(', ')}`);
  }
}

export function logTerminalDiag(diag: TerminalDiagnostic | { error: string }): void {
  if ('error' in diag) { console.log(`  ERROR: ${diag.error}`); return; }
  console.log(`  Zoom: ${diag.zoom.toFixed(4)}`);
  console.log(`  Shadow node: ${diag.shadowNodeId}, BB: ${diag.shadowNodeBB.w.toFixed(0)}x${diag.shadowNodeBB.h.toFixed(0)}`);
  console.log(`  Parent node: ${diag.parentNodeId}`);
  console.log(`  Combined BB: ${diag.combinedBB.w.toFixed(0)}x${diag.combinedBB.h.toFixed(0)}`);
  console.log(`  Required zoom for both: ${diag.requiredZoomForBoth.toFixed(4)}, fallback to shadow only: ${diag.wouldFallbackToShadowOnly}`);
  console.log(`  Shadow rendered: ${diag.renderedShadowW.toFixed(0)}x${diag.renderedShadowH.toFixed(0)} px`);
  console.log(`  Shadow fraction: ${(diag.shadowFractionOfViewport.w * 100).toFixed(1)}% W x ${(diag.shadowFractionOfViewport.h * 100).toFixed(1)}% H`);
  console.log(`  Shadow visible in extent: ${diag.shadowVisibleInExtent}`);
}
