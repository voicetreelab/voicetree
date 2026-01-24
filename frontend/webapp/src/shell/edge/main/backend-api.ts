/**
 * VoiceTree Backend API Client
 *
 * Handles communication with the VoiceTree backend server
 */

// Module-level variable to store the backend port

import {getBackendPort} from "@/shell/edge/main/state/app-electron-state";

/**
 * Get the backend base URL using the dynamically discovered port
 * Automatically initializes the backend connection if not already initialized
 */
async function getBackendBaseUrl(): Promise<string> {
    const conectionURL: string = `http://localhost:${getBackendPort()}`;
    //console.log("connecting to", conectionURL);
    return conectionURL;
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
export async function tellSTTServerToLoadDirectory(directoryPath: string): Promise<LoadDirectoryResponse> {
  if (!directoryPath || directoryPath.trim() === '') {
    throw new Error('Directory absolutePath cannot be empty');
  }

  try {
    const baseUrl: string = await getBackendBaseUrl();
    const response: Response = await fetch(`${baseUrl}/load-directory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        directory_path: directoryPath
      } as LoadDirectoryRequest),
    });

    if (!response.ok) {
      const errorData: BackendApiError = await response.json() as BackendApiError;
      throw new Error(`Backend error: ${errorData.detail || response.statusText}`);
    }

    const data: LoadDirectoryResponse = await response.json() as LoadDirectoryResponse;
    //console.log(`[Backend API] Load directory success:`, data);
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
    const baseUrl: string = await getBackendBaseUrl();
    const response: Response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    console.error('[Backend API] Health check failed:', error);
    return false;
  }
}

export interface SearchSimilarResult {
  node_path: string;  // NodeIdAndFilePath format ("voice/Some_Title.md")
  score: number;
  title: string;
}

export interface AskQueryResponse {
  relevant_nodes: SearchSimilarResult[];
}

/**
 * Query the graph using hybrid search (BM25 + vector).
 * Returns relevant nodes for context creation in Ask mode.
 *
 * @param query - The question to search for
 * @param topK - Number of results to return (default 10)
 * @returns Response with array of relevant nodes
 */
export async function askQuery(
  query: string,
  topK: number = 10
): Promise<AskQueryResponse> {
  const baseUrl: string = await getBackendBaseUrl();
  const response: Response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK })
  });

  if (!response.ok) {
    const error: BackendApiError = await response.json() as BackendApiError;
    throw new Error(`Ask query failed: ${error.detail}`);
  }

  return response.json() as Promise<AskQueryResponse>;
}
