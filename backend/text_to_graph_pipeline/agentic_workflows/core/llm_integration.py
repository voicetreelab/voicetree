"""
LLM integration for VoiceTree LangGraph workflow using Google GenAI

Easy configuration: Modify the CONFIG class below to change models, temperature, or other settings.
"""

import os
from pathlib import Path
from typing import Optional, Type, Dict
from dataclasses import dataclass
from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
import json

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


def _handle_llm_error(e: Exception, stage_type: Optional[str] = None, 
                      schema_class: Optional[Type[BaseModel]] = None) -> None:
    """Handle and format LLM errors consistently"""
    error_msg = f"❌ Error calling Gemini API: {str(e)}"
    print(error_msg)
    
    # Provide specific guidance for validation errors
    if "validation error" in str(e).lower() or "field required" in str(e).lower():
        if stage_type and schema_class:
            print(f"📝 Validation error details: The LLM response didn't match expected schema for {stage_type}")
            print(f"   Expected schema: {schema_class.__name__}")
        if hasattr(e, '__cause__') and hasattr(e.__cause__, 'errors'):
            print(f"   Validation errors: {e.__cause__.errors()}")
    
    raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")


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
    
    try:
        # Build the full prompt with system prompt
        full_prompt = f"{prompt}"
        
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
        
        if CONFIG.PRINT_API_SUCCESS:
            print(f"✅ API call successful - structured response received")
        
        # Parse the JSON response and create the Pydantic model
        json_data = json.loads(response.text)
        return output_schema(**json_data)
        
    except Exception as e:
        _handle_llm_error(e, stage_type, output_schema)
