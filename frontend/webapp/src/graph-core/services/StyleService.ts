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

  public debugThemeDetection(): void {
    console.log('=== StyleService Theme Detection Debug ===');
    console.log('Current textColor:', this.textColor);
    console.log('isDarkMode():', this.isDarkMode());

    if (typeof window !== 'undefined' && window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      console.log('prefers-color-scheme: dark matches:', darkModeQuery.matches);
    } else {
      console.log('window.matchMedia not available');
    }

    if (typeof document !== 'undefined') {
      console.log('html.classList.contains("dark"):', document.documentElement.classList.contains('dark'));
      console.log('body.classList.contains("dark"):', document.body.classList.contains('dark'));
    }

    console.log('Expected textColor for dark mode: #dcddde');
    console.log('Expected textColor for light mode: #2a2a2a');
    console.log('==========================================');
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

  private isDarkMode(): boolean {
    if (typeof window === 'undefined') return false; // Default to light mode on server

    // Check for dark class on html or body FIRST (more reliable)
    if (typeof document !== 'undefined') {
      const html = document.documentElement;
      const body = document.body;
      if (html?.classList.contains('dark') || body?.classList.contains('dark')) {
        return true;
      }
    }

    // Check for prefers-color-scheme
    if (window.matchMedia) {
      try {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (darkModeQuery.matches) {
          return true;
        }
      } catch (e) {
        // matchMedia might not be fully available yet
        console.warn('[StyleService] matchMedia check failed:', e);
      }
    }

    // Default to light mode if can't determine
    return false;
  }

  private getGraphColors() {
    const isDark = this.isDarkMode();

    return {
      fillColor: '#3f3f3f',
      fillHighlightColor: '#525252',
      accentBorderColor: '#4b96ff',
      lineColor: '#5e5e5e',
      lineHighlightColor: '#7c7c7c',
      textColor: isDark ? '#dcddde' : '#2a2a2a',
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
          'text-valign': 'bottom' as cytoscape.Css.TextVAlign,
          'text-halign': 'center' as cytoscape.Css.TextHAlign,
          'text-margin-y': 3,
          'shape': 'ellipse',
          'border-width': 1,
          'border-color': '#666',
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
          'border-width': 'mapData(degree, 1, 10, 1, 8)',
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
          'width': 2,
          'line-opacity': 0.3,
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'hollow' as cytoscape.Css.ArrowFill,
          'target-arrow-color': '#666',
          'arrow-scale': 0.7,
          'shadow-blur': 2,
          'shadow-color': '#333',
          'shadow-opacity': 0.3,
          'shadow-offset-x': 0,
          'shadow-offset-y': 0,
          'font-size': 11,
          'font-family': this.font,
          'color': this.textColor,
          'curve-style': 'straight',
        }
      },

      // Edge labels - display label from data
      {
        selector: 'edge[label]',
        style: {
          'label': 'data(label)',
          'text-rotation': 'autorotate',
        }
      },

      // Edge sizing based on count
      {
        selector: 'edge[edgeCount]',
        style: {
          'width': 'mapData(edgeCount, 1, 50, 0.55, 3)',
          'arrow-scale': 'mapData(edgeCount, 1, 50, 0.35, 1.5)',
          'line-opacity': 'mapData(edgeCount, 1, 10, 0.2, 0.4)',
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