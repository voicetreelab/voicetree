"""
Central settings file for VoiceTree
Imports and assembles configurations from various modules
"""

import os
from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig
from backend.text_to_graph_pipeline.tree_manager.tree_config import TreeConfig
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_config import LLMConfig

# Environment variables
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Buffer configuration values
TEXT_BUFFER_SIZE_THRESHOLD = int(os.getenv("BUFFER_SIZE_THRESHOLD", 183))
TRANSCRIPT_HISTORY_MULTIPLIER = int(os.getenv("TRANSCRIPT_HISTORY_MULTIPLIER", 3))
IMMEDIATE_PROCESSING_SIZE_MULTIPLIER = float(os.getenv("IMMEDIATE_PROCESSING_SIZE_MULTIPLIER", 1.5))
SUBSTANTIAL_CONTENT_THRESHOLD = float(os.getenv("SUBSTANTIAL_CONTENT_THRESHOLD", 0.8))
MIN_SENTENCES_FOR_IMMEDIATE = int(os.getenv("MIN_SENTENCES_FOR_IMMEDIATE", 3))

voice_config = VoiceConfig(
    model=os.getenv("VOICE_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
)

tree_config = TreeConfig(
    num_recent_nodes_include=int(os.getenv("NUM_RECENT_NODES", 10)),
    background_rewrite_every_n_append=int(os.getenv("BACKGROUND_REWRITE_FREQUENCY", 2)),
    max_nodes_for_llm_context=int(os.getenv("MAX_NODES_FOR_LLM_CONTEXT", 30))
)

llm_config = LLMConfig()  # Uses defaults, can be customized

# Backward compatibility exports
VOICE_MODEL = voice_config.model
NUM_RECENT_NODES_INCLUDE = tree_config.num_recent_nodes_include
BACKGROUND_REWRITE_EVERY_N_APPEND = tree_config.background_rewrite_every_n_append