const SONIOX_API_ENDPOINT: string =
  'https://us-central1-vocetree-alpha.cloudfunctions.net/soniox-temp-key';

// Get API key for speech recognition service
// First checks for VITE_SONIOX_API_KEY in .env, falls back to cloud function
export default async function getAPIKey(): Promise<string> {
  if (import.meta.env.VITE_SONIOX_API_KEY) {
    return import.meta.env.VITE_SONIOX_API_KEY;
  }

  const response: Response = await fetch(SONIOX_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to get API key: ${response.statusText}`);
  }

  const data: { apiKey: string } = await response.json();
  return data.apiKey;
}
