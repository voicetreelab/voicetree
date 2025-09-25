# Soniox Speech-to-Text React Example

A minimal React example demonstrating real-time speech-to-text using the Soniox Speech-to-Text Web library.

## Features

- Real-time speech transcription
- Visual distinction between final and non-final tokens
- Simple, clean UI using Tailwind CSS
- TypeScript support
- Secure API key handling via temporary key server

## Prerequisites

This example requires the Soniox Temporary API Key Server to be running. See the [server README](../server/README.md) for setup instructions.

## Getting Started

### Option 1: Secure Setup (Recommended)

1. **Start the temporary API key server:**

   ```bash
   cd ../server
   ./start.sh
   ```

   Make sure to set your `SONIOX_API_KEY` environment variable as described in the server README.

2. **Open another terminal & install dependencies:**

   ```bash
   cd frontend/webapp
   npm install
   ```

3. **Start the React development server:**

   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to the local development URL (usually `http://localhost:5173`)

5. **Grant microphone permissions** when prompted and click "Start Recording" to begin transcription

### Option 2: Quick Testing (Less Secure)

If you want to test quickly without setting up the server, you can use your API key directly:

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Update useSonioxClient hook apiKey argument:**

   When using `useSonioxClient` hook pass your API key directly:

   ```typescript
   const {
     state,
     finalTokens,
     nonFinalTokens,
     startTranscription,
     stopTranscription,
     error,
   } = useSonioxClient({
     apiKey: "YOUR_SONIOX_API_KEY_HERE",
   });
   ```

3. **Start the React development server:**

   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to the local development URL (usually `http://localhost:5173`)

5. **Grant microphone permissions** when prompted and click "Start Recording" to begin transcription

**⚠️ Warning**: This approach exposes your API key in the client-side code and should only be used for testing.

## How it Works

- **Final tokens** (black text): Confirmed transcription results that won't change
- **Non-final tokens** (gray text): Tentative results that may be updated as more audio is processed
- The app uses the Soniox SDK `SonioxClient` class to handle real-time audio capture and transcription
- **Security**: Instead of exposing your main API key to the client, the app fetches temporary API keys from a secure server

## Code Structure

```
src/
├── App.tsx                 # Main application component with tab navigation
├── main.tsx               # Application entry point
├── index.css              # Tailwind CSS configuration
├── components/
│   ├── tab-view.tsx       # Tab navigation component
│   ├── record-button.tsx  # Recording control button
│   ├── speaker-label.tsx  # Speaker identification label
│   └── status-display.tsx # Recording status indicator
├── hooks/
│   ├── useSonioxClient.tsx  # Soniox SDK integration hook
│   └── useAutoScroll.tsx    # Auto-scroll functionality
├── renderers/
│   ├── voicetree-transcribe.tsx  # VoiceTree integration mode
│   ├── transcribe.tsx            # Standard transcription mode
│   ├── translate-to.tsx          # Translation from-to mode
│   ├── translate-between.tsx     # Bidirectional translation mode
│   └── renderer.tsx              # Base rendering component
├── config/
│   └── languages.ts       # Language configuration
└── utils/
    ├── get-api-key.ts     # API key management
    └── speaker-colors.ts  # Speaker color assignment
```

## API Documentation

For more details about the Soniox Speech-to-Text Web library, visit:

- [NPM Package](https://www.npmjs.com/package/@soniox/speech-to-text-web)
- [Soniox Documentation](https://soniox.com/docs)

## License

This example is provided as-is for demonstration purposes.
