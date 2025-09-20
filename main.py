import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

from backend.logging_config import setup_logging
from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import (
    clear_debug_logs,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import (
    ChunkProcessor,
)
from backend.text_to_graph_pipeline.voice_to_text.voice_to_text import VoiceToTextEngine

# Configure logging
logger = setup_logging('voicetree.log', console_level=logging.ERROR)

# Create temp directory for workflow state
temp_dir = tempfile.mkdtemp()
workflow_state_file = os.path.join(temp_dir, "voicetree_workflow_state.json")

# Initialize decision tree
decision_tree = MarkdownTree()

# Load existing tree from markdown if available
markdown_dir = "markdownTreeVault"
if os.path.exists(markdown_dir):
    # Check for date subdirectories (e.g., 2025-08-02)
    subdirs = [d for d in os.listdir(markdown_dir) if os.path.isdir(os.path.join(markdown_dir, d))]
    date_subdirs = [d for d in subdirs if d.count('-') == 2 and len(d) == 10]  # YYYY-MM-DD format
    
    if date_subdirs:
        # Use the most recent date subdirectory
        latest_subdir = sorted(date_subdirs)[-1]
        markdown_load_dir = os.path.join(markdown_dir, latest_subdir)
    else:
        # Fall back to the main directory
        markdown_load_dir = markdown_dir
    
    # Check if there are .md files to load
    if os.path.exists(markdown_load_dir) and any(f.endswith('.md') for f in os.listdir(markdown_load_dir)):
        try:
            print(f"Loading existing tree from {markdown_load_dir}")
            logger.info(f"Loading existing tree from {markdown_load_dir}")
            loaded_tree = load_markdown_tree(markdown_load_dir)
            decision_tree.tree = loaded_tree.tree
            # Update next_node_id to be higher than any existing node ID
            if loaded_tree.tree:
                decision_tree.next_node_id = max(loaded_tree.tree.keys()) + 1
            logger.info(f"Loaded {len(loaded_tree.tree)} nodes from markdown")
        except Exception as e:
            logger.info(f"Failed to load tree from markdown: {e}")
            logger.info("Starting with empty tree")
            print("Starting with empty tree")
    else:
        logger.info(f"No markdown files found in {markdown_load_dir}, starting with empty tree")
else:
    logger.info(f"Markdown directory {markdown_dir} does not exist, starting with empty tree")

converter = TreeToMarkdownConverter(decision_tree.tree)
processor = ChunkProcessor(decision_tree, 
                          converter=converter)

async def transcription_loop(voice_engine, text_queue):
    """Continuously transcribe audio and put text into queue"""
    # Increase max_workers to prevent blocking when transcriptions take time
    executor = ThreadPoolExecutor(max_workers=2)
    
    try:
        while True:
            audio_chunk = voice_engine.get_ready_audio_chunk()
            
            if audio_chunk is not None:
                # Check for backlog
                pending_chunks = voice_engine._ready_for_transcription_queue.qsize()
                if pending_chunks > 0:
                    logger.warning(f"Audio backlog detected: {pending_chunks} chunks waiting")
                
                logger.info("Got audio chunk, transcribing...")
                # Transcribe in thread pool
                loop = asyncio.get_event_loop()
                try:
                    logger.info("Submitting transcription to executor...")
                    transcription = await loop.run_in_executor(
                        executor, voice_engine.transcribe_chunk, audio_chunk
                    )
                    logger.info(f"Transcription returned: '{transcription}'")
                except Exception as e:
                    logger.error(f"Error in transcription executor: {e}", exc_info=True)
                    transcription = ""
                
                if transcription:
                    logger.info(f"Transcribed: {transcription[:50]}...")
                    await text_queue.put(transcription)
                    logger.info(f"Queue size: {text_queue.qsize()}")
                    # Append to transcription log
                    with open("backend/text_to_graph_pipeline/voice_to_text/transcription_log_old.txt", "a", encoding="utf-8") as f:
                        f.write(f"{transcription}\n")
            
            await asyncio.sleep(0.01)
    finally:
        executor.shutdown(wait=True)


# --- REVISED llm_processing_loop ---
async def llm_processing_loop(text_queue, processor):
    """
    Process text from queue through the LLM pipeline without blocking the main event loop.
    """
    # Use a thread pool to run the blocking/CPU-intensive LLM work.
    # max_workers=1 ensures that LLM requests are processed sequentially.
    executor = ThreadPoolExecutor(max_workers=1)
    
    # This synchronous wrapper function will be run in the separate thread.
    # It creates a new, temporary event loop just for running our async LLM function.
    def run_llm_in_thread(text_to_process):
        """Synchronous wrapper to run our async processor function."""
        try:
            # asyncio.run() creates and manages a new event loop in this thread.
            asyncio.run(processor.process_new_text_and_update_markdown(text_to_process))
        except Exception as e:
            # Log errors that happen inside the thread
            logger.error(f"Error in LLM processing thread: {e}", exc_info=True)

    try:
        loop = asyncio.get_event_loop()
        while True:
            # Wait for text from the transcription loop.
            transcription = await text_queue.get()
            logger.info(f"Got text from queue: {transcription[:50]}...")
            
            # Offload the blocking LLM call to the background thread.
            # `await loop.run_in_executor` will yield control immediately,
            # allowing the event loop to run other tasks (like transcription).
            logger.info("Submitting LLM processing to background thread...")
            await loop.run_in_executor(
                executor,
                run_llm_in_thread,  # The synchronous wrapper
                transcription       # The argument for the wrapper
            )
            logger.info("LLM processing task submitted. Main loop is free.")
            # The loop will now continue while the LLM works in the background.

    except asyncio.CancelledError:
        logger.info("LLM processing loop cancelled.")
        raise
    finally:
        logger.info("Shutting down LLM processor executor...")
        executor.shutdown(wait=True)


async def main():
    # Clear debug logs at the start of each main.py run
    clear_debug_logs()
    
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    
    # Queue for passing text from transcription to LLM processing
    text_queue = asyncio.Queue()
    
    # Create tasks
    transcription_task = asyncio.create_task(
        transcription_loop(voice_engine, text_queue)
    )
    llm_task = asyncio.create_task(
        llm_processing_loop(text_queue, processor)
    )
    
    try:
        # Run both tasks concurrently
        await asyncio.gather(transcription_task, llm_task)
    finally:
        # Cleanup
        voice_engine.stop()
        transcription_task.cancel()
        llm_task.cancel()
        await asyncio.gather(transcription_task, llm_task, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Clean up temp files
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
