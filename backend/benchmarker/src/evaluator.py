"""Tree quality evaluation module."""

import logging
import os
from datetime import datetime
from typing import Optional

import google.generativeai as genai
from google.generativeai import GenerativeModel

import tools.PackageProjectForLLM
from backend import settings
from backend.benchmarker.src.config import EVALUATION_MODEL
from backend.benchmarker.src.config import LATEST_QUALITY_LOG_FILE
from backend.benchmarker.src.config import OUTPUT_DIR
from backend.benchmarker.src.config import QUALITY_LOG_FILE
from backend.benchmarker.src.evaluation_prompts import build_evaluation_prompt
from backend.benchmarker.src.file_utils import get_git_info
from backend.benchmarker.src.file_utils import save_run_context


class QualityEvaluator:
    """Evaluates the quality of generated trees using LLM."""

    def __init__(self) -> None:
        # Configure Gemini API
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        self.model = GenerativeModel(EVALUATION_MODEL)

    def _package_output(self, output_subdirectory: Optional[str] = None) -> str:
        """Package the Markdown output for evaluation.

        Args:
            output_subdirectory: Optional subdirectory name under OUTPUT_DIR
        """
        if output_subdirectory:
            output_dir = os.path.join(OUTPUT_DIR, output_subdirectory)
        else:
            output_dir = OUTPUT_DIR
        return tools.PackageProjectForLLM.package_project(output_dir, ".md")

    def _generate_log_entry(self, transcript_name: str, transcript_file: str, evaluation: str) -> tuple[str, str, str, str]:
        """Generate a log entry for the quality assessment."""
        commit_hash, commit_message = get_git_info()

        # Extract overall score and summary from first two lines
        lines = evaluation.split('\n')
        overall_score = "Unknown"
        summary = "No summary provided"

        # Extract from first few lines
        for _i, line in enumerate(lines[:5]):  # Check first 5 lines to be safe
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

    def _write_logs(self, concise_entry: str, detailed_entry: str, transcript_identifier: Optional[str] = None) -> None:
        """Write evaluation to log files.

        Args:
            concise_entry: One-line summary for the main log
            detailed_entry: Full evaluation details
            transcript_identifier: Optional identifier to create transcript-specific logs
        """
        # Ensure the logs directory exists
        os.makedirs(os.path.dirname(QUALITY_LOG_FILE), exist_ok=True)

        # Write concise entry to the main historical quality log file (append)
        with open(QUALITY_LOG_FILE, "a") as log_file:
            log_file.write(concise_entry)

        # If transcript identifier provided, also write to transcript-specific log
        if transcript_identifier:
            transcript_log_file = os.path.join(
                os.path.dirname(QUALITY_LOG_FILE),
                f"quality_log_{transcript_identifier}.txt"
            )
            with open(transcript_log_file, "a") as log_file:
                log_file.write(concise_entry)

        # Write detailed entry to the latest log file (overwrite)
        with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
            log_file.write(detailed_entry)

        # Also write to transcript-specific latest log if identifier provided
        if transcript_identifier:
            transcript_latest_log = os.path.join(
                os.path.dirname(LATEST_QUALITY_LOG_FILE),
                f"latest_quality_log_{transcript_identifier}.txt"
            )
            with open(transcript_latest_log, "w") as log_file:
                log_file.write(detailed_entry)

    def evaluate_tree_quality(self, transcript_content: str, transcript_name: str = "", output_subdirectory: Optional[str] = None) -> str:
        """Evaluate the quality of the generated tree using an LLM.

        Args:
            transcript_content: The original transcript content
            transcript_name: Display name for the transcript
            output_subdirectory: Optional subdirectory name under OUTPUT_DIR
        """
        # Package the output
        packaged_output = self._package_output(output_subdirectory)

        # Build evaluation prompt
        prompt = build_evaluation_prompt(
            transcript_content,
            packaged_output
        )

        logging.info("Assess quality prompt:\n" + prompt)

        # Generate evaluation
        response = self.model.generate_content(prompt)
        evaluation = response.text.strip()

        # Generate and write log entries
        concise_entry, detailed_entry, commit_hash, commit_message = self._generate_log_entry(
            transcript_name, "", evaluation
        )
        self._write_logs(concise_entry, detailed_entry, output_subdirectory)

        # Save run context
        save_run_context("", commit_hash, commit_message)

        return evaluation
