"""
AppendToRelevantNodeAgent - Determines where to place new content in the tree

This agent:
1. Segments raw text into atomic ideas
2. Identifies target nodes or proposes new nodes for each segment
3. Returns AppendAction or CreateAction objects
"""

from typing import List, Union, Dict, Any, Optional, TypedDict
import json
from langgraph.graph import END

from ..core.agent import Agent
from ..models import (
    SegmentationResponse,
    TargetNodeResponse,
    TargetNodeIdentification,
    AppendAction,
    CreateAction,
    BaseTreeAction
)
from ...tree_manager.decision_tree_ds import DecisionTree


class _AppendAgentState(TypedDict):
    """Internal state for append workflow"""
    # Input
    transcript_text: str
    transcript_history: str
    existing_nodes: str  # JSON string of existing nodes
    
    # Intermediate outputs
    segments: Optional[List[Dict[str, Any]]]  # From segmentation
    target_nodes: Optional[List[Dict[str, Any]]]  # From identify_target


class AppendToRelevantNodeAgent(Agent):
    """Agent that determines where to place new content in the tree"""
    
    def __init__(self):
        super().__init__("AppendToRelevantNodeAgent", _AppendAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Configure the two-prompt workflow"""
        # Step 1: Segment the text into atomic ideas
        self.add_prompt(
            "segmentation",
            SegmentationResponse
        )
        
        # Step 2: Identify target nodes for each segment
        self.add_prompt(
            "identify_target_node",
            TargetNodeResponse
        )
        
        # Define dataflow with filtering transform
        self.add_dataflow("segmentation", "identify_target_node", transform=self._prepare_for_target_identification)
        self.add_dataflow("identify_target_node", END)
    
    def _prepare_for_target_identification(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Transform state between segmentation and target identification"""
        # Extract segments from segmentation response
        segments = state.get("segments", [])
        
        # Filter out incomplete segments
        complete_segments = [segment for segment in segments if segment.get("is_complete", False)]
        
        # Prepare segments for target identification
        segments = [{"text": segment["text"]} for segment in complete_segments]
        
        return {
            **state,
            "segments": segments
        }
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[Union[AppendAction, CreateAction]]:
        """
        Process text and return placement actions
        
        Args:
            transcript_text: Raw voice transcript to process
            decision_tree: Current tree state
            transcript_history: Optional context from previous transcripts
            
        Returns:
            List of AppendAction or CreateAction objects
        """
        # Create initial state
        initial_state: _AppendAgentState = {
            "transcript_text": transcript_text,
            "transcript_history": transcript_history,
            "existing_nodes": self._format_nodes_for_prompt(decision_tree),
            "segments": None,
            "target_nodes": None
        }
        
        # Run the workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        

        
        # Convert TargetNodeIdentification to actions (translation layer)
        actions: List[Union[AppendAction, CreateAction]] = []
        
        if result.get("target_nodes"):
            for target in result["target_nodes"]:
                # Convert dict to TargetNodeIdentification if needed
                if isinstance(target, dict):
                    target = TargetNodeIdentification(**target)
                
                if target.target_node_id != -1:
                    # Existing node - create AppendAction
                    actions.append(AppendAction(
                        action="APPEND",
                        target_node_id=target.target_node_id,
                        content=target.text
                    ))
                else:
                    # New node - create CreateAction (always orphan)
                    actions.append(CreateAction(
                        action="CREATE",
                        parent_node_id=None,  # Always orphan nodes
                        new_node_name=target.new_node_name,
                        content=target.text,
                        summary=f"Content about {target.new_node_name}",
                        relationship="independent"
                    ))
        
        return actions
    
    def _format_nodes_for_prompt(self, tree: DecisionTree) -> str:
        """Format tree nodes for LLM prompt"""
        if not tree.tree:
            return "[]"  # Empty array for no nodes
        
        node_list = []
        for node_id, node in tree.tree.items():
            node_list.append({
                "id": node_id,
                "name": node.title,
                "summary": node.summary
            })
        
        return json.dumps(node_list, indent=2)