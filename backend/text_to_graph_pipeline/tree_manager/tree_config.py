"""
Tree manager configuration
"""

from dataclasses import dataclass


@dataclass
class TreeConfig:
    """Configuration for tree management"""
    
    num_recent_nodes_include: int = 10
    background_rewrite_every_n_append: int = 2
    max_node_depth: int = 10  # Maximum tree depth
    max_children_per_node: int = 50  # Maximum children per node
    max_nodes_for_llm_context: int = 20  # Maximum nodes to send to LLM to prevent long context failures
    
    def __post_init__(self):
        """Validate configuration"""
        if self.num_recent_nodes_include < 1:
            raise ValueError("num_recent_nodes_include must be at least 1")
        if self.background_rewrite_every_n_append < 1:
            raise ValueError("background_rewrite_every_n_append must be at least 1")
        if self.max_nodes_for_llm_context < 1:
            raise ValueError("max_nodes_for_llm_context must be at least 1")