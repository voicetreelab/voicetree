/**
 * VoiceTree Backend API Client
 *
 * Handles communication with the VoiceTree backend server
 */

import { BACKEND_BASE_URL } from '../../electron/shared-config';

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
 * @param directoryPath - Absolute path to the markdown tree directory
 * @returns Response with status and number of nodes loaded
 * @throws Error if the request fails or returns an error
 */
export async function loadDirectory(directoryPath: string): Promise<LoadDirectoryResponse> {
  if (!directoryPath || directoryPath.trim() === '') {
    throw new Error('Directory path cannot be empty');
  }

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/load-directory`, {
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
    const response = await fetch(`${BACKEND_BASE_URL}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    console.error('[Backend API] Health check failed:', error);
    return false;
  }
}
