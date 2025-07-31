"""Configuration settings for quality benchmarking."""

# Directory Settings
OUTPUT_DIR = "backend/benchmarker/output"
BACKUP_DIR_BASE = "backend/benchmarker/output_backups"

# File Names
QUALITY_LOG_FILE = "backend/benchmarker/quality_logs/quality_log.txt"
LATEST_QUALITY_LOG_FILE = "backend/benchmarker/quality_logs/latest_quality_log.txt"
LATEST_RUN_CONTEXT_FILE = "backend/benchmarker/quality_logs/latest_run_context.json"
WORKFLOW_IO_LOG = "agentic_workflows/workflow_io.log"

# Model Settings
EVALUATION_MODEL = 'models/gemini-2.5-pro'

#todo, allow transcriipts to be run in parallel, with output subfolders for transcript name
# Test Transcripts
DEFAULT_TEST_TRANSCRIPTS = [
    {
        "file": "backend/benchmarker/input/voiceTree_clustering.txt",
        "name": "VT Clustering",
        "max_words": 63 * 10 + 1,
        "processing_mode": "line",  # Options: "word" (30 words per chunk) or "line" (line by line)
        "currently_active": True
    },
    {
        "file": "backend/benchmarker/input/og_vt_transcript.txt",
        "name": "VT Original Transcript",
        "max_words": 63*10 + 1,
        "processing_mode": "word",  # Options: "word" (30 words per chunk) or "line" (line by line)
        "currently_active": True
    },
    {
        "file": "backend/benchmarker/input/owl_transcript.txt", 
        "name": "GSM Owl Problem",
        "max_words": None,
        "processing_mode": "line",  # Process line by line for structured data
    },
    {
        "file": "backend/benchmarker/input/8k.txt",
        "name": "GSM Owl Problem",
        "max_words": None,
        "processing_mode": "line",  # Process line by line for structured data
    },
    {
        "file": "backend/benchmarker/input/igsm_op19_ip20_force_True_7_problem_question.txt",
        "name": "GSM hard hard hard",
        "max_words": None,
        "processing_mode": "line",  # Process line by line for structured data
        "currently_active": False
    },
    {
        "file": "backend/benchmarker/input/igsm_op17_ip20_force_True_0_problem_question.txt",
        "name": "GSM 16k hard",
        "max_words": None,
        "processing_mode": "line",  # Process line by line for structured data
        # "currently_active": True
    }
]