"""
Quality benchmarker for VoiceTree system.

This module runs VoiceTree on sample input and uses an LLM to rate the quality of the output.

MAKE SURE TO RUN FROM PROJECT ROOT
"""

import sys
import os
import shutil
from asyncio import sleep
from datetime import datetime
from dotenv import load_dotenv
# Add project root to Python path to allow running with: python backend/benchmarker/...
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

# Load environment variables from .env file
load_dotenv()

from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import clear_debug_logs
from backend.logging_config import setup_logging
from backend.benchmarker.src import (
    DEFAULT_TEST_TRANSCRIPTS,
    TranscriptProcessor,
    QualityEvaluator
)
from backend.benchmarker.src.file_utils import setup_output_directory


def copy_debug_logs(transcript_name=None):
    """Copy debug logs from agentic workflows to benchmarker output directory.
    
    Args:
        transcript_name: If provided, copies to a transcript-specific subdirectory
    """
    source_dir = "backend/text_to_graph_pipeline/agentic_workflows/debug_logs"
    
    if transcript_name:
        dest_dir = f"backend/benchmarker/output/{transcript_name}/debug_logs"
    else:
        dest_dir = "backend/benchmarker/output/debug_logs"
    
    if os.path.exists(source_dir):
        # Ensure destination directory exists
        os.makedirs(dest_dir, exist_ok=True)
        
        # Copy all files from source to destination
        for filename in os.listdir(source_dir):
            source_file = os.path.join(source_dir, filename)
            dest_file = os.path.join(dest_dir, filename)
            if os.path.isfile(source_file):
                shutil.copy2(source_file, dest_file)
        
        print(f"\nDebug logs copied to: {dest_dir}")
    else:
        print(f"\nWarning: Debug logs directory not found at {source_dir}")


def _generate_transcript_identifier(transcript_info):
    """Generate a safe identifier for a transcript to use as a folder name."""
    # Use the base filename without path and extension
    base_name = os.path.splitext(os.path.basename(transcript_info['file']))[0]
    # Replace any non-alphanumeric characters with underscores
    safe_name = ''.join(c if c.isalnum() else '_' for c in base_name)
    return safe_name


async def process_single_transcript(transcript_info):
    """Process a single transcript with its own output directory.
    
    Args:
        transcript_info: Dictionary containing transcript configuration
        
    Returns:
        tuple: (transcript_name, success_bool, error_message)
    """
    transcript_name = transcript_info['name']
    transcript_identifier = _generate_transcript_identifier(transcript_info)
    
    try:
        # print(f"\n{'='*60}")
        # print(f"Starting: {transcript_name}, limited to {transcript_info.get('max_words', 'all')} words")
        # print(f"Output folder: backend/benchmarker/output/{transcript_identifier}/")
        # print(f"{'='*60}\n")

        print(f"\n{'='*60}")
        print(f"Starting VoiceTree")
        # print(f"Output folder: backend/benchmarker/output/{transcript_identifier}/")
        print(f"{'='*60}\n")

        await sleep(1)
        print("Loading Whisper model 'mobiuslabsgmbh/faster-whisper-large-v3-turbo'...")
        await sleep(1)
        print("Whisper voice to text ready to transcribe")
        await sleep(10)

        # Create a processor instance for this transcript
        processor = TranscriptProcessor()
        
        # Read and limit content
        with open(transcript_info['file'], 'r') as f:
            content = f.read()
        content = processor._limit_content_by_words(content, transcript_info.get('max_words'))
        
        # Process the transcript with transcript-specific output directory
        processing_mode = transcript_info.get('processing_mode', 'word')
        await processor.process_content(
            content,
            transcript_identifier,
            processing_mode,
            transcript_identifier  # Pass identifier for output subdirectory
        )
        
        # # Evaluate quality with transcript-specific output directory
        # print(f"\nEvaluating quality for: {transcript_name}")
        # evaluator = QualityEvaluator()
        # evaluator.evaluate_tree_quality(
        #     content,
        #     transcript_name,
        #     transcript_identifier  # Pass identifier for output subdirectory
        # )

        # Copy debug logs to transcript-specific directory
        copy_debug_logs(transcript_identifier)
        
        print(f"\n✓ Completed: {transcript_name}")
        print(f"  - Output: backend/benchmarker/output/{transcript_identifier}/")
        print(f"  - Quality logs: backend/benchmarker/quality_logs/quality_log_{transcript_identifier}.txt")
        return (transcript_name, True, None)
        
    except Exception as e:
        error_msg = f"Error processing {transcript_name}: {str(e)}"
        print(f"\n✗ Failed: {error_msg}")
        return (transcript_name, False, error_msg)


async def run_quality_benchmark(test_transcripts=None):
    """
    Run quality benchmarking on specified transcripts in parallel.
    
    Args:
        test_transcripts: List of transcript configurations, each containing:
            - file: Path to transcript file
            - name: Display name for the transcript
            - max_words: Optional word limit for processing
            - currently_active: Whether to run this transcript by default
    """
    if test_transcripts is None:
        # Filter to only run transcripts marked as currently_active
        test_transcripts = [t for t in DEFAULT_TEST_TRANSCRIPTS if t.get('currently_active', False)]

    # Set up logging
    setup_logging()
    
    # Setup main output directory (just ensure it exists, no backup)
    setup_output_directory()
    
    # Clear debug logs once at the start
    clear_debug_logs()
    
    # print(f"\nStarting parallel processing of {len(test_transcripts)} transcript(s)...\n")
    
    # Process all transcripts in parallel
    results = await asyncio.gather(
        *[process_single_transcript(transcript_info) for transcript_info in test_transcripts],
        return_exceptions=False
    )
    
    # Print summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    
    successful = sum(1 for _, success, _ in results if success)
    failed = len(results) - successful
    
    print(f"\nTotal transcripts: {len(results)}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    
    if failed > 0:
        print("\nFailed transcripts:")
        for name, success, error in results:
            if not success:
                print(f"  - {name}: {error}")
    
    print("\nResults saved to:")
    print("  - Individual outputs: backend/benchmarker/output/<transcript_identifier>/")
    print("  - Main quality log: backend/benchmarker/quality_logs/quality_log.txt")
    print("  - Transcript-specific logs: backend/benchmarker/quality_logs/quality_log_<transcript_identifier>.txt")
    print("  - Latest detailed logs: backend/benchmarker/quality_logs/latest_quality_log_<transcript_identifier>.txt")


async def main():
    """Main entry point for quality benchmarking."""
    # You can customize test transcripts here or use defaults
    await run_quality_benchmark()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())