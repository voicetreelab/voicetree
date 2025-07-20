"""
AppendToRelevantNodeAgent - Determines where to place new content in the tree

This agent:
1. Segments raw text into atomic ideas
2. Identifies target nodes or proposes new nodes for each segment
3. Returns AppendAction or CreateAction objects
"""

import json
from typing import Any, Dict, List, Optional, Union

from langgraph.graph import END

from ...tree_manager.decision_tree_ds import DecisionTree
from ..core.agent import Agent
from ..core.state import AppendToRelevantNodeAgentState
from ..models import (AppendAction, AppendAgentResult, BaseTreeAction,
                      CreateAction, SegmentationResponse, SegmentModel,
                      TargetNodeResponse)


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
        # Get segments from state (already as dicts)
        segments_data = state.get("segments", [])
        
        # Store all segments for later use
        all_segments_dicts = segments_data  # No conversion needed, already dicts
        
        # Filter out incomplete segments - work with dicts directly
        complete_segments = [seg for seg in segments_data if seg.get("is_routable", False)]
        
        # If all segments are unfinished, skip target node identification
        if not complete_segments:
            return {
                **state,
                "_all_segments": all_segments_dicts,
                "segments": [],
                "target_nodes": []  # Set empty target_nodes to avoid LLM call
            }
        
        # Prepare segments for target identification - only pass text field
        segments_for_target = [{"text": seg["edited_text"]} for seg in complete_segments]
        
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
        
        # Get segments from the saved state (before they were transformed)
        all_segments_data = result.get("_all_segments", [])
        
        # Get target node identifications
        target_nodes_data = result.get("target_nodes", [])
        
        # Convert to actions - work with dicts until we need model instances
        actions: List[Union[AppendAction, CreateAction]] = []
        
        # Create segment models only for complete segments that have actions
        segment_models: List[SegmentModel] = []
        
        for i, target_dict in enumerate(target_nodes_data):
            # Check if we have a corresponding segment and it's routable
            if i < len(all_segments_data) and all_segments_data[i].get("is_routable", False):
                segment_dict = all_segments_data[i]
                
                # Now convert to model since we know we need it
                from ..core.boundary_converters import dict_to_model
                segment = dict_to_model(segment_dict, SegmentModel, f"segment[{i}]")
                segment_models.append(segment)
                
                # Create action based on target type
                if not target_dict.get("is_orphan", False):
                    # Existing node - create AppendAction
                    actions.append(AppendAction(
                        action="APPEND",
                        target_node_id=target_dict["target_node_id"],
                        target_node_name=target_dict.get("target_node_name"),
                        content=target_dict["text"]
                    ))
                else:
                    # New node - create CreateAction (always orphan)
                    actions.append(CreateAction(
                        action="CREATE",
                        parent_node_id=None,  # Always orphan nodes
                        new_node_name=target_dict["orphan_topic_name"],
                        content=target_dict["text"],
                        summary=f"Content about {target_dict['orphan_topic_name']}",
                        relationship="independent"
                    ))
        
        # Convert all segments to models for the result
        from ..core.boundary_converters import dicts_to_models
        all_segments = dicts_to_models(all_segments_data, SegmentModel, "_all_segments")
        
        return AppendAgentResult(
            actions=actions,
            segments=all_segments,
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