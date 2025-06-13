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

# Mock responses for fallback (updated to match new schema)
MOCK_RESPONSES = {
    "segmentation": SegmentationResponse(chunks=[
        {"name": "Project Discussion", "text": "Today I want to work on my project", "is_complete": True},
        {"name": "Feature Planning", "text": "I need to add new features to make it better", "is_complete": True}
    ]),
    "relationship": RelationshipResponse(analyzed_chunks=[
        {
            "name": "Project Discussion",
            "text": "Today I want to work on my project",
            "reasoning": "This appears to be a new topic not directly related to existing nodes",
            "relevant_node_name": "NO_RELEVANT_NODE",
            "relationship": None
        },
        {
            "name": "Feature Planning", 
            "text": "I need to add new features to make it better",
            "reasoning": "This relates to the project discussion as it elaborates on project work",
            "relevant_node_name": "Project Discussion",
            "relationship": "elaborates on"
        }
    ]),
    "integration": IntegrationResponse(integration_decisions=[
        {
            "name": "Project Discussion",
            "text": "Today I want to work on my project", 
            "action": "CREATE",
            "target_node": "NO_RELEVANT_NODE",
            "new_node_name": "Project Discussion",
            "new_node_summary": "Discussion about working on a project today.",
            "relationship_for_edge": None,
            "content": "Today I want to work on my project"
        },
        {
            "name": "Feature Planning",
            "text": "I need to add new features to make it better",
            "action": "CREATE", 
            "target_node": "Project Discussion",
            "new_node_name": "Feature Planning",
            "new_node_summary": "Planning to add new features to improve the project.",
            "relationship_for_edge": "elaborates on",
            "content": "I need to add new features to make it better"
        }
    ]),
    "extraction": NodeExtractionResponse(new_nodes=["Project Discussion", "Feature Planning"])
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
    Initialize Gemini API if available
    
    Returns:
        True if successfully initialized, False otherwise
    """
    try:
        # Try both the new and old APIs to see what's available
        try:
            from google import genai
            new_api_available = True
        except ImportError:
            new_api_available = False
        
        try:
            import google.generativeai as old_genai
            old_api_available = True
        except ImportError:
            old_api_available = False
        
        if not (new_api_available or old_api_available):
            print("⚠️ Google Generative AI package not available")
            return False
        
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
            # Configure both APIs if available
            if old_api_available:
                old_genai.configure(api_key=api_key)
            
            if new_api_available:
                print("✅ New Gemini API available")
            if old_api_available:
                print("✅ Old Gemini API available as fallback")
            
            print("✅ Gemini API configured successfully")
            return True
        else:
            print("⚠️ No API key found")
            return False
            
    except Exception as e:
        print(f"⚠️ Error initializing Gemini API: {e}")
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
    """
    if not GEMINI_AVAILABLE:
        print("ℹ️ Using mock LLM responses - API not available")
        return MOCK_RESPONSES.get(stage_type, MOCK_RESPONSES["segmentation"])
    
    try:
        from google import genai
        
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
        
        # Use the new genai.Client API as recommended by Google
        client = genai.Client(api_key=api_key)
        
        try:
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
        except Exception as e:
            # If the new API fails, try the old API as fallback
            print(f"⚠️ New API failed ({e}), trying old API...")
            import google.generativeai as old_genai
            
            old_genai.configure(api_key=api_key)
            model = old_genai.GenerativeModel(model_name)
            
            try:
                response = model.generate_content(
                    prompt,
                    generation_config=old_genai.types.GenerationConfig(
                        response_mime_type="application/json",
                        response_schema=schema_class,
                        max_output_tokens=8192,
                        temperature=0.3,
                    )
                )
            except TypeError as te:
                if "response_mime_type" in str(te) or "response_schema" in str(te):
                    # Fallback to older API without structured output
                    print("⚠️ Using fallback generation config (older API)")
                    enhanced_prompt = f"{prompt}\n\nIMPORTANT: Return ONLY valid JSON that matches this exact schema: {schema_class.model_json_schema()}\nDo not include any explanatory text, markdown formatting, or code blocks. Return only the JSON object."
                    response = model.generate_content(
                        enhanced_prompt,
                        generation_config=old_genai.types.GenerationConfig(
                            max_output_tokens=8192,
                            temperature=0.3,
                        )
                    )
                else:
                    raise
        
        # Try to use parsed response first (from new API)
        if hasattr(response, 'parsed') and response.parsed is not None:
            print(f"✅ API call successful - structured response parsed automatically")
            return response.parsed
        elif hasattr(response, 'text') and response.text:
            print(f"✅ API call successful - structured response received")
            # Try to extract and fix the JSON first
            response_text = response.text
            try:
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
                print(f"❌ JSON validation error: {json_error}")
                print(f"Response text: {response_text}")
                raise json_error
        else:
            print(f"❌ No text in response: {response}")
            raise ValueError("No text content in Gemini response")
            
    except Exception as e:
        print(f"❌ Error calling Gemini API: {str(e)}")
        print("⚠️ Falling back to mock response")
        return MOCK_RESPONSES.get(stage_type, MOCK_RESPONSES["segmentation"])


def call_llm(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
    """
    Legacy function for backward compatibility
    Calls the LLM and returns raw text response
    
    Args:
        prompt: The prompt to send to the LLM
        model_name: The model to use (default: gemini-2.0-flash)
        
    Returns:
        The LLM response as a string
    """
    if not GEMINI_AVAILABLE:
        print("ℹ️ Using mock LLM responses - API not available")
        return _get_mock_response(prompt)
    
    try:
        import google.generativeai as genai
        
        print(f"🤖 Calling Gemini API ({model_name})...")
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        
        # Check if response has text
        if hasattr(response, 'text') and response.text:
            print(f"✅ API call successful - response length: {len(response.text)} chars")
            return response.text
        else:
            # Try to get text from candidates
            if hasattr(response, 'candidates') and response.candidates:
                text = response.candidates[0].content.parts[0].text
                print(f"✅ API call successful - response length: {len(text)} chars")
                return text
            else:
                print(f"❌ No text in response: {response}")
                raise ValueError("No text content in Gemini response")
    except Exception as e:
        print(f"❌ Error calling Gemini API: {str(e)}")
        print("⚠️ Falling back to mock response")
        return _get_mock_response(prompt)


def _get_mock_response(prompt: str) -> str:
    """
    Get appropriate mock response based on prompt content (legacy)
    
    Args:
        prompt: The prompt to analyze
        
    Returns:
        Mock response string
    """
    import json
    
    prompt_lower = prompt.lower()
    
    if "segmenting conversational transcripts" in prompt_lower:
        return MOCK_RESPONSES["segmentation"].model_dump_json()
    elif "semantic matching" in prompt_lower:
        return MOCK_RESPONSES["relationship"].model_dump_json()
    elif "deciding how to integrate" in prompt_lower:
        return MOCK_RESPONSES["integration"].model_dump_json()
    elif "extract from this output" in prompt_lower:
        return json.dumps(MOCK_RESPONSES["extraction"].model_dump()["new_nodes"])
    
    return "Mock response for unknown prompt type"
