"""
Legacy LLM API module - now using the newer llm_integration module as backend
Maintains backward compatibility for existing code
"""

import logging
import time
import sys
import os
from pathlib import Path
from enum import Enum

# Add path to find the newer LLM integration module
current_dir = Path(__file__).parent
agentic_dir = current_dir.parent.parent / 'agentic_workflows'
sys.path.insert(0, str(agentic_dir))

try:
    from llm_integration import call_llm
    MODERN_LLM_AVAILABLE = True
except ImportError:
    # Fallback to the old implementation if the new one isn't available
    import google.generativeai as genai
    import settings
    MODERN_LLM_AVAILABLE = False


async def generate_async(task, prompt):
    """
    Legacy async generation function - now uses modern LLM integration
    Maintains backward compatibility while using improved backend
    """
    start_time = time.time()
    
    if MODERN_LLM_AVAILABLE:
        # Use the modern LLM integration
        logging.info(f"{getattr(task, 'value', str(task))} Prompt: {prompt}")
        
        try:
            response_text = call_llm(prompt)
            elapsed_time = time.time() - start_time
            
            logging.info(f"{getattr(task, 'value', str(task))} LLM raw response: {response_text}")
            logging.info(f"{getattr(task, 'value', str(task))} LLM generation took: {elapsed_time:.4f} seconds")
            
            return response_text
            
        except Exception as e:
            logging.error(f"Modern LLM integration failed: {e}")
            # Fall back to old implementation
            pass
    
    # Original implementation (fallback)
    try:
        import settings
        model = settings.LLM_MODELS[task]
        response = await model.generate_content_async(
            prompt,
            generation_config=settings.LLM_PARAMETERS[task],
            safety_settings=settings.safety_settings,
        )
        elapsed_time = time.time() - start_time
        logging.info(f"{task.value} Prompt: {prompt}")
        logging.info(f"{task.value} LLM raw response: {response.text}")
        logging.info(f"{task.value} LLM summarization took: {elapsed_time:.4f} seconds")

        return response.text
    except Exception as e:
        logging.error(f"LLM API generation failed: {e}")
        raise
