"""
State Manager for VoiceTree LangGraph
Maintains persistent state of the knowledge tree between executions
"""

from typing import List, Dict, Any, Optional, Set
import json
from pathlib import Path
from datetime import datetime


class VoiceTreeStateManager:
    """Manages persistent state of the VoiceTree knowledge graph"""
    
    def __init__(self, state_file: Optional[str] = None):
        """
        Initialize the state manager
        
        Args:
            state_file: Optional path to persist state to disk
        """
        self.state_file = Path(state_file) if state_file else None
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.execution_history: List[Dict[str, Any]] = []
        
        # Load existing state if file provided
        if self.state_file and self.state_file.exists():
            self.load_state()
    
    def get_existing_node_names(self) -> List[str]:
        """Get list of all existing node names"""
        return list(self.nodes.keys())
    
    def get_node_summaries(self) -> str:
        """Get formatted summary of existing nodes for LLM context"""
        if not self.nodes:
            return "No existing nodes"
        
        summaries = []
        for name, node_data in self.nodes.items():
            summary = f"- {name}"
            if node_data.get("summary"):
                summary += f": {node_data['summary']}"
            if node_data.get("parent"):
                summary += f" (child of {node_data['parent']})"
            summaries.append(summary)
        
        return "\n".join(summaries)
    
    def add_nodes(self, new_nodes: List[str], execution_result: Dict[str, Any]) -> None:
        """
        Add new nodes from an execution
        
        Args:
            new_nodes: List of new node names created
            execution_result: Full execution result for context
        """
        # Extract integration decisions for more context
        integration_decisions = execution_result.get("integration_decisions", [])
        
        for node_name in new_nodes:
            if node_name not in self.nodes:
                # Find the integration decision for this node
                node_decision = None
                for decision in integration_decisions:
                    if decision.get("new_node_name") == node_name:
                        node_decision = decision
                        break
                
                self.nodes[node_name] = {
                    "name": node_name,
                    "created_at": datetime.now().isoformat(),
                    "summary": node_decision.get("new_node_summary") if node_decision else "",
                    "parent": node_decision.get("target_node") if node_decision else None,
                    "content": node_decision.get("content") if node_decision else "",
                    "source_chunk": node_decision.get("name") if node_decision else ""
                }
        
        # Record execution
        self.execution_history.append({
            "timestamp": datetime.now().isoformat(),
            "new_nodes": new_nodes,
            "total_nodes_after": len(self.nodes)
        })
        
        # Save state if file configured
        if self.state_file:
            self.save_state()
    
    def update_node(self, node_name: str, updates: Dict[str, Any]) -> None:
        """Update an existing node with new information"""
        if node_name in self.nodes:
            self.nodes[node_name].update(updates)
            self.nodes[node_name]["updated_at"] = datetime.now().isoformat()
            
            if self.state_file:
                self.save_state()
    
    def get_related_nodes(self, node_name: str) -> List[str]:
        """Get nodes related to a given node (parent and children)"""
        related = []
        
        # Get parent
        if node_name in self.nodes and self.nodes[node_name].get("parent"):
            related.append(self.nodes[node_name]["parent"])
        
        # Get children
        for name, node_data in self.nodes.items():
            if node_data.get("parent") == node_name:
                related.append(name)
        
        return related
    
    def save_state(self) -> None:
        """Save current state to disk"""
        if not self.state_file:
            return
        
        state_data = {
            "nodes": self.nodes,
            "execution_history": self.execution_history,
            "last_saved": datetime.now().isoformat()
        }
        
        with open(self.state_file, 'w') as f:
            json.dump(state_data, f, indent=2)
    
    def load_state(self) -> None:
        """Load state from disk"""
        if not self.state_file or not self.state_file.exists():
            return
        
        with open(self.state_file, 'r') as f:
            state_data = json.load(f)
        
        self.nodes = state_data.get("nodes", {})
        self.execution_history = state_data.get("execution_history", [])
    
    def clear_state(self) -> None:
        """Clear all state"""
        self.nodes = {}
        self.execution_history = []
        
        if self.state_file and self.state_file.exists():
            self.state_file.unlink()
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the current state"""
        return {
            "total_nodes": len(self.nodes),
            "total_executions": len(self.execution_history),
            "nodes_by_parent": self._count_nodes_by_parent(),
            "recent_additions": self._get_recent_additions(5)
        }
    
    def _count_nodes_by_parent(self) -> Dict[str, int]:
        """Count nodes grouped by parent"""
        counts = {"root": 0}
        for node_data in self.nodes.values():
            parent = node_data.get("parent", "root")
            counts[parent] = counts.get(parent, 0) + 1
        return counts
    
    def _get_recent_additions(self, n: int) -> List[str]:
        """Get the n most recently added nodes"""
        sorted_nodes = sorted(
            self.nodes.items(),
            key=lambda x: x[1].get("created_at", ""),
            reverse=True
        )
        return [name for name, _ in sorted_nodes[:n]] 