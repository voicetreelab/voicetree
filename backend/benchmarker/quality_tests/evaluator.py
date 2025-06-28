"""Tree quality evaluation module."""

import os
import logging
import sys
from datetime import datetime

# Add parent directories to path for imports
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.insert(0, backend_dir)

import google.generativeai as genai
from google.generativeai import GenerativeModel
import tools.PackageProjectForLLM

from backend import settings
from .config import (
    OUTPUT_DIR, EVALUATION_MODEL, QUALITY_LOG_FILE, 
    LATEST_QUALITY_LOG_FILE
)
from .evaluation_prompts import build_evaluation_prompt
from .file_utils import get_git_info, save_run_context


class QualityEvaluator:
    """Evaluates the quality of generated trees using LLM."""
    
    def __init__(self):
        # Configure Gemini API
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        self.model = GenerativeModel(EVALUATION_MODEL)
    
    def _load_workflow_prompts(self):
        """Load prompts from the agentic workflow."""
        prompts_content = ""
        # Correctly locate the prompts directory
        prompt_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), 
                        '../../../agentic_workflows/prompts')
        )
        
        if os.path.isdir(prompt_dir):
            for filename in sorted(os.listdir(prompt_dir)):
                if filename.endswith(".txt"):
                    try:
                        with open(os.path.join(prompt_dir, filename), 'r') as f:
                            prompts_content += f"--- START OF PROMPT: {filename} ---\n"
                            prompts_content += f.read()
                            prompts_content += f"\n--- END OF PROMPT: {filename} ---\n\n"
                    except Exception as e:
                        logging.error(f"Error reading prompt file {filename}: {e}")
        else:
            logging.warning(f"Prompts directory not found at: {prompt_dir}")
        
        return prompts_content
    
    def _package_output(self):
        """Package the Markdown output for evaluation."""
        return tools.PackageProjectForLLM.package_project(OUTPUT_DIR, ".md")
    
    def _generate_log_entry(self, transcript_name, transcript_file, evaluation):
        """Generate a log entry for the quality assessment."""
        commit_hash, commit_message = get_git_info()
        
        log_entry = (
            f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Transcript: {transcript_name if transcript_name else transcript_file}\n"
            f"Git Commit: {commit_message} ({commit_hash})\n"
            f"Processing Method: Agentic Workflow (Multi-Stage)\n"
            f"Quality Score: {evaluation}\n\n"
        )
        
        return log_entry, commit_hash, commit_message
    
    def _write_logs(self, log_entry):
        """Write evaluation to log files."""
        # Write to the main historical quality log file (append)
        with open(QUALITY_LOG_FILE, "a") as log_file:
            log_file.write(log_entry)
        
        # Write to a separate file for just the latest log (overwrite)
        with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
            log_file.write(log_entry)
    
    def evaluate_tree_quality(self, transcript_file, transcript_name=""):
        """Evaluate the quality of the generated tree using an LLM."""
        # Package the output
        packaged_output = self._package_output()
        
        # Load workflow prompts
        prompts_content = self._load_workflow_prompts()
        
        # Read transcript content
        with open(transcript_file, 'r') as f:
            transcript_content = f.read()
        
        # Build evaluation prompt
        prompt = build_evaluation_prompt(
            transcript_content, 
            packaged_output, 
            prompts_content
        )
        
        logging.info("Assess quality prompt:\n" + prompt)
        
        # Generate evaluation
        response = self.model.generate_content(prompt)
        evaluation = response.text.strip()
        
        # Generate and write log entry
        log_entry, commit_hash, commit_message = self._generate_log_entry(
            transcript_name, transcript_file, evaluation
        )
        self._write_logs(log_entry)
        
        # Save run context
        save_run_context(transcript_file, commit_hash, commit_message)
        
        return evaluation