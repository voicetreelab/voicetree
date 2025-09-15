"""
Tree Action Application Module
Handles applying integration decisions to the decision tree
"""

import logging
from typing import List, Set, Union

from backend.tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction, BaseTreeAction, AppendAction


class TreeActionApplier:
    """
    Applies tree actions (CREATE, APPEND, UPDATE) to the decision tree.
    
    This class encapsulates the logic for modifying the tree structure
    based on integration decisions from agentic workflows and optimization actions.
    """
    
    def __init__(self, decision_tree: MarkdownTree):
        """
        Initialize the TreeActionApplier
        
        Args:
            decision_tree: The decision tree instance to apply actions to
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
    
    
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
    
    def _apply_optimization_actions(self, actions: List[UpdateAction]) -> Set[int]:
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
    
    def _apply_mixed_actions(self, actions: List[Union[UpdateAction, CreateAction, AppendAction]]) -> Set[int]:
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
                self._apply_create_action(action)
            elif isinstance(action, AppendAction):
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
    
    def _apply_create_action(self, action: CreateAction):
        """
        Apply a CREATE action from the optimizer (uses CreateAction model)
        
        Args:
            action: The CreateAction to apply
        """
        # The optimizer should work with node IDs, but support name fallback
        parent_id = None
        if hasattr(action, 'parent_node_id') and action.parent_node_id is not None:
            # Handle special case: -1 means no parent (root node)
            parent_id = None if action.parent_node_id == -1 else action.parent_node_id
        elif action.target_node_name:
            # Legacy path: resolve name to ID
            parent_id = self.decision_tree.get_node_id_from_name(action.target_node_name)
            if parent_id is None:
                logging.warning(f"Could not find parent node '{action.target_node_name}' for CREATE action")
        
        # Debug logging for orphan nodes
        if parent_id is None:
            logging.info(f"DEBUG TreeActionApplier: Creating orphan node '{action.new_node_name}'")
        
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
        logging.info(f"DEBUG TreeActionApplier: Added node {new_node_id} to nodes_to_update. Current set: {self.nodes_to_update}")
        
        # Also add the parent node to update set if it exists
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")
    
    def apply(self, actions: List[BaseTreeAction]) -> Set[int]:
        """
        Apply a list of tree actions
        
        This unified method handles all action types by dispatching based on
        the action field of each BaseTreeAction.
        
        Args:
            actions: List of BaseTreeAction objects (UpdateAction, CreateAction, etc.)
            
        Returns:
            Set of node IDs that were updated
            
        Raises:
            ValueError: If an unknown action type is encountered
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} tree actions")
        
        for action in actions:
            if action.action == "UPDATE":
                self._apply_update_action(action)
            elif action.action == "CREATE":
                self._apply_create_action(action)
            elif action.action == "APPEND":
                self._apply_append_action(action)
            else:
                raise ValueError(f"Unknown action type: {action.action}")
        
        logging.info(f"DEBUG TreeActionApplier: Returning modified nodes: {self.nodes_to_update}")
        return self.nodes_to_update.copy()
    
    def _apply_append_action(self, action: 'AppendAction'):
        """
        Apply an APPEND action using the new unified action model
        
        Args:
            action: The AppendAction to apply
        """
        node_id = action.target_node_id
        
        # If node ID not found, try to find by name as fallback
        if node_id not in self.decision_tree.tree:
            if action.target_node_name:
                logging.info(f"Node ID {node_id} not found, searching for node by name: '{action.target_node_name}'")
                found_id = self.decision_tree.get_node_id_from_name(action.target_node_name)
                if found_id is not None:
                    logging.info(f"Found node '{action.target_node_name}' with ID {found_id}, using that instead")
                    node_id = found_id
                else:
                    logging.warning(f"Node ID {node_id} not found and name '{action.target_node_name}' also not found - deferring append action")
                    return
            else:
                logging.error(f"Node ID {node_id} not found in tree and no fallback name provided - deferring append action")
                return
        
        self.decision_tree.append_node_content(node_id, action.content)
        self.nodes_to_update.add(node_id)
        
        node = self.decision_tree.tree[node_id]
        logging.info(f"Appended content to node '{node.title}' (ID {node_id})")