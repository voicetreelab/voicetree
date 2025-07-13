"""
Quality benchmarker for VoiceTree system.

This module runs VoiceTree on sample input and uses an LLM to rate the quality of the output.

MAKE SURE TO RUN FROM PROJECT ROOT
"""

import sys
import os
# Add project root to Python path to allow running with: python backend/benchmarker/...
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import clear_debug_logs
from backend.logging_config import setup_logging
from backend.benchmarker.src import (
    DEFAULT_TEST_TRANSCRIPTS,
    TranscriptProcessor,
    QualityEvaluator
)


def run_quality_benchmark(test_transcripts=None):
    """
    Run quality benchmarking on specified transcripts.
    
    Args:
        test_transcripts: List of transcript configurations, each containing:
            - file: Path to transcript file
            - name: Display name for the transcript
            - max_words: Optional word limit for processing
    """
    if test_transcripts is None:
        test_transcripts = DEFAULT_TEST_TRANSCRIPTS

    # Set up logging
    setup_logging()
    
    clear_debug_logs()
    
    processor = TranscriptProcessor()
    evaluator = QualityEvaluator()
    
    for transcript_info in test_transcripts:
        print(f"\n{'='*60}")
        print(f"Testing: {transcript_info['name']}, limited to {transcript_info['max_words']}")
        print(f"{'='*60}\n")

        # Read and limit content once for both processing and evaluation
        with open(transcript_info['file'], 'r') as f:
            content = f.read()
        content = processor._limit_content_by_words(content, transcript_info.get('max_words'))
        
        # this actually runs VoiceTree on the transcript
        processor.process_content(
            content,
            transcript_info['file']  # use file path as identifier
        )
        
        # Evaluate quality
        evaluator.evaluate_tree_quality(
            content, 
            transcript_info['name']
        )
        
        print(f"\nEvaluation completed for {transcript_info['name']}")
        print("See backend/benchmarker/logs/quality_log.txt and backend/benchmarker/logs/latest_quality_log.txt for results.")


def main():
    """Main entry point for quality benchmarking."""
    # You can customize test transcripts here or use defaults
    run_quality_benchmark()


if __name__ == "__main__":
    main()