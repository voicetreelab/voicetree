"""
Quality benchmarker for VoiceTree system.

This module runs VoiceTree on sample input and uses an LLM to rate the quality of the output.

MAKE SURE TO RUN FROM PROJECT ROOT
"""

import sys
import os
import shutil
from datetime import datetime
# Add project root to Python path to allow running with: python backend/benchmarker/...
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import clear_debug_logs
from backend.logging_config import setup_logging
from backend.benchmarker.src import (
    DEFAULT_TEST_TRANSCRIPTS,
    TranscriptProcessor,
    QualityEvaluator
)


def copy_debug_logs():
    """Copy debug logs from agentic workflows to benchmarker output directory."""
    source_dir = "backend/text_to_graph_pipeline/agentic_workflows/debug_logs"
    dest_dir = "backend/benchmarker/output/debug_logs"
    
    if os.path.exists(source_dir):
        # Create timestamped subdirectory
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        timestamped_dest = os.path.join(dest_dir, f"run_{timestamp}")
        
        # Copy the entire debug_logs directory
        shutil.copytree(source_dir, timestamped_dest)
        print(f"\nDebug logs copied to: {timestamped_dest}")
        
        # Also create a 'latest' symlink for convenience
        latest_link = os.path.join(dest_dir, "latest")
        if os.path.exists(latest_link):
            os.unlink(latest_link)
        os.symlink(os.path.basename(timestamped_dest), latest_link)
    else:
        print(f"\nWarning: Debug logs directory not found at {source_dir}")


async def run_quality_benchmark(test_transcripts=None):
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
        await processor.process_content(
            content,
            transcript_info['file']  # use file path as identifier
        )
        
        # Evaluate quality
        evaluator.evaluate_tree_quality(
            content, 
            transcript_info['name']
        )
        
        print(f"\nEvaluation completed for {transcript_info['name']}")
        print("See backend/benchmarker/quality_logs/quality_log.txt and backend/benchmarker/quality_logs/latest_quality_log.txt for results.")
    
    # Copy debug logs after all evaluations are complete
    copy_debug_logs()


async def main():
    """Main entry point for quality benchmarking."""
    # You can customize test transcripts here or use defaults
    await run_quality_benchmark()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())