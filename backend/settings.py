"""
Central settings file for VoiceTree
Imports and assembles configurations from various modules
"""

import os

# Environment variables
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Buffer configuration values
TEXT_BUFFER_SIZE_THRESHOLD = int(os.getenv("BUFFER_SIZE_THRESHOLD", 133))  #todo benchmarkerh overrides
# use buffer size / 2 just for the first execution?, to get the content showing


TRANSCRIPT_HISTORY_MULTIPLIER = int(os.getenv("TRANSCRIPT_HISTORY_MULTIPLIER", 9)) #todo make modifiable from benchmark config

# voice_config = VoiceConfig(
#     model=os.getenv("VOICE_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
# )

# Tree configuration values
BACKGROUND_REWRITE_EVERY_N_APPEND = int(os.getenv("BACKGROUND_REWRITE_FREQUENCY", 2))
MAX_NODES_FOR_LLM_CONTEXT = int(os.getenv("MAX_NODES_FOR_LLM_CONTEXT", 8))

# Validate tree configuration
if BACKGROUND_REWRITE_EVERY_N_APPEND < 1:
    raise ValueError("BACKGROUND_REWRITE_EVERY_N_APPEND must be at least 1")
if MAX_NODES_FOR_LLM_CONTEXT < 1:
    raise ValueError("MAX_NODES_FOR_LLM_CONTEXT must be at least 1")

# Cloud function URLs
APPEND_AGENT_URL = os.getenv(
    "APPEND_AGENT_URL",
    "https://us-central1-vocetree-alpha.cloudfunctions.net/append-agent"
)
OPTIMIZER_AGENT_URL = os.getenv(
    "OPTIMIZER_AGENT_URL",
    "https://us-central1-vocetree-alpha.cloudfunctions.net/optimizer-agent"
)
ORPHAN_AGENT_URL = os.getenv(
    "ORPHAN_AGENT_URL",
    "https://us-central1-vocetree-alpha.cloudfunctions.net/orphan-agent"
)
