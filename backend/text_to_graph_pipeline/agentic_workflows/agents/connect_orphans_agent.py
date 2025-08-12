"""
ConnectOrphansAgent - Groups disconnected tree components under parent nodes

This agent implements the LLM connection mechanism to solve the disconnected 
components problem by:
1. Identifying root nodes from disconnected subtrees
2. Analyzing relationships between roots using only titles and summaries  
3. Grouping related roots under new parent nodes when obvious relationships exist
"""

import logging
from typing import List, Dict, Optional, Set
from dataclasses import dataclass

from langgraph.graph import END

from ...tree_manager.decision_tree_ds import DecisionTree, Node
from ..core.agent import Agent
from ..core.state import ConnectOrphansAgentState
from ..models import CreateAction, BaseTreeAction
from pydantic import BaseModel, Field


@dataclass
class RootNodeInfo:
    """Information about a root node for grouping analysis"""
    node_id: int
    title: str
    summary: str
    child_count: int = 0


# Pydantic models for LLM responses
class OrphanGrouping(BaseModel):
    """A single grouping of related orphan roots"""
    root_node_ids: List[int] = Field(description="IDs of root nodes to group")
    parent_title: str = Field(description="Title for the new parent node")
    parent_summary: str = Field(description="Summary for the new parent node")
    relationship: str = Field(description="Relationship type, e.g. 'is_a_category_of'")


class ConnectOrphansResponse(BaseModel):
    """LLM response for connecting orphan nodes"""
    reasoning: str = Field(description="Explanation of grouping decisions")
    groupings: List[OrphanGrouping] = Field(
        description="List of root groupings to create",
        default_factory=list
    )
    ungrouped_roots: List[int] = Field(
        description="Root node IDs that couldn't be grouped",
        default_factory=list
    )


class ConnectOrphansAgent(Agent):
    """
    Agent that connects disconnected tree components by grouping related root nodes.
    
    This implements the Agent-LLM Connection Mechanism to address the disconnected
    components problem in VoiceTree.
    """
    
    def __init__(self):
        super().__init__("ConnectOrphansAgent", ConnectOrphansAgentState)
        self.logger = logging.getLogger(__name__)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Configure the single-prompt workflow for grouping orphans"""
        # Single prompt to analyze and group orphan nodes
        self.add_prompt_node(
            "connect_orphans",
            ConnectOrphansResponse,
            model_name="gemini-2.5-flash"
        )
        
        # Direct flow to END after grouping
        self.add_dataflow("connect_orphans", END)
    
    def find_disconnected_roots(self, tree: DecisionTree) -> List[RootNodeInfo]:
        """
        Find all root nodes (nodes with no parent) in the tree.
        These represent disconnected components.
        
        Args:
            tree: The DecisionTree to analyze
            
        Returns:
            List of RootNodeInfo for each disconnected root
        """
        roots = []
        for node_id, node in tree.tree.items():
            if node.parent_id is None:
                # Count children for context
                child_count = len(node.children) if hasattr(node, 'children') else 0
                
                roots.append(RootNodeInfo(
                    node_id=node_id,
                    title=node.title,
                    summary=node.summary if node.summary else node.content[:200],
                    child_count=child_count
                ))
        
        self.logger.info(f"Found {len(roots)} disconnected root nodes")
        return roots
    
    def _format_roots_for_prompt(self, roots: List[RootNodeInfo]) -> str:
        """Format root nodes for the LLM prompt"""
        formatted = []
        for root in roots:
            formatted.append(
                f"Node ID: {root.node_id}\n"
                f"Title: {root.title}\n"
                f"Summary: {root.summary}\n"
                f"Subtree Size: {root.child_count} children\n"
            )
        return "\n---\n".join(formatted)
    
    def create_connection_actions(
        self,
        response: ConnectOrphansResponse
    ) -> List[BaseTreeAction]:
        """
        Create tree actions to connect the grouped roots under new parent nodes.
        
        Args:
            response: The LLM response with groupings
            
        Returns:
            List of CreateAction for new parent nodes
        """
        actions = []
        
        for grouping in response.groupings:
            # Create action for new parent node
            parent_action = CreateAction(
                action="CREATE",
                parent_node_id=None,  # New parent is also a root (for MVP)
                new_node_name=grouping.parent_title,
                content=f"# {grouping.parent_title}\n\n{grouping.parent_summary}",
                summary=grouping.parent_summary,
                relationship=""
            )
            actions.append(parent_action)
            
            # Note: In phase 2, we would also create UpdateActions to set the
            # parent_id of the grouped roots to point to this new parent.
            # For MVP, we're just creating the parent nodes.
            
            self.logger.info(
                f"Creating parent '{grouping.parent_title}' "
                f"for roots: {grouping.root_node_ids}"
            )
        
        return actions
    
    async def run(
        self,
        tree: DecisionTree,
        min_group_size: int = 2,
        max_roots_to_process: int = 20
    ) -> List[BaseTreeAction]:
        """
        Main entry point to run the connection mechanism.
        
        Args:
            tree: The DecisionTree to analyze and connect
            min_group_size: Minimum roots needed to form a group
            max_roots_to_process: Maximum number of roots to process at once
            
        Returns:
            List of tree actions to apply
        """
        # Find disconnected roots
        roots = self.find_disconnected_roots(tree)
        
        if len(roots) < min_group_size:
            self.logger.info("Not enough disconnected roots to group")
            return []
        
        # Limit roots for processing (for performance)
        if len(roots) > max_roots_to_process:
            self.logger.warning(
                f"Found {len(roots)} roots, limiting to {max_roots_to_process}"
            )
            roots = roots[:max_roots_to_process]
        
        # Format roots for prompt
        roots_context = self._format_roots_for_prompt(roots)
        
        # Prepare state for the agent workflow
        initial_state = {
            "roots_context": roots_context,
            "min_group_size": min_group_size,
            "tree": tree,
            "actions": []
        }
        
        # Execute the workflow
        app = self.compile()
        final_state = await app.ainvoke(initial_state)
        
        # Extract actions from the response
        if final_state.get("connect_orphans_response"):
            response = final_state["connect_orphans_response"]
            actions = self.create_connection_actions(response)
            return actions
        
        return []