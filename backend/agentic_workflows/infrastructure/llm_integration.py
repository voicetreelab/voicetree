"""
LLM integration for VoiceTree LangGraph workflow
"""

import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any, TypeVar, Type
from dotenv import load_dotenv
from pydantic import BaseModel
import threading

# Import our schema models
try:
    from ..schema_models import (
        SegmentationResponse, RelationshipResponse, 
        IntegrationResponse, NodeExtractionResponse
    )
except ImportError:
    try:
        from backend.agentic_workflows.schema_models import (
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

# Global singleton to ensure initialization happens only once across all imports
_init_lock = threading.Lock()
_global_initialized = False
_global_gemini_available = False

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
    Initialize Gemini API using google.generativeai package
    
    Returns:
        True if successfully initialized, False otherwise
    """
    try:
        # Use the standard Google Generative AI SDK
        import google.generativeai as genai
        print("✅ Google Generative AI package available")
        
        # Try to get API key from environment
        api_key = os.environ.get("GOOGLE_API_KEY")
        print(f"🔍 Environment check: GOOGLE_API_KEY {'found' if api_key else 'not found'}")
        
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
                else:
                    print("❌ No API key found in settings.py either")
            except ImportError as e:
                print(f"⚠️ Could not import settings.py: {e}")
        
        if api_key:
            try:
                # Configure the API
                genai.configure(api_key=api_key)
                
                # Test the API key by making a minimal request
                print("🧪 Testing API key validity...")
                test_model = genai.GenerativeModel('gemini-2.0-flash')
                test_response = test_model.generate_content(
                    "Say 'API test successful'",
                    generation_config=genai.GenerationConfig(max_output_tokens=10)
                )
                
                if test_response and test_response.text:
                    print("✅ Gemini API configured and tested successfully")
                    return True
                else:
                    print("❌ API key configured but test call failed - no response text")
                    return False
                    
            except Exception as api_error:
                print(f"❌ API key configured but test call failed: {api_error}")
                print(f"   Error type: {type(api_error).__name__}")
                if "API_KEY_INVALID" in str(api_error):
                    print("   → The API key appears to be invalid")
                elif "PERMISSION_DENIED" in str(api_error):
                    print("   → The API key lacks necessary permissions")
                elif "QUOTA_EXCEEDED" in str(api_error):
                    print("   → API quota exceeded")
                return False
        else:
            print("❌ No API key found in environment variables or settings.py")
            print("   → Set GOOGLE_API_KEY environment variable or add to backend/settings.py")
            return False
            
    except ImportError as e:
        print(f"❌ google.generativeai package not available: {e}")
        print("   → Install with: pip install google-generativeai")
        return False
    except Exception as e:
        print(f"❌ Unexpected error initializing Gemini API: {e}")
        print(f"   → Error type: {type(e).__name__}")
        return False


def _ensure_global_initialization():
    """Ensure global initialization happens only once, thread-safe."""
    global _global_initialized, _global_gemini_available
    
    if _global_initialized:
        return _global_gemini_available
    
    with _init_lock:
        # Double-check pattern
        if _global_initialized:
            return _global_gemini_available
        
        # Do initialization only once
        _load_environment()
        _global_gemini_available = _initialize_gemini()
        _global_initialized = True
        
        return _global_gemini_available

# Initialize on module load (only once)
_initialized = False
GEMINI_AVAILABLE = False

def _initialize_once():
    """Initialize the module only once, no matter how many times it's imported."""
    global _initialized, GEMINI_AVAILABLE
    if not _initialized:
        GEMINI_AVAILABLE = _ensure_global_initialization()
        _initialized = True

# Initialize immediately when module is first imported
_initialize_once()

# ONLY crash if explicitly requested to ensure API availability
# Unit tests and non-API modules can import this without crashing
def _is_in_unit_test():
    """Check if we're running in a unit test context."""
    import sys
    return 'pytest' in sys.modules and 'unit_tests' in ' '.join(sys.argv)

def _ensure_api_available():
    """Ensure API is available - crash if not."""
    if not GEMINI_AVAILABLE:
        # Provide more helpful error messages based on context
        context_hint = ""
        if _is_in_unit_test():
            context_hint = (
                "\n🧪 UNIT TEST CONTEXT DETECTED:\n"
                "• Unit tests should mock LLM calls instead of making real API calls\n"
                "• Consider using @mock.patch to mock call_llm and call_llm_structured\n"
                "• If this is an integration test, mark it with @pytest.mark.integration\n\n"
            )
        
        error_msg = (
            "\n" + "="*70 + "\n"
            "🚨 CRITICAL: GEMINI API UNAVAILABLE - SYSTEM CANNOT START\n"
            "="*70 + "\n"
            "The VoiceTree system is completely dependent on Google's Gemini API.\n"
            "Check the initialization logs above for specific error details.\n\n"
            "Most common issues:\n"
            "• GOOGLE_API_KEY environment variable not set\n"
            "• API key is invalid or lacks permissions\n"
            "• google-generativeai package not installed\n"
            "• API quota exceeded or service unavailable\n\n"
            f"{context_hint}"
            "Fix the issue and restart the system.\n"
            "="*70
        )
        print(error_msg)
        raise RuntimeError("GEMINI API UNAVAILABLE - CANNOT CONTINUE")


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
        RuntimeError: Always crashes if called when API is unavailable
        ValueError: If stage type is unknown
    """
    # Ensure API is available - crash if not
    _ensure_api_available()
    
    try:
        import google.generativeai as genai
        
        schema_class = SCHEMA_MAP.get(stage_type)
        if not schema_class:
            raise ValueError(f"Unknown stage type: {stage_type}")
        
        print(f"🤖 Calling Gemini API with structured output ({model_name})...")
        
        # Get API key and configure if needed
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            try:
                from backend import settings
                api_key = getattr(settings, 'GOOGLE_API_KEY', None)
            except ImportError:
                pass
        
        if not api_key:
            error_msg = "No Google API key available"
            print(f"❌ {error_msg}")
            # CRASH IMMEDIATELY - API key is required
            raise RuntimeError(error_msg)
        
        # Configure the API (safe to call multiple times)
        genai.configure(api_key=api_key)
        
        # Use the standard generativeai API
        model = genai.GenerativeModel(model_name)
        
        # Create generation config with structured output
        generation_config = genai.GenerationConfig(
            max_output_tokens=8192,
            temperature=0.1,
        )
        
        response = model.generate_content(
            prompt,
            generation_config=generation_config
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
                # Try relative import first, then absolute import
                try:
                    from ..nodes import extract_json_from_response
                except ImportError:
                    from backend.agentic_workflows.nodes import extract_json_from_response
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
                error_msg = f"❌ JSON validation error: {json_error}"
                print(error_msg)
                print(f"Response text: {response_text}")
                # CRASH IMMEDIATELY - malformed API response is unrecoverable
                raise RuntimeError(f"{error_msg}\nMalformed API response - cannot continue")
        else:
            error_msg = f"❌ No text in response: {response}"
            print(error_msg)
            # CRASH IMMEDIATELY - empty API response is unrecoverable
            raise RuntimeError(f"{error_msg}\nEmpty API response - cannot continue")
            
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        # CRASH IMMEDIATELY - API errors are unrecoverable
        raise RuntimeError(f"{error_msg}\nGemini API error - cannot continue")


def call_llm(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
    """
    Call the LLM with a text prompt and return the response
    
    Args:
        prompt: The prompt to send to the LLM
        model_name: The model to use (default: gemini-2.0-flash)
        
    Returns:
        str: The response text from the LLM
        
    Raises:
        RuntimeError: Always crashes if called when API is unavailable
    """
    # Ensure API is available - crash if not
    _ensure_api_available()
    
    try:
        import google.generativeai as genai
        
        print(f"🤖 Calling Gemini API ({model_name})...")
        
        # Get API key and configure if needed
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            try:
                from backend import settings
                api_key = getattr(settings, 'GOOGLE_API_KEY', None)
            except ImportError:
                pass
        
        if not api_key:
            error_msg = "No Google API key available"
            print(f"❌ {error_msg}")
            # CRASH IMMEDIATELY - API key is required
            raise RuntimeError(error_msg)
        
        # Configure the API (safe to call multiple times)
        genai.configure(api_key=api_key)
        
        # Use the standard generativeai API
        model = genai.GenerativeModel(model_name)
        
        # Create generation config
        generation_config = genai.GenerationConfig(
            max_output_tokens=8192,
            temperature=0.1,
        )
        
        response = model.generate_content(
            prompt,
            generation_config=generation_config
        )
        
        if hasattr(response, 'text') and response.text:
            print(f"✅ API call successful - response received")
            return response.text.strip()
        else:
            error_msg = f"❌ No text in response: {response}"
            print(error_msg)
            # CRASH IMMEDIATELY - empty API response is unrecoverable
            raise RuntimeError(f"{error_msg}\nEmpty API response - cannot continue")
            
    except Exception as e:
        error_msg = f"❌ Error calling Gemini API: {str(e)}"
        print(error_msg)
        # CRASH IMMEDIATELY - API errors are unrecoverable
        raise RuntimeError(f"{error_msg}\nGemini API error - cannot continue")



