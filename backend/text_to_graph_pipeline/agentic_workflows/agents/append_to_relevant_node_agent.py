"""
AppendToRelevantNodeAgent - Determines where to place new content in the tree

This agent:
1. Segments raw text into atomic ideas
2. Identifies target nodes or proposes new nodes for each segment
3. Returns AppendAction or CreateAction objects
"""

from typing import List, Union, Dict, Any, Optional
import json
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import AppendToRelevantNodeAgentState
from ..models import (
    SegmentationResponse,
    TargetNodeResponse,
    TargetNodeIdentification,
    AppendAction,
    CreateAction,
    BaseTreeAction,
    AppendAgentResult,
    SegmentModel
)
from ...tree_manager.decision_tree_ds import DecisionTree


class AppendToRelevantNodeAgent(Agent):
    """Agent that determines where to place new content in the tree"""
    
    def __init__(self):
        super().__init__("AppendToRelevantNodeAgent", AppendToRelevantNodeAgentState)
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
        from ..core.boundary_converters import dicts_to_models, models_to_dicts
        
        # === ENTRY BOUNDARY: Convert dicts to models ===
        segments_data = state.get("segments", [])
        segments = dicts_to_models(segments_data, SegmentModel, "segments")
        
        # Store all segments for later use (as dicts for state compatibility)
        all_segments_dicts = models_to_dicts(segments)
        
        # === CORE LOGIC: Work with Pydantic models ===
        # Filter out incomplete segments
        complete_segments = [segment for segment in segments if segment.is_complete]
        
        # If all segments are unfinished, skip target node identification
        if not complete_segments:
            return {
                **state,
                "_all_segments": all_segments_dicts,
                "segments": [],
                "target_nodes": []  # Set empty target_nodes to avoid LLM call
            }
        
        # Prepare segments for target identification - only pass text field
        segments_for_target = [{"text": segment.text} for segment in complete_segments]
        
        # === EXIT BOUNDARY: Return dicts for state ===
        return {
            **state,
            "_all_segments": all_segments_dicts,  # Store all segments as dicts
            "segments": segments_for_target  # Only complete segments for target identification
        }
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> AppendAgentResult:
        """
        Process text and return placement actions with segment information
        
        Args:
            transcript_text: Raw voice transcript to process
            decision_tree: Current tree state
            transcript_history: Optional context from previous transcripts
            
        Returns:
            AppendAgentResult containing actions and segment information
        """
        # Create initial state
        initial_state: AppendToRelevantNodeAgentState = {
            "transcript_text": transcript_text,
            "transcript_history": transcript_history,
            "existing_nodes": self._format_nodes_for_prompt(decision_tree),
            "segments": None,
            "target_nodes": None,
            "_all_segments": None
        }
        
        # Run the workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # === ENTRY BOUNDARY: Convert state dicts to models ===
        from ..core.boundary_converters import dicts_to_models
        
        # Get segments from the saved state (before they were transformed)
        all_segments_data = result.get("_all_segments", [])
        segments = dicts_to_models(all_segments_data, SegmentModel, "_all_segments")
        
        # Get target node identifications
        target_nodes_data = result.get("target_nodes", [])
        target_nodes = dicts_to_models(target_nodes_data, TargetNodeIdentification, "target_nodes")
        
        # === CORE LOGIC: Work with Pydantic models ===
        # Calculate completed text - only include complete segments
        completed_segments = [seg for seg in segments if seg.is_complete]
        completed_text = " ".join(seg.text for seg in completed_segments)
        
        # Convert TargetNodeIdentification to actions (translation layer)
        actions: List[Union[AppendAction, CreateAction]] = []
        
        for i, target in enumerate(target_nodes):
            # Only create actions for complete segments
            if i < len(segments) and segments[i].is_complete:
                if target.target_node_id != -1:
                    # Existing node - create AppendAction
                    actions.append(AppendAction(
                        action="APPEND",
                        target_node_id=target.target_node_id,
                        target_node_name=target.target_node_name,
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
        
        return AppendAgentResult(
            actions=actions,
            segments=segments,
            completed_text=completed_text
        )
    
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