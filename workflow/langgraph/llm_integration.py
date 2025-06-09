"""
LLM integration for VoiceTree LangGraph workflow
"""

import os
import json
from dotenv import load_dotenv
from typing import Optional
from pathlib import Path

# Try to load .env file if it exists
dotenv_path = Path('/Users/bobbobby/repos/VoiceTreePoc/.env')
if dotenv_path.exists():
    load_dotenv(dotenv_path)
    print(f"✅ Loaded environment variables from {dotenv_path}")

try:
    import google.generativeai as genai
    from google.generativeai import GenerativeModel
    GEMINI_AVAILABLE = True
except ImportError:
    print("⚠️ Google Generative AI package not available")
    GEMINI_AVAILABLE = False

# Try to get API key from environment
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", None)

# Check if we can find the API key in settings.py
if not GOOGLE_API_KEY:
    try:
        import sys
        sys.path.append('/Users/bobbobby/repos/VoiceTreePoc')
        from backend import settings
        if hasattr(settings, 'GOOGLE_API_KEY'):
            GOOGLE_API_KEY = settings.GOOGLE_API_KEY
            print("✅ Found API key in settings.py")
    except ImportError:
        print("⚠️ Could not import settings module")

# Initialize Gemini if available
if GEMINI_AVAILABLE and GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
    print("✅ Gemini API configured successfully")
else:
    print("⚠️ Gemini API not configured - will use mock responses")


def call_llm(prompt: str, model_name: str = "gemini-2.5-flash-preview-05-20") -> str:
    """
    Call the LLM with the given prompt
    
    Args:
        prompt: The prompt to send to the LLM
        model_name: The model to use (default: gemini-2.5-flash-preview-05-20 for adaptive thinking)
        
    Returns:
        The LLM response as a string
    """
    # Use real API calls when available
    if not GEMINI_AVAILABLE or not GOOGLE_API_KEY:
        print("ℹ️ Using mock LLM responses - API not available")
        return mock_llm_call(prompt)
    
    try:
        print(f"🤖 Calling Gemini API ({model_name})...")
        model = GenerativeModel(model_name)
        response = model.generate_content(prompt)
        print(f"✅ API call successful - response length: {len(response.text)} chars")
        
        return response.text
    except Exception as e:
        print(f"❌ Error calling Gemini API: {str(e)}")
        print("⚠️ Falling back to mock response")
        return mock_llm_call(prompt)


# For now, we'll keep the mock LLM call as a fallback
def mock_llm_call(prompt: str) -> str:
    """Mock LLM call for testing - used as fallback when API is unavailable"""
    print(f"=== MOCK LLM CALL ===")
    print(f"Prompt length: {len(prompt)} characters")
    print(f"Prompt preview: {prompt[:200]}...")
    print("===================")
    
    # Return mock response based on prompt content
    if "segmenting conversational transcripts" in prompt:
        return '''
{
  "chunks": [
    {"name": "Project Discussion", "text": "Today I want to work on my project", "is_complete": true},
    {"name": "Feature Planning", "text": "I need to add new features to make it better", "is_complete": true}
  ]
}
'''
    elif "semantic matching" in prompt:
        return '''
[
  {
    "name": "Project Discussion",
    "text": "Today I want to work on my project",
    "reasoning": "This appears to be a new topic not directly related to existing nodes",
    "relevant_node_name": "NO_RELEVANT_NODE",
    "relationship": null
  },
  {
    "name": "Feature Planning", 
    "text": "I need to add new features to make it better",
    "reasoning": "This relates to the project discussion as it elaborates on project work",
    "relevant_node_name": "Project Discussion",
    "relationship": "elaborates on"
  }
]
'''
    elif "deciding how to integrate" in prompt:
        return '''
[
  {
    "name": "Project Discussion",
    "text": "Today I want to work on my project", 
    "action": "CREATE",
    "target_node": "NO_RELEVANT_NODE",
    "new_node_name": "Project Discussion",
    "new_node_summary": "Discussion about working on a project today.",
    "relationship_for_edge": null
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
]
'''
    elif "Extract from this output" in prompt:
        return "Project Discussion, Feature Planning"
    
    return "Mock response"
