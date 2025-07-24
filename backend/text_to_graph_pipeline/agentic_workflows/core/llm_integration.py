"""
LLM integration for VoiceTree LangGraph workflow using Google GenAI

Easy configuration: Modify the CONFIG class below to change models, temperature, or other settings.
"""

import os
import re
from pathlib import Path
from typing import Optional, Type, Dict
from dataclasses import dataclass
from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
import json

from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import \
    log_llm_io


# Schema models are no longer imported here - they're passed from agents


# ==================== CONFIGURATION ====================
# Change these values to modify LLM behavior

@dataclass
class CONFIG:
    """Central configuration for LLM integration"""
    
    # Model selection
    DEFAULT_MODEL = "gemini-2.5-flash-lite-preview-06-17"
    
    # System prompts
    STRUCTURED_SYSTEM_PROMPT = "You are a helpful assistant that provides structured JSON responses. You work ONLY with the data provided in the prompt - you have no ability to fetch additional data, use tools, or access external information. All necessary data is included in the prompt."
    GENERAL_SYSTEM_PROMPT = "You are a helpful assistant."
    
    # Environment settings
    ENV_SEARCH_PATHS = [
        Path.cwd() / '.env',
        Path.cwd().parent / '.env',
        Path.cwd().parent.parent / '.env',
        Path.home() / 'repos' / 'VoiceTreePoc' / '.env'
    ]
    
    # Debug settings
    PRINT_API_SUCCESS = False  # Set to True to see success messages
    PRINT_ENV_LOADING = True   # Set to False to hide environment loading messages


# ==================== INITIALIZATION ====================

# Client instance for better performance
_CLIENT: Optional[genai.Client] = None


def _load_environment() -> None:
    """Load environment variables from .env file if it exists"""
    for env_path in CONFIG.ENV_SEARCH_PATHS:
        if env_path.exists():
            load_dotenv(env_path)
            if CONFIG.PRINT_ENV_LOADING:
                print(f"✅ Loaded environment variables from {env_path}")
            break


def _get_api_key() -> Optional[str]:
    """Get the Google API key from environment or settings"""
    api_key = os.environ.get("GOOGLE_API_KEY")
    
    # Try to get from settings module as fallback
    if not api_key:
        try:
            from backend import settings
            api_key = getattr(settings, 'GOOGLE_API_KEY', None)
            if api_key and CONFIG.PRINT_ENV_LOADING:
                print("✅ Found API key in settings.py")
        except ImportError:
            pass
    
    return api_key


# Initialize on module load
_load_environment()


# ==================== HELPER FUNCTIONS ====================

def _extract_json_from_markdown(text: str) -> Optional[str]:
    """
    Extract JSON from markdown code blocks if present.
    
    Sometimes the LLM returns JSON wrapped in ```json ... ``` blocks
    even when configured for structured output. This function extracts
    the JSON content from such blocks.
    
    Args:
        text: The raw response text that might contain markdown-wrapped JSON
        
    Returns:
        Extracted JSON string, or None if no valid JSON block found
    """
    # Look for JSON code blocks (```json ... ```)
    json_pattern = r'```json\s*\n(.*?)\n```'
    match = re.search(json_pattern, text, re.DOTALL)
    
    if match:
        return match.group(1).strip()
    
    # Also check for plain code blocks that might contain JSON (``` ... ```)
    plain_pattern = r'```\s*\n(.*?)\n```'
    match = re.search(plain_pattern, text, re.DOTALL)
    
    if match:
        content = match.group(1).strip()
        # Validate it looks like JSON (starts with { or [)
        if content.startswith(('{', '[')):
            return content
    
    return None


def _ensure_api_key() -> str:
    """Ensure API key is available, raise if not"""
    api_key = _get_api_key()
    if not api_key:
        raise ValueError(
            "No Google API key available. Please ensure:\n"
            "1. GOOGLE_API_KEY environment variable is set, or\n"
            "2. API key is defined in settings.py"
        )
    return api_key


def _get_client() -> genai.Client:
    """Get or create the genai client instance"""
    global _CLIENT
    if _CLIENT is None:
        api_key = _ensure_api_key()
        _CLIENT = genai.Client(api_key=api_key)
    return _CLIENT




# ==================== PUBLIC API ====================

async def call_llm_structured(
    prompt: str, 
    stage_type: str, 
    output_schema: Type[BaseModel],
    model_name: str = None
) -> BaseModel:
    """
    Call the LLM with structured output using Pydantic schemas
    
    Args:
        prompt: The prompt to send to the LLM
        stage_type: The workflow stage type (used for logging/debugging)
        output_schema: The Pydantic model class for structured output
        model_name: The model to use (default: CONFIG.DEFAULT_MODEL)
        
    Returns:
        Pydantic model instance with structured response
        
    Raises:
        RuntimeError: If Gemini API is not available or configured
        ValueError: If API key is missing
    """
    # Use defaults from config
    if model_name is None:
        model_name = CONFIG.DEFAULT_MODEL
    
    # Get client
    client = _get_client()
    
    # Build the full prompt with system prompt
    # full_prompt = f"{prompt}"
    full_prompt = prompt # no sys prompt for now

    # Call the model with structured output
    # Pass Pydantic models directly as per Google's documentation
    response = client.models.generate_content(
        model=model_name,
        contents=full_prompt,
        config={
            'response_mime_type': 'application/json',
            'response_schema': output_schema,
        },
    )

    log_llm_io(stage_type, prompt, response.text, model_name)

    # Handle case where response.parsed is None
    if response.parsed is None:
        # Try to extract JSON from markdown code blocks as fallback
        extracted_json = _extract_json_from_markdown(response.text)
        
        if extracted_json:
            try:
                # Parse the extracted JSON manually and validate against schema
                parsed_data = json.loads(extracted_json)
                return output_schema.model_validate(parsed_data)
            except (json.JSONDecodeError, ValueError) as e:
                raise RuntimeError(
                    f"LLM returned JSON in markdown blocks for stage '{stage_type}', "
                    f"but failed to parse it: {e}. "
                    f"Raw response: {response.text[:500]}..."
                )
        
        raise RuntimeError(
            f"LLM failed to generate structured response for stage '{stage_type}'. "
            f"Raw response: {response.text[:500]}..."
        )

    return response.parsed
