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
        'font-weight': 'bold',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'shape': 'ellipse',
        'border-width': 1,
        'border-color': '#666',
        'text-wrap': 'wrap',
        'text-max-width': `${DEFAULT_TEXT_WIDTH}px`,  // Default text width for wrapping
        'min-zoomed-font-size': 10,
        'overlay-opacity': 0,
      }
    },

    // Context nodes - square shape with lighter gray
    {
      selector: 'node[?isContextNode]',
      style: {
        'shape': 'rectangle',
        'background-color': '#7a7a7a',
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

    // Context node highlighting - contained nodes (uses outline with offset for halo effect)
    {
      selector: 'node.context-contained',
      style: {
        'outline-width': 2,
        'outline-color': getGoldColor(isDark),
        'outline-offset': 6,
        'outline-opacity': 0.8,
      }
    },

    // Active terminal highlighting - subtle gold outline on shadow node (behind terminal window)
    // Primary gold border is applied to terminal DOM element in floating-windows.css
    {
      selector: 'node.terminal-active',
      style: {
        'outline-width': 3,
        'outline-color': getGoldColor(isDark),
        'outline-offset': 8,
        'outline-opacity': 0.6,
      }
    },

    // Selected nodes - green rounded rectangle underlay
    {
      selector: 'node:selected',
      style: {
          'outline-width': 2,
          'outline-color': '#00cc66',
          'outline-offset': 10,
          'outline-opacity': 1
      }
    },
  ];
}
