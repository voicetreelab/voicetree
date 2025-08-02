"""
LLM integration for VoiceTree LangGraph workflow using Google GenAI

Easy configuration: Modify the CONFIG class below to change models, temperature, or other settings.
"""
import logging
import os
import re
from pathlib import Path
from typing import Optional, Type, Dict
from dataclasses import dataclass
from dotenv import load_dotenv
from google.genai.types import GenerateContentConfig, GenerateContentConfigDict, SafetySettingDict, HttpOptions, SafetySetting
from pydantic import BaseModel
from google import genai
import json
from google.genai import types

from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import \
    log_llm_io
from backend.text_to_graph_pipeline.agentic_workflows.core.json_parser import \
    parse_json_markdown


# Schema models are no longer imported here - they're passed from agents


# ==================== CONFIGURATION ====================
# Change these values to modify LLM behavior

@dataclass
class CONFIG:
    """Central configuration for LLM integration"""
    
    # Model selection
    DEFAULT_MODEL = "gemini-2.5-flash"
    
    # Generation parameters
    TEMPERATURE = 0.5
    
    # Safety settings - BLOCK_NONE for all categories
    @staticmethod
    def get_safety_settings():
        return [
            SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
            SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
            SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
            SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
        ]
    
    # Environment settings
    ENV_SEARCH_PATHS = [
        Path.cwd() / '.env',
        Path.cwd().parent / '.env',
        Path.cwd().parent.parent / '.env',
        Path.home() / 'repos' / 'VoiceTree' / '.env'
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
        # Configure HTTP options with a 2-minute timeout to prevent hanging
        # Most Gemini API calls should complete within 30-60 seconds
        http_options: HttpOptions = HttpOptions.model_construct(
            timeout=30000 # 30s in millis
        )
        _CLIENT = genai.Client(api_key=api_key, http_options=http_options)
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
    if stage_type== "single_abstraction_optimizer":
        print(f"Running local graph optimization stage with model: gemini-2.5-flash")

    else:
        print(f"Running {stage_type} with model: {model_name}")

    logging.info(f"Running {stage_type} LLM with model: {model_name}")

    config = types.GenerateContentConfig(
        response_mime_type='application/json',
        response_schema=output_schema,
        temperature=CONFIG.TEMPERATURE,
        safety_settings=CONFIG.get_safety_settings(),
        thinking_config=types.ThinkingConfig(thinking_budget=0)
    )
    response = client.models.generate_content(
        model=model_name,
        contents=full_prompt,
        config=config
    )

    log_llm_io(stage_type, prompt, response.text, model_name)

    # Handle case where response.parsed is None
    if response.parsed is None:
        # Try to parse JSON from response text using robust parser
        try:
            # Use parse_json_markdown which handles markdown blocks, partial JSON, etc.
            parsed_data = parse_json_markdown(response.text)
            return output_schema.model_validate(parsed_data)
        except (json.JSONDecodeError, ValueError) as e:
            raise RuntimeError(
                f"LLM returned invalid JSON for stage '{stage_type}'. "
                f"Parse error: {e}. "
                f"Raw response: {response.text[:500]}..."
            )

    return response.parsed
