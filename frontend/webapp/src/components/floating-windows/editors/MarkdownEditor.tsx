import React, { useState, useMemo } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { MermaidRenderer } from './MermaidRenderer';
import { useFloatingWindows } from '../hooks/useFloatingWindows';
import debounce from 'lodash.debounce';

interface MarkdownEditorProps {
  windowId: string;
  nodeId: string; // This is the file path
  initialContent: string;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

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

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ windowId, nodeId, initialContent }) => {
  const [value, setValue] = useState(initialContent);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const { updateWindowContent } = useFloatingWindows();

  const debouncedUpdate = useMemo(
    () => debounce((id: string, content: string) => {
      updateWindowContent(id, content);
    }, 300),
    [updateWindowContent]
  );

  const handleChange = (newValue: string | undefined) => {
    const content = newValue || '';
    setValue(content);
    setSaveStatus('idle'); // Reset save status on edit
    debouncedUpdate(windowId, content);
  };

  const handleSave = async () => {
    if (window.electronAPI?.saveFileContent) {
      setSaveStatus('saving');
      try {
        const result = await window.electronAPI.saveFileContent(nodeId, value);
        if (result.success) {
          setSaveStatus('success');
        } else {
          setSaveStatus('error');
          console.error('Failed to save file:', result.error);
        }
      } catch (error) {
        setSaveStatus('error');
        console.error('Error calling saveFileContent:', error);
      }
      // Reset status after a delay
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  const getSaveButtonText = () => {
    switch (saveStatus) {
      case 'saving': return 'Saving...';
      case 'success': return 'Saved!';
      case 'error': return 'Error!';
      default: return 'Save';
    }
  };

  return (
    <div data-color-mode="light" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 8px', background: '#f7f7f7', borderBottom: '1px solid #e1e1e1', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving' || !window.electronAPI?.saveFileContent}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            background: saveStatus === 'success' ? '#28a745' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {getSaveButtonText()}
        </button>
      </div>
      <MDEditor
        value={value}
        onChange={handleChange}
        components={components}
        height="100%"
        style={{ flex: 1, borderRadius: 0, border: 'none' }}
      />
    </div>
  );
};
