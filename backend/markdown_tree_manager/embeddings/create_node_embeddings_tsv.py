"""
Script to create embeddings for all nodes in a markdown tree and save to TSV format
for visualization in TensorFlow Projector.
"""

import os
import sys
import numpy as np
from pathlib import Path
from typing import Dict
import logging
import google.generativeai as genai

# Add backend to path for imports
sys.path.append(str(Path(__file__).parent))

from markdown_to_tree.node_loader import load_node

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_all_nodes(markdown_dir: Path) -> Dict:
    """
    Load all markdown nodes from a directory.
    
    Args:
        markdown_dir: Path to directory containing markdown files
        
    Returns:
        Dictionary of node_id -> node data
    """
    nodes = {}
    md_files = list(markdown_dir.glob("*.md"))
    
    logger.info(f"Found {len(md_files)} markdown files in {markdown_dir}")
    
    for filepath in md_files:
        try:
            node_data = load_node(filepath.name, markdown_dir)
            if node_data and node_data['node_id']:
                # Create a simple node object with required attributes
                class SimpleNode:
                    def __init__(self, data):
                        self.title = data['title']
                        self.summary = data['summary']
                        self.content = data['content']
                        self.filename = data['filename']
                        self.node_id = data['node_id']
                
                nodes[node_data['node_id']] = SimpleNode(node_data)
        except Exception as e:
            logger.error(f"Failed to load {filepath.name}: {e}")
    
    logger.info(f"Successfully loaded {len(nodes)} nodes")
    return nodes

def generate_embeddings(nodes: Dict) -> Dict[str, np.ndarray]:
    """
    Generate embeddings for all nodes using Gemini API.
    
    Args:
        nodes: Dictionary of node_id -> node objects
        
    Returns:
        Dictionary of node_id -> embedding vector
    """
    # Configure Gemini
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")
    genai.configure(api_key=api_key)
    
    embeddings = {}
    
    for node_id, node in nodes.items():
        try:
            # Combine title, summary, and content snippet for embedding
            text_parts = []
            if node.title:
                text_parts.extend([node.title] * 3)  # Weight title 3x
            if node.summary:
                text_parts.extend([node.summary] * 2)  # Weight summary 2x
            if node.content:
                text_parts.append(node.content[:500])  # First 500 chars of content
            
            combined_text = " ".join(text_parts)
            
            if combined_text.strip():
                # Generate embedding using Gemini
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=combined_text,
                    task_type="retrieval_document",
                    title=f"Node {node_id}"
                )
                embeddings[node_id] = np.array(result['embedding'])
                logger.info(f"Generated embedding for node {node_id}")
        except Exception as e:
            logger.error(f"Failed to generate embedding for node {node_id}: {e}")
    
    logger.info(f"Generated {len(embeddings)} embeddings")
    return embeddings

def save_to_tsv(embeddings: Dict[str, np.ndarray], nodes: Dict, output_dir: Path):
    """
    Save embeddings to TSV format for TensorFlow Projector.
    Creates two files:
    - vectors.tsv: The embedding vectors (tab-separated values)
    - metadata.tsv: Labels and metadata for each vector
    
    Args:
        embeddings: Dictionary of node_id -> embedding vector
        nodes: Dictionary of node_id -> node objects
        output_dir: Directory to save TSV files
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    vectors_file = output_dir / "vectors.tsv"
    metadata_file = output_dir / "metadata.tsv"
    
    # Sort node IDs for consistent ordering
    sorted_node_ids = sorted(embeddings.keys())
    
    # Write vectors file
    with open(vectors_file, 'w') as f:
        for node_id in sorted_node_ids:
            vector = embeddings[node_id]
            # Write each dimension separated by tabs
            vector_str = '\t'.join(str(val) for val in vector)
            f.write(vector_str + '\n')
    
    logger.info(f"Saved vectors to {vectors_file}")
    
    # Write metadata file
    with open(metadata_file, 'w') as f:
        # Write header
        f.write("node_id\ttitle\tsummary_snippet\tfilename\n")
        
        for node_id in sorted_node_ids:
            node = nodes.get(node_id)
            if node:
                # Clean and truncate text for display
                title = (node.title or "").replace('\t', ' ').replace('\n', ' ')[:100]
                summary = (node.summary or "").replace('\t', ' ').replace('\n', ' ')[:200]
                filename = node.filename
                
                f.write(f"{node_id}\t{title}\t{summary}\t{filename}\n")
    
    logger.info(f"Saved metadata to {metadata_file}")
    
    # Also create a simple labels file with just titles
    labels_file = output_dir / "labels.tsv"
    with open(labels_file, 'w') as f:
        for node_id in sorted_node_ids:
            node = nodes.get(node_id)
            if node:
                title = (node.title or f"Node {node_id}").replace('\t', ' ').replace('\n', ' ')[:100]
                f.write(f"{title}\n")
    
    logger.info(f"Saved labels to {labels_file}")

def main():
    # Set up paths
    markdown_dir = Path("backend/benchmarker/output/user_guide_qa_audio_processing_connected_final")
    output_dir = Path("backend/embeddings_output")
    
    if not markdown_dir.exists():
        logger.error(f"Markdown directory not found: {markdown_dir}")
        sys.exit(1)
    
    # Load all nodes
    logger.info("Loading nodes from markdown files...")
    nodes = load_all_nodes(markdown_dir)
    
    if not nodes:
        logger.error("No nodes loaded")
        sys.exit(1)
    
    # Generate embeddings
    logger.info("Generating embeddings...")
    embeddings = generate_embeddings(nodes)
    
    if not embeddings:
        logger.error("No embeddings generated")
        sys.exit(1)
    
    # Save to TSV format
    logger.info("Saving embeddings to TSV format...")
    save_to_tsv(embeddings, nodes, output_dir)
    
    print(f"\n✅ Successfully created embeddings for {len(embeddings)} nodes")
    print(f"📁 Output files saved to: {output_dir.absolute()}")
    print("\nTo visualize in TensorFlow Projector:")
    print("1. Go to https://projector.tensorflow.org/")
    print("2. Click 'Load' in the left sidebar")
    print("3. Upload vectors.tsv for 'Data' and metadata.tsv for 'Metadata'")
    print("   (or use labels.tsv for simpler labels)")

if __name__ == "__main__":
    main()