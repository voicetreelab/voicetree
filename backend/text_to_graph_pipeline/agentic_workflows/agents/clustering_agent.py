"""
ClusteringAgent - Analyzes and clusters VoiceTree nodes by semantic similarity
"""

import math
from typing import List, Union, Dict, Any, Optional
from langgraph.graph import END

from ..core.agent import Agent
from ..core.state import ClusteringAgentState
from ..models import ClusteringResponse


class ClusteringAgent(Agent):
    """Agent that clusters nodes by semantic similarity of titles and summaries"""
    
    def __init__(self):
        super().__init__("ClusteringAgent", ClusteringAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Single prompt workflow"""
        self.add_prompt_node(
            "clustering",
            ClusteringResponse,
            model_name="gemini-2.5-flash-lite"
        )
        self.add_dataflow("clustering", END)
    
    async def run(self, formatted_nodes: str, node_count: int) -> ClusteringResponse:
        """Analyze and cluster nodes by semantic similarity
        
        Args:
            formatted_nodes: Output from _format_nodes_for_prompt()
            node_count: Total number of nodes for cluster count calculation
            
        Returns:
            ClusteringResponse with cluster assignments
        """
        
        # Calculate target cluster count (approximately sqrt(node_count))
        target_clusters = max(1, round(math.sqrt(node_count))) if node_count > 1 else 1
        
        # Create initial state
        initial_state: ClusteringAgentState = {
            "formatted_nodes": formatted_nodes,
            "node_count": node_count,
            "target_clusters": target_clusters,
            # Agent response field
            "clustering_response": None
        }
        
        # Run workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Extract clustering response
        if result and result.get("clustering_response"):
            return result["clustering_response"]
        
        # Fallback empty response
        return ClusteringResponse(clusters=[])