"""
TROA: Tree Reorganization Agent
A background agent that periodically reorganizes the knowledge tree for optimal representation
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import threading

import sys
import os

# Add project root to Python path for imports
current_file = os.path.abspath(__file__)
backend_dir = os.path.dirname(current_file)
project_root = os.path.dirname(backend_dir)

# Add both project root and backend to path to handle all import scenarios
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Import without going through tree_manager package to avoid circular import
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter


class TreeReorganizationAgent:
    """
    Background agent that continuously optimizes the knowledge tree structure
    Converts TADA's 2.5-3/5 quality output into 5/5 optimized representation
    """
    
    def __init__(
        self, 
        decision_tree: DecisionTree,
        reorganization_interval: int = 120,  # 2 minutes
        transcript_window: int = 300,  # 5 minutes of transcript context
        min_nodes_for_reorganization: int = 3
    ):
        """
        Initialize the Tree Reorganization Agent
        
        Args:
            decision_tree: The decision tree to reorganize
            reorganization_interval: Seconds between reorganization cycles
            transcript_window: Seconds of transcript history to consider
            min_nodes_for_reorganization: Minimum nodes needed before reorganizing
        """
        self.decision_tree = decision_tree
        self.reorganization_interval = reorganization_interval
        self.transcript_window = transcript_window
        self.min_nodes_for_reorganization = min_nodes_for_reorganization
        
        # State tracking
        self.last_reorganization = datetime.now()
        self.transcript_history = []  # List of (timestamp, text) tuples
        self.reorganization_history = []
        self.is_running = False
        self.background_thread = None
        
        # Performance metrics
        self.metrics = {
            "reorganizations_performed": 0,
            "nodes_merged": 0,
            "nodes_split": 0,
            "relationships_optimized": 0,
            "quality_improvements": []
        }
        
        logging.info("TROA: Tree Reorganization Agent initialized")
    
    def start_background_reorganization(self):
        """Start the background reorganization process"""
        if self.is_running:
            logging.warning("TROA: Background reorganization already running")
            return
        
        self.is_running = True
        self.background_thread = threading.Thread(
            target=self._background_reorganization_loop,
            daemon=True
        )
        self.background_thread.start()
        logging.info("TROA: Background reorganization started")
    
    def stop_background_reorganization(self):
        """Stop the background reorganization process"""
        self.is_running = False
        if self.background_thread:
            self.background_thread.join(timeout=5)
        logging.info("TROA: Background reorganization stopped")
    
    def add_transcript_chunk(self, text: str):
        """Add a new transcript chunk to the history"""
        timestamp = datetime.now()
        self.transcript_history.append((timestamp, text))
        
        # Clean old transcript history
        cutoff_time = timestamp - timedelta(seconds=self.transcript_window)
        self.transcript_history = [
            (ts, txt) for ts, txt in self.transcript_history 
            if ts > cutoff_time
        ]
    
    def _background_reorganization_loop(self):
        """Main background loop for tree reorganization"""
        while self.is_running:
            try:
                # Check if reorganization is needed
                if self._should_reorganize():
                    logging.info("TROA: Starting tree reorganization cycle")
                    self._perform_reorganization()
                    self.last_reorganization = datetime.now()
                    self.metrics["reorganizations_performed"] += 1
                
                # Sleep until next check
                time.sleep(10)  # Check every 10 seconds
                
            except Exception as e:
                logging.error(f"TROA: Error in background loop: {e}")
                time.sleep(30)  # Wait longer on error
    
    def _should_reorganize(self) -> bool:
        """Determine if tree reorganization is needed"""
        # Check time interval
        time_since_last = datetime.now() - self.last_reorganization
        if time_since_last.total_seconds() < self.reorganization_interval:
            return False
        
        # Check minimum nodes
        if len(self.decision_tree.tree) < self.min_nodes_for_reorganization:
            return False
        
        # Check if there's been recent activity
        recent_activity = len([
            (ts, txt) for ts, txt in self.transcript_history
            if (datetime.now() - ts).total_seconds() < 60  # Activity in last minute
        ])
        
        if recent_activity == 0:
            return False
        
        return True
    
    def _perform_reorganization(self):
        """Perform the actual tree reorganization"""
        try:
            # Get current tree state
            tree_snapshot = self._create_tree_snapshot()
            
            # Get recent transcript context
            recent_transcript = self._get_recent_transcript()
            
            # Analyze tree structure for optimization opportunities
            optimization_plan = self._analyze_tree_structure(tree_snapshot, recent_transcript)
            
            # Apply optimizations
            changes_made = self._apply_optimizations(optimization_plan)
            
            # Log results
            if changes_made:
                logging.info(f"TROA: Reorganization completed - {changes_made}")
                self.reorganization_history.append({
                    "timestamp": datetime.now().isoformat(),
                    "changes": changes_made,
                    "tree_size": len(self.decision_tree.tree)
                })
            else:
                logging.info("TROA: No reorganization needed - tree structure optimal")
                
        except Exception as e:
            logging.error(f"TROA: Error during reorganization: {e}")
    
    def _create_tree_snapshot(self) -> Dict[str, Any]:
        """Create a snapshot of the current tree state"""
        snapshot = {
            "nodes": {},
            "relationships": [],
            "timestamp": datetime.now().isoformat(),
            "total_nodes": len(self.decision_tree.tree)
        }
        
        for node_id, node in self.decision_tree.tree.items():
            snapshot["nodes"][str(node_id)] = {
                "id": node_id,
                "title": getattr(node, 'title', ''),
                "content": getattr(node, 'content', ''),
                "summary": getattr(node, 'summary', ''),
                "parent_id": getattr(node, 'parent_id', None),
                "children": list(getattr(node, 'children', [])),
                "created_at": getattr(node, 'created_at', None),
                "modified_at": getattr(node, 'modified_at', None)
            }
            
            # Track relationships
            if hasattr(node, 'parent_id') and node.parent_id is not None:
                relationship = getattr(node, 'relationship_to_parent', 'child of')
                snapshot["relationships"].append({
                    "from": node_id,
                    "to": node.parent_id,
                    "type": relationship
                })
        
        return snapshot
    
    def _get_recent_transcript(self) -> str:
        """Get recent transcript text for context"""
        if not self.transcript_history:
            return ""
        
        # Get transcript from the last reorganization window
        cutoff_time = self.last_reorganization
        recent_chunks = [
            txt for ts, txt in self.transcript_history 
            if ts > cutoff_time
        ]
        
        return " ".join(recent_chunks)
    
    def _analyze_tree_structure(self, tree_snapshot: Dict[str, Any], recent_transcript: str) -> Dict[str, Any]:
        """Analyze tree structure and identify optimization opportunities"""
        optimization_plan = {
            "merge_candidates": [],
            "split_candidates": [],
            "relationship_improvements": [],
            "content_consolidations": [],
            "structural_improvements": []
        }
        
        nodes = tree_snapshot["nodes"]
        
        # 1. Identify merge candidates (similar or related nodes)
        merge_candidates = self._find_merge_candidates(nodes)
        optimization_plan["merge_candidates"] = merge_candidates
        
        # 2. Identify split candidates (overly large or unfocused nodes)
        split_candidates = self._find_split_candidates(nodes)
        optimization_plan["split_candidates"] = split_candidates
        
        # 3. Identify relationship improvements
        relationship_improvements = self._find_relationship_improvements(nodes, tree_snapshot["relationships"])
        optimization_plan["relationship_improvements"] = relationship_improvements
        
        # 4. Identify content consolidation opportunities
        content_consolidations = self._find_content_consolidations(nodes, recent_transcript)
        optimization_plan["content_consolidations"] = content_consolidations
        
        # 5. Identify structural improvements
        structural_improvements = self._find_structural_improvements(tree_snapshot)
        optimization_plan["structural_improvements"] = structural_improvements
        
        return optimization_plan
    
    def _find_merge_candidates(self, nodes: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Find nodes that should be merged together"""
        merge_candidates = []
        
        node_list = list(nodes.values())
        
        for i, node1 in enumerate(node_list):
            for j, node2 in enumerate(node_list[i+1:], i+1):
                # Skip root node
                if node1["id"] == 0 or node2["id"] == 0:
                    continue
                
                # Check for merge criteria
                should_merge = False
                reason = ""
                
                # 1. Very similar titles
                title1 = node1["title"].lower()
                title2 = node2["title"].lower()
                if self._calculate_similarity(title1, title2) > 0.8:
                    should_merge = True
                    reason = "Similar titles"
                
                # 2. Same parent and related content
                elif (node1["parent_id"] == node2["parent_id"] and 
                      node1["parent_id"] is not None and
                      self._calculate_similarity(node1["content"], node2["content"]) > 0.6):
                    should_merge = True
                    reason = "Same parent with related content"
                
                # 3. One node is very small and related to another
                elif (len(node1["content"]) < 50 and 
                      self._calculate_similarity(node1["content"], node2["content"]) > 0.5):
                    should_merge = True
                    reason = "Small node with related content"
                
                if should_merge:
                    merge_candidates.append({
                        "primary_node": node1["id"],
                        "secondary_node": node2["id"],
                        "reason": reason,
                        "confidence": 0.8
                    })
        
        return merge_candidates
    
    def _find_split_candidates(self, nodes: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Find nodes that should be split into multiple nodes"""
        split_candidates = []
        
        for node in nodes.values():
            if node["id"] == 0:  # Skip root
                continue
            
            content = node["content"]
            
            # Check for split criteria
            should_split = False
            reason = ""
            
            # 1. Very long content (>500 chars) with multiple distinct topics
            if len(content) > 500:
                # Count sentence endings as proxy for complexity
                sentence_count = content.count('.') + content.count('!') + content.count('?')
                if sentence_count > 5:
                    should_split = True
                    reason = "Long content with multiple topics"
            
            # 2. Content with clear discourse markers indicating multiple concepts
            discourse_markers = ["however", "but", "alternatively", "on the other hand", "meanwhile"]
            marker_count = sum(1 for marker in discourse_markers if marker in content.lower())
            if marker_count >= 2:
                should_split = True
                reason = "Multiple contrasting concepts"
            
            # 3. Lists or enumerations that could be separate nodes
            if content.count('\n•') > 3 or content.count('\n-') > 3:
                should_split = True
                reason = "Multiple enumerated items"
            
            if should_split:
                split_candidates.append({
                    "node_id": node["id"],
                    "reason": reason,
                    "confidence": 0.7
                })
        
        return split_candidates
    
    def _find_relationship_improvements(self, nodes: Dict[str, Any], relationships: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Find opportunities to improve node relationships"""
        improvements = []
        
        # Look for nodes that should have different parents
        for node in nodes.values():
            if node["id"] == 0 or node["parent_id"] is None:
                continue
            
            current_parent = nodes.get(str(node["parent_id"]))
            if not current_parent:
                continue
            
            # Find potentially better parents
            better_parent = self._find_better_parent(node, nodes)
            if better_parent and better_parent["id"] != node["parent_id"]:
                improvements.append({
                    "type": "reparent",
                    "node_id": node["id"],
                    "current_parent": node["parent_id"],
                    "suggested_parent": better_parent["id"],
                    "reason": "Better semantic relationship",
                    "confidence": 0.6
                })
        
        return improvements
    
    def _find_content_consolidations(self, nodes: Dict[str, Any], recent_transcript: str) -> List[Dict[str, Any]]:
        """Find opportunities to consolidate or update content based on recent transcript"""
        consolidations = []
        
        if not recent_transcript:
            return consolidations
        
        # Look for nodes that could be updated with recent information
        for node in nodes.values():
            if node["id"] == 0:
                continue
            
            # Check if recent transcript adds relevant information to this node
            relevance_score = self._calculate_relevance(node["content"], recent_transcript)
            if relevance_score > 0.6:
                consolidations.append({
                    "node_id": node["id"],
                    "type": "content_update",
                    "reason": "Recent transcript adds relevant information",
                    "confidence": relevance_score
                })
        
        return consolidations
    
    def _find_structural_improvements(self, tree_snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Find structural improvements for the tree"""
        improvements = []
        
        nodes = tree_snapshot["nodes"]
        
        # 1. Check for overly deep trees (>5 levels)
        max_depth = self._calculate_tree_depth(nodes)
        if max_depth > 5:
            improvements.append({
                "type": "reduce_depth",
                "current_depth": max_depth,
                "reason": "Tree too deep for easy navigation",
                "confidence": 0.8
            })
        
        # 2. Check for nodes with too many children (>7)
        for node in nodes.values():
            child_count = len(node["children"])
            if child_count > 7:
                improvements.append({
                    "type": "group_children",
                    "node_id": node["id"],
                    "child_count": child_count,
                    "reason": "Too many direct children",
                    "confidence": 0.7
                })
        
        # 3. Check for orphaned nodes (no meaningful parent relationship)
        for node in nodes.values():
            if node["id"] == 0 or node["parent_id"] is None:
                continue
            
            parent = nodes.get(str(node["parent_id"]))
            if parent and self._calculate_similarity(node["content"], parent["content"]) < 0.2:
                improvements.append({
                    "type": "find_better_parent",
                    "node_id": node["id"],
                    "reason": "Weak relationship with current parent",
                    "confidence": 0.6
                })
        
        return improvements
    
    def _apply_optimizations(self, optimization_plan: Dict[str, Any]) -> List[str]:
        """Apply the optimization plan to the tree"""
        changes_made = []
        
        # Apply high-confidence optimizations only
        
        # 1. Merge nodes
        for merge in optimization_plan["merge_candidates"]:
            if merge["confidence"] > 0.7:
                if self._merge_nodes(merge["primary_node"], merge["secondary_node"]):
                    changes_made.append(f"Merged nodes {merge['secondary_node']} into {merge['primary_node']}")
                    self.metrics["nodes_merged"] += 1
        
        # 2. Update content
        for consolidation in optimization_plan["content_consolidations"]:
            if consolidation["confidence"] > 0.7:
                if self._update_node_content(consolidation["node_id"]):
                    changes_made.append(f"Updated content for node {consolidation['node_id']}")
        
        # 3. Improve relationships (conservative approach)
        for improvement in optimization_plan["relationship_improvements"]:
            if improvement["confidence"] > 0.8:
                if self._reparent_node(improvement["node_id"], improvement["suggested_parent"]):
                    changes_made.append(f"Reparented node {improvement['node_id']}")
                    self.metrics["relationships_optimized"] += 1
        
        return changes_made
    
    def _merge_nodes(self, primary_id: int, secondary_id: int) -> bool:
        """Merge two nodes together"""
        try:
            primary_node = self.decision_tree.tree.get(primary_id)
            secondary_node = self.decision_tree.tree.get(secondary_id)
            
            if not primary_node or not secondary_node:
                return False
            
            # Merge content
            if hasattr(primary_node, 'content') and hasattr(secondary_node, 'content'):
                merged_content = primary_node.content + "\n\n" + secondary_node.content
                primary_node.content = merged_content
            
            # Update summary
            if hasattr(primary_node, 'summary') and hasattr(secondary_node, 'summary'):
                primary_node.summary = f"{primary_node.summary}. {secondary_node.summary}"
            
            # Move children of secondary to primary
            if hasattr(secondary_node, 'children'):
                for child_id in secondary_node.children:
                    child_node = self.decision_tree.tree.get(child_id)
                    if child_node and hasattr(child_node, 'parent_id'):
                        child_node.parent_id = primary_id
                        if hasattr(primary_node, 'children'):
                            primary_node.children.add(child_id)
            
            # Remove secondary node
            if hasattr(secondary_node, 'parent_id') and secondary_node.parent_id:
                parent = self.decision_tree.tree.get(secondary_node.parent_id)
                if parent and hasattr(parent, 'children'):
                    parent.children.discard(secondary_id)
            
            del self.decision_tree.tree[secondary_id]
            
            return True
            
        except Exception as e:
            logging.error(f"TROA: Error merging nodes {primary_id} and {secondary_id}: {e}")
            return False
    
    def _update_node_content(self, node_id: int) -> bool:
        """Update node content with recent relevant information"""
        try:
            node = self.decision_tree.tree.get(node_id)
            if not node:
                return False
            
            # This is a simplified implementation
            # In practice, you'd use an LLM to intelligently merge content
            recent_transcript = self._get_recent_transcript()
            if recent_transcript and hasattr(node, 'content'):
                # Simple append for now - could be made more sophisticated
                node.content += f"\n\nRecent update: {recent_transcript[:100]}..."
                if hasattr(node, 'modified_at'):
                    node.modified_at = datetime.now()
            
            return True
            
        except Exception as e:
            logging.error(f"TROA: Error updating node {node_id}: {e}")
            return False
    
    def _reparent_node(self, node_id: int, new_parent_id: int) -> bool:
        """Move a node to a new parent"""
        try:
            node = self.decision_tree.tree.get(node_id)
            new_parent = self.decision_tree.tree.get(new_parent_id)
            
            if not node or not new_parent:
                return False
            
            # Remove from old parent
            if hasattr(node, 'parent_id') and node.parent_id:
                old_parent = self.decision_tree.tree.get(node.parent_id)
                if old_parent and hasattr(old_parent, 'children'):
                    old_parent.children.discard(node_id)
            
            # Add to new parent
            node.parent_id = new_parent_id
            if hasattr(new_parent, 'children'):
                new_parent.children.add(node_id)
            
            return True
            
        except Exception as e:
            logging.error(f"TROA: Error reparenting node {node_id}: {e}")
            return False
    
    # Utility methods
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts (simplified implementation)"""
        if not text1 or not text2:
            return 0.0
        
        # Simple word overlap similarity
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        return len(intersection) / len(union) if union else 0.0
    
    def _calculate_relevance(self, node_content: str, transcript: str) -> float:
        """Calculate how relevant transcript is to node content"""
        return self._calculate_similarity(node_content, transcript)
    
    def _calculate_tree_depth(self, nodes: Dict[str, Any]) -> int:
        """Calculate the maximum depth of the tree"""
        def get_depth(node_id, visited=None):
            if visited is None:
                visited = set()
            
            if node_id in visited:
                return 0  # Avoid cycles
            
            visited.add(node_id)
            node = nodes.get(str(node_id))
            if not node or not node["children"]:
                return 1
            
            max_child_depth = 0
            for child_id in node["children"]:
                child_depth = get_depth(child_id, visited.copy())
                max_child_depth = max(max_child_depth, child_depth)
            
            return 1 + max_child_depth
        
        return get_depth(0)
    
    def _find_better_parent(self, node: Dict[str, Any], nodes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find a better parent for a node"""
        best_parent = None
        best_similarity = 0.0
        
        for potential_parent in nodes.values():
            if (potential_parent["id"] == node["id"] or 
                potential_parent["id"] == 0 or
                potential_parent["id"] == node["parent_id"]):
                continue
            
            similarity = self._calculate_similarity(node["content"], potential_parent["content"])
            if similarity > best_similarity and similarity > 0.4:
                best_similarity = similarity
                best_parent = potential_parent
        
        return best_parent
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get reorganization metrics"""
        return {
            **self.metrics,
            "is_running": self.is_running,
            "last_reorganization": self.last_reorganization.isoformat(),
            "transcript_chunks": len(self.transcript_history),
            "reorganization_history_count": len(self.reorganization_history)
        }
    
    def get_reorganization_history(self) -> List[Dict[str, Any]]:
        """Get the history of reorganizations performed"""
        return self.reorganization_history.copy()


# Integration helper functions

def integrate_troa_with_workflow_tree_manager(tree_manager, reorganization_interval: int = 120):
    """
    Integrate TROA with an existing WorkflowTreeManager
    
    Args:
        tree_manager: The WorkflowTreeManager instance
        reorganization_interval: Seconds between reorganizations
    
    Returns:
        TreeReorganizationAgent instance
    """
    troa = TreeReorganizationAgent(
        decision_tree=tree_manager.decision_tree,
        reorganization_interval=reorganization_interval
    )
    
    # Hook into the tree manager's processing
    original_process_voice_input = tree_manager.process_voice_input
    
    async def enhanced_process_voice_input(transcribed_text: str):
        # Add transcript to TROA
        troa.add_transcript_chunk(transcribed_text)
        
        # Process normally
        result = await original_process_voice_input(transcribed_text)
        
        return result
    
    tree_manager.process_voice_input = enhanced_process_voice_input
    
    # Start background reorganization
    troa.start_background_reorganization()
    
    return troa