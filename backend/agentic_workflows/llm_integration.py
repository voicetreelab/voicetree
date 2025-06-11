"""
LLM integration for VoiceTree LangGraph workflow
"""

import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any
from dotenv import load_dotenv

# Configuration
DEFAULT_MODEL = "gemini-2.0-flash"
MOCK_RESPONSES = {
    "segmentation": {
        "chunks": [
            {"name": "Project Discussion", "text": "Today I want to work on my project", "is_complete": True},
            {"name": "Feature Planning", "text": "I need to add new features to make it better", "is_complete": True}
        ]
    },
    "relationship": [
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
    ],
    "integration": [
        {
            "name": "Project Discussion",
            "text": "Today I want to work on my project", 
            "action": "CREATE",
            "target_node": "NO_RELEVANT_NODE",
            "new_node_name": "Project Discussion",
            "new_node_summary": "Discussion about working on a project today.",
            "relationship_for_edge": None
        },
        {
            "name": "Feature Planning",
            "text": "I need to add new features to make it better",
            "action": "CREATE", 
            "target_node": "Project Discussion",
            "new_node_name": "Feature Planning",
            "new_node_summary": "Planning to add new features to improve the project.",
            "relationship_for_edge": "elaborates on"
        }
    ],
    "extraction": "Project Discussion, Feature Planning"
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
        import google.generativeai as genai
        
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
            genai.configure(api_key=api_key)
            print("✅ Gemini API configured successfully")
            return True
        else:
            print("⚠️ No API key found")
            return False
            
    except ImportError:
        print("⚠️ Google Generative AI package not available")
        return False


# Initialize on module load
_load_environment()
GEMINI_AVAILABLE = _initialize_gemini()


def call_llm(prompt: str, model_name: str = DEFAULT_MODEL) -> str:
    """
    Call the LLM with the given prompt
    
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
        from google.generativeai import GenerativeModel
        
        print(f"🤖 Calling Gemini API ({model_name})...")
        model = GenerativeModel(model_name)
        response = model.generate_content(prompt)
        print(f"✅ API call successful - response length: {len(response.text)} chars")
        
        return response.text
    except Exception as e:
        print(f"❌ Error calling Gemini API: {str(e)}")
        print("⚠️ Falling back to mock response")
        return _get_mock_response(prompt)


def _get_mock_response(prompt: str) -> str:
    """
    Get appropriate mock response based on prompt content
    
    Args:
        prompt: The prompt to analyze
        
    Returns:
        Mock response string
    """
    import json
    
    prompt_lower = prompt.lower()
    
    if "segmenting conversational transcripts" in prompt_lower:
        return json.dumps(MOCK_RESPONSES["segmentation"], indent=2)
    elif "semantic matching" in prompt_lower:
        return json.dumps(MOCK_RESPONSES["relationship"], indent=2)
    elif "deciding how to integrate" in prompt_lower:
        return json.dumps(MOCK_RESPONSES["integration"], indent=2)
    elif "extract from this output" in prompt_lower:
        return MOCK_RESPONSES["extraction"]
    
    return "Mock response for unknown prompt type"
