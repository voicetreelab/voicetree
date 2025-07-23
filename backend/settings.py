"""
Central settings file for VoiceTree
Imports and assembles configurations from various modules
"""

import os
from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_config import LLMConfig

# Environment variables
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Buffer configuration values
TEXT_BUFFER_SIZE_THRESHOLD = int(os.getenv("BUFFER_SIZE_THRESHOLD", 163))
TRANSCRIPT_HISTORY_MULTIPLIER = int(os.getenv("TRANSCRIPT_HISTORY_MULTIPLIER", 3))
IMMEDIATE_PROCESSING_SIZE_MULTIPLIER = float(os.getenv("IMMEDIATE_PROCESSING_SIZE_MULTIPLIER", 1.5))
SUBSTANTIAL_CONTENT_THRESHOLD = float(os.getenv("SUBSTANTIAL_CONTENT_THRESHOLD", 0.8))
MIN_SENTENCES_FOR_IMMEDIATE = int(os.getenv("MIN_SENTENCES_FOR_IMMEDIATE", 3))

voice_config = VoiceConfig(
    model=os.getenv("VOICE_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
)

# Tree configuration values
NUM_RECENT_NODES_INCLUDE = int(os.getenv("NUM_RECENT_NODES", 10))
BACKGROUND_REWRITE_EVERY_N_APPEND = int(os.getenv("BACKGROUND_REWRITE_FREQUENCY", 2))
MAX_NODE_DEPTH = int(os.getenv("MAX_NODE_DEPTH", 10))
MAX_CHILDREN_PER_NODE = int(os.getenv("MAX_CHILDREN_PER_NODE", 50))
MAX_NODES_FOR_LLM_CONTEXT = int(os.getenv("MAX_NODES_FOR_LLM_CONTEXT", 30))

# Validate tree configuration
if NUM_RECENT_NODES_INCLUDE < 1:
    raise ValueError("NUM_RECENT_NODES_INCLUDE must be at least 1")
if BACKGROUND_REWRITE_EVERY_N_APPEND < 1:
    raise ValueError("BACKGROUND_REWRITE_EVERY_N_APPEND must be at least 1")
if MAX_NODES_FOR_LLM_CONTEXT < 1:
    raise ValueError("MAX_NODES_FOR_LLM_CONTEXT must be at least 1")

llm_config = LLMConfig()  # Uses defaults, can be customized

# Backward compatibility exports
VOICE_MODEL = voice_config.model