#!/usr/bin/env python3
"""
LLM Air Traffic Control - Driver for intelligent graph traversal
First identifies top relevant nodes using TF-IDF, then performs traversal
while tracking seen nodes to avoid duplicate output.
"""

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Dict
from typing import List
from typing import Optional
from typing import Set

# Import the idf_traversal functions
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from idf_traversal import find_top_relevant_nodes
from idf_traversal import format_relevant_nodes
from idf_traversal import format_traversed_content
from idf_traversal import preprocess_text
from idf_traversal import read_markdown_file
from idf_traversal import setup_nltk_stopwords
from idf_traversal import traverse_graph


class SeenNodesTracker:
    """Tracks which nodes have been seen across multiple runs."""
    
    def __init__(self, csv_path: Path):
        self.csv_path = csv_path
        self.seen_nodes = self._load_seen_nodes()
    
    def _load_seen_nodes(self) -> Set[str]:
        """Load previously seen nodes from CSV."""
        seen = set()
        if self.csv_path.exists():
            with open(self.csv_path, 'r', newline='') as f:
                reader = csv.reader(f)
                for row in reader:
                    if row:  # Skip empty rows
                        seen.add(row[0])
        return seen
    
    def add_nodes(self, nodes: List[str]):
        """Add new nodes to the seen list and save to CSV."""
        new_nodes = [node for node in nodes if node not in self.seen_nodes]
        if new_nodes:
            with open(self.csv_path, 'a', newline='') as f:
                writer = csv.writer(f)
                for node in new_nodes:
                    writer.writerow([node])
                    self.seen_nodes.add(node)
    
    def filter_unseen(self, nodes: List[str]) -> List[str]:
        """Filter out already seen nodes."""
        return [node for node in nodes if node not in self.seen_nodes]


def find_relevant_nodes_for_question(
    question: str,
    markdown_dir: Path,
    num_nodes: int = 10,
    excluded_files: Optional[Set[str]] = None
) -> List[Dict[str, float]]:
    """
    Find the most relevant nodes for a given question using TF-IDF.
    
    Args:
        question: The question to find relevant nodes for
        markdown_dir: Directory containing markdown files
        num_nodes: Number of top relevant nodes to return
        excluded_files: Set of filenames to exclude from search
    
    Returns:
        List of dicts with 'filename' and 'similarity' keys
    """
    excluded_files = excluded_files or set()
    
    # Get all markdown files
    all_md_files = [p for p in markdown_dir.glob('**/*.md') if p.is_file()]
    candidate_files = []
    
    for f in all_md_files:
        relative_path = str(f.relative_to(markdown_dir))
        # Exclude specified files and output files
        if relative_path not in excluded_files and f.name != 'accumulated.md':
            candidate_files.append(f)
    
    if not candidate_files:
        return []
    
    # Read all candidate file contents
    corpus_contents = [read_markdown_file(f) for f in candidate_files]
    
    if not any(corpus_contents):
        return []
    
    # Import TF-IDF tools
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    
    # Create TF-IDF matrix
    vectorizer = TfidfVectorizer(preprocessor=preprocess_text)
    tfidf_matrix = vectorizer.fit_transform(corpus_contents)
    
    # Transform the question
    question_vec = vectorizer.transform([question])
    
    # Calculate similarity
    cosine_similarities = cosine_similarity(question_vec, tfidf_matrix).flatten()
    
    # Get top N similar files
    most_similar_indices = cosine_similarities.argsort()[-num_nodes:][::-1]
    
    relevant_nodes = []
    for idx in most_similar_indices:
        similarity = cosine_similarities[idx]
        if similarity > 0:  # Only include nodes with some similarity
            relative_path = candidate_files[idx].relative_to(markdown_dir)
            relevant_nodes.append({
                'filename': str(relative_path),
                'similarity': float(similarity)
            })
    
    return relevant_nodes


