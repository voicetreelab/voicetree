import React, { useEffect, useRef, useState } from 'react';

interface MermaidRendererProps {
  children: string;
}

/**
 * A specialized component that takes a string of Mermaid diagram syntax
 * and renders it as an SVG using the 'mermaid' library.
 *
 * Uses dynamic import to avoid d3-color bundling issues.
 */
export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ children }) => {
  const preRef = useRef<HTMLPreElement>(null);
  const [mermaidLoaded, setMermaidLoaded] = useState(false);

  useEffect(() => {
    // Dynamically import mermaid to avoid bundling issues
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
      setMermaidLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (preRef.current && children && mermaidLoaded) {
      import('mermaid').then(({ default: mermaid }) => {
        // Mermaid API expects the raw text content, not the DOM element content.
        // It will find the element by the ID it generates and render into it.
        if (preRef.current) {
          preRef.current.innerHTML = children;
          preRef.current.removeAttribute('data-processed');
          mermaid.run({ nodes: [preRef.current] });
        }
      });
    }
  }, [children, mermaidLoaded]);

  return <pre ref={preRef} className="mermaid" />;
};
