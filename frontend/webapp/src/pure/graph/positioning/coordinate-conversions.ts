import type { Core, Position } from 'cytoscape';

/**
 * Converts graph coordinates to screen coordinates.
 * Screen coordinates account for zoom, pan, and container offset.
 *
 * Formula: screenX = (graphX * zoom) + pan.x + containerRect.left
 *          screenY = (graphY * zoom) + pan.y + containerRect.top
 */
export function toScreenCoords(
  graphX: number,
  graphY: number,
  cy: Core
): { readonly x: number; readonly y: number } {
  const zoom: number = cy.zoom();
  const pan: Position = cy.pan();
  const containerRect: DOMRect = cy.container()!.getBoundingClientRect();

  const result: { readonly x: number; readonly y: number; } = {
    x: (graphX * zoom) + pan.x + containerRect.left,
    y: (graphY * zoom) + pan.y + containerRect.top
  };

  // console.log(`[DEBUG] toScreenCoords: graph(${graphX.toFixed(2)},${graphY.toFixed(2)}) zoom:${zoom.toFixed(2)} pan:(${pan.x.toFixed(2)},${pan.y.toFixed(2)}) rect:(${containerRect.left},${containerRect.top}) -> screen(${result.x.toFixed(2)},${result.y.toFixed(2)})`);

  return result;
}

/**
 * Converts screen coordinates to graph coordinates.
 * Removes the effect of zoom, pan, and container offset.
 *
 * Formula: graphX = (screenX - containerRect.left - pan.x) / zoom
 *          graphY = (screenY - containerRect.top - pan.y) / zoom
 */
export function toGraphCoords(
  screenX: number,
  screenY: number,
  cy: Core
): { readonly x: number; readonly y: number } {
  const zoom: number = cy.zoom();
  const pan: Position = cy.pan();
  const containerRect: DOMRect = cy.container()!.getBoundingClientRect();

  return {
    x: (screenX - containerRect.left - pan.x) / zoom,
    y: (screenY - containerRect.top - pan.y) / zoom
  };
}

/**
 * Scales a scalar value from graph units to screen units.
 * Used for converting distances, sizes, etc.
 *
 * Formula: screenValue = graphValue * zoom
 */
export function graphToScreen(value: number, zoom: number): number {
  return value * zoom;
}

/**
 * Scales a scalar value from screen units to graph units.
 * Used for converting distances, sizes, etc.
 *
 * Formula: graphValue = screenValue / zoom
 */
export function screenToGraph(value: number, zoom: number): number {
  return value / zoom;
}