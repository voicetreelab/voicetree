const SONIOX_API_ENDPOINT: string =
  'https://us-central1-vocetree-alpha.cloudfunctions.net/soniox-temp-key';

// Cached API key - refreshed every 18 minutes during proactive restart
let cachedAPIKey: string | null = null;
let fetchPromise: Promise<string> | null = null;

// Clear cached API key to force a fresh fetch on next getAPIKey() call
export function clearCachedAPIKey(): void {
  cachedAPIKey = null;
  fetchPromise = null;
}

// Force fetch a fresh API key, updating the cache
// Use this before reconnection to ensure we don't reuse an expired key
export async function forceRefreshAPIKey(): Promise<string> {
  clearCachedAPIKey();
  return prefetchAPIKey();
}

// Prefetch API key on app startup - call this early to have the key ready
// Returns the promise so callers can await if needed, but typically fire-and-forget
export function prefetchAPIKey(): Promise<string> {
  if (cachedAPIKey) {
    return Promise.resolve(cachedAPIKey);
  }
  if (fetchPromise) {
    return fetchPromise;
  }
  fetchPromise = fetchAPIKeyFromServer();
  return fetchPromise;
}

async function fetchAPIKeyFromServer(): Promise<string> {
  if (import.meta.env.VITE_SONIOX_API_KEY) {
    cachedAPIKey = import.meta.env.VITE_SONIOX_API_KEY;
    return cachedAPIKey;
  }

  const response: Response = await fetch(SONIOX_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    fetchPromise = null; // Allow retry on failure
    throw new Error(`Failed to get API key: ${response.statusText}`);
  }

  const data: { apiKey: string } = await response.json();
  cachedAPIKey = data.apiKey;
  return cachedAPIKey;
}

// Get API key for speech recognition service
// Returns cached key if available, otherwise fetches and caches
export default async function getAPIKey(): Promise<string> {
  if (cachedAPIKey) {
    return cachedAPIKey;
  }
  return prefetchAPIKey();
}
