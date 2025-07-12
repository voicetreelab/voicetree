"""File and directory utilities for quality benchmarking."""

import os
import shutil
from datetime import datetime
import subprocess
import json
import logging

from .config import (
    OUTPUT_DIR, BACKUP_DIR_BASE, VOICETREE_LOG_FILE,
    LATEST_RUN_CONTEXT_FILE, WORKFLOW_IO_LOG
)


def setup_output_directory():
    """Handles backing up previous results and setting up a clean output directory."""
    if os.path.exists(OUTPUT_DIR):
        # Create a timestamped backup directory name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = os.path.join(BACKUP_DIR_BASE, f"backup_{timestamp}")
        
        # Ensure the base backup directory exists
        os.makedirs(BACKUP_DIR_BASE, exist_ok=True)
        
        print(f"Backing up existing output from {OUTPUT_DIR} to {backup_dir}")
        shutil.copytree(OUTPUT_DIR, backup_dir)
        
        # Also move the log file if it exists
        if os.path.exists(VOICETREE_LOG_FILE):
            shutil.move(VOICETREE_LOG_FILE, os.path.join(backup_dir, VOICETREE_LOG_FILE))
            
        # Clear the output directory for a fresh run
        shutil.rmtree(OUTPUT_DIR)
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def get_git_info():
    """Get the most recent Git commit information."""
    commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()
    return commit_hash, commit_message


def save_run_context(transcript_file, commit_hash, commit_message):
    """Save the context of this run for future reference."""
    run_context = {
        "date": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "transcript_file": os.path.abspath(transcript_file),
        "output_dir": os.path.abspath(OUTPUT_DIR),
        "quality_log_file": os.path.abspath("latest_quality_log.txt"),
        "workflow_io_log": os.path.abspath(WORKFLOW_IO_LOG),
        "git_commit_hash": commit_hash,
        "git_commit_message": commit_message
    }
    with open(LATEST_RUN_CONTEXT_FILE, "w") as f:
        json.dump(run_context, f, indent=4)


def clear_workflow_log():
    """Reset the workflow I/O log for a clean run."""
    if os.path.exists(WORKFLOW_IO_LOG):
        os.remove(WORKFLOW_IO_LOG)