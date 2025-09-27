import type { NodeSingular, NodeCollection } from 'cytoscape';

export enum AnimationType {
  PINNED = 'pinned',
  NEW_NODE = 'new_node',
  APPENDED_CONTENT = 'appended_content',
}

interface AnimationConfig {
  duration: number;
  timeout: number;
  expandWidth: number;
  expandColor: string;
  expandOpacity: number;
  contractColor: string;
  contractOpacity: number;
}

export class BreathingAnimationService {
  private activeAnimations: Map<string, NodeJS.Timeout> = new Map();
  private configs: Map<AnimationType, AnimationConfig>;

  constructor() {
    this.configs = new Map([
      [AnimationType.PINNED, {
        duration: 800,
        timeout: 0, // No timeout for pinned
        expandWidth: 4,
        expandColor: 'rgba(255, 165, 0, 0.9)', // Orange
        expandOpacity: 0.8,
        contractColor: 'rgba(255, 165, 0, 0.4)',
        contractOpacity: 0.6,
      }],
      [AnimationType.NEW_NODE, {
        duration: 1000,
        timeout: 5000, // 5 seconds
        expandWidth: 4,
        expandColor: 'rgba(0, 255, 0, 0.9)', // Green
        expandOpacity: 0.8,
        contractColor: 'rgba(0, 255, 0, 0.5)',
        contractOpacity: 0.7,
      }],
      [AnimationType.APPENDED_CONTENT, {
        duration: 1200,
        timeout: 15000, // 15 seconds
        expandWidth: 4,
        expandColor: 'rgba(0, 255, 255, 0.9)', // Cyan
        expandOpacity: 0.8,
        contractColor: 'rgba(0, 255, 255, 0.6)',
        contractOpacity: 0.7,
      }],
    ]);
  }

  addBreathingAnimation(nodes: NodeCollection, type: AnimationType = AnimationType.NEW_NODE): void {
    const config = this.configs.get(type)!;

    nodes.forEach((node) => {
      const nodeId = node.id();

      // Stop any existing animation
      this.stopAnimation(nodeId);

      // Store original border values
      const originalBorderWidth = node.style('border-width') || '0';
      const originalBorderColor = node.style('border-color') || 'rgba(0, 0, 0, 0)';

      node.data('originalBorderWidth', originalBorderWidth);
      node.data('originalBorderColor', originalBorderColor);
      node.data('breathingActive', true);
      node.data('animationType', type);

      // Start animation
      this.animateNode(node, config);

      // Set timeout if needed
      if (config.timeout > 0) {
        const timeout = setTimeout(() => {
          this.stopAnimationForNode(node);
        }, config.timeout);
        this.activeAnimations.set(nodeId, timeout);
      }
    });
  }

  private animateNode(node: NodeSingular, config: AnimationConfig): void {
    if (!node.data('breathingActive')) {
      return;
    }

    const animate = () => {
      if (!node.data('breathingActive')) {
        return;
      }

      // Expand animation
      node.animate({
        style: {
          'border-width': config.expandWidth,
          'border-color': config.expandColor,
          'border-opacity': config.expandOpacity,
          'border-style': 'solid',
        },
        duration: config.duration,
        easing: 'ease-in-out-sine',
        complete: () => {
          if (!node.data('breathingActive')) {
            return;
          }

          // Contract animation
          node.animate({
            style: {
              'border-width': 2,
              'border-color': config.contractColor,
              'border-opacity': config.contractOpacity,
            },
            duration: config.duration,
            easing: 'ease-in-out-sine',
            complete: () => {
              // Repeat the animation
              if (node.data('breathingActive')) {
                animate();
              }
            }
          });
        }
      });
    };

    animate();
  }

  stopAnimation(nodeId: string): void {
    const timeout = this.activeAnimations.get(nodeId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeAnimations.delete(nodeId);
    }
  }

  stopAnimationForNode(node: NodeSingular): void {
    const nodeId = node.id();

    // Mark as inactive
    node.data('breathingActive', false);

    // Stop timeout
    this.stopAnimation(nodeId);

    // Restore original style
    const originalBorderWidth = node.data('originalBorderWidth') || '0';
    const originalBorderColor = node.data('originalBorderColor') || 'rgba(0, 0, 0, 0)';

    node.stop(true, false);
    node.style({
      'border-width': originalBorderWidth,
      'border-color': originalBorderColor,
      'border-opacity': 1,
    });

    // Clean up data
    node.removeData('breathingActive originalBorderWidth originalBorderColor animationType');
  }

  stopAllAnimations(nodes: NodeCollection): void {
    nodes.forEach((node) => {
      this.stopAnimationForNode(node);
    });
  }

  isAnimationActive(node: NodeSingular): boolean {
    return node.data('breathingActive') === true;
  }

  destroy(): void {
    // Clear all timeouts
    this.activeAnimations.forEach((timeout) => clearTimeout(timeout));
    this.activeAnimations.clear();
  }
}