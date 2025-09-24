"""
ConnectOrphansAgent - Groups disconnected tree components under parent nodes

This agent implements the LLM connection mechanism to solve the disconnected
components problem by:
1. Identifying root nodes from disconnected subtrees
2. Analyzing relationships between roots using only titles and summaries
3. Grouping related roots under new parent nodes when obvious relationships exist
"""

import logging
from dataclasses import dataclass
from dataclasses import field

from langgraph.graph import END
from pydantic import BaseModel
from pydantic import Field

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    format_nodes_for_prompt,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.markdown_tree_manager.utils import map_titles_to_node_ids
from backend.text_to_graph_pipeline.agentic_workflows.core.agent import Agent
from backend.text_to_graph_pipeline.agentic_workflows.core.state import (
    ConnectOrphansAgentState,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import BaseTreeAction
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction


@dataclass
class RootNodeInfo:
    """Information about a root node for grouping analysis"""
    node_id: int
    title: str
    summary: str
    child_count: int = 0
    children: list[dict[str, str]] = field(default_factory=list)  # List of {title, summary} for children


@dataclass
class RootGrouping:
    """A grouping of related root nodes with their IDs"""
    root_node_ids: list[int]
    parent_title: str
    parent_summary: str
    relationship: str


# Pydantic models for LLM responses
class ChildRelationship(BaseModel):
    """Relationship between a child node and its synthetic parent"""
    child_title: str = Field(description="Title of the child node")
    relationship_to_parent: str = Field(description="How this child relates to the parent")

class OrphanGrouping(BaseModel):
    """A grouping of orphan nodes under a synthetic parent"""
    synthetic_parent_title: str = Field(description="Title for the new synthetic parent node")
    synthetic_parent_summary: str = Field(description="Summary describing what unites these nodes")
    children: list[ChildRelationship] = Field(description="Child nodes and their relationships to the parent")

class ConnectOrphansResponse(BaseModel):
    """LLM response for connecting orphan nodes"""
    reasoning: str = Field(description="Explanation of grouping decisions")
    groupings: list[OrphanGrouping] = Field(
        description="List of synthetic parent nodes to create",
        default_factory=list
    )

class ConnectOrphansAgent(Agent):
    """
    Agent that connects disconnected tree components by grouping related root nodes.

    This implements the Agent-LLM Connection Mechanism to address the disconnected
    components problem in VoiceTree.
    """

    def __init__(self) -> None:
        super().__init__("ConnectOrphansAgent", ConnectOrphansAgentState)
        self.logger = logging.getLogger(__name__)
        self._setup_workflow()

    def _setup_workflow(self) -> None:
        """Configure the single-prompt workflow for grouping orphans"""
        # Single prompt to analyze and group orphan nodes
        self.add_prompt_node(
            "connect_orphans",
            ConnectOrphansResponse,
            model_name="gemini-2.5-flash"
        )

        # Direct flow to END after grouping
        self.add_dataflow("connect_orphans", END)

    def find_disconnected_roots(self, tree: MarkdownTree) -> list[RootNodeInfo]:
        """
        Find all root nodes (nodes with no parent) in the tree.
        These represent disconnected components.

        Args:
            tree: The DecisionTree to analyze

        Returns:
            List of RootNodeInfo for each disconnected root
        """
        roots = []
        for node_id, node in tree.tree.items():
            if node.parent_id is None:
                # Get children information
                children_info = []
                if hasattr(node, 'children') and node.children:
                    for child_id in node.children:
                        if child_id in tree.tree:
                            child_node = tree.tree[child_id]
                            children_info.append({
                                'title': child_node.title,
                                'summary': child_node.summary if child_node.summary else child_node.content[:100]
                            })

                child_count = len(children_info)

                roots.append(RootNodeInfo(
                    node_id=node_id,
                    title=node.title,
                    summary=node.summary if node.summary else node.content[:200],
                    child_count=child_count,
                    children=children_info if children_info else []
                ))

        self.logger.info(f"Found {len(roots)} disconnected root nodes")
        return roots
    def _format_roots_for_prompt(self, roots: list[RootNodeInfo], include_full_content: bool = True) -> str:
        """Format root nodes for the LLM prompt with children included for context

        Args:
            roots: List of RootNodeInfo objects
            include_full_content: If True, includes children info for context

        Returns:
            Formatted string for prompt with orphans and their children for context
        """
        # Convert RootNodeInfo to Node objects for formatting
        nodes = []
        for root in roots:
            # Build content that includes children info within the orphan's description
            content_parts = [root.summary]

            if include_full_content and root.children:
                content_parts.append("\n\n**Children of this orphan (for context - DO NOT include these in groupings):**")
                for i, child in enumerate(root.children[:5], 1):
                    child_summary = child.get('summary', '')[:100]
                    content_parts.append(f"  {i}. {child['title']}: {child_summary}")
                if root.child_count > 5:
                    content_parts.append(f"  ... and {root.child_count - 5} more children")
            elif root.child_count > 0:
                content_parts.append(f"\n(Has {root.child_count} children)")

            node = Node(
                name=root.title,
                node_id=root.node_id,
                content="\n".join(content_parts),
                summary=root.summary
            )
            nodes.append(node)

        # Return formatted nodes - children are now embedded in parent content, not separate nodes
        # Use include_full_content=True to show the full content with children info
        return format_nodes_for_prompt(nodes, include_full_content=True)


    def _map_titles_to_ids(self, titles: list[str], roots: list[RootNodeInfo]) -> list[int]:
        """
        Map node titles back to their IDs using the utility function.

        Args:
            titles: List of node titles from LLM
            roots: List of RootNodeInfo objects

        Returns:
            List of corresponding node IDs
        """
        # Convert RootNodeInfo to Node objects for the utility function
        nodes = [Node(name=root.title, node_id=root.node_id, content="") for root in roots]
        return map_titles_to_node_ids(titles, nodes, fuzzy_match=True)

    def create_connection_actions(
        self,
        response: ConnectOrphansResponse,
        roots: list[RootNodeInfo]
    ) -> tuple[list[BaseTreeAction], dict[str, list[int]]]:
        """
        Create tree actions to connect the grouped roots under new parent nodes.

        Args:
            response: The LLM response with groupings
            roots: Original list of RootNodeInfo for title->ID mapping

        Returns:
            Tuple of:
            - List of CreateAction for new parent nodes
            - Dict mapping parent node names to child node IDs
        """
        actions: list[BaseTreeAction] = []
        parent_child_mapping = {}

        for grouping in response.groupings:
            # Extract child titles from the new structure
            child_titles = [child.child_title for child in grouping.children]
            root_ids = self._map_titles_to_ids(child_titles, roots)

            # Create action for new synthetic parent node
            parent_action = CreateAction(
                action="CREATE",
                parent_node_id=None,  # New parent is also a root (for MVP)
                new_node_name=grouping.synthetic_parent_title,
                content=f"# {grouping.synthetic_parent_title}\n\n{grouping.synthetic_parent_summary}",
                summary=grouping.synthetic_parent_summary,
                relationship=""
            )
            actions.append(parent_action)

            # Store the mapping of parent name to child IDs
            parent_child_mapping[grouping.synthetic_parent_title] = root_ids

            self.logger.info(
                f"Creating synthetic parent '{grouping.synthetic_parent_title}' "
                f"for children: {child_titles} (IDs: {root_ids})"
            )

        return actions, parent_child_mapping

    async def run(
        self,
        tree: MarkdownTree,
        max_roots_to_process: int = 20,
        include_full_content: bool = True
    ) -> tuple[list[BaseTreeAction], dict[str, list[int]]]:
        """
        Main entry point to run the connection mechanism.

        Args:
            tree: The DecisionTree to analyze and connect
            max_roots_to_process: Maximum number of roots to process at once
            include_full_content: If True, includes full content in prompt

        Returns:
            Tuple of:
            - List of tree actions to apply
            - Dict mapping parent node names to child node IDs
        """
        # Find disconnected roots
        roots = self.find_disconnected_roots(tree)

        # Minimum group size is always 2 (simplified)
        if len(roots) < 2:
            self.logger.info("Not enough disconnected roots to group")
            return [], {}

        # Limit roots for processing (for performance)
        if len(roots) > max_roots_to_process:
            self.logger.warning(
                f"Found {len(roots)} roots, limiting to {max_roots_to_process}"
            )
            roots = roots[-max_roots_to_process:] #todo confirm roots were sorted by time, so this gives the most recent orphans
        # run on only the latest orphans created
        # todo there should be another upstream layer to handle this

        # todo, needs to split into equal batches of max,
        # we should ensure the roots are sorted by time of node creation, so earlier roots/orphans
        # are in the same batch.
        # to handle problem of not covering all pairs:
        # should have some amount of overlap (~15%).
        # or we should first do a vector similarity search to group orphans.

        # for current QA testcase usecase we can just get away with running all orphans at once, or batches with some overlap...
        # OR sequential batches (so unprocessed orphans go back in for resampling)

        # Format roots for prompt with full content if requested
        roots_context = self._format_roots_for_prompt(roots, include_full_content=include_full_content)

        # Prepare state for the agent workflow (simplified - removed min_group_size)
        initial_state = {
            "roots_context": roots_context,
            "tree": tree,
            "actions": []
        }

        # Execute the workflow
        app = self.compile()
        final_state = await app.ainvoke(initial_state)

        # Extract actions from the response
        response = final_state.get("connect_orphans_response")
        if response:
            actions, parent_child_mapping = self.create_connection_actions(response, roots)
            return actions, parent_child_mapping

        return [], {}
