import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

// Initialize Mermaid on load. We don't want it to auto-start on the whole page.
mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

interface MermaidRendererProps {
  children: string;
}

/**
 * A specialized component that takes a string of Mermaid diagram syntax
 * and renders it as an SVG using the 'mermaid' library.
 */
export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ children }) => {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current && children) {
      // Mermaid API expects the raw text content, not the DOM element content.
      // It will find the element by the ID it generates and render into it.
      preRef.current.innerHTML = children;
      preRef.current.removeAttribute('data-processed');
      mermaid.run({ nodes: [preRef.current] });
    }
  }, [children]);

  return <pre ref={preRef} className="mermaid" />;
};
