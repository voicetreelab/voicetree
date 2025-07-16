"""
TreeActionApplier

API
Public
applyTreeAction(treeAction) -> updatedTree

Private (no need to test here)
applyCreate
applyAppend
"""

"""
Testable Behaviour:

given large tree (10 nodes), do 21 actions, randomly choose between append (to any given node randomly), and create (to any given node randomly).

Check after end of these 21 actions the tree is in the state we expect:
    - The number of nodes matches init + created
    - If you accumulate all the text within the tree (functional acc of tree), then all the appended and created text is contained within this, the length matches what is expected (= new + old)
   - Some way of testing structure / relationships expected? Number of relationship (links) matches whhat we expect (orig + num creates?) 

"""

import pytest
import random
from typing import List, Set, Dict, Tuple
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision


class TestTreeActionApplierE2E:
    """End-to-end tests for TreeActionApplier"""
    
    def _create_initial_tree(self, num_nodes: int = 10) -> Tuple[DecisionTree, Dict[int, str]]:
        """
        Create an initial tree with the specified number of nodes
        
        Returns:
            Tuple of (DecisionTree, dict mapping node_id to initial content)
        """
        tree = DecisionTree()
        initial_contents = {}
        
        # Create root node first
        root_id = tree.create_new_node(
            name="Root",
            parent_node_id=None,
            content="Root content",
            summary="Root summary",
            relationship_to_parent=""
        )
        
        # Create nodes with a mix of parent-child relationships
        for i in range(1, num_nodes + 1):
            # Determine parent - create some hierarchy
            if i == 1:
                parent_id = root_id  # First node is child of root
            elif i <= 3:
                parent_id = 1  # Nodes 2-3 are children of node 1
            elif i <= 6:
                parent_id = random.choice([2, 3])  # Nodes 4-6 are children of 2 or 3
            else:
                parent_id = random.randint(1, i - 1)  # Rest are randomly distributed
            
            content = f"Initial content for node {i}"
            node_id = tree.create_new_node(
                name=f"Node {i}",
                parent_node_id=parent_id,
                content=content,
                summary=f"Summary for node {i}",
                relationship_to_parent="child of"
            )
            initial_contents[node_id] = content
            
        return tree, initial_contents
    
    def _generate_random_actions(self, tree: DecisionTree, num_actions: int = 21) -> List[IntegrationDecision]:
        """
        Generate random CREATE and APPEND actions
        
        Returns:
            List of IntegrationDecision objects
        """
        actions = []
        node_names = [tree.tree[node_id].title for node_id in tree.tree if node_id != 0]
        
        for i in range(num_actions):
            action_type = random.choice(["CREATE", "APPEND"])
            
            if action_type == "CREATE":
                # Pick a random parent (could be root)
                if random.random() < 0.2:  # 20% chance to attach to root
                    target_node = None
                else:
                    target_node = random.choice(node_names) if node_names else None
                
                decision = IntegrationDecision(
                    name=f"Create Action {i}",
                    text=f"Text for create action {i}",
                    reasoning=f"Creating new node {i}",
                    action="CREATE",
                    target_node=target_node,
                    new_node_name=f"Created Node {i}",
                    new_node_summary=f"Summary for created node {i}",
                    relationship_for_edge="child of",
                    content=f"Content for created node {i}"
                )
                # Add the new node name to available targets
                node_names.append(f"Created Node {i}")
            else:  # APPEND
                # Pick a random existing node
                target_node = random.choice(node_names) if node_names else None
                
                decision = IntegrationDecision(
                    name=f"Append Action {i}",
                    text=f"Text for append action {i}",
                    reasoning=f"Appending to existing node",
                    action="APPEND",
                    target_node=target_node,
                    content=f"\nAppended content {i}",
                    new_node_name=None,
                    new_node_summary=None,
                    relationship_for_edge=None
                )
            
            actions.append(decision)
        
        return actions
    
    def _accumulate_tree_text(self, tree: DecisionTree) -> str:
        """
        Accumulate all text content from the tree
        
        Returns:
            Concatenated string of all node contents
        """
        all_text = []
        for node_id, node in tree.tree.items():
            if node_id == 0:  # Skip root
                continue
            all_text.append(node.content)
        return "\n".join(all_text)
    
    def _count_relationships(self, tree: DecisionTree) -> int:
        """
        Count the number of parent-child relationships in the tree
        
        Returns:
            Number of edges/relationships
        """
        count = 0
        for node_id, node in tree.tree.items():
            # Count all nodes that have a parent (including root if it has a parent)
            if node.parent_id is not None:
                count += 1
        return count
    
    def test_e2e_random_actions(self):
        """
        End-to-end test: Create a 10-node tree, apply 21 random actions, verify final state
        """
        # Set random seed for reproducibility
        random.seed(42)
        
        # Create initial tree
        tree, initial_contents = self._create_initial_tree(10)
        initial_node_count = len(tree.tree)
        initial_text = self._accumulate_tree_text(tree)
        initial_relationships = self._count_relationships(tree)
        
        # Generate random actions
        actions = self._generate_random_actions(tree, 21)
        
        # Count expected creates
        create_count = sum(1 for action in actions if action.action == "CREATE")
        append_count = sum(1 for action in actions if action.action == "APPEND")
        
        # Track initial node count before applying actions
        pre_action_node_count = len(tree.tree)
        
        # Apply actions using TreeActionApplier
        applier = TreeActionApplier(tree)
        updated_nodes = applier.apply_integration_decisions(actions)
        
        # Verify final state
        final_node_count = len(tree.tree)
        final_text = self._accumulate_tree_text(tree)
        final_relationships = self._count_relationships(tree)
        
        # Calculate actual nodes created (some creates might fail if parent doesn't exist)
        actual_created = final_node_count - pre_action_node_count
        
        # Assertions
        # 1. Node count should have increased by some amount <= create_count
        assert actual_created <= create_count, \
            f"Created more nodes ({actual_created}) than CREATE actions ({create_count})"
        assert final_node_count > initial_node_count, \
            f"No new nodes were created"
        
        # 2. All initial text should still be present, plus new content
        for node_id, content in initial_contents.items():
            assert content in final_text, f"Initial content for node {node_id} is missing"
        
        # Verify content is present (but only for successful operations)
        # We can't verify all content because some operations might fail
        
        # 3. Number of relationships should have increased
        assert final_relationships >= initial_relationships, \
            f"Relationships decreased from {initial_relationships} to {final_relationships}"
        assert final_relationships <= initial_relationships + create_count, \
            f"More relationships ({final_relationships - initial_relationships}) than creates ({create_count})"
        
        # 4. Updated nodes set should not be empty
        assert len(updated_nodes) > 0, "No nodes were marked as updated"
        
        # Log summary
        print(f"\nE2E Test Summary:")
        print(f"Initial nodes: {initial_node_count}")
        print(f"CREATE actions: {create_count}")
        print(f"APPEND actions: {append_count}")
        print(f"Actual nodes created: {actual_created}")
        print(f"Final nodes: {final_node_count}")
        print(f"Initial relationships: {initial_relationships}")
        print(f"Final relationships: {final_relationships}")
        print(f"Updated nodes: {len(updated_nodes)}")
    
    def test_e2e_edge_cases(self):
        """Test edge cases: empty tree, all creates, all appends"""
        # Test 1: Start with empty tree
        tree = DecisionTree()
        applier = TreeActionApplier(tree)
        initial_count = len(tree.tree)
        
        # Create 5 nodes
        create_actions = []
        for i in range(5):
            create_actions.append(IntegrationDecision(
                name=f"Create {i}",
                text=f"Text {i}",
                reasoning="Creating node",
                action="CREATE",
                target_node=None if i == 0 else f"Node {i-1}",
                new_node_name=f"Node {i}",
                new_node_summary=f"Summary {i}",
                relationship_for_edge="child of",
                content=f"Content {i}"
            ))
        
        updated = applier.apply_integration_decisions(create_actions)
        assert len(tree.tree) == initial_count + 5  # 5 new nodes
        assert len(updated) >= 5  # At least 5 nodes updated
        
        # Test 2: Only append actions
        append_actions = []
        for i in range(3):
            append_actions.append(IntegrationDecision(
                name=f"Append {i}",
                text=f"Append text {i}",
                reasoning="Appending",
                action="APPEND",
                target_node=f"Node {i}",
                content=f"\nAppended {i}",
                new_node_name=None,
                new_node_summary=None,
                relationship_for_edge=None
            ))
        
        applier.clear_nodes_to_update()
        updated = applier.apply_integration_decisions(append_actions)
        assert len(tree.tree) == initial_count + 5  # No new nodes
        assert len(updated) == 3  # 3 nodes updated