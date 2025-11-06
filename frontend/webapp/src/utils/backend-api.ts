/**
 * VoiceTree Backend API Client
 *
 * Handles communication with the VoiceTree backend server
 */

// Module-level variable to store the backend port
let backendPort: number | null = null;

/**
 * Initialize backend connection - must be called on app startup
 * Fetches the backend port from Electron main process via IPC
 */
export async function initializeBackendConnection(): Promise<void> {
  // Check if running in renderer process (has window object)
  if (typeof window !== 'undefined' && window.electronAPI) {
    backendPort = await window.electronAPI.getBackendPort();
    console.log(`[Backend API] Connected to port ${backendPort}`);
  } else {
    // Fallback for main process or non-Electron environments (tests, browser)
    backendPort = 8001;
    console.log(`[Backend API] Running in main process or non-Electron mode, using fallback port ${backendPort}`);
  }
}

/**
 * Get the backend base URL using the dynamically discovered port
 * Automatically initializes the backend connection if not already initialized
 */
async function getBackendBaseUrl(): Promise<string> {
  if (!backendPort) {
    await initializeBackendConnection();
  }
  return `http://localhost:${backendPort}`;
}

export interface LoadDirectoryRequest {
  directory_path: string;
}

export interface LoadDirectoryResponse {
  status: string;
  message: string;
  directory: string;
  nodes_loaded: number;
}

export interface BackendApiError {
  detail: string;
}

/**
 * Load a directory in the backend server
 * This endpoint tells the backend which markdown tree directory to use for saving
 * and loading markdown files.
 *
 * @param directoryPath - Absolute absolutePath to the markdown tree directory
 * @returns Response with status and number of nodes loaded
 * @throws Error if the request fails or returns an error
 */
export async function loadDirectory(directoryPath: string): Promise<LoadDirectoryResponse> {
  if (!directoryPath || directoryPath.trim() === '') {
    throw new Error('Directory absolutePath cannot be empty');
  }

  try {
    const baseUrl = await getBackendBaseUrl();
    const response = await fetch(`${baseUrl}/load-directory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        directory_path: directoryPath
      } as LoadDirectoryRequest),
    });

    if (!response.ok) {
      const errorData = await response.json() as BackendApiError;
      throw new Error(`Backend error: ${errorData.detail || response.statusText}`);
    }

    const data = await response.json() as LoadDirectoryResponse;
    console.log(`[Backend API] Load directory success:`, data);
    return data;
  } catch (error) {
    console.error('[Backend API] Load directory failed:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to load directory in backend');
  }
}

/**
 * Check if the backend server is reachable
 * @returns true if the server is reachable, false otherwise
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const baseUrl = await getBackendBaseUrl();
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    console.error('[Backend API] Health check failed:', error);
    return false;
  }
}
