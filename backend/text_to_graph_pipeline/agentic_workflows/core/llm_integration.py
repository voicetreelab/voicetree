"""
LLM integration for VoiceTree LangGraph workflow using PydanticAI

Easy configuration: Modify the CONFIG class below to change models, temperature, or other settings.
"""

import os
from pathlib import Path
from typing import Optional, Type, Dict
from dataclasses import dataclass
from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.gemini import GeminiModel

# Schema models are no longer imported here - they're passed from agents


# ==================== CONFIGURATION ====================
# Change these values to modify LLM behavior

@dataclass
class CONFIG:
    """Central configuration for LLM integration"""
    
    # Model selection
    DEFAULT_MODEL = "gemini-2.0-flash"
    
    # System prompts
    STRUCTURED_SYSTEM_PROMPT = "You are a helpful assistant that provides structured responses."
    GENERAL_SYSTEM_PROMPT = "You are a helpful assistant."
    
    # Environment settings
    ENV_SEARCH_PATHS = [
        Path.cwd() / '.env',
        Path.cwd().parent / '.env',
        Path.cwd().parent.parent / '.env',
        Path.home() / 'repos' / 'VoiceTreePoc' / '.env'
    ]
    
    # Schema registry removed - schemas are now passed directly from agents
    
    # Debug settings
    PRINT_API_SUCCESS = False  # Set to True to see success messages
    PRINT_ENV_LOADING = True   # Set to False to hide environment loading messages


# ==================== INITIALIZATION ====================

# Model cache to reuse instances for better performance
_MODEL_CACHE: Dict[str, GeminiModel] = {}


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
    
    # Set GEMINI_API_KEY environment variable for PydanticAI
    if api_key:
        os.environ["GEMINI_API_KEY"] = api_key
    
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


def _get_model(model_name: str) -> GeminiModel:
    """Get or create a cached model instance"""
    if model_name not in _MODEL_CACHE:
        _MODEL_CACHE[model_name] = GeminiModel(model_name)
    return _MODEL_CACHE[model_name]


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
    
    # Ensure API key
    _ensure_api_key()
    
    try:
        # Get cached model
        model = _get_model(model_name)
        
        # Create agent with structured output
        agent = Agent(
            model,
            result_type=output_schema,
            system_prompt=CONFIG.STRUCTURED_SYSTEM_PROMPT
        )
        
        # Run the agent
        result = await agent.run(prompt)
        
        if CONFIG.PRINT_API_SUCCESS:
            print(f"✅ API call successful - structured response received")
            
        return result.data
        
    except Exception as e:
        _handle_llm_error(e, stage_type, output_schema)


async def call_llm(prompt: str, model_name: str = None) -> str:
    """
    Legacy function for backward compatibility
    Calls the LLM and returns raw text response
    
    Args:
        prompt: The prompt to send to the LLM
        model_name: The model to use (default: CONFIG.DEFAULT_MODEL)
        
    Returns:
        The LLM response as a string
        
    Raises:
        RuntimeError: If Gemini API is not available or configured
    """
    # Use default from config
    if model_name is None:
        model_name = CONFIG.DEFAULT_MODEL
    
    # Ensure API key
    _ensure_api_key()
    
    try:
        # Get cached model
        model = _get_model(model_name)
        
        # Create agent with string output
        agent = Agent(
            model,
            result_type=str,
            system_prompt=CONFIG.GENERAL_SYSTEM_PROMPT
        )
        
        # Run the agent
        result = await agent.run(prompt)
        
        if CONFIG.PRINT_API_SUCCESS:
            print(f"✅ API call successful - response length: {len(result.data)} chars")
            
        return result.data
        
    except Exception as e:
        _handle_llm_error(e)