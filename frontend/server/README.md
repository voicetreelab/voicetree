# Soniox Temporary API Key Server

A FastAPI server that generates temporary API keys for Soniox WebSocket transcription. This prevents exposing your main API key to client applications.

## Setup

1. Create and activate virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set environment variables:

Go to https://console.soniox.com and create a new API key.

Set your API key as an environment variable in your terminal:

```bash
export SONIOX_API_KEY="your_soniox_api_key_here"
```

Or create a `.env` file:

```
SONIOX_API_KEY=your_soniox_api_key_here
```

## Running the Server

```bash
./start.sh
```

## API Endpoints

### POST /v1/auth/temporary-api-key

Generates a temporary API key for WebSocket transcription.

**Response:**

```json
{
  "apiKey": "temp_api_key_here"
}
```

**Error Response (400):**

```json
{
  "error": "SONIOX_API_KEY is not set"
}
```
