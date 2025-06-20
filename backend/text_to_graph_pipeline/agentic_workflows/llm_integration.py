"""
LLM integration for VoiceTree LangGraph workflow
"""

import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any, TypeVar, Type
from dotenv import load_dotenv
from pydantic import BaseModel

# Import our schema models
try:
    from backend.text_to_graph_pipeline.agentic_workflows.schema_models import (
        SegmentationResponse, RelationshipResponse, 
        IntegrationResponse, NodeExtractionResponse
    )
except ImportError:
    from schema_models import (
        SegmentationResponse, RelationshipResponse,
        IntegrationResponse, NodeExtractionResponse
    )

# Configuration
DEFAULT_MODEL = "gemini-2.0-flash"

# Type variable for generic response types
T = TypeVar('T', bound=BaseModel)

# Schema mapping for different workflow stages
SCHEMA_MAP = {
    "segmentation": SegmentationResponse,
    "relationship": RelationshipResponse,
    "integration": IntegrationResponse,
    "extraction": NodeExtractionResponse
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


def _initialize_gemini() -> bool:
    """
    Initialize Gemini API using the new google.genai package
    
    Returns:
        True if successfully initialized, False otherwise
    """
    try:
        # Only use the new API
        import google.genai as genai
        print("✅ Google Genai API available")
        
        # Try to get API key from environment
        api_key = os.environ.get("GOOGLE_API_KEY")
        
        # Try to get from settings module as fallback
        if not api_key:
            try:
                # Add parent directories to path for imports
                for i in range(3):
                    parent = Path.cwd().parents[i] if i < len(Path.cwd().parents) else None
                    if parent and parent not in sys.path:
                        sys.path.append(str(parent))
                
                from backend import settings
                api_key = getattr(settings, 'GOOGLE_API_KEY', None)
                if api_key:
                    print("✅ Found API key in settings.py")
            except ImportError:
                pass
        
        if api_key:
            print("✅ Gemini API configured successfully")
            return True
        else:
            print("❌ No API key found in environment variables or settings.py")
            return False
            
    except ImportError:
        print("❌ google.genai package not available. Install with: pip install google-genai")
        return False
    except Exception as e:
        print(f"❌ Error initializing Gemini API: {e}")
        return False


# Initialize on module load
_load_environment()
GEMINI_AVAILABLE = _initialize_gemini()


def call_llm_structured(prompt: str, stage_type: str, model_name: str = DEFAULT_MODEL) -> BaseModel:
    """
    Call the LLM with structured output using Pydantic schemas
    
    Args:
        prompt: The prompt to send to the LLM
        stage_type: The workflow stage type (segmentation, relationship, integration, extraction)
        model_name: The model to use (default: gemini-2.0-flash)
        
    Returns:
        Pydantic model instance with structured response
        
    Raises:
        RuntimeError: If Gemini API is not available or configured
        ValueError: If API key is missing or stage type is unknown
    """
    if not GEMINI_AVAILABLE:
        raise RuntimeError(
            "❌ Gemini API is not available. Please ensure:\n"
            "1. google-generativeai package is installed: pip install google-generativeai\n"
            "2. GOOGLE_API_KEY environment variable is set\n"
            "3. API key is valid and has proper permissions"
        )
    
    try:
        import google.genai as genai
        
        schema_class = SCHEMA_MAP.get(stage_type)
        if not schema_class:
            raise ValueError(f"Unknown stage type: {stage_type}")
        
        print(f"🤖 Calling Gemini API with structured output ({model_name})...")
        
        # Get API key
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            try:
                from backend import settings
                api_key = getattr(settings, 'GOOGLE_API_KEY', None)
            except ImportError:
                pass
        
        if not api_key:
            raise ValueError("No Google API key available")
        
        # Use the new genai.Client API
        client = genai.Client(api_key=api_key)
        
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": schema_class,
                "max_output_tokens": 8192,
                "temperature": 0.3,
            }
        )
        
        # Try to use parsed response first (from new API)
        if hasattr(response, 'parsed') and response.parsed is not None:
            print(f"✅ API call successful - structured response parsed automatically")
            return response.parsed
        elif hasattr(response, 'text') and response.text:
            print(f"✅ API call successful - structured response received")
            # Try to extract and fix the JSON first
            response_text = response.text
            try:
                from backend.text_to_graph_pipeline.agentic_workflows.nodes import extract_json_from_response
                extracted_json = extract_json_from_response(response_text)
                if extracted_json != response_text:
                    print(f"🔧 Extracted JSON from markdown wrapper")
                    response_text = extracted_json
            except Exception as extract_error:
                print(f"⚠️ JSON extraction failed: {extract_error}")
            
            # Validate the JSON after cleaning
            try:
                # Parse the response using the schema
                parsed_response = schema_class.model_validate_json(response_text)
                return parsed_response
            except Exception as json_error:
                print(f"❌ JSON validation error: {json_error}")
                print(f"Response text: {response_text}")
                raise json_error
        else:
            print(f"❌ No text in response: {response}")
            raise ValueError("No text content in Gemini response")
            
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")


def call_llm(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
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
    if not GEMINI_AVAILABLE:
        raise RuntimeError(
            "❌ Gemini API is not available. Please ensure:\n"
            "1. google-generativeai package is installed: pip install google-generativeai\n"
            "2. GOOGLE_API_KEY environment variable is set\n"
            "3. API key is valid and has proper permissions"
        )
    
    try:
        import google.genai as genai
        
        print(f"🤖 Calling Gemini API ({model_name})...")
        
        # Get API key
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            try:
                from backend import settings
                api_key = getattr(settings, 'GOOGLE_API_KEY', None)
            except ImportError:
                pass
        
        if not api_key:
            raise ValueError("No Google API key available")
        
        # Use the new genai.Client API
        client = genai.Client(api_key=api_key)
        
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config={
                "max_output_tokens": 8192,
                "temperature": 0.3,
            }
        )
        
        # Check if response has text
        if hasattr(response, 'text') and response.text:
            print(f"✅ API call successful - response length: {len(response.text)} chars")
            return response.text
        else:
            print(f"❌ No text in response: {response}")
            raise ValueError("No text content in Gemini response")
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")



