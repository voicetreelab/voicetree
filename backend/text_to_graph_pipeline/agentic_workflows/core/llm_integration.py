"""
LLM integration for VoiceTree LangGraph workflow using PydanticAI
"""

import os
from pathlib import Path
from typing import Optional, Type
from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.gemini import GeminiModel

# Import our schema models
try:
    from backend.text_to_graph_pipeline.agentic_workflows.models import (
        SegmentationResponse, RelationshipResponse, 
        IntegrationResponse
    )
except ImportError:
    from models import (
        SegmentationResponse, RelationshipResponse,
        IntegrationResponse
    )

# Configuration
DEFAULT_MODEL = "gemini-2.0-flash"

# Schema mapping for different workflow stages
SCHEMA_MAP = {
    "segmentation": SegmentationResponse,
    "relationship_analysis": RelationshipResponse,
    "integration_decision": IntegrationResponse,
    "identify_target_node": None  # Will be set dynamically when needed
}


def _load_environment() -> None:
    """Load environment variables from .env file if it exists"""
    # Try multiple potential locations for .env file
    potential_paths = [
        Path.cwd() / '.env',
        Path.cwd().parent / '.env',
        Path.cwd().parent.parent / '.env',
        Path.home() / 'repos' / 'VoiceTreePoc' / '.env'
    ]
    
    for env_path in potential_paths:
        if env_path.exists():
            load_dotenv(env_path)
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
            if api_key:
                print("✅ Found API key in settings.py")
        except ImportError:
            pass
    
    # Set GEMINI_API_KEY environment variable for PydanticAI
    if api_key:
        os.environ["GEMINI_API_KEY"] = api_key
    
    return api_key


# Initialize on module load
_load_environment()



async def call_llm_structured(prompt: str, stage_type: str, model_name: str = DEFAULT_MODEL, output_schema: Type[BaseModel] = None) -> BaseModel:
    """
    Call the LLM with structured output using Pydantic schemas
    
    Args:
        prompt: The prompt to send to the LLM
        stage_type: The workflow stage type (segmentation, relationship, integration, extraction)
        model_name: The model to use (default: gemini-2.0-flash)
        output_schema: Optional override for the output schema
        
    Returns:
        Pydantic model instance with structured response
        
    Raises:
        RuntimeError: If Gemini API is not available or configured
        ValueError: If API key is missing or stage type is unknown
    """
    # Use provided schema or look up from map
    if output_schema:
        schema_class = output_schema
    else:
        # Dynamically add to SCHEMA_MAP if it's a known response type
        # This allows new stages to work without manual registration
        try:
            from ..models import TargetNodeResponse, OptimizationResponse
            SCHEMA_MAP["identify_target_node"] = TargetNodeResponse
            SCHEMA_MAP["optimize"] = OptimizationResponse
        except ImportError:
            pass
            
        schema_class = SCHEMA_MAP.get(stage_type)
        if not schema_class:
            raise ValueError(f"Unknown stage type: {stage_type}. Either pass output_schema parameter or add to SCHEMA_MAP.")
    
    api_key = _get_api_key()
    if not api_key:
        raise ValueError(
            "No Google API key available. Please ensure:\n"
            "1. GOOGLE_API_KEY environment variable is set, or\n"
            "2. API key is defined in settings.py"
        )
    
    
    try:
        # Create a model instance without api_key parameter
        model = GeminiModel(model_name)
        
        # Create an agent with the specific output type
        agent = Agent(
            model,
            result_type=schema_class,
            system_prompt="You are a helpful assistant that provides structured responses."
        )
        
        # Run the agent asynchronously
        result = await agent.run(prompt)
        
        # print(f"✅ API call successful - structured response received")
        return result.data
        
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        
        # If it's a validation error, provide more specific guidance
        if "validation error" in str(e).lower() or "field required" in str(e).lower():
            print(f"📝 Validation error details: The LLM response didn't match expected schema for {stage_type}")
            print(f"   Expected schema: {schema_class.__name__}")
            if hasattr(e, '__cause__') and hasattr(e.__cause__, 'errors'):
                print(f"   Validation errors: {e.__cause__.errors()}")
        
        raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")


async def call_llm(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
    """
    Legacy function for backward compatibility
    Calls the LLM and returns raw text response
    
    Args:
        prompt: The prompt to send to the LLM
        model_name: The model to use (default: gemini-2.0-flash)
        
    Returns:
        The LLM response as a string
        
    Raises:
        RuntimeError: If Gemini API is not available or configured
    """
    api_key = _get_api_key()
    if not api_key:
        raise ValueError(
            "No Google API key available. Please ensure:\n"
            "1. GOOGLE_API_KEY environment variable is set, or\n"
            "2. API key is defined in settings.py"
        )
    
    
    try:
        # Create a model instance without api_key parameter
        model = GeminiModel(model_name)
        
        # Create an agent with string output
        agent = Agent(
            model,
            result_type=str,
            system_prompt="You are a helpful assistant."
        )
        
        # Run the agent asynchronously
        result = await agent.run(prompt)
        
        # print(f"✅ API call successful - response length: {len(result.data)} chars")
        return result.data
        
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")