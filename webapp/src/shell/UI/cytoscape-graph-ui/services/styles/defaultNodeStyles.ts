import { DEFAULT_TEXT_WIDTH } from '@/shell/UI/cytoscape-graph-ui/constants';
import type { GraphColorPalette } from './themeColors';
import { getGoldColor } from './themeColors';

type StyleRule = { selector: string; style: Record<string, unknown> };

/** Top-left pixel size of the chevron chip — kept here so the hit-test in
 *  FolderHandleService can reference the same size as the rendered image. */
export const FOLDER_CHEVRON_HIT_SIZE_PX = 22;

// 22×22 chevron chip rendered natively as a cytoscape node background-image so
// pan/zoom stay GPU-cheap. Pill outline border-radius 12 0 8 0, rgba(45,45,48,0.92)
// fill, 1.5px #888 stroke; chevron stroke #d4d4d4.
// Explicit width/height (not just viewBox) so the Image() decoder reports
// non-zero imgW/imgH — cytoscape's drawInscribedImage silently no-ops on a 0 source rect.
const FOLDER_CHEVRON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${FOLDER_CHEVRON_HIT_SIZE_PX}" height="${FOLDER_CHEVRON_HIT_SIZE_PX}" viewBox="0 0 22 22">` +
  `<path d="M12 0.75 H21.25 V14 A7.25 7.25 0 0 1 14 21.25 H0.75 V12 A11.25 11.25 0 0 1 12 0.75 Z" ` +
  `fill="#2d2d30" fill-opacity="0.92" stroke="#888" stroke-width="1.5"/>` +
  `<path d="M8 9 L11 13 L14 9" stroke="#d4d4d4" stroke-width="1.5" fill="none" ` +
  `stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
const FOLDER_CHEVRON_DATA_URI =
  `data:image/svg+xml;utf8,${encodeURIComponent(FOLDER_CHEVRON_SVG)}`;

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
        // Halo so labels stay legible when they overlap a sibling node's fill.
        'text-outline-color': isDark ? '#1e1e1e' : '#ffffff',
        'text-outline-width': 2,
        'text-outline-opacity': 1,
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

    // Collapsed folder — fixed size box with child count badge
    {
      selector: 'node[?isFolderNode][?collapsed]',
      style: {
        'width': 40,
        'height': 40,
        'background-opacity': 0.15,
        'background-color': '#888',
        'border-style': 'solid',
        'label': (ele: { data: (key: string) => unknown }) =>
            `${ele.data('folderLabel')} (${ele.data('childCount') ?? '?'})`,
        'text-valign': 'center',
        'font-size': 14,
      }
    },

    // Expanded folder — TL chevron chip rendered as a node background-image.
    // Replaces the per-frame DOM-overlay positioning that was breaking
    // trackpad pan (see FolderHandleService for the corresponding tap hit-test).
    {
      selector: 'node[?isFolderNode][!collapsed]',
      style: {
        'background-image': FOLDER_CHEVRON_DATA_URI,
        'background-position-x': '0%',
        'background-position-y': '0%',
        'background-width': `${FOLDER_CHEVRON_HIT_SIZE_PX}px`,
        'background-height': `${FOLDER_CHEVRON_HIT_SIZE_PX}px`,
        'background-fit': 'none',
        'background-clip': 'none',
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

    // Folder nodes must not get the green selection underlay — it covers the
    // entire compound area and blocks clicks on children inside the folder.
    {
      selector: 'node[?isFolderNode]:selected',
      style: {
          'underlay-opacity': 0,
      }
    },
  ];
}
