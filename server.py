import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import json
import time

from backend.logging_config import setup_logging
from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import load_markdown_tree
from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import (
    clear_debug_logs,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import (
    ChunkProcessor,
)

# Load environment variables from .env file
load_dotenv()

# Configure logging - log to both file and console
logger = setup_logging('voicetree_server.log', console_level=logging.INFO)

# Create temp directory for workflow state
temp_dir = tempfile.mkdtemp()

def initialize_tree_state(directory_path: str) -> tuple:
    """
    Initialize or load a markdown tree from the specified directory.

    Args:
        directory_path: Path to the markdown tree directory

    Returns:
        Tuple of (decision_tree, converter, processor, markdown_dir)
    """
    if os.path.exists(directory_path):
        logger.info(f"Loading existing markdown tree from {directory_path}")
        tree = load_markdown_tree(directory_path) # todo shouldn't branch here, load dir should just load if exists, new graph if not
    else:
        logger.info(f"Creating new empty tree for {directory_path}")
        os.makedirs(directory_path, exist_ok=True)
        tree = MarkdownTree(output_dir=directory_path)

    # Voice-to-text files go to VT/voice subdirectory
    os.makedirs(directory_path + "/VT", exist_ok=True)

    converter = TreeToMarkdownConverter(tree.tree)
    processor = ChunkProcessor(tree, converter=converter)

    return tree, converter, processor, directory_path

# Initialize decision tree - will be set when /load-directory is called
decision_tree = None
converter = None
processor = None
markdown_dir = None

# Clear debug logs at startup
clear_debug_logs()

simple_buffer = ""

# FastAPI app setup
app = FastAPI(title="VoiceTree Server", description="API for processing text into VoiceTree")

# Background processing task (like main.py's llm_processing_loop)
async def buffer_processing_loop():
    """
    Continuously process text from buffer when ready.
    This mirrors main.py by offloading the LLM work to a dedicated thread so the
    event loop stays responsive for incoming HTTP requests.
    """
    global simple_buffer
    logger.info("Starting buffer processing loop...")

    # Dedicated executor so we never block the FastAPI event loop with LLM calls.
    executor = ThreadPoolExecutor(max_workers=1)

    def run_llm_in_thread(text_to_process: str) -> None:
        """Run the async processor inside the worker thread."""
        try:
            asyncio.run(processor.process_new_text_and_update_markdown(text_to_process))
        except Exception as exc:
            logger.error(f"Error in LLM processing thread: {exc}", exc_info=True)

    try:
        loop = asyncio.get_running_loop()
        while True:
            try:
                text_to_process = None
                # Check if buffer has enough text to process
                if len(simple_buffer) > 1:
                    text_to_process = simple_buffer
                    simple_buffer = ""

                if text_to_process:
                    if processor is None:
                        logger.warning("Skipping buffer processing - no directory loaded yet. Text will be lost.")
                        # Don't restore text to buffer - it will be lost
                    else:
                        logger.info(f"Processing buffer text ({len(text_to_process)} chars)...")
                        print(f"Buffer full, processing {len(text_to_process)} chars")

                        # Offload LLM work so new HTTP requests can be served concurrently.
                        await loop.run_in_executor(executor, run_llm_in_thread, text_to_process)

                        logger.info("Buffer processing completed")

                # Small delay to prevent CPU spinning
                await asyncio.sleep(0.1)

            except Exception as e:
                logger.error(f"Error in buffer processing loop iteration: {e}", exc_info=True)
                # Continue the loop even if there's an error
                await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        logger.info("Buffer processing loop cancelled.")
        raise
    finally:
        executor.shutdown(wait=True)

# Start the background loop when the app starts
@app.on_event("startup")
async def startup_event():
    """Start the background buffer processing loop"""
    asyncio.create_task(buffer_processing_loop())
    logger.info("VoiceTree server started with background processing")
    print("VoiceTree server started - background processing loop is running")

# Add CORS middleware for web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add middleware to log all requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()

    # Log request details
    if request.url.path == "/send-text" and request.method == "POST":
        # For send-text endpoint, we'll log the body in the endpoint itself
        logger.info(f"[REQUEST] {request.client.host} - {request.method} {request.url.path}")
    else:
        logger.info(f"[REQUEST] {request.client.host} - {request.method} {request.url.path}")

    # Process the request
    response = await call_next(request)

    # Log response time
    process_time = time.time() - start_time
    logger.info(f"[RESPONSE] {request.url.path} completed in {process_time:.3f}s with status {response.status_code}")

    return response

# Request models
class TextRequest(BaseModel):
    text: str

class LoadDirectoryRequest(BaseModel):
    directory_path: str


# API endpoint
@app.post("/send-text")
async def send_text(request: TextRequest):
    """
    Add text to the buffer (processing happens in background loop)
    """
    global simple_buffer
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # Log the incoming text
        text_preview = request.text[:100] + "..." if len(request.text) > 100 else request.text
        logger.info(f"[RECEIVED] Text ({len(request.text)} chars): '{text_preview}'")
        print(f"[API] Received text ({len(request.text)} chars): '{text_preview}'")

        # ONLY add to buffer - don't process here!
        simple_buffer += request.text

        # Get current buffer state
        buffer_length = len(simple_buffer)
        logger.info(f"[BUFFERED] Added to buffer. Buffer now at {buffer_length} chars")
        print(f"[API] Buffer length: {buffer_length} chars")

        return {"status": "success", "message": "Text added to buffer", "buffer_length": buffer_length}

    except HTTPException:
        # Re-raise HTTPExceptions (like 400 errors) without modification
        raise
    except Exception as e:
        logger.error(f"Error processing text: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing text: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    node_count = len(decision_tree.tree) if decision_tree else 0
    return {"status": "healthy", "nodes": node_count}

@app.get("/buffer-status")
async def buffer_status():
    """Get current buffer status"""
    global simple_buffer
    buffer_length = len(simple_buffer)
    return {"buffer_length": buffer_length}

@app.post("/load-directory")
async def load_directory(request: LoadDirectoryRequest):
    """
    Load or switch to a different markdown tree directory.
    This updates the global tree, converter, and processor to use the specified directory.

    Args:
        request: Contains directory_path to load

    Returns:
        Status of the operation including number of nodes loaded
    """
    global decision_tree, converter, processor, markdown_dir

    try:
        # Log all POST parameters
        logger.info(f"POST /load-directory parameters: {request.model_dump()}")

        new_dir = request.directory_path

        # Validate directory path
        if not new_dir or not new_dir.strip():
            raise HTTPException(status_code=400, detail="Directory path cannot be empty")

        logger.info(f"Loading markdown tree from directory: {new_dir}")

        # Initialize tree state using the shared function
        decision_tree, converter, processor, markdown_dir = initialize_tree_state(new_dir)

        node_count = len(decision_tree.tree)
        logger.info(f"Successfully loaded directory {new_dir} with {node_count} nodes")

        return {
            "status": "success",
            "message": f"Loaded directory: {new_dir}",
            "directory": new_dir,
            "nodes_loaded": node_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading directory: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error loading directory: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    import sys

    # Allow port to be specified via environment variable or command line
    port = int(os.environ.get("VOICETREE_PORT", 8001))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    uvicorn.run(app, host="127.0.0.1", port=port)
