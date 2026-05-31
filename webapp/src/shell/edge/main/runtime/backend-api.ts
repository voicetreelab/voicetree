/**
 * Voicetree Backend API Client
 *
 * Handles communication with the Voicetree backend server
 */

// Module-level variable to store the backend port

import {getBackendPort} from "@/shell/edge/main/runtime/state/app-electron-state";

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
// The Python server's port is allocated and returned before uvicorn is actually
// accepting connections (the process is spawned, then a health check is scheduled
// asynchronously — see RealTextToTreeServerManager). Project-open fires this
// notification right after window creation, often inside that boot window. A single
// fire-and-forget POST that lands during boot is refused and silently lost, leaving
// the backend with no directory (`processor is None`) — it then drops every
// /send-text forever ("Skipping buffer processing - no directory loaded yet"), so
// voice/typed text never becomes nodes. We therefore retry on *connection* failure
// until the server is accepting requests. Real HTTP errors (4xx/5xx) still fail fast.
const LOAD_DIRECTORY_MAX_ATTEMPTS = 30;
const LOAD_DIRECTORY_RETRY_DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function tellSTTServerToLoadDirectory(directoryPath: string): Promise<LoadDirectoryResponse> {
  if (!directoryPath || directoryPath.trim() === '') {
    throw new Error('Directory absolutePath cannot be empty');
  }

  let lastConnectionError: unknown;
  for (let attempt = 1; attempt <= LOAD_DIRECTORY_MAX_ATTEMPTS; attempt++) {
    const baseUrl: string = await getBackendBaseUrl();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/load-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          directory_path: directoryPath
        } as LoadDirectoryRequest),
      });
    } catch (connectionError) {
      // Server not accepting connections yet (still booting). Retry.
      lastConnectionError = connectionError;
      await sleep(LOAD_DIRECTORY_RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      // The server is up and rejected the request — a real error, do not retry.
      const errorData: BackendApiError = await response.json().catch(() => ({ detail: '' })) as BackendApiError;
      throw new Error(`Backend error: ${errorData.detail || response.statusText}`);
    }

    return await response.json() as LoadDirectoryResponse;
  }

  console.error(
    `[Backend API] Load directory failed: server unreachable after ${LOAD_DIRECTORY_MAX_ATTEMPTS} attempts`,
    lastConnectionError
  );
  throw new Error('Failed to load directory in backend: server unreachable');
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
