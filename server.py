import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
import json
import time
from typing import Any

from backend.sse.event_emitter import SSEEventEmitter, SSEEventType
from backend.sse.context import set_emitter

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


def initialize_tree_state(directory_path: str, embedding_manager: Any = None) -> tuple:
    """
    Initialize or load a markdown tree from the specified directory.

    Args:
        directory_path: Path to the markdown tree directory
        embedding_manager: Optional existing embedding manager to reuse (avoids ChromaDB lock conflicts)

    Returns:
        Tuple of (decision_tree, converter, processor, markdown_dir)
    """
    if os.path.exists(directory_path):
        logger.debug(f"Loading existing markdown tree from {directory_path}")
        tree = load_markdown_tree(directory_path, embedding_manager=embedding_manager)
    else:
        logger.info(f"Creating new empty tree for {directory_path}")
        os.makedirs(directory_path, exist_ok=True)
        tree = MarkdownTree(output_dir=directory_path, embedding_manager=embedding_manager)

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

# todo, this whole thing needs to be rewritten. so messy.

# TODO: simple_buffer is unnecessary indirection. Text could go directly to buffer_manager
# The benefit is decoupling HTTP requests from the processing thread.
# THE problem with removing it is we need to be able to accept /send-text requests
# but not add to the processing buffer before current processing completes
# wait actually thatt's not true, we could probs add the text straight to the actual buffer
# or buffer removing logic is robust (no order expectation)

simple_buffer = ""
last_text_received_time: float = 0.0  # Track when text was last received for auto-flush
force_flush_next_processing_iteration: bool = False  # Flag to trigger force flush on next processing loop
AUTO_FLUSH_INACTIVITY_SECONDS = 5.0  # Flush buffer after this many seconds of inactivity

# FastAPI app setup
app = FastAPI(title="VoiceTree Server", description="API for processing text into VoiceTree")

# SSE event queue for streaming progress updates
sse_event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

# Auto-sync interval: reload markdown files from disk when idle
AUTO_SYNC_INTERVAL_SECONDS = 5.0


# Background processing task (like main.py's llm_processing_loop)
async def buffer_processing_loop():
    """
    Continuously process text from buffer when ready.
    This mirrors main.py by offloading the LLM work to a dedicated thread so the
    event loop stays responsive for incoming HTTP requests.

    When idle (buffer empty), periodically reloads markdown files from disk
    to pick up external changes (auto-sync).

    Auto-flush features:
    - Time-based: Flush buffer after 2s of inactivity (no new text received)
    - Force flush: Process immediately when pending_force_flush is set (Enter key)
    """
    global simple_buffer, decision_tree, converter, processor, force_flush_next_processing_iteration, last_text_received_time
    logger.info("Starting buffer processing loop...")

    # Dedicated executor so we never block the FastAPI event loop with LLM calls.
    executor = ThreadPoolExecutor(max_workers=1)

    def run_llm_in_thread(text_to_process: str, force_flush: bool) -> None:
        """Run the async processor inside the worker thread (normal flow)."""
        try:
            # Set up SSE emitter so workflow events are sent to the frontend
            set_emitter(SSEEventEmitter(sse_event_queue))
            asyncio.run(processor.process_new_text_and_update_markdown(text_to_process, force_flush))
        except Exception as exc:
            logger.error(f"Error in LLM processing thread: {exc}", exc_info=True)
            # Emit SSE error event so frontend is notified
            sse_event_queue.put_nowait({
                "event": SSEEventType.WORKFLOW_FAILED.value,
                "data": {"error": str(exc)}
            })

    last_sync_time = time.time()

    try: # we should make this end after 1 minute of inactivity, and start it on any /send-text
        loop = asyncio.get_running_loop()
        while True:
            try:
                if processor is None:
                    logger.error("Skipping buffer processing - no directory loaded yet")
                    await asyncio.sleep(1.0)
                    continue

                if len(simple_buffer) > 0:
                    text_to_send = simple_buffer # IMPORTANT FOR NO ASYNC RACE CONDITIONS
                    simple_buffer = ""

                    if force_flush_next_processing_iteration:
                        logger.info(f"Forcing (forced) {len(simple_buffer)} chars from simple_buffer to buffer_manager")
                        await loop.run_in_executor(executor, run_llm_in_thread, text_to_send, True)
                        force_flush_next_processing_iteration = False

                    else:
                        logger.info(f"Moving {len(simple_buffer)} chars from simple_buffer to buffer_manager")
                        await loop.run_in_executor(executor, run_llm_in_thread, text_to_send, False)
                        last_text_received_time = time.time() # set time so we don't double execute immediately


                else:
                    # Time-based auto-flush after ns inactivity
                    # Time-based force flush when simple_buffer is empty but buffer_manager has content
                    if (last_text_received_time > 0 and
                            time.time() - last_text_received_time >= AUTO_FLUSH_INACTIVITY_SECONDS):
                        logger.info(f"Time-based force flush of buffer_manager after {AUTO_FLUSH_INACTIVITY_SECONDS}s inactivity")
                        last_text_received_time = 0  # Prevent repeated flushes
                        await loop.run_in_executor(executor, run_llm_in_thread, "", True)

                    # Idle - auto-sync: reload markdown files from disk to pick up external changes
                    # Only reload when BOTH buffers are empty to avoid losing unprocessed text
                    processor_buffer_empty = (processor is None or
                                              len(processor.buffer_manager.getBuffer()) == 0)
                    if (markdown_dir and
                            processor_buffer_empty and
                            time.time() - last_sync_time > AUTO_SYNC_INTERVAL_SECONDS):
                        try:
                            existing_embedding_manager = decision_tree._embedding_manager if decision_tree else None
                            decision_tree, converter, processor, _ = initialize_tree_state(markdown_dir, embedding_manager=existing_embedding_manager)
                            last_sync_time = time.time()
                            logger.debug(f"Auto-sync complete: reloaded {len(decision_tree.tree)} nodes from {markdown_dir}")
                        except Exception as e:
                            logger.error(f"Auto-sync failed: {e}", exc_info=True)

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
    force_flush: bool = False  # When True, bypass buffer threshold and process immediately


class LoadDirectoryRequest(BaseModel):
    directory_path: str


# API endpoint
@app.post("/send-text")
async def send_text(request: TextRequest):
    """
    Add text to the buffer (processing happens in background loop)

    Args:
        request.text: The text to add to buffer
        request.force_flush: If True, trigger immediate processing regardless of buffer threshold
                            (used when user presses Enter to submit text)
    """
    global simple_buffer, last_text_received_time, force_flush_next_processing_iteration
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # Log the incoming text
        text_preview = request.text[:100] + "..." if len(request.text) > 100 else request.text
        force_flag = " [FORCE_FLUSH]" if request.force_flush else ""
        logger.info(f"[RECEIVED]{force_flag} Text ({len(request.text)} chars): '{text_preview}'")
        print(f"[API] Received text ({len(request.text)} chars){force_flag}: '{text_preview}'")

        # Add to buffer
        simple_buffer += request.text


        # Set force flush flag if requested (for Enter key submissions)
        if request.force_flush:
            force_flush_next_processing_iteration = True
            logger.info("[FORCE_FLUSH] Flag set - buffer will be processed immediately")

        last_text_received_time = time.time()

        # we also buffer length based flushing deeper downstream

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


@app.get("/stream-progress")
async def stream_progress():
    """
    SSE endpoint for streaming progress updates from the workflow processing.

    Returns:
        StreamingResponse: Server-Sent Events stream with workflow progress
    """

    async def event_generator():
        while True:
            event = await sse_event_queue.get()
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


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
