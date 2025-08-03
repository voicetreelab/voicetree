"""
Subtree Identification Pipeline - Integrates Tree Loader, Subtree Classifier, and Node Processor

This script implements the complete pipeline:
Forest → Trees → Subtrees → Colored Nodes → Back to Markdown
"""

import asyncio
import argparse
from pathlib import Path
from typing import Dict, Any

from .tree_manager.tree_loader import TreeLoader
from .agentic_workflows.agents.subtree_classifier_agent import SubtreeClassifierAgent
from .tree_manager.node_processor import NodeProcessor


class SubtreeIdentificationPipeline:
    """
    Complete pipeline for identifying and color-coding subtrees in markdown forests.
    """
    
    def __init__(self):
        self.tree_loader = TreeLoader()
        self.subtree_classifier = SubtreeClassifierAgent()
        self.node_processor = NodeProcessor()
    
    async def run_pipeline(self, input_path: str, update_files: bool = True) -> Dict[str, Any]:
        """
        Run the complete subtree identification pipeline.
        
        Args:
            input_path: Path to tree directory or forest directory
            update_files: Whether to update original markdown files (default: True)
            
        Returns:
            Dictionary containing pipeline results and metadata
        """
        print(f"🌲 Starting Subtree Identification Pipeline on: {input_path}")
        
        # Stage 1: Tree Loading
        print("📁 Stage 1: Loading tree data...")
        if Path(input_path).is_dir() and self._is_single_tree(input_path):
            tree_data = self.tree_loader.load_single_tree(input_path)
        else:
            tree_data = self.tree_loader.load_forest(input_path)
        
        if not tree_data["trees"]:
            print("❌ No trees found in input path")
            return {"error": "No trees found", "trees_processed": 0}
        
        print(f"✅ Loaded {len(tree_data['trees'])} tree(s)")
        
        # Stage 2: Subtree Classification  
        print("🧠 Stage 2: Classifying subtrees with LLM...")
        classified_results = []
        
        for tree in tree_data["trees"]:
            print(f"  Processing tree: {tree.tree_id} ({len(tree.nodes)} nodes)")
            
            # Convert TreeData to dict format expected by classifier
            tree_dict = {
                "tree_id": tree.tree_id,
                "nodes": [
                    {
                        "node_id": node.node_id,
                        "title": node.title,
                        "content": node.content,
                        "links": node.links
                    }
                    for node in tree.nodes
                ]
            }
            
            # Run LLM classification
            classification_result = await self.subtree_classifier.run({"trees": [tree_dict]})
            
            if classification_result and hasattr(classification_result, 'classified_trees'):
                classified_results.extend(classification_result.classified_trees)
                
                # Print classification summary
                for classified_tree in classification_result.classified_trees:
                    if hasattr(classified_tree, 'subtrees'):
                        print(f"    Found {len(classified_tree.subtrees)} subtrees:")
                        for subtree in classified_tree.subtrees:
                            print(f"      - {subtree.subtree_id}: {subtree.theme} ({len(subtree.nodes)} nodes)")
        
        if not classified_results:
            print("❌ No subtrees classified successfully")
            return {"error": "Classification failed", "trees_processed": 0}
        
        print(f"✅ Classified {len(classified_results)} tree(s) into subtrees")
        
        # Stage 3: Node Processing (Color-coding and file updates)
        if update_files:
            print("🎨 Stage 3: Updating markdown files with color-coded metadata...")
            
            classified_data = {"classified_trees": []}
            
            # Convert classification results to expected format
            for classified_tree in classified_results:
                tree_dict = {
                    "tree_id": classified_tree.tree_id,
                    "subtrees": []
                }
                
                if hasattr(classified_tree, 'subtrees'):
                    for subtree in classified_tree.subtrees:
                        subtree_dict = {
                            "subtree_id": subtree.subtree_id,
                            "theme": subtree.theme,
                            "nodes": subtree.nodes
                        }
                        tree_dict["subtrees"].append(subtree_dict)
                
                classified_data["classified_trees"].append(tree_dict)
            
            # Update markdown files
            self.node_processor.process_classified_trees(classified_data, input_path)
            print("✅ Updated markdown files with subtree metadata")
        else:
            print("⏭️  Skipping file updates (update_files=False)")
        
        # Prepare results summary
        results = {
            "success": True,
            "trees_processed": len(tree_data["trees"]),
            "total_nodes": sum(len(tree.nodes) for tree in tree_data["trees"]),
            "subtrees_identified": sum(
                len(getattr(ct, 'subtrees', [])) for ct in classified_results
            ),
            "classification_results": classified_results,
            "files_updated": update_files
        }
        
        print(f"🎉 Pipeline complete! Processed {results['trees_processed']} trees, "
              f"{results['total_nodes']} nodes, {results['subtrees_identified']} subtrees identified")
        
        return results
    
    def _is_single_tree(self, path: str) -> bool:
        """Check if path is a single tree directory (vs forest directory)"""
        path_obj = Path(path)
        
        # Check if directory name looks like a tree directory (timestamped)
        if path_obj.name.startswith('2025-') or '_' in path_obj.name:
            # Check if it contains .md files directly
            return any(path_obj.glob("*.md"))
        
        return False


async def main():
    """Command-line interface for the subtree identification pipeline"""
    parser = argparse.ArgumentParser(description="VoiceTree Subtree Identification Pipeline")
    parser.add_argument("input_path", help="Path to tree directory or forest directory")
    parser.add_argument("--dry-run", action="store_true", 
                       help="Run classification without updating files")
    parser.add_argument("--verbose", "-v", action="store_true",
                       help="Enable verbose output")
    
    args = parser.parse_args()
    
    # Validate input path
    if not Path(args.input_path).exists():
        print(f"❌ Error: Path does not exist: {args.input_path}")
        return 1
    
    # Create and run pipeline
    pipeline = SubtreeIdentificationPipeline()
    
    try:
        results = await pipeline.run_pipeline(
            args.input_path, 
            update_files=not args.dry_run
        )
        
        if args.verbose:
            print("\n📊 Detailed Results:")
            print(f"  Trees processed: {results.get('trees_processed', 0)}")
            print(f"  Total nodes: {results.get('total_nodes', 0)}")
            print(f"  Subtrees identified: {results.get('subtrees_identified', 0)}")
            print(f"  Files updated: {results.get('files_updated', False)}")
        
        return 0 if results.get('success', False) else 1
        
    except Exception as e:
        print(f"❌ Pipeline failed with error: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))