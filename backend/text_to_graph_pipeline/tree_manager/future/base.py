#!/usr/bin/env python3
"""
Day 2: Tree Manager Interface Extraction

This module defines the common interface shared by all tree managers.
Extracted from analysis of ContextualTreeManager, WorkflowTreeManager, and EnhancedWorkflowTreeManager.

Bible Rule Compliance:
- Evolve existing structure (adding to backend/tree_manager/) ✅
- Extract common interface, don't change behavior ✅  
- Small, testable change ✅
"""

from abc import ABC, abstractmethod
from typing import Optional

from backend.tree_manager.decision_tree_ds import DecisionTree


class TreeManagerInterface(ABC):
    """
    Common interface for all VoiceTree managers
    
    Extracted from analysis of existing managers:
    - ContextualTreeManager: Uses LLM engine directly
    - WorkflowTreeManager: Uses agentic workflows  
    - EnhancedWorkflowTreeManager: Extends WorkflowTreeManager with TROA
    
    All managers share this core interface:
    1. Constructor with DecisionTree dependency
    2. Primary async process_voice_input method
    3. Access to decision_tree instance
    """
    
    def __init__(self, decision_tree: DecisionTree):
        """
        Initialize tree manager with decision tree dependency
        
        Args:
            decision_tree: The decision tree instance to manage
        """
        self.decision_tree = decision_tree
    
    # @abstractmethod
    # async def process_voice_input(self, transcribed_text: str):
    #     """
    #     Process incoming transcribed voice input
    #
    #     This is the core method that all tree managers must implement.
    #     It processes voice transcriptions and updates the decision tree.
    #
    #     Args:
    #         transcribed_text: The transcribed text from voice recognition
    #     """
    #     pass
    
    # Optional common properties that managers can override
    @property 
    def nodes_to_update(self):
        """
        Get the set of node IDs that need to be updated
        
        Returns:
            Set of node IDs that have been modified and need markdown regeneration
        """
        if not hasattr(self, '_nodes_to_update'):
            self._nodes_to_update = set()
        return self._nodes_to_update


class TreeManagerMixin:
    """
    Mixin providing common functionality for tree managers
    
    This provides shared utilities that don't belong in the interface
    but are useful across different manager implementations.
    """
    
    def get_tree_size(self) -> int:
        """Get the current size of the decision tree"""
        if hasattr(self, 'decision_tree') and self.decision_tree:
            return len(self.decision_tree.tree)
        return 0
    
    def get_root_children_count(self) -> int:
        """Get the number of direct children of the root node"""
        if hasattr(self, 'decision_tree') and self.decision_tree and 0 in self.decision_tree.tree:
            return len(self.decision_tree.tree[0].children)
        return 0
    
    def get_basic_statistics(self) -> dict:
        """Get basic statistics about the tree state"""
        return {
            "total_nodes": self.get_tree_size(),
            "root_children": self.get_root_children_count(),
            "nodes_to_update": len(getattr(self, 'nodes_to_update', set()))
        }


# Interface Analysis Results for Day 3 Planning
class InterfaceAnalysisResults:
    """
    Day 2 Interface Extraction Results
    
    Common Interface Found:
    1. Constructor: __init__(decision_tree: DecisionTree, ...)
    2. Primary Method: async process_voice_input(transcribed_text: str)  
    3. Required Attribute: decision_tree: DecisionTree
    4. Common Property: nodes_to_update (Set[int])
    
    Manager-Specific Extensions:
    - ContextualTreeManager: Direct LLM integration, buffering
    - WorkflowTreeManager: Agentic workflow integration  
    - EnhancedWorkflowTreeManager: TADA + TROA background optimization
    
    Day 3 Plan: Make ContextualTreeManager implement TreeManagerInterface
    - Simple change: add inheritance and interface compliance
    - No behavior changes, just interface conformance
    - Verify all existing usage still works
    """
    
    COMMON_CONSTRUCTOR_PATTERN = """
    # All managers follow this pattern:
    def __init__(self, decision_tree: DecisionTree, ...):
        self.decision_tree = decision_tree
        # Manager-specific initialization...
    """
    
    COMMON_METHOD_PATTERN = """
    # All managers implement this method:
    async def process_voice_input(self, transcribed_text: str):
        # Manager-specific processing logic...
    """
    
    USAGE_LOCATIONS = [
        "backend/pipeline_system_tests/test_audio_processing.py (ContextualTreeManager)",
        "backend/tests/unit_tests/test_contextual_tree_manager.py (ContextualTreeManager)",
        "backend/benchmarker/quality_tests/quality_LLM_benchmarker.py (WorkflowTreeManager)",
        "backend/enhanced_transcription_processor.py (EnhancedWorkflowTreeManager)"
    ] 