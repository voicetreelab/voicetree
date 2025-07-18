"""
Tree Action Application Module
Handles applying integration decisions to the decision tree
"""

import logging
from typing import List, Set, Union

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision, UpdateAction, CreateAction


class TreeActionApplier:
    """
    Applies tree actions (CREATE, APPEND, UPDATE) to the decision tree.
    
    This class encapsulates the logic for modifying the tree structure
    based on integration decisions from agentic workflows and optimization actions.
    """
    
    def __init__(self, decision_tree: DecisionTree):
        """
        Initialize the TreeActionApplier
        
        Args:
            decision_tree: The decision tree instance to apply actions to
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
    
    def apply_integration_decisions(self, integration_decisions: List[IntegrationDecision]) -> Set[int]:
        """
        Apply integration decisions from workflow result to the decision tree
        
        Args:
            integration_decisions: List of IntegrationDecision objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(integration_decisions)} integration decisions")
        
        for decision in integration_decisions:
            if decision.action == "CREATE":
                self._apply_create_action(decision)
            elif decision.action == "APPEND":
                self._apply_append_action(decision)
            else:
                logging.warning(f"Unknown action type: {decision.action}")
        
        return self.nodes_to_update.copy()
    
    def _apply_create_action(self, decision: IntegrationDecision):
        """
        Apply a CREATE action to create a new node in the tree
        
        Args:
            decision: The IntegrationDecision with CREATE action
        """
        # Find parent node ID from name or none if not specified
        parent_id = None  
        if decision.target_node:
            parent_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=decision.new_node_name,
            parent_node_id=parent_id,
            content=decision.content,
            summary=decision.new_node_summary,
            relationship_to_parent=decision.relationship_for_edge
        )
        logging.info(f"Created new node '{decision.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set so its child links are updated
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")
    
    def _apply_append_action(self, decision: IntegrationDecision):
        """
        Apply an APPEND action to append content to an existing node
        
        Args:
            decision: The IntegrationDecision with APPEND action
        """
        # Find target node and append content
        if not decision.target_node:
            logging.warning(f"APPEND decision for '{decision.name}' has no target_node - skipping")
            return
            
        node_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        if node_id is not None:
            node = self.decision_tree.tree[node_id]
            node.append_content(
                decision.content,
                None,  # APPEND decisions don't have new_node_summary in IntegrationDecision
                decision.name  # Use the chunk name as the label
            )
            logging.info(f"Appended content to node '{decision.target_node}' (ID {node_id})")
            # Add the updated node to the update set
            self.nodes_to_update.add(node_id)
        else:
            logging.warning(f"Could not find node '{decision.target_node}' for APPEND action")
    
    def get_nodes_to_update(self) -> Set[int]:
        """
        Get the set of node IDs that need to be updated
        
        Returns:
            Set of node IDs
        """
        return self.nodes_to_update.copy()
    
    def clear_nodes_to_update(self):
        """Clear the set of nodes to update"""
        self.nodes_to_update.clear()
    
    def apply_optimization_actions(self, actions: List[UpdateAction]) -> Set[int]:
        """
        Apply optimization actions (UPDATE) from the optimizer
        
        Args:
            actions: List of UpdateAction objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} optimization actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            else:
                logging.warning(f"Unexpected action type in optimization actions: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def apply_mixed_actions(self, actions: List[Union[UpdateAction, CreateAction, IntegrationDecision]]) -> Set[int]:
        """
        Apply a mixed list of actions (UPDATE, CREATE) to handle complex operations like SPLIT
        
        Args:
            actions: List of mixed action types to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} mixed actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            elif isinstance(action, CreateAction):
                self._apply_create_action_from_optimizer(action)
            elif isinstance(action, IntegrationDecision):
                # Handle IntegrationDecision for backward compatibility
                if action.action == "CREATE":
                    self._apply_create_action(action)
                elif action.action == "APPEND":
                    self._apply_append_action(action)
            else:
                logging.warning(f"Unknown action type: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def _apply_update_action(self, action: UpdateAction):
        """
        Apply an UPDATE action to modify node content and summary
        
        Args:
            action: The UpdateAction to apply
        """
        # Update the node using the decision tree's update_node method
        try:
            self.decision_tree.update_node(
                node_id=action.node_id,
                content=action.new_content,
                summary=action.new_summary
            )
            logging.info(f"Updated node with ID {action.node_id}")
            
            # Add the updated node to the update set
            self.nodes_to_update.add(action.node_id)
        except KeyError:
            logging.error(f"Could not find node with ID {action.node_id} for UPDATE action")
    
    def _apply_create_action_from_optimizer(self, action: CreateAction):
        """
        Apply a CREATE action from the optimizer (uses CreateAction model)
        
        Args:
            action: The CreateAction to apply
        """
        # Find parent node ID from name
        parent_id = None
        if action.target_node_name:
            parent_id = self.decision_tree.get_node_id_from_name(action.target_node_name)
            if parent_id is None:
                logging.warning(f"Could not find parent node '{action.target_node_name}' for CREATE action")
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=action.new_node_name,
            parent_node_id=parent_id,
            content=action.content,
            summary=action.summary,
            relationship_to_parent=action.relationship
        )
        logging.info(f"Created new node '{action.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set if it exists
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")