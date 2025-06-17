"""
VoiceTree Backend Package

Core backend functionality for the VoiceTree voice-to-knowledge-graph system.

Main modules:
- tree_manager: Decision tree management and processing
- agentic_workflows: Multi-agent LLM processing pipeline  
- voice_to_text: Audio processing and transcription
- settings: Configuration and environment management

Usage:
    from backend import settings
    from backend.tree_manager import ContextualTreeManager
    from backend.agentic_workflows import VoiceTreePipeline
"""

# Import commonly used components for convenience
try:
    from . import settings
except ImportError:
    # Fallback for when settings can't be imported
    pass

__version__ = "1.0.0"
__all__ = ["settings"]
