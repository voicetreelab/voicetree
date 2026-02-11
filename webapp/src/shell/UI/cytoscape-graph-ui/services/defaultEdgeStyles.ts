import cytoscape from 'cytoscape';
import type { GraphColorPalette } from './themeColors';
import { getGoldEdgeColor } from './themeColors';

type StyleRule = { selector: string; style: Record<string, unknown> };

/** Returns all edge-related Cytoscape style rules */
export function getDefaultEdgeStyles(colors: GraphColorPalette, font: string, isDark: boolean): StyleRule[] {
  return [
    // Edge styles
    {
      selector: 'edge',
      style: {
        'line-color': colors.lineColor,
        'loop-sweep': '-50deg',
        'loop-direction': '-45deg',
        'width': 3,
        'line-opacity': 0.5, // Increased from 0.3 for better visibility in dark mode
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'hollow' as cytoscape.Css.ArrowFill,
        'target-arrow-color': colors.lineColor,
        'arrow-scale': 0.7,
        'font-size': 10.5,
        'font-family': font,
        'color': colors.textColor,
        'curve-style': 'straight',
      }
    },

    // Edge labels - display label from data
    {
      selector: 'edge[label]',
      style: {
        'label': 'data(label)',
        'text-rotation': 'none',
      }
    },

    // Edge sizing based on count
    {
      selector: 'edge[edgeCount]',
      style: {
        'width': 'mapData(edgeCount, 1, 50, 1, 5)',
        'arrow-scale': 'mapData(edgeCount, 1, 50, 0.35, 1.5)',
        'line-opacity': 'mapData(edgeCount, 1, 10, 0.35, 0.6)', // Increased min/max for visibility
      }
    },

    // Connected hover states
    {
      selector: 'edge.connected-hover',
      style: {
        'width': 2,
        'opacity': 1,
        'font-weight': 'bold',
        'line-color': colors.lineHighlightColor,
        'target-arrow-color': colors.lineHighlightColor,
      }
    },

    // Hide self-loops
    {
      selector: ':loop',
      style: {
        'display': 'none',
      }
    },

    // Context node highlighting - edges to contained nodes
    {
      selector: 'edge.context-edge',
      style: {
        'line-color': getGoldEdgeColor(isDark),
        'line-opacity': 0.8,
        'width': 3,
      }
    },

    // terminal -> created nodes indicator edges (hidden by default, shown when terminal active)
    {
        selector: 'edge.terminal-progres-nodes-indicator',
        style: {
            'display': 'none',
            'line-style': 'dashed',
            'line-dash-pattern': [1, 8],
            'line-cap': 'round',
            'line-color': colors.agentEdgeColor,
            'line-opacity': 0.5,
            'width': 4,
            'target-arrow-shape': 'none',
            'curve-style': 'straight',
        }
    },
    // Show terminal -> created nodes edges when terminal is active
    {
        selector: 'edge.terminal-progres-nodes-indicator.terminal-active',
        style: {
            'display': 'element',
        }
    },

    // floating-window indicator edges (base style - inactive state)
    // IMPORTANT: Must come BEFORE terminal-active style so gold can override
    {
      selector: 'edge.terminal-indicator',
      style: {
        'line-style': 'dotted',
        'line-color': '#888888',
        'line-opacity': 0.8,
        'width': 4,
        'target-arrow-shape': 'none',
        'curve-style': 'straight',
      }
    },

    // Active terminal highlighting - gold color for task node -> terminal edge
    // Must come AFTER base terminal-indicator style to override it
    {
      selector: 'edge.terminal-indicator.terminal-active',
      style: {
        'line-color': getGoldEdgeColor(isDark),
        'line-opacity': 1,
        'width': 5,
      }
    },
  ];
}
