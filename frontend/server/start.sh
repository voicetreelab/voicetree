#!/bin/bash

# Simple startup script for the Soniox FastAPI server

echo "Starting Soniox Temporary API Key Server..."

# Check if API key is configured
if [ ! -f ".env" ] && [ -z "$SONIOX_API_KEY" ]; then
    echo "⚠️  No API key configuration found!"
    echo "Please either:"
    echo "  1. Set the SONIOX_API_KEY environment variable, or"
    echo "  2. Create a .env file with your configuration"
    echo "     (copy environment.example to .env and fill in your values)"
    echo ""
fi

# Check if virtual environment exists, if not suggest creating one
if [ ! -d "venv" ] && [ ! -d ".venv" ]; then
    echo "No virtual environment detected. Consider creating one:"
    echo "python -m venv .venv"
    echo "source .venv/bin/activate"
    echo "pip install -r requirements.txt"
    echo ""
fi

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
