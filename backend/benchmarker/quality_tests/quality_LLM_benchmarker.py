"""
Quality benchmarker for VoiceTree system.

This module runs VoiceTree on sample input and uses an LLM to rate the quality of the output.
"""

import asyncio
import logging
import sys
import os

# Add parent directories to path for imports
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
sys.path.insert(0, backend_dir)

from benchmarker.quality_tests import (
    DEFAULT_TEST_TRANSCRIPTS,
    TranscriptProcessor,
    QualityEvaluator
)


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
    
    processor = TranscriptProcessor()
    evaluator = QualityEvaluator()
    
    for transcript_info in test_transcripts:
        print(f"\n{'='*60}")
        print(f"Testing: {transcript_info['name']}")
        print(f"{'='*60}\n")
        
        # Process transcript
        await processor.process_transcript(
            transcript_info['file'], 
            transcript_info.get('max_words')
        )
        
        # Evaluate quality
        evaluator.evaluate_tree_quality(
            transcript_info['file'], 
            transcript_info['name']
        )
        
        print(f"\nEvaluation completed for {transcript_info['name']}")
        print("See quality_log.txt and latest_quality_log.txt for results.")


async def main():
    """Main entry point for quality benchmarking."""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # You can customize test transcripts here or use defaults
    await run_quality_benchmark()


if __name__ == "__main__":
    asyncio.run(main())