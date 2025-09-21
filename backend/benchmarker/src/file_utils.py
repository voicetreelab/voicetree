"""File and directory utilities for quality benchmarking."""

import json
import os
import shutil
import subprocess
from datetime import datetime

from backend.benchmarker.src.config import BACKUP_DIR_BASE
from backend.benchmarker.src.config import LATEST_RUN_CONTEXT_FILE
from backend.benchmarker.src.config import OUTPUT_DIR
from backend.benchmarker.src.config import WORKFLOW_IO_LOG


def setup_output_directory(output_dir=None, transcript_identifier=None):
    """Handles backing up previous results and setting up a clean output directory.
    
    Args:
        output_dir: The output directory to setup. If None, uses OUTPUT_DIR from config.
        transcript_identifier: If provided, backs up only this specific transcript's output
    """
    if output_dir is None:
        output_dir = OUTPUT_DIR
        
    # For transcript-specific subdirectories
    if output_dir != OUTPUT_DIR and transcript_identifier:
        # This is a transcript-specific subdirectory
        if os.path.exists(output_dir):
            # Create a timestamped backup for this specific transcript
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_dir = os.path.join(BACKUP_DIR_BASE, f"{transcript_identifier}_backup_{timestamp}")
            
            # Ensure the base backup directory exists
            os.makedirs(BACKUP_DIR_BASE, exist_ok=True)
            
            print(f"Backing up existing output from {output_dir} to {backup_dir}")
            shutil.copytree(output_dir, backup_dir)
            
            # Clear the transcript's output directory
            shutil.rmtree(output_dir)
        
        # Create the directory fresh
        os.makedirs(output_dir, exist_ok=True)
    elif output_dir == OUTPUT_DIR and not transcript_identifier:
        # This is the main OUTPUT_DIR without a specific transcript
        # Just ensure it exists - don't backup the whole thing anymore
        os.makedirs(OUTPUT_DIR, exist_ok=True)
    else:
        # Legacy behavior for any other case
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)


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