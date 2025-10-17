import React, { useState, useRef, useEffect } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { MermaidRenderer } from './MermaidRenderer';

interface MarkdownEditorProps {
  windowId: string;
  content: string;
  onSave: (newContent: string) => Promise<void>;
  previewMode?: 'edit' | 'live' | 'preview';
}

const components = {
  code: ({ children = '', className = '' }) => {
    const code = children as string;
    const match = /language-(\w+)/.exec(className || '');
    if (match && match[1] === 'mermaid') {
      return <MermaidRenderer>{code}</MermaidRenderer>;
    }
    return <code className={className}>{children}</code>;
  },
};

const AUTOSAVE_DELAY_MS = 100;

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ content, onSave, previewMode = 'edit' }) => {
  const [value, setValue] = useState(content);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check for dark mode on mount and when it changes
  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    };

    checkDarkMode();

    // Watch for changes to dark mode class
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Cleanup pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleChange = (newValue: string | undefined) => {
    const content = newValue || '';
    setValue(content);

    // Debounced auto-save: clear previous timeout and set new one
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      onSave(content).catch((error) => {
        console.error('[MarkdownEditor] Auto-save failed:', error);
      });
    }, AUTOSAVE_DELAY_MS);
  };

  return (
    <div data-color-mode={isDarkMode ? 'dark' : 'light'} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <MDEditor
        value={value}
        onChange={handleChange}
        previewOptions={{
          components: components
        }}
        height="100%"
        preview={previewMode}
        style={{ flex: 1, borderRadius: 0, border: 'none' }}
      />
    </div>
  );
};
