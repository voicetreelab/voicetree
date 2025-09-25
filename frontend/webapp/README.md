# VoiceTree Web Application

A real-time speech-to-text application that converts voice input into structured graphs using VoiceTree's agentic pipeline.

## Features

- Real-time speech transcription
- Visual distinction between final and non-final tokens
- Simple, clean UI using Tailwind CSS
- TypeScript support
- Secure API key handling via temporary key server

## Prerequisites

This application connects to the VoiceTree backend server for processing voice input into structured graphs.

## Getting Started

### Option 1: Secure Setup (Recommended)

1. **Start the temporary API key server:**

   ```bash
   cd ../server
   ./start.sh
   ```

   Make sure to set your `VITE_VOICETREE_API_KEY` environment variable for the speech recognition API.

2. **Open another terminal & install dependencies:**

   ```bash
   cd frontend/webapp
   npm install
   ```

3. **Start the React development server:**

   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to the local development URL (usually `http://localhost:3000`)

5. **Grant microphone permissions** when prompted and click "Start Recording" to begin transcription

### Option 2: Quick Testing (Less Secure)

If you want to test quickly without setting up the server, you can use your API key directly:

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Update useVoiceTreeClient hook apiKey argument:**

   When using `useVoiceTreeClient` hook pass your API key directly:

   ```typescript
   const {
     state,
     finalTokens,
     nonFinalTokens,
     startTranscription,
     stopTranscription,
     error,
   } = useVoiceTreeClient({
     apiKey: "YOUR_VOICETREE_API_KEY_HERE",
   });
   ```

3. **Start the React development server:**

   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to the local development URL (usually `http://localhost:3000`)

5. **Grant microphone permissions** when prompted and click "Start Recording" to begin transcription

**⚠️ Warning**: This approach exposes your API key in the client-side code and should only be used for testing.

## How it Works

- **Final tokens** (black text): Confirmed transcription results that won't change
- **Non-final tokens** (gray text): Tentative results that may be updated as more audio is processed
- The app uses the VoiceTree client to handle real-time audio capture and transcription
- **Security**: Instead of exposing your main API key to the client, the app fetches temporary API keys from a secure server

## Testing

The application includes comprehensive unit and integration tests using Vitest and React Testing Library.

### Quick Test Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm test -- --watch

# Run tests with coverage report
npm test:coverage

# Run tests with UI interface
npm test:ui

# Run specific test file
npm test RecordButton

# Run tests matching a pattern
npm test -- --grep "text input"
```

### Test Coverage

The test suite covers:
- **Components**: RecordButton, SoundWaveVisualizer, VoiceTreeLayout
- **User Flows**: Text input submission, speech-to-text, history management
- **Error Handling**: Server offline scenarios, API failures
- **State Management**: Processing states, dark mode, localStorage persistence

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
│   ├── status-display.tsx # Recording status indicator
│   └── __tests__/         # Component unit tests
├── hooks/
│   ├── useVoiceTreeClient.tsx  # VoiceTree client integration hook
│   └── useAutoScroll.tsx    # Auto-scroll functionality
├── renderers/
│   ├── voicetree-transcribe.tsx  # VoiceTree integration mode
│   ├── transcribe.tsx            # Standard transcription mode
│   ├── translate-to.tsx          # Translation from-to mode
│   ├── translate-between.tsx     # Bidirectional translation mode
│   └── renderer.tsx              # Base rendering component
├── __tests__/
│   └── integration/       # Integration tests
├── test/
│   └── setup.ts          # Test configuration and mocks
├── config/
│   └── languages.ts       # Language configuration
└── utils/
    ├── get-api-key.ts     # API key management
    └── speaker-colors.ts  # Speaker color assignment
```

## API Documentation

For more details about VoiceTree, visit the project documentation.

## License

This example is provided as-is for demonstration purposes.
