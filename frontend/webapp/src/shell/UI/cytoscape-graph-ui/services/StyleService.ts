import cytoscape from 'cytoscape';
import {
  DEFAULT_TEXT_WIDTH,
} from '@/shell/UI/cytoscape-graph-ui/constants';

export class StyleService {
  private fillColor = '#3f3f3f';
  private fillHighlightColor = '#525252';
  private accentBorderColor = '#4b96ff';
  private lineColor = '#5e5e5e';
  private lineHighlightColor = '#7c7c7c';
  private textColor = '#dcddde';
  private danglingColor = '#683c3c';
  private font = '"Fira Code", Fira Code, "Fira Mono", Menlo, Consolas, "DejaVu - Sans Mono", monospace';

  constructor() {
    // Try to get colors from document if available
    if (typeof document !== 'undefined') {
      this.initializeColors();
    }
    console.log('[StyleService] Using font:', this.font);
  }

  public debugThemeDetection(): void {
    console.log('=== StyleService Theme Detection Debug ===');
    console.log('Current textColor:', this.textColor);
    console.log('isDarkMode():', this.isDarkMode());

    if (typeof window !== 'undefined' && window.matchMedia) {
      const darkModeQuery: MediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
      console.log('prefers-color-scheme: dark matches:', darkModeQuery.matches);
    } else {
      console.log('window.matchMedia not available');
    }

    if (typeof document !== 'undefined') {
      console.log('html.classList.contains("dark"):', document.documentElement.classList.contains('dark'));
      console.log('body.classList.contains("dark"):', document.body.classList.contains('dark'));
    }

    console.log('Expected textColor for dark mode: #dcddde (light grey)');
    console.log('Expected textColor for light mode: #2a2a2a (dark grey)');
    console.log('==========================================');
  }

  private initializeColors(): void {
    const style: CSSStyleDeclaration = getComputedStyle(document.body);

    // Try to get font
    const fontValue: string = style.getPropertyValue('--text');
    if (fontValue && fontValue.length > 0) {
      this.font = fontValue.replace('BlinkMacSystemFont,', '');
    }

    // Try to get graph colors if they exist
    const graphColors: { fillColor: string; fillHighlightColor: string; accentBorderColor: string; lineColor: string; lineHighlightColor: string; textColor: string; danglingColor: string; } = this.getGraphColors();
    if (graphColors) {
      Object.assign(this, graphColors);
    }
  }

  private isDarkMode(): boolean {
    if (typeof window === 'undefined') return false; // Default to light mode on server

    // ONLY check for dark class on html or body
    // This respects the app's explicit theme setting and ignores OS preference
    // The app's theme toggle controls the 'dark' class, which should be the single source of truth
    if (typeof document !== 'undefined') {
      const html: HTMLElement = document.documentElement;
      const body: HTMLElement = document.body;
      if (html?.classList.contains('dark') || body?.classList.contains('dark')) {
        return true;
      }
    }

    // Default to light mode if no dark class is present
    return false;
  }

  private getGraphColors(): { fillColor: string; fillHighlightColor: string; accentBorderColor: string; lineColor: string; lineHighlightColor: string; textColor: string; danglingColor: string; } {
    const isDark: boolean = this.isDarkMode();

    console.log('[StyleService] getGraphColors - isDark:', isDark, 'textColor:', isDark ? '#dcddde' : '#2a2a2a');

    return {
      fillColor: isDark ? '#5a6065' :'#3f3f3f', // Darker nodes in dark mode for softer contrast
      fillHighlightColor: isDark ? '#6a6e73' : '#525252',
      accentBorderColor: '#4b96ff',
      lineColor: isDark ? '#c0c5cc' : '#5e5e5e', // Lighter edges in dark mode for better visibility
      lineHighlightColor: isDark ? '#a0a8b0' : '#7c7c7c', // Lighter highlight in dark mode
      textColor: isDark ? '#c5c8cc' : '#2a2a2a', // Soft off-white for dark mode
      danglingColor: '#683c3c',
    };
  }

