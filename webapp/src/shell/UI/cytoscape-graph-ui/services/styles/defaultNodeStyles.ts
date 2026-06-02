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

    // Folder compound nodes — subtle dashed outline around sibling files.
    // Chevron + eye affordance chips are NOT rendered as background-image:
    // cytoscape's WebGL renderer rasterizes node body into a texture atlas
    // cell sized to the node's bbox, and a compound folder's bbox encloses
    // every child — so a 44×22 chip ends up as a few pixels in the cell and
    // turns into a blurry grey blob after upscaling. The chips are owned by
    // FolderHandleService as a DOM overlay instead (same rendering path for
    // both expanded folders and collapsed pills).
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

    // User-resized expanded folder — the persisted size rides as
    // folderWidth/folderHeight data (set by applyGraphDeltaToUI from the
    // node-layout sidecar) and maps onto the compound's min-width/min-height.
    // cytoscape still grows the compound to fit its children (bbox is a hard
    // floor); min-* only enlarges it past the contents, with the default
    // centered bias spreading the slack around the children. The collapsed
    // pill rule below has fixed width/height and never carries this data.
    {
      selector: 'node[?isFolderNode][folderWidth][folderHeight]',
      style: {
        'min-width': 'data(folderWidth)',
        'min-height': 'data(folderHeight)',
      }
    },

    // Collapsed folder — pill sized to seat the DOM chip strip (44 wide) plus
    // a label row beneath it. padding:0 overrides the 25px inherited from the
    // general folder rule (that padding exists to give expanded compounds room
    // around their children — meaningless for a collapsed pill).
    //
    // text-margin-y pushes the label down past the 22px chip strip so the
    // chevron+eye chips and the "name (n)" label don't overlap.
    {
      selector: 'node[?isFolderNode][?collapsed]',
      style: {
        'width': 80,
        'height': 48,
        'padding': 0,
        'background-opacity': 0.15,
        'background-color': '#888',
        'border-style': 'solid',
        'label': (ele: { data: (key: string) => unknown }) =>
            `${ele.data('folderLabel')} (${ele.data('childCount') ?? '?'})`,
        'text-valign': 'center',
        'text-margin-y': 13,
        'font-size': 13,
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
