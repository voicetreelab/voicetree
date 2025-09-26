import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  FloatingWindowManagerProvider,
  FloatingWindowContainer,
  useFloatingWindows,
} from './components/floating-windows';
import { MarkdownEditor } from './components/floating-windows/editors/MarkdownEditor';

// Mock the electronAPI for the browser-based test
(window as typeof window & { electronAPI?: { saveFileContent: (filePath: string, content: string) => Promise<void> } }).electronAPI = {
  saveFileContent: (filePath: string, content: string) => {
    console.log('Mock saveFileContent called with:', { filePath, content });
    // Store the payload in a global variable for the test to access
    (window as typeof window & { _test_savedPayload?: { filePath: string; content: string } })._test_savedPayload = { filePath, content };
    return Promise.resolve();
  },
};

const TestHarness = () => {
  const { openWindow } = useFloatingWindows();
  const [isWindowOpened, setIsWindowOpened] = useState(false);

  const handleOpenEditor = () => {
    if (isWindowOpened) return;
    openWindow({
      id: 'test-editor-1',
      title: 'test/file.md',
      width: 400,
      height: 300,
      x: 50,
      y: 50,
      children: (
        <MarkdownEditor
          initialContent="# Hello World"
          nodeId="test/file.md"
          windowId="test-editor-1"
        />
      ),
    });
    setIsWindowOpened(true);
  };

  return (
    <div>
      <h1>Editor Test Harness</h1>
      <button onClick={handleOpenEditor} disabled={isWindowOpened}>
        Open Editor
      </button>
    </div>
  );
};

const App = () => {
  return (
    <FloatingWindowManagerProvider>
      <TestHarness />
      <FloatingWindowContainer />
    </FloatingWindowManagerProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);