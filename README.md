# VoiceTree

VoiceTree converts voice recordings into structured knowledge graphs using AI workflows. It takes audio input, processes it through a multi-stage AI pipeline, and outputs interconnected markdown files that represent your ideas as a visual tree.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt
source .venv/bin/activate

# Configure your Gemini API key (required)
export GOOGLE_API_KEY="your_gemini_api_key_here"

# Run a quick test
python dev-test.py --speed smoke
```

## Requirements

VoiceTree requires Google's Gemini API to function. Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey) and set it as an environment variable or add it to a `.env` file.

The system will fail immediately if the API key is missing or invalid rather than degrading gracefully.

## Development

For fast development feedback, use these commands:

- `python dev-test.py --speed smoke` - Quick tests (under 5 seconds)
- `python dev-test.py --changed` - Test only your recent changes  
- `python dev-test.py --watch --speed smoke` - Auto-run tests when files change

For complete testing before commits:
- `python dev-test.py --speed unit` - Full unit test suite

## How It Works

VoiceTree processes voice input through a 4-stage AI workflow:

1. **Segmentation** - Breaks transcript into atomic idea chunks
2. **Relationship Analysis** - Analyzes connections to existing knowledge
3. **Integration Decision** - Decides whether to create new nodes or append to existing ones
4. **Node Extraction** - Creates the final knowledge tree structure

The output is a collection of markdown files that can be viewed as an interconnected knowledge graph.

## Running the System

After setup, run `python main.py` to start the voice processing system. Alternatively, use `python process_transcription.py` with text files for batch processing. 