"""
Central settings file for VoiceTree
Imports and assembles configurations from various modules
"""

import os
from backend.text_to_graph_pipeline.text_buffer_manager import BufferConfig
from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig
from backend.text_to_graph_pipeline.tree_manager.tree_config import TreeConfig
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_config import LLMConfig

# Environment variables
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Module configurations with environment overrides
buffer_config = BufferConfig(
    buffer_size_threshold=int(os.getenv("BUFFER_SIZE_THRESHOLD", 183)),
    transcript_history_multiplier=int(os.getenv("TRANSCRIPT_HISTORY_MULTIPLIER", 3))
)

voice_config = VoiceConfig(
    model=os.getenv("VOICE_MODEL", "large-v3")
)

tree_config = TreeConfig(
    num_recent_nodes_include=int(os.getenv("NUM_RECENT_NODES", 10)),
    background_rewrite_every_n_append=int(os.getenv("BACKGROUND_REWRITE_FREQUENCY", 2))
)

llm_config = LLMConfig()  # Uses defaults, can be customized

# Backward compatibility exports
VOICE_MODEL = voice_config.model
TEXT_BUFFER_SIZE_THRESHOLD = buffer_config.buffer_size_threshold
TRANSCRIPT_HISTORY_MULTIPLIER = buffer_config.transcript_history_multiplier
NUM_RECENT_NODES_INCLUDE = tree_config.num_recent_nodes_include
BACKGROUND_REWRITE_EVERY_N_APPEND = tree_config.background_rewrite_every_n_append