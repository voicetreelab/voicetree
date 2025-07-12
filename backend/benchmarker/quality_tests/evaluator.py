"""Tree quality evaluation module."""

import os
import logging
from datetime import datetime

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
        
        # Extract overall score and summary from first two lines
        lines = evaluation.split('\n')
        overall_score = "Unknown"
        summary = "No summary provided"
        
        # Extract from first few lines
        for i, line in enumerate(lines[:5]):  # Check first 5 lines to be safe
            if line.startswith("Overall Score:"):
                overall_score = line.replace("Overall Score:", "").strip()
            elif line.startswith("Summary:"):
                summary = line.replace("Summary:", "").strip()
        
        # Concise one-line format for quality_log.txt
        concise_entry = (
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | "
            f"{transcript_name if transcript_name else 'Unknown'} | "
            f"{commit_hash[:10]} | "
            f"{overall_score} | "
            f"{summary}\n"
        )
        
        # Detailed format for latest_quality_log.txt
        detailed_entry = (
            f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Transcript: {transcript_name if transcript_name else transcript_file}\n"
            f"Git Commit: {commit_message} ({commit_hash})\n"
            f"Processing Method: Agentic Workflow (Multi-Stage)\n"
            f"Quality Score: {evaluation}\n\n"
        )
        
        return concise_entry, detailed_entry, commit_hash, commit_message
    
    def _write_logs(self, concise_entry, detailed_entry):
        """Write evaluation to log files."""
        # Ensure the logs directory exists
        os.makedirs(os.path.dirname(QUALITY_LOG_FILE), exist_ok=True)
        
        # Write concise entry to the main historical quality log file (append)
        with open(QUALITY_LOG_FILE, "a") as log_file:
            log_file.write(concise_entry)
        
        # Write detailed entry to the latest log file (overwrite)
        with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
            log_file.write(detailed_entry)
    
    def evaluate_tree_quality(self, transcript_content, transcript_name=""):
        """Evaluate the quality of the generated tree using an LLM."""
        # Package the output
        packaged_output = self._package_output()
        
        # Load workflow prompts
        prompts_content = self._load_workflow_prompts()
        
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
        
        # Generate and write log entries
        concise_entry, detailed_entry, commit_hash, commit_message = self._generate_log_entry(
            transcript_name, "", evaluation
        )
        self._write_logs(concise_entry, detailed_entry)
        
        # Save run context
        save_run_context("", commit_hash, commit_message)
        
        return evaluation