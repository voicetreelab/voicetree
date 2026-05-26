type StyleRule = { selector: string; style: Record<string, unknown> };

/** Returns YAML frontmatter-based Cytoscape style rules */
export function getFrontmatterStyles(): StyleRule[] {
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
  ];
}