  getDefaultStylesheet(): Array<{ selector: string; style: Record<string, unknown> }> {
    return [
      // Base node styles
      {
        selector: 'node',
        style: {
          'background-color': this.fillColor,
          'color': this.textColor,
          'font-family': this.font,
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
          'width': 3,
          'line-opacity': 0.5, // Increased from 0.3 for better visibility in dark mode
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'hollow' as cytoscape.Css.ArrowFill,
          'target-arrow-color': this.lineColor,
          'arrow-scale': 0.7,
          'font-size': 10.5,
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

      // Context node highlighting - contained nodes (uses outline with offset for halo effect)
      {
        selector: 'node.context-contained',
        style: {
          'outline-width': 4,
          'outline-color': '#FFD700',  // Gold
          'outline-offset': 10,
          'outline-opacity': 1,
        }
      },

      // Context node highlighting - edges to contained nodes
      {
        selector: 'edge.context-edge',
        style: {
          'line-color': '#FFD700',
          'line-opacity': 1,
          'width': 6,
        }
      },


        // terminal -> created nodes indicator edges.
        {
            selector: 'edge.terminal-progres-nodes-indicator',
            style: {
                'line-style': 'dotted',
                'line-color': '#100eb2',
                'line-opacity': 0.5,
                'width': 1,
                'target-arrow-shape': 'none',
                'curve-style': 'straight',
            }
        },

      // floating-window indicator edges.
      {
        selector: 'edge.terminal-indicator',
        style: {
          'line-style': 'dotted',
          'line-color': '#888888',
          'line-opacity': 0.8,
          'width': 1.5,
          'target-arrow-shape': 'none',
          'curve-style': 'straight',
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

      // Breathing animation states - pinned nodes (orange)
      {
        selector: 'node.breathing-pinned-expand',
        style: {
          'border-width': 4,
          'border-color': 'rgba(255, 165, 0, 0.9)',
          'border-opacity': 0.8,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '800ms',
          'transition-timing-function': 'ease-in-out',
        }
      },
      {
        selector: 'node.breathing-pinned-contract',
        style: {
          'border-width': 2,
          'border-color': 'rgba(255, 165, 0, 0.4)',
          'border-opacity': 0.6,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '800ms',
          'transition-timing-function': 'ease-in-out',
        }
      },

      // Breathing animation states - new nodes (green)
      {
        selector: 'node.breathing-new-expand',
        style: {
          'border-width': 4,
          'border-color': 'rgba(0, 255, 0, 0.9)',
          'border-opacity': 0.8,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '1000ms',
          'transition-timing-function': 'ease-in-out',
        }
      },
      {
        selector: 'node.breathing-new-contract',
        style: {
          'border-width': 2,
          'border-color': 'rgba(0, 255, 0, 0.5)',
          'border-opacity': 0.7,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '1000ms',
          'transition-timing-function': 'ease-in-out',
        }
      },

      // Breathing animation states - appended content (cyan)
      {
        selector: 'node.breathing-appended-expand',
        style: {
          'border-width': 4,
          'border-color': 'rgba(0, 255, 255, 0.9)',
          'border-opacity': 0.8,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '1200ms',
          'transition-timing-function': 'ease-in-out',
        }
      },
      {
        selector: 'node.breathing-appended-contract',
        style: {
          'border-width': 2,
          'border-color': 'rgba(0, 255, 255, 0.6)',
          'border-opacity': 0.7,
          'border-style': 'solid',
          'transition-property': 'border-width, border-color, border-opacity',
          'transition-duration': '1200ms',
          'transition-timing-function': 'ease-in-out',
        }
      },
    ];
  }

  getFrontmatterStylesheet(): Array<{ selector: string; style: Record<string, unknown> }> {
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
          'shape': 'data(shape)',
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
      // Hide label when hover editor is open (editor shows the title)
      // Placed at end to override all label-setting rules above
      {
        selector: 'node.hover-editor-open[label]',
        style: {
          'label': '',
        }
      },
      {
        selector: 'node.hover-editor-open[name]',
        style: {
          'label': '',
        }
      },
      {
        selector: 'node.hover-editor-open[title]',
        style: {
          'label': '',
        }
      },
    ];
  }

  getCombinedStylesheet(): Array<{ selector: string; style: Record<string, unknown> }> {
    const stylesheet: { selector: string; style: Record<string, unknown>; }[] = [
      ...this.getDefaultStylesheet(),
      ...this.getFrontmatterStylesheet(),
    ];
    console.log('[StyleService] Combined stylesheet font-family:',
      stylesheet.find(s => s.selector === 'node')?.style['font-family']);
    return stylesheet;
  }

  /**
   * Update node sizes based on their degree (number of connections)
   * @param cy - Cytoscape instance
   * @param nodes - Optional specific nodes to update. If not provided, updates all nodes.
   */
  updateNodeSizes(cy: cytoscape.Core, nodes?: cytoscape.NodeCollection): void {
    if (!cy) return;

    const nodesToUpdate: cytoscape.NodeCollection = nodes ?? cy.nodes();

    // Helper to validate that a value is a healthy non-negative number
    const isValidNumber: (val: number) => boolean = (val: number): boolean =>
      typeof val === 'number' && !isNaN(val) && isFinite(val) && val >= 0;

    nodesToUpdate.forEach(node => {
      // Skip shadow nodes - they have fixed dimensions set by floating window system
      if (node.data('isShadowNode')) return;

      let degree: number = node.degree();

      // Defensive check: ensure degree is a valid number, default to 0 if not
      if (!isValidNumber(degree)) {
        console.warn(`[StyleService] Invalid degree value for node ${node.id()}: ${degree}, defaulting to 0`);
        degree = 0;
      }

      // Logarithmic + linear scaling
      // This creates strong emphasis on low-to-mid degree differences
      // while still rewarding high-degree nodes
      const size: number = 5 + 15 * Math.log(degree + 3) + degree;

      // Scale other properties proportionally to size
      // Use size as base and scale others relative to it
      const width: number = size*0.7; // nodes themselves don't care visual information, so scale smaller.
      const height: number = size*0.7;
      const fontSize: number = 10 + size / 7; // Font scales with size (increased from 8 + size/8)
      const textWidth: number = size * 3 + 40; // Text width scales with size
      const borderWidth: number = 1 + size / 15; // Border scales with size
      const textOpacity: number = Math.min(1, 0.7 + degree / 100); // Slight opacity increase with degree

      // Validate all calculated values before applying
      if (!isValidNumber(width) || !isValidNumber(height) || !isValidNumber(fontSize) ||
          !isValidNumber(textWidth) || !isValidNumber(borderWidth) || !isValidNumber(textOpacity)) {
        console.error(`[StyleService] Calculated invalid style values for node ${node.id()}:`, {
          degree, size, width, height, fontSize, textWidth, borderWidth, textOpacity
        });
        return; // Skip this node to prevent NaN styles
      }

      node.style({
        'width': width,
        'height': height,
        'font-size': fontSize,
        'text-max-width': textWidth,
        'border-width': borderWidth,
        'text-opacity': textOpacity
      });
    });
  }
}
