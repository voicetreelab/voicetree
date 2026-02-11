import type cytoscape from 'cytoscape';
import { updateNodeSizes as updateNodeSizesImpl } from './updateNodeSizes';
import { initializeColorsFromDOM, isDarkMode } from './themeColors';
import { getDefaultNodeStyles } from './defaultNodeStyles';
import { getDefaultEdgeStyles } from './defaultEdgeStyles';
import { getBreathingAnimationStyles } from './breathingAnimationStyles';
import { getFrontmatterStyles } from './frontmatterStyles';

type StyleRule = { selector: string; style: Record<string, unknown> };

/**
 * Thin composition layer that assembles graph styles from extracted modules.
 * Preserves the class API for existing consumers.
 */
export class StyleService {
  private readonly colors;
  private readonly font;
  private readonly dark: boolean;

  constructor() {
    const { colors, font } = initializeColorsFromDOM();
    this.colors = colors;
    this.font = font;
    this.dark = isDarkMode();
  }

  getDefaultStylesheet(): StyleRule[] {
    return [
      ...getDefaultNodeStyles(this.colors, this.font, this.dark),
      ...getDefaultEdgeStyles(this.colors, this.font, this.dark),
      ...getBreathingAnimationStyles(),
    ];
  }

  getFrontmatterStylesheet(): StyleRule[] {
    return getFrontmatterStyles();
  }

  getCombinedStylesheet(): StyleRule[] {
    return [
      ...this.getDefaultStylesheet(),
      ...this.getFrontmatterStylesheet(),
    ];
  }

  /**
   * Update node sizes based on their degree (number of connections)
   * @param cy - Cytoscape instance
   * @param nodes - Optional specific nodes to update. If not provided, updates all nodes.
   */
  updateNodeSizes(cy: cytoscape.Core, nodes?: cytoscape.NodeCollection): void {
    updateNodeSizesImpl(cy, nodes);
  }
}
