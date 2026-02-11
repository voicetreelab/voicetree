type StyleRule = { selector: string; style: Record<string, unknown> };

interface BreathingConfig {
  name: string;
  expandColor: string;
  contractColor: string;
  expandOpacity: number;
  contractOpacity: number;
  durationMs: string;
}

const BREATHING_CONFIGS: BreathingConfig[] = [
  {
    name: 'pinned',
    expandColor: 'rgba(255, 165, 0, 0.9)',
    contractColor: 'rgba(255, 165, 0, 0.4)',
    expandOpacity: 0.8,
    contractOpacity: 0.6,
    durationMs: '800ms',
  },
  {
    name: 'new',
    expandColor: 'rgba(0, 255, 0, 0.9)',
    contractColor: 'rgba(0, 255, 0, 0.5)',
    expandOpacity: 0.8,
    contractOpacity: 0.7,
    durationMs: '1000ms',
  },
  {
    name: 'appended',
    expandColor: 'rgba(0, 255, 255, 0.9)',
    contractColor: 'rgba(0, 255, 255, 0.6)',
    expandOpacity: 0.8,
    contractOpacity: 0.7,
    durationMs: '1200ms',
  },
];

function createBreathingPair(config: BreathingConfig): [StyleRule, StyleRule] {
  return [
    {
      selector: `node.breathing-${config.name}-expand`,
      style: {
        'border-width': 4,
        'border-color': config.expandColor,
        'border-opacity': config.expandOpacity,
        'border-style': 'solid',
        'transition-property': 'border-width, border-color, border-opacity',
        'transition-duration': config.durationMs,
        'transition-timing-function': 'ease-in-out',
      }
    },
    {
      selector: `node.breathing-${config.name}-contract`,
      style: {
        'border-width': 2,
        'border-color': config.contractColor,
        'border-opacity': config.contractOpacity,
        'border-style': 'solid',
        'transition-property': 'border-width, border-color, border-opacity',
        'transition-duration': config.durationMs,
        'transition-timing-function': 'ease-in-out',
      }
    },
  ];
}

/** Returns all breathing animation Cytoscape style rules */
export function getBreathingAnimationStyles(): StyleRule[] {
  return BREATHING_CONFIGS.flatMap(createBreathingPair);
}
