"""Configuration settings for quality benchmarking."""

# Directory Settings
OUTPUT_DIR = "backend/benchmarker/output"
BACKUP_DIR_BASE = "backend/benchmarker/output_backups"

# File Names
QUALITY_LOG_FILE = "backend/benchmarker/logs/quality_log.txt"
LATEST_QUALITY_LOG_FILE = "backend/benchmarker/logs/latest_quality_log.txt"
LATEST_RUN_CONTEXT_FILE = "backend/benchmarker/logs/latest_run_context.json"
WORKFLOW_IO_LOG = "agentic_workflows/workflow_io.log"

# Model Settings
EVALUATION_MODEL = 'models/gemini-2.5-pro-preview-06-05'

# Test Transcripts
DEFAULT_TEST_TRANSCRIPTS = [
    {
        "file": "backend/benchmarker/input/og_vt_transcript.txt",
        "name": "VT Original",
        "max_words": 63*6 + 1
    }
]