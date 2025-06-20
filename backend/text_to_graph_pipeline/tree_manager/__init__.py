"""

TODO: tree_manager is becoming complex and bloated, can we break it up again into compponents 

Tree Manager Package

Decision tree management and processing components for VoiceTree.

This package provides three unified tree managers that all implement the TreeManagerInterface:
- ContextualTreeManager: Direct LLM integration with contextual buffering
- WorkflowTreeManager: Agentic workflow-based processing
- EnhancedWorkflowTreeManager: TADA + TROA hybrid system

Core components:
- TreeManagerInterface: Common interface for all managers
- DecisionTree: Core decision tree data structure
- Utils: Shared utilities for tree processing

Usage:
    from backend.tree_manager import ContextualTreeManager, DecisionTree
    from backend.tree_manager.base import TreeManagerInterface
"""

# Import main classes for convenience
from backend.tree_manager.future.enhanced_workflow_tree_manager import EnhancedWorkflowTreeManager
from .decision_tree_ds import DecisionTree, Node
from backend.tree_manager.future.base import TreeManagerInterface, TreeManagerMixin

__all__ = [
    # Tree Managers
    "WorkflowTreeManager",
    "EnhancedWorkflowTreeManager",
    
    # Core Data Structures
    "DecisionTree",
    "Node",
    
    # Interfaces
    "TreeManagerInterface",
    "TreeManagerMixin",
]

# NodeAction is now defined locally in each module to avoid circular imports
from collections import namedtuple

NodeAction = namedtuple('NodeAction',
                        [
                            'labelled_text',
                            'action',
                            'concept_name',
                            'neighbour_concept_name',
                            'relationship_to_neighbour',
                            'updated_summary_of_node',
                            'markdown_content_to_append',
                            'is_complete'
                        ])

