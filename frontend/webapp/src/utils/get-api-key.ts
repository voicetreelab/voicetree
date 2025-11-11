// Get API key for speech recognition service
export default async function getAPIKey(): Promise<string> {
  // Check if running in development with Vite
  if (import.meta.env.VITE_SONIOX_API_KEY) {
    return import.meta.env.VITE_SONIOX_API_KEY;
  }

  // Fallback to prompt user for API key
  const apiKey = prompt("Please enter your Soniox API key:");
  if (!apiKey) {
    throw new Error("API key is required for speech recognition");
  }
  return apiKey;
}
