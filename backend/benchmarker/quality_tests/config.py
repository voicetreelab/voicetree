"""Configuration settings for quality benchmarking."""

# API Settings
REQUESTS_PER_MINUTE = 15  # to avoid breaching 15RPM gemini limit
SECONDS_PER_REQUEST = 60 / REQUESTS_PER_MINUTE

# Directory Settings
OUTPUT_DIR = "oldVaults/VoiceTreePOC/QualityTest"
BACKUP_DIR_BASE = "oldVaults/VoiceTreePOC/OLDQualityTest"

# File Names
QUALITY_LOG_FILE = "quality_log.txt"
LATEST_QUALITY_LOG_FILE = "latest_quality_log.txt"
LATEST_RUN_CONTEXT_FILE = "latest_run_context.json"
WORKFLOW_IO_LOG = "backend/agentic_workflows/workflow_io.log"
VOICETREE_LOG_FILE = "voicetree.log"

# Model Settings
EVALUATION_MODEL = 'models/gemini-2.5-pro-preview-06-05'

# Test Transcripts
DEFAULT_TEST_TRANSCRIPTS = [
    {
        "file": "oldVaults/VoiceTreePOC/og_vt_transcript.txt",
        "name": "VoiceTree Original",
        "max_words": 150
    }
]