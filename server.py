import logging
import os
import tempfile

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

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

# Configure logging
logger = setup_logging('voicetree.log', console_level=logging.ERROR)

# Create temp directory for workflow state
temp_dir = tempfile.mkdtemp()
workflow_state_file = os.path.join(temp_dir, "voicetree_workflow_state.json")

# Initialize decision tree with output directory override
markdown_dir = os.environ.get("VOICETREE_MARKDOWN_DIR", "markdownTreeVault")
decision_tree = MarkdownTree(output_dir=markdown_dir)

# Load existing tree from markdown if available
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
                          converter=converter,
                          output_dir=markdown_dir)

# Clear debug logs at startup
clear_debug_logs()

# FastAPI app setup
app = FastAPI(title="VoiceTree Server", description="API for processing text into VoiceTree")

# Add CORS middleware for web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request model
class TextRequest(BaseModel):
    text: str

# API endpoint
@app.post("/send-text")
async def send_text(request: TextRequest):
    """
    Process text input through the VoiceTree pipeline
    """
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        logger.info(f"Processing text: {request.text[:50]}...")

        # Process text through existing pipeline
        await processor.process_new_text_and_update_markdown(request.text)

        logger.info("Text processing completed successfully")
        # Get buffer length from the processor's buffer manager
        buffer_length = len(processor.buffer_manager.getBuffer()) if processor.buffer_manager else 0
        return {"status": "success", "message": "Text processed successfully", "buffer_length": buffer_length}

    except HTTPException:
        # Re-raise HTTPExceptions (like 400 errors) without modification
        raise
    except Exception as e:
        logger.error(f"Error processing text: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing text: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "nodes": len(decision_tree.tree)}

@app.get("/buffer-status")
async def buffer_status():
    """Get current buffer status"""
    buffer_length = len(processor.buffer_manager.getBuffer()) if processor.buffer_manager else 0
    return {"buffer_length": buffer_length}


if __name__ == "__main__":
    import uvicorn
    import sys

    # Allow port to be specified via environment variable or command line
    port = int(os.environ.get("VOICETREE_PORT", 8000))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    uvicorn.run(app, host="0.0.0.0", port=port)