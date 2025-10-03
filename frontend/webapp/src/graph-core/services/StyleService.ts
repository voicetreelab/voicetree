import type { Stylesheet } from 'cytoscape';
import {
  MIN_NODE_SIZE,
  MAX_NODE_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_TEXT_WIDTH,
  MAX_TEXT_WIDTH,
  DEFAULT_TEXT_WIDTH,
} from '@/graph-core/constants';

export class StyleService {
  private fillColor = '#3f3f3f';
  private fillHighlightColor = '#525252';
  private accentBorderColor = '#4b96ff';
  private lineColor = '#5e5e5e';
  private lineHighlightColor = '#7c7c7c';
  private textColor = '#dcddde';
  private danglingColor = '#683c3c';
  private font = 'Helvetica Neue, Helvetica, Arial, sans-serif';

  constructor() {
    // Try to get colors from document if available
    if (typeof document !== 'undefined') {
      this.initializeColors();
    }
  }

  private initializeColors(): void {
    const style = getComputedStyle(document.body);

    // Try to get font
    const fontValue = style.getPropertyValue('--text');
    if (fontValue && fontValue.length > 0) {
      this.font = fontValue.replace('BlinkMacSystemFont,', '');
    }

    // Try to get graph colors if they exist
    const graphColors = this.getGraphColors();
    if (graphColors) {
      Object.assign(this, graphColors);
    }
  }

  private getGraphColors() {
    // Simulate getting graph view colors
    // In a real implementation, these would come from your app's theme
    return {
      fillColor: '#3f3f3f',
      fillHighlightColor: '#525252',
      accentBorderColor: '#4b96ff',
      lineColor: '#5e5e5e',
      lineHighlightColor: '#7c7c7c',
      textColor: '#dcddde',
      danglingColor: '#683c3c',
    };
  }

  getDefaultStylesheet(): Stylesheet[] {
    return [
      // Base node styles
      {
        selector: 'node',
        style: {
          'background-color': this.fillColor,
          'color': this.textColor,
          'font-family': this.font,
          'text-valign': 'center' as cytoscape.Css.TextVAlign,
          'text-halign': 'center' as cytoscape.Css.TextHAlign,
          'shape': 'ellipse',
          'border-width': 0,
          'text-wrap': 'wrap',
          'text-max-width': `${DEFAULT_TEXT_WIDTH}px`,  // Default text width for wrapping
          'min-zoomed-font-size': 8,
          'overlay-opacity': 0,
        }
      },

      // Node labels - support both 'name' and 'label' fields
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

      // Node sizing based on degree (when degree data is available)
      {
        selector: 'node[degree]',
        style: {
          'width': `mapData(degree, 0, 60, ${MIN_NODE_SIZE}, ${MAX_NODE_SIZE})`,
          'height': `mapData(degree, 0, 60, ${MIN_NODE_SIZE}, ${MAX_NODE_SIZE})`,
          'font-size': `mapData(degree, 0, 60, ${MIN_FONT_SIZE}, ${MAX_FONT_SIZE})`,
          'text-opacity': 'mapData(degree, 0, 60, 0.7, 1)',
          'text-max-width': `mapData(degree, 0, 60, ${MIN_TEXT_WIDTH}, ${MAX_TEXT_WIDTH})`,
        }
      },

      // Selected node
      {
        selector: 'node:selected',
        style: {
          'background-blacken': 0.3,
          'font-weight': 'bold',
          'border-width': 'mapData(degree, 0, 60, 1, 3)',
        }
      },

      // Hover effects
      {
        selector: 'node.hover',
        style: {
          'background-color': this.fillHighlightColor,
          'font-weight': 'bold',
          'border-width': 2,
          'border-color': this.accentBorderColor,
          'opacity': 1,
        }
      },

      {
        selector: '.unhover',
        style: {
          'opacity': 0.3,
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
          'background-color': this.danglingColor,
        }
      },

      // Edge styles
      {
        selector: 'edge',
        style: {
          'line-color': this.lineColor,
          'loop-sweep': '-50deg',
          'loop-direction': '-45deg',
          'width': 0.7,
          'target-arrow-shape': 'vee',
          'target-arrow-fill': 'filled' as cytoscape.Css.ArrowFill,
          'target-arrow-color': this.lineColor,
          'arrow-scale': 0.55,
          'font-size': 6,
          'font-family': this.font,
          'color': this.textColor,
          'curve-style': 'straight',
        }
      },

      // Edge sizing based on count
      {
        selector: 'edge[edgeCount]',
        style: {
          'width': 'mapData(edgeCount, 1, 50, 0.55, 3)',
          'arrow-scale': 'mapData(edgeCount, 1, 50, 0.35, 1.5)',
        }
      },

      // Selected edge
      {
        selector: 'edge:selected',
        style: {
          'width': 0.7,
          'font-weight': 'bold',
          'line-color': this.lineHighlightColor,
        }
      },

      // Connected hover states
      {
        selector: 'edge.connected-hover',
        style: {
          'width': 1,
          'opacity': 1,
          'font-weight': 'bold',
          'line-color': this.lineHighlightColor,
          'target-arrow-color': this.lineHighlightColor,
        }
      },

      // Hide self-loops
      {
        selector: ':loop',
        style: {
          'display': 'none',
        }
      },

      // Filtered nodes
      {
        selector: 'node.filtered',
        style: {
          'display': 'none',
        }
      },
    ];
  }

  getFrontmatterStylesheet(): Stylesheet[] {
    // YAML frontmatter-based styling
    return [
      {
        selector: 'node[title]',
        style: {
          'label': 'data(title)',
        }
      },
      {
        selector: 'node[color]',
        style: {
          'background-color': 'data(color)',
        }
      },
      {
        selector: 'node[shape]',
        style: {
          'shape': 'data(shape)' as cytoscape.Css.NodeShape,
        }
      },
      {
        selector: 'node[width]',
        style: {
          'width': 'data(width)',
        }
      },
      {
        selector: 'node[height]',
        style: {
          'height': 'data(height)',
        }
      },
      {
        selector: 'node[image]',
        style: {
          'background-image': 'data(image)',
          'background-fit': 'contain',
        }
      },
    ];
  }

  getCombinedStylesheet(): Stylesheet[] {
    return [
      ...this.getDefaultStylesheet(),
      ...this.getFrontmatterStylesheet(),
    ];
  }
}