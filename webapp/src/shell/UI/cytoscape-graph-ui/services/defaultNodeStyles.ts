import { DEFAULT_TEXT_WIDTH } from '@/shell/UI/cytoscape-graph-ui/constants';
import type { GraphColorPalette } from './themeColors';
import { getGoldColor } from './themeColors';

type StyleRule = { selector: string; style: Record<string, unknown> };

/** Returns all node-related Cytoscape style rules */
export function getDefaultNodeStyles(colors: GraphColorPalette, font: string, isDark: boolean): StyleRule[] {
  return [
    // Base node styles
    {
      selector: 'node',
      style: {
        'background-color': colors.fillColor,
        'color': colors.textColor,
        'font-family': font,
        'font-weight': 800, // increased from bold (700) for better visibility at 2x scale
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -16, // 2x scale (was 8), negative = above node
        'shape': 'ellipse',
        'border-width': 1,
        'border-color': '#666',
        'text-wrap': 'wrap',
        'text-max-width': `${DEFAULT_TEXT_WIDTH}px`,  // Default text width for wrapping
        'min-zoomed-font-size': 15, // 1.5x scale (was 10)
        'overlay-opacity': 0,
      }
    },

    // Folder compound nodes — subtle dashed outline around sibling files
    {
      selector: 'node[?isFolderNode]',
      style: {
        'shape': 'roundrectangle',
        'background-opacity': 0,
        'border-width': 1.5,
        'border-style': 'dashed',
        'border-color': '#888',
        'border-opacity': 0.5,
        'padding': 25,
        'compound-sizing-wrt-labels': 'exclude',
        'label': 'data(folderLabel)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 20,
        'color': '#888',
        'min-zoomed-font-size': 0,
      }
    },

    // Task nodes - nodes with running terminals/agents become squares
    {
      selector: 'node[?hasRunningTerminal]',
      style: {
        'shape': 'rectangle',
      }
    },

    // GraphNode labels - support both 'name' and 'label' fields
    {
      selector: 'node[label]',
      style: {
        'label': 'data(label)',
      }
    },

    {
      selector: 'node[name]',
      style: {
        'label': 'data(name)',
      }
    },


    // Hover effects
    {
      selector: 'node.hover',
      style: {
        'background-color': colors.fillHighlightColor,
        'font-weight': 'bold',
        'border-width': 2,
        'border-color': colors.accentBorderColor,
        'opacity': 1,
      }
    },

    // Pinned nodes
    {
      selector: 'node.pinned',
      style: {
        'border-style': 'solid',
        'border-width': 2,
        'border-color': 'rgba(0, 255, 255, 0.8)',
      }
    },

    // Dangling nodes
    {
      selector: '.dangling',
      style: {
        'background-color': colors.danglingColor,
      }
    },

    // Filtered nodes
    {
      selector: 'node.filtered',
      style: {
        'display': 'none',
      }
    },

    // Context node highlighting - contained nodes (underlay halo, WebGL-compatible)
    {
      selector: 'node.context-contained',
      style: {
        'underlay-color': getGoldColor(isDark),
        'underlay-opacity': 0.6,
        'underlay-padding': 8,
        'underlay-shape': 'ellipse',
      }
    },

    // Active terminal highlighting - subtle gold halo on shadow node (behind terminal window)
    // Primary gold border is applied to terminal DOM element in floating-windows.css
    {
      selector: 'node.terminal-active',
      style: {
        'underlay-color': getGoldColor(isDark),
        'underlay-opacity': 0.4,
        'underlay-padding': 11,
        'underlay-shape': 'ellipse',
      }
    },

    // Selected nodes - green underlay halo (WebGL-compatible)
    {
      selector: 'node:selected',
      style: {
          'underlay-color': '#00cc66',
          'underlay-opacity': 0.5,
          'underlay-padding': 12,
          'underlay-shape': 'ellipse',
      }
    },
  ];
}
