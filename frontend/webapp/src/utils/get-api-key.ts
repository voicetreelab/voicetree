/// <reference types="vite/client" />

// Get API key for speech recognition service
export default async function getAPIKey(): Promise<string> {
  if (import.meta.env.VITE_SONIOX_API_KEY) {
    return import.meta.env.VITE_SONIOX_API_KEY;
  }
  throw new Error("VITE_SONIOX_API_KEY environment variable is not configured");
}
