"""File and directory utilities for quality benchmarking."""

import os
import shutil
from datetime import datetime
import subprocess
import json

from .config import (
    OUTPUT_DIR, BACKUP_DIR_BASE,
    LATEST_RUN_CONTEXT_FILE, WORKFLOW_IO_LOG
)


def setup_output_directory(output_dir=None):
    """Handles backing up previous results and setting up a clean output directory.
    
    Args:
        output_dir: The output directory to setup. If None, uses OUTPUT_DIR from config.
    """
    if output_dir is None:
        output_dir = OUTPUT_DIR
        
    # For transcript-specific subdirectories, we don't backup the entire OUTPUT_DIR
    # Just ensure the directory exists and is clean
    if output_dir != OUTPUT_DIR:
        # This is a subdirectory - just ensure it exists and is clean
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)
    else:
        # This is the main OUTPUT_DIR - do the full backup process
        if os.path.exists(OUTPUT_DIR):
            # Create a timestamped backup directory name
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_dir = os.path.join(BACKUP_DIR_BASE, f"backup_{timestamp}")
            
            # Ensure the base backup directory exists
            os.makedirs(BACKUP_DIR_BASE, exist_ok=True)
            
            print(f"Backing up existing output from {OUTPUT_DIR} to {backup_dir}")
            shutil.copytree(OUTPUT_DIR, backup_dir)
            
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