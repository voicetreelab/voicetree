const SONIOX_API_ENDPOINT: string =
  'https://us-central1-vocetree-alpha.cloudfunctions.net/soniox-temp-key';

// Get temporary API key for speech recognition service from cloud function
export default async function getAPIKey(): Promise<string> {
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
