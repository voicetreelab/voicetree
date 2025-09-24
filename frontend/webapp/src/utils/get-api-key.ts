// Get Soniox API key from environment variable
export default async function getAPIKey() {
  // Check if running in development with Vite
  if (import.meta.env?.VITE_SONIOX_API_KEY) {
    return import.meta.env.VITE_SONIOX_API_KEY;
  }

  // Fallback to prompt user for API key
  const apiKey = prompt("Please enter your Soniox API key:");
  if (!apiKey) {
    throw new Error("Soniox API key is required for speech recognition");
  }
  return apiKey;
}