def process_question(
    question: str,
    markdown_dir: Path,
    seen_tracker: SeenNodesTracker,
    output_path: Path,
    num_initial_nodes: int = 10,
    additional_files: Optional[List[str]] = None,
    additional_tags: Optional[List[str]] = None
) -> Dict:
    """
    Process a question by finding relevant nodes and traversing them.
    
    Args:
        question: The question to answer
        markdown_dir: Directory containing markdown files  
        seen_tracker: Tracker for seen nodes
        output_path: Path to write output
        num_initial_nodes: Number of initial nodes to find via TF-IDF
        additional_files: Additional specific files to include
        additional_tags: Additional tags to search for (future feature)
        
    Returns:
        Dict with processing results
    """
    setup_nltk_stopwords()
    
    # Find initial relevant nodes using TF-IDF
    print(f"Finding top {num_initial_nodes} relevant nodes for question...")
    print(f"Question: {question}\n")
    
    relevant_nodes = find_relevant_nodes_for_question(
        question, 
        markdown_dir, 
        num_initial_nodes,
        seen_tracker.seen_nodes
    )
    
    if not relevant_nodes:
        print("No relevant nodes found.")
        return {'status': 'no_nodes_found', 'nodes': []}
    
    print(f"Found {len(relevant_nodes)} relevant nodes:")
    for node in relevant_nodes:
        print(f"  - {node['filename']} (similarity: {node['similarity']:.4f})")
    
    # Filter out already seen nodes
    unseen_nodes = seen_tracker.filter_unseen([n['filename'] for n in relevant_nodes])
    print(f"\nFiltering out seen nodes... {len(unseen_nodes)} new nodes to process")
    
    # Add any additional files specified
    if additional_files:
        additional_unseen = seen_tracker.filter_unseen(additional_files)
        unseen_nodes.extend(additional_unseen)
        print(f"Added {len(additional_unseen)} additional files")
    
    if not unseen_nodes:
        print("All relevant nodes have already been seen.")
        return {'status': 'all_seen', 'nodes': relevant_nodes}
    
    # Perform graph traversal on unseen nodes
    print(f"\nPerforming graph traversal on {len(unseen_nodes)} nodes...")
    
    all_traversed_info = []
    all_traversed_filenames = set()
    file_cache = {}
    
    for i, node_file in enumerate(unseen_nodes):
        print(f"\nProcessing node {i+1}: {node_file}")
        visited_in_branch = set()
        branch_info = traverse_graph(node_file, markdown_dir, visited_in_branch, file_cache)
        
        if branch_info:
            all_traversed_info.append((node_file, branch_info))
            for info in branch_info:
                all_traversed_filenames.add(info['filename'])
    
    # Generate output
    final_output = []
    
    # Add header with question
    header = f"Question: {question}\n{'='*80}\n\n"
    final_output.append(header)
    
    # Add traversed content
    for i, (start_file, branch_info) in enumerate(all_traversed_info):
        final_output.append(format_traversed_content(branch_info, start_file, i + 1))
    
    # Write output
    output_path.write_text('\n'.join(final_output), encoding='utf-8')
    print(f"\nOutput written to: {output_path}")
    
    # Update seen nodes
    seen_tracker.add_nodes(list(all_traversed_filenames))
    print(f"Updated seen nodes tracker. Total seen: {len(seen_tracker.seen_nodes)}")
    
    return {
        'status': 'success',
        'nodes_processed': len(unseen_nodes),
        'total_traversed': len(all_traversed_filenames),
        'output_path': str(output_path)
    }


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="LLM Air Traffic Control - Intelligent graph traversal for question answering",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("markdown_dir", type=str, help="Directory containing markdown files")
    parser.add_argument("question", type=str, help="Question to find relevant nodes for")
    parser.add_argument("-n", "--num-nodes", type=int, default=10, 
                       help="Number of initial nodes to find (default: 10)")
    parser.add_argument("-o", "--output", type=str, default="traversal_output.md",
                       help="Output file path (default: traversal_output.md)")
    parser.add_argument("-s", "--seen-file", type=str, default="seen_nodes.csv",
                       help="CSV file to track seen nodes (default: seen_nodes.csv)")
    parser.add_argument("-f", "--files", nargs="+", 
                       help="Additional specific files to include")
    parser.add_argument("-t", "--tags", nargs="+",
                       help="Additional tags to search for (not yet implemented)")
    parser.add_argument("--reset", action="store_true",
                       help="Reset the seen nodes tracker")
    
    args = parser.parse_args()
    
    markdown_path = Path(args.markdown_dir)
    if not markdown_path.is_dir():
        print(f"Error: Directory not found: {markdown_path}")
        sys.exit(1)
    
    seen_csv_path = Path(args.seen_file)
    output_path = Path(args.output)
    
    # Reset seen nodes if requested
    if args.reset and seen_csv_path.exists():
        seen_csv_path.unlink()
        print("Reset seen nodes tracker")
    
    # Initialize seen tracker
    seen_tracker = SeenNodesTracker(seen_csv_path)
    
    # Process the question
    result = process_question(
        question=args.question,
        markdown_dir=markdown_path,
        seen_tracker=seen_tracker,
        output_path=output_path,
        num_initial_nodes=args.num_nodes,
        additional_files=args.files,
        additional_tags=args.tags
    )
    
    # Print summary
    print(f"\nProcessing complete!")
    print(f"Status: {result['status']}")
    if result['status'] == 'success':
        print(f"Nodes processed: {result['nodes_processed']}")
        print(f"Total files traversed: {result['total_traversed']}")


if __name__ == "__main__":
    main()