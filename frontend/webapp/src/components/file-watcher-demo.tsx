import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';

// Import types from global electron types
import type { WatchStatus, FileEvent, ErrorEvent } from '@/types/electron';


export const FileWatcherDemo: React.FC = () => {
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ isWatching: false });
  const [events, setEvents] = useState<Array<{ type: string; data: FileEvent | ErrorEvent | { directory?: string; message?: string } | Record<string, never>; timestamp: Date }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Check if we're running in Electron
  const isElectron = window.electronAPI !== undefined;

  useEffect(() => {
    if (!isElectron) return;

    // Get initial watch status
    const checkStatus = async () => {
      try {
        const status = await window.electronAPI!.getWatchStatus();
        setWatchStatus(status);
      } catch (err) {
        console.error('Failed to get watch status:', err);
      }
    };

    checkStatus();

    // Set up event listeners
    const addEvent = (type: string, data: FileEvent | ErrorEvent | { directory?: string; message?: string } | Record<string, never>) => {
      setEvents(prev => [
        { type, data, timestamp: new Date() },
        ...prev.slice(0, 49) // Keep only last 50 events
      ]);
    };

    window.electronAPI!.onFileAdded((data) => addEvent('File Added', data));
    window.electronAPI!.onFileChanged((data) => addEvent('File Changed', data));
    window.electronAPI!.onFileDeleted((data) => addEvent('File Deleted', data));
    window.electronAPI!.onDirectoryAdded((data) => addEvent('Directory Added', data));
    window.electronAPI!.onDirectoryDeleted((data) => addEvent('Directory Deleted', data));
    window.electronAPI!.onInitialScanComplete((data) => {
      addEvent('Scan Complete', data);
      setIsLoading(false);
    });
    window.electronAPI!.onFileWatchError((data) => {
      addEvent('Error', data);
      setError(data.message);
      setIsLoading(false);
    });
    window.electronAPI!.onFileWatchInfo((data) => addEvent('Info', data));
    window.electronAPI!.onFileWatchingStopped(() => {
      setWatchStatus({ isWatching: false });
      addEvent('Watching Stopped', {});
      setIsLoading(false);
    });

    return () => {
      // Cleanup listeners
      window.electronAPI!.removeAllListeners('file-added');
      window.electronAPI!.removeAllListeners('file-changed');
      window.electronAPI!.removeAllListeners('file-deleted');
      window.electronAPI!.removeAllListeners('directory-added');
      window.electronAPI!.removeAllListeners('directory-deleted');
      window.electronAPI!.removeAllListeners('initial-scan-complete');
      window.electronAPI!.removeAllListeners('file-watch-error');
      window.electronAPI!.removeAllListeners('file-watch-info');
      window.electronAPI!.removeAllListeners('file-watching-stopped');
    };
  }, [isElectron]);

  const startWatching = async () => {
    if (!isElectron) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.startFileWatching();
      if (result.success) {
        setWatchStatus({ isWatching: true, directory: result.directory });
      } else {
        setError(result.error || 'Failed to start watching');
        setIsLoading(false);
      }
    } catch {
      setError('Failed to start file watching');
      setIsLoading(false);
    }
  };

  const stopWatching = async () => {
    if (!isElectron) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.stopFileWatching();
      if (result.success) {
        setWatchStatus({ isWatching: false });
      } else {
        setError(result.error || 'Failed to stop watching');
      }
    } catch {
      setError('Failed to stop file watching');
    } finally {
      setIsLoading(false);
    }
  };

  const clearEvents = () => {
    setEvents([]);
    setError(null);
  };

  if (!isElectron) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>File Watcher Demo</CardTitle>
          <CardDescription>
            File watching functionality is only available when running as an Electron app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              To use the file watcher, run the application with: <code>npm run electron:dev</code>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>File Watcher Demo</CardTitle>
        <CardDescription>
          Watch for markdown file changes in a selected directory
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Control Panel */}
        <div className="flex gap-2 items-center">
          <Button
            onClick={startWatching}
            disabled={isLoading || watchStatus.isWatching}
            variant="default"
          >
            {isLoading ? 'Starting...' : 'Start Watching'}
          </Button>
          <Button
            onClick={stopWatching}
            disabled={isLoading || !watchStatus.isWatching}
            variant="secondary"
          >
            {isLoading ? 'Stopping...' : 'Stop Watching'}
          </Button>
          <Button onClick={clearEvents} variant="outline">
            Clear Events
          </Button>
        </div>

        {/* Status Display */}
        <div className="p-4 bg-gray-50 rounded-lg">
          <p><strong>Status:</strong> {watchStatus.isWatching ? 'Watching' : 'Not watching'}</p>
          {watchStatus.directory && (
            <p><strong>Directory:</strong> <code>{watchStatus.directory}</code></p>
          )}
          {isLoading && <p className="text-blue-600">Loading...</p>}
        </div>

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Events Display */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">File System Events</h3>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {events.length === 0 ? (
              <p className="text-gray-500 italic">No events yet...</p>
            ) : (
              events.map((event, index) => (
                <div key={index} className="p-3 border rounded-lg bg-white">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium text-sm">{event.type}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {event.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-sm">
                    {event.data.path && (
                      <p><strong>Path:</strong> <code>{event.data.path}</code></p>
                    )}
                    {event.data.size && (
                      <p><strong>Size:</strong> {(event.data.size / 1024).toFixed(2)} KB</p>
                    )}
                    {event.data.modified && (
                      <p><strong>Modified:</strong> {new Date(event.data.modified).toLocaleString()}</p>
                    )}
                    {event.data.message && (
                      <p><strong>Message:</strong> {event.data.message}</p>
                    )}
                    {event.data.content && event.type !== 'File Changed' && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-blue-600">
                          View content ({event.data.content.length} chars)
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-32">
                          {event.data.content}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FileWatcherDemo;