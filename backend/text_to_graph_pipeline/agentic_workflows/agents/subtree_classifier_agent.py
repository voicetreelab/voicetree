"""
SubtreeClassifierAgent - Uses LLM to classify tree structures into meaningful subtrees
"""

import json
from typing import Dict, Any
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import SubtreeClassifierAgentState
from ..models import SubtreeClassificationResponse


class SubtreeClassifierAgent(Agent):
    """Agent that classifies trees into meaningful subtrees using LLM analysis"""
    
    def __init__(self):
        super().__init__("SubtreeClassifierAgent", SubtreeClassifierAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Single prompt workflow for subtree classification"""
        self.add_prompt_node(
            "subtree_classification",
            SubtreeClassificationResponse,
            model_name="gemini-2.5-flash"
        )
        self.add_dataflow("subtree_classification", END)
    
    async def run(self, tree_data: Dict[str, Any]) -> SubtreeClassificationResponse:
        """
        Classify tree nodes into meaningful subtrees using LLM analysis
        
        Args:
            tree_data: Structured tree data dictionary from Tree Loader
            
        Returns:
            SubtreeClassificationResponse with classified subtrees and reasoning
        """
        
        # Create initial state
        initial_state: SubtreeClassifierAgentState = {
            "tree_data": tree_data,
            # Agent response field
            "subtree_classification_response": None
        }
        
        # Run workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Extract classification response
        if result and result.get("subtree_classification_response"):
            return result["subtree_classification_response"]
        
        # Fallback empty response (should not happen with proper LLM integration)
        return SubtreeClassificationResponse(
            classified_trees=[],
            reasoning="No classification result returned from LLM"
        )