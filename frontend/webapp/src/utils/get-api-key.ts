// Get API key for speech recognition service
export default async function getAPIKey() {
  console.log('=== Getting API Key ===');

  // Check if running in development with Vite
  if (import.meta.env?.VITE_SONIOX_API_KEY) {
    console.log('✅ Using API key from environment variable');
    console.log('API key length:', import.meta.env.VITE_SONIOX_API_KEY.length);
    return import.meta.env.VITE_SONIOX_API_KEY;
  }

  console.log('⚠️ No environment variable found, prompting user...');
  // Fallback to prompt user for API key
  const apiKey = prompt("Please enter your VoiceTree API key:");
  if (!apiKey) {
    console.error('❌ No API key provided');
    throw new Error("API key is required for speech recognition");
  }
  console.log('✅ API key provided via prompt, length:', apiKey.length);
  return apiKey;
}
